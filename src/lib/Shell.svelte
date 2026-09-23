<script lang="ts">
  // Shell — web port of flutter _Shell + app_layout.dart: phones (<640px) get
  // a bottom tab bar (hidden while a chat is open), tablets a left rail
  // (96px), and per-tab content renders the last 1 (phone) / 2 (tablet) pages
  // of the navigation stack side by side.
  import type { Component } from 'svelte'
  import type { AppPage, AppStore } from './store.svelte'
  import type { PageProps } from './page-props'
  import { t } from './i18n.svelte'
  import { cn } from './utils'
  import { AppIcons } from '$lib/icons'
  import SessionList from './pages/SessionList.svelte'
  import Chat from './pages/Chat.svelte'
  import Mailbox from './pages/Mailbox.svelte'
  import Config from './pages/Config.svelte'
  import ProvidersList from './pages/providers/ProvidersList.svelte'
  import ProviderForm from './pages/providers/ProviderForm.svelte'
  import ProviderModelForm from './pages/providers/ProviderModelForm.svelte'
  import CodeTab from './pages/CodeTab.svelte'
  import RepoDetail from './pages/RepoDetail.svelte'
  import RepoBlob from './pages/RepoBlob.svelte'
  import RepoHistory from './pages/RepoHistory.svelte'
  import RepoHistoryDiff from './pages/RepoHistoryDiff.svelte'
  import RepoCommit from './pages/RepoCommit.svelte'
  import RepoMR from './pages/RepoMR.svelte'
  import RepoRelease from './pages/RepoRelease.svelte'
  import RepoCompare from './pages/RepoCompare.svelte'
  import ServiceRoot from './pages/ServiceRoot.svelte'
  import SandboxDetail from './pages/SandboxDetail.svelte'
  import SandboxJob from './pages/SandboxJob.svelte'
  import ServiceDetail from './pages/ServiceDetail.svelte'

  let {
    store,
    themeMode,
    onThemeMode,
    onSwitchBackend,
    onBackendSwitched,
    onUiLocale,
    onAddUser,
  }: Omit<PageProps, 'showBack' | 'initialId' | 'overlay' | 'modelId'> = $props()

  // Container queries: the split is decided by the PANE width (the <main>
  // element), not the window — so a tablet showing two columns each still
  // renders its own content responsively.
  let width = $state(typeof window !== 'undefined' ? window.innerWidth : 1280)
  $effect(() => {
    const on = () => (width = window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  })

  // The bottom tab bar is a PHONE affordance (window-driven).
  const isCompact = $derived(width < 640)
  const hideBottomBar = $derived(isCompact && store.siderTab === 'chat' && store.activeSessionId != null)

  const tabs = [
    { id: 'chat' as const, label: 'tabChat', icon: AppIcons.chat },
    { id: 'code' as const, label: 'tabCode', icon: AppIcons.folder },
    { id: 'service' as const, label: 'tabService', icon: AppIcons.box },
    { id: 'config' as const, label: 'tabConfig', icon: AppIcons.settings },
  ]

  function componentFor(page: AppPage): Component<PageProps> {
    switch (page.kind) {
      case 'chat_list':
        return SessionList as Component<PageProps>
      case 'chat_session':
        return Chat as Component<PageProps>
      case 'chat_overlay':
        return Mailbox as Component<PageProps>
      case 'config_root':
      case 'config_sub':
        return Config as Component<PageProps>
      case 'providers_list':
        return ProvidersList as Component<PageProps>
      case 'provider_form':
        return ProviderForm as Component<PageProps>
      case 'provider_models':
        return ProviderModelForm as Component<PageProps>
      case 'code_root':
        return CodeTab as Component<PageProps>
      case 'repo_detail':
        return RepoDetail as Component<PageProps>
      case 'repo_blob':
        return RepoBlob as Component<PageProps>
      case 'repo_history':
        return RepoHistory as Component<PageProps>
      case 'repo_history_diff':
        return RepoHistoryDiff as Component<PageProps>
      case 'repo_commit':
        return RepoCommit as Component<PageProps>
      case 'repo_mr':
        return RepoMR as Component<PageProps>
      case 'repo_release':
        return RepoRelease as Component<PageProps>
      case 'repo_tag':
        return RepoDetail as Component<PageProps>
      case 'repo_compare':
        return RepoCompare as Component<PageProps>
      case 'service_root':
        return ServiceRoot as Component<PageProps>
      case 'sandbox_detail':
        return SandboxDetail as Component<PageProps>
      case 'sandbox_job':
        return SandboxJob as Component<PageProps>
      case 'service_detail':
        return ServiceDetail as Component<PageProps>
    }
  }

  // The last two pages of the visible stack (oldest → newest). On a narrow
  // container the earlier pane is hidden by a CSS container query, so the
  // split adapts to the PANE width rather than the window.
  const panes = $derived.by(() => {
    const stack = store.currentStack
    const start = Math.max(0, stack.length - 2)
    return stack
      .slice(start)
      .map((page, i, arr) => ({
        page,
        isTop: i === arr.length - 1,
        C: componentFor(page),
      }))
  })
</script>

<div class="flex h-dvh w-full flex-col overflow-hidden bg-background sm:flex-row">
  {#if !isCompact}
    <nav class="flex w-24 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-3">
      {#each tabs as tb (tb.id)}
        <button
          type="button"
          class={cn(
            'flex w-16 flex-col items-center gap-1 rounded-lg py-2.5',
            store.siderTab === tb.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted',
          )}
          onclick={() => store.switchTab(tb.id)}
        >
          <tb.icon class="size-[22px]" />
          <span class="text-micro">{t(tb.label)}</span>
        </button>
      {/each}
    </nav>
  {/if}

  <main class={cn('@container flex min-h-0 min-w-0 flex-1', isCompact && !hideBottomBar && 'pb-[60px]')}>
    {#each panes as p, i (p.page.key)}
      <!-- The non-top pane is the "list" column: hidden once the container is
           too narrow for a comfortable two-column split. -->
      <div
        class={cn(
          'relative flex min-h-0 min-w-0 flex-1',
          i > 0 && 'border-l border-border',
          !p.isTop && 'hidden @md:flex',
        )}
      >
        <p.C
          {store}
          {themeMode}
          {onThemeMode}
          {onSwitchBackend}
          {onBackendSwitched}
          {onUiLocale}
          {onAddUser}
          showBack={p.isTop}
          initialId={p.page.kind === 'config_sub' ? p.page.id : undefined}
          overlay={p.page.kind === 'chat_overlay' ? p.page.overlay : undefined}
          modelId={p.page.kind === 'provider_models' ? p.page.modelId : undefined}
          name={p.page.kind === 'sandbox_detail' || p.page.kind === 'sandbox_job' || p.page.kind === 'service_detail' ? p.page.name : undefined}
          jobId={p.page.kind === 'sandbox_job' ? p.page.jobId : undefined}
          org={'org' in p.page ? p.page.org : undefined}
          repo={'repo' in p.page ? p.page.repo : undefined}
          ref={'ref' in p.page ? p.page.ref : undefined}
          path={'path' in p.page ? p.page.path : undefined}
          sha={'sha' in p.page ? p.page.sha : undefined}
          index={'index' in p.page ? p.page.index : undefined}
          tag={'tag' in p.page ? p.page.tag : undefined}
          base={'base' in p.page ? p.page.base : undefined}
          head={'head' in p.page ? p.page.head : undefined}
          tab={'tab' in p.page ? p.page.tab : undefined}
          mrState={'mrState' in p.page ? p.page.mrState : undefined}
          view={p.page.kind === 'repo_blob' ? p.page.view : undefined}
          logs={p.page.kind === 'service_detail' ? p.page.logs : undefined}
          prev={p.page.kind === 'service_detail' ? p.page.prev : undefined}
        />
      </div>
    {/each}
  </main>

  {#if isCompact && !hideBottomBar}
    <nav class="fixed inset-x-0 bottom-0 z-30 flex h-[60px] border-t border-border bg-card">
      {#each tabs as tb (tb.id)}
        <button
          type="button"
          class={cn(
            'flex flex-1 flex-col items-center justify-center gap-1',
            store.siderTab === tb.id ? 'text-primary' : 'text-muted-foreground',
          )}
          onclick={() => store.switchTab(tb.id)}
        >
          <tb.icon class="size-[22px]" />
          <span class="text-micro">{t(tb.label)}</span>
        </button>
      {/each}
    </nav>
  {/if}
</div>
