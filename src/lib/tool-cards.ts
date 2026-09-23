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
  // Terminal-style output: `$ command` prompt + monospace body + status line.
  | { kind: 'terminal'; command?: string; text: string; state?: string; exitCode?: number }
  // Source with line numbers + Shiki (reuses CodeSurface).
  | { kind: 'code'; name: string; text: string }
  // An indented tree (sandbox-ls).
  | { kind: 'tree'; rows: Array<{ path: string; depth: number; type: string; size: number }> }
  // A generic clickable list (services / sandboxes / orgs / repos).
  | { kind: 'list'; rows: Array<{ label: string; sub?: string; icon?: string; link?: AppPage; tone?: 'default' | 'success' | 'destructive' | 'muted' }> }
  // A key/value definition table (file-info).
  | { kind: 'kv'; rows: Array<{ k: string; v: string; mono?: boolean }> }
  // Chat-history entries (history-search / history-range).
  | { kind: 'messages'; entries: Array<{ role: string; content: string; tool_name?: string; change_id?: string; created_at?: string; depth?: number }> }
  // Rendered markdown (web-fetch ONLY — never repo/file reads).
  | { kind: 'markdown'; text: string }
  // An audio player + optional caption (transcription / TTS).
  | { kind: 'audio'; code: string; caption?: string }
  // A single image preview + optional caption (image-read).
  | { kind: 'media'; code: string; mime?: string; name?: string; caption?: string }

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

/**
 * Build a card for a tool, or null to fall back to the raw JSON view. `output`
 * is the tool's result TEXT (needed by the terminal/code bodies, whose payload
 * is not in `data`).
 */
/**
 * The bare tool name: a colliding tool arrives extension-qualified
 * (`bundled.mail-send`); strip ONE leading `<word>.` segment so cards match by
 * their bare name.
 */
export function bareToolName(tool: string): string {
  const m = /^[A-Za-z0-9_-]+\.([a-z0-9][a-z0-9-]*)$/.exec(tool)
  return m ? m[1]! : tool
}

