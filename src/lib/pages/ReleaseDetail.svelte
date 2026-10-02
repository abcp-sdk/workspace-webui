<script lang="ts">
  // ReleaseDetail — one Helm release as a full pane: its live meta (namespace /
  // creator / session / chart ref / blue-green slots) plus the FULL revision
  // history. Each revision expands to its applied OBJECTS (`Kind/name`), its
  // `values`, its `ref@chartPath` and when it was created — so "how many
  // objects does this chart have" is answerable from the UI.
  //
  // Data comes from HelmHistory (revisions) and HelmList (the release's live
  // row); both are cached per page so a pane SLIDE does not refetch.
  import type { PageProps } from '$lib/page-props'
  import type { HelmRelease, HelmRevision } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store, name, showBack = false }: PageProps & { name: string } = $props()

  const api = $derived(store.api)

  let release = $state<HelmRelease | null>(null)
  let revisions = $state<HelmRevision[]>([])
  let loading = $state(true)
  // The expanded revision (null = all collapsed). Defaults to the newest.
  let openRev = $state<number | null>(null)

  async function load() {
    loading = true
    try {
      const [meta, revs] = await Promise.all([
        store.dataLoad(
          `helm-release:${name}`,
          async () =>
            (await api.helmList()).find(r => r.name === name) ?? null,
        ),
        store.dataLoad(`helm-hist:${name}`, () => api.helmHistory(name)),
      ])
      release = meta
      // Newest revision first.
      revisions = [...revs].sort((a, b) => b.revision - a.revision)
      if (openRev === null && revisions.length) openRev = revisions[0]!.revision
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
  }

  $effect(() => {
    void name
    void load()
  })

  async function refresh() {
    store.dropData(`helm-release:${name}`)
    store.dropData(`helm-hist:${name}`)
    await load()
  }

  async function promoteRelease() {
    try {
      await api.helmPromote(name)
      showToast(t('promoted'))
      await refresh()
    } catch (e) {
      showErrorToast(String(e))
    }
  }
  async function rollbackRelease() {
    try {
      await api.helmRollbackRelease(name)
      showToast(t('rolledBack'))
      await refresh()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  function relTime(ms: number): string {
    if (!ms) return ''
    const mins = Math.floor((Date.now() - ms) / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return `${mins}m`
    if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`
    return `${Math.floor(mins / (60 * 24))}d`
  }

  const deployed = $derived(release?.status === 'deployed')
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.pkg class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 wrap-anywhere text-base font-semibold">{name}</span>
    {#if release}
      <span class="shrink-0 text-[10px] text-muted-foreground">rev{release.revision}</span>
      <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', deployed ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')}>{release.status}</span>
    {/if}
    <IconButton icon={AppIcons.refresh} label={t('refresh')} onclick={() => void refresh()} />
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading && !release && revisions.length === 0}
      <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
    {:else if !release && revisions.length === 0}
      <EmptyState>{t('noHelmReleases')}</EmptyState>
    {:else}
      {#if release}
        <div class="shrink-0 border-b border-border/50 px-4 py-2 text-[10px] text-muted-foreground">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span class="flex items-center gap-1"><AppIcons.layers class="size-3" />{t('tcChart')}: <span class="font-mono text-foreground">{release.chartPath || '.'}@{release.ref || 'HEAD'}</span></span>
            {#if release.chartVersion}<span class="font-mono">v{release.chartVersion}</span>{/if}
            {#if release.appVersion}<span>app {release.appVersion}</span>{/if}
            {#if release.objects.length}<span>{release.objects.length} {t('releaseObjects')}</span>{/if}
            {#if release.namespace}<span class="font-mono">{release.namespace}</span>{/if}
            {#if release.creator}<span class="flex items-center gap-1"><AppIcons.user class="size-3" />{release.creator}</span>{/if}
            {#if release.updatedAt}<span class="flex items-center gap-1"><AppIcons.clock class="size-3" />{relTime(release.updatedAt)}</span>{/if}
          </div>
          {#if release.session}
            <div class="mt-0.5 flex min-w-0 items-center gap-1">
              <AppIcons.chat_round class="size-3 shrink-0" />
              {#if store.sessionById(release.session)}
                <button type="button" class="min-w-0 break-all text-left text-primary hover:underline" onclick={() => release && store.pickSession(release.session)}>{release.session}</button>
              {:else}
                <span class="min-w-0 break-all">{release.session}</span>
              {/if}
            </div>
          {/if}
          {#if release.slots.length > 0}
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {#each release.slots as sl (sl.slot)}
                <span class="flex items-center gap-1">
                  <span class="rounded px-1 font-mono {sl.slot === release.activeSlot ? 'bg-primary/15 text-primary' : 'bg-muted'}">{sl.slot}{sl.slot === release.activeSlot ? ' *' : ''}</span>
                  <span class={cn(!sl.ready && 'text-warning')}>{sl.readyWorkload}/{sl.totalWorkload}</span>
                </span>
              {/each}
              <span class="ml-auto flex items-center gap-1">
                <button type="button" class="rounded border border-border px-2 py-0.5 hover:bg-muted" onclick={() => void promoteRelease()}>{t('servicePromote')}</button>
                <button type="button" class="rounded border border-border px-2 py-0.5 hover:bg-muted" onclick={() => void rollbackRelease()}>{t('serviceRollback')}</button>
              </span>
            </div>
          {/if}
        </div>
      {/if}

      <div class="px-4 py-2 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('releaseRevisions')} · {revisions.length}</div>
      {#if revisions.length === 0}
        <EmptyState>{t('noHelmReleases')}</EmptyState>
      {:else}
        {#each revisions as rv (rv.revision)}
          <div class="border-b border-border/40">
            <button
              type="button"
              class="flex w-full min-w-0 items-center gap-2 px-4 py-1.5 text-left text-meta hover:bg-muted/50"
              onclick={() => (openRev = openRev === rv.revision ? null : rv.revision)}
            >
              {#if openRev === rv.revision}<AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />{:else}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
              <span class="shrink-0 font-mono font-semibold">rev{rv.revision}</span>
              <span class="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{rv.chartPath || '.'}@{rv.ref || 'HEAD'}</span>
              <span class="shrink-0 text-[10px] text-muted-foreground">{relTime(rv.createdAt)}</span>
            </button>
            {#if openRev === rv.revision}
              <div class="min-w-0 space-y-2 px-4 pb-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <AppIcons.container class="size-3" />{t('releaseObjects')} · {rv.objects.length}
                  </div>
                  {#if rv.objects.length}
                    <div class="mt-0.5 min-w-0 rounded-sm border border-border/40">
                      {#each rv.objects as o (o)}
                        <div class="min-w-0 truncate border-b border-border/30 px-1.5 py-0.5 font-mono text-[11px] last:border-b-0">{o}</div>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <AppIcons.file_code class="size-3" />{t('releaseValues')}
                  </div>
                  {#if rv.values.trim()}
                    <details class="mt-0.5">
                      <summary class="cursor-pointer text-[10px] text-primary hover:underline">{t('releaseValues')}</summary>
                      <pre class="mt-1 max-h-72 min-w-0 overflow-auto rounded-sm bg-muted/40 p-1.5 font-mono text-[11px] whitespace-pre-wrap">{rv.values}</pre>
                    </details>
                  {:else}
                    <div class="mt-0.5 text-[10px] text-muted-foreground">{t('releaseNoValues')}</div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</div>
