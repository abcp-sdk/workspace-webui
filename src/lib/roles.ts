// Role model — the three immutable session roles (presets) of the workspace
// gateway. A session's role decides ONLY what it may do (tools); visibility is
// always the whole tenant. Free roles (admin/explorer) are not bound to a
// repo/branch; developer IS (branch = identity).
//
//   admin      tenant          create org/repo, read everything, sandbox
//   explorer   tenant          read every repo (sandbox, no writes)
//   developer  org:repo:<branch>  edit in a sandbox, submit/merge MRs
//
// All branch sessions (main included) share the SAME developer role; what an MR
// may be merged into depends on the MR's base, not the session's branch.
import type { BranchSession } from './api'
import { AppIcons } from './icons'

export type Role = 'admin' | 'explorer' | 'developer'

/** The roles in display order (free roles first). */
export const ROLES: Role[] = ['admin', 'explorer', 'developer']

/** Free roles: not bound to a repo/branch, any number may exist. */
export const FREE_ROLES: Role[] = ['admin', 'explorer']

/** Branch-bound roles: exactly one session per (repo, branch). */
export const BRANCH_ROLES: Role[] = ['developer']

export function isFreeRole(r: string): boolean {
  return r === 'admin' || r === 'explorer'
}

export function isBranchRole(r: string): boolean {
  return r === 'developer'
}

/** Role of a workspace row; free sessions carry the role explicitly. */
export function workspaceRole(w: BranchSession): string {
  return w.role
}

/**
 * Resolve a session's role. Workspace rows carry it explicitly (the gateway
 * stored it); for a raw agent session fall back to `developer` when it is bound
 * to a repo/branch and `''` otherwise.
 */
export function roleOfSession(s: {
  preset: string
  org: string
  branch: string
}): string {
  if (s.preset) return s.preset
  if (!s.org) return ''
  return 'developer'
}

type IconComponent = typeof AppIcons.shield

export function roleIcon(r: string): IconComponent {
  switch (r) {
    case 'admin':
      return AppIcons.shield
    case 'explorer':
      return AppIcons.compass
    case 'developer':
      return AppIcons.code
    default:
      return AppIcons.bot
  }
}

/** Static, non-reactive role label (i18n is resolved by the caller when it
 *  needs localization; this keeps the helper rune-free). */
export function roleLabelKey(r: string): string {
  switch (r) {
    case 'admin':
      return 'roleAdmin'
    case 'explorer':
      return 'roleExplorer'
    case 'developer':
      return 'roleDeveloper'
    default:
      return 'roleUnknown'
  }
}

/** Tailwind classes for a role chip. */
export function roleTone(r: string): string {
  switch (r) {
    case 'admin':
      return 'bg-destructive/12 text-destructive'
    case 'explorer':
      return 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
    case 'developer':
      return 'bg-primary/15 text-primary'
    default:
      return 'bg-muted text-muted-foreground'
  }
}
