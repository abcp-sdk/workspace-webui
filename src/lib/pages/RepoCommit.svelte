<script lang="ts">
  // RepoCommit — one commit as a full page: meta (author/date/parents), the
  // changed-file list and the unified diff. Opened from the Commits sub-tab.
  import type { PageProps } from '$lib/page-props'
  import type { CommitDetail } from '$lib/api'
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
    sha,
    showBack = false,
  }: PageProps & { org: string; repo: string; ref: string; sha: string } = $props()

  const api = $derived(store.api)

  let detail = $state<CommitDetail | null>(null)
  let diff = $state('')
  let loading = $state(true)

  $effect(() => {
    const o = org, r = repo, s = sha
    void o
    void r
    void s
    void load()
  })

  async function load() {
    loading = true
    try {
      const [d, df] = await Promise.all([
        api.getCommit(org, repo, sha),
        api.commitDiff(org, repo, sha),
      ])
      detail = d
      diff = df
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
  }

  function openParent(p: string) {
    store.pushChild({ kind: 'repo_commit', key: `commit:${org}/${repo}@${p}`, org, repo, ref, sha: p })
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
    <AppIcons.commit class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{detail?.message.split('\n')[0] || shortSha(sha)}</span>
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-auto">
    {#if loading}
      <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
    {:else}
      <div class="border-b border-border/50 px-4 py-3 text-micro text-muted-foreground">
        <div class="flex items-center gap-2">
          <span class="font-mono text-foreground">{shortSha(sha)}</span>
          {#if detail?.author}<span>{detail.author}</span>{/if}
          {#if detail?.date}<span>{relTime(detail.date)}</span>{/if}
        </div>
        {#if detail?.message}
          <div class="mt-2 whitespace-pre-wrap text-meta text-foreground">{detail.message}</div>
        {/if}
        {#if detail?.parents?.length}
          <div class="mt-2 flex flex-wrap items-center gap-1">
            <span>{t('parents')}:</span>
            {#each detail.parents as p (p)}
              <button type="button" class="rounded bg-muted px-1.5 py-px font-mono hover:bg-muted/70" onclick={() => openParent(p)}>{shortSha(p)}</button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="p-3">
        {#if diff}<DiffView {diff} name={shortSha(sha)} />{:else}<EmptyState>{t('diffEmpty')}</EmptyState>{/if}
      </div>
    {/if}
  </div>
</div>
