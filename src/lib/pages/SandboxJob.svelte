<script lang="ts">
  // SandboxJob — one sandbox job's streamed output. Streams live via
  // WatchSandboxJob (history first, then chunks) with a poll fallback for a
  // job whose stream already closed. A small SGR parser colors ANSI output;
  // a follow toggle, search, copy and download make long logs usable.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import LogViewer from '$lib/components/LogViewer.svelte'

  let { store, name, jobId, showBack = false }: PageProps & { name: string; jobId: string } = $props()

  let lines = $state<string[]>([])
  let jobDone = $state(false)
  let jobExit = $state(0)
  let jobError = $state('')
  let watching = $state(false)
  let follow = $state(true)
  let startedAt = $state(0)
  let finishedAt = $state(0)

  let abort: AbortController | null = null

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

  function durationLabel(): string {
    if (!startedAt) return ''
    const end = finishedAt || Date.now()
    const s = Math.max(0, Math.round((end - startedAt) / 1000))
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m${s % 60}s`
  }

</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.terminal class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 break-all font-mono text-meta">{jobId}</span>
    {#if durationLabel()}<span class="shrink-0 text-[10px] text-muted-foreground">{durationLabel()}</span>{/if}
    {#if watching}
      <span class="flex shrink-0 items-center gap-1 text-[10px] text-warning"><span class="size-2 animate-pulse rounded-full bg-warning"></span>{t('live')}</span>
    {:else if jobDone}
      <span class={cn('shrink-0 text-[10px]', jobExit === 0 ? 'text-success' : 'text-destructive')}>exit {jobExit}</span>
    {/if}
  </PageHeader>

  <LogViewer {lines} bind:follow error={jobError} waitingText={t('waitingOutput')} downloadName={`${jobId}.log`} />
</div>
