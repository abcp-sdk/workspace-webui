// AppStore — the web port of flutter/lib/store.dart (Svelte 5 runes edition).
// Owns: the session list (watchSessions live stream + reconnect backoff),
// unread read-watermarks, per-session chat drafts, provider draft, and the
// per-tab navigation stacks.
import type { AgentApi } from './api'
import { connection } from './connection.svelte'
import type { LocalStore } from './db'
import { t } from './i18n.svelte'
import type { ChatDraft, ProviderDraft, Session } from './models'
import {
  draftFromProvider,
  FALLBACK_API_TYPE_CAPABILITIES,
  type ProviderInfo,
} from './models'
import {
  type AppPage,
  rootPageFor,
  type SessionOverlay,
  type SiderTab,
  stackFor,
  tabForPage,
} from './nav'
import { Prefs } from './prefs'
import { sortSessionsByRecency } from './session-order'
import { showErrorToast } from './toast.svelte'

export type { AppPage, SessionOverlay, SiderTab } from './nav'
export { rootPageFor } from './nav'

export class AppStore {
  api: AgentApi
  local: LocalStore | null

  sessions = $state<Session[]>([])

  sessionRevision = $state(0)

  // ---- navigation: the visible LEAF page is the single source of truth ----
  // The router mirrors `leaf` to the URL and restores it on popstate/boot, so
  // there is no per-tab stack to keep in sync and no history.state. The full
  // stack is derived purely from the leaf via `stackFor`.
  leaf = $state<AppPage>(rootPageFor('chat'))
  /** Set by navigate()/hydrate() so the router knows push vs replace. */
  navOp: 'push' | 'replace' = 'push'
  /** Bumped on every navigation so the router effect re-runs even for a
   *  same-leaf navigation (e.g. a tab switch back to the same root). */
  navSeq = $state(0)
  /** Per-tab last leaf, for pleasant tab switching. In-memory ONLY: never
   *  persisted, so a refresh restores just the visible view (as required). */
  private lastLeaf: Record<SiderTab, AppPage> = {
    chat: rootPageFor('chat'),
    code: rootPageFor('code'),
    service: rootPageFor('service'),
    config: rootPageFor('config'),
  }

  /** session → last read message_seq (client-local). */
  readSeqs: Record<string, number> = $state({})

  /** session → sandbox phase (Running/Pending/…), refreshed from ListWorkspaces. */
  phases: Record<string, string> = $state({})

  /** Refresh the sandbox-phase map (best effort; the workspace gateway owns it). */
  async refreshPhases(): Promise<void> {
    try {
      const ws = await this.api.listBranchSessions()
      const out: Record<string, string> = {}
      for (const w of ws) if (w.session && w.phase) out[w.session] = w.phase
      this.phases = out
    } catch {
      /* phases are best effort */
    }
  }

  phaseFor(id: string): string {
    return this.phases[id] ?? ''
  }

  /** Per-session composer drafts, surviving navigation. */
  chatDrafts = $state<Record<string, ChatDraft>>({})

  /** Provider draft shared by the provider/model form pages. */
  providerDraft: ProviderDraft | null = $state(null)
  providersRevision = $state(0)

  /** Capability matrix from ListProvidersCatalog (api type -> capabilities).
   * Seeded with the bundled fallback; refreshed from the server on demand. */
  providerCatalog = $state<Record<string, string[]>>({
    ...FALLBACK_API_TYPE_CAPABILITIES,
  })

  async refreshProviderCatalog(): Promise<void> {
    try {
      const c = await this.api.providerCatalog()
      if (Object.keys(c).length > 0) this.providerCatalog = c
    } catch {
      /* keep the fallback */
    }
  }

  // ---- watchSessions live list ----
  private sessionAbort: AbortController | null = null
  private sessionTimer: ReturnType<typeof setTimeout> | null = null
  private sessionAttempt = 0
  private firstSnapshot = true

