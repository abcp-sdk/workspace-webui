<script lang="ts">
  // BlameView — per-line authorship of one file (gateway go-git blame). A fixed
  // left gutter shows the short sha + author + relative time; the right column
  // is the file text. Clicking a gutter jumps to that commit's page.
  import type { AppStore } from '$lib/store.svelte'
  import type { BlameLine } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'

  let {
    store,
    org,
    repo,
    ref,
    path,
  }: { store: AppStore; org: string; repo: string; ref: string; path: string } = $props()

  const api = $derived(store.api)
  let lines = $state<BlameLine[]>([])
  let loading = $state(true)
  let error = $state(false)

  $effect(() => {
    let cancelled = false
    const o = org, r = repo, rf = ref, p = path
    void o
    void r
    void rf
    void p
    loading = true
    error = false
    void (async () => {
      try {
        const l = await api.blame(o, r, rf, p)
        if (!cancelled) lines = l
      } catch (e) {
        if (!cancelled) {
          error = true
          showErrorToast(String(e))
        }
      }
      if (!cancelled) loading = false
    })()
    return () => {
      cancelled = true
    }
  })

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
  function openCommit(sha: string) {
    store.pushChild({ kind: 'repo_commit', key: `commit:${org}/${repo}@${sha}`, org, repo, ref, sha })
  }
</script>

{#if loading}
  <div class="flex h-full items-center justify-center">
    <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
  </div>
{:else if error}
  <EmptyState center>{t('loadError', { e: '' })}</EmptyState>
{:else}
  <div class="h-full overflow-auto bg-card font-mono text-[11.5px] leading-[1.55]">
    {#each lines as l (l.line)}
      <div class="flex min-w-0">
        <button
          type="button"
          class="flex w-56 shrink-0 items-center gap-1.5 border-r border-border/40 px-2 text-left text-[10px] text-muted-foreground hover:bg-muted"
          title="{l.author} · {l.date}"
          onclick={() => openCommit(l.sha)}
        >
          <span class="shrink-0 font-semibold text-foreground/80">{l.author || '—'}</span>
          <span class="shrink-0 font-mono">{shortSha(l.sha)}</span>
          <span class="ml-auto shrink-0">{relTime(l.date)}</span>
        </button>
        <span class="w-10 shrink-0 px-1 text-right text-muted-foreground/60 select-none">{l.line}</span>
        <span class="min-w-0 flex-1 px-1 break-all whitespace-pre-wrap">{l.content}</span>
      </div>
    {/each}
  </div>
{/if}
