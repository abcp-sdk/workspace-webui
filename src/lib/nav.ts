// Navigation model — the URL is the SOURCE OF TRUTH. Every visible page has a
// canonical ancestry that is a pure function of the leaf page (`stackFor`), so
// there is no in-memory per-tab stack to keep in sync and no history.state
// snapshot: a deep link or a refresh reconstructs the exact same stack.
//
// The push helpers below remain for the few places that build a stack ad hoc
// (tests, legacy call sites); the router uses `stackFor`.
export type SiderTab = 'chat' | 'code' | 'service' | 'config'
export type SessionOverlay = 'mailbox'

/** Sub-tabs of the repo browser (mirrored in the URL `?tab=`). */
export type RepoTab = 'files' | 'commits' | 'tags' | 'releases' | 'changes'

export type AppPage =
  | { kind: 'chat_list'; key: 'chat_list' }
  | { kind: 'chat_session'; key: 'chat_session'; session: string }
  | {
      kind: 'chat_overlay'
      key: 'chat_overlay'
      overlay: SessionOverlay
      session: string
    }
  | { kind: 'config_root'; key: 'config_root' }
  | { kind: 'config_sub'; key: string; id: string }
  | { kind: 'providers_list'; key: 'providers_list' }
  | { kind: 'provider_form'; key: 'provider_form' }
  | { kind: 'provider_models'; key: string; modelId: string | null }
  // code tab (read-only git browse; stack: tree -> repo detail -> blob -> ...)
  | {
      kind: 'code_root'
      key: 'code_root'
      tab?: RepoTab
      mrState?: string
    }
  | {
      kind: 'repo_detail'
      key: string
      org: string
      repo: string
      ref: string
      tab?: RepoTab
      mrState?: string
    }
  | {
      kind: 'repo_blob'
      key: string
      org: string
      repo: string
      ref: string
      path: string
      view?: 'code' | 'blame'
    }
  // A file's commit history (one row per commit touching the path).
  | {
      kind: 'repo_history'
      key: string
      org: string
      repo: string
      ref: string
      path: string
      tab?: RepoTab
    }
  // Diff of one historical version of a file vs the current ref version.
  | {
      kind: 'repo_history_diff'
      key: string
      org: string
      repo: string
      ref: string
      path: string
      sha: string
    }
  // One commit: meta + changed files + diff.
  | {
      kind: 'repo_commit'
      key: string
      org: string
      repo: string
      ref: string
      sha: string
    }
  // One change request: meta + diff + comments.
  | {
      kind: 'repo_mr'
      key: string
      org: string
      repo: string
      ref?: string
      index: number
    }
  // One release: meta + assets.
  | {
      kind: 'repo_release'
      key: string
      org: string
      repo: string
      ref?: string
      tag: string
    }
  // Browse a repository at a tag (opened from the Tags sub-tab).
  | {
      kind: 'repo_tag'
      key: string
      org: string
      repo: string
      ref: string
      tab?: RepoTab
    }
  // Diff between two refs (multi-file), opened from the `repo-diff` tool card.
  | {
      kind: 'repo_compare'
      key: string
      org: string
      repo: string
      ref?: string
      base: string
      head: string
    }
  // service tab (read-only sandboxes + services)
  | { kind: 'service_root'; key: 'service_root' }
  | { kind: 'sandbox_detail'; key: string; name: string }
  | { kind: 'sandbox_job'; key: string; name: string; jobId: string }
  | {
      kind: 'service_detail'
      key: string
      name: string
      logs?: 'follow' | 'tail'
      prev?: boolean
    }

export function rootPageFor(tab: SiderTab): AppPage {
  switch (tab) {
    case 'chat':
      return { kind: 'chat_list', key: 'chat_list' }
    case 'code':
      return { kind: 'code_root', key: 'code_root' }
    case 'service':
      return { kind: 'service_root', key: 'service_root' }
    case 'config':
      return { kind: 'config_root', key: 'config_root' }
  }
}

/** The tab a page lives in (drives the Shell's tab selection + URL prefix). */
export function tabForPage(page: AppPage): SiderTab {
  switch (page.kind) {
    case 'chat_list':
    case 'chat_session':
    case 'chat_overlay':
      return 'chat'
    case 'config_root':
    case 'config_sub':
    case 'providers_list':
    case 'provider_form':
    case 'provider_models':
      return 'config'
    case 'code_root':
    case 'repo_detail':
    case 'repo_blob':
    case 'repo_history':
    case 'repo_history_diff':
    case 'repo_commit':
    case 'repo_mr':
    case 'repo_release':
    case 'repo_tag':
    case 'repo_compare':
      return 'code'
    case 'service_root':
    case 'sandbox_detail':
    case 'sandbox_job':
    case 'service_detail':
      return 'service'
  }
}

/** The ref an ancestor `repo_detail` should carry (leaf ref, else main). */
function refOf(page: AppPage): string {
  return 'ref' in page && page.ref ? page.ref : 'main'
}