  constructor(api: AgentApi, local: LocalStore | null) {
    this.api = api
    this.local = local
    this.hydrateLocal()
    this.startSessionWatch()
    void this.refreshPhases()
  }

  private async hydrateLocal() {
    const l = this.local
    if (!l) return
    try {
      // MERGE (never clobber): the stream's first snapshot can land before this
      // read resolves, and that snapshot seeds read watermarks — overriding the
      // in-memory map with the older DB copy would flash every row as unread.
      this.readSeqs = { ...(await l.loadReadSeqs()), ...this.readSeqs }
      this.chatDrafts = await l.loadDrafts()
    } catch {
      /* network-only fallback */
    }
  }

  startSessionWatch() {
    this.sessionTimer && clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    this.sessionAbort?.abort()
    const ac = new AbortController()
    this.sessionAbort = ac
    void (async () => {
      try {
        for await (const ev of this.api.watchSessions()) {
          if (ac.signal.aborted) return
          this.applySessionEvent(ev.snapshot, ev.upserts, ev.removed)
        }
        this.onSessionStreamClosed()
      } catch {
        if (!ac.signal.aborted) this.onSessionStreamClosed()
      }
    })()
  }

  /** Tear down the live list stream (backend switch / logout). Not a
   *  connection problem, so clear the banner too. */
  dispose() {
    this.sessionTimer && clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    this.sessionAbort?.abort()
    this.sessionAbort = null
    connection.sessions = false
  }

  private onSessionStreamClosed() {
    // The list stream is down: surface the in-page reconnect banner.
    connection.sessions = true
    // Retry FOREVER (WeChat-style) with a capped backoff.
    const delay = Math.min(30, 1 << Math.min(this.sessionAttempt, 5))
    this.sessionAttempt++
    this.sessionTimer = setTimeout(() => this.startSessionWatch(), delay * 1000)
  }

  /** Assign the session list, ALWAYS ordered most-recent-first. The server
   *  snapshot is ordered by `updated_at`, but a live upsert only advances a
   *  row's `lastMessageAt` in place — without this re-sort the row's timestamp
   *  changes while its position does not. */
  private setSessions(list: Session[]) {
    this.sessions = sortSessionsByRecency(list)
  }

  private applySessionEvent(
    snapshot: boolean,
    upserts: Session[],
    removed: string[],
  ) {
    this.sessionAttempt = 0
    // A frame arrived: the list stream is healthy again.
    connection.sessions = false
    if (snapshot) {
      this.setSessions(upserts)
      // First ever snapshot on this device: seed read watermarks so historical
      // sessions don't pop as unread; new ones start unread at 0.
      if (this.firstSnapshot) {
        this.firstSnapshot = false
        for (const s of this.sessions) {
          if (!(s.id in this.readSeqs)) {
            this.readSeqs[s.id] = s.messageSeq
            // Mirror to the local DB: a cold start whose DB read loses the race
            // must not repopulate from an empty table and flash unread again.
            void this.local?.setReadSeq(s.id, s.messageSeq)
          }
        }
        Prefs.saveReadSeqs(this.readSeqs)
      }
    } else {
      const next = [...this.sessions]
      for (const s of upserts) {
        const i = next.findIndex(x => x.id === s.id)
        if (i === -1) next.push(s)
        else next[i] = s
      }
      this.setSessions(
        removed.length ? next.filter(s => !removed.includes(s.id)) : next,
      )
    }
    // The open session is being read live: advance its watermark so returning
    // to the list shows no stale badge.
    const active = this.activeSession
    if (active && (this.readSeqs[active.id] ?? -1) < active.messageSeq) {
      this.readSeqs[active.id] = active.messageSeq
      Prefs.saveReadSeqs(this.readSeqs)
    }
  }

  /** The session id of the visible chat page (null when on the list). */
  get activeSessionId(): string | null {
    const l = this.leaf
    if (l.kind === 'chat_session' || l.kind === 'chat_overlay') return l.session
    return null
  }

  get activeSession(): Session | null {
    return this.sessions.find(s => s.id === this.activeSessionId) ?? null
  }

