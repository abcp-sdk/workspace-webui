<script lang="ts">
  // RepoHistoryDiff — one file's diff between a historical commit (sha) and the
  // current ref version. Uses the gateway Compare (base=sha, head=ref) filtered
  // to the file.
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
    ref,
    path,
    sha,
    showBack = false,
  }: PageProps & { org: string; repo: string; ref: string; path: string; sha: string } = $props()

  const api = $derived(store.api)
  const name = $derived(path.split('/').pop() ?? path)

  let diff = $state('')
  let loading = $state(true)

  $effect(() => {
    const o = org, r = repo, rf = ref, p = path, s = sha
    void o
    void r
    void rf
    void p
    void s
    void load()
  })

  async function load() {
    loading = true
    try {
      diff = await api.fileDiff(org, repo, sha, ref, path)
    } catch (e) {
      showErrorToast(String(e))
      diff = ''
    }
    loading = false
  }

  function shortSha(s: string): string {
    return s.slice(0, 8)
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.diff class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-base font-semibold">{name}</span>
      <span class="block truncate text-[10px] text-muted-foreground">
        <span class="font-mono">{shortSha(sha)}</span> → <span class="font-mono">{ref}</span> · {org}/{repo}
      </span>
    </span>
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-auto p-3">
    {#if loading}
      <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
    {:else if !diff}
      <EmptyState>{t('diffEmpty')}</EmptyState>
    {:else}
      <DiffView {diff} name={name} />
    {/if}
  </div>
</div>
