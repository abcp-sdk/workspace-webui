// MessagesController — the web port of flutter/lib/messages.dart (Svelte 5
// runes). Local-first boot (sqlite mirror) → incremental sync (tip anchor) →
// one long-lived watchSession stream per active session with exponential
// backoff reconnect, eid dedup and run boundaries.
import type { AgentApi } from './api'
import type { LocalStore } from './db'
import type { StreamEvent } from './events'
import { compareMessages, orderMessages } from './message-order'
import type {
  ChatMessage,
  ChatPart,
  Message,
  ToolState,
  UploadedFile,
} from './models'

type SessionListener = (event: string, params: Record<string, unknown>) => void

export function mapMessagesToChat(msgs: Message[]): ChatMessage[] {
  return msgs.map((m, i) => ({
    id: m.id,
    role: m.role,
    status: 'complete' as const,
    createdAt: m.createdAt ?? '',
    seq: i,
    isLocal: false,
    prevId: m.prevId,
    parts: m.parts.map(p => ({
      id: p.id || `p${Date.now()}${i}`,
      type: p.type,
      text: p.text ?? '',
      tool: p.tool ?? '',
      state: p.state ?? null,
      code: p.code ?? null,
      name: p.name ?? null,
      mime: p.mime ?? null,
      size: p.size ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      durationMs: p.durationMs ?? null,
      thumbCode: p.thumbCode ?? null,
      thumbhash: p.thumbhash ?? null,
    })),
  }))
}

// Re-export the pure ordering helpers for callers that only import this module.
export { compareMessages, orderMessages }

export class MessagesController {
  private api: AgentApi
  private getSessionId: () => string
  private local: LocalStore | null

  messages = $state<ChatMessage[]>([])
  sending = $state(false)
  loading = $state(false)
  hasMore = $state(false)

  /** PENDING (unconsumed) mailbox entries for the open session — drives the
   *  red badge on the top-bar mailbox button. Refreshed on boot, after a
   *  delivery, and whenever the chain advances (a drained entry is consumed). */
  pendingMailbox = $state(0)

  /** Bumped after every mutation so the UI can react via $effect. */
  revision = $state(0)

  private syncedTipId = ''
  private syncedOldestId = ''

  private streamAbort: AbortController | null = null
  /** Local ERROR bubbles are not server chain members; keep them across
   *  authoritative refreshes (mergeServer/fetchMessages) instead of dropping
   *  them. Cleared per session in init. */
  private localErrors: ChatMessage[] = []
  private nextSeq = 1_000_000
  private sessionListeners: SessionListener[] = []

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private subSid: string | null = null

  private seenEids = new Set<string>()
  private activeRunId: string | null = null
  private awaitingRun = false
  /** Server-authored id of a message whose streaming step is in flight. The
   *  delta router reads this; `message-added{streaming:true}` sets it, and a
   *  new step (or turn end) replaces/clears it. */
  private streamingId: string | null = null
  /** True while a send RPC is in flight (from submit to `accepted`). Drives the
   *  composer spinner only; the user bubble itself appears from the server's
   *  `message-added` event. */
  awaitingSend = $state(false)

  private static MAX_RECONNECT = 10
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
  private idleProbeTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = Date.now()
  /** Wall-clock of the last event RECEIVED on the per-session stream. */
  private lastStreamEventAt = Date.now()
  private lastRecoveryAt = 0
  private probing = false

  private sendFailedMsg = (e: unknown): string => `send failed: ${e}`

  constructor(
    api: AgentApi,
    getSessionId: () => string,
    local: LocalStore | null,
    opts?: { sendFailed?: (e: unknown) => string },
  ) {
    this.api = api
    this.getSessionId = getSessionId
    this.local = local
    if (opts?.sendFailed) this.sendFailedMsg = opts.sendFailed
  }

  get sorted(): ChatMessage[] {
    return [...this.messages].sort(compareMessages)
  }

  onSessionEvent(cb: SessionListener): () => void {
    this.sessionListeners.push(cb)
    return () => {
      this.sessionListeners = this.sessionListeners.filter(x => x !== cb)
    }
  }

