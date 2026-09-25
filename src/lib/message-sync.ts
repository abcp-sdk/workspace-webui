// MessageSync — everything that reconciles the reactive store with the
// authoritative server chain: local-first hydrate, incremental sync (tip
// anchor), full baseline, paged fetch and the post-turn reconcile. It owns the
// sync anchors (tip/oldest) and the local-store mirror; it knows nothing about
// the live stream (MessagesController owns that and calls in here).
import type { AgentApi } from './api'
import type { LocalStore } from './db'
import { mapMessagesToChat } from './message-mapping'
import type { MessageStore } from './message-store.svelte'

export class MessageSync {
  /** Newest server message id we hold — the stream anchor and delta cursor. */
  syncedTipId = ''
  /** Oldest cached message id, to validate the local mirror before trusting it. */
  syncedOldestId = ''

  constructor(
    private api: AgentApi,
    private getSessionId: () => string,
    private local: LocalStore | null,
    private store: MessageStore,
  ) {}

  /**
   * Persist the in-memory window as the local mirror, UNLESS the reader has
   * scrolled away from the tail (`hasNewer`): the mirror then keeps the last
   * tail-following snapshot, so reopening the session shows the newest history
   * (IM behaviour) rather than a stale mid-history window.
   */
  private async persistWindow(sid: string): Promise<void> {
    const l = this.local
    if (!l || this.store.hasNewer) return
    await l.persistMessages(
      sid,
      this.store.messages,
      this.syncedTipId,
      this.store.hasMore,
    )
    this.syncedOldestId = await l.oldestCachedId(sid)
  }

  /** Seed the store from the local mirror (best-effort; network-only on miss). */
  async hydrate(sid: string): Promise<void> {
    const l = this.local
    if (!l) return
    try {
      const cached = await l.loadMessages(sid)
      // Only trust a stored anchor when we actually hold cached messages.
      this.syncedTipId = cached.length ? await l.serverTipId(sid) : ''
      this.syncedOldestId = cached.length ? await l.oldestCachedId(sid) : ''
      if (cached.length) {
        this.store.messages = [...cached, ...this.store.inFlightLocal()]
        this.store.renumber()
        // Restore the server's "older history exists" flag so IM scroll-up
        // works immediately, before the first network sync lands.
        this.store.hasMore = await l.hasMore(sid)
        // Seed the durable todo list from the cached window (a fresh hydrate
        // is at the tail, so its newest todo-write is authoritative).
        this.store.refreshTodosFromWindow()
        this.store.notify()
      }
    } catch {
      /* cache unreadable — fall through network-only */
    }
  }

  /** Incremental when we hold an anchor, else a baseline fetch. */
  async sync(sid: string): Promise<void> {
    const l = this.local
    this.store.loading = this.store.messages.length === 0
    this.store.notify()
    try {
      const cacheConsistent =
        this.store.messages.length === 0 ||
        (this.syncedTipId !== '' &&
          this.syncedOldestId !== '' &&
          (await l?.oldestCachedId(sid)) === this.syncedOldestId)
      if (l && this.syncedTipId && cacheConsistent) {
        const r = await this.api.messagesAfter(sid, this.syncedTipId)
        if (r.resync) {
          await this.baseline(sid)
        } else if (
          r.messages.length === 0 &&
          this.store.messages.length === 0
        ) {
          await this.baseline(sid)
        } else {
          // Adopt todos from the DELTA only (these rows are newer than the
          // window), before the merge/trim — so a scrolled-up reader still gets
          // the newest checklist without the window rolling it back.
          this.store.adoptTodosFrom(mapMessagesToChat(r.messages))
          this.store.mergeServer(r.messages)
          this.syncedTipId = r.tipId
          // A scrolled-up reader stays where they are: newer rows are tracked
          // in the anchor but trimmed off the visible window. A tail-follower
          // keeps the newest and drops the oldest instead.
          this.store.trimHistory(!this.store.hasNewer)
          await this.persistWindow(sid)
        }
      } else {
        await this.baseline(sid)
      }
    } catch {
      /* offline: keep whatever the local cache showed */
    }
    this.store.loading = false
    this.store.notify()
  }

  /** Full baseline: the newest page, replacing any cached copy. */
  async baseline(sid: string): Promise<void> {
    try {
      const [msgs, more] = await this.api.messages(sid, undefined, 50)
      const chat = mapMessagesToChat(msgs)
      this.store.messages = [
        ...this.store.inFlightLocal(),
        ...this.store.errors,
        ...chat,
      ]
      this.store.renumber()
      this.store.hasMore = more
      // A fresh tail load: we are following the newest again.
      this.store.hasNewer = false
      // The window is tail-consistent: its newest todo-write is authoritative.
      this.store.refreshTodosFromWindow()
      const l = this.local
      if (l) {
        this.syncedTipId = chat.length ? chat[chat.length - 1]!.id : ''
        await l.applyServerMessages(sid, msgs, {
          replace: true,
          tipId: this.syncedTipId,
          hasMore: more,
        })
        this.syncedOldestId = await l.oldestCachedId(sid)
      }
    } catch {
      /* keep the existing cache */
    }
  }

  /** Page of older messages (IM-style scroll-up). */
  async fetch(before?: string): Promise<void> {
    this.store.loading = true
    this.store.notify()
    try {
      const sid = this.getSessionId()
      const [msgs, more] = await this.api.messages(sid, before, 50)
      const chat = mapMessagesToChat(msgs)
      if (before != null) {
        // Prepend older history. Then SLIDE the window: if we now exceed the
        // cap, drop the NEWEST rows (they stay on the server) and flag that
        // newer history exists — the reader follows the older page they asked
        // for instead of the list growing without bound.
        const existing = new Set(this.store.messages.map(m => m.id))
        this.store.messages = [
          ...chat.filter(m => !existing.has(m.id)),
          ...this.store.messages,
        ]
        this.store.renumber()
        this.store.hasMore = more
        if (this.store.trimHistory(false)) this.store.hasNewer = true
      } else {
        // No cursor: (re)load the newest page and follow the tail again.
        this.store.messages = [
          ...this.store.inFlightLocal(),
          ...this.store.errors,
          ...chat,
        ]
        this.store.renumber()
        this.store.hasMore = more
        this.store.hasNewer = false
      }
    } catch {
      /* keep current view */
    }
    this.store.loading = false
    this.store.notify()
    if (this.local) {
      try {
        await this.persistWindow(this.getSessionId())
      } catch {
        /* ignore */
      }
    }
  }

  /** After a turn completes (or a message-added nudge), pull the server delta
   *  and adopt real ids. Works without a local store: the merge is in-memory
   *  and persistence is simply skipped. */
  async reconcile(): Promise<void> {
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
      this.store.adoptTodosFrom(mapMessagesToChat(r.messages))
      this.store.mergeServer(r.messages)
      this.syncedTipId = r.tipId
      this.store.trimHistory(!this.store.hasNewer)
      this.store.notify()
      if (l) {
        await this.persistWindow(sid)
      }
    } catch {
      /* offline reconcile retry on next turn */
    }
  }
}
