<script lang="ts">
  // BlobView — GitHub-blob-style renderer for one repository file.
  //
  //   * text (is_text): source with line numbers + Shiki highlighting; the
  //     content is NEVER rendered (markdown stays source, html stays markup).
  //   * image / video: inline media controls; a click opens the full view and
  //     a download button saves the file.
  //   * anything else (pdf / office / archives / binary): a "non-text file"
  //     notice with the size and a download button — no rendering.
  import { t } from '$lib/i18n.svelte'
  import { formatBytes } from '$lib/media'
  import { AppIcons } from '$lib/icons'
  import { cn } from '$lib/utils'
  import CodeSurface from './CodeSurface.svelte'

  let {
    name,
    mime,
    url,
    size,
    isText,
  }: { name: string; mime: string; url: string; size: number; isText: boolean } = $props()

  let code = $state('')
  let decoding = $state(true)

  const ext = $derived(name.split('.').pop()?.toLowerCase() ?? '')
  const isImage = $derived(mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext))
  const isVideo = $derived(mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'ogv'].includes(ext))
  const isAudio = $derived(mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext))

  // Decode text content (only when the server classified it as text).
  $effect(() => {
    let cancelled = false
    if (!isText || !url) {
      decoding = false
      return
    }
    decoding = true
    void (async () => {
      try {
        const res = await fetch(url)
        const txt = await res.text()
        if (!cancelled) code = txt
      } catch {
        if (!cancelled) code = ''
      }
      if (!cancelled) decoding = false
    })()
    return () => {
      cancelled = true
    }
  })

  /** Open the full image in a new tab (a preview — not a download). */
  function openFull() {
    window.open(url, '_blank', 'noopener')
  }
</script>

{#if decoding}
  <div class="flex h-full items-center justify-center">
    <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
  </div>
{:else if isImage}
  <div class="flex h-full items-center justify-center p-4">
    <button type="button" class="max-h-full max-w-full cursor-zoom-in" onclick={openFull} title={t('openImage')}>
      <img src={url} alt={name} class="max-h-full max-w-full rounded object-contain" />
    </button>
  </div>
{:else if isVideo}
  <div class="flex h-full items-center justify-center p-4">
    <video src={url} controls class="max-h-full max-w-full rounded"><track kind="captions" /></video>
  </div>
{:else if isAudio}
  <div class="flex h-full items-center justify-center p-4">
    <audio src={url} controls class="w-full max-w-md"><track kind="captions" /></audio>
  </div>
{:else if isText}
  <CodeSurface {code} {name} />
{:else}
  <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
    <AppIcons.file class="size-10 text-muted-foreground/60" />
    <div class="text-body font-medium">{t('nonTextFile')}</div>
    {#if size > 0}<div class="text-micro text-muted-foreground">{formatBytes(size)}</div>{/if}
    <a
      href={url}
      download={name}
      class={cn('mt-1 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80')}
    >
      <AppIcons.download class="size-4" />{t('download')}
    </a>
  </div>
{/if}
