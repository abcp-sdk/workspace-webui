<script lang="ts">
  // Shell — web port of flutter _Shell + app_layout.dart: phones (<640px) get
  // a bottom tab bar (hidden while a chat is open), tablets a left rail
  // (96px), and per-tab content renders the last 1 (phone) / 2 (tablet) pages
  // of the navigation stack side by side.
  import type { Component } from 'svelte'
  import type { AppPage, AppStore } from './store.svelte'
  import type { PageProps } from './page-props'
  import { visibleWindow } from './nav'
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
  import SandboxFiles from './pages/SandboxFiles.svelte'
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

  /** Build the prop bag for one pane from its page (its own identity). */
  function propsFor(page: AppPage, isTop: boolean): PageProps {
    return {
      store,
      themeMode,
      onThemeMode,
      onSwitchBackend,
      onBackendSwitched,
      onUiLocale,
      onAddUser,
      showBack: isTop,
      initialId: page.kind === 'config_sub' ? page.id : undefined,
      overlay: page.kind === 'chat_overlay' ? page.overlay : undefined,
      modelId: page.kind === 'provider_models' ? page.modelId : undefined,
      session:
        page.kind === 'chat_session' || page.kind === 'chat_overlay'
          ? page.session
          : undefined,
      name:
        page.kind === 'sandbox_detail' ||
        page.kind === 'sandbox_job' ||
        page.kind === 'sandbox_files' ||
        page.kind === 'service_detail'
          ? page.name
          : undefined,
      jobId: page.kind === 'sandbox_job' ? page.jobId : undefined,
      org: 'org' in page ? page.org : undefined,
      repo: 'repo' in page ? page.repo : undefined,
      ref: 'ref' in page ? page.ref : undefined,
      path: 'path' in page ? page.path : undefined,
      sha: 'sha' in page ? page.sha : undefined,
      index: 'index' in page ? page.index : undefined,
      tag: 'tag' in page ? page.tag : undefined,
      base: 'base' in page ? page.base : undefined,
      head: 'head' in page ? page.head : undefined,
    }
  }

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
      case 'sandbox_files':
        return SandboxFiles as Component<PageProps>
      case 'service_detail':
        return ServiceDetail as Component<PageProps>
    }
  }

  // The visible window of the MAIN path (oldest → newest): at most TWO columns
  // (list + detail). While the drawer is open the main region shows only its
  // TOP page, because the drawer supplies the second column — the total stays
  // at two, so opening a cross-lane reference SLIDES the window (`1|2 → 2|3`)
  // instead of growing to three columns.
  const panes = $derived.by(() => {
    const win = visibleWindow(store.primaryStack, store.drawerOpen)
    return win.map((page, i, arr) => ({
      page,
      isTop: i === arr.length - 1,
      C: componentFor(page),
    }))
  })

  const drawerTop = $derived(store.drawerTop)
  const DrawerC = $derived(drawerTop ? componentFor(drawerTop) : null)
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

  <main class={cn('relative flex min-h-0 min-w-0 flex-1', isCompact && !hideBottomBar && 'pb-[60px]')}>
    <!-- The main region: its own container, so the two-pane split follows THIS
         region's width. Docking the drawer narrows it and the split collapses
         on its own — the main path is never touched. -->
    <div class="@container relative flex min-h-0 min-w-0 flex-1">
      {#each panes as p, i (p.page.key)}
        <!-- The non-top pane is the "list" column: hidden once the region is
             too narrow for a comfortable two-column split. -->
        <div
          class={cn(
            'relative flex min-h-0 min-w-0 flex-1',
            i > 0 && 'border-l border-border',
            !p.isTop && 'hidden @md:flex',
          )}
          onpointerdowncapture={() => (store.navTarget = 'main')}
        >
          <p.C {...propsFor(p.page, p.isTop)} />
        </div>
      {/each}
    </div>

    <!-- Drawer: a cross-lane reference (a chat tool-card link to a blob) shown
         beside the main region without disturbing it. Wide windows dock it;
         narrow ones overlay it full-width. -->
    {#if drawerTop && DrawerC}
      <div
        class="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col bg-background sm:static sm:w-1/2 sm:max-w-[900px] sm:shrink-0 sm:border-l sm:border-border"
        onpointerdowncapture={() => (store.navTarget = 'drawer')}
      >
        <!-- drawer toolbar: back / open-in-tab -->
        <div class="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-1.5 text-micro text-muted-foreground">
          <button
            type="button"
            class="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted"
            title={t('back')}
            onclick={() => store.popPage()}
          >
            <AppIcons.back class="size-3.5" />
            {t('back')}
          </button>
          <span class="min-w-0 flex-1 truncate text-center">{t('preview')}</span>
          <button
            type="button"
            class="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted"
            title={t('openInTab')}
            onclick={() => drawerTop && store.openMain(drawerTop)}
          >
            {t('openInTab')}
            <AppIcons.expand class="size-3.5" />
          </button>
          <button
            type="button"
            class="rounded p-1 hover:bg-muted"
            title={t('close')}
            onclick={() => store.closeDrawer()}
          >
            <AppIcons.close class="size-3.5" />
          </button>
        </div>
        <div class="relative flex min-h-0 min-w-0 flex-1">
          <DrawerC {...propsFor(drawerTop, false)} showBack={false} />
        </div>
      </div>
    {/if}
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
