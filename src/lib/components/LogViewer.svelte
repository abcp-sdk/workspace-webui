<script lang="ts">
  // LogViewer — a shared monospace output surface with search (hit counter),
  // copy, download and follow-the-tail. Used by the sandbox job page and the
  // service log page so both get the same controls. The caller owns the data
  // (streaming / polling); this component only renders and filters.
  //
  // `lines` is appended to as output streams in; `follow` (bindable) auto-scrolls
  // to the bottom while the user is pinned there. A caller may put extra
  // controls (e.g. a previous-instance / stream-source toggle) in `controls`.
  import type { Snippet } from 'svelte'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import { parseAnsi, stripAnsi } from '$lib/ansi'

  let {
    lines,
    error = '',
    waitingText = '',
    follow = $bindable(true),
    showFollow = true,
    caption = '',
    downloadName = 'output.log',
    controls,
  }: {
    lines: string[]
    error?: string
    waitingText?: string
    follow?: boolean
    /** Show the built-in auto-scroll toggle. Off when the caller owns a
     *  separate "follow" control (e.g. a live-stream switch). */
    showFollow?: boolean
    /** A short note shown before the controls (e.g. a truncation warning). */
    caption?: string
    downloadName?: string
    controls?: Snippet
  } = $props()

  let searching = $state(false)
  let q = $state('')
  let outEl: HTMLElement | null = $state(null)

  const filtered = $derived.by(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return lines
    return lines.filter(l => stripAnsi(l).toLowerCase().includes(needle))
  })

  /** Parse once per line for the filtered view. */
  const rows = $derived(filtered.map(l => parseAnsi(l)))

  // Auto-follow the tail ONLY while the user is pinned to the bottom.
  function atBottom(): boolean {
    if (!outEl) return true
    return outEl.scrollHeight - outEl.scrollTop - outEl.clientHeight < 24
  }
  $effect(() => {
    void lines.length
    if (follow && outEl && atBottom()) outEl.scrollTop = outEl.scrollHeight
  })

  function copyAll() {
    const text = lines.map(stripAnsi).join('\n')
    void navigator.clipboard?.writeText(text).then(
      () => showToast(t('copied')),
      () => showErrorToast(t('copyFailed')),
    )
  }

  function download() {
    const text = lines.map(stripAnsi).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = downloadName
    a.click()
    URL.revokeObjectURL(url)
  }
</script>

<div class="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
  <button
    type="button"
    class={cn('rounded p-1', searching && 'bg-muted text-foreground')}
    title={t('search')}
    onclick={() => { searching = !searching; if (!searching) q = '' }}
  ><AppIcons.search class="size-3.5" /></button>
  {#if searching}
    <input bind:value={q} class="h-6 min-w-0 flex-1 rounded border border-input bg-transparent px-2 text-[11px] outline-none" placeholder={t('searchHint')} />
    <span class="shrink-0">{filtered.length}/{lines.length}</span>
  {/if}
  {#if controls}{@render controls()}{/if}
  {#if caption}<span class="shrink-0 text-warning">{caption}</span>{/if}
  {#if showFollow}
    <label class="ml-auto flex items-center gap-1">
      <input type="checkbox" bind:checked={follow} /> {t('followOutput')}
    </label>
  {:else}
    <span class="ml-auto"></span>
  {/if}
  <button type="button" class="rounded p-1 hover:bg-muted" title={t('copy')} onclick={copyAll}><AppIcons.copy class="size-3.5" /></button>
  <button type="button" class="rounded p-1 hover:bg-muted" title={t('download')} onclick={download}><AppIcons.download class="size-3.5" /></button>
</div>

<div bind:this={outEl} class="min-h-0 flex-1 overflow-auto bg-black/90 p-3 font-mono text-[11px] leading-relaxed text-green-200">
  {#if error}
    <div class="text-red-300">{error}</div>
  {:else if rows.length === 0}
    <div class="text-muted-foreground">{lines.length === 0 ? waitingText : t('noMatches')}</div>
  {:else}
    {#each rows as segs, i (i)}
      <div class="whitespace-pre-wrap">{#each segs as seg, j (j)}<span class={seg.cls}>{seg.text}</span>{/each}</div>
    {/each}
  {/if}
</div>
