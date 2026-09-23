<script lang="ts">
  // RepoCompare — the multi-file diff between two refs (base...head). Opened
  // from a `repo-diff` tool card. Each file's patch is computed by the gateway
  // (Forgejo's compare `patch` is empty on 1.22) and rendered with DiffView.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { AppIcons } from '$lib/icons'
  import DiffView from '$lib/components/DiffView.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let {
    store,
    org,
    repo,
    base,
    head,
    showBack = false,
  }: PageProps & { org: string; repo: string; base: string; head: string } = $props()

  const api = $derived(store.api)

  let diff = $state('')
  let loading = $state(true)

  $effect(() => {
    const o = org, r = repo, b = base, h = head
    void o
    void r
    void b
    void h
    void load(o, r, b, h)
  })

  async function load(o: string, r: string, b: string, h: string) {
    loading = true
    try {
      const files = await api.compare(o, r, b, h)
      // Concatenate per-file patches into one unified diff.
      diff = files
        .map(f => `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n${f.patch}`)
        .join('\n')
    } catch (e) {
      showErrorToast(String(e))
      diff = ''
    }
    loading = false
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.diff class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-base font-semibold">{org}/{repo}</span>
      <span class="block truncate text-[10px] text-muted-foreground"><span class="font-mono">{base}</span> → <span class="font-mono">{head}</span></span>
    </span>
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-auto p-3">
    {#if loading}
      <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
    {:else if !diff}
      <EmptyState>{t('diffEmpty')}</EmptyState>
    {:else}
      <DiffView {diff} />
    {/if}
  </div>
</div>
