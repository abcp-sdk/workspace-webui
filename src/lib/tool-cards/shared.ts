// Shared types + small readers for the tool-card registry. The registry is
// split by domain (repo / images / sandbox / bundled); every domain handler
// receives a {@link CardCtx} built once from the tool call.
import type { AppPage } from '../nav'

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
  // Terminal-style INPUT: a `$ command` line (workdir/timeout shown as chrome).
  // Used by the job/exec tools so their arguments read like a shell invocation.
  | { kind: 'command'; command: string; workdir?: string; timeout?: string }
  // Source with line numbers + Shiki (reuses CodeSurface). `startLine` is the
  // ABSOLUTE number of the first line (1 for a whole file, `offset+1` for a
  // windowed read) so the gutter shows the true line numbers.
  | { kind: 'code'; name: string; text: string; startLine?: number }
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

export type Data = Record<string, unknown>

/** A domain handler: builds a card, or null when this tool is not its concern. */
export type CardHandler = (c: CardCtx) => CardSpec | null

/** Everything a handler needs, derived once from the call. */
export interface CardCtx {
  /** Bare tool name (extension qualifier stripped). */
  tool: string
  data: Data
  input: Data
  /** Result text (terminal/code/markdown bodies read it). */
  output: string
  org: string
  repo: string
  ref: string
  path: string
  sha: string
  index: number
  /** `org/repo @ ref` ('' when org/repo is unknown). */
  at: string
}

// ---- small readers ----
export function s(d: Data, k: string): string {
  const v = d[k]
  return typeof v === 'string' ? v : ''
}
export function n(d: Data, k: string): number {
  const v = d[k]
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v) || 0
  return 0
}
export function arr<T>(d: Data, k: string): T[] {
  const v = d[k]
  return Array.isArray(v) ? (v as T[]) : []
}
/** Prefer `data`, fall back to the raw `input`. */
export function pick(data: Data, input: Data, k: string): string {
  return s(data, k) || s(input, k)
}
export function short(sha: string): string {
  return sha.length > 8 ? sha.slice(0, 8) : sha
}
/** The parent directory of a worker path (slash form). '' when already at a
 *  root (or the input is empty). Preserves a leading '/'. */
export function parentOfPath(p: string): string {
  const s = (p || '').replace(/\/+$/, '')
  if (s === '' || s === '/' || /^[A-Za-z]:$/.test(s)) return s
  const i = s.lastIndexOf('/')
  if (i === -1) return ''
  if (i === 0) return '/'
  return s.slice(0, i)
}
export function loc(org: string, repo: string, ref: string): string {
  return `${org}/${repo}${ref ? ` @ ${ref}` : ''}`
}
/** The last path segment ('' for an empty path). */
export function basename(p: string): string {
  return p.split('/').pop() || p
}

/** Render any JSON value as a compact single-line string. */
export function vstr(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export const diffTone = (a: number, d: number): CardField['tone'] =>
  d > 0 ? 'destructive' : a > 0 ? 'success' : 'muted'

// ---- field builders (input vs result) ----

/** A field from the call ARGUMENTS (`input`); null when absent/empty. */
export function fin(
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
export function fres(
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
export function fs(...xs: Array<CardField | null>): CardField[] {
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

/** Strip a leading `N\t` / `N  ` line-number gutter from read output. */
export function stripLineNumbers(text: string): string {
  return text
    .split('\n')
    .map(l => l.replace(/^\s*\d+\s{2,}/, '').replace(/^\s*\d+\t/, ''))
    .join('\n')
}
