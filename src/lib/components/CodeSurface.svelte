<script lang="ts">
  // CodeSurface — GitHub-blob-style source viewer: a line-number gutter plus
  // Shiki-highlighted code. The code AUTOWRAPS and fills the panel width (so
  // the reader sees more of each line without horizontal scrolling), and the
  // gutter width follows the DIGIT COUNT of the largest line number so a
  // 4-/5-digit number can never overflow it.
  //
  // It NEVER renders the content (markdown stays markdown source, html stays
  // markup); only syntax coloring is applied.
  //
  // LAZY HIGHLIGHT: Shiki (pure-JS regex engine) is expensive, and a long chat
  // can hold hundreds of code surfaces. Coloring is deferred until the surface
  // is actually IN THE VIEWPORT (IntersectionObserver); off-screen and
  // collapsed cards render as fast escaped plain text and are never tokenized.
  import { onMount } from 'svelte'
  import { highlightLines, langForName, themeFor, type Token } from '$lib/highlight'
  import { gutterWidth } from '$lib/line-gutter'

  let {
    code,
    name,
    startLine = 1,
  }: { code: string; name: string; startLine?: number } = $props()

  let dark = $state(false)
  let tokens = $state<Token[][] | null>(null)
  /** The source `tokens` were computed FROM; guards against rendering stale
   *  tokens against a newer `code` (e.g. a fast file switch). */
  let tokenSrc = $state('')
  let tokenizing = $state(false)
  /** True once the surface has scrolled into view (arms highlighting). */
  let visible = $state(false)
  let rootEl: HTMLElement | null = $state(null)

  const rawLines = $derived(code.length ? code.split('\n') : [''])
  // The gutter must fit the LARGEST absolute line number, which is
  // `startLine + count - 1` for a windowed read (startLine > 1).
  const gutterW = $derived(
    gutterWidth(startLine + rawLines.length - 1, 1.25),
  )

  function isDark(): boolean {
    return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  }

  async function run() {
    if (!visible) return
    // Never tokenize empty code: the caller may mount us with '' and set the
    // real content a tick later. Latching an empty tokenization here left every
    // line blank once the content arrived (the effect below re-runs on change).
    if (code === '') {
      tokens = null
      tokenSrc = ''
      tokenizing = false
      return
    }
    tokenizing = true
    const lang = langForName(name)
    const src = code
    try {
      const out = await highlightLines(src, lang, themeFor(dark))
      // Guard against a stale async result: only adopt tokens for the CURRENT
      // source (a fast edit / file switch may have superseded this call).
      if (src === code) {
        tokens = out
        tokenSrc = src
      }
    } catch {
      if (src === code) {
        tokens = null
        tokenSrc = src
      }
    }
    if (src === code) tokenizing = false
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  // Per-line HTML: tokenized when available, else escaped plain text.
  const lines = $derived.by<string[]>(() => {
    // Only use tokens computed from the CURRENT source; otherwise fall back to
    // escaped plain text so content is never lost or mismatched.
    const tk = tokenSrc === code ? tokens : null
    const out: string[] = []
    for (let i = 0; i < rawLines.length; i++) {
      if (tk) {
        const line = tk[i]
        out.push(
          line
            ? line
                .map(t => (t.color ? `<span style="color:${t.color}">${esc(t.content)}</span>` : esc(t.content)))
                .join('')
            : '',
        )
      } else {
        out.push(esc(rawLines[i] ?? ''))
      }
    }
    return out
  })

  onMount(() => {
    dark = isDark()
    // Arm highlighting when the surface first enters the viewport. A 200px
    // root margin warms it just before it becomes visible.
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          visible = true
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    if (rootEl) io.observe(rootEl)

    const mo = new MutationObserver(() => {
      const d = isDark()
      if (d !== dark) dark = d
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      io.disconnect()
      mo.disconnect()
    }
  })

  // (Re)highlight whenever the source, language or theme changes — once the
  // surface is visible. This covers content that arrives AFTER mount (the file
  // viewer mounts with '' then sets the decoded text).
  $effect(() => {
    void code
    void name
    void dark
    if (visible) void run()
  })
</script>

<div
  bind:this={rootEl}
  class="h-full w-full overflow-auto bg-card font-mono text-[12px] leading-[20px]"
>
  {#each lines as html, i (i)}
    <div class="flex w-full items-start">
      <span
        class="shrink-0 border-r border-border/40 px-2 text-right text-muted-foreground/50 select-none"
        style="width: {gutterW}; min-width: {gutterW}"
      >{startLine + i}</span>
      <span class="min-w-0 flex-1 px-3 whitespace-pre-wrap wrap-anywhere">{@html html || '\u200b'}</span>
    </div>
  {/each}
  {#if tokenizing}
    <div class="pointer-events-none sticky left-1 bottom-1 inline-block text-[10px] text-muted-foreground/60">…</div>
  {/if}
</div>
