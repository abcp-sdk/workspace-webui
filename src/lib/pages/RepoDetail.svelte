<script lang="ts">
  // RepoDetail — read-only browser for one repository (the right pane of the
  // Code tab). The parent CodeTab owns the left tree (org > repo > branch) and
  // passes the active `ref`; sub-tabs here are Files / Commits / Tags /
  // Releases / Changes (MRs). Everything is GET-only.
  import type { BranchInfo, CommitInfo, MRInfo, ReleaseInfo, TagInfo, TreeEntry } from '$lib/api'
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { formatBytes } from '$lib/media'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import RepoAvatar from '$lib/components/RepoAvatar.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import TabBar from '$lib/components/layout/TabBar.svelte'
  import TabItem from '$lib/components/layout/TabItem.svelte'
  import ListRow from '$lib/components/layout/ListRow.svelte'
  import SectionLabel from '$lib/components/layout/SectionLabel.svelte'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let {
    store,
    org,
    repo,
    ref,
    showBack = false,
  }: PageProps & { org: string; repo: string; ref: string } = $props()

  const api = $derived(store.api)
  type Tab = 'files' | 'commits' | 'tags' | 'releases' | 'changes'

  // The sub-tab and MR filter are component-local view state (not part of the
  // page identity): switching either must not push a new stack page.
  let tab = $state<Tab>('files')
  let mrState = $state('open')

  /** Switch the active ref (branch) — replaces the detail page in place. */
  function onPickRef(r: string) {
    store.open({ kind: 'repo_detail', key: `repo:${org}/${repo}@${r}`, org, repo, ref: r })
  }
  /** Open a tag as its own browse page (tree at that tag). */
  function onPickTag(t: string) {
    store.open({ kind: 'repo_tag', key: `tag:${org}/${repo}@${t}`, org, repo, ref: t })
  }
  function pickTab(t: Tab) {
    tab = t
  }
  function pickMrState(s: string) {
    mrState = s
  }

  let branches = $state<BranchInfo[]>([])
  let tags = $state<TagInfo[]>([])
  let releases = $state<ReleaseInfo[]>([])
  let tree = $state<TreeEntry[]>([])
  let expanded = $state<Set<string>>(new Set()) // expanded dir paths (Files tree)
  let commits = $state<CommitInfo[]>([])
  let mrs = $state<MRInfo[]>([])
  let loading = $state(true)

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
    expanded = new Set()
    void Promise.all([loadTree(), loadCommits()])
  })
  // Reload the MR list when its filter (URL-backed) changes.
  $effect(() => {
    void mrState
    void loadMRs()
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
  }

  async function loadTree() {
    try {
      // One recursive fetch for the whole ref; the tree below is derived.
      tree = await api.tree(org, repo, ref, '')
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

  interface TreeNode {
    name: string
    path: string
    type: string
    size: number
    children: TreeNode[]
  }

  // Build a nested tree from the gateway's FLAT recursive listing. Directories
  // appear both as their own entry and as a prefix of children, so we insert by
  // path (idempotent) rather than trusting entry order.
  const rootNodes = $derived.by(() => {
    const root: TreeNode = { name: '', path: '', type: 'dir', size: 0, children: [] }
    const byPath = new Map<string, TreeNode>([['', root]])
    const ensureDir = (p: string): TreeNode => {
      const hit = byPath.get(p)
      if (hit) return hit
      const slash = p.lastIndexOf('/')
      const parent = ensureDir(slash === -1 ? '' : p.slice(0, slash))
      const node: TreeNode = { name: p.slice(slash + 1), path: p, type: 'dir', size: 0, children: [] }
      byPath.set(p, node)
      parent.children.push(node)
      return node
    }
    for (const e of tree) {
      const slash = e.path.lastIndexOf('/')
      const parent = ensureDir(slash === -1 ? '' : e.path.slice(0, slash))
      if (e.type === 'dir') {
        ensureDir(e.path)
      } else {
        const node: TreeNode = { name: e.path.slice(slash + 1), path: e.path, type: 'file', size: e.size, children: [] }
        byPath.set(e.path, node)
        parent.children.push(node)
      }
    }
    const sortRec = (n: TreeNode) => {
      n.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      for (const c of n.children) sortRec(c)
    }
    sortRec(root)
    return root.children
  })

  // Flatten to visible rows: a directory's children show only when expanded.
  const visibleRows = $derived.by(() => {
    const out: { node: TreeNode; depth: number }[] = []
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        out.push({ node: n, depth })
        if (n.type === 'dir' && expanded.has(n.path)) walk(n.children, depth + 1)
      }
    }
    walk(rootNodes, 0)
    return out
  })

  function toggleDir(p: string) {
    const next = new Set(expanded)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    expanded = next
  }

  // The active file is the sibling `repo_blob` page (if the stack is on one),
  // so the tree can highlight it without owning the selection itself.
  const activePath = $derived.by(() => {
    const top = store.focusedPage
    if (top.kind === 'repo_blob' && top.org === org && top.repo === repo && top.ref === ref) {
      return top.path
    }
    return ''
  })

  function openEntry(e: TreeNode) {
    if (e.type === 'dir') {
      toggleDir(e.path)
    } else {
      store.pushChild({ kind: 'repo_blob', key: `blob:${org}/${repo}@${ref}:${e.path}`, org, repo, ref, path: e.path })
    }
  }

  /** Open a commit as its own page (meta + files + diff). */
  function openCommit(c: CommitInfo) {
    store.pushChild({ kind: 'repo_commit', key: `commit:${org}/${repo}@${c.sha}`, org, repo, ref, sha: c.sha })
  }

  /** Open a change request as its own page (meta + diff + comments). */
  function openMR(m: MRInfo) {
    store.pushChild({ kind: 'repo_mr', key: `mr:${org}/${repo}:${m.index}`, org, repo, index: m.index })
  }

  /** Open a release as its own page (meta + assets). */
  function openRelease(rel: ReleaseInfo) {
    store.pushChild({ kind: 'repo_release', key: `rel:${org}/${repo}:${rel.tagName}`, org, repo, tag: rel.tagName })
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

<div class="relative flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <RepoAvatar {org} {repo} branch={ref} level="repo" size={28} />
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{org}/{repo}</span>
    <span class="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] leading-4 text-muted-foreground">{ref}</span>
  </PageHeader>

  <!-- sub-tabs -->
  <TabBar>
    {#each tabs as tb (tb.id)}
      <TabItem active={tab === tb.id} onclick={() => pickTab(tb.id)}>
        <tb.icon class="size-3.5" />{t(tb.label)}
      </TabItem>
    {/each}
  </TabBar>

  <div class={cn('min-h-0 flex-1', tab === 'files' ? 'overflow-hidden' : 'overflow-y-auto')}>
    {#if loading && tab !== 'files' && tab !== 'commits'}
      <div class="flex justify-center py-10">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else if tab === 'files'}
      <!-- Files: a full-pane VSCode-style tree (folders expand inline). The
           file CONTENT is a sibling `repo_blob` page, so the Shell split shows
           the tree | the content as two equal panes. -->
      <div class="min-h-0 h-full overflow-y-auto">
        {#if visibleRows.length === 0}
          <EmptyState>{t('emptyRepo')}</EmptyState>
        {:else}
          {#each visibleRows as row (row.node.path)}
            {@const e = row.node}
            <button
              type="button"
              class={cn('flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-muted', activePath === e.path && 'bg-primary/10')}
              style="padding-left: {0.5 + row.depth * 0.75}rem"
              onclick={() => openEntry(e)}
            >
              {#if e.type === 'dir'}
                {#if expanded.has(e.path)}<AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />{:else}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
                <AppIcons.folder class="size-4 shrink-0 text-primary" />
              {:else}
                <span class="size-3.5 shrink-0"></span>
                <AppIcons.file class="size-4 shrink-0 text-muted-foreground" />
              {/if}
              <span class="min-w-0 flex-1 truncate text-meta">{e.name}</span>
              {#if e.type === 'file'}<span class="shrink-0 text-[10px] text-muted-foreground">{formatBytes(e.size)}</span>{/if}
            </button>
          {/each}
        {/if}
      </div>

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
          <ListRow active={tg.name === ref} onclick={() => onPickTag(tg.name)}>
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
          <ListRow divided align="start" onclick={() => openRelease(rel)}>
            <AppIcons.rocket class="mt-0.5 size-4 shrink-0 text-primary" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-meta font-semibold">{rel.name || rel.tagName}</span>
              <span class="block truncate text-[10px] text-muted-foreground">
                <span class="rounded bg-muted px-1.5 py-px font-mono">{rel.tagName}</span>
                · {rel.author || '—'} · {relTime(rel.publishedAt || rel.createdAt)}
              </span>
            </span>
            {#if rel.prerelease}<span class="shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[10px] text-warning">{t('prerelease')}</span>{/if}
            {#if rel.draft}<span class="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{t('draft')}</span>{/if}
          </ListRow>
        {/each}
      {/if}

    {:else if tab === 'changes'}
      <div class="flex items-center gap-1 px-3 py-2">
        {#each [['open', 'mrOpen'], ['closed', 'mrClosed'], ['all', 'mrAll']] as [st, key] (st)}
          <button
            type="button"
            class={cn('rounded-full border px-3 py-1 text-micro', mrState === st ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}
            onclick={() => pickMrState(st)}
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

