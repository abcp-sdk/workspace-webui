// Role model — the five immutable session roles (presets) of the workspace
// gateway. A session's role decides ONLY what it may do (tools); visibility is
// always the whole tenant. Free roles (admin/planner/explorer) are not bound to
// a repo/branch; maintainer/developer ARE (branch = identity).
//
//   admin      tenant   create org/repo, read everything, no sandbox
//   explorer   tenant   read every repo (no sandbox, no writes)
//   planner    tenant   read + sandbox, no git writes
//   maintainer org:repo:main      review/merge MRs, branches, releases, sandbox
//   developer  org:repo:<branch>  write its branch, open MRs, sandbox
import type { Workspace } from './api'
import { AppIcons } from './icons'

export type Role = 'admin' | 'explorer' | 'planner' | 'maintainer' | 'developer'

/** The five roles in display order (free roles first). */
export const ROLES: Role[] = [
  'admin',
  'explorer',
  'planner',
  'maintainer',
  'developer',
]

/** Free roles: not bound to a repo/branch, any number may exist. */
export const FREE_ROLES: Role[] = ['admin', 'explorer', 'planner']

/** Branch-bound roles: exactly one session per (repo, branch). */
export const BRANCH_ROLES: Role[] = ['maintainer', 'developer']

export function isFreeRole(r: string): boolean {
  return r === 'admin' || r === 'explorer' || r === 'planner'
}

export function isBranchRole(r: string): boolean {
  return r === 'maintainer' || r === 'developer'
}

/** Role of a workspace row; free sessions carry the role explicitly. */
export function workspaceRole(w: Workspace): string {
  return w.role
}

/**
 * Resolve a session's role. Workspace rows carry it explicitly (the gateway
 * stored it); for a raw agent session fall back to the branch-derived rule
 * (`main` = maintainer, else developer) and `''` when neither.
 */
export function roleOfSession(s: {
  preset: string
  org: string
  branch: string
}): string {
  if (s.preset) return s.preset
  if (!s.org) return ''
  return s.branch === 'main' ? 'maintainer' : 'developer'
}

type IconComponent = typeof AppIcons.shield

export function roleIcon(r: string): IconComponent {
  switch (r) {
    case 'admin':
      return AppIcons.shield
    case 'explorer':
      return AppIcons.compass
    case 'planner':
      return AppIcons.flask
    case 'maintainer':
      return AppIcons.merge
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
    case 'planner':
      return 'rolePlanner'
    case 'maintainer':
      return 'roleMaintainer'
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
    case 'planner':
      return 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
    case 'maintainer':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    case 'developer':
      return 'bg-primary/15 text-primary'
    default:
      return 'bg-muted text-muted-foreground'
  }
}
