// Tool → Code/Service page links.
//
// A tool card becomes interactive once its arguments have fully streamed: a
// `repo-read` links to the file's content, a `repo-write`/`repo-edit` to the
// commit's diff, a `repo-diff` to a compare page, and so on. This module is the
// pure mapping (tool name + resolved data → page), so the view layer only
// renders. Every workspace tool now emits its resolved `org`/`repo`/`ref` in
// `data`, so a card never has to re-parse the session name.
import type { AppPage } from './nav'

/** One clickable link shown on a tool card. */
export interface ToolLink {
  /** Human label (e.g. `org/repo @ ref : path`). */
  label: string
  /** AppIcons key. */
  icon: string
  /** The page to open (always a Code- or Service-tab stack page). */
  page: AppPage
}

type Data = Record<string, unknown>

function str(d: Data, k: string): string {
  const v = d[k]
  return typeof v === 'string' ? v : ''
}
function num(d: Data, k: string): number {
  const v = d[k]
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v) || 0
  return 0
}

/** Read a coordinate, preferring `data` then `input`. */
function coord(data: Data, input: Data, key: string): string {
  return str(data, key) || str(input, key)
}

function repoRef(data: Data, input: Data): { org: string; repo: string; ref: string } {
  return {
    org: coord(data, input, 'org'),
    repo: coord(data, input, 'repo'),
    ref: coord(data, input, 'ref') || coord(data, input, 'branch'),
  }
}

const short = (s: string) => (s.length > 8 ? s.slice(0, 8) : s)

/** A repository page at a ref (tree + sub-tabs). */
function detail(org: string, repo: string, ref: string): AppPage {
  return { kind: 'repo_detail', key: `repo:${org}/${repo}@${ref}`, org, repo, ref }
}
function blob(org: string, repo: string, ref: string, path: string): AppPage {
  return { kind: 'repo_blob', key: `blob:${org}/${repo}@${ref}:${path}`, org, repo, ref, path }
}
function history(org: string, repo: string, ref: string, path: string): AppPage {
  return { kind: 'repo_history', key: `hist:${org}/${repo}@${ref}:${path}`, org, repo, ref, path }
}
function commit(org: string, repo: string, ref: string, sha: string): AppPage {
  return { kind: 'repo_commit', key: `commit:${org}/${repo}@${sha}`, org, repo, ref, sha }
}
function compare(org: string, repo: string, base: string, head: string): AppPage {
  return { kind: 'repo_compare', key: `cmp:${org}/${repo}:${base}...${head}`, org, repo, base, head }
}
function mr(org: string, repo: string, index: number): AppPage {
  return { kind: 'repo_mr', key: `mr:${org}/${repo}:${index}`, org, repo, index }
}
function tag(org: string, repo: string, ref: string): AppPage {
  return { kind: 'repo_tag', key: `tag:${org}/${repo}@${ref}`, org, repo, ref }
}
function sandbox(name: string): AppPage {
  return { kind: 'sandbox_detail', key: `sbx:${name}`, name }
}
function service(name: string): AppPage {
  return { kind: 'service_detail', key: `svc:${name}`, name }
}

/**
 * The links a tool card exposes, or [] for a tool with no navigable target.
 * Gated on the caller having a COMPLETE input (the card only renders once its
 * arguments have fully streamed).
 */
export function toolLinks(tool: string, data: Data, input: Data): ToolLink[] {
  const { org, repo, ref } = repoRef(data, input)
  const path = coord(data, input, 'path')
  const sha = coord(data, input, 'sha') || coord(data, input, 'commit')
  const index = num(data, 'index') || num(input, 'index')
  const at = org && repo ? `${org}/${repo}${ref ? ` @ ${ref}` : ''}` : ''

  switch (tool) {
    // ---- repo reads ----
    case 'repo-read': {
      if (!org || !repo || !path) return []
      // NOTE: repo-read's `sha` is the BLOB sha, not a commit — never link it to
      // a commit page.
      return [{ label: `${at} : ${path}`, icon: 'file_code', page: blob(org, repo, ref, path) }]
    }
    case 'repo-list': {
      if (!org || !repo) return []
      return [{ label: at || `${org}/${repo}`, icon: 'folder', page: detail(org, repo, ref) }]
    }
    case 'repo-log': {
      if (!org || !repo) return []
      // A path-scoped log is a file's history; otherwise the repo's commits.
      if (path) return [{ label: `${at} : ${path}`, icon: 'history', page: history(org, repo, ref, path) }]
      return [{ label: at, icon: 'history', page: detail(org, repo, ref) }]
    }
    case 'repo-show': {
      if (!org || !repo || !sha) return []
      return [{ label: `${short(sha)} ${at}`, icon: 'commit', page: commit(org, repo, ref, sha) }]
    }
    case 'repo-diff': {
      const base = coord(data, input, 'base')
      const head = coord(data, input, 'head')
      if (!org || !repo || !base || !head) return []
      return [{ label: `${base}…${head}`, icon: 'diff', page: compare(org, repo, base, head) }]
    }
    case 'repo-branches': {
      if (!org || !repo) return []
      return [{ label: at, icon: 'folder', page: detail(org, repo, ref) }]
    }
    case 'repo-tags': {
      if (!org || !repo) return []
      return [{ label: at, icon: 'tag', page: detail(org, repo, ref) }]
    }

    // ---- repo writes: link to the resulting commit's diff ----
    case 'repo-write':
    case 'repo-edit':
    case 'repo-delete':
    case 'repo-commit':
    case 'repo-restore':
    case 'sandbox-port': {
      if (!org || !repo) return []
      const links: ToolLink[] = []
      if (sha) links.push({ label: `${short(sha)} ${at}`, icon: 'commit', page: commit(org, repo, ref, sha) })
      if (path) links.push({ label: path, icon: 'file_code', page: blob(org, repo, ref, path) })
      return links
    }

    // ---- branches / tags / MRs ----
    case 'repo-branch-create': {
      const name = coord(data, input, 'name')
      if (!org || !repo || !name) return []
      return [{ label: `${org}/${repo} @ ${name}`, icon: 'folder', page: detail(org, repo, name) }]
    }
    case 'repo-tag-create': {
      const name = coord(data, input, 'name')
      if (!org || !repo || !name) return []
      return [{ label: `${org}/${repo} @ ${name}`, icon: 'tag', page: tag(org, repo, name) }]
    }
    case 'repo-mr-create':
    case 'repo-mr-comment':
    case 'repo-mr-merge': {
      if (!org || !repo || index <= 0) return []
      return [{ label: `#${index} ${org}/${repo}`, icon: 'merge', page: mr(org, repo, index) }]
    }
    case 'repo-mr-list': {
      const pulls = data['pulls']
      if (!org || !repo || !Array.isArray(pulls) || pulls.length === 0) return []
      const first = pulls[0] as Data
      const i = num(first, 'index')
      return i > 0 ? [{ label: `#${i} ${org}/${repo}`, icon: 'merge', page: mr(org, repo, i) }] : []
    }

    // ---- sandbox / service (Service tab) ----
    case 'sandbox-create':
    case 'sandbox-status': {
      const name = coord(data, input, 'name') || coord(data, input, 'worker-name')
      return name ? [{ label: name, icon: 'box', page: sandbox(name) }] : []
    }
    case 'service-deploy':
    case 'service-preview':
    case 'service-logs': {
      const name = coord(data, input, 'name')
      return name ? [{ label: name, icon: 'server', page: service(name) }] : []
    }
    default:
      return []
  }
}
