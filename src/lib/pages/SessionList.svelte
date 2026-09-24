<script lang="ts">
  // SessionList — the primary tab. Every session is listed FLAT and sorted by
  // most-recent reply. A repo's `main` session is a normal row; when that repo
  // also has feature-branch sessions, main gets a LEFT triangle that expands
  // them as indented children (branch sessions only — no repo/role grouping).
  //
  // Free sessions (admin/explorer) appear as rows. The `+` action offers only
  // the four creation flows: org / repo / branch(fork) / free session.
  //
  // Search matches name, org:repo and preview.
  import type { PageProps } from '$lib/page-props'
  import type { Session } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { promptDialog, confirmDialog } from '$lib/dialogs'
  import { Prefs } from '$lib/prefs'
  import { sessionName } from '$lib/models'
  import { roleOfSession, isBranchRole } from '$lib/roles'
  import { previewLabel } from '$lib/api-mappers'
  import SessionRow from '$lib/components/SessionRow.svelte'
  import ContextMenu, { type ContextMenuItem } from '$lib/components/ContextMenu.svelte'
  import type { MenuAnchor } from '$lib/context-menu-position'
  import { DropdownMenu, DropdownMenuItem } from '$lib/components/ui/dropdown-menu'
  import { Select } from '$lib/components/ui/select'
  import { Input } from '$lib/components/ui/input'
  import { Dialog } from '$lib/components/ui/dialog'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import ReconnectBanner from '$lib/components/ReconnectBanner.svelte'

  let { store }: PageProps = $props()

  let searching = $state(false)
  let q = $state('')
  let selectMode = $state(false)
  let selected = $state<Set<string>>(new Set())
  // Repos whose feature-branch children are EXPANDED (default: collapsed).
  let expandedRepos = $state<Set<string>>(new Set())

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
    if (needle) {
      list = list.filter(
        s =>
          s.id.toLowerCase().includes(needle) ||
          s.lastMessagePreview.toLowerCase().includes(needle) ||
          `${s.org}/${s.repo}/${s.branch}`.toLowerCase().includes(needle),
      )
    }
    return list
  })

  // A flat display list: free rows + each repo's main row (with its branch
  // sessions as optional indented children), all ordered by recency.
  type Display = {
    key: string
    session: Session
    isChild: boolean
    childCount: number
    expanded: boolean
  }

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

    type Anchor = { key: string; main: Session; children: Session[]; rec: number }
    const anchors: Anchor[] = []
    for (const [key, list] of byRepo) {
      const sorted = [...list].sort((a, b) => recency(b) - recency(a))
      const main = sorted.find(s => s.branch === 'main')
      const anchor = main ?? sorted[0]!
      const children = sorted.filter(s => s.id !== anchor.id)
      anchors.push({ key, main: anchor, children, rec: recency(anchor) })
    }

    // Merge free sessions and repo anchors by recency (newest first).
    type Item = { rec: number; free?: Session; anchor?: Anchor }
    const items: Item[] = [
      ...free.map(s => ({ rec: recency(s), free: s })),
      ...anchors.map(a => ({ rec: a.rec, anchor: a })),
    ]
    items.sort((a, b) => b.rec - a.rec)

    const out: Display[] = []
    for (const it of items) {
      if (it.free) {
        out.push({ key: `s:${it.free.id}`, session: it.free, isChild: false, childCount: 0, expanded: false })
        continue
      }
      const a = it.anchor!
      const expanded = expandedRepos.has(a.key)
      out.push({ key: `m:${a.key}`, session: a.main, isChild: false, childCount: a.children.length, expanded })
      if (expanded) {
        for (const c of a.children) {
          out.push({ key: `c:${c.id}`, session: c, isChild: true, childCount: 0, expanded: false })
        }
      }
    }
    return out
  })

  function toggleExpand(key: string) {
    const next = new Set(expandedRepos)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedRepos = next
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

  // ---- creation flows (`+` menu) ----
  type CreateKind = 'org' | 'repo' | 'branch' | 'free' | null
  let createKind = $state<CreateKind>(null)
  let busy = $state(false)
  let orgs = $state<string[]>([])
  let repoOptions = $state<{ org: string; repo: string }[]>([])

  // dialog fields
  let dOrg = $state('')
  let dRepoOrg = $state('')
  let dRepo = $state('')
  let dBrRepo = $state('') // "org/repo"
  let dBrParent = $state('') // parent session id
  let dBrName = $state('')
  let dFreeName = $state('')
  let dFreeRole = $state<'admin' | 'explorer'>('explorer')
  // Agent language pinned at creation (zh/en), seeded from the tenant default.
  let dLocale = $state<'zh' | 'en'>('en')

  async function openCreate(kind: Exclude<CreateKind, null>) {
    createKind = kind
    busy = false
    dOrg = ''
    dRepo = ''
    dBrName = ''
    dBrParent = ''
    dFreeName = ''
    dFreeRole = 'explorer'
    dLocale = Prefs.loadAgentLocale()
    try {
      orgs = await store.api.listOrgs()
    } catch {
      orgs = []
    }
    try {
      repoOptions = (await store.api.listRepos()).map(r => ({ org: r.org, repo: r.repo }))
    } catch {
      repoOptions = []
    }
    dRepoOrg = orgs[0] ?? repoOptions[0]?.org ?? ''
    dBrRepo = repoOptions[0] ? `${repoOptions[0].org}/${repoOptions[0].repo}` : ''
    dBrParent = parentChoices(dBrRepo)[0]?.value ?? ''
  }

  /** The repo's session usable as a fork parent: the MAIN session only (a
   *  feature branch must not spawn more branches). */
  function parentChoices(repoRef: string): { value: string; label: string }[] {
    if (!repoRef) return []
    const [org, repo] = repoRef.split('/')
    return store.sessions
      .filter(s => s.org === org && s.repo === repo && s.branch === 'main')
      .map(s => ({ value: s.id, label: s.branch }))
  }

  const repoRefOptions = $derived(repoOptions.map(r => ({ value: `${r.org}/${r.repo}`, label: `${r.org}/${r.repo}` })))
  const orgOptions = $derived(orgs.map(o => ({ value: o, label: o })))
  const parentOptions = $derived(parentChoices(dBrRepo))

  const canSubmit = $derived.by(() => {
    switch (createKind) {
      case 'org':
        return dOrg.trim() !== ''
      case 'repo':
        return dRepoOrg.trim() !== '' && dRepo.trim() !== ''
      case 'branch':
        return dBrRepo !== '' && dBrParent !== '' && dBrName.trim() !== ''
      case 'free':
        return dFreeName.trim() !== ''
      default:
        return false
    }
  })

  async function submitCreate() {
    if (!canSubmit || busy) return
    busy = true
    try {
      if (createKind === 'org') {
        await store.api.createOrg(dOrg.trim())
      } else if (createKind === 'repo') {
        await store.api.ensureRepo(dRepoOrg.trim(), dRepo.trim())
      } else if (createKind === 'branch') {
        await store.api.forkBranchSession(dBrParent, dBrName.trim())
      } else if (createKind === 'free') {
        await store.api.createFreeSession(dFreeName.trim(), dFreeRole, '', dLocale)
      }
      showToast(t('created'))
      createKind = null
      await store.refreshSessions()
    } catch (e) {
      showErrorToast(String(e))
    }
    busy = false
  }

  // Row context menu (desktop right-click / mobile long-press), anchored to
  // the source ROW and highlighting it.
  let rowMenu = $state<{ sid: string; anchor: MenuAnchor } | null>(null)

  function openRowMenu(sid: string, anchor: MenuAnchor) {
    rowMenu = { sid, anchor }
  }

  const rowMenuItems = $derived.by(() => {
    if (!rowMenu) return []
    const s = store.sessionById(rowMenu.sid)
    const items: ContextMenuItem[] = []
    // Only a MAIN session (maintainer) can fork a new branch (with its chat
    // context); a feature-branch session must not spawn more branches.
    if (s && roleOfSession(s) === 'maintainer') items.push({ value: 'fork', label: t('createBranchTitle') })
    if (s && store.isUnread(s)) items.push({ value: 'read', label: t('markRead') })
    items.push({ value: 'delete', label: t('deleteSession'), destructive: true })
    return items
  })

  async function onRowMenuPick(value: string) {
    const sid = rowMenu?.sid
    rowMenu = null
    if (!sid) return
    if (value === 'read') store.markSessionRead(sid)
    else if (value === 'fork') await forkFrom(sid)
    else if (value === 'delete') await deleteFlow(sid)
  }

  /** Fork a new branch from an existing branch session (parent required). */
  async function forkFrom(sid: string) {
    const s = store.sessionById(sid)
    if (!s) return
    const branch = await promptDialog({
      title: t('createBranchTitle'),
      body: `${t('parentBranch')}: ${s.branch}`,
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

  async function deleteFlow(sid: string | null) {
    const s = sid ? store.sessionById(sid) : null
    const ok = await confirmDialog({
      title: t('deleteSession'),
      body: s
        ? isBranchRole(roleOfSession(s))
          ? t('deleteBranchSessionBody', { arg1: sessionName(s) })
          : t('deleteSessionBody', { arg1: sessionName(s) })
        : '',
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
      <DropdownMenu label={t('newSessionTitle')}>
        {#snippet trigger()}
          <AppIcons.add class="size-[18px]" />
        {/snippet}
        <DropdownMenuItem onSelect={() => void openCreate('org')}>{t('createOrgTitle')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openCreate('repo')}>{t('createRepoTitle')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openCreate('branch')} disabled={repoOptions.length === 0}>{t('createBranchTitle')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openCreate('free')}>{t('createFreeTitle')}</DropdownMenuItem>
      </DropdownMenu>
    {/if}
  </PageHeader>

  <ReconnectBanner />

  <div
    class="min-h-0 flex-1 overflow-y-auto"
    role="list"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
  >
    {#if display.length === 0}
      <EmptyState>{t('noSessions')}</EmptyState>
    {:else}
      {#each display as item (item.key)}
        {@const s = item.session}
        <SessionRow
          session={s}
          role={roleOfSession(s)}
          isActive={s.id === store.activeSessionId}
          subtitle={previewLabel(s.lastMessagePreview) || s.id}
          unread={store.isUnread(s)}
          unreadCount={store.unreadCountFor(s)}
          selectable={selectMode}
          selected={selected.has(s.id)}
          childCount={item.childCount}
          expanded={item.expanded}
          isChild={item.isChild}
          onTap={() => (selectMode ? toggle(s.id) : store.pickSession(s.id))}
          menuOpen={rowMenu?.sid === s.id}
          onMenuRequest={selectMode ? null : anchor => openRowMenu(s.id, anchor)}
          onToggleExpand={item.childCount > 0 ? () => toggleExpand(repoKey(s)) : undefined}
        />
      {/each}
    {/if}
  </div>

  {#if rowMenu}
    <ContextMenu anchor={rowMenu.anchor} items={rowMenuItems} onPick={v => void onRowMenuPick(v)} onClose={() => (rowMenu = null)} />
  {/if}

</div>

<!-- creation dialogs -->
<Dialog
  open={createKind === 'org'}
  title={t('createOrgTitle')}
  onClose={() => (createKind = null)}
>
  {#snippet children()}
    <label class="block">
      <span class="mb-1 block text-meta text-muted-foreground">{t('orgNameLabel')}</span>
      <Input bind:value={dOrg} placeholder="acme" />
    </label>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (createKind = null)}>{t('cancel')}</button>
    <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80 disabled:opacity-40" disabled={!canSubmit || busy} onclick={() => void submitCreate()}>{t('create')}</button>
  {/snippet}
</Dialog>

<Dialog
  open={createKind === 'repo'}
  title={t('createRepoTitle')}
  onClose={() => (createKind = null)}
>
  {#snippet children()}
    <div class="space-y-3">
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('org')}</span>
        <Select bind:value={dRepoOrg} items={orgOptions} placeholder={t('org')} />
      </label>
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('repoNameLabel')}</span>
        <Input bind:value={dRepo} placeholder="my-repo" />
      </label>
    </div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (createKind = null)}>{t('cancel')}</button>
    <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80 disabled:opacity-40" disabled={!canSubmit || busy} onclick={() => void submitCreate()}>{t('create')}</button>
  {/snippet}
</Dialog>

<Dialog
  open={createKind === 'branch'}
  title={t('createBranchTitle')}
  onClose={() => (createKind = null)}
>
  {#snippet children()}
    <div class="space-y-3">
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('repo')}</span>
        <Select
          bind:value={dBrRepo}
          items={repoRefOptions}
          placeholder={t('repo')}
          onchange={v => {
            dBrRepo = v
            dBrParent = parentChoices(v)[0]?.value ?? ''
          }}
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('pickParent')}</span>
        <Select bind:value={dBrParent} items={parentOptions} placeholder={t('parentBranch')} />
      </label>
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('branchHint')}</span>
        <Input bind:value={dBrName} placeholder="feature/x" />
      </label>
    </div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (createKind = null)}>{t('cancel')}</button>
    <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80 disabled:opacity-40" disabled={!canSubmit || busy} onclick={() => void submitCreate()}>{t('create')}</button>
  {/snippet}
</Dialog>

<Dialog
  open={createKind === 'free'}
  title={t('createFreeTitle')}
  onClose={() => (createKind = null)}
>
  {#snippet children()}
    <div class="space-y-3">
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('sessionNameLabel')}</span>
        <Input bind:value={dFreeName} placeholder={t('sessionNameHint')} />
      </label>
      <div>
        <span class="mb-1 block text-meta text-muted-foreground">{t('pickRole')}</span>
        <div class="flex gap-2">
          {#each ['explorer', 'admin'] as r (r)}
            <button
              type="button"
              class="flex-1 rounded-md border px-3 py-2 text-sm {dFreeRole === r ? 'border-primary/50 bg-primary/8' : 'border-border hover:bg-muted/50'}"
              onclick={() => (dFreeRole = r as 'admin' | 'explorer')}
            >{t(r === 'admin' ? 'roleAdmin' : 'roleExplorer')}</button>
          {/each}
        </div>
      </div>
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('agentLocale')}</span>
        <Select
          bind:value={dLocale}
          items={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </label>
    </div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (createKind = null)}>{t('cancel')}</button>
    <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80 disabled:opacity-40" disabled={!canSubmit || busy} onclick={() => void submitCreate()}>{t('create')}</button>
  {/snippet}
</Dialog>
