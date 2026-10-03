// MessageSync — reconciles the reactive store with the authoritative server
// chain: incremental sync (tip anchor), full baseline, paged fetch and the
// post-turn reconcile. It owns the in-memory sync anchors (tip/oldest) and knows
// nothing about the live stream (MessagesController owns that and calls in here).
//
// There is NO local message mirror: switching sessions always needs the network
// (the controller rebuilds + init()s per session, so a baseline fetch is
// unavoidable), so a mirror would only save the first frame while adding a
// second source of truth (hydrate + cache-consistency checks + a per-page
// DELETE+reinsert). The window lives purely in memory.
import type { AgentApi } from './api'
import { mapMessagesToChat } from './message-mapping'
import type { MessageStore } from './message-store.svelte'

export class MessageSync {
  /** Newest server message id we hold — the stream anchor and delta cursor. */
  syncedTipId = ''
  /** Oldest non-local message id in the current in-memory window. */
  syncedOldestId = ''

  constructor(
    private api: AgentApi,
    private getSessionId: () => string,
    private store: MessageStore,
  ) {}

  /** Recompute the in-memory oldest anchor from the current window. */
  private trackOldest(): void {
    const oldest = this.store.messages.find(m => !m.isLocal)
    this.syncedOldestId = oldest?.id ?? ''
  }

  /** Incremental when we hold an anchor, else a baseline fetch. */
  async sync(sid: string): Promise<void> {
    this.store.loading = this.store.messages.length === 0
    this.store.notify()
    try {
      if (this.syncedTipId) {
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
          this.trackOldest()
        }
      } else {
        await this.baseline(sid)
      }
    } catch {
      /* offline: keep whatever the window already shows */
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
      this.syncedTipId = chat.length ? chat[chat.length - 1]!.id : ''
      this.trackOldest()
    } catch {
      /* keep the existing window */
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
      this.trackOldest()
    } catch {
      /* keep current view */
    }
    this.store.loading = false
    this.store.notify()
  }

  /** After a turn completes (or a message-added nudge), pull the server delta
   *  and adopt real ids. */
  async reconcile(): Promise<void> {
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
      this.trackOldest()
    } catch {
      /* offline reconcile retry on next turn */
    }
  }
}
