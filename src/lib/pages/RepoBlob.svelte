<script lang="ts">
  // RepoBlob — read one repository file at a ref and render it GitHub-blob
  // style via BlobView: text as highlighted source with line numbers, images /
  // video as inline controls, and everything else as a non-text download.
  // Presentational: the parent (CodeTab) owns navigation.
  import type { AgentApi } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { formatBytes } from '$lib/media'
  import { showErrorToast } from '$lib/toast.svelte'
  import { AppIcons } from '$lib/icons'
  import BlobView from '$lib/components/BlobView.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'

  let {
    api,
    org,
    repo,
    ref,
    path,
    onBack,
    onMenu = null,
  }: {
    api: AgentApi
    org: string
    repo: string
    ref: string
    path: string
    onBack: () => void
    /** When set (compact), render a tree-drawer button in the header. */
    onMenu?: (() => void) | null
  } = $props()

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
    loading = true
    error = false
    void (async () => {
      try {
        const res = await api.readRaw(o, r, rf, p)
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

  function goBack() {
    onBack()
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if onMenu}<IconButton icon={AppIcons.list} label={t('tabCode')} onclick={onMenu} />{/if}
    <IconButton icon={AppIcons.back} onclick={goBack} />
    <AppIcons.file_code class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-base font-semibold">{name}</span>
      <span class="block truncate text-[10px] text-muted-foreground">{org}/{repo} · {ref}{size ? ` · ${formatBytes(size)}` : ''}</span>
    </span>
    {#if url}
      <a href={url} download={name} class="rounded p-1.5 text-muted-foreground hover:bg-muted" title={t('download')}><AppIcons.download class="size-[18px]" /></a>
    {/if}
  </PageHeader>

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
