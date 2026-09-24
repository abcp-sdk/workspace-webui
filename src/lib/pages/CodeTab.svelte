<script lang="ts">
  // CodeTab — the Code tab ROOT: a flat list of org > repo > branch rows (the
  // left pane of the Shell's stack split). Selecting a branch pushes a
  // `repo_detail` page (the right pane) via the nav stack, so tablet shows the
  // tree + detail side by side (equal width) and phones show one pane + back.
  //
  //   org    ▸ (collapsible)
  //     repo ▸ (collapsible, loads branches lazily)
  //       main / feature/... (selecting pushes the repo detail page)
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

  let { store }: PageProps = $props()

  let repos = $state<RepoInfo[]>([])
  let loading = $state(true)
  let expandedOrgs = $state<Set<string>>(new Set())
  let expandedRepos = $state<Set<string>>(new Set())
  let branchesByRepo = $state<Record<string, BranchInfo[]>>({})

  $effect(() => {
    void load()
  })

  async function load() {
    // Cache-first: remounting the list (a slide back) must not refetch.
    const key = 'repos'
    loading = !store.hasData(key)
    try {
      repos = await store.dataLoad(key, () => store.api.listRepos())
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
        const bs = await store.dataLoad(`branches:${key}`, () => store.api.branches(org, repo))
        branchesByRepo = { ...branchesByRepo, [key]: bs }
      } catch (e) {
        showErrorToast(String(e))
      }
    }
  }

  /** Open a branch's repo detail as the stack's second pane. */
  function select(org: string, repo: string, ref: string) {
    store.pushSibling({
      kind: 'repo_detail',
      key: `repo:${org}/${repo}@${ref}`,
      org,
      repo,
      ref,
    })
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
      store.dropData(`branches:${org}/${repo}`)
      branchesByRepo = { ...branchesByRepo, [`${org}/${repo}`]: await store.dataLoad(`branches:${org}/${repo}`, () => store.api.branches(org, repo)) }
      await store.refreshSessions()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  /** Delete a repo AND all its branch sessions (session + sandboxes cascade).
   *  Double-confirmed: every session's history is gone with it. */
  async function deleteRepoFlow(org: string, repo: string) {
    const ok = await confirmDialog({
      title: t('deleteRepo'),
      body: t('deleteRepoBody', { arg1: `${org}/${repo}` }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    try {
      await store.api.deleteRepo(org, repo)
      showToast(t('deleted'))
      store.dropData('repos')
      store.dropData(`branches:${org}/${repo}`)
      await load()
      await store.refreshSessions()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

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
      store.dropData('repos')
      await load()
      expandedOrgs = new Set([...expandedOrgs, impOrg.trim()])
    } catch (e) {
      showErrorToast(String(e))
    }
    impBusy = false
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader title={t('tabCode')}>
    {#snippet right()}
      <IconButton icon={AppIcons.download} label={t('importRepo')} variant="primary" onclick={openImport} />
      <IconButton icon={AppIcons.refresh} label={t('refresh')} onclick={() => { store.dropData('repos'); void load() }} />
    {/snippet}
  </PageHeader>
  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex justify-center py-8"><span class="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
    {:else if orgs.length === 0}
      <EmptyState>{t('noRepos')}</EmptyState>
    {:else}
      {#each orgs as [org, list] (org)}
        <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted" onclick={() => toggleOrg(org)}>
          {#if expandedOrgs.has(org)}<AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />{:else}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
          <RepoAvatar {org} level="org" size={22} />
          <span class="min-w-0 flex-1 truncate text-meta font-semibold">{org}</span>
        </button>
        {#if expandedOrgs.has(org)}
          {#each list as r (r.repo)}
            <div class="flex w-full items-center gap-2 py-1.5 pr-1 pl-7 hover:bg-muted">
              <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onclick={() => void toggleRepo(org, r.repo)}>
                {#if expandedRepos.has(`${org}/${r.repo}`)}<AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />{:else}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
                <RepoAvatar {org} repo={r.repo} level="repo" size={20} />
                <span class="min-w-0 flex-1 truncate text-meta">{r.repo}</span>
              </button>
              <button
                type="button"
                class="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                title={t('deleteRepo')}
                onclick={() => void deleteRepoFlow(org, r.repo)}
              ><AppIcons.delete class="size-3.5" /></button>
            </div>
            {#if expandedRepos.has(`${org}/${r.repo}`)}
              {#each branchesByRepo[`${org}/${r.repo}`] ?? [] as b (b.name)}
                <div class="flex w-full items-center gap-2 py-1.5 pr-1 pl-12 hover:bg-muted">
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
</div>

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
