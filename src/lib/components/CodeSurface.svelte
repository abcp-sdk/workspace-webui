<script lang="ts">
  // CodeSurface — GitHub-blob-style source viewer: a fixed line-number gutter
  // plus Shiki-highlighted code with HORIZONTAL scrolling. Rows are a fixed
  // height and only the visible window is rendered (self-contained virtual
  // scrolling), so multi-thousand-line files stay smooth.
  //
  // It NEVER renders the content (markdown stays markdown source, html stays
  // markup); only syntax coloring is applied.
  import { onMount } from 'svelte'
  import { highlightLines, langForName, themeFor, type Token } from '$lib/highlight'

  let { code, name }: { code: string; name: string } = $props()

  const ROW_H = 20 // px; must match the row line-height below
  const OVERSCAN = 12

  let host: HTMLElement | null = $state(null)
  let scrollTop = $state(0)
  let viewportH = $state(600)
  let dark = $state(false)

  let tokens = $state<Token[][] | null>(null)
  let rendered = $state<string[]>([])
  let tokenizing = $state(true)

  const rawLines = $derived(code.length ? code.split('\n') : [''])

  // Visible window (with overscan), clamped to the line count.
  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN))
  const visibleCount = $derived(Math.ceil(viewportH / ROW_H) + OVERSCAN * 2)
  const end = $derived(Math.min(rawLines.length, start + visibleCount))
  const gutterW = $derived(`${Math.max(2, String(rawLines.length).length)}ch`)

  function isDark(): boolean {
    return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  }

  async function run() {
    const lang = langForName(name)
    try {
      tokens = await highlightLines(code, lang, themeFor(dark))
    } catch {
      tokens = null
    }
    tokenizing = false
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  onMount(() => {
    dark = isDark()
    void run()

    const mo = new MutationObserver(() => {
      const d = isDark()
      if (d !== dark) {
        dark = d
        tokenizing = true
        void run()
      }
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const ro = new ResizeObserver(() => {
      if (host) viewportH = host.clientHeight
    })
    if (host) {
      ro.observe(host)
      viewportH = host.clientHeight
    }
    return () => {
      mo.disconnect()
      ro.disconnect()
    }
  })

  // Build the visible slice: tokenized when available, else plain text.
  $effect(() => {
    const s = start
    const e = end
    const tk = tokens
    const out: string[] = []
    if (tk) {
      for (let i = s; i < e; i++) {
        const line = tk[i]
        out.push(
          line
            ? line
                .map(t => (t.color ? `<span style="color:${t.color}">${esc(t.content)}</span>` : esc(t.content)))
                .join('')
            : '',
        )
      }
    } else {
      for (let i = s; i < e; i++) out.push(esc(rawLines[i] ?? ''))
    }
    rendered = out
  })

  function onScroll(e: Event) {
    scrollTop = (e.currentTarget as HTMLElement).scrollTop
  }
</script>

<div
  bind:this={host}
  class="h-full w-full overflow-auto bg-card font-mono text-[12px] leading-[20px]"
  onscroll={onScroll}
>
  <div class="relative w-max min-w-full" style="height: {rawLines.length * ROW_H}px">
    <div class="absolute top-0 left-0 w-max min-w-full" style="transform: translateY({start * ROW_H}px)">
      {#each rendered as html, i (start + i)}
        <div class="flex w-max min-w-full">
          <span
            class="shrink-0 border-r border-border/40 px-2 text-right text-muted-foreground/50 select-none"
            style="width: {gutterW}; min-width: {gutterW}"
          >{start + i + 1}</span>
          <span class="min-w-fit flex-1 px-3 whitespace-pre">{@html html || '\u200b'}</span>
        </div>
      {/each}
    </div>
  </div>
  {#if tokenizing}
    <div class="pointer-events-none sticky left-1 bottom-1 inline-block text-[10px] text-muted-foreground/60">…</div>
  {/if}
</div>
