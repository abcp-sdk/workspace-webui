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
  import TabBar from '$lib/components/layout/TabBar.svelte'
  import TabItem from '$lib/components/layout/TabItem.svelte'
  import LogViewer from '$lib/components/LogViewer.svelte'

  let { store, name, showBack = false }: PageProps & { name: string } = $props()

  let svc = $state<ServiceInfo | null>(null)
  // Overview (meta + logs) vs the editable manifest.
  let view = $state<'overview' | 'yaml'>('overview')
  let lines = $state<string[]>([])
  let streaming = $state(false)
  // The log source is component-local view state (not part of the identity).
  let previous = $state(false)
  let follow = $state(true)
  // The viewer's auto-scroll is independent of the stream-source `follow`.
  let autoScroll = $state(true)
  let logError = $state('')
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

  // ---- replica scaling ----
  let scaling = $state(false)
  async function scaleTo(next: number) {
    if (scaling || next < 0) return
    scaling = true
    try {
      const v = await store.api.scaleService(name, next)
      if (v) {
        svc = v
        store.dataSet(`service:${name}`, v)
      }
      showToast(t('scaled'))
    } catch (e) {
      showErrorToast(String(e))
    }
    scaling = false
  }
  function bumpReplicas(delta: number) {
    if (!svc) return
    void scaleTo(svc.replicas + delta)
  }

  // ---- manifest (YAML) editor ----
  let manifest = $state('')
  let manifestDirty = $state(false)
  let manifestBusy = $state(false)
  let manifestLoaded = $state(false)

  async function loadManifest(force = false) {
    if (manifestLoaded && !force && manifestDirty) return
    manifestBusy = true
    try {
      manifest = await store.api.getServiceManifest(name)
      manifestDirty = false
      manifestLoaded = true
    } catch (e) {
      showErrorToast(String(e))
    }
    manifestBusy = false
  }

  function onManifestInput(e: Event) {
    manifest = (e.currentTarget as HTMLTextAreaElement).value
    manifestDirty = true
  }

  async function applyManifest(dryRun: boolean) {
    if (manifestBusy) return
    manifestBusy = true
    try {
      const r = await store.api.applyServiceManifest(name, manifest, dryRun)
      if (dryRun) {
        showToast(t('manifestValid'))
      } else {
        showToast(t('manifestApplied'))
        if (r.service) {
          svc = r.service
          store.dataSet(`service:${name}`, r.service)
        }
        manifest = r.yaml
        manifestDirty = false
      }
    } catch (e) {
      showErrorToast(String(e))
    }
    manifestBusy = false
  }

  // Fetch the manifest lazily the first time the YAML view opens.
  $effect(() => {
    if (view === 'yaml' && !manifestLoaded) void loadManifest()
  })

  const envEntries = $derived(Object.entries(svc?.env ?? {}))

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

  const SNAPSHOT_TAIL = 500
  let truncated = $state(false)

  async function startLogs() {
    abort?.abort()
    lines = []
    logError = ''
    truncated = false
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
        const snap = await store.api.serviceLogs(name, SNAPSHOT_TAIL, previous)
        lines = snap
        // A full tail means the container likely has older lines above it.
        truncated = snap.length >= SNAPSHOT_TAIL
      }
    } catch (e) {
      logError = String(e)
    }
    streaming = false
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
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.server class="size-4 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 wrap-anywhere text-base font-semibold">{name}</span>
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
      <div class="break-all whitespace-pre-wrap font-mono">{svc.image}</div>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {#if svc.podPhase}<span>{t('servicePodPhase')}: {svc.podPhase}</span>{/if}
        <span class={cn(svc.restarts > 0 && 'text-destructive')}>{t('serviceRestarts')}: {svc.restarts}</span>
        <!-- replica stepper -->
        <span class="flex items-center gap-1">
          <span>{t('serviceReplicas')}:</span>
          <button type="button" class="rounded p-0.5 hover:bg-muted disabled:opacity-30" disabled={scaling || svc.replicas <= 0} title="-1" onclick={() => bumpReplicas(-1)}><AppIcons.remove class="size-3" /></button>
          <span class="font-mono tabular-nums">{svc.readyReplicas}/{svc.replicas}</span>
          <button type="button" class="rounded p-0.5 hover:bg-muted disabled:opacity-30" disabled={scaling} title="+1" onclick={() => bumpReplicas(1)}><AppIcons.add class="size-3" /></button>
        </span>
        {#if svc.cpu}<span>cpu: {svc.cpu}</span>{/if}
        {#if svc.memory}<span>mem: {svc.memory}</span>{/if}
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

  <TabBar>
    <TabItem active={view === 'overview'} onclick={() => (view = 'overview')}>
      <AppIcons.server class="size-3.5" />{t('serviceOverview')}
    </TabItem>
    <TabItem active={view === 'yaml'} onclick={() => (view = 'yaml')}>
      <AppIcons.file_code class="size-3.5" />YAML
    </TabItem>
  </TabBar>

  {#if view === 'yaml'}
    <div class="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-1.5 text-[10px]">
      {#if manifestDirty}<span class="text-warning">{t('unsavedChanges')}</span>{/if}
      <span class="ml-auto"></span>
      <button type="button" class="rounded p-1 hover:bg-muted disabled:opacity-40" disabled={manifestBusy} title={t('refresh')} onclick={() => void loadManifest(true)}><AppIcons.refresh class="size-3.5" /></button>
      <button type="button" class="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40" disabled={manifestBusy} onclick={() => void applyManifest(true)}>{t('validate')}</button>
      <button type="button" class="rounded bg-primary px-2 py-0.5 text-primary-foreground hover:bg-primary/80 disabled:opacity-40" disabled={manifestBusy || !manifestDirty} onclick={() => void applyManifest(false)}>{t('apply')}</button>
    </div>
    <textarea
      class="min-h-0 flex-1 resize-none overflow-auto bg-card p-3 font-mono text-[11.5px] leading-relaxed outline-none"
      spellcheck="false"
      value={manifest}
      oninput={onManifestInput}
    ></textarea>
  {:else}
    {#if svc && (envEntries.length || svc.command.length || svc.volumes.length)}
      <div class="shrink-0 border-b border-border/50 px-4 py-2 text-[10px]">
        {#if svc.command.length}
          <div class="mb-1">
            <span class="text-muted-foreground">{t('serviceCommand')}:</span>
            <span class="ml-1 font-mono break-all">{svc.command.join(' ')}</span>
          </div>
        {/if}
        {#if envEntries.length}
          <div class="mb-1">
            <span class="text-muted-foreground">{t('serviceEnv')}:</span>
            <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {#each envEntries as [k, v] (k)}
                <span class="font-mono break-all">{k}=<span class="text-foreground">{v}</span></span>
              {/each}
            </div>
          </div>
        {/if}
        {#if svc.volumes.length}
          <div>
            <span class="text-muted-foreground">{t('serviceVolumes')}:</span>
            <div class="mt-0.5 space-y-0.5">
              {#each svc.volumes as v (v.pvc + v.mountPath)}
                <div class="flex flex-wrap items-center gap-x-2 font-mono">
                  <AppIcons.database class="size-3 text-primary" />
                  <span class="text-foreground">{v.pvc}</span>
                  <span>→ {v.mountPath}</span>
                  {#if v.readOnly}<span class="rounded bg-muted px-1">ro</span>{/if}
                  {#if v.subPath}<span>sub: {v.subPath}</span>{/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- logs -->
    <div class="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
      <AppIcons.terminal class="size-3.5" />
      <span>{t('serviceLogs')}</span>
      {#if streaming}<span class="flex items-center gap-1 text-warning"><span class="size-2 animate-pulse rounded-full bg-warning"></span>{t('live')}</span>{/if}
      <label class="flex items-center gap-1">
        <input type="checkbox" checked={previous} onchange={e => pickLogSource({ previous: e.currentTarget.checked })} /> {t('serviceLogsPrevious')}
      </label>
      <label class="flex items-center gap-1">
        <input type="checkbox" checked={follow} onchange={e => pickLogSource({ follow: e.currentTarget.checked })} /> {t('serviceLogsFollow')}
      </label>
      <button type="button" class="rounded p-1 hover:bg-muted" title={t('refresh')} onclick={() => void startLogs()}><AppIcons.refresh class="size-3.5" /></button>
    </div>
    <LogViewer
      lines={lines}
      error={logError}
      waitingText={t('serviceLogsWaiting')}
      bind:follow={autoScroll}
      showFollow={false}
      caption={truncated ? t('logsTruncated', { arg1: String(SNAPSHOT_TAIL) }) : ''}
      downloadName={`${name}.log`}
    />
  {/if}
</div>
