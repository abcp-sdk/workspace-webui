// Tool-card registry — per-tool "pretty" rendering of a tool call, split into
// TWO independent sections:
//
//   input  — the arguments the model passed (from `state.input`)
//   result — what came back (from `state.data` + the result `output` text)
//
// Each section has its own Pretty/raw toggle in `ToolPartView` (input: Pretty |
// JSON; result: Pretty | Text). This module is PURE (no Svelte): it returns a
// plain spec the component renders, so the mapping is unit-testable. Tools
// without a spec fall back to raw JSON + the output text.
import type { AppPage } from './nav'
import * as P from './tool-pages'

/** One labelled row on a card. */
export interface CardField {
  /** AppIcons key. */
  icon: string
  /** Row label (a literal key, not localized here). */
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

/** A primary action button that deep-links into the Code / Service tabs. */
export interface CardAction {
  label: string
  icon: string
  page: AppPage
}

/** A list body rendered under a section's fields. */
export type CardBody =
  | { kind: 'diff'; diff: string }
  | {
      kind: 'commits'
      commits: Array<{
        sha: string
        message: string
        author: string
        date: string
      }>
      org: string
      repo: string
      ref: string
    }
  | {
      kind: 'entries'
      entries: Array<{ path: string; type: string; size: number }>
    }
  | {
      kind: 'files'
      files: Array<{
        path: string
        status: string
        additions: number
        deletions: number
      }>
      org: string
      repo: string
      ref: string
    }
  | { kind: 'paths'; paths: string[] }
  | {
      kind: 'branches'
      branches: Array<{ name: string; sha: string }>
      org: string
      repo: string
    }
  | {
      kind: 'tags'
      tags: Array<{ name: string; sha: string }>
      org: string
      repo: string
    }
  | {
      kind: 'pulls'
      pulls: Array<{
        index: number
        title: string
        head: string
        base: string
        state: string
        merged?: boolean
      }>
      org: string
      repo: string
    }
  | { kind: 'conflicts'; conflicts: string[] }
  | {
      kind: 'ports'
      ports: Array<{
        name: string
        preset: string
        port: number
        protocol: string
        targetPort: number
        publicUrl?: string
      }>
    }
  | {
      kind: 'images'
      images: Array<{ owner: string; name: string; tag: string; ref?: string }>
    }
  | { kind: 'text'; text: string; tone?: 'default' | 'destructive' }
  // Terminal-style output: `$ command` prompt + monospace body + status line.
  | {
      kind: 'terminal'
      command?: string
      text: string
      state?: string
      exitCode?: number
    }
  // Source with line numbers + Shiki (reuses CodeSurface).
  | { kind: 'code'; name: string; text: string }
  // An indented tree (sandbox-file-ls).
  | {
      kind: 'tree'
      rows: Array<{ path: string; depth: number; type: string; size: number }>
    }
  // A generic clickable list (services / sandboxes / orgs / repos).
  | {
      kind: 'list'
      rows: Array<{
        label: string
        sub?: string
        icon?: string
        link?: AppPage
        tone?: 'default' | 'success' | 'destructive' | 'muted'
      }>
    }
  // A key/value definition table (file-info).
  | { kind: 'kv'; rows: Array<{ k: string; v: string; mono?: boolean }> }
  // Chat-history entries (history-search / history-range).
  | {
      kind: 'messages'
      entries: Array<{
        role: string
        content: string
        tool_name?: string
        change_id?: string
        created_at?: string
        depth?: number
      }>
    }
  // Rendered markdown (web-fetch ONLY — never repo/file reads).
  | { kind: 'markdown'; text: string }
  // An audio player + optional caption (transcription / TTS).
  | { kind: 'audio'; code: string; caption?: string }
  // A single image preview + optional caption (image-read).
  | {
      kind: 'media'
      code: string
      mime?: string
      name?: string
      caption?: string
    }

/** One half of a card (the input args, or the result). */
export interface CardSection {
  fields: CardField[]
  body?: CardBody
  actions?: CardAction[]
}

export interface CardSpec {
  /** Header subtitle (replaces the redundant italic title). */
  subtitle: string
  /** The call's arguments. */
  input: CardSection
  /** The call's result (empty while running). */
  result: CardSection
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

/** Render any JSON value as a compact single-line string. */
function vstr(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const diffTone = (a: number, d: number): CardField['tone'] =>
  d > 0 ? 'destructive' : a > 0 ? 'success' : 'muted'

// ---- field builders (input vs result) ----

/** A field from the call ARGUMENTS (`input`); null when absent/empty. */
function fin(
  input: Data,
  key: string,
  icon: string,
  label = key,
  opts: Partial<CardField> = {},
): CardField | null {
  const v = input[key]
  if (v === undefined || v === null || v === '') return null
  return { icon, label, value: vstr(v), ...opts }
}

/** A field from the RESULT (`data`); null when absent/empty. */
function fres(
  data: Data,
  key: string,
  icon: string,
  label = key,
  opts: Partial<CardField> = {},
): CardField | null {
  const v = data[key]
  if (v === undefined || v === null || v === '') return null
  return { icon, label, value: vstr(v), ...opts }
}

/** Drop the null entries of a field list. */
function fs(...xs: Array<CardField | null>): CardField[] {
  return xs.filter((x): x is CardField => x !== null)
}

/**
 * The bare tool name: a colliding tool arrives extension-qualified
 * (`bundled.mail-send`); strip ONE leading `<word>.` segment so cards match by
 * their bare name.
 */
export function bareToolName(tool: string): string {
  const m = /^[A-Za-z0-9_-]+\.([a-z0-9][a-z0-9-]*)$/.exec(tool)
  return m ? m[1]! : tool
}

/**
 * Build a card for a tool, or null to fall back to raw JSON. `output` is the
 * result TEXT (used by the terminal/code/markdown bodies, whose payload is not
 * in `data`).
 */
export function cardFor(
  rawTool: string,
  data: Data,
  input: Data,
  output = '',
): CardSpec | null {
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
    case 'repo-file-read': {
      if (!org || !repo || !path) return null
      const total = n(data, 'total_lines')
      const start = n(data, 'start')
      const shown = n(data, 'shown')
      const range =
        total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
      return {
        subtitle: at,
        input: {
          fields: fs(
            fin(input, 'path', 'file_code', 'path', { mono: true }),
            fin(input, 'offset', 'list', 'offset', { mono: true }),
            fin(input, 'limit', 'list', 'limit', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            range
              ? { icon: 'list', label: 'lines', value: range, mono: true }
              : null,
            sha
              ? {
                  icon: 'commit',
                  label: 'blob',
                  value: short(sha),
                  mono: true,
                  tone: 'muted',
                }
              : null,
          ),
          actions: [
            {
              label: path,
              icon: 'file_code',
              page: P.repoBlob(org, repo, ref, path),
            },
          ],
        },
      }
    }
    case 'repo-file-list': {
      if (!org || !repo) return null
      const entries = arr<{ path: string; type: string; size: number }>(
        data,
        'entries',
      )
      return {
        subtitle: at,
        input: {
          fields: fs(fin(input, 'path', 'file_code', 'path', { mono: true })),
        },
        result: {
          fields: [
            { icon: 'list', label: 'entries', value: String(entries.length) },
          ],
          body: entries.length ? { kind: 'entries', entries } : undefined,
          actions: [
            { label: at, icon: 'folder', page: P.repoDetail(org, repo, ref) },
          ],
        },
      }
    }
    case 'repo-log': {
      if (!org || !repo) return null
      const commits = arr<{
        sha: string
        message: string
        author: string
        date: string
      }>(data, 'commits')
      return {
        subtitle: path ? `${at} : ${path}` : at,
        input: {
          fields: fs(
            fin(input, 'path', 'file_code', 'path', { mono: true }),
            fin(input, 'limit', 'list', 'limit', { mono: true }),
          ),
        },
        result: {
          fields: [
            {
              icon: 'history',
              label: 'commits',
              value: String(commits.length),
            },
          ],
          body: commits.length
            ? { kind: 'commits', commits, org, repo, ref }
            : undefined,
          actions: [
            path
              ? {
                  label: path,
                  icon: 'history',
                  page: P.repoHistory(org, repo, ref, path),
                }
              : {
                  label: at,
                  icon: 'history',
                  page: P.repoDetail(org, repo, ref),
                },
          ],
        },
      }
    }
    case 'repo-show': {
      if (!org || !repo || !sha) return null
      const c = (data['commit'] ?? {}) as Data
      return {
        subtitle: at,
        input: {
          fields: fs(fin(input, 'sha', 'commit', 'sha', { mono: true })),
        },
        result: {
          fields: fs(
            {
              icon: 'commit',
              label: 'commit',
              value: short(sha),
              mono: true,
            } as CardField,
            ...(s(c, 'author')
              ? [
                  {
                    icon: 'user',
                    label: 'author',
                    value: s(c, 'author'),
                  } as CardField,
                ]
              : []),
            ...(s(c, 'date')
              ? [
                  {
                    icon: 'clock',
                    label: 'date',
                    value: s(c, 'date'),
                    mono: true,
                    tone: 'muted',
                  } as CardField,
                ]
              : []),
          ),
          actions: [
            {
              label: short(sha),
              icon: 'commit',
              page: P.repoCommit(org, repo, ref, sha),
            },
          ],
        },
      }
    }
    case 'repo-diff': {
      const base = pick(data, input, 'base')
      const head = pick(data, input, 'head')
      if (!org || !repo || !base || !head) return null
      const files = arr<{
        path: string
        status: string
        additions: number
        deletions: number
      }>(data, 'files')
      const add = files.reduce((t, f) => t + (f.additions || 0), 0)
      const del = files.reduce((t, f) => t + (f.deletions || 0), 0)
      return {
        subtitle: `${org}/${repo}`,
        input: {
          fields: fs(
            fin(input, 'base', 'diff', 'base', { mono: true }),
            fin(input, 'head', 'diff', 'head', { mono: true }),
          ),
        },
        result: {
          fields: [
            { icon: 'file_code', label: 'files', value: String(files.length) },
            {
              icon: 'diff',
              label: 'changes',
              value: `+${add} −${del}`,
              mono: true,
              tone: diffTone(add, del),
            },
          ],
          body: files.length
            ? { kind: 'files', files, org, repo, ref: head }
            : undefined,
          actions: [
            {
              label: `${base}…${head}`,
              icon: 'diff',
              page: P.repoCompare(org, repo, base, head),
            },
          ],
        },
      }
    }

    // ---- repo: writes ----
    case 'repo-file-write':
    case 'repo-file-edit':
    case 'repo-file-delete': {
      if (!org || !repo) return null
      const added = n(data, 'added')
      const removed = n(data, 'removed')
      const fanned = n(data, 'fanned')
      const action =
        tool === 'repo-file-write'
          ? 'write'
          : tool === 'repo-file-edit'
            ? 'edit'
            : 'delete'
      const content = pick(data, input, 'content')
      const inputFields = fs(
        fin(input, 'path', 'file_code', 'path', { mono: true }),
        ...(tool === 'repo-file-edit'
          ? [
              fin(input, 'start-line', 'list', 'start', { mono: true }),
              fin(input, 'end-line', 'list', 'end', { mono: true }),
            ]
          : []),
        fin(input, 'message', 'commit', 'message'),
      )
      const resultFields = fs(
        { icon: 'commit', label: 'commit', value: short(sha), mono: true },
        added || removed
          ? {
              icon: 'diff',
              label: 'changes',
              value: `+${added} −${removed}`,
              mono: true,
              tone: diffTone(added, removed),
            }
          : null,
        fanned
          ? {
              icon: 'box',
              label: 'sandboxes',
              value: String(fanned),
              tone: 'muted',
            }
          : null,
      )
      const actions: CardAction[] = []
      if (sha)
        actions.push({
          label: short(sha),
          icon: 'commit',
          page: P.repoCommit(org, repo, ref, sha),
        })
      if (path)
        actions.push({
          label: path,
          icon: 'file_code',
          page: P.repoBlob(org, repo, ref, path),
        })
      const d = s(data, 'diff')
      return {
        subtitle: `${action} · ${at}`,
        input: {
          fields: inputFields,
          // The written/inserted payload is part of the INPUT, not the result.
          body:
            content && tool !== 'repo-file-delete'
              ? { kind: 'text', text: content }
              : undefined,
        },
        result: {
          fields: resultFields,
          body: d ? { kind: 'diff', diff: d } : undefined,
          actions,
        },
      }
    }
    case 'repo-commit': {
      if (!org || !repo) return null
      const fanned = n(data, 'fanned')
      return {
        subtitle: at,
        input: {
          fields: fs(fin(input, 'message', 'commit', 'message')),
        },
        result: {
          fields: fs(
            {
              icon: 'commit',
              label: 'commit',
              value: short(sha),
              mono: true,
            } as CardField,
            fanned
              ? {
                  icon: 'box',
                  label: 'sandboxes',
                  value: String(fanned),
                  tone: 'muted',
                }
              : null,
          ),
          actions: sha
            ? [
                {
                  label: short(sha),
                  icon: 'commit',
                  page: P.repoCommit(org, repo, ref, sha),
                },
              ]
            : [],
        },
      }
    }
    case 'repo-file-restore': {
      if (!org || !repo) return null
      const binary = data['binary'] === true
      return {
        subtitle: at,
        input: {
          fields: fs(
            fin(input, 'path', 'file_code', 'path', { mono: true }),
            fin(input, 'from', 'history', 'from', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            binary
              ? {
                  icon: 'binary',
                  label: 'binary',
                  value: 'yes',
                  tone: 'muted',
                }
              : null,
          ),
          actions: sha
            ? [
                {
                  label: short(sha),
                  icon: 'commit',
                  page: P.repoCommit(org, repo, ref, sha),
                },
              ]
            : [],
        },
      }
    }
    case 'repo-branch-sync': {
      if (!org || !repo) return null
      const clean = data['clean'] !== false
      const conflicts = arr<string>(data, 'conflicts')
      return {
        subtitle: loc(org, repo, pick(data, input, 'branch') || ref),
        input: {
          fields: fs(fin(input, 'branch', 'branch', 'branch', { mono: true })),
        },
        result: {
          fields: [
            {
              icon: clean ? 'success' : 'error',
              label: 'status',
              value: clean ? 'clean' : `${conflicts.length} conflicts`,
              tone: clean ? 'success' : 'destructive',
            },
          ],
          body:
            !clean && conflicts.length
              ? { kind: 'conflicts', conflicts }
              : undefined,
          actions: sha
            ? [
                {
                  label: short(sha),
                  icon: 'commit',
                  page: P.repoCommit(org, repo, ref, sha),
                },
              ]
            : [],
        },
      }
    }

    // ---- repo: refs ----
    case 'repo-branches': {
      if (!org || !repo) return null
      const branches = arr<{ name: string; sha: string }>(data, 'branches')
      return {
        subtitle: at,
        input: { fields: [] },
        result: {
          fields: [
            {
              icon: 'folder',
              label: 'branches',
              value: String(branches.length),
            },
          ],
          body: { kind: 'branches', branches, org, repo },
          actions: [
            { label: at, icon: 'folder', page: P.repoDetail(org, repo, ref) },
          ],
        },
      }
    }
    case 'repo-tags': {
      if (!org || !repo) return null
      const tags = arr<{ name: string; sha: string }>(data, 'tags')
      return {
        subtitle: at,
        input: { fields: [] },
        result: {
          fields: [{ icon: 'tag', label: 'tags', value: String(tags.length) }],
          body: { kind: 'tags', tags, org, repo },
          actions: [
            { label: at, icon: 'tag', page: P.repoDetail(org, repo, ref) },
          ],
        },
      }
    }
    case 'repo-branch-create': {
      if (!org || !repo) return null
      const name = pick(data, input, 'name')
      return {
        subtitle: at,
        input: {
          fields: fs(
            fin(input, 'name', 'folder', 'branch', { mono: true }),
            fin(input, 'from', 'history', 'from', { mono: true }),
          ),
        },
        result: {
          fields: [],
          actions: [
            {
              label: `${org}/${repo} @ ${name}`,
              icon: 'folder',
              page: P.repoDetail(org, repo, name),
            },
          ],
        },
      }
    }
    case 'repo-tag-create': {
      if (!org || !repo) return null
      const name = pick(data, input, 'name')
      return {
        subtitle: at,
        input: {
          fields: fs(
            fin(input, 'name', 'tag', 'tag', { mono: true }),
            fin(input, 'target', 'history', 'target', { mono: true }),
          ),
        },
        result: {
          fields: [],
          actions: [
            {
              label: `${org}/${repo} @ ${name}`,
              icon: 'tag',
              page: P.repoTag(org, repo, name),
            },
          ],
        },
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
      const title = pick(data, input, 'title')
      const bodyText = pick(data, input, 'body')
      // `index` is an ARGUMENT for comment/merge, but the NEW MR number for
      // create (it comes back in `data`).
      const indexArg = n(input, 'index')
      const indexRes = n(data, 'index')
      return {
        subtitle: `${org}/${repo}`,
        input: {
          fields: fs(
            indexArg
              ? {
                  icon: 'merge',
                  label: 'mr',
                  value: `#${indexArg}`,
                  mono: true,
                }
              : null,
            title ? { icon: 'info', label: 'title', value: title } : null,
            ...(head && base
              ? [
                  {
                    icon: 'diff',
                    label: 'range',
                    value: `${head} → ${base}`,
                    mono: true,
                  } as CardField,
                ]
              : []),
          ),
          body: bodyText ? { kind: 'text', text: bodyText } : undefined,
        },
        result: {
          fields: fs(
            indexRes
              ? {
                  icon: 'merge',
                  label: 'mr',
                  value: `#${indexRes}`,
                  mono: true,
                }
              : null,
            url
              ? {
                  icon: 'link',
                  label: 'url',
                  value: url,
                  mono: true,
                  tone: 'muted',
                }
              : null,
          ),
          actions: [
            {
              label: `#${index}`,
              icon: 'merge',
              page: P.repoMR(org, repo, index),
            },
          ],
        },
      }
    }
    case 'repo-mr-list': {
      if (!org || !repo) return null
      const pulls = arr<{
        index: number
        title: string
        head: string
        base: string
        state: string
        merged?: boolean
      }>(data, 'pulls')
      return {
        subtitle: `${org}/${repo}`,
        input: {
          fields: fs(fin(input, 'state', 'list', 'state')),
        },
        result: {
          fields: [
            { icon: 'merge', label: 'open', value: String(pulls.length) },
          ],
          body: pulls.length ? { kind: 'pulls', pulls, org, repo } : undefined,
        },
      }
    }

    // ---- admin: org/repo/mirrors ----
    case 'repo-explore': {
      const orgs = arr<string>(data, 'orgs')
      const repos = data['repos']
      const inputSection: CardSection = {
        fields: fs(
          fin(input, 'org', 'building', 'org', { mono: true }),
          fin(input, 'repo', 'folder', 'repo', { mono: true }),
          fin(input, 'keyword', 'search', 'keyword'),
        ),
      }
      if (orgs.length) {
        return {
          subtitle: 'orgs',
          input: inputSection,
          result: {
            fields: [
              { icon: 'building', label: 'orgs', value: String(orgs.length) },
            ],
            body: { kind: 'text', text: orgs.join('\n') },
          },
        }
      }
      if (Array.isArray(repos)) {
        const list = (repos as Array<Record<string, unknown>>).map(
          r => s(r, 'full_name') || `${s(r, 'org')}/${s(r, 'repo')}`,
        )
        return {
          subtitle: org || 'repos',
          input: inputSection,
          result: {
            fields: [
              { icon: 'folder', label: 'repos', value: String(list.length) },
            ],
            body: { kind: 'text', text: list.join('\n') },
          },
        }
      }
      return null
    }
    case 'repo-import': {
      const branch = s(data, 'default_branch')
      return {
        subtitle: `${org}/${repo}`,
        input: {
          fields: fs(
            fin(input, 'org', 'building', 'org', { mono: true }),
            fin(input, 'url', 'link', 'url', { mono: true }),
            fin(input, 'repo', 'folder', 'repo', { mono: true }),
            fin(input, 'ref', 'branch', 'ref', { mono: true }),
            fin(input, 'auth-user', 'user', 'auth-user', { tone: 'muted' }),
          ),
        },
        result: {
          fields: fs(
            branch
              ? {
                  icon: 'folder',
                  label: 'branch',
                  value: branch,
                  mono: true,
                }
              : null,
          ),
          actions:
            org && repo
              ? [
                  {
                    label: `${org}/${repo}`,
                    icon: 'folder',
                    page: P.repoDetail(org, repo, branch || 'main'),
                  },
                ]
              : [],
        },
      }
    }
    case 'repo-set-push-mirror': {
      const name = s(data, 'remote_name')
      const interval = s(data, 'interval')
      const onCommit = data['sync_on_commit'] === true
      return {
        subtitle: at || 'push mirror',
        input: {
          fields: fs(
            fin(input, 'remote-url', 'link', 'url', { mono: true }),
            fin(input, 'interval', 'clock', 'interval', { mono: true }),
            fin(input, 'branch-filter', 'branch', 'filter', { mono: true }),
            fin(input, 'auth-user', 'user', 'auth-user', { tone: 'muted' }),
            input['sync-on-commit'] === true
              ? {
                  icon: 'commit',
                  label: 'on-commit',
                  value: 'yes',
                  tone: 'muted',
                }
              : null,
          ),
        },
        result: {
          fields: fs(
            name
              ? { icon: 'branch', label: 'remote', value: name, mono: true }
              : null,
            interval
              ? {
                  icon: 'clock',
                  label: 'interval',
                  value: interval,
                  mono: true,
                  tone: 'muted',
                }
              : null,
            {
              icon: 'commit',
              label: 'on-commit',
              value: onCommit ? 'yes' : 'no',
              tone: 'muted',
            },
          ),
        },
      }
    }
    case 'repo-list-push-mirrors': {
      const mirrors = arr<Record<string, unknown>>(data, 'mirrors')
      const text = mirrors
        .map(
          m =>
            `${s(m, 'remote_name')} → ${s(m, 'remote_address')}${s(m, 'last_error') ? ` ⚠ ${s(m, 'last_error')}` : ''}`,
        )
        .join('\n')
      return {
        subtitle: at || 'push mirrors',
        input: { fields: [] },
        result: {
          fields: [
            { icon: 'branch', label: 'mirrors', value: String(mirrors.length) },
          ],
          body: { kind: 'text', text: text || '(none)' },
        },
      }
    }
    case 'repo-delete-push-mirror': {
      return {
        subtitle: at || 'push mirror',
        input: {
          fields: fs(
            fin(input, 'remote-name', 'branch', 'remote', { mono: true }),
          ),
        },
        result: { fields: [] },
      }
    }
    case 'repo-remove': {
      return {
        subtitle: `${org}/${repo}`,
        input: {
          fields: fs(
            fin(input, 'org', 'building', 'org', { mono: true }),
            fin(input, 'repo', 'folder', 'repo', { mono: true }),
          ),
        },
        result: {
          fields: [
            {
              icon: 'delete',
              label: 'removed',
              value: `${org}/${repo}`,
              mono: true,
              tone: 'destructive',
            },
          ],
        },
      }
    }
    case 'repo-create-org': {
      return {
        subtitle: org,
        input: {
          fields: fs(fin(input, 'org', 'building', 'org', { mono: true })),
        },
        result: {
          fields: [{ icon: 'building', label: 'org', value: org, mono: true }],
        },
      }
    }
    case 'repo-create-repo': {
      const branch = s(data, 'default_branch') || 'main'
      return {
        subtitle: `${org}/${repo}`,
        input: {
          fields: fs(
            fin(input, 'org', 'building', 'org', { mono: true }),
            fin(input, 'repo', 'folder', 'repo', { mono: true }),
          ),
        },
        result: {
          fields: [
            {
              icon: 'branch',
              label: 'branch',
              value: branch,
              mono: true,
              tone: 'muted',
            },
          ],
          actions:
            org && repo
              ? [
                  {
                    label: `${org}/${repo}`,
                    icon: 'folder',
                    page: P.repoDetail(org, repo, branch),
                  },
                ]
              : [],
        },
      }
    }
    case 'repo-mail-send': {
      const session = s(data, 'session')
      const branch = pick(data, input, 'branch') || 'main'
      const text = pick(data, input, 'text')
      return {
        subtitle: session || (org && repo ? loc(org, repo, branch) : 'mail'),
        input: {
          fields: fs(
            fin(input, 'org', 'building', 'org', { mono: true }),
            fin(input, 'repo', 'folder', 'repo', { mono: true }),
            fin(input, 'branch', 'branch', 'branch', { mono: true }),
          ),
          body: text ? { kind: 'text', text } : undefined,
        },
        result: {
          fields: fs(
            session
              ? { icon: 'mail', label: 'to', value: session, mono: true }
              : null,
          ),
        },
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
        input: {
          fields: fs(
            fin(input, 'org', 'building', 'org', { mono: true }),
            fin(input, 'image', 'box', 'image', { mono: true }),
            fin(input, 'name', 'box', 'name', { mono: true }),
            fin(input, 'tag', 'tag', 'tag', { mono: true }),
            fin(input, 'source', 'link', 'source', { mono: true }),
            fin(input, 'dockerfile', 'file_code', 'dockerfile', { mono: true }),
            fin(input, 'context', 'folder', 'context', { mono: true }),
            fin(input, 'tag-suffix', 'tag', 'suffix', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            imageRef
              ? { icon: 'box', label: 'image', value: imageRef, mono: true }
              : null,
            tag
              ? {
                  icon: 'tag',
                  label: 'tag',
                  value: tag,
                  mono: true,
                  tone: 'muted',
                }
              : null,
            source
              ? {
                  icon: 'link',
                  label: 'source',
                  value: source,
                  mono: true,
                  tone: 'muted',
                }
              : null,
          ),
        },
      }
    }
    case 'list-oci-images': {
      const images = arr<{
        owner: string
        name: string
        tag: string
        ref?: string
      }>(data, 'images')
      return {
        subtitle: 'oci',
        input: {
          fields: fs(
            fin(input, 'owner', 'building', 'owner', { mono: true }),
            fin(input, 'name', 'box', 'name', { mono: true }),
          ),
        },
        result: {
          fields: [
            { icon: 'box', label: 'images', value: String(images.length) },
          ],
          body: images.length ? { kind: 'images', images } : undefined,
        },
      }
    }

    // ---- sandbox ----
    case 'sandbox-create':
    case 'sandbox-status': {
      const name = pick(data, input, 'name') || pick(data, input, 'worker-name')
      if (!name) return null
      return {
        subtitle: name,
        input: {
          fields: fs(
            fin(input, 'name', 'box', 'name', { mono: true }),
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
            fin(input, 'image', 'box', 'image', { mono: true }),
            fin(input, 'cpu', 'server', 'cpu', { mono: true }),
            fin(input, 'memory', 'server', 'memory', { mono: true }),
            input['kvm'] === true
              ? { icon: 'server', label: 'kvm', value: 'yes', tone: 'muted' }
              : null,
            fin(input, 'gpu-count', 'server', 'gpus', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            fres(data, 'image', 'box', 'image', { mono: true }),
            fres(data, 'phase', 'success', 'phase'),
            fres(data, 'url', 'link', 'url', { mono: true, tone: 'muted' }),
            fres(data, 'creator', 'user', 'creator', { tone: 'muted' }),
          ),
          actions: [{ label: name, icon: 'box', page: P.sandboxPage(name) }],
        },
      }
    }
    case 'sandbox-checkout': {
      if (!org || !repo) return null
      const dest = s(data, 'dest')
      const files = n(data, 'files')
      return {
        subtitle: at,
        input: {
          fields: fs(
            fin(input, 'org', 'building', 'org', { mono: true }),
            fin(input, 'repo', 'folder', 'repo', { mono: true }),
            fin(input, 'ref', 'branch', 'ref', { mono: true }),
            fin(input, 'dest', 'folder', 'dest', { mono: true }),
            input['clean'] === true
              ? { icon: 'delete', label: 'clean', value: 'yes', tone: 'muted' }
              : null,
          ),
        },
        result: {
          fields: fs(
            dest
              ? { icon: 'folder', label: 'dest', value: dest, mono: true }
              : null,
            { icon: 'file_code', label: 'files', value: String(files) },
          ),
          actions: [
            { label: at, icon: 'folder', page: P.repoDetail(org, repo, ref) },
          ],
        },
      }
    }
    case 'sandbox-port': {
      if (!org || !repo) return null
      const paths = arr<string>(data, 'paths')
      return {
        subtitle: at,
        input: {
          fields: fs(
            fin(input, 'org', 'building', 'org', { mono: true }),
            fin(input, 'repo', 'folder', 'repo', { mono: true }),
            fin(input, 'path', 'file_code', 'path', { mono: true }),
            fin(input, 'repo-path', 'file_code', 'repo-path', { mono: true }),
            fin(input, 'message', 'commit', 'message'),
          ),
        },
        result: {
          fields: fs(
            {
              icon: 'file_code',
              label: 'files',
              value: String(paths.length || n(data, 'count')),
            } as CardField,
            sha
              ? {
                  icon: 'commit',
                  label: 'commit',
                  value: short(sha),
                  mono: true,
                }
              : null,
          ),
          body: paths.length ? { kind: 'paths', paths } : undefined,
          actions: sha
            ? [
                {
                  label: short(sha),
                  icon: 'commit',
                  page: P.repoCommit(org, repo, ref, sha),
                },
              ]
            : [],
        },
      }
    }

    // ---- services ----
    case 'service-deploy':
    case 'service-preview': {
      const name = s(data, 'name') || pick(data, input, 'name')
      const ports = arr<{
        name: string
        preset: string
        port: number
        protocol: string
        targetPort: number
        publicUrl?: string
      }>(data, 'ports')
      const serviceSpecs = arr<Record<string, unknown>>(input, 'services')
      return {
        subtitle: name || 'service',
        input: {
          fields: fs(
            fin(input, 'name', 'server', 'name', { mono: true }),
            fin(input, 'image', 'box', 'image', { mono: true }),
            fin(input, 'container-port', 'server', 'port', { mono: true }),
            fin(input, 'replicas', 'server', 'replicas', { mono: true }),
            fin(input, 'cpu', 'server', 'cpu', { mono: true }),
            fin(input, 'memory', 'server', 'memory', { mono: true }),
            fin(input, 'ttl-seconds', 'clock', 'ttl', { mono: true }),
            serviceSpecs.length
              ? {
                  icon: 'server',
                  label: 'ports',
                  value: serviceSpecs.map(vstr).join(', '),
                  mono: true,
                  tone: 'muted',
                }
              : null,
          ),
        },
        result: {
          fields: fs(
            name
              ? { icon: 'server', label: 'name', value: name, mono: true }
              : null,
            fres(data, 'phase', 'success', 'phase'),
            fres(data, 'url', 'link', 'url', { mono: true, tone: 'muted' }),
            n(data, 'replicas')
              ? {
                  icon: 'server',
                  label: 'replicas',
                  value: String(n(data, 'replicas')),
                  tone: 'muted',
                }
              : null,
          ),
          body: ports.length ? { kind: 'ports', ports } : undefined,
          actions: name
            ? [{ label: name, icon: 'server', page: P.servicePage(name) }]
            : [],
        },
      }
    }
    case 'service-logs': {
      const name = s(data, 'name') || pick(data, input, 'name')
      if (!name) return null
      return {
        subtitle: name,
        input: {
          fields: fs(
            fin(input, 'name', 'server', 'name', { mono: true }),
            fin(input, 'tail-lines', 'list', 'tail', { mono: true }),
            input['previous'] === true
              ? {
                  icon: 'history',
                  label: 'previous',
                  value: 'yes',
                  tone: 'muted',
                }
              : null,
          ),
        },
        result: {
          fields: [
            {
              icon: 'terminal',
              label: 'lines',
              value: String(n(data, 'lines')),
            },
          ],
          actions: [{ label: name, icon: 'server', page: P.servicePage(name) }],
        },
      }
    }
    case 'service-delete': {
      const name = s(data, 'name') || pick(data, input, 'name')
      return {
        subtitle: name,
        input: {
          fields: fs(fin(input, 'name', 'server', 'name', { mono: true })),
        },
        result: {
          fields: [
            {
              icon: 'delete',
              label: 'deleted',
              value: name,
              mono: true,
              tone: 'destructive',
            },
          ],
        },
      }
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
      const actions: CardAction[] = []
      if (name && jobId)
        actions.push({
          label: jobId,
          icon: 'terminal',
          page: P.sandboxJobPage(name, jobId),
        })
      if (name)
        actions.push({ label: name, icon: 'box', page: P.sandboxPage(name) })
      return {
        subtitle: name || jobId || 'exec',
        input: {
          fields: fs(
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
            fin(input, 'command', 'terminal', 'command', { mono: true }),
            fin(input, 'workdir', 'folder', 'workdir', { mono: true }),
            fin(input, 'timeout', 'clock', 'timeout', { mono: true }),
            fin(input, 'job-id', 'terminal', 'job', { mono: true }),
            fin(input, 'offset', 'list', 'offset', { mono: true }),
            fin(input, 'limit', 'list', 'limit', { mono: true }),
            fin(input, 'stream', 'list', 'stream', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            jobId
              ? { icon: 'terminal', label: 'job', value: jobId, mono: true }
              : null,
            state
              ? {
                  icon: state === 'running' ? 'more' : 'success',
                  label: 'state',
                  value: state,
                  tone: state === 'running' ? 'muted' : 'success',
                }
              : null,
          ),
          body: {
            kind: 'terminal',
            command,
            text: output,
            state,
            exitCode: typeof exit === 'number' ? exit : undefined,
          },
          actions,
        },
      }
    }
    case 'sandbox-job-list': {
      const count = n(data, 'count')
      return {
        subtitle: 'jobs',
        input: { fields: [] },
        result: {
          fields: [{ icon: 'terminal', label: 'jobs', value: String(count) }],
          body: output ? { kind: 'terminal', text: output } : undefined,
        },
      }
    }
    case 'sandbox-job-kill':
    case 'sandbox-job-stdin': {
      const jobId = pick(data, input, 'job-id')
      const dataText = pick(data, input, 'data')
      return {
        subtitle: jobId,
        input: {
          fields: fs(
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
            fin(input, 'job-id', 'terminal', 'job', { mono: true }),
            input['close'] === true
              ? { icon: 'delete', label: 'close', value: 'yes', tone: 'muted' }
              : null,
          ),
          body: dataText ? { kind: 'text', text: dataText } : undefined,
        },
        result: { fields: [] },
      }
    }

    // ---- sandbox files ----
    case 'sandbox-file-read': {
      const path = pick(data, input, 'path')
      const total = n(data, 'total_lines')
      const start = n(data, 'start')
      const shown = n(data, 'shown')
      const range =
        total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
      return {
        subtitle: path || 'read',
        input: {
          fields: fs(
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
            fin(input, 'path', 'file_code', 'path', { mono: true }),
            fin(input, 'offset', 'list', 'offset', { mono: true }),
            fin(input, 'limit', 'list', 'limit', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            range
              ? { icon: 'list', label: 'lines', value: range, mono: true }
              : null,
          ),
          body: {
            kind: 'code',
            name: path.split('/').pop() || path,
            text: stripLineNumbers(output),
          },
        },
      }
    }
    case 'sandbox-file-write':
    case 'sandbox-file-edit': {
      const path = pick(data, input, 'path')
      const added = n(data, 'added')
      const removed = n(data, 'removed')
      const content = pick(data, input, 'content')
      const d = s(data, 'diff')
      return {
        subtitle: path || tool,
        input: {
          fields: fs(
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
            fin(input, 'path', 'file_code', 'path', { mono: true }),
            ...(tool === 'sandbox-file-edit'
              ? [
                  fin(input, 'start-line', 'list', 'start', { mono: true }),
                  fin(input, 'end-line', 'list', 'end', { mono: true }),
                ]
              : []),
          ),
          body: content ? { kind: 'text', text: content } : undefined,
        },
        result: {
          fields: fs(
            added || removed
              ? {
                  icon: 'diff',
                  label: 'changes',
                  value: `+${added} −${removed}`,
                  mono: true,
                  tone: diffTone(added, removed),
                }
              : null,
            n(data, 'lines')
              ? {
                  icon: 'list',
                  label: 'lines',
                  value: String(n(data, 'lines')),
                  tone: 'muted',
                }
              : null,
          ),
          body: d ? { kind: 'diff', diff: d } : undefined,
        },
      }
    }
    case 'sandbox-file-ls': {
      const path = pick(data, input, 'path')
      const entries = arr<{
        path: string
        depth: number
        type: string
        size: number
      }>(data, 'entries')
      return {
        subtitle: path || '/',
        input: {
          fields: fs(
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
            fin(input, 'path', 'folder', 'path', { mono: true }),
            fin(input, 'depth', 'list', 'depth', { mono: true }),
            fin(input, 'limit', 'list', 'limit', { mono: true }),
          ),
        },
        result: {
          fields: [
            {
              icon: 'folder',
              label: 'entries',
              value: String(entries.length || n(data, 'rows')),
            },
          ],
          body: entries.length ? { kind: 'tree', rows: entries } : undefined,
        },
      }
    }
    case 'sandbox-file-rm': {
      const path = pick(data, input, 'path')
      return {
        subtitle: path || 'rm',
        input: {
          fields: fs(
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
            fin(input, 'path', 'file_code', 'path', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            data['deleted'] === true
              ? {
                  icon: 'delete',
                  label: 'deleted',
                  value: path,
                  mono: true,
                  tone: 'destructive',
                }
              : null,
          ),
        },
      }
    }
    case 'sandbox-info': {
      return {
        subtitle: 'sandbox',
        input: {
          fields: fs(
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            s(data, 'os')
              ? {
                  icon: 'server',
                  label: 'os',
                  value: `${s(data, 'os')}/${s(data, 'arch')}`,
                }
              : null,
            fres(data, 'shell', 'terminal', 'shell', { mono: true }),
            fres(data, 'workspace', 'folder', 'workspace', { mono: true }),
            fres(data, 'url', 'link', 'url', { mono: true, tone: 'muted' }),
          ),
        },
      }
    }
    case 'sandbox-file-download':
    case 'sandbox-file-upload': {
      const path = pick(data, input, 'path')
      const code = s(data, 'code')
      return {
        subtitle: path || code || tool,
        input: {
          fields: fs(
            fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
            fin(input, 'code', 'file', 'code', { mono: true }),
            fin(input, 'path', 'file_code', 'path', { mono: true }),
            fin(input, 'name', 'file', 'name', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            code
              ? {
                  icon: 'file',
                  label: 'code',
                  value: code,
                  mono: true,
                  tone: 'muted',
                }
              : null,
          ),
        },
      }
    }

    // ---- workspace lists ----
    case 'service-list': {
      const services = arr<{
        name: string
        phase: string
        image: string
        url: string
        session: string
        publicUrl: string
      }>(data, 'services')
      return {
        subtitle: 'services',
        input: { fields: [] },
        result: {
          fields: [
            {
              icon: 'server',
              label: 'services',
              value: String(services.length),
            },
          ],
          body: services.length
            ? {
                kind: 'list',
                rows: services.map(s => ({
                  label: s.name,
                  sub: `${s.phase}${s.publicUrl ? ` · ${s.publicUrl}` : s.url ? ` · ${s.url}` : ''}`,
                  icon: 'server',
                  tone: s.phase === 'Running' ? 'success' : 'muted',
                  link: P.servicePage(s.name),
                })),
              }
            : undefined,
        },
      }
    }
    case 'sandbox-list': {
      const sandboxes = arr<{
        name: string
        phase: string
        image: string
        url: string
        creator: string
        session: string
      }>(data, 'sandboxes')
      return {
        subtitle: 'sandboxes',
        input: { fields: [] },
        result: {
          fields: [
            {
              icon: 'box',
              label: 'sandboxes',
              value: String(sandboxes.length),
            },
          ],
          body: sandboxes.length
            ? {
                kind: 'list',
                rows: sandboxes.map(s => ({
                  label: s.name,
                  sub: `${s.phase}${s.image ? ` · ${s.image}` : ''}`,
                  icon: 'box',
                  tone: s.phase === 'Running' ? 'success' : 'muted',
                  link: P.sandboxPage(s.name),
                })),
              }
            : undefined,
        },
      }
    }

    // ---- bundled: history (data.entries) ----
    case 'history-search':
    case 'history-range': {
      const entries = arr<{
        role: string
        content: string
        tool_name?: string
        change_id?: string
        created_at?: string
        depth?: number
      }>(data, 'entries')
      return {
        subtitle: 'history',
        input: {
          fields: fs(
            fin(input, 'query', 'search', 'query'),
            fin(input, 'start', 'clock', 'start'),
            fin(input, 'end', 'clock', 'end'),
            fin(input, 'limit', 'list', 'limit', { mono: true }),
          ),
        },
        result: {
          fields: [
            {
              icon: 'history',
              label: 'entries',
              value: String(entries.length),
            },
          ],
          body: entries.length ? { kind: 'messages', entries } : undefined,
        },
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
        input: {
          fields: fs(fin(input, 'code', 'file', 'code', { mono: true })),
        },
        result: {
          fields: fs(
            s(data, 'code')
              ? {
                  icon: 'file',
                  label: 'code',
                  value: s(data, 'code'),
                  mono: true,
                  tone: 'muted',
                }
              : null,
          ),
          body: rows.length ? { kind: 'kv', rows } : undefined,
        },
      }
    }
    case 'file-read': {
      const name =
        s(data, 'name') ||
        pick(data, input, 'name') ||
        pick(data, input, 'code')
      const total = n(data, 'total_lines')
      const start = n(data, 'start')
      const shown = n(data, 'shown')
      const range =
        total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
      return {
        subtitle: name,
        input: {
          fields: fs(
            fin(input, 'code', 'file', 'code', { mono: true }),
            fin(input, 'name', 'file_code', 'name', { mono: true }),
            fin(input, 'offset', 'list', 'offset', { mono: true }),
            fin(input, 'limit', 'list', 'limit', { mono: true }),
          ),
        },
        result: {
          fields: fs(
            range
              ? { icon: 'list', label: 'lines', value: range, mono: true }
              : null,
          ),
          body: {
            kind: 'code',
            name: name.split('/').pop() || name,
            text: stripLineNumbers(output),
          },
        },
      }
    }

    // ---- bundled: web-fetch (rendered markdown ONLY here) ----
    case 'web-fetch': {
      const url = s(data, 'url') || pick(data, input, 'url')
      const format = s(data, 'format') || pick(data, input, 'format')
      const ctype = s(data, 'contentType')
      return {
        subtitle: url,
        input: {
          fields: fs(
            fin(input, 'url', 'link', 'url', { mono: true, tone: 'muted' }),
            fin(input, 'format', 'list', 'format', { tone: 'muted' }),
          ),
        },
        result: {
          fields: fs(
            ctype
              ? {
                  icon: 'file',
                  label: 'type',
                  value: ctype,
                  mono: true,
                  tone: 'muted',
                }
              : null,
            format
              ? { icon: 'list', label: 'format', value: format, tone: 'muted' }
              : null,
          ),
          body: { kind: 'markdown', text: output },
        },
      }
    }

    // ---- bundled: audio (transcribe / tts) ----
    case 'audio-transcribe': {
      const code = pick(data, input, 'code')
      return {
        subtitle: s(data, 'name') || code || 'audio',
        input: {
          fields: fs(
            fin(input, 'code', 'file', 'code', { mono: true, tone: 'muted' }),
          ),
        },
        result: {
          fields: fs(
            s(data, 'name')
              ? { icon: 'file', label: 'name', value: s(data, 'name') }
              : null,
            fres(data, 'model', 'server', 'model', {
              mono: true,
              tone: 'muted',
            }),
          ),
          body: code
            ? { kind: 'audio', code, caption: output }
            : { kind: 'text', text: output },
        },
      }
    }
    case 'tts-generate':
    case 'tts-clone': {
      const files = arr<{ code: string; mime: string; name: string }>(
        data,
        'files',
      )
      const first = files[0]
      const text = pick(data, input, 'text')
      return {
        subtitle: 'tts',
        input: {
          fields: fs(
            fin(input, 'model', 'server', 'model', {
              mono: true,
              tone: 'muted',
            }),
            fin(input, 'reference', 'file', 'reference', {
              mono: true,
              tone: 'muted',
            }),
            fin(input, 'code', 'file', 'code', { mono: true, tone: 'muted' }),
          ),
          body: text ? { kind: 'text', text } : undefined,
        },
        result: {
          fields: fs(
            fres(data, 'model', 'server', 'model', {
              mono: true,
              tone: 'muted',
            }),
            fres(data, 'reference', 'file', 'reference', {
              mono: true,
              tone: 'muted',
            }),
          ),
          body: first?.code
            ? { kind: 'audio', code: first.code, caption: text }
            : undefined,
        },
      }
    }

    // ---- bundled: image-read ----
    case 'image-read': {
      const code = pick(data, input, 'code')
      return {
        subtitle: s(data, 'name') || code || 'image',
        input: {
          fields: fs(
            fin(input, 'code', 'file', 'code', { mono: true, tone: 'muted' }),
          ),
        },
        result: {
          fields: fs(
            s(data, 'name')
              ? { icon: 'file', label: 'name', value: s(data, 'name') }
              : null,
            fres(data, 'model', 'server', 'model', {
              mono: true,
              tone: 'muted',
            }),
          ),
          body: code
            ? {
                kind: 'media',
                code,
                mime: s(data, 'mime') || undefined,
                caption: output,
              }
            : { kind: 'text', text: output },
        },
      }
    }

    // ---- bundled: generation (files rendered by MediaAttachment already) ----
    case 'image-generate':
    case 'image-edit':
    case 'video-generate': {
      return {
        subtitle: tool,
        input: {
          fields: fs(
            fin(input, 'prompt', 'sparkles', 'prompt'),
            fin(input, 'source', 'file', 'source', {
              mono: true,
              tone: 'muted',
            }),
            fin(input, 'code', 'file', 'code', { mono: true, tone: 'muted' }),
          ),
        },
        result: {
          fields: fs(
            fres(data, 'model', 'server', 'model', {
              mono: true,
              tone: 'muted',
            }),
            fres(data, 'source', 'file', 'source', {
              mono: true,
              tone: 'muted',
            }),
          ),
        },
      }
    }

    // ---- bundled: cross-session ----
    case 'subsession-create': {
      const name = s(data, 'name') || pick(data, input, 'name')
      const desc = s(data, 'description') || pick(data, input, 'description')
      const prompt = pick(data, input, 'prompt')
      return {
        subtitle: name || 'subsession',
        input: {
          fields: fs(
            fin(input, 'name', 'bot', 'session', { mono: true }),
            fin(input, 'description', 'info', 'label'),
          ),
          body: prompt ? { kind: 'text', text: prompt } : undefined,
        },
        result: {
          fields: fs(
            name
              ? { icon: 'bot', label: 'session', value: name, mono: true }
              : null,
            desc ? { icon: 'info', label: 'label', value: desc } : null,
          ),
        },
      }
    }
    case 'mail-send': {
      const to = s(data, 'to') || pick(data, input, 'to')
      const text = s(data, 'text') || pick(data, input, 'text')
      return {
        subtitle: to || 'mail',
        input: {
          fields: fs(fin(input, 'to', 'mail', 'to', { mono: true })),
          body: text ? { kind: 'text', text } : undefined,
        },
        result: {
          fields: fs(
            to ? { icon: 'mail', label: 'to', value: to, mono: true } : null,
          ),
        },
      }
    }

    // ---- bundled: brave-search (results only when upstream adds data.results) ----
    case 'brave-search': {
      const results = arr<{ title: string; url: string; description?: string }>(
        data,
        'results',
      )
      const query = s(data, 'query') || pick(data, input, 'query')
      return {
        subtitle: query || 'search',
        input: {
          fields: fs(fin(input, 'query', 'search', 'query')),
        },
        result: {
          fields: [
            { icon: 'list', label: 'results', value: String(results.length) },
          ],
          body: results.length
            ? {
                kind: 'list',
                rows: results.map(r => ({
                  label: r.title || r.url,
                  sub: r.description || r.url,
                  icon: 'link',
                })),
              }
            : undefined,
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
