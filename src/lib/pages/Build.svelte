<script lang="ts">
  // Build — one image build's live log (repo-build-image / repo-build-status).
  // Polls GetBuildStatus with an incremental offset (only NEW output is sent),
  // so it behaves like the SandboxJob page. Shows the pushed image ref on done.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'
  import LogViewer from '$lib/components/LogViewer.svelte'

  let {
    store,
    buildId,
    image = '',
    showBack = false,
  }: PageProps & { buildId: string; image?: string } = $props()

  let log = $state('')
  let state = $state('running')
  let imageRef = $state('')
  let error = $state('')
  let watching = $state(true)
  let follow = $state(true)
  let offset = 0

  $effect(() => {
    const id = buildId
    if (!id) return
    log = ''
    state = 'running'
    imageRef = ''
    error = ''
    offset = 0
    watching = true
    let stopped = false
    const poll = async () => {
      if (stopped) return
      try {
        const r = await store.api.getBuildStatus(id, offset)
        if (stopped) return
        if (r.log) log += r.log
        offset = r.logOffset
        state = r.state
        imageRef = r.imageRef || imageRef
        if (r.state === 'done' || r.state === 'failed') {
          stopped = true
          watching = false
        }
      } catch (e) {
        stopped = true
        watching = false
        error = String(e)
        state = 'failed'
      }
    }
    const timer = setInterval(poll, 1200)
    void poll()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  })

  let lines = $derived(log.replace(/\n$/, '').split('\n'))
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.building class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 break-all font-mono text-meta">{image || buildId}</span>
    {#if watching}
      <span class="flex shrink-0 items-center gap-1 text-[10px] text-warning"><span class="size-2 animate-pulse rounded-full bg-warning"></span>{t('live')}</span>
    {:else}
      <span class={cn('shrink-0 text-[10px]', state === 'done' ? 'text-success' : 'text-destructive')}>{state}</span>
    {/if}
  </PageHeader>

  {#if imageRef}
    <div class="border-b px-3 py-1 font-mono text-[10px] text-muted-foreground">{imageRef}</div>
  {/if}

  <LogViewer
    {lines}
    bind:follow
    error={error}
    waitingText={t('waitingOutput')}
    downloadName={`${buildId}.log`}
  />
</div>
