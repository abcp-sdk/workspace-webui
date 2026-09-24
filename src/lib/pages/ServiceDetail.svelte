<script lang="ts">
  // ServiceDetail — one service's overview + live container logs. Logs stream
  // via WatchServiceLogs (k8s pod log through the gateway); `previous` reads
  // the crashed container instance (CrashLoopBackOff diagnosis).
  import type { PageProps } from '$lib/page-props'
  import type { ServiceInfo } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { confirmDialog } from '$lib/dialogs'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import { usePoll } from '$lib/poll.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let { store, name, showBack = false }: PageProps & { name: string } = $props()

  let svc = $state<ServiceInfo | null>(null)
  let lines = $state<string[]>([])
  let streaming = $state(false)
  // The log source is component-local view state (not part of the identity).
  let previous = $state(false)
  let follow = $state(true)
  let logError = $state('')
  let outEl: HTMLElement | null = $state(null)
  let abort: AbortController | null = null

  function pickLogSource(next: { follow?: boolean; previous?: boolean }) {
    follow = next.follow ?? follow
    previous = next.previous ?? previous
  }

  // Initial load is CACHE-FIRST (a pane SLIDE re-runs the effect but must not
  // refetch). The poll bypasses the cache and writes it back.
  async function load() {
    const key = `service:${name}`
    try {
      svc = await store.dataLoad(key, () => store.api.getService(name))
    } catch (e) {
      showErrorToast(String(e))
    }
  }
  async function refresh() {
    try {
      const v = await store.api.getService(name)
      store.dataSet(`service:${name}`, v)
      svc = v
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  $effect(() => {
    void name
    void load()
  })
  usePoll(() => void refresh(), 10000, { immediate: false })

  async function deleteService() {
    const ok = await confirmDialog({
      title: t('deleteServiceTitle'),
      body: t('deleteServiceBody', { arg1: name }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (!ok) return
    try {
      await store.api.deleteService(name)
      showToast(t('deleted'))
      store.popPage()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  async function togglePause() {
    try {
      if (svc?.paused) await store.api.resumeService(name)
      else await store.api.pauseService(name)
      await load()
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  function copyUrl(u: string) {
    void navigator.clipboard?.writeText(u).then(
      () => showToast(t('copied')),
      () => showErrorToast(t('copyFailed')),
    )
  }

  /** Remaining TTL as a compact label (e.g. "12m", "2h"). */
  function ttlLabel(expiresAt: number): string {
    const ms = expiresAt - Date.now()
    if (ms <= 0) return t('expired')
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return '<1m'
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h`
  }

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
    {#if svc}<span class="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] leading-4 text-muted-foreground">{svc.paused ? t('servicePaused') : svc.ready ? 'Ready' : svc.phase}</span>{/if}
    {#if svc}
      <IconButton
        icon={svc.paused ? AppIcons.play : AppIcons.pause}
        label={svc.paused ? t('resume') : t('pause')}
        onclick={() => void togglePause()}
      />
      <IconButton icon={AppIcons.delete} label={t('deleteServiceTitle')} variant="destructive" onclick={() => void deleteService()} />
    {/if}
  </PageHeader>

  {#if svc}
    <div class="shrink-0 border-b border-border/50 px-4 py-2 text-[10px] text-muted-foreground">
      <div class="truncate font-mono">{svc.image}</div>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {#if svc.podPhase}<span>{t('servicePodPhase')}: {svc.podPhase}</span>{/if}
        <span class={cn(svc.restarts > 0 && 'text-destructive')}>{t('serviceRestarts')}: {svc.restarts}</span>
        <span>{svc.replicas}×</span>
        {#if svc.session}
          {#if store.sessionById(svc.session)}
            <button
              type="button"
              class="text-primary hover:underline"
              onclick={() => svc && store.pickSession(svc.session)}
            >{svc.session}</button>
          {:else}
            <span>{svc.session}</span>
          {/if}
        {/if}
        {#if svc.stage === 'preview' && svc.expiresAt > 0}
          <span class="text-warning">{t('serviceTtl')}: {ttlLabel(svc.expiresAt)}</span>
        {/if}
      </div>
      {#if svc.message}
        <div class="mt-1 rounded bg-destructive/10 px-2 py-1 text-destructive">{svc.message}</div>
      {/if}
      <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="flex items-center gap-1">
          <span class="font-mono">{svc.url}</span>
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('copy')} onclick={() => svc && copyUrl(svc.url)}><AppIcons.copy class="size-3" /></button>
        </span>
        {#each svc.ports.filter(p => p.publicUrl) as p (p.publicUrl)}
          <span class="flex items-center gap-1">
            <a href={p.publicUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">{p.publicUrl}</a>
            <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('copy')} onclick={() => copyUrl(p.publicUrl)}><AppIcons.copy class="size-3" /></button>
          </span>
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
      <input type="checkbox" checked={previous} onchange={e => pickLogSource({ previous: e.currentTarget.checked })} /> {t('serviceLogsPrevious')}
    </label>
    <label class="flex items-center gap-1">
      <input type="checkbox" checked={follow} onchange={e => pickLogSource({ follow: e.currentTarget.checked })} /> {t('serviceLogsFollow')}
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
