// SessionStream — the live per-session transport. It owns the raw
// `watchSession` subscription, exponential-backoff reconnect, eid dedup, run
// boundaries, the half-open-stream watchdog and the idle probe. It knows
// nothing about message content: each deduped, boundary-handled event is
// handed to `onEvent`; the stream's cross-cutting needs (is a turn running?
// has it gone idle?) are answered through the other callbacks.
//
// Extracted from MessagesController so that class reads as "public actions +
// wiring" and this subtle, timer-heavy code stands alone.
import type { AgentApi } from './api'
import type { StreamEvent } from './events'

// The stream-sequence anchor is IN-MEMORY ONLY (a per-instance field, `lastSeq`).
// It is deliberately NOT persisted across a page refresh:
//
//   The server's `WatchSession` resumes by `sinceSeq` STRICTLY AFTER that seq
//   (`startSeq = sinceSeq + 1`) and, for a non-zero seq, does NOT replay the
//   turn that is still RUNNING (no time-based replay, `since_msg` ignored). A
//   refresh rebuilds the JS process with no local in-progress state, so
//   resuming "after the last seq" would skip the running step's early
//   structural events (reasoning-start/delta, tool-input-*) — all of which
//   precede that seq — and the in-progress bubble could not be rebuilt.
//
// So a refresh starts at `sinceSeq=0` and replays from the newest message id
// (`since_msg`); only a SAME-PAGE reconnect (same instance, seq still in memory)
// resumes by sequence, which keeps the hot path O(1) `by_start_sequence`.

export interface StreamHandlers {
  /** Id of the session the user currently has open ('' when none). */
  getSessionId(): string
  /**
   * The newest server MESSAGE id the client holds (MessageSync's synced tip),
   * used as the `sinceMsg` anchor. It is sent ONLY on a page-refresh first
   * connect (no in-memory sequence), so the server replays the in-progress turn
   * from that message's timestamp.
   */
  getSinceMsg(): string
  /** Is a turn believed to be running (drives the watchdog + probes)? */
  isSending(): boolean
  /** A deduped, run-boundary-handled stream event. */
  onEvent(ev: StreamEvent): void
  /** A new run began (or replay started): drop stale streaming state. */
  onRunBoundary(): void
  /** The server answered idle: converge and pull any missed delta. */
  onIdle(): void
  /** The stream closed: converge to idle (no delta pull). */
  onStreamClosed(): void
  /** The server answered busy: make sure the store reflects it. */
  onBusy(): void
  /** A long-lived connection was lost (drives the reconnect banner). */
  onDisconnected(): void
  /** The connection is confirmed alive again (event, probe, or dispose). */
  onConnected(): void
}

export class SessionStream {
  private static INITIAL_RECONNECT = 1000
  private static MAX_RECONNECT_MS = 30_000
  private static IDLE_PROBE_EVERY = 20_000
  /**
   * A long-lived server stream can go HALF-OPEN: the socket dies (mobile
   * network handoff, NAT timeout, HTTP/2 GOAWAY lost) but `read()` neither
   * resolves nor rejects, so `onStreamClosed` never fires and the client waits
   * forever. The sidebar keeps updating (it uses a SEPARATE `watchSessions`
   * stream) while the open chat freezes — the classic "must refresh to see the
   * reply" bug. These bound the silence: once a believed-active turn has
   * produced no stream event for STREAM_STALE_MS, force a reconnect.
   */
  private static STREAM_STALE_MS = 15_000
  private static WATCHDOG_EVERY = 5_000
  /** Bounded liveness probe: a healthy transport must answer State fast. */
  private static PROBE_TIMEOUT_MS = 4_000
  /** While the transport stays healthy, reconnect at most this often. */
  private static HEALTHY_RECONNECT_COOLDOWN_MS = 60_000

  private streamAbort: AbortController | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private subSid: string | null = null

  private seenEids = new Set<string>()
  private activeRunId: string | null = null
  private awaitingRun = false
  /**
   * Newest JetStream stream sequence seen on this session's event stream, for
   * THIS page instance only. Reset to 0 when the connected session changes (and,
   * naturally, on a page refresh — a fresh instance). It is the O(1) reconnect
   * anchor for a same-page reconnect; a refresh instead replays via `since_msg`.
   */
  private lastSeq = 0

