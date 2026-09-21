<script lang="ts">
  // NewSession — the single creation entry point. A session's ROLE decides its
  // shape and capabilities; visibility is always the whole tenant.
  //
  //   admin      free name   manage org/repo, read everything, no sandbox
  //   explorer   free name   read every repo, no sandbox
  //   planner    free name   read + sandbox, no git writes
  //   maintainer org:repo:main     (branch fixed)
  //   developer  org:repo:<branch> (new branch name)
  import type { PageProps } from '$lib/page-props'
  import type { ModelInfo, ProviderInfo } from '$lib/models'
  import type { RepoInfo } from '$lib/api'
  import { modelRefOf } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { Select } from '$lib/components/ui/select'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import { ROLES, roleIcon, roleLabelKey, roleTone, isBranchRole } from '$lib/roles'
  import { Input } from '$lib/components/ui/input'

  let { store, showBack = false }: PageProps = $props()

  let role = $state('developer')
  let name = $state('')
  let org = $state('')
  let repo = $state('')
  let branch = $state('')
  let modelRef = $state('')
  let repos = $state<RepoInfo[]>([])
  let models = $state<ModelInfo[]>([])
  let busy = $state(false)

  $effect(() => {
    void (async () => {
      try {
        repos = await store.api.listRepos()
      } catch {
        /* repos optional until one exists */
      }
      try {
        const providers: Record<string, ProviderInfo> = await store.api.providers()
        const out: ModelInfo[] = []
        for (const pid of Object.keys(providers)) {
          try {
            out.push(...(await store.api.models(pid)))
          } catch {
            /* provider skipped */
          }
        }
        models = out
      } catch {
        /* models optional */
      }
    })()
  })

  // Orgs and repos the tenant can choose (deduped from the visible repos).
  const orgs = $derived([...new Set(repos.map(r => r.org))].sort())
  const repoNames = $derived(repos.filter(r => !org || r.org === org).map(r => r.repo).sort())
  const free = $derived(!isBranchRole(role))
  const modelOptions = $derived([
    { value: '', label: t('none') },
    ...models.map(m => ({ value: modelRefOf(m), label: modelRefOf(m) })),
  ])
  const orgOptions = $derived(orgs.map(o => ({ value: o, label: o })))
  const repoOptions = $derived(repoNames.map(r => ({ value: r, label: r })))

  const canCreate = $derived.by(() => {
    if (free) return name.trim() !== ''
    if (!org || !repo) return false
    if (role === 'developer') return branch.trim() !== ''
    return true
  })

  // Keep org selection valid when repos change.
  $effect(() => {
    if (orgs.length && !orgs.includes(org)) org = orgs[0]!
    if (repoNames.length && !repoNames.includes(repo)) repo = repoNames[0]!
  })

  async function create() {
    if (!canCreate || busy) return
    busy = true
    try {
      let s
      if (free) {
        s = await store.api.createFreeSession(name.trim(), role as 'admin' | 'explorer' | 'planner', modelRef)
      } else {
        const b = role === 'maintainer' ? 'main' : branch.trim()
        s = await store.api.ensureBranchSession(org, repo, b, modelRef)
      }
      showToast(t('created'))
      await store.refreshSessions()
      store.popPage()
      if (s.id) store.pickSession(s.id)
    } catch (e) {
      showErrorToast(String(e))
    }
    busy = false
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader title={t('newSessionTitle')} onBack={showBack ? () => store.popPage() : null}>
    <button
      type="button"
      class="ml-auto text-sm text-primary disabled:opacity-40"
      disabled={!canCreate || busy}
      onclick={() => void create()}
    >{t('create')}</button>
  </PageHeader>

  <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
    <!-- role picker -->
    <div>
      <div class="mb-2 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('pickRole')}</div>
      <div class="space-y-1.5">
        {#each ROLES as r (r)}
          {@const Icon = roleIcon(r)}
          <button
            type="button"
            class={cn(
              'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left',
              role === r ? 'border-primary/50 bg-primary/8' : 'border-border hover:bg-muted/50',
            )}
            onclick={() => (role = r)}
          >
            <span class={cn('flex size-8 shrink-0 items-center justify-center rounded-full', roleTone(r))}>
              <Icon class="size-4" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-body font-medium">{t(roleLabelKey(r))}</span>
              <span class="block text-micro text-muted-foreground">{t(roleLabelKey(r) + 'Desc')}</span>
            </span>
            {#if role === r}<AppIcons.check class="size-4 shrink-0 text-primary" />{/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- free session: a simple name -->
    {#if free}
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('sessionNameLabel')}</span>
        <Input bind:value={name} placeholder={t('sessionNameHint')} />
      </label>
    {:else}
      <!-- branch-bound session: org / repo / branch -->
      <div class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('repo')}</span>
        {#if orgs.length === 0}
          <p class="text-micro text-muted-foreground">{t('noRepos')}</p>
        {:else}
          <div class="flex gap-2">
            <Select bind:value={org} items={orgOptions} placeholder={t('org')} />
            <Select bind:value={repo} items={repoOptions} placeholder={t('repo')} />
          </div>
        {/if}
      </div>
      {#if role === 'developer'}
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('branch')}</span>
          <Input bind:value={branch} placeholder={t('branchHint')} />
        </label>
      {:else}
        <div class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('branch')}</span>
          <div class="rounded-md border border-border px-3 py-2 text-body text-muted-foreground">main</div>
        </div>
      {/if}
    {/if}

    <label class="block">
      <span class="mb-1 block text-meta text-muted-foreground">{t('modelOptional')}</span>
      <Select bind:value={modelRef} items={modelOptions} placeholder={t('none')} />
    </label>
  </div>
</div>
