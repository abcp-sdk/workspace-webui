// Cross-platform path helpers for the sandbox file browser. Ported from the
// worker's own control panel (`worker/webui/src/lib/paths.ts`) with the
// anchors corrected: `workspace` and `home` are DISTINCT — `home` is the OS
// `~` (e.g. /root) and `workspace` (e.g. /root/workspace) lives under it.
//
// The worker reports paths in SLASH form (Windows backslashes converted).
// Three anchors matter:
//   - the WORKSPACE (relative paths resolve here)
//   - the HOME (the OS `~`)
//   - the filesystem ROOT (unix `/`, Windows a drive like `C:`)

export interface Anchors {
  /** Absolute workspace root, slash form (e.g. /root/workspace or C:/app). */
  workspace: string
  /** Absolute home dir, slash form (e.g. /root); '' when unknown. */
  home: string
}

let anchors: Anchors = { workspace: '', home: '' }

export function setSandboxAnchors(a: Partial<Anchors>) {
  anchors = {
    workspace: a.workspace ?? anchors.workspace,
    home: a.home ?? anchors.home,
  }
}

export function sandboxAnchors(): Anchors {
  return anchors
}

/** Split a leading Windows drive (`C:`) from the rest of a slash path. */
function splitDrive(p: string): [string, string] {
  const m = /^([A-Za-z]:)(\/.*)?$/.exec(p)
  if (m) return [m[1]!.toUpperCase(), m[2] ?? '/']
  return ['', p]
}

/** Collapse //, ., .. in an absolute path, preserving a drive prefix. `..` at
 *  the root stays at the root. Backslashes are normalized. */
export function normAbs(p: string): string {
  const [drive, rest] = splitDrive(String(p).replace(/\\/g, '/'))
  const parts: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length) parts.pop()
      continue
    }
    parts.push(seg)
  }
  return `${drive}/${parts.join('/')}`
}

/** The filesystem root of `abs` (`/` on unix, `C:/` on Windows). */
export function rootOf(abs: string): string {
  const [drive] = splitDrive(abs)
  return `${drive}/`
}

/** True when `abs` equals `base` or is under it (both absolute, normalized). */
function under(abs: string, base: string): boolean {
  if (!base) return false
  return abs === base || abs.startsWith(`${base}/`)
}

/** Resolve a worker path to an absolute one: absolute / drive-absolute is
 *  used as-is; a relative path (or '', '.', '~') is anchored. `~` and `~/x`
 *  resolve against the HOME (the OS `~`), NOT the workspace. */
export function absOf(p: string): string {
  const s = String(p ?? '').trim()
  if (s === '' || s === '.') return anchors.workspace || '/'
  if (s === '~') return anchors.home || anchors.workspace || '/'
  if (s === '~/') return anchors.home || anchors.workspace || '/'
  if (s.startsWith('~/'))
    return normAbs(`${anchors.home || anchors.workspace}/${s.slice(2)}`)
  if (/^[A-Za-z]:/.test(s)) return normAbs(s)
  if (s.startsWith('/')) return normAbs(rootOf(anchors.workspace || '/') + s)
  return normAbs(`${anchors.workspace || '/'}/${s}`)
}

/** Human display: HOME shows as `~`; the workspace shows as `~/<name>` (the
 *  workspace name relative to home) or `~/workspace`; anything under either is
 *  shortened; anything else stays absolute. */
export function displayPath(abs: string): string {
  const home = anchors.home
  const ws = anchors.workspace
  if (home && abs === home) return '~'
  if (home && abs.startsWith(`${home}/`))
    return `~/${abs.slice(home.length + 1)}`
  if (ws && abs === ws) {
    // Prefer the home-relative form (~/workspace) when the workspace is under
    // home; else fall back to the bare name.
    if (home && ws.startsWith(`${home}/`))
      return `~/${ws.slice(home.length + 1)}`
    return ws.split('/').pop() || ws
  }
  return abs
}

/** Breadcrumb segments for an absolute dir. The first crumb is `~` (home) when
 *  inside home, else the filesystem root (`/` or `C:/`). */
export function crumbsOf(abs: string): { name: string; path: string }[] {
  const home = anchors.home
  if (home && under(abs, home)) {
    const out = [{ name: '~', path: home }]
    const rel = abs === home ? '' : abs.slice(home.length + 1)
    const parts = rel.split('/').filter(Boolean)
    let cur = home
    for (const seg of parts) {
      cur = `${cur}/${seg}`
      out.push({ name: seg, path: cur })
    }
    return out
  }
  // Not under home: anchor on the filesystem root.
  const root = rootOf(abs)
  const out = [{ name: root, path: root }]
  const rel = abs === root ? '' : abs.slice(root.length)
  const parts = rel.split('/').filter(Boolean)
  let cur = root.replace(/\/$/, '')
  for (const seg of parts) {
    cur = `${cur}/${seg}`
    out.push({ name: seg, path: cur })
  }
  return out
}

/** The parent directory of a path ('' when already at a root). */
export function parentOf(abs: string): string {
  const root = rootOf(abs)
  if (abs === root) return ''
  const [drive, rest] = splitDrive(abs)
  const parts = rest.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `${drive}/${parts.join('/')}` : root
}

/** Basename of a slash path. */
export function basename(p: string): string {
  const s = String(p).replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  return i === -1 ? s : s.slice(i + 1)
}
