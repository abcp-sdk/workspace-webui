<script lang="ts">
  // DiffView — a VSCode-style unified/side-by-side diff renderer.
  //
  // Parses a unified diff (`--- a/x`, `+++ b/x`, `@@ -l,s +l,s @@`, ` `, `-`,
  // `+`, `\ No newline`, `Binary files ...`), groups it per file and per hunk,
  // and renders responsively:
  //   * WIDE  (container >= 900px): side-by-side (old | new) with per-side line
  //     numbers and red/green row backgrounds.
  //   * NARROW: unified — one column, old/new line-number gutter, +/- markers.
  //
  // Syntax highlighting uses the SAME Shiki setup as the code viewer (one call
  // per file, then split back per line) so colors and themes match exactly.
  import { onMount } from 'svelte'
  import { t } from '$lib/i18n.svelte'
  import { AppIcons } from '$lib/icons'
  import { cn } from '$lib/utils'
  import { highlightLines, langForName, themeFor, type Token } from '$lib/highlight'

  let { diff, name = '' }: { diff: string; name?: string } = $props()

  interface DLine {
    kind: 'ctx' | 'add' | 'del'
    text: string
    oldNo: number | null
    newNo: number | null
    html: string
  }
  interface DHunk {
    header: string
    lines: DLine[]
  }
  interface DFile {
    oldPath: string
    newPath: string
    range: string
    hunks: DHunk[]
    additions: number
    deletions: number
    binary: boolean
  }
  interface Cell {
    kind: 'ctx' | 'add' | 'del' | 'empty'
    no: number | null
    html: string
  }
  interface Row {
    key: string
    left: Cell
    right: Cell
  }

  let dark = $state(false)

  // Parsed + highlighted files (a single reactive value so assigning the
  // result after highlighting re-renders; mutating tokens in place would not).
  let files = $state<DFile[]>([])
  const totalAdd = $derived(files.reduce((n, f) => n + f.additions, 0))
  const totalDel = $derived(files.reduce((n, f) => n + f.deletions, 0))

  // Layout: UNIFIED (one column) by default — panes are often narrow — with a
  // manual Split/Unified toggle. "auto" keeps the old container-width behaviour.
  let autoWide = $state(false)
  let mode = $state<'auto' | 'split' | 'unified'>('unified')
  const wide = $derived(mode === 'split' ? true : mode === 'unified' ? false : autoWide)

  // Container width drives the AUTO layout.
  let host: HTMLElement | null = $state(null)
  $effect(() => {
    const el = host
    if (!el) return
    const ro = new ResizeObserver(() => (autoWide = el.clientWidth >= 900))
    ro.observe(el)
    autoWide = el.clientWidth >= 900
    return () => ro.disconnect()
  })

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function stripPrefix(p: string): string {
    return p.replace(/^[ab]\//, '')
  }

  /** Parse a unified diff into files -> hunks -> lines (no highlighting). */
  function parse(raw: string): DFile[] {
    const out: DFile[] = []
    const lines = raw.split('\n')
    let cur: DFile | null = null
    let hunk: DHunk | null = null
    let oldNo = 0
    let newNo = 0
    let oldPath = ''
    let newPath = ''

    const flushHunk = () => {
      if (cur && hunk) cur.hunks.push(hunk)
      hunk = null
    }
    const flushFile = () => {
      flushHunk()
      if (cur) out.push(cur)
      cur = null
    }
    const newFile = (range: string): DFile => ({ oldPath: '', newPath: '', range, hunks: [], additions: 0, deletions: 0, binary: false })

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        flushFile()
        cur = newFile(line.slice('diff --git '.length))
        continue
      }
      if (!cur) {
        if (line.startsWith('--- ') || line.startsWith('@@')) cur = newFile('')
        else continue
      }
      if (line.startsWith('Binary files')) {
        cur.binary = true
        continue
      }
      if (line.startsWith('--- ')) {
        oldPath = line.slice(4).trim()
        cur.oldPath = oldPath
        continue
      }
      if (line.startsWith('+++ ')) {
        newPath = line.slice(4).trim()
        cur.newPath = newPath
        if (!cur.range || cur.range.startsWith('diff --git')) {
          cur.range = `${stripPrefix(oldPath)} → ${stripPrefix(newPath)}`
        }
        continue
      }
      if (line.startsWith('@@')) {
        flushHunk()
        const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
        oldNo = m ? parseInt(m[1]!) : 1
        newNo = m ? parseInt(m[2]!) : 1
        hunk = { header: line, lines: [] }
        continue
      }
      if (!hunk) continue
      if (line.startsWith('+')) {
        cur.additions++
        hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++, html: '' })
      } else if (line.startsWith('-')) {
        cur.deletions++
        hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null, html: '' })
      } else if (line.startsWith('\\')) {
        /* \ No newline at end of file — ignore */
      } else {
        const text = line.startsWith(' ') ? line.slice(1) : line
        hunk.lines.push({ kind: 'ctx', text, oldNo: oldNo++, newNo: newNo++, html: '' })
      }
    }
    flushFile()
    return out
  }

  // Highlight each file's lines in ONE Shiki call, then split tokens back per
  // line (each DLine is exactly one source line). The result is assigned as a
  // NEW array so Svelte re-renders.
  async function highlightAll(fs: DFile[]) {
    const theme = themeFor(dark)
    for (const f of fs) {
      const flat: DLine[] = f.hunks.flatMap(h => h.lines)
      const lang = langForName(f.newPath || f.oldPath)
      if (!flat.length) continue
      const text = flat.map(l => l.text).join('\n')
      let toks: Token[][] | null = null
      try {
        toks = await highlightLines(text, lang, theme)
      } catch {
        toks = null
      }
      flat.forEach((l, i) => {
        const lineTokens = toks?.[i]
        l.html = lineTokens
          ? lineTokens.map(tk => (tk.color ? `<span style="color:${tk.color}">${esc(tk.content)}</span>` : esc(tk.content))).join('')
          : esc(l.text)
      })
    }
    files = fs.map(f => ({ ...f, hunks: f.hunks.map(h => ({ ...h, lines: [...h.lines] })) }))
  }

  $effect(() => {
    const src = diff
    const parsed = parse(src)
    files = parsed
    if (parsed.length) void highlightAll(parsed)
  })

  /** Side-by-side pairing: match del/add runs, pad the short side. */
  function pairRows(lines: DLine[]): Row[] {
    const empty: Cell = { kind: 'empty', no: null, html: '' }
    const rows: Row[] = []
    let i = 0
    let k = 0
    while (i < lines.length) {
      const l = lines[i]!
      if (l.kind === 'ctx') {
        rows.push({
          key: `r${k++}`,
          left: { kind: 'ctx', no: l.oldNo, html: l.html },
          right: { kind: 'ctx', no: l.newNo, html: l.html },
        })
        i++
        continue
      }
      const dels: DLine[] = []
      const adds: DLine[] = []
      while (i < lines.length && lines[i]!.kind === 'del') dels.push(lines[i++]!)
      while (i < lines.length && lines[i]!.kind === 'add') adds.push(lines[i++]!)
      const n = Math.max(dels.length, adds.length)
      for (let j = 0; j < n; j++) {
        const d = dels[j]
        const a = adds[j]
        rows.push({
          key: `r${k++}`,
          left: d ? { kind: 'del', no: d.oldNo, html: d.html } : empty,
          right: a ? { kind: 'add', no: a.newNo, html: a.html } : empty,
        })
      }
    }
    return rows
  }

  onMount(() => {
    dark = document.documentElement.dataset.theme === 'dark'
    const mo = new MutationObserver(() => {
      const d = document.documentElement.dataset.theme === 'dark'
      if (d !== dark) {
        dark = d
        void highlightAll(files)
      }
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  })
</script>

<div bind:this={host} class="min-w-0 max-w-full">
  {#if files.length === 0}
    <div class="px-3 py-4 text-meta text-muted-foreground">{t('diffEmpty')}</div>
  {:else}
    <div class="mb-2 flex items-center gap-2 px-1 text-micro text-muted-foreground">
      <AppIcons.diff class="size-3.5" />
      <span>{files.length} {t('filesChanged')}</span>
      <span class="font-mono text-success">+{totalAdd}</span>
      <span class="font-mono text-destructive">-{totalDel}</span>
      <!-- manual layout toggle (auto default: wide=split, narrow=unified) -->
      <div class="ml-auto flex items-center gap-0.5 rounded-full border border-border p-0.5">
        <button
          type="button"
          class={cn('rounded-full px-2 py-0.5', wide ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
          title={t('split')}
          onclick={() => (mode = 'split')}
        >{t('split')}</button>
        <button
          type="button"
          class={cn('rounded-full px-2 py-0.5', !wide ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
          title={t('unified')}
          onclick={() => (mode = 'unified')}
        >{t('unified')}</button>
      </div>
    </div>
    {#each files as f, fi (fi)}
      <div class="mb-3 overflow-hidden rounded-md border border-border">
        <div class="flex items-center gap-2 border-b border-border bg-muted/50 px-2 py-1 text-micro font-semibold">
          <AppIcons.file_code class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate font-mono">{f.range || name}</span>
          {#if f.binary}
            <span class="shrink-0 rounded bg-muted px-1.5 py-px text-[10px]">{t('binaryFile')}</span>
          {:else}
            <span class="shrink-0 font-mono text-success">+{f.additions}</span>
            <span class="shrink-0 font-mono text-destructive">-{f.deletions}</span>
          {/if}
        </div>
        {#if !f.binary}
          <div class="overflow-x-auto bg-card font-mono text-[11.5px] leading-[1.55]">
            {#each f.hunks as h, hi (hi)}
              <div class="bg-primary/8 px-2 py-0.5 text-[10.5px] text-primary/80">{h.header}</div>
              {#if wide}
                {#each pairRows(h.lines) as r (r.key)}
                  <div class="grid grid-cols-2 border-b border-border/40">
                    <div class={cn('flex min-w-0 border-r border-border/40', r.left.kind === 'del' && 'bg-destructive/12')}>
                      <span class="w-10 shrink-0 px-1 text-right text-muted-foreground/60 select-none">{r.left.no ?? ''}</span>
                      <span class="min-w-0 flex-1 px-1 break-all whitespace-pre-wrap {r.left.kind === 'del' ? 'text-destructive' : ''}">{@html r.left.html}</span>
                    </div>
                    <div class={cn('flex min-w-0', r.right.kind === 'add' && 'bg-success/12')}>
                      <span class="w-10 shrink-0 px-1 text-right text-muted-foreground/60 select-none">{r.right.no ?? ''}</span>
                      <span class="min-w-0 flex-1 px-1 break-all whitespace-pre-wrap {r.right.kind === 'add' ? 'text-success' : ''}">{@html r.right.html}</span>
                    </div>
                  </div>
                {/each}
              {:else}
                {#each h.lines as l, li (li)}
                  <div class={cn('flex min-w-0', l.kind === 'add' && 'bg-success/12', l.kind === 'del' && 'bg-destructive/12')}>
                    <span class="w-9 shrink-0 px-1 text-right text-muted-foreground/60 select-none">{l.oldNo ?? ''}</span>
                    <span class="w-9 shrink-0 px-1 text-right text-muted-foreground/60 select-none">{l.newNo ?? ''}</span>
                    <span class={cn('w-4 shrink-0 text-center select-none', l.kind === 'add' ? 'text-success' : l.kind === 'del' ? 'text-destructive' : 'text-transparent')}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}</span>
                    <span class="min-w-0 flex-1 px-1 break-all whitespace-pre-wrap">{@html l.html}</span>
                  </div>
                {/each}
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
