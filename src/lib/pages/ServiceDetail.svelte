<script lang="ts">
  // ServiceDetail — one service's overview + live container logs. Logs stream
  // via WatchServiceLogs (k8s pod log through the gateway); `previous` reads
  // the crashed container instance (CrashLoopBackOff diagnosis).
  import type { PageProps } from '$lib/page-props'
  import type { ServiceInfo } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store, name, showBack = false }: PageProps & { name: string } = $props()

  let svc = $state<ServiceInfo | null>(null)
  let lines = $state<string[]>([])
  let streaming = $state(false)
  let previous = $state(false)
  let follow = $state(true)
  let logError = $state('')
  let outEl: HTMLElement | null = $state(null)
  let abort: AbortController | null = null

  async function load() {
    try {
      svc = await store.api.getService(name)
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  $effect(() => {
    const n = name
    void n
    void load()
    const id = setInterval(() => void load(), 10000)
    return () => clearInterval(id)
  })

  async function startLogs() {
    abort?.abort()
    lines = []
    logError = ''
    streaming = true
    abort = new AbortController()
    try {
      if (follow) {
        for await (const ev of store.api.watchServiceLogs(name, previous, abort.signal)) {
          if (ev.output) lines.push(ev.output.replace(/\n$/, ''))
          if (ev.done) {
            if (ev.error) logError = ev.error
            break
          }
        }
      } else {
        lines = await store.api.serviceLogs(name, 500, previous)
      }
    } catch (e) {
      logError = String(e)
    }
    streaming = false
    requestAnimationFrame(() => {
      if (outEl) outEl.scrollTop = outEl.scrollHeight
    })
  }

  $effect(() => {
    // Restart the log stream when the source toggles.
    const n = name
    const p = previous
    const f = follow
    void n
    void p
    void f
    void startLogs()
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
    <AppIcons.server class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{name}</span>
    {#if svc?.stage === 'preview'}<span class="shrink-0 rounded-full bg-warning/15 px-2 py-px text-[10px] text-warning">{t('serviceStagePreview')}</span>{/if}
    {#if svc}<span class="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] leading-4 text-muted-foreground">{svc.ready ? 'Ready' : svc.phase}</span>{/if}
  </PageHeader>

  {#if svc}
    <div class="shrink-0 border-b border-border/50 px-4 py-2 text-[10px] text-muted-foreground">
      <div class="truncate font-mono">{svc.image}</div>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {#if svc.podPhase}<span>{t('servicePodPhase')}: {svc.podPhase}</span>{/if}
        <span class={cn(svc.restarts > 0 && 'text-destructive')}>{t('serviceRestarts')}: {svc.restarts}</span>
        <span>{svc.replicas}×</span>
        {#if svc.session}<span>{svc.session}</span>{/if}
      </div>
      {#if svc.message}
        <div class="mt-1 rounded bg-destructive/10 px-2 py-1 text-destructive">{svc.message}</div>
      {/if}
      <div class="mt-1 flex flex-wrap gap-x-3">
        <span class="font-mono">{svc.url}</span>
        {#each svc.ports.filter(p => p.publicUrl) as p (p.publicUrl)}
          <a href={p.publicUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">{p.publicUrl}</a>
        {/each}
      </div>
    </div>
  {/if}

  <!-- logs -->
  <div class="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
    <AppIcons.terminal class="size-3.5" />
    <span>{t('serviceLogs')}</span>
    {#if streaming}<span class="flex items-center gap-1 text-warning"><span class="size-2 animate-pulse rounded-full bg-warning"></span>{t('live')}</span>{/if}
    <label class="ml-auto flex items-center gap-1">
      <input type="checkbox" bind:checked={previous} /> {t('serviceLogsPrevious')}
    </label>
    <label class="flex items-center gap-1">
      <input type="checkbox" bind:checked={follow} /> {t('serviceLogsFollow')}
    </label>
    <button type="button" class="rounded p-1 hover:bg-muted" title={t('refresh')} onclick={() => void startLogs()}><AppIcons.refresh class="size-3.5" /></button>
  </div>
  <div bind:this={outEl} class="min-h-0 flex-1 overflow-auto bg-black/90 p-3 font-mono text-[11px] leading-relaxed text-green-200">
    {#if logError}
      <div class="text-red-300">{logError}</div>
    {:else if lines.length === 0}
      <div class="text-muted-foreground">{t('serviceLogsWaiting')}</div>
    {:else}
      {#each lines as l, i (i)}<div class="whitespace-pre-wrap">{l}</div>{/each}
    {/if}
  </div>
</div>
