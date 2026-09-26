<script lang="ts">
  // ServiceRoot — the Service tab: running sandboxes and long-lived services.
  // Read + a NARROW action set: delete (sandbox/service) and pause/resume
  // (service only). No deploy / build / exec from this surface.
  import type { PageProps } from '$lib/page-props'
  import type { PVCInfo, SandboxInfo, ServiceInfo } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { confirmDialog } from '$lib/dialogs'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import { usePoll } from '$lib/poll.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import TabBar from '$lib/components/layout/TabBar.svelte'
  import TabItem from '$lib/components/layout/TabItem.svelte'
  import ListRow from '$lib/components/layout/ListRow.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store }: PageProps = $props()

  let tab = $state<'sandboxes' | 'services' | 'pvcs'>('sandboxes')
  let sandboxes = $state<SandboxInfo[]>([])
  let services = $state<ServiceInfo[]>([])
  let pvcs = $state<PVCInfo[]>([])
  let loading = $state(true)

  // Group the service list into release vs preview (a view filter, not a page).
  let stageFilter = $state<'all' | 'release' | 'preview'>('all')

  const releaseServices = $derived(services.filter(s => s.stage !== 'preview'))
  const previewServices = $derived(services.filter(s => s.stage === 'preview'))

  async function fetchLists() {
    const [s, sv, p] = await Promise.all([
      store.api.listSandboxes(),
      store.api.listServices(),
      store.api.listPVCs(),
    ])
    return { sandboxes: s, services: sv, pvcs: p }
  }

  // Initial load is CACHE-FIRST (a pane SLIDE re-runs the effect but must not
  // refetch). The poll bypasses the cache and writes it back.
  async function load() {
    const key = 'service-lists'
    loading = !store.hasData(key)
    try {
      const v = await store.dataLoad(key, fetchLists)
      sandboxes = v.sandboxes
      services = v.services
      pvcs = v.pvcs
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
  }

  async function refresh() {
    try {
      const v = await fetchLists()
      store.dataSet('service-lists', v)
      sandboxes = v.sandboxes
      services = v.services
      pvcs = v.pvcs
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  $effect(() => {
    void load()
  })

  // Poll only while the tab is visible; refresh immediately on return.
  usePoll(() => void refresh(), 15000, { immediate: false })

  function copyUrl(u: string) {
    void navigator.clipboard?.writeText(u).then(
      () => showToast(t('copied')),
      () => showErrorToast(t('copyFailed')),
    )
  }

  /** Remaining TTL as a compact label (e.g. "12m", "2h"). */
  function ttlLabel(expiresAt: number): string {
    const ms = expiresAt - Date.now()
    if (ms <= 0) return t('expired')
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return '<1m'
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h`
  }

  function relTime(ms: number): string {
    if (!ms) return ''
    const mins = Math.floor((Date.now() - ms) / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return `${mins}m`
    if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`
    return `${Math.floor(mins / (60 * 24))}d`
  }

  function phaseTone(phase: string, paused = false): string {
    if (paused) return 'bg-muted text-muted-foreground'
    if (phase === 'Running') return 'bg-success/15 text-success'
    if (phase === 'Pending' || phase === 'Progressing') return 'bg-warning/15 text-warning'
    if (phase === 'Failed') return 'bg-destructive/15 text-destructive'
    return 'bg-muted text-muted-foreground'
  }

  /** Open the session bound to a sandbox/service (its name IS the session id). */
  function openSession(id: string) {
    if (!store.sessionById(id)) return
    store.pickSession(id)
  }

  async function deleteSandbox(s: SandboxInfo) {
    const ok = await confirmDialog({
      title: t('deleteSandboxTitle'),
      body: t('deleteSandboxBody', { arg1: s.name }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    try {
      await store.api.deleteSandbox(s.name)
      showToast(t('deleted'))
      store.dropData('service-lists')
      await load()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  async function deleteService(sv: ServiceInfo) {
    const ok = await confirmDialog({
      title: t('deleteServiceTitle'),
      body: t('deleteServiceBody', { arg1: sv.name }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    try {
      await store.api.deleteService(sv.name)
      showToast(t('deleted'))
      store.dropData('service-lists')
      await load()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  async function togglePause(sv: ServiceInfo) {
    try {
      if (sv.paused) await store.api.resumeService(sv.name)
      else await store.api.pauseService(sv.name)
      store.dropData('service-lists')
      await load()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  const tabDefs = [
    { id: 'sandboxes' as const, key: 'sandboxes', icon: AppIcons.box },
    { id: 'services' as const, key: 'services', icon: AppIcons.server },
    { id: 'pvcs' as const, key: 'pvcs', icon: AppIcons.database },
  ]

  const stageDefs = [
    { id: 'all' as const, key: 'serviceStageAll' },
    { id: 'release' as const, key: 'serviceStageRelease' },
    { id: 'preview' as const, key: 'serviceStagePreview' },
  ]
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader title={t('tabService')}>
    {#snippet right()}
      <IconButton icon={AppIcons.refresh} label={t('refresh')} onclick={() => void load()} />
    {/snippet}
  </PageHeader>

  <TabBar>
    {#each tabDefs as tb (tb.id)}
      <TabItem active={tab === tb.id} onclick={() => (tab = tb.id)}>
        <tb.icon class="size-3.5" />{t(tb.key)}
      </TabItem>
    {/each}
  </TabBar>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading && sandboxes.length === 0 && services.length === 0 && pvcs.length === 0}
      <!-- skeleton rows: no flash-of-empty while the first load lands -->
      {#each [0, 1, 2] as i (i)}
        <div class="flex items-center gap-3 border-b border-border/40 px-3 py-2.5">
          <span class="size-8 shrink-0 animate-pulse rounded-full bg-muted"></span>
          <span class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class="h-3 w-1/3 animate-pulse rounded bg-muted"></span>
            <span class="h-2.5 w-1/2 animate-pulse rounded bg-muted"></span>
          </span>
        </div>
      {/each}
    {:else if tab === 'sandboxes'}
      {#if sandboxes.length === 0}
        <EmptyState>{t('noSandboxes')}</EmptyState>
      {:else}
        {#each sandboxes as s (s.name)}
          <ListRow divided onclick={() => store.navigate({ kind: 'sandbox_detail', key: `sbx:${s.name}`, name: s.name })}>
            <span class={cn('flex size-8 shrink-0 items-center justify-center rounded-full', phaseTone(s.phase))}><AppIcons.box class="size-4" /></span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2"><span class="wrap-anywhere text-meta font-semibold">{s.name}</span></span>
              <span class="block break-all whitespace-pre-wrap text-[10px] text-muted-foreground">{s.image}</span>
              {#if s.session}
                <span class="mt-0.5 flex min-w-0 items-start gap-1 text-[10px] text-muted-foreground">
                  <AppIcons.chat_round class="mt-px size-3 shrink-0" />
                  {#if store.sessionById(s.session)}
                    <button
                      type="button"
                      class="min-w-0 text-left break-all whitespace-pre-wrap text-primary hover:underline"
                      onclick={e => { e.stopPropagation(); openSession(s.session) }}
                    >{s.session}</button>
                  {:else}
                    <span class="min-w-0 break-all whitespace-pre-wrap">{s.session}</span>
                  {/if}
                </span>
              {:else}
                <span class="block wrap-anywhere text-[10px] text-muted-foreground">{s.creator} · {relTime(s.createdAt)}</span>
              {/if}
            </span>
            <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', phaseTone(s.phase))}>{s.phase}</span>
            <button
              type="button"
              class="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
              title={t('deleteSandboxTitle')}
              onclick={e => { e.stopPropagation(); void deleteSandbox(s) }}
            ><AppIcons.delete class="size-3.5" /></button>
          </ListRow>
        {/each}
      {/if}
    {:else if tab === 'services'}
      {#if services.length === 0}
        <EmptyState>{t('noServices')}</EmptyState>
      {:else}
        <div class="flex items-center gap-1 border-b border-border/40 px-3 py-1.5">
          {#each stageDefs as st (st.id)}
            <button
              type="button"
              class={cn('rounded-full border px-2.5 py-0.5 text-micro', stageFilter === st.id ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}
              onclick={() => (stageFilter = st.id)}
            >{t(st.key)}{#if st.id === 'release'} · {releaseServices.length}{:else if st.id === 'preview'} · {previewServices.length}{/if}</button>
          {/each}
        </div>
        {#if (stageFilter === 'all' || stageFilter === 'release') && releaseServices.length > 0}
          <div class="border-b border-border/40 bg-muted/30 px-3 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t('serviceStageRelease')} · {releaseServices.length}</div>
          {#each releaseServices as sv (sv.name)}
            {@render serviceRow(sv)}
          {/each}
        {/if}
        {#if (stageFilter === 'all' || stageFilter === 'preview') && previewServices.length > 0}
          <div class="border-b border-border/40 bg-warning/5 px-3 py-1 text-[10px] font-semibold tracking-wider text-warning uppercase">{t('serviceStagePreview')} · {previewServices.length}</div>
          {#each previewServices as sv (sv.name)}
            {@render serviceRow(sv)}
          {/each}
        {/if}
        {#if stageFilter !== 'all' && (stageFilter === 'release' ? releaseServices : previewServices).length === 0}
          <EmptyState>{t('noServices')}</EmptyState>
        {/if}
      {/if}
    {:else}
      {#if pvcs.length === 0}
        <EmptyState>{t('noPVCs')}</EmptyState>
      {:else}
        {#each pvcs as p (p.name)}
          <ListRow divided>
            <span class={cn('flex size-8 shrink-0 items-center justify-center rounded-full', p.phase === 'Bound' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}><AppIcons.database class="size-4" /></span>
            <span class="min-w-0 flex-1">
              <span class="block wrap-anywhere text-meta font-semibold">{p.name}</span>
              <span class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                <span>{p.size}</span>
                <span>{p.storageClass}</span>
                <span>{p.creator || '—'} · {relTime(p.createdAt)}</span>
              </span>
              {#if p.mountedBy.length}
                <span class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                  <AppIcons.server class="size-3 shrink-0" />
                  {#each p.mountedBy as m (m)}
                    <button type="button" class="min-w-0 break-all text-left text-primary hover:underline" onclick={() => store.navigate({ kind: 'service_detail', key: `svc:${m}`, name: m })}>{m}</button>
                  {/each}
                </span>
              {/if}
            </span>
            <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', p.phase === 'Bound' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>{p.phase}</span>
          </ListRow>
        {/each}
      {/if}
    {/if}
  </div>

{#snippet serviceRow(sv: ServiceInfo)}
  <ListRow divided onclick={() => store.navigate({ kind: 'service_detail', key: `svc:${sv.name}`, name: sv.name })}>
    <span class={cn('flex size-8 shrink-0 items-center justify-center rounded-full', phaseTone(sv.phase, sv.paused))}><AppIcons.server class="size-4" /></span>
    <span class="min-w-0 flex-1">
      <span class="flex min-w-0 items-center gap-2">
        <span class="wrap-anywhere text-meta font-semibold">{sv.name}</span>
        {#if sv.stage === 'preview'}<span class="shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[9px] leading-4 text-warning">{t('serviceStagePreview')}</span>{/if}
      </span>
      <span class="block break-all whitespace-pre-wrap text-[10px] text-muted-foreground">{sv.image}</span>
      <span class="mt-0.5 flex min-w-0 items-start gap-1 text-[10px] text-muted-foreground">
        <AppIcons.chat_round class="mt-px size-3 shrink-0" />
        {#if sv.session}
          {#if store.sessionById(sv.session)}
            <button
              type="button"
              class="min-w-0 text-left break-all whitespace-pre-wrap text-primary hover:underline"
              onclick={e => { e.stopPropagation(); openSession(sv.session) }}
            >{sv.session}</button>
          {:else}
            <span class="min-w-0 break-all whitespace-pre-wrap">{sv.session}</span>
          {/if}
        {:else}
          <span class="min-w-0 break-all whitespace-pre-wrap">{t('roleAdmin')}</span>
        {/if}
        <span class="shrink-0">· {sv.readyReplicas}/{sv.replicas} ready</span>
      </span>
      {#if sv.ports.length}
        <span class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {#each sv.ports as p (p.name + p.protocol + p.port)}
            <span class="font-mono">{p.protocol}:{p.port}→{p.targetPort}{p.name ? ` (${p.name})` : ''}</span>
          {/each}
        </span>
      {/if}
      {#if sv.publicUrl}
        <span class="mt-0.5 flex min-w-0 flex-col gap-0.5 text-[10px]">
          {#each sv.ports.filter(p => p.publicUrl) as p (p.publicUrl)}
            <span class="flex min-w-0 items-center gap-1">
              <a
                href={p.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="min-w-0 break-all text-primary hover:underline"
                title={p.publicUrl}
                onclick={e => e.stopPropagation()}
              >{p.publicUrl}</a>
              <button type="button" class="shrink-0 rounded p-0.5 hover:bg-muted" title={t('copy')} onclick={e => { e.stopPropagation(); copyUrl(p.publicUrl) }}><AppIcons.copy class="size-3" /></button>
            </span>
          {/each}
        </span>
      {:else}
        <span class="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <span class="min-w-0 break-all">{sv.url}</span>
          <button type="button" class="shrink-0 rounded p-0.5 hover:bg-muted" title={t('copy')} onclick={e => { e.stopPropagation(); copyUrl(sv.url) }}><AppIcons.copy class="size-3" /></button>
        </span>
      {/if}
      {#if sv.stage === 'preview' && sv.expiresAt > 0}
        <span class="mt-0.5 block text-[10px] text-warning">{t('serviceTtl')}: {ttlLabel(sv.expiresAt)}</span>
      {/if}
    </span>
    <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', phaseTone(sv.phase, sv.paused))}>{sv.paused ? t('servicePaused') : sv.ready ? 'Ready' : sv.phase}</span>
    <button
      type="button"
      class="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-primary"
      title={sv.paused ? t('resume') : t('pause')}
      onclick={e => { e.stopPropagation(); void togglePause(sv) }}
    >{#if sv.paused}<AppIcons.play class="size-3.5" />{:else}<AppIcons.pause class="size-3.5" />{/if}</button>
    <button
      type="button"
      class="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
      title={t('deleteServiceTitle')}
      onclick={e => { e.stopPropagation(); void deleteService(sv) }}
    ><AppIcons.delete class="size-3.5" /></button>
  </ListRow>
{/snippet}
</div>