  private allocSeq(): number {
    return this.nextSeq++
  }

  private notify() {
    this.revision++
  }

  /** Only the LOCAL bubbles still in flight. */
  private inFlightLocal(): ChatMessage[] {
    return this.messages.filter(
      m => m.isLocal && (m.status === 'streaming' || m.status === 'sending'),
    )
  }

  private bumpSeqAfter(history: ChatMessage[]) {
    let maxSeq = -1
    for (const m of history) {
      if (m.seq != null && m.seq < this.nextSeq && m.seq > maxSeq)
        maxSeq = m.seq
    }
    if (maxSeq >= 0) this.nextSeq = maxSeq + 1
  }

  init() {
    this.localErrors = []
    const sid = this.getSessionId()
    if (!sid) return
    void this.boot(sid)
  }

  private async boot(sid: string) {
    await this.hydrateFromLocal(sid)
    await this.sync(sid)
    await this.recover()
    this.connect(sid)
    void this.refreshMailbox()
  }

  /** Count the session's PENDING (unconsumed) mailbox entries for the badge.
   *  Best-effort: a transient error keeps the last known count. */
  async refreshMailbox(): Promise<void> {
    const sid = this.getSessionId()
    if (!sid) {
      this.pendingMailbox = 0
      return
    }
    try {
      // Newest page only: pending entries are the most recent, so the badge
      // reads correctly without paging the whole queue.
      const { entries } = await this.api.mailbox(sid)
      this.pendingMailbox = entries.filter(e => e.status !== 'consumed').length
    } catch {
      /* keep the previous count */
    }
  }

