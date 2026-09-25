<script lang="ts">
  // BlameView — per-line authorship of one file (gateway go-git blame). Code
  // uses the FULL width; a line-number gutter sits on the left and the blame
  // annotation (sha · time · author) TRAILS the line inline, shown once per
  // commit run. Clicking the annotation jumps to that commit's page.
  import type { AppStore } from '$lib/store.svelte'
  import type { BlameLine } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { gutterWidth } from '$lib/line-gutter'
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

  const gutterW = $derived(gutterWidth(lines.length ? lines[lines.length - 1]!.line : 1, 0.75))

  $effect(() => {
    let cancelled = false
    const o = org, r = repo, rf = ref, p = path
    void o
    void r
    void rf
    void p
    // Cache-first: a pane SLIDE re-runs this effect but must not refetch.
    const key = `blame:${o}/${r}@${rf}:${p}`
    loading = !store.hasData(key)
    error = false
    void (async () => {
      try {
        const l = await store.dataLoad(key, () => api.blame(o, r, rf, p))
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

  // Group consecutive lines sharing a commit: only the FIRST line of a run
  // carries the trailing annotation (GitHub/VSCode style), so repeated
  // author/sha/time never clutters every row.
  const rows = $derived.by(() => {
    const out: Array<BlameLine & { firstOfGroup: boolean }> = []
    let prev = ''
    for (const l of lines) {
      out.push({ ...l, firstOfGroup: l.sha !== prev })
      prev = l.sha
    }
    return out
  })
</script>

{#if loading}
  <div class="flex h-full items-center justify-center">
    <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
  </div>
{:else if error}
  <EmptyState center>{t('loadError', { e: '' })}</EmptyState>
{:else}
  <div class="h-full overflow-auto bg-card font-mono text-[11.5px] leading-[1.55]">
    {#each rows as l (l.line)}
      <div class="flex min-w-0 hover:bg-muted/30">
        <span class="shrink-0 px-1 text-right text-muted-foreground/60 select-none" style="width: {gutterW}; min-width: {gutterW}">{l.line}</span>
        <!-- Code uses the FULL width; the blame annotation trails the line
             inline (never a fixed left column that squeezes the code). -->
        <span class="min-w-0 flex-1 px-1 break-all whitespace-pre-wrap">{l.content}{#if l.firstOfGroup}<button
            type="button"
            class="ml-3 inline whitespace-nowrap text-[10px] text-muted-foreground/50 select-none hover:text-primary hover:underline"
            title="{l.author}{l.authorEmail ? ` <${l.authorEmail}>` : ''} · {l.date}"
            onclick={() => openCommit(l.sha)}
          >{shortSha(l.sha)} · {relTime(l.date)} · {l.author || '—'}</button>{/if}</span>
      </div>
    {/each}
  </div>
{/if}

