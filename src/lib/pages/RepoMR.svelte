<script lang="ts">
  // RepoMR — one change request as a full page: meta, unified diff and the
  // read-only comment thread. Opened from the Changes sub-tab.
  import type { PageProps } from '$lib/page-props'
  import type { MRInfo } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import DiffView from '$lib/components/DiffView.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let {
    store,
    org,
    repo,
    index,
    showBack = false,
  }: PageProps & { org: string; repo: string; index: number } = $props()

  const api = $derived(store.api)

  let mr = $state<MRInfo | null>(null)
  let diff = $state('')
  let comments = $state<{ id: number; author: string; body: string; createdAt: string }[]>([])
  let loading = $state(true)

  $effect(() => {
    const o = org, r = repo, i = index
    void o
    void r
    void i
    void load()
  })

  async function load() {
    loading = true
    try {
      const [m, d, c] = await Promise.all([
        api.getMR(org, repo, index),
        api.mrDiff(org, repo, index),
        api.listMRComments(org, repo, index),
      ])
      mr = m
      diff = d
      comments = c
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
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
    <AppIcons.merge class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">#{index} {mr?.title ?? ''}</span>
    {#if mr}
      <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', mr.merged ? 'bg-violet-500/15 text-violet-500' : mr.state === 'open' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>{mr.merged ? t('merged') : mr.state}</span>
    {/if}
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
    {:else if mr}
      <div class="border-b border-border/50 px-4 py-3 text-micro text-muted-foreground">
        <div><span class="font-mono">{mr.head}</span> → <span class="font-mono">{mr.base}</span></div>
        <div class="mt-0.5">{mr.author || '—'} · {relTime(mr.createdAt)} · {mr.changedFiles} {t('filesChanged')}</div>
        {#if mr.body}<div class="mt-2 rounded-md bg-muted/40 px-3 py-2 whitespace-pre-wrap text-meta text-foreground">{mr.body}</div>{/if}
      </div>
      <div class="p-3"><DiffView {diff} /></div>
      {#if comments.length}
        <div class="border-t border-border/50 px-4 py-3">
          <div class="mb-2 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('comments')} · {comments.length}</div>
          <div class="space-y-2">
            {#each comments as c (c.id)}
              <div class="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div class="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span class="font-semibold text-foreground">{c.author || '—'}</span><span>{relTime(c.createdAt)}</span>
                </div>
                <div class="whitespace-pre-wrap text-meta">{c.body}</div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
