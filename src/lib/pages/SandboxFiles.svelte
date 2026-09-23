<script lang="ts">
  // SandboxFiles — a READ-ONLY Finder-style browser over the sandbox (worker)
  // filesystem, plus an inline viewer. Ported from the worker's own control
  // panel, but reached through the gateway (which proxies the worker file
  // RPCs) so the browser needs only a tenant token.
  //
  // Paths: the worker accepts a relative path (resolved against its workspace)
  // or an absolute one (used verbatim — the worker may touch any path in its
  // container). We keep an ABSOLUTE path as the page state and anchor the
  // display on `~` (home) / the workspace root.
  import type { PageProps } from '$lib/page-props'
  import type { SandboxInfo } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import {
    guessMime,
    previewKind,
    formatBytes,
    isTextMime,
    type PreviewKind,
  } from '$lib/file-types'
  import {
    absOf,
    basename,
    crumbsOf,
    displayPath,
    normAbs,
    parentOf,
    rootOf,
    sandboxAnchors,
    setSandboxAnchors,
  } from '$lib/sandbox-paths'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import CodeSurface from '$lib/components/CodeSurface.svelte'
  import BlobView from '$lib/components/BlobView.svelte'

  let {
    store,
    name,
    path = '',
    showBack = false,
  }: PageProps & { name: string; path?: string } = $props()

  // Media previews load the whole file into one RPC/message; cap them so a
  // huge file cannot blow up memory. Larger files offer Download only.
  const PREVIEW_MAX = 32 * 1024 * 1024

  let sandbox = $state<SandboxInfo | null>(null)
  let ready = $state(false) // anchors applied
  let dir = $state('') // absolute dir currently listed
  let entries = $state<{ path: string; name: string; isDir: boolean; size: number }[]>([])
  let loading = $state(false)
  let err = $state('')

  // open file state
  let file = $state('') // absolute path
  let fileKind = $state<PreviewKind>('text')
  let fileSize = $state(0)
  let text = $state('')
  let url = $state('')
  let tooBig = $state(false)

  let toast = $state('')
  function say(msg: string) {
    toast = msg
    setTimeout(() => (toast = ''), 2500)
  }

  function releaseUrl() {
    if (url) {
      URL.revokeObjectURL(url)
      url = ''
    }
  }

  /** Load the sandbox (for the workspace/home anchors), then open `path`. */
  $effect(() => {
    const n = name
    void n
    void init()
  })

  async function init() {
    ready = false
    try {
      sandbox = await store.api.getSandbox(name)
    } catch (e) {
      showErrorToast(String(e))
    }
    setSandboxAnchors({
      workspace: sandbox?.workspace ?? '',
      home: sandbox?.home ?? '',
    })
    ready = true
    // Open the requested target (file or dir); '' = the workspace root.
    await open(absOf(path))
  }

  /** Open an absolute path: a directory lists, a file views. */
  async function open(target: string) {
    const abs = normAbs(target)
    loading = true
    err = ''
    try {
      const r = await store.api.listSandboxFiles(name, abs, 1, 2000)
      if (r.isDir) {
        closeFile()
        dir = abs
        entries = r.files
          .map(f => {
            const a = absOf(f.path)
            return { path: a, name: basename(a), isDir: f.isDir, size: f.size }
          })
          .sort((a, b) =>
            a.isDir === b.isDir
              ? a.name.localeCompare(b.name)
              : a.isDir
                ? -1
                : 1,
          )
      } else {
        // A file: list on it returns is_dir=false. Open it; the listing dir
        // becomes its parent.
        dir = parentOf(abs)
        void openFile(abs, r.files[0]?.size ?? 0)
      }
    } catch (e) {
      err = String(e)
      entries = []
    }
    loading = false
  }

  function activate(e: { path: string; isDir: boolean; size: number }) {
    if (e.isDir) void open(e.path)
    else void openFile(e.path, e.size)
  }

  async function openFile(abs: string, size: number) {
    releaseUrl()
    file = abs
    text = ''
    tooBig = false
    const nm = basename(abs)
    const mime = guessMime(nm)
    fileKind = previewKind(mime, nm)
    fileSize = size
    const isText =
      isTextMime(mime) ||
      fileKind === 'code' ||
      fileKind === 'json' ||
      fileKind === 'csv' ||
      fileKind === 'markdown' ||
      fileKind === 'html' ||
      fileKind === 'text'
    const isMedia =
      fileKind === 'image' || fileKind === 'video' || fileKind === 'audio'
    try {
      if (isText) {
        const r = await store.api.readSandboxFile(name, abs)
        text = new TextDecoder('utf-8', { fatal: false }).decode(r.data)
        fileSize = r.data.length || size
      } else if (isMedia && size > PREVIEW_MAX) {
        tooBig = true
      } else {
        const r = await store.api.readSandboxFile(name, abs)
        fileSize = r.data.length || size
        url = URL.createObjectURL(
          new Blob([new Uint8Array(r.data)], { type: mime || 'application/octet-stream' }),
        )
      }
    } catch (e) {
      say(String(e))
      file = ''
    }
  }

  function closeFile() {
    releaseUrl()
    file = ''
    text = ''
    tooBig = false
  }

  /** Download the currently open file (reads the bytes fresh). */
  async function download() {
    if (!file) return
    try {
      const r = await store.api.readSandboxFile(name, file)
      const blob = new Blob([new Uint8Array(r.data)], {
        type: guessMime(basename(file)) || 'application/octet-stream',
      })
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = basename(file)
      a.click()
      URL.revokeObjectURL(u)
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  const crumbs = $derived(ready ? crumbsOf(dir || absOf('')) : [])
  const ws = $derived(sandboxAnchors().workspace || '/')
  const home = $derived(sandboxAnchors().home)
  const canUp = $derived(!!dir && dir !== rootOf(dir))

  function up() {
    const p = parentOf(dir)
    if (p) void open(p)
  }

  $effect(() => () => releaseUrl())
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.folder class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{name}</span>
    <span class="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] leading-4 text-muted-foreground">{t('files')}</span>
  </PageHeader>

  <!-- toolbar -->
  <div class="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
    <IconButton icon={AppIcons.back} label={t('up')} disabled={!canUp} onclick={up} />
    <IconButton icon={AppIcons.folder} label={t('workspaceRoot')} onclick={() => void open(ws)} />
    {#if home}
      <IconButton icon={AppIcons.user} label={t('home')} onclick={() => void open(home)} />
    {/if}
    <span class="ml-auto"></span>
    <IconButton icon={AppIcons.refresh} label={t('refresh')} onclick={() => void open(file ? parentOf(file) : dir)} />
    <IconButton icon={AppIcons.close} label={t('close')} onclick={() => store.popPage()} />
  </div>

  <!-- breadcrumb -->
  <div class="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
    {#each crumbs as c, i (c.path)}
      {#if i > 0}<AppIcons.chevron_right class="size-3 shrink-0 opacity-50" />{/if}
      <button type="button" class="rounded px-1 hover:bg-muted hover:text-foreground" onclick={() => void open(c.path)}>{c.name}</button>
    {/each}
    {#if file}
      <AppIcons.chevron_right class="size-3 shrink-0 opacity-50" />
      <span class="truncate px-1 text-foreground">{basename(file)}</span>
    {/if}
  </div>

  {#if !ready}
    <div class="flex flex-1 items-center justify-center">
      <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
    </div>
  {:else if file}
    <!-- file viewer -->
    <div class="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-1 text-micro text-muted-foreground">
      <AppIcons.file class="size-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate font-mono">{displayPath(file)}</span>
      {#if fileSize}<span class="shrink-0">{formatBytes(fileSize)}</span>{/if}
      <button type="button" class="shrink-0 rounded p-1 hover:bg-muted" title={t('download')} onclick={() => void download()}><AppIcons.download class="size-3.5" /></button>
      <button type="button" class="shrink-0 rounded p-1 hover:bg-muted" title={t('close')} onclick={closeFile}><AppIcons.close class="size-3.5" /></button>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden bg-card">
      {#if tooBig}
        <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <AppIcons.file class="size-10 text-muted-foreground/60" />
          <div class="text-meta text-muted-foreground">{formatBytes(fileSize)} {t('tooLargeToPreview')}</div>
          <button type="button" class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80" onclick={() => void download()}>
            <AppIcons.download class="size-4" />{t('download')}
          </button>
        </div>
      {:else if fileKind === 'text' || fileKind === 'code' || fileKind === 'json' || fileKind === 'csv' || fileKind === 'markdown' || fileKind === 'html'}
        <CodeSurface code={text} name={basename(file)} />
      {:else if url}
        <BlobView name={basename(file)} mime={guessMime(basename(file))} {url} size={fileSize} isText={false} />
      {:else}
        <div class="flex h-full items-center justify-center"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
      {/if}
    </div>
  {:else}
    <!-- directory listing -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if loading}
        <div class="flex justify-center py-10">
          <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
        </div>
      {:else if err}
        <div class="px-4 py-2 text-meta text-destructive">{err}</div>
      {:else if entries.length === 0}
        <EmptyState>{t('emptyDir')}</EmptyState>
      {:else}
        {#each entries as e (e.path)}
          <button
            type="button"
            class={cn('flex w-full items-center gap-2 border-b border-border/30 px-3 py-1.5 text-left hover:bg-muted')}
            onclick={() => activate(e)}
          >
            {#if e.isDir}<AppIcons.folder class="size-4 shrink-0 text-primary" />{:else}<AppIcons.file class="size-4 shrink-0 text-muted-foreground" />{/if}
            <span class="min-w-0 flex-1 truncate text-meta">{e.name}</span>
            <span class="shrink-0 text-[10px] text-muted-foreground">{e.isDir ? '' : formatBytes(e.size)}</span>
            {#if e.isDir}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  {#if toast}
    <div class="absolute inset-x-0 bottom-0 z-10 bg-popover px-3 py-1.5 text-micro text-foreground">{toast}</div>
  {/if}
</div>
