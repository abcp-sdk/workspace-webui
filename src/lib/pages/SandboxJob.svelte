<script lang="ts">
  // SandboxJob — one sandbox job's streamed output (the sibling page of the
  // job list). Streams live via WatchSandboxJob (history first, then chunks)
  // with a poll fallback for a job whose stream already closed.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store, name, jobId, showBack = false }: PageProps & { name: string; jobId: string } = $props()

  let lines = $state<string[]>([])
  let jobDone = $state(false)
  let jobExit = $state(0)
  let jobError = $state('')
  let watching = $state(false)
  let outEl: HTMLElement | null = $state(null)

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
    return () => abort?.abort()
  })

  $effect(() => {
    void lines.length
    if (outEl) outEl.scrollTop = outEl.scrollHeight
  })
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.terminal class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 truncate font-mono text-meta">{jobId}</span>
    {#if watching}
      <span class="flex shrink-0 items-center gap-1 text-[10px] text-warning"><span class="size-2 animate-pulse rounded-full bg-warning"></span>{t('live')}</span>
    {:else if jobDone}
      <span class={cn('shrink-0 text-[10px]', jobExit === 0 ? 'text-success' : 'text-destructive')}>exit {jobExit}</span>
    {/if}
  </PageHeader>

  <div bind:this={outEl} class="min-h-0 flex-1 overflow-auto bg-black/90 p-3 font-mono text-[11px] leading-relaxed text-green-200">
    {#if jobError}
      <div class="text-red-300">{jobError}</div>
    {:else if lines.length === 0}
      <div class="text-muted-foreground">{t('waitingOutput')}</div>
    {:else}
      {#each lines as l, i (i)}<div class="whitespace-pre-wrap">{l}</div>{/each}
    {/if}
  </div>
</div>