  /** The overlay shown over the active chat (from the leaf page). */
  get sessionOverlay(): SessionOverlay | null {
    return this.leaf.kind === 'chat_overlay' ? this.leaf.overlay : null
  }

  sessionById(id: string): Session | null {
    return this.sessions.find(s => s.id === id) ?? null
  }

  /** Manual refresh (pull-to-refresh / fallback reconciliation). Failures
   *  surface as a toast (the long-lived stream banner already covers a dropped
   *  connection; a manual refresh that fails is a one-shot action). */
  async refreshSessions() {
    try {
      this.setSessions(await this.api.listSessions())
    } catch (e) {
      showErrorToast(`${t('connectionError', { arg1: String(e) })}`)
    }
    void this.refreshPhases()
  }

  async deleteSession(id: string) {
    await this.api.deleteSession(id)
    if (this.activeSessionId === id) this.closeSession()
    await this.refreshSessions()
    void this.local?.removeSession(id)
  }

  /** Delete several sessions sequentially; returns the ids that failed. */
  async deleteSessions(ids: string[]): Promise<string[]> {
    const failed: string[] = []
    let closedActive = false
    for (const id of ids) {
      try {
        await this.api.deleteSession(id)
        void this.local?.removeSession(id)
        if (this.activeSessionId === id) {
          closedActive = true
        }
      } catch {
        failed.push(id)
      }
    }
    if (closedActive) this.closeSession()
    await this.refreshSessions()
    return failed
  }

  async forkSession(branch: string): Promise<boolean> {
    const id = this.sessionById(this.activeSessionId ?? '')?.id
    if (!id) return false
    try {
      const s = await this.api.forkBranchSession(id, branch)
      this.navigate({
        kind: 'chat_session',
        key: 'chat_session',
        session: s.id,
      })
      await this.refreshSessions()
      return true
    } catch {
      return false
    }
  }

  pickSession(id: string) {
    this.markSessionRead(id)
    this.navigate({ kind: 'chat_session', key: 'chat_session', session: id })
  }

  /** Read state is CLIENT-LOCAL: record a per-session read watermark. */
  markSessionRead(id: string) {
    const seq = this.sessionById(id)?.messageSeq ?? this.readSeqs[id] ?? 0
    this.readSeqs[id] = seq
    Prefs.saveReadSeqs(this.readSeqs)
    void this.local?.setReadSeq(id, seq)
    this.sessions = this.sessions.map(s =>
      s.id === id ? { ...s, unreadCount: 0 } : s,
    )
  }

  unreadCountFor(s: Session): number {
    const read = this.readSeqs[s.id]
    if (read == null) return s.messageSeq
    return Math.max(0, s.messageSeq - read)
  }

  isUnread(s: Session): boolean {
    return this.unreadCountFor(s) > 0
  }

  // ---- drafts ----

  draftFor(sessionId: string): ChatDraft {
    if (!this.chatDrafts[sessionId]) {
      this.chatDrafts[sessionId] = { text: '', attachments: [] }
    }
    return this.chatDrafts[sessionId]
  }

  saveDraftText(sessionId: string, text: string) {
    const d = this.draftFor(sessionId)
    if (d.text === text) return
    d.text = text
    if (!text.trim() && !d.attachments.length) {
      delete this.chatDrafts[sessionId]
      void this.local?.saveDraft(sessionId, '', [])
      return
    }
    void this.local?.saveDraft(sessionId, d.text, d.attachments)
  }

  saveDraftAttachments(
    sessionId: string,
    attachments: ChatDraft['attachments'],
  ) {
    const d = this.draftFor(sessionId)
    d.attachments = [...attachments]
    if (!d.text.trim() && !d.attachments.length) {
      delete this.chatDrafts[sessionId]
      void this.local?.saveDraft(sessionId, '', [])
      return
    }
    void this.local?.saveDraft(sessionId, d.text, d.attachments)
  }

