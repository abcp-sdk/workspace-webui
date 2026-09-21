<script lang="ts">
  // RepoDetail — read-only browser for one repository (the right pane of the
  // Code tab). The parent CodeTab owns the left tree (org > repo > branch) and
  // passes the active `ref`; sub-tabs here are Files / Commits / Tags /
  // Releases / Changes (MRs). Everything is GET-only.
  import type { BranchInfo, CommitInfo, MRInfo, ReleaseAsset, ReleaseInfo, TagInfo, TreeEntry } from '$lib/api'
  import type { AgentApi } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { formatBytes } from '$lib/media'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import DiffView from '$lib/components/DiffView.svelte'
  import RepoAvatar from '$lib/components/RepoAvatar.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import TabBar from '$lib/components/layout/TabBar.svelte'
  import TabItem from '$lib/components/layout/TabItem.svelte'
  import ListRow from '$lib/components/layout/ListRow.svelte'
  import SectionLabel from '$lib/components/layout/SectionLabel.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let {
    api,
    org,
    repo,
    ref,
    onPickRef,
    onOpenFile,
    onMenu = null,
  }: {
    api: AgentApi
    org: string
    repo: string
    ref: string
    onPickRef: (ref: string) => void
    onOpenFile: (path: string) => void
    /** When set (compact), render a tree-drawer button in the header. */
    onMenu?: (() => void) | null
  } = $props()

  type Tab = 'files' | 'commits' | 'tags' | 'releases' | 'changes'
  let tab = $state<Tab>('files')

  let branches = $state<BranchInfo[]>([])
  let tags = $state<TagInfo[]>([])
  let releases = $state<ReleaseInfo[]>([])
  let tree = $state<TreeEntry[]>([])
  let path = $state('') // current directory
  let commits = $state<CommitInfo[]>([])
  let mrs = $state<MRInfo[]>([])
  let mrState = $state('open')
  let loading = $state(true)

  // commit detail overlay
  let commitSha = $state('')
  let commitDiff = $state('')
  let commitLoading = $state(false)

  // MR detail overlay
  let mrDetail = $state<MRInfo | null>(null)
  let mrDiffText = $state('')
  let mrComments = $state<{ id: number; author: string; body: string; createdAt: string }[]>([])
  let mrLoading = $state(false)

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'files', label: 'files', icon: AppIcons.folder },
    { id: 'commits', label: 'commits', icon: AppIcons.commit },
    { id: 'tags', label: 'tags', icon: AppIcons.tag },
    { id: 'releases', label: 'releases', icon: AppIcons.rocket },
    { id: 'changes', label: 'changes', icon: AppIcons.merge },
  ]

  // Reload when the repo or the selected ref changes.
  $effect(() => {
    const o = org, r = repo
    void o
    void r
    void initLists()
  })
  $effect(() => {
    const rf = ref
    if (!rf) return
    path = ''
    void Promise.all([loadTree(), loadCommits()])
  })

  async function initLists() {
    loading = true
    try {
      const [bs, ts, rs] = await Promise.all([
        api.branches(org, repo),
        api.tags(org, repo),
        api.listReleases(org, repo),
      ])
      branches = bs
      tags = ts
      releases = rs
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
    void loadMRs()
  }

  async function loadTree() {
    try {
      tree = await api.tree(org, repo, ref, path)
    } catch (e) {
      showErrorToast(String(e))
      tree = []
    }
  }
  async function loadCommits() {
    try {
      commits = await api.log(org, repo, ref, '', 50)
    } catch {
      commits = []
    }
  }
  async function loadMRs() {
    try {
      mrs = await api.listMRs(org, repo, mrState)
    } catch {
      mrs = []
    }
  }

  // Entries at the current directory level.
  const entries = $derived.by(() => {
    const prefix = path ? path.replace(/\/$/, '') + '/' : ''
    const seen = new Set<string>()
    const out: { name: string; path: string; type: string; size: number }[] = []
    for (const e of tree) {
      if (!e.path.startsWith(prefix)) continue
      const rest = e.path.slice(prefix.length)
      if (rest === '') continue
      const slash = rest.indexOf('/')
      if (slash === -1) {
        out.push({ name: rest, path: e.path, type: e.type, size: e.size })
      } else {
        const dir = rest.slice(0, slash)
        if (!seen.has(dir)) {
          seen.add(dir)
          out.push({ name: dir, path: prefix + dir, type: 'dir', size: 0 })
        }
      }
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  })

  const crumbs = $derived(path ? path.split('/').filter(Boolean) : [])

  function openEntry(e: { path: string; type: string }) {
    if (e.type === 'dir') {
      path = e.path
      void loadTree()
    } else {
      onOpenFile(e.path)
    }
  }

  function up() {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    path = parts.join('/')
    void loadTree()
  }

  async function openCommit(c: CommitInfo) {
    commitSha = c.sha
    commitDiff = ''
    commitLoading = true
    try {
      commitDiff = await api.commitDiff(org, repo, c.sha)
    } catch (e) {
      showErrorToast(String(e))
    }
    commitLoading = false
  }

  async function openMR(m: MRInfo) {
    mrDetail = m
    mrDiffText = ''
    mrComments = []
    mrLoading = true
    try {
      const [d, c] = await Promise.all([api.mrDiff(org, repo, m.index), api.listMRComments(org, repo, m.index)])
      mrDiffText = d
      mrComments = c
    } catch (e) {
      showErrorToast(String(e))
    }
    mrLoading = false
  }

  /** Download a release asset (bytes proxied by the gateway). */
  async function downloadAsset(a: ReleaseAsset) {
    try {
      const { data } = await api.getReleaseAsset(org, repo, a.releaseId, a.id)
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }))
      const el = document.createElement('a')
      el.href = url
      el.download = a.name
      el.click()
      el.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast(t('download'))
    } catch (e) {
      showErrorToast(String(e))
    }
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
    {#if onMenu}<IconButton icon={AppIcons.list} label={t('tabCode')} onclick={onMenu} />{/if}
    <RepoAvatar {org} {repo} branch={ref} level="repo" size={28} />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{org}/{repo}</span>
    <span class="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] leading-4 text-muted-foreground">{ref}</span>
  </PageHeader>

  <!-- sub-tabs -->
  <TabBar>
    {#each tabs as tb (tb.id)}
      <TabItem active={tab === tb.id} onclick={() => (tab = tb.id)}>
        <tb.icon class="size-3.5" />{t(tb.label)}
      </TabItem>
    {/each}
  </TabBar>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading && tab !== 'files' && tab !== 'commits'}
      <div class="flex justify-center py-10">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else if tab === 'files'}
      {#if crumbs.length}
        <ListRow onclick={up}>
          <AppIcons.back class="size-4 text-muted-foreground" /> {crumbs.join(' / ')}
        </ListRow>
      {/if}
      {#if entries.length === 0}
        <EmptyState>{t('emptyRepo')}</EmptyState>
      {:else}
        {#each entries as e (e.path)}
          <ListRow onclick={() => openEntry(e)}>
            {#if e.type === 'dir'}<AppIcons.folder class="size-4 shrink-0 text-primary" />{:else}<AppIcons.file class="size-4 shrink-0 text-muted-foreground" />{/if}
            <span class="min-w-0 flex-1 truncate text-meta">{e.name}</span>
            {#if e.type === 'file'}<span class="shrink-0 text-[10px] text-muted-foreground">{formatBytes(e.size)}</span>{/if}
          </ListRow>
        {/each}
      {/if}

    {:else if tab === 'commits'}
      {#each commits as c (c.sha)}
        <ListRow divided align="start" onclick={() => void openCommit(c)}>
          <AppIcons.commit class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-meta">{c.message.split('\n')[0]}</span>
            <span class="block truncate text-[10px] text-muted-foreground">{c.author} · {relTime(c.date)} · <span class="font-mono">{shortSha(c.sha)}</span></span>
          </span>
        </ListRow>
      {/each}

    {:else if tab === 'tags'}
      {#if tags.length === 0}
        <EmptyState>{t('noTags')}</EmptyState>
      {:else}
        {#each tags as tg (tg.name)}
          <ListRow active={tg.name === ref} onclick={() => onPickRef(tg.name)}>
            <AppIcons.tag class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-meta font-medium">{tg.name}</span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{shortSha(tg.sha)}</span>
          </ListRow>
        {/each}
      {/if}

    {:else if tab === 'releases'}
      {#if releases.length === 0}
        <EmptyState>{t('noReleases')}</EmptyState>
      {:else}
        {#each releases as rel (rel.id)}
          <div class="border-b border-border/40 px-4 py-3">
            <div class="flex items-center gap-2">
              <AppIcons.rocket class="size-4 shrink-0 text-primary" />
              <span class="min-w-0 flex-1 truncate text-meta font-semibold">{rel.name || rel.tagName}</span>
              {#if rel.prerelease}<span class="shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[10px] text-warning">{t('prerelease')}</span>{/if}
              {#if rel.draft}<span class="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{t('draft')}</span>{/if}
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span class="rounded bg-muted px-1.5 py-px font-mono">{rel.tagName}</span>
              <span>{rel.author || '—'}</span>
              <span>{relTime(rel.publishedAt || rel.createdAt)}</span>
            </div>
            {#if rel.body}<div class="mt-1.5 line-clamp-4 text-micro whitespace-pre-wrap text-muted-foreground">{rel.body}</div>{/if}
            {#if rel.assets.length}
              <div class="mt-2 space-y-1 border-t border-border/40 pt-2">
                {#each rel.assets as a (a.id)}
                  <button type="button" class="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted" onclick={() => void downloadAsset(a)}>
                    <AppIcons.file_archive class="size-3.5 shrink-0 text-muted-foreground" />
                    <span class="min-w-0 flex-1 truncate font-mono text-[11px]">{a.name}</span>
                    {#if a.downloadCount}<span class="shrink-0 text-[10px] text-muted-foreground">↓{a.downloadCount}</span>{/if}
                    <span class="shrink-0 text-[10px] text-muted-foreground">{formatBytes(a.size)}</span>
                    <AppIcons.download class="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}

    {:else if tab === 'changes'}
      <div class="flex items-center gap-1 px-3 py-2">
        {#each [['open', 'mrOpen'], ['closed', 'mrClosed'], ['all', 'mrAll']] as [st, key] (st)}
          <button
            type="button"
            class={cn('rounded-full border px-3 py-1 text-micro', mrState === st ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}
            onclick={() => { mrState = st; void loadMRs() }}
          >{t(key)}</button>
        {/each}
      </div>
      {#if mrs.length === 0}
        <EmptyState>{t('noMRs')}</EmptyState>
      {:else}
        {#each mrs as m (m.index)}
          <ListRow divided align="start" onclick={() => void openMR(m)}>
            <AppIcons.merge class={cn('mt-0.5 size-4 shrink-0', m.merged ? 'text-violet-500' : m.state === 'open' ? 'text-success' : 'text-muted-foreground')} />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-meta font-medium">#{m.index} {m.title}</span>
              <span class="block truncate text-[10px] text-muted-foreground">
                {m.head} → {m.base} · {m.author || '—'} · {relTime(m.createdAt)}
                {#if m.additions || m.deletions}<span class="ml-1 font-mono text-success">+{m.additions}</span> <span class="font-mono text-destructive">-{m.deletions}</span>{/if}
              </span>
            </span>
            <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', m.merged ? 'bg-violet-500/15 text-violet-500' : m.state === 'open' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>{m.merged ? t('merged') : m.state}</span>
          </ListRow>
        {/each}
      {/if}
    {/if}
  </div>
</div>

<!-- commit detail overlay -->
{#if commitSha}
  <div class="fixed inset-0 z-[70] flex flex-col bg-card">
    <PageHeader>
      <IconButton icon={AppIcons.close} onclick={() => (commitSha = '')} />
      <AppIcons.commit class="size-4 text-muted-foreground" />
      <span class="min-w-0 flex-1 font-mono text-meta">{shortSha(commitSha)}</span>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-auto p-3">
      {#if commitLoading}
        <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
      {:else}
        <DiffView diff={commitDiff} name={shortSha(commitSha)} />
      {/if}
    </div>
  </div>
{/if}

<!-- MR detail overlay -->
{#if mrDetail}
  <div class="fixed inset-0 z-[70] flex flex-col bg-card">
    <PageHeader>
      <IconButton icon={AppIcons.close} onclick={() => (mrDetail = null)} />
      <AppIcons.merge class="size-4 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate text-base font-semibold">#{mrDetail.index} {mrDetail.title}</span>
      <span class={cn('shrink-0 rounded-full px-2 py-px text-[10px]', mrDetail.merged ? 'bg-violet-500/15 text-violet-500' : mrDetail.state === 'open' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>{mrDetail.merged ? t('merged') : mrDetail.state}</span>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="border-b border-border/50 px-4 py-3 text-micro text-muted-foreground">
        <div><span class="font-mono">{mrDetail.head}</span> → <span class="font-mono">{mrDetail.base}</span></div>
        <div class="mt-0.5">{mrDetail.author || '—'} · {relTime(mrDetail.createdAt)} · {mrDetail.changedFiles} {t('filesChanged')}</div>
        {#if mrDetail.body}<div class="mt-2 rounded-md bg-muted/40 px-3 py-2 whitespace-pre-wrap text-meta text-foreground">{mrDetail.body}</div>{/if}
      </div>
      {#if mrLoading}
        <div class="flex justify-center py-10"><span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span></div>
      {:else}
        <div class="p-3"><DiffView diff={mrDiffText} /></div>
        {#if mrComments.length}
          <div class="border-t border-border/50 px-4 py-3">
            <div class="mb-2 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('comments')} · {mrComments.length}</div>
            <div class="space-y-2">
              {#each mrComments as c (c.id)}
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
{/if}
