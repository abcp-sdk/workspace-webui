// Per-tab navigation stacks — pure array operations behind AppStore's
// pushPage/pushSibling/popPage. Kept separate (and tested) so the reset/pop
// rules are explicit: same-key pages replace at their depth, a sibling drill-in
// keeps the stack at [root, current], and popping never goes below the root.
export type SiderTab = 'chat' | 'code' | 'service' | 'config'
export type SessionOverlay = 'mailbox'

export type AppPage =
  | { kind: 'chat_list'; key: 'chat_list' }
  | { kind: 'chat_session'; key: 'chat_session' }
  | { kind: 'chat_overlay'; key: 'chat_overlay'; overlay: SessionOverlay }
  | { kind: 'config_root'; key: 'config_root' }
  | { kind: 'config_sub'; key: string; id: string }
  | { kind: 'providers_list'; key: 'providers_list' }
  | { kind: 'provider_form'; key: 'provider_form' }
  | { kind: 'provider_models'; key: string; modelId: string | null }
  // code tab (read-only git browse; stack: tree -> repo detail -> blob -> ...)
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
  | { kind: 'repo_commit'; key: string; org: string; repo: string; ref: string; sha: string }
  // One change request: meta + diff + comments.
  | { kind: 'repo_mr'; key: string; org: string; repo: string; index: number }
  // One release: meta + assets.
  | { kind: 'repo_release'; key: string; org: string; repo: string; tag: string }
  // Browse a repository at a tag (opened from the Tags sub-tab).
  | { kind: 'repo_tag'; key: string; org: string; repo: string; ref: string }
  // Diff between two refs (multi-file), opened from the `repo-diff` tool card.
  | { kind: 'repo_compare'; key: string; org: string; repo: string; base: string; head: string }
  // service tab (read-only sandboxes + services)
  | { kind: 'service_root'; key: 'service_root' }
  | { kind: 'sandbox_detail'; key: string; name: string }
  | { kind: 'sandbox_job'; key: string; name: string; jobId: string }
  | { kind: 'service_detail'; key: string; name: string }

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
