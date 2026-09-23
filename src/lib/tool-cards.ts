// Tool-card registry — per-tool "pretty" rendering of a tool call's resolved
// arguments/result. Once a call's arguments have fully streamed, a tool with a
// registered card renders a structured view (fields + an optional body) instead
// of raw JSON; a toggle switches back to the raw JSON. Cards may carry links
// (an AppPage) that jump into the Code / Service tabs.
//
// This module is PURE (no Svelte): `ToolPartView` renders the returned spec, so
// the mapping is unit-testable. Tools without a spec fall back to the raw JSON
// + output sections.
import type { AppPage } from './nav'
import * as P from './tool-pages'

/** One labelled parameter row on a card. */
export interface CardField {
  /** AppIcons key. */
  icon: string
  /** Row label (already localized by the caller? no — keys are literal). */
  label: string
  /** Display value. */
  value: string
  /** Render the value in a monospace face. */
  mono?: boolean
  /** Optional navigation target (the whole row becomes a button). */
  link?: AppPage
  /** Semantic tone (e.g. additions green / deletions red). */
  tone?: 'default' | 'success' | 'destructive' | 'muted'
}

/** A list body rendered under the fields. */
export type CardBody =
  | { kind: 'diff'; diff: string }
  | { kind: 'commits'; commits: Array<{ sha: string; message: string; author: string; date: string }>; org: string; repo: string; ref: string }
  | { kind: 'entries'; entries: Array<{ path: string; type: string; size: number }> }
  | { kind: 'files'; files: Array<{ path: string; status: string; additions: number; deletions: number }>; org: string; repo: string; ref: string }
  | { kind: 'paths'; paths: string[] }
  | { kind: 'branches'; branches: Array<{ name: string; sha: string }>; org: string; repo: string }
  | { kind: 'tags'; tags: Array<{ name: string; sha: string }>; org: string; repo: string }
  | { kind: 'pulls'; pulls: Array<{ index: number; title: string; head: string; base: string; state: string; merged?: boolean }>; org: string; repo: string }
  | { kind: 'conflicts'; conflicts: string[] }
  | { kind: 'ports'; ports: Array<{ name: string; preset: string; port: number; protocol: string; targetPort: number; publicUrl?: string }> }
  | { kind: 'images'; images: Array<{ owner: string; name: string; tag: string; ref?: string }> }
  | { kind: 'text'; text: string; tone?: 'default' | 'destructive' }

export interface CardSpec {
  /** Header subtitle (replaces the redundant italic title). */
  subtitle: string
  fields: CardField[]
  body?: CardBody
  /** Primary action buttons (open the file / commit / MR / service / …). */
  actions?: Array<{ label: string; icon: string; page: AppPage }>
}

type Data = Record<string, unknown>

// ---- small readers ----
function s(d: Data, k: string): string {
  const v = d[k]
  return typeof v === 'string' ? v : ''
}
function n(d: Data, k: string): number {
  const v = d[k]
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v) || 0
  return 0
}
function arr<T>(d: Data, k: string): T[] {
  const v = d[k]
  return Array.isArray(v) ? (v as T[]) : []
}
/** Prefer `data`, fall back to the raw `input`. */
function pick(data: Data, input: Data, k: string): string {
  return s(data, k) || s(input, k)
}
function short(sha: string): string {
  return sha.length > 8 ? sha.slice(0, 8) : sha
}
function loc(org: string, repo: string, ref: string): string {
  return `${org}/${repo}${ref ? ` @ ${ref}` : ''}`
}

const diffTone = (a: number, d: number): CardField['tone'] => (d > 0 ? 'destructive' : a > 0 ? 'success' : 'muted')

