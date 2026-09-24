<script lang="ts">
  // SandboxDetail — the sandbox's job history (a full pane). Selecting a job
  // opens a sibling `sandbox_job` page, so the Shell split shows the job list |
  // the job output as two equal panes (no nested split).
  import type { PageProps } from '$lib/page-props'
  import type { SandboxInfo, SandboxJob } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { confirmDialog } from '$lib/dialogs'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import { usePoll } from '$lib/poll.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import TabBar from '$lib/components/layout/TabBar.svelte'
  import TabItem from '$lib/components/layout/TabItem.svelte'
  import ListRow from '$lib/components/layout/ListRow.svelte'
  import SectionLabel from '$lib/components/layout/SectionLabel.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store, name, showBack = false }: PageProps & { name: string } = $props()

  /** Open the sandbox file browser at the workspace root. */
  function openFiles() {
    store.open({ kind: 'sandbox_files', key: `files:${name}:`, name, path: '' })
  }

  let sandbox = $state<SandboxInfo | null>(null)
  let jobs = $state<SandboxJob[]>([])
  let loading = $state(true)
  let jobsError = $state('')

  // The active job is the deeper `sandbox_job` page (if the stack is on one),
  // so the list can highlight it without owning the selection.
  const activeJobId = $derived.by(() => {
    const top = store.focusedPage
    return top.kind === 'sandbox_job' && top.name === name ? top.jobId : ''
  })

  async function fetchSandbox() {
    const [sb, js] = await Promise.all([
      store.api.getSandbox(name),
      store.api.listSandboxJobs(name),
    ])
    return { sandbox: sb, jobs: js }
  }

  // Initial load is CACHE-FIRST (a pane SLIDE re-runs the effect but must not
  // refetch). The poll bypasses the cache and writes it back.
  async function load() {
    const key = `sandbox:${name}`
    loading = !store.hasData(key)
    try {
      const v = await store.dataLoad(key, fetchSandbox)
      sandbox = v.sandbox
      jobs = v.jobs
      jobsError = ''
    } catch (e) {
      jobsError = String(e)
    }
    loading = false
  }

  async function refresh() {
    try {
      const v = await fetchSandbox()
      store.dataSet(`sandbox:${name}`, v)
      sandbox = v.sandbox
      jobs = v.jobs
      jobsError = ''
    } catch (e) {
      jobsError = String(e)
    }
  }

  // Reload when the sandbox changes; poll only while visible (the $effect does
  // the immediate load, so the poll itself must not fire one).
  $effect(() => {
    void name
    void load()
  })
  usePoll(() => void refresh(), 15000, { immediate: false })

  function openJob(job: SandboxJob) {
    store.navigate({ kind: 'sandbox_job', key: `job:${name}:${job.id}`, name, jobId: job.id })
  }

  async function deleteSandbox() {
    const ok = await confirmDialog({
      title: t('deleteSandboxTitle'),
      body: t('deleteSandboxBody', { arg1: name }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    try {
      await store.api.deleteSandbox(name)
      showToast(t('deleted'))
      // The sandbox is gone: fall back to the parent (service root).
      store.popPage()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

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
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.box class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{name}</span>
    {#if sandbox}<span class="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] leading-4 text-muted-foreground">{sandbox.phase}</span>{/if}
    <IconButton icon={AppIcons.delete} label={t('deleteSandboxTitle')} variant="destructive" onclick={() => void deleteSandbox()} />
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

  <TabBar>
    <TabItem active onclick={() => {}}>
      <AppIcons.terminal class="size-3.5" />{t('jobs')}
    </TabItem>
    <TabItem onclick={openFiles}>
      <AppIcons.folder class="size-3.5" />{t('files')}
    </TabItem>
  </TabBar>

  <!-- job list (full pane) -->
  <div class="min-h-0 flex-1 overflow-y-auto">
    <SectionLabel>{t('jobs')} · {jobs.length}</SectionLabel>
    {#if loading && jobs.length === 0}
      <div class="flex justify-center py-10">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else if jobsError}
      <div class="px-4 py-2 text-meta text-destructive">{jobsError}</div>
    {:else if jobs.length === 0}
      <EmptyState>{t('noJobs')}</EmptyState>
    {:else}
      {#each jobs as j (j.id)}
        <ListRow divided active={activeJobId === j.id} onclick={() => openJob(j)}>
          <span class={cn('shrink-0 rounded-full px-1.5 py-px text-[9px] leading-4', stateTone(j.state))}>{j.state}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-mono text-[11px]">{j.command || j.id}</span>
            <span class="block truncate text-[10px] text-muted-foreground">{relTime(j.startedAt)}{j.finishedAt ? ` · exit ${j.exitCode}` : ''}</span>
          </span>
        </ListRow>
      {/each}
    {/if}
  </div>
</div>
