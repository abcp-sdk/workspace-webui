<script lang="ts">
  // RepoHistory — one file's commit history (the commits that touched `path`).
  // Selecting a commit opens a `repo_history_diff` page comparing that version
  // with the current ref version.
  import type { PageProps } from '$lib/page-props'
  import type { CommitInfo } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { AppIcons } from '$lib/icons'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import ListRow from '$lib/components/layout/ListRow.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let {
    store,
    org,
    repo,
    ref,
    path,
    showBack = false,
  }: PageProps & { org: string; repo: string; ref: string; path: string } = $props()

  const api = $derived(store.api)
  const name = $derived(path.split('/').pop() ?? path)

  let commits = $state<CommitInfo[]>([])
  let loading = $state(true)

  $effect(() => {
    const o = org, r = repo, rf = ref, p = path
    void o
    void r
    void rf
    void p
    void load()
  })

  async function load() {
    // Cache-first: a pane SLIDE re-runs this effect but must not refetch.
    const key = `filehist:${org}/${repo}@${ref}:${path}`
    loading = !store.hasData(key)
    try {
      commits = await store.dataLoad(key, () => api.log(org, repo, ref, path, 100))
    } catch (e) {
      showErrorToast(String(e))
      commits = []
    }
    loading = false
  }

  function open(c: CommitInfo) {
    store.pushChild({
      kind: 'repo_history_diff',
      key: `histdiff:${org}/${repo}@${ref}:${path}:${c.sha}`,
      org,
      repo,
      ref,
      path,
      sha: c.sha,
    })
  }

  function shortSha(s: string): string {
    return s.slice(0, 8)
  }
  function relTime(iso: string): string {
    const d = Date.parse(iso)
    if (isNaN(d)) return ''
    const mins = Math.floor((Date.now() - d) / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return `${mins}m`
    if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`
    return `${Math.floor(mins / (60 * 24))}d`
  }
</script>

<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.history class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-base font-semibold">{name}</span>
      <span class="block truncate text-[10px] text-muted-foreground">{t('fileHistory')} · {org}/{repo} · {ref}</span>
    </span>
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
    {:else if commits.length === 0}
      <EmptyState>{t('noCommits')}</EmptyState>
    {:else}
      {#each commits as c (c.sha)}
        <ListRow divided align="start" onclick={() => open(c)}>
          <AppIcons.commit class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-meta">{c.message.split('\n')[0]}</span>
            <span class="block truncate text-[10px] text-muted-foreground">{c.author} · {relTime(c.date)} · <span class="font-mono">{shortSha(c.sha)}</span></span>
          </span>
        </ListRow>
      {/each}
    {/if}
  </div>
</div>