  /** Send a prompt (mailbox-only, whether the session is idle or busy).
   *
   *  The composer spins only while the send RPC is in flight; it stops as soon
   *  as the server ACCEPTS the prompt, i.e. the message is durably enqueued in
   *  the mailbox. It must NOT wait for `message-added{role:user}`: the agent
   *  only persists the row when the running turn next drains the mailbox (a
   *  step boundary), which can be minutes into a long model call or tool — the
   *  send is already complete at `accepted`. The user bubble still appears from
   *  `message-added` (server-driven id/position); never a client-optimistic
   *  row. */
  async deliver(text: string, attachments: UploadedFile[] = []): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed && !attachments.length) return
    const codes = attachments.map(a => a.code)
    this.awaitingSend = true
    this.notify()
    try {
      // Resolves on the server's `accepted` event = durably in the mailbox.
      await this.api.prompt(this.getSessionId(), trimmed, codes)
      this.awaitingSend = false
      this.notify()
    } catch (e) {
      this.addError(this.sendFailedMsg(e))
      this.awaitingSend = false
      this.notify()
      throw e
    }
  }

  private async hydrateFromLocal(sid: string) {
    const l = this.local
    if (!l) return
    try {
      const cached = await l.loadMessages(sid)
      // Only trust a stored anchor when we actually hold cached messages.
      this.syncedTipId = cached.length ? await l.serverTipId(sid) : ''
      this.syncedOldestId = cached.length ? await l.oldestCachedId(sid) : ''
      if (cached.length) {
        this.messages = [...cached, ...this.inFlightLocal()]
        this.renumber()
        this.notify()
      }
    } catch {
      /* cache unreadable — fall through network-only */
    }
  }

  /** Incremental when we hold an anchor, else a baseline fetch. */
  private async sync(sid: string) {
    const l = this.local
    this.loading = this.messages.length === 0
    this.notify()
    try {
      const cacheConsistent =
        this.messages.length === 0 ||
        (this.syncedTipId !== '' &&
          this.syncedOldestId !== '' &&
          (await l?.oldestCachedId(sid)) === this.syncedOldestId)
      if (l && this.syncedTipId && cacheConsistent) {
        const r = await this.api.messagesAfter(sid, this.syncedTipId)
        if (r.resync) {
          await this.baseline(sid)
        } else if (r.messages.length === 0 && this.messages.length === 0) {
          await this.baseline(sid)
        } else {
          this.mergeServer(r.messages, r.tipId)
          await l.persistMessages(sid, this.messages, r.tipId)
        }
      } else {
        await this.baseline(sid)
      }
    } catch {
      /* offline: keep whatever the local cache showed */
    }
    this.loading = false
    this.notify()
  }

  /** Full baseline: the newest page, replacing any cached copy. */
  private async baseline(sid: string) {
    try {
      const [msgs, more] = await this.api.messages(sid, undefined, 50)
      const chat = mapMessagesToChat(msgs)
      this.messages = [...this.inFlightLocal(), ...this.localErrors, ...chat]
      this.renumber()
      this.hasMore = more
      const l = this.local
      if (l) {
        this.syncedTipId = chat.length ? chat[chat.length - 1]!.id : ''
        await l.applyServerMessages(sid, msgs, {
          replace: true,
          tipId: this.syncedTipId,
        })
        this.syncedOldestId = await l.oldestCachedId(sid)
      }
    } catch {
      /* keep the existing cache */
    }
  }

  /** Merge a server delta into memory. ASSISTANT messages are server-authored
   *  (id and `prev_id` come from `message-added`), so a delta is an in-place
   *  update by id — no client-side id invention, no anchor guessing. Local
   *  error bubbles and the in-flight streamed bubble are preserved. */
  private mergeServer(msgs: Message[], tipId: string) {
    const chat = mapMessagesToChat(msgs)
    // Preserve: local error bubbles, and the LIVE streamed bubble (the server
    // copy of a step only lands AFTER its stream ends; until then the local
    // streaming row is the only copy and must survive the merge).
    const streaming =
      this.messages.find(m => m.isLocal && m.id === this.streamingId) ?? null
    const byId = new Map<string, ChatMessage>()
    for (const m of this.messages) {
      if (m.isLocal) continue
      byId.set(m.id, m)
    }
    for (const m of chat) byId.set(m.id, m)
    if (streaming !== null && !byId.has(streaming.id))
      byId.set(streaming.id, streaming)
    for (const m of this.localErrors) byId.set(`err:${m.id}`, m)
    // Once the server holds the live step's id, the stream is over and the
    // server row supersedes our local copy (drop the flag).
    if (this.streamingId != null && byId.has(this.streamingId)) {
      const s = byId.get(this.streamingId)!
      if (!s.isLocal) this.streamingId = null
    }
    this.messages = [...byId.values()]
    this.renumber()
    this.syncedTipId = tipId
  }

  /** Re-seat `seq` from the authoritative ordering (see [orderMessages]). */
  private renumber() {
    this.messages = orderMessages(this.messages)
    this.bumpSeqAfter(this.messages)
  }

  private async fetchMessages(before?: string) {
    this.loading = true
    this.notify()
    try {
      const sid = this.getSessionId()
      const [msgs, more] = await this.api.messages(sid, before, 50)
      const chat = mapMessagesToChat(msgs)
      if (before != null) {
        const existing = new Set(this.messages.map(m => m.id))
        this.messages = [
          ...chat.filter(m => !existing.has(m.id)),
          ...this.messages,
        ]
      } else {
        this.messages = [...this.inFlightLocal(), ...this.localErrors, ...chat]
      }
      this.renumber()
      this.hasMore = more
    } catch {
      /* keep current view */
    }
    this.loading = false
    this.notify()
    const l = this.local
    if (l) {
      try {
        await l.persistMessages(
          this.getSessionId(),
          this.messages,
          this.syncedTipId,
        )
        this.syncedOldestId = await l.oldestCachedId(this.getSessionId())
      } catch {
        /* ignore */
      }
    }
  }

  private async recover() {
    // A busy session is reconstructed from the stream itself: replay delivers
    // the live step's `message-added{streaming:true}` (with its server id) plus
    // its deltas, so no client-invented placeholder is needed here.
    try {
      const [status] = await this.api.state(this.getSessionId())
      if (status === 'busy' || status === 'running') {
        this.sending = true
        this.notify()
      }
    } catch {
      /* offline */
    }
  }

  private connect(sid: string) {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.streamAbort?.abort()
    const ac = new AbortController()
    this.streamAbort = ac
    this.subSid = sid
    this.reconnectAttempt = 0
    this.lastActivity = Date.now()
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    // Run boundary: the FIRST event of the new connection resets stale
    // streaming state; replay rebuilds it cleanly.
    this.seenEids.clear()
    this.activeRunId = null
    this.awaitingRun = true
    this.lastStreamEventAt = Date.now()
    void (async () => {
      try {
        for await (const ev of this.api.streamEvents(
          sid,
          this.syncedTipId,
          ac.signal,
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
      if (!this.sending) return
      if (
        Date.now() - this.lastStreamEventAt <
        MessagesController.STREAM_STALE_MS
      )
        return
      const sid = this.subSid ?? this.getSessionId()
      if (!sid || sid !== this.getSessionId()) return
      void this.recoverStaleStream(sid)
    }, MessagesController.WATCHDOG_EVERY)
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
          setTimeout(() => r('timeout'), MessagesController.PROBE_TIMEOUT_MS),
        ),
      ])
      // A fresh event may have landed while probing: stand down.
      if (
        Date.now() - this.lastStreamEventAt <
        MessagesController.STREAM_STALE_MS
      )
        return
      if (sid !== this.getSessionId()) return
      if (probe === 'idle') {
        this.syncIdle()
        void this.reconcile()
        return
      }
      const now = Date.now()
      if (
        probe === 'busy' &&
        now - this.lastRecoveryAt <
          MessagesController.HEALTHY_RECONNECT_COOLDOWN_MS
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

  /** A run ended (or a new one began): drop any still-streaming local bubble.
   *  Streamed assistant bubbles are server-authored (their id is a real server
   *  id), so if the server already holds that row `mergeServer` keeps it; an
   *  orphan (never persisted) is removed here. */
  private clearStreaming() {
    if (this.streamingId != null) {
      const id = this.streamingId
      this.messages = this.messages.filter(m => !(m.isLocal && m.id === id))
      this.streamingId = null
    }
    this.activeRunId = null
  }

  private onStreamClosed(sid: string) {
    if (this.subSid != null && this.subSid !== sid) return
    this.syncIdle()
    if (sid !== this.getSessionId()) return
    if (this.reconnectAttempt >= MessagesController.MAX_RECONNECT) return
    const delay = Math.min(
      MessagesController.MAX_RECONNECT_MS,
      MessagesController.INITIAL_RECONNECT * 2 ** this.reconnectAttempt,
    )
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => this.connect(sid), delay)
  }

  private startIdleProbe() {
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = setInterval(() => {
      if (Date.now() - this.lastActivity < MessagesController.IDLE_PROBE_EVERY)
        return
      this.api
        .state(this.getSessionId())
        .then(([st]) => {
          if (st === 'busy' || st === 'running') {
            if (!this.sending) {
              this.sending = true
              this.notify()
            }
          } else {
            // Idle on the server: converge and PULL anything the stream missed
            // (a half-open window can swallow the final turn-complete).
            this.syncIdle()
            void this.reconcile()
          }
        })
        .catch(() => {})
    }, MessagesController.IDLE_PROBE_EVERY)
  }

  /** Converge to idle if the stream ended without a terminal event. */
  private syncIdle() {
    if (!this.sending) return
    this.finishStreaming()
  }

  private handleEvent(ev: StreamEvent) {
    this.lastActivity = Date.now()
    // Dedup across the subscribe/replay overlap.
    if (ev.eid) {
      if (this.seenEids.has(ev.eid)) return
      this.seenEids.add(ev.eid)
      if (this.seenEids.size > 20000) this.seenEids.clear()
    }
    // Run boundary handling.
    if (this.awaitingRun) {
      this.awaitingRun = false
      this.clearStreaming()
    }
    const run = ev.runId
    if (run && run !== this.activeRunId) {
      if (this.activeRunId != null) this.clearStreaming()
      this.activeRunId = run
    }
    for (const cb of this.sessionListeners) {
      try {
        cb(ev.event, ev.params)
      } catch {
        /* listener errors are not fatal */
      }
    }
    const { event, params } = ev
    // Every streamed part belongs to the assistant step named by its
    // server-authored `message_id` (stamped by the agent on each part). Route
    // by that id; never invent one.
    const streamMsgId = (): string | null => {
      const id = params['message_id']
      return typeof id === 'string' && id !== '' ? id : this.streamingId
    }
    switch (event) {
      case 'start-step':
      case 'text-start':
      case 'reasoning-start':
      case 'tool-input-start': {
        const sid = streamMsgId()
        if (sid == null) break
        this.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
        if (event === 'text-start' && params['id'] != null) {
          this.ensurePart(sid, params['id'] as string, 'text')
        } else if (event === 'reasoning-start' && params['id'] != null) {
          this.ensurePart(sid, `r${params['id']}`, 'reasoning')
        } else if (event === 'tool-input-start' && params['id'] != null) {
          this.startToolPart(
            sid,
            params['id'] as string,
            (params['toolName'] ?? params['name'] ?? 'tool') as string,
          )
        }
        break
      }
      case 'tool-input-delta': {
        if (params['id'] != null && params['delta'] != null) {
          this.appendToolInput(
            params['id'] as string,
            String(params['delta'] ?? ''),
          )
        }
        break
      }
      case 'text-delta':
        if (params['id'] != null && params['text'] != null) {
          const sid = streamMsgId()
          if (sid == null) break
          this.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
          this.appendDelta(
            sid,
            params['id'] as string,
            String(params['text'] ?? ''),
            false,
          )
        }
        break
      case 'reasoning-delta':
        if (params['id'] != null && params['text'] != null) {
          const sid = streamMsgId()
          if (sid == null) break
          this.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
          this.appendDelta(
            sid,
            `r${params['id']}`,
            String(params['text'] ?? ''),
            true,
          )
        }
        break
      case 'tool-call': {
        const sid = streamMsgId()
        if (sid == null) break
        this.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
        const tcId = (params['toolCallId'] ?? params['id']) as
          | string
          | undefined
        if (tcId != null) {
          this.addToolPart(
            sid,
            tcId,
            (params['toolName'] ?? params['name'] ?? 'tool') as string,
            params['input'],
          )
        }
        break
      }
      case 'tool-result': {
        const tcId = (params['toolCallId'] ?? params['id']) as
          | string
          | undefined
        if (tcId == null) break
        this.updateToolResult(
          tcId,
          params['formatted'] ?? params['output'] ?? params['result'],
          {
            errorMsg: undefined,
            changeId: params['change_id'] as string | undefined,
            diff: params['diff'] as string | undefined,
            additions: params['additions'] as number | undefined,
            deletions: params['deletions'] as number | undefined,
            data: (params['data'] as Record<string, unknown>) ?? undefined,
          },
        )
        break
      }
      case 'tool-error': {
        const tcId = (params['toolCallId'] ?? params['id']) as
          | string
          | undefined
        const errObj = params['error']
        const errMsg = (
          typeof errObj === 'string'
            ? errObj
            : errObj && typeof errObj === 'object'
              ? ((errObj as Record<string, unknown>)['message'] ??
                params['message'] ??
                'tool error')
              : (params['message'] ?? 'tool error')
        ) as string
        if (tcId != null)
          this.updateToolResult(tcId, null, { errorMsg: errMsg })
        break
      }
      case 'tool-output-denied': {
        const tcId = (params['toolCallId'] ?? params['id']) as
          | string
          | undefined
        if (tcId != null)
          this.updateToolResult(tcId, null, { errorMsg: 'denied' })
        break
      }
      case 'file':
      case 'reasoning-file': {
        // A streamed media part the agent has already offloaded to the blob
        // store; `code` is the file:<code> segment. Render it as a file part
        // (same path as persisted file parts). Both `file` and
        // `reasoning-file` are shown.
        const code = params['code'] as string | undefined
        if (code == null || code === '') break
        const sid = streamMsgId()
        if (sid == null) break
        this.ensureStreamingMsg(sid, params['prev_id'] as string | undefined)
        const partId = `f${code}`
        const existing = this.messages
          .find(m => m.id === sid)
          ?.parts.some(p => p.id === partId)
        if (!existing) {
          this.setMsg(sid, m => ({
            ...m,
            parts: [
              ...m.parts,
              {
                id: partId,
                type: 'file',
                text: '',
                tool: '',
                code,
                name: (params['name'] as string | undefined) ?? null,
                mime: (params['mediaType'] as string | undefined) ?? null,
                size: params['size'] != null ? Number(params['size']) : null,
                width: params['width'] != null ? Number(params['width']) : null,
                height:
                  params['height'] != null ? Number(params['height']) : null,
                durationMs:
                  params['durationMs'] != null
                    ? Number(params['durationMs'])
                    : params['duration_ms'] != null
                      ? Number(params['duration_ms'])
                      : null,
                thumbCode:
                  (params['thumbCode'] as string | undefined) ??
                  (params['thumb_code'] as string | undefined) ??
                  null,
                thumbhash: (params['thumbhash'] as string | undefined) ?? null,
              },
            ],
          }))
        }
        break
      }
      case 'turn-complete':
        this.finishStreaming()
        void this.refreshMailbox()
        break
      case 'message-added': {
        // The server authored this message's id and chain anchor. This is the
        // ONLY place user bubbles are created (no client-side optimistic
        // bubble): a user_prompt shows up here once the agent has drained the
        // mailbox and written the chain row. `streaming:true` opens the
        // assistant step's bubble; its deltas then arrive under the same id.
        const addedId =
          typeof params['message_id'] === 'string' ? params['message_id'] : ''
        const prevId =
          typeof params['prev_id'] === 'string' ? params['prev_id'] : ''
        const role =
          typeof params['role'] === 'string' ? params['role'] : 'assistant'
        const streaming = params['streaming'] === true
        if (addedId !== '') {
          if (streaming && role === 'assistant') {
            // A new step begins: any PRIOR streaming bubble is done (the server
            // persists one message per step and has moved on).
            const prevStream = this.streamingId
            if (prevStream != null && prevStream !== addedId) {
              this.messages = this.messages.map(m =>
                m.id === prevStream && m.status === 'streaming'
                  ? { ...m, status: 'complete' as const }
                  : m,
              )
            }
            this.streamingId = addedId
            this.ensureStreamingMsg(addedId, prevId)
          } else if (role === 'user') {
            // The prompt was persisted into the chain: render the user bubble
            // with the server-authored id/position. (The composer spinner is
            // unrelated — it already stopped at `accepted`.)
            this.upsertServerMessage(addedId, prevId, 'user')
          }
        }
        this.notify()
        void this.reconcile()
        // A drained user_prompt is now CONSUMED, so the pending badge shrinks.
        void this.refreshMailbox()
        break
      }
      case 'chain-changed':
        this.clearStreaming()
        this.sending = false
        this.notify()
        void this.fetchMessages()
        break
      case 'status': {
        const stype = params['type']
        if (stype === 'busy' || stype === 'running') {
          this.sending = true
          this.notify()
        } else {
          this.finishStreaming()
        }
        break
      }
      case 'error':
      case 'provider-error': {
        const errObj = params['error']
        const content = (
          typeof errObj === 'string'
            ? errObj
            : errObj && typeof errObj === 'object'
              ? ((errObj as Record<string, unknown>)['message'] ??
                params['message'] ??
                'Unknown error')
              : (params['message'] ?? 'Unknown error')
        ) as string
        this.addError(content)
        this.sending = false
        this.notify()
        break
      }
      default:
        break
    }
  }

  /** Ensure a streamed assistant bubble exists under the SERVER-authored id.
   *  No id is minted here; `id` comes from `message-added`/the delta's
   *  `message_id`, and `prevId` is the server's `prev_id` (known at step
   *  start). Reuses the existing bubble if present (a delta may arrive before
   *  the formal `message-added{streaming:true}` on replay). */
  private ensureStreamingMsg(id: string, prevId?: string): string {
    const existing = this.messages.find(m => m.id === id)
    if (existing) {
      if (!existing.isLocal) return id
      if (existing.status === 'streaming') return id
      // Was finalized by a previous step's boundary; reopen it.
      this.messages = this.messages.map(m =>
        m.id === id ? { ...m, status: 'streaming' as const } : m,
      )
      return id
    }
    this.streamingId = id
    this.messages = [
      ...this.messages,
      {
        id,
        role: 'assistant',
        status: 'streaming',
        parts: [],
        createdAt: new Date().toISOString(),
        isLocal: true,
        prevId: prevId ?? '',
        seq: this.allocSeq(),
      },
    ]
    return id
  }

  /** Create a minimal server-authored bubble (used for a user message whose
   *  full body is fetched by the following `reconcile`). */
  private upsertServerMessage(id: string, prevId: string, role: string): void {
    if (this.messages.some(m => m.id === id)) return
    this.messages = [
      ...this.messages,
      {
        id,
        role,
        status: 'complete',
        parts: [],
        createdAt: new Date().toISOString(),
        isLocal: false,
        prevId,
        seq: this.allocSeq(),
      },
    ]
  }

  private setMsg(id: string, fn: (m: ChatMessage) => ChatMessage) {
    const idx = this.messages.findIndex(m => m.id === id)
    if (idx < 0) return
    this.messages[idx] = fn(this.messages[idx]!)
    this.notify()
  }

  private ensurePart(msgId: string, partId: string, type: string) {
    this.setMsg(msgId, m =>
      m.parts.some(p => p.id === partId)
        ? m
        : {
            ...m,
            parts: [...m.parts, { id: partId, type, text: '', tool: '' }],
          },
    )
  }

  private appendDelta(
    msgId: string,
    partId: string,
    delta: string,
    reasoning: boolean,
  ) {
    this.setMsg(msgId, m => {
      const pidx = m.parts.findIndex(p => p.id === partId)
      const parts = [...m.parts]
      if (pidx >= 0) {
        parts[pidx] = { ...parts[pidx]!, text: parts[pidx]!.text + delta }
      } else {
        parts.push({
          id: partId,
          type: reasoning ? 'reasoning' : 'text',
          text: delta,
          tool: '',
        })
      }
      return { ...m, parts }
    })
  }

  /** Create the tool part as soon as argument streaming begins. */
  private startToolPart(msgId: string, partId: string, name: string) {
    this.setMsg(msgId, m => {
      if (m.parts.some(p => p.id === partId)) return m
      const state: ToolState = { status: 'running', title: name, inputText: '' }
      const part: ChatPart = {
        id: partId,
        type: 'tool',
        text: '',
        tool: name,
        state,
      }
      return { ...m, parts: [...m.parts, part] }
    })
  }

  /** Accumulate streamed tool-argument JSON for the live preview. */
  private appendToolInput(partId: string, delta: string) {
    const sid = this.streamingId
    if (!sid) return
    this.setMsg(sid, m => {
      const parts = m.parts.map(p => {
        if (p.id !== partId) return p
        const old: ToolState = p.state ?? { status: '', title: '' }
        return {
          ...p,
          state: { ...old, inputText: (old.inputText ?? '') + delta },
        }
      })
      return { ...m, parts }
    })
  }

  private addToolPart(
    msgId: string,
    partId: string,
    name: string,
    input: unknown,
  ) {
    const asMap =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : null
    const state: ToolState = { status: 'running', title: name, input: asMap }
    this.setMsg(msgId, m => {
      const pidx = m.parts.findIndex(p => p.id === partId)
      const parts = [...m.parts]
      const part: ChatPart = {
        id: partId,
        type: 'tool',
        text: '',
        tool: name,
        state,
      }
      if (pidx >= 0) parts[pidx] = part
      else parts.push(part)
      return { ...m, parts }
    })
  }

  private updateToolResult(
    partId: string,
    result: unknown,
    extra: {
      errorMsg?: string
      changeId?: string
      diff?: string
      additions?: number
      deletions?: number
      data?: Record<string, unknown>
    } = {},
  ) {
    const sid = this.streamingId
    if (!sid) return
    this.setMsg(sid, m => {
      const parts = m.parts.map(p => {
        if (p.id !== partId) return p
        const old = p.state ?? { status: '', title: '' }
        const output =
          typeof result === 'string'
            ? result
            : result == null
              ? null
              : pretty(result)
        return {
          ...p,
          state: {
            status: extra.errorMsg != null ? 'error' : 'complete',
            title: old.title,
            error: extra.errorMsg ?? old.error ?? null,
            input: old.input ?? null,
            output: output ?? old.output ?? null,
            data: extra.data ?? old.data ?? null,
            changeId: extra.changeId ?? old.changeId ?? null,
            diff: extra.diff ?? old.diff ?? null,
            additions: extra.additions ?? old.additions ?? null,
            deletions: extra.deletions ?? old.deletions ?? null,
          } satisfies ToolState,
        }
      })
      return { ...m, parts }
    })
  }

  private finishStreaming() {
    this.messages = this.messages.map(m =>
      m.status === 'streaming' ? { ...m, status: 'complete' as const } : m,
    )
    this.streamingId = null
    this.activeRunId = null
    this.sending = false
    this.notify()
    void this.reconcile()
  }

  /** After a turn completes (or a message-added nudge), pull the server delta
   *  and adopt real ids. Works without a local store: the merge is in-memory
   *  and persistence is simply skipped. */
  private async reconcile() {
    const l = this.local
    const sid = this.getSessionId()
    try {
      if (!this.syncedTipId) {
        await this.baseline(sid)
        return
      }
      const r = await this.api.messagesAfter(sid, this.syncedTipId)
      if (r.resync) {
        await this.baseline(sid)
        return
      }
      this.mergeServer(r.messages, r.tipId)
      this.notify()
      if (l) {
        await l.persistMessages(sid, this.messages, this.syncedTipId)
        this.syncedOldestId = await l.oldestCachedId(sid)
      }
    } catch {
      /* offline reconcile retry on next turn */
    }
  }

  private addError(text: string) {
    const now = Date.now()
    const err = {
      id: `err${now}`,
      role: 'error',
      status: 'error' as const,
      isLocal: true,
      parts: [{ id: `p${now}`, type: 'text' as const, text, tool: '' }],
      createdAt: new Date().toISOString(),
      prevId: '',
      seq: this.allocSeq(),
    }
    this.localErrors.push(err)
    this.messages = [...this.messages, err]
  }

  stop() {
    void this.api
      .interrupt(this.getSessionId())
      .then(() => this.finishStreaming())
  }

  async revert(messageId: string) {
    if (this.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    await this.api.revert(this.getSessionId(), messageId)
    this.clearStreaming()
    this.sending = false
    await this.fetchMessages()
  }

  /** Retry/Edit: withdraw a user message and everything after, then resend. */
  async resendFrom(msg: ChatMessage, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    const codes = msg.parts
      .filter(p => p.type === 'file')
      .map(p => p.code ?? '')
      .filter(c => !!c)
    await this.api.revert(this.getSessionId(), msg.id)
    this.clearStreaming()
    this.sending = false
    await this.fetchMessages()
    await this.deliver(
      trimmed,
      codes.map(code => ({ code, name: null, mime: null }) as UploadedFile),
    )
  }

  async loadMore() {
    if (!this.hasMore || this.loading) return
    const first = this.sorted[0]
    if (!first) return
    await this.fetchMessages(first.id)
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
  }
}

function pretty(o: unknown): string {
  if (typeof o === 'object' && o != null) return JSON.stringify(o, null, 2)
  return String(o)
}
