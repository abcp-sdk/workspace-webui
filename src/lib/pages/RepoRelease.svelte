<script lang="ts">
  // RepoRelease — one release as a full page: tag/name/body + downloadable
  // assets (proxied by the gateway). Opened from the Releases sub-tab.
  import type { PageProps } from '$lib/page-props'
  import type { ReleaseInfo, ReleaseAsset } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { formatBytes } from '$lib/media'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let {
    store,
    org,
    repo,
    tag,
    showBack = false,
  }: PageProps & { org: string; repo: string; tag: string } = $props()

  const api = $derived(store.api)

  let release = $state<ReleaseInfo | null>(null)
  let loading = $state(true)

  $effect(() => {
    const o = org, r = repo, tg = tag
    void o
    void r
    void tg
    void load()
  })

  async function load() {
    loading = true
    try {
      const all = await api.listReleases(org, repo)
      release = all.find(x => x.tagName === tag) ?? null
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
  }

  async function downloadAsset(a: ReleaseAsset) {
    if (!release) return
    try {
      const { data } = await api.getReleaseAsset(org, repo, a.releaseId, a.id)
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }))
      const el = document.createElement('a')
      el.href = url
      el.download = a.name
      el.click()
      el.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast(t('download'))
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  function relTime(iso: string): string {
    const d = Date.parse(iso)
    if (isNaN(d)) return ''
    const mins = Math.floor((Date.now() - d) / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return `${mins}m`
    if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`
    return `${Math.floor(mins / (60 * 24))}d`
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.rocket class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{release?.name || tag}</span>
    {#if release?.prerelease}<span class="shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[10px] text-warning">{t('prerelease')}</span>{/if}
    {#if release?.draft}<span class="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{t('draft')}</span>{/if}
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
    {:else if !release}
      <EmptyState>{t('noReleases')}</EmptyState>
    {:else}
      <div class="border-b border-border/50 px-4 py-3 text-micro text-muted-foreground">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded bg-muted px-1.5 py-px font-mono">{release.tagName}</span>
          <span>{release.author || '—'}</span>
          <span>{relTime(release.publishedAt || release.createdAt)}</span>
        </div>
        {#if release.body}<div class="mt-2 whitespace-pre-wrap text-meta text-foreground">{release.body}</div>{/if}
      </div>
      {#if release.assets.length}
        <div class="px-4 py-3">
          <div class="mb-2 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('assets')} · {release.assets.length}</div>
          <div class="space-y-1">
            {#each release.assets as a (a.id)}
              <button type="button" class="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted" onclick={() => void downloadAsset(a)}>
                <AppIcons.file_archive class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate font-mono text-[11px]">{a.name}</span>
                {#if a.downloadCount}<span class="shrink-0 text-[10px] text-muted-foreground">↓{a.downloadCount}</span>{/if}
                <span class="shrink-0 text-[10px] text-muted-foreground">{formatBytes(a.size)}</span>
                <AppIcons.download class="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
