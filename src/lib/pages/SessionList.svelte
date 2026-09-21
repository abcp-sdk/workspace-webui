<script lang="ts">
  // SessionList — the primary tab. Every session (all five roles) is listed,
  // FLAT and sorted by most-recent reply. Branch sessions of one repo collapse
  // under a repo row (the fork/subsession tree ability, repurposed as
  // repo -> branches). Free sessions (admin/explorer/planner) appear as rows.
  //
  // Filters: role / repo / unread. Search matches name, org:repo and preview.
  import type { PageProps } from '$lib/page-props'
  import type { Session } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { promptDialog, confirmDialog } from '$lib/dialogs'
  import { sessionName } from '$lib/models'
  import { roleOfSession, roleLabelKey, isBranchRole, ROLES } from '$lib/roles'
  import SessionRow from '$lib/components/SessionRow.svelte'
  import ContextMenu, { type ContextMenuItem } from '$lib/components/ContextMenu.svelte'
  import type { MenuAnchor } from '$lib/context-menu-position'
  import SessionRepoRow from '$lib/components/SessionRepoRow.svelte'
  import { Select } from '$lib/components/ui/select'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'

  let { store }: PageProps = $props()

  let searching = $state(false)
  let q = $state('')
  let selectMode = $state(false)
  let selected = $state<Set<string>>(new Set())
  // Repo rows the user collapsed (default: expanded).
  let collapsed = $state<Set<string>>(new Set())
  // Filters.
  let roleFilter = $state('')
  let repoFilter = $state('')
  let unreadOnly = $state(false)

  let refreshStartY: number | null = null
  let refreshing = $state(false)

  async function onTouchStart(e: TouchEvent) {
    const el = e.currentTarget as HTMLElement
    refreshStartY = el.scrollTop <= 0 ? e.touches[0]!.clientY : null
  }

  async function onTouchMove(e: TouchEvent) {
    if (refreshStartY == null || refreshing) return
    const dy = e.touches[0]!.clientY - refreshStartY
    if (dy > 64) {
      refreshing = true
      refreshStartY = null
      await store.refreshSessions()
      refreshing = false
    }
  }

  function repoKey(s: Session): string {
    return s.org ? `${s.org}/${s.repo}` : ''
  }

  /** Newest first: lastMessageAt, then updatedAt, then createdAt. */
  function recency(s: Session): number {
    const t = Date.parse(s.lastMessageAt || s.updatedAt || s.createdAt || '') || 0
    return t
  }

  const filtered = $derived.by(() => {
    const needle = q.trim().toLowerCase()
    let list = store.sessions
    if (roleFilter) list = list.filter(s => roleOfSession(s) === roleFilter)
    if (repoFilter) list = list.filter(s => repoKey(s) === repoFilter)
    if (unreadOnly) list = list.filter(s => store.isUnread(s))
    if (needle) {
      list = list.filter(
        s =>
          s.id.toLowerCase().includes(needle) ||
          s.lastMessagePreview.toLowerCase().includes(needle) ||
          `${s.org}/${s.repo}/${s.branch}`.toLowerCase().includes(needle),
      )
    }
    return [...list].sort((a, b) => recency(b) - recency(a))
  })

  // A flat display list: free rows in recency order, and for each repo a header
  // row (unless filtered to one role) followed by its branch sessions.
  type Display =
    | { kind: 'row'; session: Session }
    | { kind: 'repo'; key: string; count: number; expanded: boolean }

  const display = $derived.by<Display[]>(() => {
    const free: Session[] = []
    const byRepo = new Map<string, Session[]>()
    for (const s of filtered) {
      const role = roleOfSession(s)
      if (!isBranchRole(role) || !s.org) {
        free.push(s)
        continue
      }
      const key = repoKey(s)
      const list = byRepo.get(key) ?? []
      list.push(s)
      byRepo.set(key, list)
    }
    const out: Display[] = free.map(s => ({ kind: 'row', session: s }))
    // Repos ordered by their newest session.
    const repos = [...byRepo.keys()].sort((a, b) => {
      const ra = Math.max(...byRepo.get(a)!.map(recency))
      const rb = Math.max(...byRepo.get(b)!.map(recency))
      return rb - ra
    })
    for (const key of repos) {
      const kids = byRepo.get(key)!.sort((a, b) => recency(b) - recency(a))
      out.push({ kind: 'repo', key, count: kids.length, expanded: !collapsed.has(key) })
      if (!collapsed.has(key)) for (const s of kids) out.push({ kind: 'row', session: s })
    }
    return out
  })

  const repoFilterOptions = $derived([
    { value: '', label: t('filterAll') },
    ...[...new Set(store.sessions.map(repoKey).filter(Boolean))].sort().map(k => ({ value: k, label: k })),
  ])
  const roleFilterOptions = $derived([
    { value: '', label: t('filterAll') },
    ...ROLES.map(r => ({ value: r, label: t(roleLabelKey(r)) })),
  ])

  function toggleCollapse(key: string) {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    collapsed = next
  }

  function exitSelect() {
    selectMode = false
    selected = new Set()
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected = next
  }

  function toggleAll() {
    if (selected.size === filtered.length) selected = new Set()
    else selected = new Set(filtered.map(s => s.id))
  }

  async function deleteSelected() {
    if (!selected.size) return
    const ok = await confirmDialog({
      title: t('deleteSessionsTitle', { n: selected.size }),
      body: t('deleteSessionsBody', { arg1: selected.size }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    const failed = await store.deleteSessions([...selected])
    if (failed.length) showErrorToast(t('deleteFailed', { n: failed.length }))
    else showToast(t('deleted'))
    exitSelect()
  }

  function openNewSession() {
    store.pushPage({ kind: 'new_session', key: 'new_session' })
  }

  async function forkBranch(sid: string) {
    const s = store.sessionById(sid)
    if (!s) return
    const branch = await promptDialog({
      title: t('fork'),
      body: `${s.org}/${s.repo}`,
      placeholder: t('branchHint'),
      confirmLabel: t('create'),
    })
    if (!branch) return
    try {
      await store.api.forkBranchSession(sid, branch.trim())
      showToast(t('created'))
      await store.refreshSessions()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  // Row context menu (desktop right-click / mobile long-press), anchored to
  // the source ROW and highlighting it — with many near-identical rows a
  // cursor-anchored menu gives no clue which session it acts on.
  let rowMenu = $state<{ sid: string; anchor: MenuAnchor } | null>(null)

  function openRowMenu(sid: string, anchor: MenuAnchor) {
    rowMenu = { sid, anchor }
  }

  const rowMenuItems = $derived.by(() => {
    if (!rowMenu) return []
    const s = store.sessionById(rowMenu.sid)
    const items: ContextMenuItem[] = []
    if (s && isBranchRole(roleOfSession(s))) items.push({ value: 'fork', label: t('fork') })
    if (s && store.isUnread(s)) items.push({ value: 'read', label: t('markRead') })
    items.push({ value: 'delete', label: t('deleteSession'), destructive: true })
    return items
  })

  async function onRowMenuPick(value: string) {
    const sid = rowMenu?.sid
    rowMenu = null
    if (!sid) return
    if (value === 'read') store.markSessionRead(sid)
    else if (value === 'fork') await forkBranch(sid)
    else if (value === 'delete') await deleteFlow(sid)
  }

  async function deleteFlow(sid: string | null) {
    const ok = await confirmDialog({
      title: t('deleteSession'),
      body: sid ? t('deleteSessionBody', { arg1: sessionName(store.sessionById(sid)!) }) : '',
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok || !sid) return
    try {
      await store.deleteSession(sid)
      showToast(t('deleted'))
    } catch (e) {
      showErrorToast(String(e))
    }
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if selectMode}
      <IconButton icon={AppIcons.close} label={t('cancel')} onclick={exitSelect} />
      <span class="min-w-0 flex-1 truncate text-base font-semibold">{t('selectedCount', { n: selected.size })}</span>
      <IconButton icon={AppIcons.list} label={t('selectAll')} onclick={toggleAll} />
      <IconButton
        icon={AppIcons.delete}
        label={t('delete')}
        variant={selected.size ? 'destructive' : 'ghost'}
        disabled={!selected.size}
        onclick={() => void deleteSelected()}
      />
    {:else if searching}
      <IconButton
        icon={AppIcons.back}
        onclick={() => {
          q = ''
          searching = false
        }}
      />
      <input
        bind:value={q}
        class="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
        placeholder={t('searchHint')}
      />
    {:else}
      <span class="min-w-0 flex-1 truncate text-base font-semibold">{t('tabChat')}</span>
      <IconButton icon={AppIcons.search} label={t('search')} variant="primary" onclick={() => (searching = true)} />
      <IconButton icon={AppIcons.list} label={t('selectSessions')} variant="primary" onclick={() => (selectMode = true)} />
      <IconButton icon={AppIcons.add} label={t('newSessionTitle')} variant="primary" onclick={openNewSession} />
    {/if}
  </PageHeader>

  {#if !selectMode && !searching}
    <div class="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
      <div class="min-w-0 flex-1">
        <Select bind:value={roleFilter} items={roleFilterOptions} />
      </div>
      <div class="min-w-0 flex-1">
        <Select bind:value={repoFilter} items={repoFilterOptions} />
      </div>
      <button
        type="button"
        class={cn(
          'shrink-0 rounded-full border px-3 py-1.5 text-micro',
          unreadOnly ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
        )}
        onclick={() => (unreadOnly = !unreadOnly)}
      >{t('unreadOnly')}</button>
    </div>
  {/if}

  {#if store.sessionError}
    <div class="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-meta text-destructive">
      {t('connectionError')} · {store.sessionError}
    </div>
  {/if}

  <div
    class="min-h-0 flex-1 overflow-y-auto"
    role="list"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
  >
    {#if display.length === 0}
      <EmptyState>{t('noSessions')}</EmptyState>
    {:else}
      {#each display as item (item.kind === 'repo' ? `repo:${item.key}` : `s:${item.session.id}`)}
        {#if item.kind === 'repo'}
          <SessionRepoRow
            repoKey={item.key}
            count={item.count}
            expanded={item.expanded}
            onToggle={() => toggleCollapse(item.key)}
          />
        {:else}
          {@const s = item.session}
          <SessionRow
            session={s}
            role={roleOfSession(s)}
            isActive={s.id === store.activeSessionId}
            subtitle={s.lastMessagePreview || s.id}
            unread={store.isUnread(s)}
            unreadCount={store.unreadCountFor(s)}
            selectable={selectMode}
            selected={selected.has(s.id)}
            childCount={0}
            expanded={true}
            isChild={!!s.org && isBranchRole(roleOfSession(s))}
            onTap={() => (selectMode ? toggle(s.id) : store.pickSession(s.id))}
            menuOpen={rowMenu?.sid === s.id}
            onMenuRequest={selectMode ? null : anchor => openRowMenu(s.id, anchor)}
            onToggleExpand={undefined}
          />
        {/if}
      {/each}
    {/if}
  </div>

  {#if rowMenu}
    <ContextMenu anchor={rowMenu.anchor} items={rowMenuItems} onPick={v => void onRowMenuPick(v)} onClose={() => (rowMenu = null)} />
  {/if}
</div>