export function cardFor(rawTool: string, data: Data, input: Data, output = ''): CardSpec | null {
  const tool = bareToolName(rawTool)
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
    case 'service-delete': {
      const name = s(data, 'name') || pick(data, input, 'name')
      return { subtitle: name, fields: [{ icon: 'delete', label: 'deleted', value: name, mono: true, tone: 'destructive' }] }
    }

    // ---- sandbox execution: terminal ----
    case 'sandbox-exec':
    case 'sandbox-job-start':
    case 'sandbox-job-output':
    case 'sandbox-job-wait': {
      const name = pick(data, input, 'worker-name')
      const jobId = s(data, 'job-id') || pick(data, input, 'job-id')
      const command = pick(data, input, 'command')
      const state = s(data, 'state')
      const exit = data['exit_code']
      const fields: CardField[] = []
      if (name) fields.push({ icon: 'box', label: 'sandbox', value: name, mono: true })
      if (jobId) fields.push({ icon: 'terminal', label: 'job', value: jobId, mono: true })
      if (state) fields.push({ icon: state === 'running' ? 'more' : 'success', label: 'state', value: state, tone: state === 'running' ? 'muted' : 'success' })
      const actions: CardSpec['actions'] = []
      if (name && jobId) actions.push({ label: jobId, icon: 'terminal', page: P.sandboxJobPage(name, jobId) })
      if (name) actions.push({ label: name, icon: 'box', page: P.sandboxPage(name) })
      return {
        subtitle: name || jobId || 'exec',
        fields,
        body: { kind: 'terminal', command, text: output, state, exitCode: typeof exit === 'number' ? exit : undefined },
        actions,
      }
    }
    case 'sandbox-job-list': {
      const count = n(data, 'count')
      return { subtitle: 'jobs', fields: [{ icon: 'terminal', label: 'jobs', value: String(count) }], body: output ? { kind: 'terminal', text: output } : undefined }
    }
    case 'sandbox-job-kill':
    case 'sandbox-job-stdin': {
      const jobId = pick(data, input, 'job-id')
      return { subtitle: jobId, fields: [{ icon: 'terminal', label: 'job', value: jobId, mono: true }] }
    }

    // ---- sandbox files ----
    case 'sandbox-read': {
      const path = pick(data, input, 'path')
      const total = n(data, 'total_lines')
      const start = n(data, 'start')
      const shown = n(data, 'shown')
      const range = total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
      return {
        subtitle: path || 'read',
        fields: [
          { icon: 'file_code', label: 'path', value: path, mono: true },
          ...(range ? [{ icon: 'list', label: 'lines', value: range, mono: true } as CardField] : []),
        ],
        body: { kind: 'code', name: path.split('/').pop() || path, text: stripLineNumbers(output) },
      }
    }
    case 'sandbox-write':
    case 'sandbox-edit': {
      const path = pick(data, input, 'path')
      const added = n(data, 'added')
      const removed = n(data, 'removed')
      const fields: CardField[] = [{ icon: 'file_code', label: 'path', value: path, mono: true }]
      if (added || removed) fields.push({ icon: 'diff', label: 'changes', value: `+${added} −${removed}`, mono: true, tone: diffTone(added, removed) })
      if (n(data, 'lines')) fields.push({ icon: 'list', label: 'lines', value: String(n(data, 'lines')), tone: 'muted' })
      const d = s(data, 'diff')
      return { subtitle: path || tool, fields, body: d ? { kind: 'diff', diff: d } : undefined }
    }
    case 'sandbox-ls': {
      const path = pick(data, input, 'path')
      const entries = arr<{ path: string; depth: number; type: string; size: number }>(data, 'entries')
      return {
        subtitle: path || '/',
        fields: [{ icon: 'folder', label: 'entries', value: String(entries.length || n(data, 'rows')) }],
        body: entries.length ? { kind: 'tree', rows: entries } : undefined,
      }
    }
    case 'sandbox-info': {
      const fields: CardField[] = []
      if (s(data, 'os')) fields.push({ icon: 'server', label: 'os', value: `${s(data, 'os')}/${s(data, 'arch')}` })
      if (s(data, 'shell')) fields.push({ icon: 'terminal', label: 'shell', value: s(data, 'shell'), mono: true })
      if (s(data, 'workspace')) fields.push({ icon: 'folder', label: 'workspace', value: s(data, 'workspace'), mono: true })
      if (s(data, 'url')) fields.push({ icon: 'link', label: 'url', value: s(data, 'url'), mono: true, tone: 'muted' })
      return { subtitle: 'sandbox', fields }
    }
    case 'sandbox-download':
    case 'sandbox-upload': {
      const path = pick(data, input, 'path')
      const code = s(data, 'code')
      return {
        subtitle: path || code || tool,
        fields: [
          ...(path ? [{ icon: 'file_code', label: 'path', value: path, mono: true } as CardField] : []),
          ...(code ? [{ icon: 'file', label: 'file', value: code, mono: true, tone: 'muted' } as CardField] : []),
        ],
      }
    }

    // ---- workspace lists ----
    case 'service-list': {
      const services = arr<{ name: string; phase: string; image: string; url: string; session: string; publicUrl: string }>(data, 'services')
      if (!services.length) return { subtitle: 'services', fields: [{ icon: 'server', label: 'count', value: '0' }] }
      return {
        subtitle: 'services',
        fields: [{ icon: 'server', label: 'services', value: String(services.length) }],
        body: {
          kind: 'list',
          rows: services.map(s => ({
            label: s.name,
            sub: `${s.phase}${s.publicUrl ? ` · ${s.publicUrl}` : s.url ? ` · ${s.url}` : ''}`,
            icon: 'server',
            tone: s.phase === 'Running' ? 'success' : 'muted',
            link: P.servicePage(s.name),
          })),
        },
      }
    }
    case 'sandbox-list': {
      const sandboxes = arr<{ name: string; phase: string; image: string; url: string; creator: string; session: string }>(data, 'sandboxes')
      if (!sandboxes.length) return { subtitle: 'sandboxes', fields: [{ icon: 'box', label: 'count', value: '0' }] }
      return {
        subtitle: 'sandboxes',
        fields: [{ icon: 'box', label: 'sandboxes', value: String(sandboxes.length) }],
        body: {
          kind: 'list',
          rows: sandboxes.map(s => ({
            label: s.name,
            sub: `${s.phase}${s.image ? ` · ${s.image}` : ''}`,
            icon: 'box',
            tone: s.phase === 'Running' ? 'success' : 'muted',
            link: P.sandboxPage(s.name),
          })),
        },
      }
    }

    // ---- bundled: history (data.entries) ----
    case 'history-search':
    case 'history-range': {
      const entries = arr<{ role: string; content: string; tool_name?: string; change_id?: string; created_at?: string; depth?: number }>(data, 'entries')
      return {
        subtitle: 'history',
        fields: [{ icon: 'history', label: 'entries', value: String(entries.length) }],
        body: entries.length ? { kind: 'messages', entries } : undefined,
      }
    }

    // ---- bundled: file-info / file-read ----
    case 'file-info': {
      const meta = (data['meta'] ?? {}) as Data
      const rows = [
        { k: 'name', v: s(meta, 'name') },
        { k: 'mime', v: s(meta, 'mime'), mono: true },
        { k: 'size', v: String(n(meta, 'size')) },
        { k: 'sha256', v: s(meta, 'sha256'), mono: true },
      ].filter(r => r.v !== '')
      return {
        subtitle: s(meta, 'name') || s(data, 'code') || 'file',
        fields: [{ icon: 'file', label: 'code', value: pick(data, input, 'code'), mono: true, tone: 'muted' }],
        body: rows.length ? { kind: 'kv', rows } : undefined,
      }
    }
    case 'file-read': {
      const name = s(data, 'name') || pick(data, input, 'name') || pick(data, input, 'code')
      const total = n(data, 'total_lines')
      const start = n(data, 'start')
      const shown = n(data, 'shown')
      const range = total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
      return {
        subtitle: name,
        fields: [
          { icon: 'file_code', label: 'code', value: pick(data, input, 'code'), mono: true },
          ...(range ? [{ icon: 'list', label: 'lines', value: range, mono: true } as CardField] : []),
        ],
        body: { kind: 'code', name: name.split('/').pop() || name, text: stripLineNumbers(output) },
      }
    }

    // ---- bundled: web-fetch (rendered markdown ONLY here) ----
    case 'web-fetch': {
      const url = s(data, 'url') || pick(data, input, 'url')
      const format = s(data, 'format') || pick(data, input, 'format')
      const ctype = s(data, 'contentType')
      return {
        subtitle: url,
        fields: [
          { icon: 'link', label: 'url', value: url, mono: true, tone: 'muted' },
          ...(ctype ? [{ icon: 'file', label: 'type', value: ctype, mono: true, tone: 'muted' } as CardField] : []),
          ...(format ? [{ icon: 'list', label: 'format', value: format, tone: 'muted' } as CardField] : []),
        ],
        body: { kind: 'markdown', text: output },
      }
    }

    // ---- bundled: audio (transcribe / tts) ----
    case 'audio-transcribe': {
      const code = pick(data, input, 'code')
      return {
        subtitle: s(data, 'name') || code || 'audio',
        fields: [
          { icon: 'file', label: 'code', value: code, mono: true, tone: 'muted' },
          ...(s(data, 'model') ? [{ icon: 'server', label: 'model', value: s(data, 'model'), mono: true, tone: 'muted' } as CardField] : []),
        ],
        body: code ? { kind: 'audio', code, caption: output } : { kind: 'text', text: output },
      }
    }
    case 'tts-generate':
    case 'tts-clone': {
      const files = arr<{ code: string; mime: string; name: string }>(data, 'files')
      const first = files[0]
      return {
        subtitle: 'tts',
        fields: [
          ...(s(data, 'model') ? [{ icon: 'server', label: 'model', value: s(data, 'model'), mono: true, tone: 'muted' } as CardField] : []),
          ...(s(data, 'reference') ? [{ icon: 'file', label: 'reference', value: s(data, 'reference'), mono: true, tone: 'muted' } as CardField] : []),
        ],
        body: first?.code ? { kind: 'audio', code: first.code, caption: pick(data, input, 'text') } : undefined,
      }
    }

    // ---- bundled: image-read ----
    case 'image-read': {
      const code = pick(data, input, 'code')
      return {
        subtitle: s(data, 'name') || code || 'image',
        fields: [
          { icon: 'file', label: 'code', value: code, mono: true, tone: 'muted' },
          ...(s(data, 'model') ? [{ icon: 'server', label: 'model', value: s(data, 'model'), mono: true, tone: 'muted' } as CardField] : []),
        ],
        body: code ? { kind: 'media', code, mime: s(data, 'mime') || undefined, caption: output } : { kind: 'text', text: output },
      }
    }

    // ---- bundled: generation (files rendered by MediaAttachment already) ----
    case 'image-generate':
    case 'image-edit':
    case 'video-generate': {
      const fields: CardField[] = []
      const prompt = pick(data, input, 'prompt')
      if (prompt) fields.push({ icon: 'sparkles', label: 'prompt', value: prompt })
      if (s(data, 'model')) fields.push({ icon: 'server', label: 'model', value: s(data, 'model'), mono: true, tone: 'muted' })
      if (s(data, 'source')) fields.push({ icon: 'file', label: 'source', value: s(data, 'source'), mono: true, tone: 'muted' })
      return { subtitle: tool, fields }
    }

    // ---- bundled: cross-session ----
    case 'subsession-create': {
      const name = s(data, 'name') || pick(data, input, 'name')
      const desc = s(data, 'description') || pick(data, input, 'description')
      const prompt = pick(data, input, 'prompt')
      return {
        subtitle: name || 'subsession',
        fields: [
          ...(name ? [{ icon: 'bot', label: 'session', value: name, mono: true } as CardField] : []),
          ...(desc ? [{ icon: 'info', label: 'label', value: desc } as CardField] : []),
        ],
        body: prompt ? { kind: 'text', text: prompt } : undefined,
      }
    }
    case 'mail-send': {
      const to = s(data, 'to') || pick(data, input, 'to')
      const text = s(data, 'text') || pick(data, input, 'text')
      return {
        subtitle: to || 'mail',
        fields: [{ icon: 'mail', label: 'to', value: to, mono: true }],
        body: text ? { kind: 'text', text } : undefined,
      }
    }

    // ---- bundled: brave-search (results only when upstream adds data.results) ----
    case 'brave-search': {
      const results = arr<{ title: string; url: string; description?: string }>(data, 'results')
      const query = s(data, 'query') || pick(data, input, 'query')
      if (!results.length) return { subtitle: query || 'search', fields: [{ icon: 'search', label: 'query', value: query }] }
      return {
        subtitle: query || 'search',
        fields: [{ icon: 'search', label: 'query', value: query }, { icon: 'list', label: 'results', value: String(results.length) }],
        body: {
          kind: 'list',
          rows: results.map(r => ({ label: r.title || r.url, sub: r.description || r.url, icon: 'link' })),
        },
      }
    }

    default:
      return null
  }
}

/** Strip a leading `N\t` / `N  ` line-number gutter from read output. */
function stripLineNumbers(text: string): string {
  return text
    .split('\n')
    .map(l => l.replace(/^\s*\d+\s{2,}/, '').replace(/^\s*\d+\t/, ''))
    .join('\n')
}
