// Helm tool cards: deploy / list / history / rollback / uninstall and the
// blue-green promote/rollback-release actions. Split out of the sandbox cards
// so the release surface stays self-contained.
import * as P from '../tool-pages'
import {
  arr,
  type CardAction,
  type CardField,
  type CardHandler,
  fin,
  fres,
  fs,
  n,
  pick,
  s,
} from './shared'

/** One slot of a blue-green Helm release. */
interface Slot {
  slot: string
  release?: string
  ready: boolean
  ready_workload?: number
  total_workload?: number
}

/** Render the blue-green slot list as `blue*(2/2) green(1/2)`. */
function slotValue(r: { active_slot?: string; slots?: Slot[] }): string {
  return (r.slots ?? [])
    .map(
      sl =>
        `${sl.slot}${sl.slot === r.active_slot ? '*' : ''}(${sl.ready_workload ?? 0}/${sl.total_workload ?? 0})`,
    )
    .join(' ')
}

const helmDeploy: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'helm-deploy') return null
  const release = s(data, 'name') || pick(data, input, 'release')
  const objects = arr<string>(data, 'objects')
  const slots = arr<Slot>(data, 'slots')
  const activeSlot = s(data, 'active_slot')
  const fields: CardField[] = fs(
    fin(input, 'org', 'building', 'org', { mono: true }),
    fin(input, 'repo', 'book', 'repo', { mono: true }),
    fin(input, 'ref', 'branch', 'ref', { mono: true }),
    fin(input, 'chart-path', 'file_code', 'chart', { mono: true }),
    fin(input, 'slot', 'layers', 'slot', { mono: true }),
    data['dry_run'] === true
      ? { icon: 'eye', label: 'mode', value: 'dry-run', tone: 'muted' }
      : null,
  )
  const resultFields: CardField[] = fs(
    release
      ? { icon: 'pkg', label: 'release', value: release, mono: true }
      : null,
    n(data, 'revision') > 0
      ? {
          icon: 'history',
          label: 'revision',
          value: `rev${n(data, 'revision')}`,
          mono: true,
        }
      : null,
    fres(data, 'status', 'success', 'status'),
    slots.length
      ? {
          icon: 'layers',
          label: 'slots',
          value: slotValue({ active_slot: activeSlot, slots }),
          mono: true,
        }
      : null,
    objects.length
      ? {
          icon: 'container',
          label: 'objects',
          value: String(objects.length),
          tone: 'muted',
        }
      : null,
  )
  return {
    subtitle: release ? `helm · ${release}` : 'helm-deploy',
    input: { fields },
    result: {
      fields: resultFields,
      body: objects.length
        ? {
            kind: 'list',
            rows: objects.map(o => ({ label: o, icon: 'container' })),
          }
        : undefined,
    },
  }
}

const helmList: CardHandler = ({ tool, data }) => {
  if (tool !== 'helm-list') return null
  const releases = arr<{
    name: string
    revision: number
    status: string
    ref: string
    chart_path: string
    session?: string
    active_slot?: string
    slots?: Slot[]
  }>(data, 'releases')
  return {
    subtitle: 'helm releases',
    input: { fields: [] },
    result: {
      fields: [
        {
          icon: 'pkg',
          label: 'releases',
          value: String(releases.length || n(data, 'count')),
        },
      ],
      body: releases.length
        ? {
            kind: 'list',
            rows: releases.map(r => ({
              label: r.name,
              sub: `rev${r.revision} · ${r.status} · ${r.chart_path || '.'}@${r.ref || 'HEAD'}${(r.slots ?? []).length ? ` · ${slotValue(r)}` : ''}`,
              icon: 'pkg',
              tone:
                r.status === 'deployed'
                  ? ('success' as const)
                  : ('destructive' as const),
            })),
          }
        : undefined,
    },
  }
}

const helmHistory: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'helm-history') return null
  const release = s(data, 'release') || pick(data, input, 'release')
  const revisions = arr<{
    revision: number
    ref: string
    chart_path: string
    objects: string[]
  }>(data, 'revisions')
  return {
    subtitle: release ? `helm · ${release}` : 'helm-history',
    input: {
      fields: fs(fin(input, 'release', 'pkg', 'release', { mono: true })),
    },
    result: {
      fields: [
        {
          icon: 'history',
          label: 'revisions',
          value: String(revisions.length),
        },
      ],
      body: revisions.length
        ? {
            kind: 'list',
            rows: revisions.map(r => ({
              label: `rev${r.revision}`,
              sub: `${r.chart_path || '.'}@${r.ref || 'HEAD'} · ${(r.objects ?? []).join(', ')}`,
              icon: 'history',
            })),
          }
        : undefined,
    },
  }
}

/** The promote / rollback-release / rollback / uninstall single-action cards. */
const helmAction: CardHandler = ({ tool, data, input }) => {
  const actions: Record<string, string> = {
    'helm-promote': 'promote',
    'helm-rollback-release': 'rollback-release',
    'helm-rollback': 'rollback',
    'helm-uninstall': 'uninstall',
  }
  const action = actions[tool]
  if (action === undefined) return null
  const release =
    s(data, 'release') || s(data, 'name') || pick(data, input, 'release')
  const fields: CardField[] = fs(
    fin(input, 'release', 'pkg', 'release', { mono: true }),
    fin(input, 'revision', 'history', 'revision', { mono: true }),
    fin(input, 'force', 'bolt', 'force'),
    s(data, 'active_slot')
      ? {
          icon: 'layers',
          label: 'active slot',
          value: s(data, 'active_slot'),
          mono: true,
        }
      : null,
    n(data, 'revision') > 0
      ? {
          icon: 'history',
          label: 'revision',
          value: `rev${n(data, 'revision')}`,
          mono: true,
        }
      : null,
    data['deleted'] === true
      ? {
          icon: 'delete',
          label: 'deleted',
          value: release,
          mono: true,
          tone: 'destructive',
        }
      : null,
  )
  const cardActions: CardAction[] = release
    ? [{ label: release, icon: 'pkg', page: P.servicePage(release) }]
    : []
  return {
    subtitle: `${action} · ${release || 'helm'}`,
    input: {
      fields: fs(fin(input, 'release', 'pkg', 'release', { mono: true })),
    },
    result: { fields, actions: cardActions },
  }
}

/** Helm handlers, in match order. */
export const helmHandlers: CardHandler[] = [
  helmDeploy,
  helmList,
  helmHistory,
  helmAction,
]