function detailFor(org: string, repo: string, ref: string): AppPage {
  return {
    kind: 'repo_detail',
    key: `repo:${org}/${repo}@${ref}`,
    org,
    repo,
    ref,
  }
}

/**
 * The canonical ancestor stack for a leaf page. Pure: the same leaf always
 * yields the same stack, so the URL alone can restore the view.
 */
export function stackFor(leaf: AppPage): AppPage[] {
  switch (leaf.kind) {
    case 'chat_list':
    case 'code_root':
    case 'service_root':
    case 'config_root':
      return [leaf]
    case 'chat_session':
      return [{ kind: 'chat_list', key: 'chat_list' }, leaf]
    case 'chat_overlay':
      return [
        { kind: 'chat_list', key: 'chat_list' },
        { kind: 'chat_session', key: 'chat_session', session: leaf.session },
        leaf,
      ]
    case 'config_sub':
    case 'providers_list':
      return [{ kind: 'config_root', key: 'config_root' }, leaf]
    case 'provider_form':
      return [
        { kind: 'config_root', key: 'config_root' },
        { kind: 'providers_list', key: 'providers_list' },
        leaf,
      ]
    case 'provider_models':
      return [
        { kind: 'config_root', key: 'config_root' },
        { kind: 'providers_list', key: 'providers_list' },
        { kind: 'provider_form', key: 'provider_form' },
        leaf,
      ]
    case 'repo_detail':
      return [{ kind: 'code_root', key: 'code_root' }, leaf]
    case 'repo_tag':
      return [
        { kind: 'code_root', key: 'code_root' },
        detailFor(leaf.org, leaf.repo, leaf.ref),
        leaf,
      ]
    case 'repo_blob':
      return [
        { kind: 'code_root', key: 'code_root' },
        detailFor(leaf.org, leaf.repo, leaf.ref),
        leaf,
      ]
    case 'repo_history':
      return [
        { kind: 'code_root', key: 'code_root' },
        detailFor(leaf.org, leaf.repo, leaf.ref),
        {
          kind: 'repo_blob',
          key: `blob:${leaf.org}/${leaf.repo}@${leaf.ref}:${leaf.path}`,
          org: leaf.org,
          repo: leaf.repo,
          ref: leaf.ref,
          path: leaf.path,
        },
        leaf,
      ]
    case 'repo_history_diff':
      return [
        { kind: 'code_root', key: 'code_root' },
        detailFor(leaf.org, leaf.repo, leaf.ref),
        {
          kind: 'repo_blob',
          key: `blob:${leaf.org}/${leaf.repo}@${leaf.ref}:${leaf.path}`,
          org: leaf.org,
          repo: leaf.repo,
          ref: leaf.ref,
          path: leaf.path,
        },
        {
          kind: 'repo_history',
          key: `hist:${leaf.org}/${leaf.repo}@${leaf.ref}:${leaf.path}`,
          org: leaf.org,
          repo: leaf.repo,
          ref: leaf.ref,
          path: leaf.path,
        },
        leaf,
      ]
    case 'repo_commit':
    case 'repo_mr':
    case 'repo_release':
    case 'repo_compare':
      return [
        { kind: 'code_root', key: 'code_root' },
        detailFor(leaf.org, leaf.repo, refOf(leaf)),
        leaf,
      ]
    case 'sandbox_detail':
      return [{ kind: 'service_root', key: 'service_root' }, leaf]
    case 'sandbox_job':
      return [
        { kind: 'service_root', key: 'service_root' },
        { kind: 'sandbox_detail', key: `sbx:${leaf.name}`, name: leaf.name },
        leaf,
      ]
    case 'service_detail':
      return [{ kind: 'service_root', key: 'service_root' }, leaf]
  }
}

/** Push a page; a same-key page replaces at (and truncates from) its depth. */
export function pushPage(stack: AppPage[], page: AppPage): AppPage[] {
  const list = [...stack]
  const idx = list.findIndex(p => p.key === page.key)
  if (idx !== -1) list.splice(idx, list.length - idx)
  list.push(page)
  return list
}

/** Push a SIBLING drill-in: replaces the current drill-in, keeping the stack
 *  at [root, current] so the tablet split never shows two parallels. */
export function pushSibling(stack: AppPage[], page: AppPage): AppPage[] {
  const list = stack.length > 1 ? stack.slice(0, 1) : [...stack]
  return pushPage(list, page)
}

/**
 * Push a CHILD drill-in (the leaf of a split). Appends when the current top is
 * a different page kind, otherwise REPLACES the top so repeatedly opening a
 * file/job does not grow the stack without bound. Keeps the stack at
 * [root, parent, child] so the tablet split shows the parent list | the leaf.
 */
export function pushChild(stack: AppPage[], page: AppPage): AppPage[] {
  const top = stack[stack.length - 1]
  if (top !== undefined && top.kind === page.kind) {
    return [...stack.slice(0, -1), page]
  }
  return [...stack, page]
}

/** Pop the top page; never pops below the root. */
export function popPage(stack: AppPage[]): AppPage[] {
  return stack.length > 1 ? stack.slice(0, -1) : [...stack]
}
