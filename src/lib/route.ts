// Pure URL <-> page routing. The URL is the single source of truth for the
// visible view: `encodeRoute` produces a canonical path+query for a leaf page
// and `decodeRoute` parses any path back into a leaf. The ancestor stack is
// then derived purely with `stackFor` (nav.ts) — there is NO history.state.
//
// Field placement mirrors GitHub: the resource identity is path segments
// (org/repo/kind), while values that may contain `/` or are open-ended (ref,
// path, sha, tag, base/head) go in the query string.

import type { AppPage, RepoTab, SessionOverlay, SiderTab } from './nav'

export interface Route {
  tab: SiderTab
  leaf: AppPage
}

const SEG = (s: string) => encodeURIComponent(s)

/** `?a=1&b=x` from a record, dropping empty values (stable key order). */
function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const k of Object.keys(params).sort()) {
    const v = params[k]
    if (v !== undefined && v !== '') p.set(k, v)
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Drop a value equal to the default (keeps canonical URLs clean). */
function def<T extends string>(
  v: T | undefined,
  fallback: T,
): string | undefined {
  return v === undefined || v === fallback ? undefined : v
}

/** Build the path (with query) for a leaf page. */
export function encodeRoute(leaf: AppPage): string {
  switch (leaf.kind) {
    case 'chat_list':
      return '/chat'
    case 'chat_session':
      return `/chat/${SEG(leaf.session)}`
    case 'chat_overlay':
      return `/chat/${SEG(leaf.session)}/mailbox`
    case 'code_root':
      return `/code${qs({ tab: leaf.tab, state: def(leaf.mrState, 'open') })}`
    case 'repo_detail':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/tree${qs({
        ref: leaf.ref,
        tab: def(leaf.tab, 'files'),
        state: def(leaf.mrState, 'open'),
      })}`
    case 'repo_blob':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/blob${qs({
        ref: leaf.ref,
        path: leaf.path,
        view: leaf.view,
      })}`
    case 'repo_history':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/history${qs({
        ref: leaf.ref,
        path: leaf.path,
      })}`
    case 'repo_history_diff':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/history/${SEG(leaf.sha)}${qs(
        {
          ref: leaf.ref,
          path: leaf.path,
        },
      )}`
    case 'repo_commit':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/commit/${SEG(leaf.sha)}${qs(
        {
          ref: leaf.ref,
        },
      )}`
    case 'repo_mr':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/mr/${leaf.index}${qs({ ref: leaf.ref })}`
    case 'repo_release':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/release${qs({ ref: leaf.ref, tag: leaf.tag })}`
    case 'repo_tag':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/tag${qs({ ref: leaf.ref, tab: leaf.tab })}`
    case 'repo_compare':
      return `/code/${SEG(leaf.org)}/${SEG(leaf.repo)}/compare${qs({
        ref: leaf.ref,
        base: leaf.base,
        head: leaf.head,
      })}`
    case 'service_root':
      return '/service'
    case 'sandbox_detail':
      return `/service/sandboxes/${SEG(leaf.name)}`
    case 'sandbox_job':
      return `/service/sandboxes/${SEG(leaf.name)}/jobs/${SEG(leaf.jobId)}`
    case 'service_detail':
      return `/service/services/${SEG(leaf.name)}${qs({
        logs: leaf.logs,
        prev: leaf.prev ? '1' : undefined,
      })}`
    case 'config_root':
      return '/config'
    case 'config_sub':
      return `/config/${SEG(leaf.id)}`
    case 'providers_list':
      return '/config/providers'
    case 'provider_form':
      return '/config/providers/new'
    case 'provider_models':
      return `/config/providers/${SEG(leaf.modelId ?? '')}/models`
  }
}

function isRepoView(v: string | null): v is 'code' | 'blame' {
  return v === 'code' || v === 'blame'
}
function isRepoTab(v: string | null): v is RepoTab {
  return (
    v === 'files' ||
    v === 'commits' ||
    v === 'tags' ||
    v === 'releases' ||
    v === 'changes'
  )
}

/**
 * Parse a location (pathname + search) into a Route. Returns null for an
 * unknown path so the caller can fall back to a default.
 */
export function decodeRoute(pathname: string, search = ''): Route | null {
  const q = new URLSearchParams(search)
  const segs = pathname
    .split('/')
    .filter(Boolean)
    .map(s => decodeURIComponent(s))
  const [root, ...rest] = segs
  const ref = q.get('ref') ?? ''
  const path = q.get('path') ?? ''
  const tab = isRepoTab(q.get('tab')) ? (q.get('tab') as RepoTab) : undefined
  const mrState = q.get('state') ?? undefined

  const chat = (): Route => {
    if (rest.length === 0)
      return { tab: 'chat', leaf: { kind: 'chat_list', key: 'chat_list' } }
    const session = rest[0]!
    if (rest[1] === 'mailbox')
      return {
        tab: 'chat',
        leaf: {
          kind: 'chat_overlay',
          key: 'chat_overlay',
          overlay: 'mailbox',
          session,
        },
      }
    return {
      tab: 'chat',
      leaf: { kind: 'chat_session', key: 'chat_session', session },
    }
  }

  const config = (): Route | null => {
    if (rest.length === 0)
      return {
        tab: 'config',
        leaf: { kind: 'config_root', key: 'config_root' },
      }
    if (rest[0] === 'providers') {
      if (rest.length === 1)
        return {
          tab: 'config',
          leaf: { kind: 'providers_list', key: 'providers_list' },
        }
      if (rest[1] === 'new')
        return {
          tab: 'config',
          leaf: { kind: 'provider_form', key: 'provider_form' },
        }
      if (rest[2] === 'models') {
        const id = rest[1] || null
        return {
          tab: 'config',
          leaf: {
            kind: 'provider_models',
            key: id ? `provider_model_${id}` : 'provider_model_new',
            modelId: id,
          },
        }
      }
      return null
    }
    return {
      tab: 'config',
      leaf: { kind: 'config_sub', key: `config_sub_${rest[0]}`, id: rest[0]! },
    }
  }

  const code = (): Route | null => {
    if (rest.length === 0) {
      const leaf: AppPage = { kind: 'code_root', key: 'code_root' }
      if (tab) leaf.tab = tab
      if (mrState) leaf.mrState = mrState
      return { tab: 'code', leaf }
    }
    const [org, repo, kind, ...tail] = rest
    if (!org || !repo || !kind) return null
    const at = { org, repo }
    switch (kind) {
      case 'tree': {
        const leaf: AppPage = {
          kind: 'repo_detail',
          key: `repo:${org}/${repo}@${ref || 'main'}`,
          ...at,
          ref: ref || 'main',
        }
        if (tab) leaf.tab = tab
        if (mrState) leaf.mrState = mrState
        return { tab: 'code', leaf }
      }
      case 'blob':
        if (!path) return null
        return {
          tab: 'code',
          leaf: {
            kind: 'repo_blob',
            key: `blob:${org}/${repo}@${ref || 'main'}:${path}`,
            ...at,
            ref: ref || 'main',
            path,
            view: isRepoView(q.get('view'))
              ? (q.get('view') as 'code' | 'blame')
              : undefined,
          },
        }
      case 'history': {
        if (tail.length === 0) {
          if (!path) return null
          return {
            tab: 'code',
            leaf: {
              kind: 'repo_history',
              key: `hist:${org}/${repo}@${ref || 'main'}:${path}`,
              ...at,
              ref: ref || 'main',
              path,
            },
          }
        }
        const sha = tail[0]!
        if (!path) return null
        return {
          tab: 'code',
          leaf: {
            kind: 'repo_history_diff',
            key: `histdiff:${org}/${repo}@${ref || 'main'}:${path}:${sha}`,
            ...at,
            ref: ref || 'main',
            path,
            sha,
          },
        }
      }
      case 'commit': {
        const sha = tail[0]
        if (!sha) return null
        return {
          tab: 'code',
          leaf: {
            kind: 'repo_commit',
            key: `commit:${org}/${repo}@${sha}`,
            ...at,
            ref: ref || 'main',
            sha,
          },
        }
      }
      case 'mr': {
        const index = Number(tail[0])
        if (!Number.isFinite(index) || index <= 0) return null
        return {
          tab: 'code',
          leaf: {
            kind: 'repo_mr',
            key: `mr:${org}/${repo}:${index}`,
            ...at,
            ref: ref || 'main',
            index,
          },
        }
      }
      case 'release': {
        const tag = q.get('tag') ?? ''
        if (!tag) return null
        return {
          tab: 'code',
          leaf: {
            kind: 'repo_release',
            key: `rel:${org}/${repo}:${tag}`,
            ...at,
            ref: ref || 'main',
            tag,
          },
        }
      }
      case 'tag': {
        const leaf: AppPage = {
          kind: 'repo_tag',
          key: `tag:${org}/${repo}@${ref || 'main'}`,
          ...at,
          ref: ref || 'main',
        }
        if (tab) leaf.tab = tab
        return { tab: 'code', leaf }
      }
      case 'compare': {
        const base = q.get('base') ?? ''
        const head = q.get('head') ?? ''
        if (!base || !head) return null
        return {
          tab: 'code',
          leaf: {
            kind: 'repo_compare',
            key: `cmp:${org}/${repo}:${base}...${head}`,
            ...at,
            ref: ref || 'main',
            base,
            head,
          },
        }
      }
      default:
        return null
    }
  }

  const service = (): Route | null => {
    if (rest.length === 0)
      return {
        tab: 'service',
        leaf: { kind: 'service_root', key: 'service_root' },
      }
    if (rest[0] === 'sandboxes' && rest[1]) {
      const name = rest[1]
      if (rest[2] === 'jobs' && rest[3]) {
        const jobId = rest[3]
        return {
          tab: 'service',
          leaf: {
            kind: 'sandbox_job',
            key: `job:${name}:${jobId}`,
            name,
            jobId,
          },
        }
      }
      return {
        tab: 'service',
        leaf: { kind: 'sandbox_detail', key: `sbx:${name}`, name },
      }
    }
    if (rest[0] === 'services' && rest[1]) {
      const name = rest[1]
      const logs = q.get('logs')
      const leaf: AppPage = { kind: 'service_detail', key: `svc:${name}`, name }
      if (logs === 'follow' || logs === 'tail') leaf.logs = logs
      if (q.get('prev') === '1') leaf.prev = true
      return { tab: 'service', leaf }
    }
    return null
  }

  switch (root) {
    case 'chat':
      return chat()
    case 'code':
      return code()
    case 'service':
      return service()
    case 'config':
      return config()
    case undefined:
      return { tab: 'chat', leaf: { kind: 'chat_list', key: 'chat_list' } }
    default:
      return null
  }
}

/** The overlay type helper (kept explicit for callers). */
export type { SessionOverlay }
