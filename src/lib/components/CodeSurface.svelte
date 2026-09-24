<script lang="ts">
  // CodeSurface — GitHub-blob-style source viewer: a line-number gutter plus
  // Shiki-highlighted code. The code AUTOWRAPS and fills the panel width (so
  // the reader sees more of each line without horizontal scrolling), and the
  // gutter width follows the DIGIT COUNT of the largest line number so a
  // 4-/5-digit number can never overflow it.
  //
  // It NEVER renders the content (markdown stays markdown source, html stays
  // markup); only syntax coloring is applied.
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
  let tokenizing = $state(true)

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

  // Per-line HTML: tokenized when available, else escaped plain text.
  const lines = $derived.by<string[]>(() => {
    const tk = tokens
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
    return () => mo.disconnect()
  })
</script>

<div class="h-full w-full overflow-auto bg-card font-mono text-[12px] leading-[20px]">
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
