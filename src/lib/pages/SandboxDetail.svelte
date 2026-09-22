<script lang="ts">
  // SandboxDetail — read-only sandbox observability: the worker's job history
  // plus a job's output. Selecting a job streams its output live via
  // WatchSandboxJob (history first, then live chunks) with a poll fallback.
  import type { PageProps } from '$lib/page-props'
  import type { SandboxInfo, SandboxJob } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import ListRow from '$lib/components/layout/ListRow.svelte'
  import SectionLabel from '$lib/components/layout/SectionLabel.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store, name, showBack = false }: PageProps & { name: string } = $props()

  let sandbox = $state<SandboxInfo | null>(null)
  let jobs = $state<SandboxJob[]>([])
  let loading = $state(true)
  let jobsError = $state('')

  // selected job + its streamed output
  let jobId = $state('')
  let lines = $state<string[]>([])
  let jobDone = $state(false)
  let jobExit = $state(0)
  let jobError = $state('')
  let watching = $state(false)
  let outEl: HTMLElement | null = $state(null)

  let abort: AbortController | null = null

  async function load() {
    loading = true
    try {
      sandbox = await store.api.getSandbox(name)
      jobs = await store.api.listSandboxJobs(name)
      jobsError = ''
    } catch (e) {
      jobsError = String(e)
    }
    loading = false
  }

  $effect(() => {
    void load()
    const id = setInterval(() => void load(), 15000)
    return () => clearInterval(id)
  })

  async function watch(job: SandboxJob) {
    abort?.abort()
    jobId = job.id
    lines = []
    jobDone = false
    jobExit = 0
    jobError = ''
    watching = true
    abort = new AbortController()
    try {
      for await (const ev of store.api.watchSandboxJob(name, job.id, abort.signal)) {
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
        const out = await store.api.getSandboxJobOutput(name, job.id, -500)
        lines = out.lines
        jobDone = out.done
      } catch {
        jobError = String(e)
      }
    }
    watching = false
    requestAnimationFrame(() => {
      if (outEl) outEl.scrollTop = outEl.scrollHeight
    })
  }

  $effect(() => {
    void lines.length
    if (outEl) outEl.scrollTop = outEl.scrollHeight
  })

  function stateTone(s: string): string {
    if (s === 'running') return 'bg-warning/15 text-warning'
    if (s === 'done') return 'bg-success/15 text-success'
    if (s === 'failed' || s === 'killed') return 'bg-destructive/15 text-destructive'
    return 'bg-muted text-muted-foreground'
  }
  function relTime(ms: number): string {
    if (!ms) return ''
    const mins = Math.floor((Date.now() - ms) / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return `${mins}m`
    if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`
    return `${Math.floor(mins / (60 * 24))}d`
  }

  $effect(() => () => abort?.abort())
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.box class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{name}</span>
    {#if sandbox}<span class="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] leading-4 text-muted-foreground">{sandbox.phase}</span>{/if}
  </PageHeader>

  {#if sandbox}
    <div class="shrink-0 border-b border-border/50 px-4 py-2 text-[10px] text-muted-foreground">
      <span class="font-mono">{sandbox.image}</span>
      {#if sandbox.session}
        {@const session = sandbox.session}
        <span class="ml-2 inline-flex items-center gap-1">
          <AppIcons.chat_round class="size-3" />
          {#if store.sessionById(session)}
            <button
              type="button"
              class="text-primary hover:underline"
              onclick={() => { store.switchTab('chat'); store.pickSession(session) }}
            >{session}</button>
          {:else}
            <span>{session}</span>
          {/if}
        </span>
      {/if}
    </div>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
    <!-- job list -->
    <div class="min-h-0 shrink-0 overflow-y-auto border-b border-border lg:w-80 lg:border-r lg:border-b-0">
      <SectionLabel>{t('jobs')} · {jobs.length}</SectionLabel>
      {#if jobsError}
        <div class="px-4 py-2 text-meta text-destructive">{jobsError}</div>
      {:else if jobs.length === 0}
        <EmptyState>{t('noJobs')}</EmptyState>
      {:else}
        {#each jobs as j (j.id)}
          <ListRow divided active={jobId === j.id} onclick={() => void watch(j)}>
            <span class={cn('shrink-0 rounded-full px-1.5 py-px text-[9px] leading-4', stateTone(j.state))}>{j.state}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-mono text-[11px]">{j.command || j.id}</span>
              <span class="block truncate text-[10px] text-muted-foreground">{relTime(j.startedAt)}{j.finishedAt ? ` · exit ${j.exitCode}` : ''}</span>
            </span>
          </ListRow>
        {/each}
      {/if}
    </div>

    <!-- output -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      {#if !jobId}
        <EmptyState center>{t('pickJob')}</EmptyState>
      {:else}
        <div class="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span class="font-mono">{jobId}</span>
          {#if watching}<span class="flex items-center gap-1 text-warning"><span class="size-2 animate-pulse rounded-full bg-warning"></span>{t('live')}</span>
          {:else if jobDone}<span class={cn(jobExit === 0 ? 'text-success' : 'text-destructive')}>exit {jobExit}</span>{/if}
        </div>
        <div bind:this={outEl} class="min-h-0 flex-1 overflow-auto bg-black/90 p-3 font-mono text-[11px] leading-relaxed text-green-200">
          {#if jobError}
            <div class="text-red-300">{jobError}</div>
          {:else if lines.length === 0}
            <div class="text-muted-foreground">{t('waitingOutput')}</div>
          {:else}
            {#each lines as l, i (i)}<div class="whitespace-pre-wrap">{l}</div>{/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