  clearDraft(sessionId: string) {
    delete this.chatDrafts[sessionId]
    void this.local?.saveDraft(sessionId, '', [])
  }

  // ---- provider draft ----

  bumpProvidersRevision() {
    this.providersRevision++
  }

  beginProviderDraft(existing: ProviderInfo | null, capability = 'text') {
    this.providerDraft = existing
      ? draftFromProvider(existing)
      : {
          originalId: null,
          id: '',
          capability,
          apiType: 'openai-compatible',
          baseUrl: '',
          apiKey: '',
          models: [],
        }
  }

  endProviderDraft() {
    this.providerDraft = null
  }

  // ---- overlays ----

  openOverlay(v: SessionOverlay) {
    const sid = this.activeSessionId
    if (sid == null) return
    this.navigate({
      kind: 'chat_overlay',
      key: 'chat_overlay',
      overlay: v,
      session: sid,
    })
  }

  closeOverlay() {
    const sid = this.activeSessionId
    if (sid == null) return
    this.navigate({ kind: 'chat_session', key: 'chat_session', session: sid })
  }

  /** Close the open conversation; chat tab returns to the session list. */
  closeSession() {
    this.navigate(rootPageFor('chat'))
  }

  bumpSessionRevision() {
    this.sessionRevision++
  }

  /** The tab the visible leaf lives in. */
  get siderTab(): SiderTab {
    return tabForPage(this.leaf)
  }

  /** Switch tabs, returning to that tab's LAST leaf (in-memory, per session). */
  switchTab(tab: SiderTab) {
    if (tab === this.siderTab) return
    this.navigate(this.lastLeaf[tab] ?? rootPageFor(tab))
  }

  /**
   * Navigate to a page from ANYWHERE (chat tool cards, the ⋮ menu, …). The URL
   * is the source of truth: the leaf is recorded, its canonical ancestry is
   * derived via `stackFor`, and the router mirrors it into the address bar.
   */
  navigate(page: AppPage, opts: { replace?: boolean } = {}) {
    this.lastLeaf[tabForPage(page)] = page
    this.navOp = opts.replace ? 'replace' : 'push'
    this.leaf = page
    this.navSeq++
  }

  /** Replace the visible view WITHOUT pushing a history entry (boot/popstate). */
  hydrate(page: AppPage) {
    this.lastLeaf[tabForPage(page)] = page
    this.navOp = 'replace'
    this.leaf = page
    this.navSeq++
  }

  /** Back-compat alias for {@link navigate}. */
  openPage(page: AppPage) {
    this.navigate(page)
  }

  /** Back-compat alias for {@link navigate}. */
  openCodePage(page: AppPage) {
    this.navigate(page)
  }

  // With canonical ancestry every navigation derives its own stack, so the
  // former push/sibling/child distinction is moot — all three are navigate().
  pushPage(page: AppPage) {
    this.navigate(page)
  }
  pushSibling(page: AppPage) {
    this.navigate(page)
  }
  pushChild(page: AppPage) {
    this.navigate(page)
  }

  /** Apply a settings/fork/rename result onto the live list. */
  applySession(updated: Session) {
    this.setSessions(
      this.sessions.map(s => (s.id === updated.id ? updated : s)),
    )
    this.bumpSessionRevision()
  }

  // ---- navigation (derived from the leaf) ----

  /** The full visible stack, derived purely from the current leaf. */
  get currentStack(): AppPage[] {
    return stackFor(this.leaf)
  }

  get topPage(): AppPage {
    return this.leaf
  }

  /** Installed by the router: an in-app "back" consumes a browser history
   *  entry when one exists (so forward/back stay symmetric). */
  backRequest: (() => void) | null = null

  /** Navigate to the parent of the current leaf (a stack pop). */
  popPage() {
    if (this.backRequest) {
      this.backRequest()
      return
    }
    const stack = this.currentStack
    if (stack.length <= 1) return
    this.navigate(stack[stack.length - 2]!, { replace: true })
  }

  get canPopPage(): boolean {
    return this.currentStack.length > 1
  }
}