/** Build a card for a tool, or null to fall back to the raw JSON view. */
export function cardFor(tool: string, data: Data, input: Data): CardSpec | null {
  const org = pick(data, input, 'org')
  const repo = pick(data, input, 'repo')
  const ref = pick(data, input, 'ref') || pick(data, input, 'branch')
  const path = pick(data, input, 'path')
  const sha = s(data, 'sha') || s(data, 'commit')
  const index = n(data, 'index') || n(input, 'index')
  const at = org && repo ? loc(org, repo, ref) : ''

  switch (tool) {
    // ---- repo: reads ----
    case 'repo-read': {
      if (!org || !repo || !path) return null
      const total = n(data, 'total_lines')
      const start = n(data, 'start')
      const shown = n(data, 'shown')
      const range = total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
      return {
        subtitle: at,
        fields: [
          { icon: 'file_code', label: 'path', value: path, mono: true },
          ...(range ? [{ icon: 'list', label: 'lines', value: range, mono: true } as CardField] : []),
          ...(sha ? [{ icon: 'commit', label: 'blob', value: short(sha), mono: true, tone: 'muted' } as CardField] : []),
        ],
        actions: [{ label: path, icon: 'file_code', page: P.repoBlob(org, repo, ref, path) }],
      }
    }
    case 'repo-list': {
      if (!org || !repo) return null
      const entries = arr<{ path: string; type: string; size: number }>(data, 'entries')
      return {
        subtitle: at,
        fields: [
          { icon: 'folder', label: 'path', value: path || '/', mono: true },
          { icon: 'list', label: 'entries', value: String(entries.length) },
        ],
        body: entries.length ? { kind: 'entries', entries } : undefined,
        actions: [{ label: at, icon: 'folder', page: P.repoDetail(org, repo, ref) }],
      }
    }
    case 'repo-log': {
      if (!org || !repo) return null
      const commits = arr<{ sha: string; message: string; author: string; date: string }>(data, 'commits')
      return {
        subtitle: path ? `${at} : ${path}` : at,
        fields: [
          { icon: 'history', label: 'commits', value: String(commits.length) },
          ...(path ? [{ icon: 'file_code', label: 'path', value: path, mono: true } as CardField] : []),
        ],
        body: commits.length ? { kind: 'commits', commits, org, repo, ref } : undefined,
        actions: [
          path
            ? { label: path, icon: 'history', page: P.repoHistory(org, repo, ref, path) }
            : { label: at, icon: 'history', page: P.repoDetail(org, repo, ref) },
        ],
      }
    }
    case 'repo-show': {
      if (!org || !repo || !sha) return null
      const c = (data['commit'] ?? {}) as Data
      return {
        subtitle: at,
        fields: [
          { icon: 'commit', label: 'commit', value: short(sha), mono: true },
          ...(s(c, 'author') ? [{ icon: 'user', label: 'author', value: s(c, 'author') } as CardField] : []),
          ...(s(c, 'date') ? [{ icon: 'clock', label: 'date', value: s(c, 'date'), mono: true, tone: 'muted' } as CardField] : []),
        ],
        actions: [{ label: short(sha), icon: 'commit', page: P.repoCommit(org, repo, ref, sha) }],
      }
    }
    case 'repo-diff': {
      const base = pick(data, input, 'base')
      const head = pick(data, input, 'head')
      if (!org || !repo || !base || !head) return null
      const files = arr<{ path: string; status: string; additions: number; deletions: number }>(data, 'files')
      const add = files.reduce((t, f) => t + (f.additions || 0), 0)
      const del = files.reduce((t, f) => t + (f.deletions || 0), 0)
      return {
        subtitle: `${org}/${repo}`,
        fields: [
          { icon: 'diff', label: 'range', value: `${base} … ${head}`, mono: true },
          { icon: 'file_code', label: 'files', value: String(files.length) },
          { icon: 'diff', label: 'changes', value: `+${add} −${del}`, mono: true, tone: diffTone(add, del) },
        ],
        body: files.length ? { kind: 'files', files, org, repo, ref: head } : undefined,
        actions: [{ label: `${base}…${head}`, icon: 'diff', page: P.repoCompare(org, repo, base, head) }],
      }
    }

    // ---- repo: writes ----
    case 'repo-write':
    case 'repo-edit':
    case 'repo-delete': {
      if (!org || !repo) return null
      const added = n(data, 'added')
      const removed = n(data, 'removed')
      const fanned = n(data, 'fanned')
      const action = tool === 'repo-write' ? 'write' : tool === 'repo-edit' ? 'edit' : 'delete'
      const fields: CardField[] = [
        { icon: 'file_code', label: 'path', value: path, mono: true },
        { icon: 'commit', label: 'commit', value: short(sha), mono: true },
      ]
      if (added || removed) fields.push({ icon: 'diff', label: 'changes', value: `+${added} −${removed}`, mono: true, tone: diffTone(added, removed) })
      if (fanned) fields.push({ icon: 'box', label: 'sandboxes', value: String(fanned), tone: 'muted' })
      const actions: CardSpec['actions'] = []
      if (sha) actions.push({ label: short(sha), icon: 'commit', page: P.repoCommit(org, repo, ref, sha) })
      if (path) actions.push({ label: path, icon: 'file_code', page: P.repoBlob(org, repo, ref, path) })
      const d = s(data, 'diff')
      return { subtitle: `${action} · ${at}`, fields, body: d ? { kind: 'diff', diff: d } : undefined, actions }
    }
    case 'repo-commit': {
      if (!org || !repo) return null
      const fanned = n(data, 'fanned')
      return {
        subtitle: at,
        fields: [
          { icon: 'commit', label: 'commit', value: short(sha), mono: true },
          ...(fanned ? [{ icon: 'box', label: 'sandboxes', value: String(fanned), tone: 'muted' } as CardField] : []),
        ],
        actions: sha ? [{ label: short(sha), icon: 'commit', page: P.repoCommit(org, repo, ref, sha) }] : [],
      }
    }
    case 'repo-restore': {
      if (!org || !repo) return null
      const from = pick(data, input, 'from')
      const binary = data['binary'] === true
      return {
        subtitle: at,
        fields: [
          { icon: 'file_code', label: 'path', value: path, mono: true },
          { icon: 'history', label: 'from', value: from, mono: true },
          ...(binary ? [{ icon: 'binary', label: 'binary', value: 'yes', tone: 'muted' } as CardField] : []),
        ],
        actions: sha ? [{ label: short(sha), icon: 'commit', page: P.repoCommit(org, repo, ref, sha) }] : [],
      }
    }
    case 'repo-branch-sync': {
      if (!org || !repo) return null
      const clean = data['clean'] !== false
      const conflicts = arr<string>(data, 'conflicts')
      return {
        subtitle: loc(org, repo, pick(data, input, 'branch') || ref),
        fields: [
          { icon: clean ? 'success' : 'error', label: 'status', value: clean ? 'clean' : `${conflicts.length} conflicts`, tone: clean ? 'success' : 'destructive' },
        ],
        body: !clean && conflicts.length ? { kind: 'conflicts', conflicts } : undefined,
        actions: sha ? [{ label: short(sha), icon: 'commit', page: P.repoCommit(org, repo, ref, sha) }] : [],
      }
    }

    // ---- repo: refs ----
    case 'repo-branches': {
      if (!org || !repo) return null
      const branches = arr<{ name: string; sha: string }>(data, 'branches')
      return {
        subtitle: at,
        fields: [{ icon: 'folder', label: 'branches', value: String(branches.length) }],
        body: { kind: 'branches', branches, org, repo },
        actions: [{ label: at, icon: 'folder', page: P.repoDetail(org, repo, ref) }],
      }
    }
    case 'repo-tags': {
      if (!org || !repo) return null
      const tags = arr<{ name: string; sha: string }>(data, 'tags')
      return {
        subtitle: at,
        fields: [{ icon: 'tag', label: 'tags', value: String(tags.length) }],
        body: { kind: 'tags', tags, org, repo },
        actions: [{ label: at, icon: 'tag', page: P.repoDetail(org, repo, ref) }],
      }
    }
    case 'repo-branch-create': {
      if (!org || !repo) return null
      const name = pick(data, input, 'name')
      const from = pick(data, input, 'from')
      return {
        subtitle: at,
        fields: [
          { icon: 'folder', label: 'branch', value: name, mono: true },
          { icon: 'history', label: 'from', value: from, mono: true, tone: 'muted' },
        ],
        actions: [{ label: `${org}/${repo} @ ${name}`, icon: 'folder', page: P.repoDetail(org, repo, name) }],
      }
    }
    case 'repo-tag-create': {
      if (!org || !repo) return null
      const name = pick(data, input, 'name')
      const target = pick(data, input, 'target')
      return {
        subtitle: at,
        fields: [
          { icon: 'tag', label: 'tag', value: name, mono: true },
          { icon: 'history', label: 'target', value: target, mono: true, tone: 'muted' },
        ],
        actions: [{ label: `${org}/${repo} @ ${name}`, icon: 'tag', page: P.repoTag(org, repo, name) }],
      }
    }

    // ---- change requests ----
    case 'repo-mr-create':
    case 'repo-mr-comment':
    case 'repo-mr-merge': {
      if (!org || !repo || index <= 0) return null
      const head = pick(data, input, 'head')
      const base = pick(data, input, 'base')
      const url = s(data, 'url')
      return {
        subtitle: `${org}/${repo}`,
        fields: [
          { icon: 'merge', label: 'mr', value: `#${index}`, mono: true },
          ...(head && base ? [{ icon: 'diff', label: 'range', value: `${head} → ${base}`, mono: true } as CardField] : []),
          ...(url ? [{ icon: 'link', label: 'url', value: url, mono: true, tone: 'muted' } as CardField] : []),
        ],
        actions: [{ label: `#${index}`, icon: 'merge', page: P.repoMR(org, repo, index) }],
      }
    }
    case 'repo-mr-list': {
      if (!org || !repo) return null
      const pulls = arr<{ index: number; title: string; head: string; base: string; state: string; merged?: boolean }>(data, 'pulls')
      return {
        subtitle: `${org}/${repo}`,
        fields: [{ icon: 'merge', label: 'open', value: String(pulls.length) }],
        body: pulls.length ? { kind: 'pulls', pulls, org, repo } : undefined,
      }
    }

    // ---- admin: org/repo/mirrors ----
    case 'repo-explore': {
      const orgs = arr<string>(data, 'orgs')
      const repos = data['repos']
      if (orgs.length) {
        return { subtitle: 'orgs', fields: [{ icon: 'building', label: 'orgs', value: String(orgs.length) }], body: { kind: 'text', text: orgs.join('\n') } }
      }
      if (Array.isArray(repos)) {
        const list = (repos as Array<Record<string, unknown>>).map(r => s(r, 'full_name') || `${s(r, 'org')}/${s(r, 'repo')}`)
        return { subtitle: org || 'repos', fields: [{ icon: 'folder', label: 'repos', value: String(list.length) }], body: { kind: 'text', text: list.join('\n') } }
      }
      return null
    }
    case 'repo-import': {
      const url = pick(data, input, 'url')
      const branch = s(data, 'default_branch')
      return {
        subtitle: `${org}/${repo}`,
        fields: [
          { icon: 'link', label: 'url', value: url, mono: true },
          ...(branch ? [{ icon: 'folder', label: 'branch', value: branch, mono: true } as CardField] : []),
        ],
        actions: org && repo ? [{ label: `${org}/${repo}`, icon: 'folder', page: P.repoDetail(org, repo, branch || 'main') }] : [],
      }
    }
    case 'repo-set-push-mirror': {
      const url = pick(data, input, 'remote-url') || s(data, 'remote_address')
      const name = s(data, 'remote_name')
      const interval = s(data, 'interval')
      const onCommit = data['sync_on_commit'] === true
      return {
        subtitle: at || 'push mirror',
        fields: [
          ...(name ? [{ icon: 'branch', label: 'remote', value: name, mono: true } as CardField] : []),
          { icon: 'link', label: 'url', value: url, mono: true },
          ...(interval ? [{ icon: 'clock', label: 'interval', value: interval, mono: true, tone: 'muted' } as CardField] : []),
          { icon: 'commit', label: 'on-commit', value: onCommit ? 'yes' : 'no', tone: 'muted' },
        ],
      }
    }
    case 'repo-list-push-mirrors': {
      const mirrors = arr<Record<string, unknown>>(data, 'mirrors')
      const text = mirrors.map(m => `${s(m, 'remote_name')} → ${s(m, 'remote_address')}${s(m, 'last_error') ? ` ⚠ ${s(m, 'last_error')}` : ''}`).join('\n')
      return { subtitle: at || 'push mirrors', fields: [{ icon: 'branch', label: 'mirrors', value: String(mirrors.length) }], body: { kind: 'text', text: text || '(none)' } }
    }
    case 'repo-delete-push-mirror': {
      const name = pick(data, input, 'remote-name')
      return { subtitle: at || 'push mirror', fields: [{ icon: 'branch', label: 'remote', value: name, mono: true }] }
    }
    case 'repo-remove': {
      return { subtitle: `${org}/${repo}`, fields: [{ icon: 'delete', label: 'removed', value: `${org}/${repo}`, mono: true, tone: 'destructive' }] }
    }
    case 'repo-create-org': {
      return { subtitle: org, fields: [{ icon: 'building', label: 'org', value: org, mono: true }] }
    }
    case 'repo-create-repo': {
      const branch = s(data, 'default_branch') || 'main'
      return {
        subtitle: `${org}/${repo}`,
        fields: [{ icon: 'folder', label: 'repo', value: `${org}/${repo}`, mono: true }, { icon: 'branch', label: 'branch', value: branch, mono: true, tone: 'muted' }],
        actions: org && repo ? [{ label: `${org}/${repo}`, icon: 'folder', page: P.repoDetail(org, repo, branch) }] : [],
      }
    }
    case 'repo-mail-send': {
      const session = s(data, 'session')
      const branch = pick(data, input, 'branch') || 'main'
      const text = pick(data, input, 'text')
      return {
        subtitle: session || (org && repo ? loc(org, repo, branch) : 'mail'),
        fields: [{ icon: 'mail', label: 'to', value: session || `${org}:${repo}:${branch}`, mono: true }],
        body: text ? { kind: 'text', text } : undefined,
      }
    }

    // ---- images ----
    case 'repo-build-image':
    case 'repo-build-preview':
    case 'oci-import': {
      const imageRef = s(data, 'image_ref')
      const tag = s(data, 'tag')
      const source = s(data, 'source')
      return {
        subtitle: 'image',
        fields: [
          ...(imageRef ? [{ icon: 'box', label: 'image', value: imageRef, mono: true } as CardField] : []),
          ...(tag ? [{ icon: 'tag', label: 'tag', value: tag, mono: true, tone: 'muted' } as CardField] : []),
          ...(source ? [{ icon: 'link', label: 'source', value: source, mono: true, tone: 'muted' } as CardField] : []),
        ],
      }
    }
    case 'list-oci-images': {
      const images = arr<{ owner: string; name: string; tag: string; ref?: string }>(data, 'images')
      return {
        subtitle: 'oci',
        fields: [{ icon: 'box', label: 'images', value: String(images.length) }],
        body: images.length ? { kind: 'images', images } : undefined,
      }
    }

    // ---- sandbox ----
    case 'sandbox-create':
    case 'sandbox-status': {
      const name = pick(data, input, 'name') || pick(data, input, 'worker-name')
      if (!name) return null
      const fields: CardField[] = []
      if (s(data, 'image')) fields.push({ icon: 'box', label: 'image', value: s(data, 'image'), mono: true })
      if (s(data, 'phase')) fields.push({ icon: 'success', label: 'phase', value: s(data, 'phase') })
      if (s(data, 'url')) fields.push({ icon: 'link', label: 'url', value: s(data, 'url'), mono: true, tone: 'muted' })
      if (s(data, 'creator')) fields.push({ icon: 'user', label: 'creator', value: s(data, 'creator'), tone: 'muted' })
      return { subtitle: name, fields, actions: [{ label: name, icon: 'box', page: P.sandboxPage(name) }] }
    }
    case 'sandbox-checkout': {
      if (!org || !repo) return null
      const dest = s(data, 'dest')
      const files = n(data, 'files')
      return {
        subtitle: at,
        fields: [
          ...(dest ? [{ icon: 'folder', label: 'dest', value: dest, mono: true } as CardField] : []),
          { icon: 'file_code', label: 'files', value: String(files) },
        ],
        actions: [{ label: at, icon: 'folder', page: P.repoDetail(org, repo, ref) }],
      }
    }
    case 'sandbox-port': {
      if (!org || !repo) return null
      const paths = arr<string>(data, 'paths')
      return {
        subtitle: at,
        fields: [
          { icon: 'file_code', label: 'files', value: String(paths.length || n(data, 'count')) },
          { icon: 'commit', label: 'commit', value: short(sha), mono: true },
        ],
        body: paths.length ? { kind: 'paths', paths } : undefined,
        actions: sha ? [{ label: short(sha), icon: 'commit', page: P.repoCommit(org, repo, ref, sha) }] : [],
      }
    }

    // ---- services ----
    case 'service-deploy':
    case 'service-preview': {
      const name = s(data, 'name')
      if (!name) return null
      const fields: CardField[] = []
      if (s(data, 'image')) fields.push({ icon: 'box', label: 'image', value: s(data, 'image'), mono: true })
      if (s(data, 'phase')) fields.push({ icon: 'success', label: 'phase', value: s(data, 'phase') })
      if (s(data, 'url')) fields.push({ icon: 'link', label: 'url', value: s(data, 'url'), mono: true, tone: 'muted' })
      const ports = arr<{ name: string; preset: string; port: number; protocol: string; targetPort: number; publicUrl?: string }>(data, 'ports')
      if (n(data, 'replicas')) fields.push({ icon: 'server', label: 'replicas', value: String(n(data, 'replicas')), tone: 'muted' })
      return {
        subtitle: name,
        fields,
        body: ports.length ? { kind: 'ports', ports } : undefined,
        actions: [{ label: name, icon: 'server', page: P.servicePage(name) }],
      }
    }
    case 'service-logs': {
      const name = s(data, 'name') || pick(data, input, 'name')
      if (!name) return null
      return {
        subtitle: name,
        fields: [{ icon: 'terminal', label: 'lines', value: String(n(data, 'lines')) }],
        actions: [{ label: name, icon: 'server', page: P.servicePage(name) }],
      }
    }
    case 'service-list': {
      return { subtitle: 'services', fields: [{ icon: 'server', label: 'count', value: String(n(data, 'count')) }] }
    }
    case 'service-delete': {
      const name = s(data, 'name') || pick(data, input, 'name')
      return { subtitle: name, fields: [{ icon: 'delete', label: 'deleted', value: name, mono: true, tone: 'destructive' }] }
    }

    default:
      return null
  }
}