  private idleProbeTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = Date.now()
  /** Wall-clock of the last event RECEIVED on the per-session stream. */
  private lastStreamEventAt = Date.now()
  private lastRecoveryAt = 0
  private probing = false

  constructor(
    private api: AgentApi,
    private h: StreamHandlers,
  ) {}

  /** Open (or re-open) the stream for `sid`, resetting the backoff budget. */
  connect(sid: string) {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.streamAbort?.abort()
    const ac = new AbortController()
    this.streamAbort = ac
    // A switch to a DIFFERENT session must not resume from the previous
    // session's sequence; a reconnect of the SAME session must. A page refresh
    // is a fresh instance with `subSid === null` and `lastSeq === 0`, so it
    // takes the `since_msg` replay path below (see the header comment).
    const sameSession = this.subSid === sid
    this.subSid = sid
    if (!sameSession) this.lastSeq = 0
    this.reconnectAttempt = 0
    this.lastActivity = Date.now()
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    // Run boundary: the FIRST event of the new connection resets stale
    // streaming state; replay rebuilds it cleanly.
    this.seenEids.clear()
    this.activeRunId = null
    this.awaitingRun = true
    this.lastStreamEventAt = Date.now()
    // `sinceMsg` is sent ONLY on a page-refresh first connect (`lastSeq === 0`),
    // so the server replays the in-progress turn from that message's timestamp.
    // A same-page reconnect (`lastSeq > 0`) resumes by sequence instead, and the
    // server would ignore `sinceMsg` anyway.
    const sinceMsg = this.lastSeq > 0 ? '' : this.h.getSinceMsg()
    void (async () => {
      try {
        for await (const ev of this.api.streamEvents(
          sid,
          this.lastSeq,
          ac.signal,
          sinceMsg,
        )) {
          if (ac.signal.aborted) return
          this.lastStreamEventAt = Date.now()
          this.handleEvent(ev)
        }
        this.onStreamClosed(sid)
      } catch {
        if (!ac.signal.aborted) this.onStreamClosed(sid)
      }
    })()
    this.startIdleProbe()
    this.startWatchdog()
  }

  dispose() {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = null
    this.watchdogTimer && clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
    this.streamAbort?.abort()
    this.streamAbort = null
    // Closing the chat (or switching sessions) is not a connection problem:
    // clear the banner so a disposed stream does not leave it stuck on.
    this.h.onConnected()
  }

  /** Forget the active run (a run ended or the stream state was reset). */
  resetRun() {
    this.activeRunId = null
  }

  private handleEvent(ev: StreamEvent) {
    this.lastActivity = Date.now()
    // Advance the in-memory resume anchor to this event's stream sequence, so a
    // later same-page reconnect (or the watchdog) resumes AFTER it (O(1)).
    if (ev.seq > this.lastSeq) this.lastSeq = ev.seq
    // A live event proves the connection is healthy again.
    this.h.onConnected()
    // Dedup across the subscribe/replay overlap.
    if (ev.eid) {
      if (this.seenEids.has(ev.eid)) return
      this.seenEids.add(ev.eid)
      if (this.seenEids.size > 20000) this.seenEids.clear()
    }
    // Run boundary handling.
    if (this.awaitingRun) {
      this.awaitingRun = false
      this.h.onRunBoundary()
    }
    const run = ev.runId
    if (run && run !== this.activeRunId) {
      if (this.activeRunId != null) this.h.onRunBoundary()
      this.activeRunId = run
    }
    this.h.onEvent(ev)
  }

