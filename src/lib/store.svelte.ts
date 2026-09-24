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
  ancestry,
  laneOf,
  pushPath,
  rootPageFor,
  type SessionOverlay,
  type SiderTab,
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

  // ---- navigation: a forest of pages, one PATH per lane, plus a DRAWER ----
  // `primary` is the leaf of the active lane's path; `primaryStack` is its
  // root→leaf ancestry. Cross-lane references (a chat tool-card link to a
  // blob) open in `drawer`, a SEPARATE path, so the main path is untouched.
  // A path never contains two pages of the same kind (see nav.pushPath), so
  // two sibling sessions can never share a path.
  primary = $state<AppPage>(rootPageFor('chat'))
  /** The drawer's own path ([] = closed). Its bottom is the entry page. */
  drawer = $state<AppPage[]>([])
  /** Which region the next `open()` acts on. The Shell sets this on
   *  pointerdown of the main region vs the drawer, so a click inside the
   *  drawer drills the drawer and a click in the main pane dismisses it. */
  navTarget: 'main' | 'drawer' = 'main'
  /** Per-lane last primary leaf, for pleasant tab switching. In-memory only. */
  private lastLeaf: Record<SiderTab, AppPage> = {
    chat: rootPageFor('chat'),
    code: rootPageFor('code'),
    service: rootPageFor('service'),
    config: rootPageFor('config'),
  }

  /** session → last read message_seq (client-local). */
  readSeqs: Record<string, number> = $state({})

  /** session → its representative sandbox (name + phase), from
   *  ListBranchSessions. A session may own several sandboxes; the gateway
   *  returns the best one. */
  sandboxes: Record<string, { name: string; phase: string }> = $state({})

  /** Refresh the sandbox map (best effort; the workspace gateway owns it). */
  async refreshPhases(): Promise<void> {
    try {
      const ws = await this.api.listBranchSessions()
      const out: Record<string, { name: string; phase: string }> = {}
      for (const w of ws) {
        if (w.session && w.sandbox) {
          out[w.session] = { name: w.sandbox, phase: w.phase }
        }
      }
      this.sandboxes = out
    } catch {
      /* phases are best effort */
    }
  }

  phaseFor(id: string): string {
    return this.sandboxes[id]?.phase ?? ''
  }

  /** The session's representative sandbox name ('' when none). */
  sandboxFor(id: string): string {
    return this.sandboxes[id]?.name ?? ''
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

  /** The session id of the FOCUSED chat page (drawer if open, else main). */
  get activeSessionId(): string | null {
    const l = this.focusedPage
    if (l.kind === 'chat_session' || l.kind === 'chat_overlay') return l.session
    return null
  }

  get activeSession(): Session | null {
    return this.sessions.find(s => s.id === this.activeSessionId) ?? null
  }

  /** The overlay shown over the focused chat (from the leaf page). */
  get sessionOverlay(): SessionOverlay | null {
    const l = this.focusedPage
    return l.kind === 'chat_overlay' ? l.overlay : null
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
    this.open({
      kind: 'chat_overlay',
      key: 'chat_overlay',
      overlay: v,
      session: sid,
    })
  }

  closeOverlay() {
    const sid = this.activeSessionId
    if (sid == null) return
    this.open({ kind: 'chat_session', key: 'chat_session', session: sid })
  }

  /** Close the open conversation; chat lane returns to the session list. */
  closeSession() {
    this.openMain(rootPageFor('chat'))
  }

  bumpSessionRevision() {
    this.sessionRevision++
  }

  /** The lane the primary page lives in. */
  get siderTab(): SiderTab {
    return laneOf(this.primary)
  }

  /** Switch lanes, returning to that lane's LAST leaf (in-memory, per run). */
  switchTab(lane: SiderTab) {
    if (lane === this.siderTab) return
    this.closeDrawer()
    this.primary = this.lastLeaf[lane] ?? rootPageFor(lane)
  }

  /**
   * Navigate to a page. The rule (a forest path, one kind per path):
   * - while the DRAWER is open, the drawer is the active context — the page is
   *   pushed onto the drawer path;
   * - same lane as the primary page → the page is pushed onto the primary path
   *   (an existing same-kind page is replaced at its depth = a sibling swap;
   *   a new kind appends = one level deeper);
   * - a DIFFERENT lane → the page opens in the drawer, leaving the main path
   *   untouched (a cross-lane reference, e.g. a chat tool-card link to a blob).
   */
  open(page: AppPage) {
    // A click inside the drawer drills the drawer (its own path).
    if (this.drawer.length > 0 && this.navTarget === 'drawer') {
      this.drawer = pushPath(this.drawer, page)
      return
    }
    // A click in the main region while a drawer is open DISMISSES the drawer
    // (the main pane is what the user chose to act on).
    if (this.drawer.length > 0) this.drawer = []
    if (laneOf(page) === laneOf(this.primary)) {
      const stack = pushPath(this.primaryStack, page)
      this.primary = stack[stack.length - 1]!
      this.lastLeaf[laneOf(this.primary)] = this.primary
    } else {
      this.drawer = [page]
    }
  }

  /** Force a page onto its lane's MAIN path (switching lanes if needed) and
   *  close the drawer. Used by "open repository" and the drawer's
   *  "open in tab" action. */
  openMain(page: AppPage) {
    this.drawer = []
    this.primary = page
    this.lastLeaf[laneOf(page)] = page
  }

  /** Back-compat aliases for {@link open}. */
  navigate(page: AppPage) {
    this.open(page)
  }
  openPage(page: AppPage) {
    this.open(page)
  }
  openCodePage(page: AppPage) {
    this.open(page)
  }
  pushPage(page: AppPage) {
    this.open(page)
  }
  pushSibling(page: AppPage) {
    this.open(page)
  }
  pushChild(page: AppPage) {
    this.open(page)
  }

  // ---- drawer (a separate inspection path over the main one) ----

  /** Open the drawer on `page` as its bottom (single-page seed). */
  openDrawer(page: AppPage) {
    this.drawer = [page]
  }

  /** Push a page onto the drawer path (same one-kind rule). */
  pushDrawer(page: AppPage) {
    this.drawer = pushPath(this.drawer, page)
  }

  /** Pop the drawer one level; popping the bottom closes it. */
  popDrawer() {
    this.drawer = this.drawer.length > 1 ? this.drawer.slice(0, -1) : []
  }

  closeDrawer() {
    this.drawer = []
  }

  get drawerOpen(): boolean {
    return this.drawer.length > 0
  }

  get drawerTop(): AppPage | null {
    return this.drawer[this.drawer.length - 1] ?? null
  }

  /** Apply a settings/fork/rename result onto the live list. */
  applySession(updated: Session) {
    this.setSessions(
      this.sessions.map(s => (s.id === updated.id ? updated : s)),
    )
    this.bumpSessionRevision()
  }

  // ---- navigation (derived from the primary path + drawer) ----

  /** The main lane's root→leaf path. */
  get currentStack(): AppPage[] {
    return this.primaryStack
  }

  get primaryStack(): AppPage[] {
    return ancestry(this.primary)
  }

  get topPage(): AppPage {
    return this.primary
  }

  /** The leaf of whichever context is focused (drawer if open, else main). */
  get focusedPage(): AppPage {
    return this.drawerTop ?? this.primary
  }

  /** In-app back: pop the drawer one level, else pop the main path. */
  popPage() {
    if (this.drawer.length > 0) {
      if (this.drawer.length > 1) this.drawer = this.drawer.slice(0, -1)
      else this.drawer = []
      return
    }
    if (this.primaryStack.length <= 1) return
    this.primary = this.primaryStack[this.primaryStack.length - 2]!
  }

  get canPopPage(): boolean {
    return this.drawer.length > 0 || this.primaryStack.length > 1
  }
}
