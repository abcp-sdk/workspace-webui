<script lang="ts">
  // CodeTab — the Code tab: a persistent LEFT tree (org > repo > branch, with
  // 3-level avatars) and a RIGHT pane (file tree list / blob viewer via
  // RepoDetail + RepoBlob). On narrow screens the tree becomes a drawer.
  //
  //   org    ▸ (collapsible)
  //     repo ▸ (collapsible, loads branches lazily)
  //       main / feature/... (selecting one loads the right pane)
  import type { PageProps } from '$lib/page-props'
  import type { RepoInfo, BranchInfo } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { confirmDialog } from '$lib/dialogs'
  import { Dialog } from '$lib/components/ui/dialog'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import RepoAvatar from '$lib/components/RepoAvatar.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import RepoDetail from './RepoDetail.svelte'
  import RepoBlob from './RepoBlob.svelte'

  let { store }: PageProps = $props()

  let repos = $state<RepoInfo[]>([])
  let loading = $state(true)
  let expandedOrgs = $state<Set<string>>(new Set())
  let expandedRepos = $state<Set<string>>(new Set())
  let branchesByRepo = $state<Record<string, BranchInfo[]>>({})
  let drawerOpen = $state(false)

  // Active selection.
  let selOrg = $state('')
  let selRepo = $state('')
  let selRef = $state('')
  let openFile = $state('') // '' = the detail (list), else the blob viewer

  let width = $state(typeof window !== 'undefined' ? window.innerWidth : 1280)
  // Match the Shell's breakpoint (it shows the desktop rail at >= 640): keeping
  // the tree as a real column whenever the rail is visible avoids the "single
  // sub-window" look caused by mismatched thresholds.
  const isCompact = $derived(width < 640)
  // Narrower tree once space gets tight.
  const asideW = $derived(width < 1024 ? 'w-64' : 'w-72')

  $effect(() => {
    const on = () => (width = window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  })

  $effect(() => {
    void load()
  })

  async function load() {
    loading = true
    try {
      repos = await store.api.listRepos()
      // Auto-expand a single org.
      const orgs = [...new Set(repos.map(r => r.org))]
      if (orgs.length === 1) expandedOrgs = new Set(orgs)
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
  }

  const orgs = $derived.by(() => {
    const m = new Map<string, RepoInfo[]>()
    for (const r of repos) {
      const list = m.get(r.org) ?? []
      list.push(r)
      m.set(r.org, list)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })

  function toggleOrg(org: string) {
    const next = new Set(expandedOrgs)
    if (next.has(org)) next.delete(org)
    else next.add(org)
    expandedOrgs = next
  }

  async function toggleRepo(org: string, repo: string) {
    const key = `${org}/${repo}`
    const next = new Set(expandedRepos)
    if (next.has(key)) {
      next.delete(key)
      expandedRepos = next
      return
    }
    next.add(key)
    expandedRepos = next
    if (!branchesByRepo[key]) {
      try {
        branchesByRepo = { ...branchesByRepo, [key]: await store.api.branches(org, repo) }
      } catch (e) {
        showErrorToast(String(e))
      }
    }
  }

  function select(org: string, repo: string, ref: string) {
    selOrg = org
    selRepo = repo
    selRef = ref
    openFile = ''
    drawerOpen = false
  }

  /** Delete a branch AND its branch session (session + sandboxes cascade).
   *  Double-confirmed: the session's history is gone with it. */
  async function deleteBranchFlow(org: string, repo: string, branch: string) {
    const ok = await confirmDialog({
      title: t('deleteBranch'),
      body: t('deleteBranchBody', { arg1: `${org}/${repo}:${branch}` }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    try {
      await store.api.deleteBranch(org, repo, branch)
      showToast(t('deleted'))
      branchesByRepo = { ...branchesByRepo, [`${org}/${repo}`]: await store.api.branches(org, repo) }
      await store.refreshSessions()
      if (selOrg === org && selRepo === repo && selRef === branch) {
        selRef = ''
        openFile = ''
      }
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  // Auto-select the first branch of the first repo on first load (desktop).
  $effect(() => {
    if (loading || selRepo || orgs.length === 0) return
    const [org, list] = orgs[0]!
    const repo = list[0]!.repo
    void (async () => {
      const key = `${org}/${repo}`
      let bs = branchesByRepo[key]
      if (!bs) {
        try {
          bs = await store.api.branches(org, repo)
          branchesByRepo = { ...branchesByRepo, [key]: bs }
        } catch {
          bs = []
        }
      }
      const def = bs.find(b => b.name === list[0]!.defaultBranch)?.name ?? bs[0]?.name ?? 'main'
      select(org, repo, def)
    })()
  })

  // ---- import an external repository (admin) ----
  let importOpen = $state(false)
  let impOrg = $state('')
  let impUrl = $state('')
  let impRepo = $state('')
  let impRef = $state('')
  let impToken = $state('')
  let impBusy = $state(false)

  const importOrgs = $derived([...new Set([...repos.map(r => r.org), impOrg].filter(Boolean))].sort())

  function openImport() {
    importOpen = true
    impOrg = orgs[0]?.[0] ?? ''
    impUrl = ''
    impRepo = ''
    impRef = ''
    impToken = ''
  }

  async function doImport() {
    if (!impOrg.trim() || !impUrl.trim() || impBusy) return
    impBusy = true
    try {
      await store.api.importRepo({
        org: impOrg.trim(),
        url: impUrl.trim(),
        repo: impRepo.trim(),
        ref: impRef.trim(),
        authToken: impToken.trim(),
      })
      showToast(t('imported'))
      importOpen = false
      await load()
      expandedOrgs = new Set([...expandedOrgs, impOrg.trim()])
    } catch (e) {
      showErrorToast(String(e))
    }
    impBusy = false
  }

  const active = $derived(selOrg && selRepo && selRef)
</script>

<div class="flex h-full w-full">
  <!-- left tree (persistent on wide, drawer on narrow) -->
  {#if !isCompact || drawerOpen}
    <aside
      class={cn(
        'flex shrink-0 flex-col border-r border-border bg-card',
        isCompact ? 'fixed inset-y-0 left-0 z-50 w-72 shadow-xl' : asideW,
      )}
    >
      <PageHeader title={t('tabCode')}>
        {#snippet right()}
          <IconButton icon={AppIcons.download} label={t('importRepo')} variant="primary" onclick={openImport} />
          <IconButton icon={AppIcons.refresh} label={t('refresh')} onclick={() => void load()} />
          {#if isCompact}
            <IconButton icon={AppIcons.close} onclick={() => (drawerOpen = false)} />
          {/if}
        {/snippet}
      </PageHeader>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#if loading}
          <div class="flex justify-center py-8"><span class="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
        {:else if orgs.length === 0}
          <EmptyState>{t('noRepos')}</EmptyState>
        {:else}
          {#each orgs as [org, list] (org)}
            <button type="button" class="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-muted" onclick={() => toggleOrg(org)}>
              {#if expandedOrgs.has(org)}<AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />{:else}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
              <RepoAvatar {org} level="org" size={22} />
              <span class="min-w-0 flex-1 truncate text-meta font-semibold">{org}</span>
            </button>
            {#if expandedOrgs.has(org)}
              {#each list as r (r.repo)}
                <button type="button" class="flex w-full items-center gap-2 py-1.5 pr-2 pl-6 text-left hover:bg-muted" onclick={() => void toggleRepo(org, r.repo)}>
                  {#if expandedRepos.has(`${org}/${r.repo}`)}<AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />{:else}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
                  <RepoAvatar {org} repo={r.repo} level="repo" size={20} />
                  <span class="min-w-0 flex-1 truncate text-meta">{r.repo}</span>
                </button>
                {#if expandedRepos.has(`${org}/${r.repo}`)}
                  {#each branchesByRepo[`${org}/${r.repo}`] ?? [] as b (b.name)}
                    <div
                      class={cn(
                        'flex w-full items-center gap-2 py-1.5 pr-1 pl-10 hover:bg-muted',
                        selOrg === org && selRepo === r.repo && selRef === b.name && 'bg-primary/10',
                      )}
                    >
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onclick={() => select(org, r.repo, b.name)}
                      >
                        <!-- chevron-width spacer: keeps branch avatars/labels one
                             indent step deeper than the repo row above. -->
                        <AppIcons.chevron_right class="size-3.5 shrink-0 text-transparent" />
                        <RepoAvatar {org} repo={r.repo} branch={b.name} level="branch" size={18} />
                        <span class="min-w-0 flex-1 truncate text-[12px]">{b.name}</span>
                      </button>
                      {#if b.name !== (list.find(x => x.repo === r.repo)?.defaultBranch ?? 'main')}
                        <button
                          type="button"
                          class="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                          title={t('deleteBranch')}
                          onclick={() => void deleteBranchFlow(org, r.repo, b.name)}
                        ><AppIcons.close class="size-3.5" /></button>
                      {/if}
                    </div>
                  {/each}
                {/if}
              {/each}
            {/if}
          {/each}
        {/if}
      </div>
    </aside>
  {/if}
  {#if isCompact && drawerOpen}
    <div class="fixed inset-0 z-40 bg-black/40" role="presentation" onclick={() => (drawerOpen = false)}></div>
  {/if}

  <Dialog bind:open={importOpen} title={t('importRepo')}>
    {#snippet children()}
      <div class="space-y-3">
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('importUrl')}</span>
          <input bind:value={impUrl} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" placeholder="https://github.com/owner/repo.git" />
        </label>
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('org')}</span>
          <input bind:value={impOrg} list="import-orgs" class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
          <datalist id="import-orgs">
            {#each importOrgs as o (o)}<option value={o}></option>{/each}
          </datalist>
        </label>
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('importRepoName')}</span>
          <input bind:value={impRepo} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" placeholder={t('importRepoNameHint')} />
        </label>
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('importRef')}</span>
          <input bind:value={impRef} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" placeholder={t('importRefHint')} />
        </label>
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('importToken')}</span>
          <input bind:value={impToken} type="password" class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
        </label>
      </div>
    {/snippet}
    {#snippet footer()}
      <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (importOpen = false)}>{t('cancel')}</button>
      <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80 disabled:opacity-40" disabled={!impOrg.trim() || !impUrl.trim() || impBusy} onclick={() => void doImport()}>{impBusy ? t('loading') : t('import')}</button>
    {/snippet}
  </Dialog>

  <!-- right pane -->
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    {#if !active}
      <EmptyState center>
        <IconButton icon={AppIcons.list} label={t('tabCode')} class={isCompact ? '' : 'hidden'} onclick={() => (drawerOpen = true)} />
        <span>{t('pickBranch')}</span>
      </EmptyState>
    {:else if openFile}
      <RepoBlob
        api={store.api}
        org={selOrg}
        repo={selRepo}
        ref={selRef}
        path={openFile}
        onBack={() => (openFile = '')}
        onMenu={isCompact ? () => (drawerOpen = true) : null}
      />
    {:else}
      {#key `${selOrg}/${selRepo}:${selRef}`}
        <RepoDetail
          api={store.api}
          org={selOrg}
          repo={selRepo}
          ref={selRef}
          onPickRef={r => (selRef = r)}
          onOpenFile={p => (openFile = p)}
          onMenu={isCompact ? () => (drawerOpen = true) : null}
        />
      {/key}
    {/if}
  </div>
</div>
