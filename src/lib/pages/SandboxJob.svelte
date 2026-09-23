<script lang="ts">
  // SandboxJob — one sandbox job's streamed output. Streams live via
  // WatchSandboxJob (history first, then chunks) with a poll fallback for a
  // job whose stream already closed. A small SGR parser colors ANSI output;
  // a follow toggle, search, copy and download make long logs usable.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import { parseAnsi, stripAnsi } from '$lib/ansi'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store, name, jobId, showBack = false }: PageProps & { name: string; jobId: string } = $props()

  let lines = $state<string[]>([])
  let jobDone = $state(false)
  let jobExit = $state(0)
  let jobError = $state('')
  let watching = $state(false)
  let follow = $state(true)
  let searching = $state(false)
  let q = $state('')
  let startedAt = $state(0)
  let finishedAt = $state(0)
  let outEl: HTMLElement | null = $state(null)

  let abort: AbortController | null = null

  const filtered = $derived.by(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return lines
    return lines.filter(l => stripAnsi(l).toLowerCase().includes(needle))
  })

  /** Parse once per line for the filtered view. */
  const rows = $derived(filtered.map(l => parseAnsi(l)))

  $effect(() => {
    const sbx = name
    const jid = jobId
    if (!sbx || !jid) return
    abort?.abort()
    lines = []
    jobDone = false
    jobExit = 0
    jobError = ''
    watching = true
    abort = new AbortController()
    void (async () => {
      try {
        for await (const ev of store.api.watchSandboxJob(sbx, jid, abort?.signal)) {
          if (ev.output) lines.push(ev.output.replace(/\n$/, ''))
          if (ev.done) {
            jobDone = true
            jobExit = ev.exitCode
            break
          }
        }
      } catch (e) {
        // A finished job's stream may close after history; fall back to a poll.
        try {
          const out = await store.api.getSandboxJobOutput(sbx, jid, -500)
          lines = out.lines
          jobDone = out.done
        } catch {
          jobError = String(e)
        }
      }
      watching = false
    })()
    // Best-effort timing from the job list (started/finished).
    void (async () => {
      try {
        const jobs = await store.api.listSandboxJobs(sbx)
        const j = jobs.find(x => x.id === jid)
        if (j) {
          startedAt = j.startedAt
          finishedAt = j.finishedAt
        }
      } catch {
        /* timing optional */
      }
    })()
    return () => abort?.abort()
  })

  // Auto-follow the tail ONLY while the user is pinned to the bottom.
  function atBottom(): boolean {
    if (!outEl) return true
    return outEl.scrollHeight - outEl.scrollTop - outEl.clientHeight < 24
  }
  $effect(() => {
    void lines.length
    if (follow && outEl && atBottom()) outEl.scrollTop = outEl.scrollHeight
  })

  function durationLabel(): string {
    if (!startedAt) return ''
    const end = finishedAt || Date.now()
    const s = Math.max(0, Math.round((end - startedAt) / 1000))
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m${s % 60}s`
  }

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
    a.download = `${jobId}.log`
    a.click()
    URL.revokeObjectURL(url)
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.terminal class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 truncate font-mono text-meta">{jobId}</span>
    {#if durationLabel()}<span class="shrink-0 text-[10px] text-muted-foreground">{durationLabel()}</span>{/if}
    {#if watching}
      <span class="flex shrink-0 items-center gap-1 text-[10px] text-warning"><span class="size-2 animate-pulse rounded-full bg-warning"></span>{t('live')}</span>
    {:else if jobDone}
      <span class={cn('shrink-0 text-[10px]', jobExit === 0 ? 'text-success' : 'text-destructive')}>exit {jobExit}</span>
    {/if}
  </PageHeader>

  <div class="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
    <button type="button" class={cn('rounded p-1', searching && 'bg-muted text-foreground')} title={t('search')} onclick={() => { searching = !searching; if (!searching) q = '' }}><AppIcons.search class="size-3.5" /></button>
    {#if searching}
      <input bind:value={q} class="h-6 min-w-0 flex-1 rounded border border-input bg-transparent px-2 text-[11px] outline-none" placeholder={t('searchHint')} />
      <span class="shrink-0">{filtered.length}/{lines.length}</span>
    {/if}
    <label class="ml-auto flex items-center gap-1">
      <input type="checkbox" bind:checked={follow} /> {t('followOutput')}
    </label>
    <button type="button" class="rounded p-1 hover:bg-muted" title={t('copy')} onclick={copyAll}><AppIcons.copy class="size-3.5" /></button>
    <button type="button" class="rounded p-1 hover:bg-muted" title={t('download')} onclick={download}><AppIcons.download class="size-3.5" /></button>
  </div>

  <div bind:this={outEl} class="min-h-0 flex-1 overflow-auto bg-black/90 p-3 font-mono text-[11px] leading-relaxed text-green-200">
    {#if jobError}
      <div class="text-red-300">{jobError}</div>
    {:else if rows.length === 0}
      <div class="text-muted-foreground">{lines.length === 0 ? t('waitingOutput') : t('noMatches')}</div>
    {:else}
      {#each rows as segs, i (i)}
        <div class="whitespace-pre-wrap">{#each segs as seg, j (j)}<span class={seg.cls}>{seg.text}</span>{/each}</div>
      {/each}
    {/if}
  </div>
</div>
