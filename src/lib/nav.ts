// Navigation model — a FOREST.
//
// Every page declares exactly ONE parent (`parentOf`). A visible stack is
// therefore always a root→leaf PATH through that forest, never an ad-hoc
// accumulation: the stack for a page is `ancestry(page)`, a pure function.
//
// The invariant that makes the UI sane: a path contains AT MOST ONE page of
// each `kind`. Two sessions (chatA / chatB) are siblings in the forest, so a
// single path can never contain both. `pushPath` enforces this: opening a page
// whose kind is already in the stack TRUNCATES to that depth and replaces
// (left-column click = replace the right pane); a genuinely deeper kind APPENDS
// (right-column click = the right pane becomes the left, a new right pane
// appears). Cross-lane references (a chat tool-card link to a blob) do NOT
// touch the main path at all — the store opens them in a separate DRAWER whose
// own stack obeys the same rule.
export type SiderTab = 'chat' | 'code' | 'service' | 'config'
export type SessionOverlay = 'mailbox'

/** Sub-tabs of the repo browser (component-local state, not in the stack). */
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
  // code lane (read-only git browse)
  | { kind: 'code_root'; key: 'code_root' }
  | { kind: 'repo_detail'; key: string; org: string; repo: string; ref: string }
  | {
      kind: 'repo_blob'
      key: string
      org: string
      repo: string
      ref: string
      path: string
    }
  // A file's commit history (one row per commit touching the path).
  | {
      kind: 'repo_history'
      key: string
      org: string
      repo: string
      ref: string
      path: string
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
  | { kind: 'repo_tag'; key: string; org: string; repo: string; ref: string }
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
  // service lane (sandboxes + services)
  | { kind: 'service_root'; key: 'service_root' }
  | { kind: 'sandbox_detail'; key: string; name: string }
  | { kind: 'sandbox_job'; key: string; name: string; jobId: string }
  // Read-only file browser over the sandbox filesystem. `path` may be a
  // directory (browse it) or a file (open it directly); '' = workspace root.
  | { kind: 'sandbox_files'; key: string; name: string; path: string }
  | { kind: 'service_detail'; key: string; name: string }

export function rootPageFor(lane: SiderTab): AppPage {
  switch (lane) {
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

/** The lane (tab) a page lives in. */
export function laneOf(page: AppPage): SiderTab {
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
    case 'sandbox_files':
    case 'service_detail':
      return 'service'
  }
}

/** Back-compat alias for {@link laneOf}. */
export const tabForPage = laneOf

function refOf(page: AppPage): string {
  return 'ref' in page && page.ref ? page.ref : 'main'
}

function repoDetail(org: string, repo: string, ref: string): AppPage {
  return {
    kind: 'repo_detail',
    key: `repo:${org}/${repo}@${ref}`,
    org,
    repo,
    ref,
  }
}
function repoBlob(
  org: string,
  repo: string,
  ref: string,
  path: string,
): AppPage {
  return {
    kind: 'repo_blob',
    key: `blob:${org}/${repo}@${ref}:${path}`,
    org,
    repo,
    ref,
    path,
  }
}
function repoHistory(
  org: string,
  repo: string,
  ref: string,
  path: string,
): AppPage {
  return {
    kind: 'repo_history',
    key: `hist:${org}/${repo}@${ref}:${path}`,
    org,
    repo,
    ref,
    path,
  }
}

/**
 * The unique parent of a page, or null for a lane root. This is the SINGLE
 * source of the page hierarchy — `ancestry` walks it, so a page can never
 * appear with an inconsistent set of ancestors.
 */
export function parentOf(page: AppPage): AppPage | null {
  switch (page.kind) {
    case 'chat_list':
    case 'code_root':
    case 'service_root':
    case 'config_root':
      return null
    case 'chat_session':
      return { kind: 'chat_list', key: 'chat_list' }
    case 'chat_overlay':
      return {
        kind: 'chat_session',
        key: 'chat_session',
        session: page.session,
      }
    case 'config_sub':
    case 'providers_list':
      return { kind: 'config_root', key: 'config_root' }
    case 'provider_form':
      return { kind: 'providers_list', key: 'providers_list' }
    case 'provider_models':
      return { kind: 'provider_form', key: 'provider_form' }
    case 'repo_detail':
      return { kind: 'code_root', key: 'code_root' }
    case 'repo_tag':
    case 'repo_blob':
    case 'repo_commit':
    case 'repo_mr':
    case 'repo_release':
    case 'repo_compare':
      return repoDetail(page.org, page.repo, refOf(page))
    case 'repo_history':
      return repoBlob(page.org, page.repo, page.ref, page.path)
    case 'repo_history_diff':
      return repoHistory(page.org, page.repo, page.ref, page.path)
    case 'sandbox_detail':
    case 'service_detail':
      return { kind: 'service_root', key: 'service_root' }
    case 'sandbox_job':
    case 'sandbox_files':
      return {
        kind: 'sandbox_detail',
        key: `sbx:${page.name}`,
        name: page.name,
      }
  }
}

/** The root→leaf path for a page (always non-empty). */
export function ancestry(page: AppPage): AppPage[] {
  const path: AppPage[] = []
  let cur: AppPage | null = page
  while (cur) {
    path.unshift(cur)
    cur = parentOf(cur)
  }
  return path
}

/** Back-compat alias for {@link ancestry}. */
export const stackFor = ancestry

/**
 * Push a page onto a path, enforcing the one-kind-per-path invariant:
 * - the page's kind is already present → truncate to that depth and replace
 *   (this is a left-column "sibling" navigation);
 * - otherwise → append (a right-column "drill one level deeper").
 */
export function pushPath(stack: AppPage[], page: AppPage): AppPage[] {
  const idx = stack.findIndex(p => p.kind === page.kind)
  if (idx !== -1) return [...stack.slice(0, idx), page]
  return [...stack, page]
}

/** Pop the top page; never pops below the root. */
export function popPage(stack: AppPage[]): AppPage[] {
  return stack.length > 1 ? stack.slice(0, -1) : [...stack]
}
