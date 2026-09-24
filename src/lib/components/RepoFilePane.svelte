<script lang="ts">
  // RepoFilePane — one repository file rendered inline (fetch raw bytes, then
  // BlobView). Embedded as the RIGHT column of RepoDetail's Files tab so the
  // directory list and the file content stay visible side by side; RepoBlob
  // reuses it as a standalone full page.
  import type { AppStore } from '$lib/store.svelte'
  import { t } from '$lib/i18n.svelte'
  import { formatBytes } from '$lib/media'
  import { showErrorToast } from '$lib/toast.svelte'
  import { AppIcons } from '$lib/icons'
  import BlobView from '$lib/components/BlobView.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'

  let {
    store,
    org,
    repo,
    ref,
    path,
    chrome = true,
  }: { store: AppStore; org: string; repo: string; ref: string; path: string; chrome?: boolean } = $props()

  const api = $derived(store.api)

  let url = $state('')
  let loading = $state(true)
  let size = $state(0)
  let mime = $state('')
  let isText = $state(false)
  let error = $state(false)

  const name = $derived(path.split('/').pop() ?? path)

  $effect(() => {
    let cancelled = false
    let made = ''
    const o = org, r = repo, rf = ref, p = path
    // Cache-first by page identity: a pane SLIDE re-runs this effect but must
    // not refetch. The object URL is per-mount (revoked on teardown); only the
    // raw bytes are cached.
    const key = `blob:${o}/${r}@${rf}:${p}`
    loading = !store.hasData(key)
    error = false
    void (async () => {
      try {
        const res = await store.dataLoad(key, () => api.readRaw(o, r, rf, p))
        if (cancelled) return
        const blob = new Blob([new Uint8Array(res.data)], { type: res.mime || 'application/octet-stream' })
        made = URL.createObjectURL(blob)
        url = made
        size = res.data.length
        mime = res.mime
        isText = res.isText
      } catch (e) {
        if (!cancelled) {
          error = true
          showErrorToast(String(e))
        }
      }
      if (!cancelled) loading = false
    })()
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  })
</script>

<div class="flex h-full w-full min-w-0 flex-col">
  {#if chrome}
    <div class="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5">
      <AppIcons.file_code class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate text-meta font-medium">{name}</span>
      {#if size}<span class="shrink-0 text-[10px] text-muted-foreground">{formatBytes(size)}</span>{/if}
      {#if url}
        <a href={url} download={name} class="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted" title={t('download')}><AppIcons.download class="size-4" /></a>
      {/if}
    </div>
  {/if}
  <div class="min-h-0 flex-1 overflow-hidden bg-card">
    {#if loading}
      <div class="flex h-full items-center justify-center">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else if error}
      <EmptyState center>{t('loadError', { e: '' })}</EmptyState>
    {:else}
      <BlobView {name} {mime} {url} {size} {isText} />
    {/if}
  </div>
</div>
