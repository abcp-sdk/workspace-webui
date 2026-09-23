<script lang="ts">
  // ServiceRoot — the Service tab: read-only view of running sandboxes and
  // long-lived services. No deploy / delete / create actions in this surface.
  import type { PageProps } from '$lib/page-props'
  import type { SandboxInfo, ServiceInfo } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import TabBar from '$lib/components/layout/TabBar.svelte'
  import TabItem from '$lib/components/layout/TabItem.svelte'
  import ListRow from '$lib/components/layout/ListRow.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store }: PageProps = $props()

  let tab = $state<'sandboxes' | 'services'>('sandboxes')
  let sandboxes = $state<SandboxInfo[]>([])
  let services = $state<ServiceInfo[]>([])
  let loading = $state(true)

  async function load() {
    loading = true
    try {
      const [s, sv] = await Promise.all([store.api.listSandboxes(), store.api.listServices()])
      sandboxes = s
      services = sv
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
  }

  $effect(() => {
    void load()
    const id = setInterval(() => void load(), 15000)
    return () => clearInterval(id)
  })

  function relTime(ms: number): string {
    if (!ms) return ''
    const mins = Math.floor((Date.now() - ms) / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return `${mins}m`
    if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`
    return `${Math.floor(mins / (60 * 24))}d`
  }

  function phaseTone(phase: string): string {
    if (phase === 'Running') return 'bg-success/15 text-success'
    if (phase === 'Pending') return 'bg-warning/15 text-warning'
    if (phase === 'Failed') return 'bg-destructive/15 text-destructive'
    return 'bg-muted text-muted-foreground'
  }

  /** Open the session bound to a sandbox (its name IS the session id). */
  function openSession(id: string) {
    if (!store.sessionById(id)) return
    store.switchTab('chat')
    store.pickSession(id)
  }

  const tabDefs = [
    { id: 'sandboxes' as const, key: 'sandboxes', icon: AppIcons.box },
    { id: 'services' as const, key: 'services', icon: AppIcons.server },
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
    {#if loading && sandboxes.length === 0 && services.length === 0}
      <div class="flex justify-center py-10">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else if tab === 'sandboxes'}
      {#if sandboxes.length === 0}
        <EmptyState>{t('noSandboxes')}</EmptyState>
      {:else}
        {#each sandboxes as s (s.name)}
          <ListRow divided onclick={() => store.pushSibling({ kind: 'sandbox_detail', key: `sbx:${s.name}`, name: s.name })}>
            <span class={cn('flex size-8 shrink-0 items-center justify-center rounded-full', phaseTone(s.phase))}><AppIcons.box class="size-4" /></span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2"><span class="truncate text-meta font-semibold">{s.name}</span></span>
              <span class="block truncate text-[10px] text-muted-foreground">{s.image}</span>
              {#if s.session}
                <span class="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                  <AppIcons.chat_round class="size-3 shrink-0" />
                  {#if store.sessionById(s.session)}
                    <button
                      type="button"
                      class="min-w-0 truncate text-left text-primary hover:underline"
                      onclick={e => { e.stopPropagation(); openSession(s.session) }}
                    >{s.session}</button>
                  {:else}
                    <span class="min-w-0 truncate">{s.session}</span>
                  {/if}
                </span>
              {:else}
                <span class="block truncate text-[10px] text-muted-foreground">{s.creator} · {relTime(s.createdAt)}</span>
              {/if}
            </span>
            <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', phaseTone(s.phase))}>{s.phase}</span>
          </ListRow>
        {/each}
      {/if}
    {:else}
      {#if services.length === 0}
        <EmptyState>{t('noServices')}</EmptyState>
      {:else}
        {#each services as sv (sv.name)}
          <ListRow divided onclick={() => store.pushChild({ kind: 'service_detail', key: `svc:${sv.name}`, name: sv.name })}>
            <span class={cn('flex size-8 shrink-0 items-center justify-center rounded-full', phaseTone(sv.phase))}><AppIcons.server class="size-4" /></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-meta font-semibold">{sv.name}</span>
              <span class="block truncate text-[10px] text-muted-foreground">{sv.image}</span>
              <span class="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                <AppIcons.chat_round class="size-3 shrink-0" />
                {#if sv.session}
                  {#if store.sessionById(sv.session)}
                    <button
                      type="button"
                      class="min-w-0 truncate text-left text-primary hover:underline"
                      onclick={() => openSession(sv.session)}
                    >{sv.session}</button>
                  {:else}
                    <span class="min-w-0 truncate">{sv.session}</span>
                  {/if}
                {:else}
                  <span class="min-w-0 truncate">{t('roleAdmin')}</span>
                {/if}
                <span class="shrink-0">· {sv.replicas}×</span>
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
                    <a
                      href={p.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="min-w-0 truncate text-primary hover:underline"
                      onclick={e => e.stopPropagation()}
                    >{p.publicUrl}</a>
                  {/each}
                </span>
              {:else}
                <span class="mt-0.5 block truncate text-[10px] text-muted-foreground">{sv.url}</span>
              {/if}
            </span>
            <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', phaseTone(sv.phase))}>{sv.ready ? 'Ready' : sv.phase}</span>
          </ListRow>
        {/each}
      {/if}
    {/if}
  </div>
</div>