  private onStreamClosed(sid: string) {
    if (this.subSid != null && this.subSid !== sid) return
    // The connection is down: surface the reconnect banner until it recovers.
    this.h.onDisconnected()
    // Converge to idle if the stream ended without a terminal event.
    this.h.onStreamClosed()
    if (sid !== this.h.getSessionId()) return
    // Retry FOREVER (WeChat-style): the banner stays until the server is back.
    // The backoff is capped, so this is a bounded-rate poll, not a storm.
    const delay = Math.min(
      SessionStream.MAX_RECONNECT_MS,
      SessionStream.INITIAL_RECONNECT * 2 ** this.reconnectAttempt,
    )
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => this.connect(sid), delay)
  }

  /**
   * Detect a HALF-OPEN per-session stream and force a reconnect. When the
   * session is believed busy but no stream event has arrived for
   * STREAM_STALE_MS, the stream may be dead WITHOUT an error (a dropped socket
   * or a server-side ordered consumer that stopped yielding) — so
   * `onStreamClosed` never fires and the client waits forever. Tear it down and
   * reconnect; the new subscription replays from the tip anchor (eid dedup
   * makes the overlap harmless). This is what lets a mailbox-drained
   * continuation surface without a manual page refresh.
   *
   * `lastStreamEventAt` is reset on every reconnect, so a genuinely long quiet
   * tool reconnects at most once per STREAM_STALE_MS — bounded and safe.
   */
  private startWatchdog() {
    this.watchdogTimer && clearInterval(this.watchdogTimer)
    this.watchdogTimer = setInterval(() => {
      if (!this.h.isSending()) return
      if (Date.now() - this.lastStreamEventAt < SessionStream.STREAM_STALE_MS)
        return
      const sid = this.subSid ?? this.h.getSessionId()
      if (!sid || sid !== this.h.getSessionId()) return
      void this.recoverStaleStream(sid)
    }, SessionStream.WATCHDOG_EVERY)
  }

  /**
   * Decide whether a silent stream is dead and reconnect if so.
   *
   * A unary `State` over the SAME connection is the discriminator:
   *  - it hangs/errors  → the transport is half-open (dead socket): reconnect
   *    immediately, resetting the backoff budget (liveness, not a crash loop).
   *  - it answers idle  → the turn finished but its terminal event was lost:
   *    converge and pull the delta.
   *  - it answers busy  → the transport is healthy but the ordered consumer
   *    stopped yielding (or a genuinely quiet long tool). Reconnect anyway —
   *    replay-from-anchor + eid dedup make it harmless — but rate-limit to one
   *    attempt per HEALTHY_RECONNECT_COOLDOWN_MS so a quiet tool cannot cause
   *    a reconnect storm.
   */
  private async recoverStaleStream(sid: string): Promise<void> {
    if (this.probing) return
    this.probing = true
    try {
      const probe = await Promise.race([
        this.api
          .state(sid)
          .then(([st]) =>
            st === 'busy' || st === 'running'
              ? ('busy' as const)
              : ('idle' as const),
          )
          .catch(() => 'dead' as const),
        new Promise<'timeout'>(r =>
          setTimeout(() => r('timeout'), SessionStream.PROBE_TIMEOUT_MS),
        ),
      ])
      // A fresh event may have landed while probing: stand down.
      if (Date.now() - this.lastStreamEventAt < SessionStream.STREAM_STALE_MS)
        return
      if (sid !== this.h.getSessionId()) return
      if (probe === 'idle') {
        this.h.onIdle()
        return
      }
      const now = Date.now()
      if (
        probe === 'busy' &&
        now - this.lastRecoveryAt < SessionStream.HEALTHY_RECONNECT_COOLDOWN_MS
      ) {
        return
      }
      this.lastRecoveryAt = now
      this.reconnectAttempt = 0
      this.lastStreamEventAt = now
      this.streamAbort?.abort()
      this.connect(sid)
    } finally {
      this.probing = false
    }
  }

  private startIdleProbe() {
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = setInterval(() => {
      if (Date.now() - this.lastActivity < SessionStream.IDLE_PROBE_EVERY)
        return
      this.api
        .state(this.h.getSessionId())
        .then(([st]) => {
          // A successful unary over the same connection proves it is healthy,
          // so an idle session (no stream events) still clears the banner.
          this.h.onConnected()
          if (st === 'busy' || st === 'running') {
            this.h.onBusy()
          } else {
            // Idle on the server: converge and PULL anything the stream missed
            // (a half-open window can swallow the final turn-complete).
            this.h.onIdle()
          }
        })
        .catch(() => {})
    }, SessionStream.IDLE_PROBE_EVERY)
  }
}
