// Sandbox cards: lifecycle, checkout/port, services, job execution, files and
// the workspace lists. Split out of the monolithic registry.
import * as P from '../tool-pages'
import {
  arr,
  basename,
  type CardAction,
  type CardCtx,
  type CardField,
  type CardHandler,
  diffTone,
  fin,
  fres,
  fs,
  n,
  parentOfPath,
  pick,
  s,
  short,
  stripLineNumbers,
  vstr,
} from './shared'

const sandboxCreate: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'sandbox-create' && tool !== 'sandbox-status') return null
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

const sandboxCheckout: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  ref,
  at,
}) => {
  if (tool !== 'sandbox-checkout' || !org || !repo) return null
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

const sandboxPort: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  ref,
  sha,
  at,
}) => {
  if (tool !== 'sandbox-port' || !org || !repo) return null
  const paths = arr<string>(data, 'paths')
  const added = n(data, 'added')
  const removed = n(data, 'removed')
  const diff = s(data, 'diff')
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
        added || removed
          ? {
              icon: 'diff',
              label: 'changes',
              value: `+${added} −${removed}`,
              mono: true,
              tone: diffTone(added, removed),
            }
          : null,
        sha
          ? { icon: 'commit', label: 'commit', value: short(sha), mono: true }
          : null,
      ),
      // Prefer the unified diff (green/red); fall back to the plain path list
      // (e.g. a binary-only port, which has no textual diff).
      body: diff
        ? { kind: 'diff', diff }
        : paths.length
          ? { kind: 'paths', paths }
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

const serviceDeploy: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'service-deploy' && tool !== 'service-preview') return null
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

const serviceLogs: CardHandler = ({ tool, data, input, output }) => {
  if (tool !== 'service-logs') return null
  const name = s(data, 'name') || pick(data, input, 'name')
  if (!name) return null
  return {
    subtitle: name,
    input: {
      fields: fs(
        fin(input, 'name', 'server', 'name', { mono: true }),
        fin(input, 'tail-lines', 'list', 'tail', { mono: true }),
        input['previous'] === true
          ? { icon: 'history', label: 'previous', value: 'yes', tone: 'muted' }
          : null,
      ),
    },
    result: {
      fields: [
        { icon: 'terminal', label: 'lines', value: String(n(data, 'lines')) },
      ],
      // The actual log text (the output carries a header line + the log lines).
      body: output ? { kind: 'terminal', text: output } : undefined,
      actions: [{ label: name, icon: 'server', page: P.servicePage(name) }],
    },
  }
}

const serviceDelete: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'service-delete') return null
  const name = s(data, 'name') || pick(data, input, 'name')
  return {
    subtitle: name,
    input: { fields: fs(fin(input, 'name', 'server', 'name', { mono: true })) },
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

const sandboxExec: CardHandler = ({ tool, data, input, output }) => {
  if (
    tool !== 'sandbox-exec' &&
    tool !== 'sandbox-job-start' &&
    tool !== 'sandbox-job-output' &&
    tool !== 'sandbox-job-wait'
  ) {
    return null
  }
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
      // The command reads like a terminal invocation; the other args stay fields.
      fields: fs(
        fin(input, 'worker-name', 'box', 'sandbox', { mono: true }),
        fin(input, 'job-id', 'terminal', 'job', { mono: true }),
        fin(input, 'offset', 'list', 'offset', { mono: true }),
        fin(input, 'limit', 'list', 'limit', { mono: true }),
        fin(input, 'stream', 'list', 'stream', { mono: true }),
      ),
      body: command
        ? {
            kind: 'command',
            command,
            workdir: pick(data, input, 'workdir') || undefined,
            timeout: s(input, 'timeout') || undefined,
          }
        : undefined,
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

const sandboxJobList: CardHandler = ({ tool, data, input, output }) => {
  if (tool !== 'sandbox-job-list') return null
  const sandbox = pick(data, input, 'worker-name')
  const jobs = arr<{
    id: string
    state: string
    exit_code: number
    command: string
  }>(data, 'jobs')
  const count = jobs.length || n(data, 'count')
  // Running first (the server already orders so, but be robust), then as-is.
  const ordered = [...jobs].sort(
    (a, b) => (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1),
  )
  const rows = ordered.map(j => ({
    label: j.command || j.id,
    sub: `${j.id} · ${j.state}${typeof j.exit_code === 'number' && j.exit_code !== 0 ? ` (exit ${j.exit_code})` : ''}`,
    icon: 'terminal',
    tone:
      j.state === 'running'
        ? ('warning' as const)
        : j.state === 'failed'
          ? ('destructive' as const)
          : ('success' as const),
    ...(sandbox ? { link: P.sandboxJobPage(sandbox, j.id) } : {}),
  }))
  return {
    subtitle: sandbox || 'jobs',
    input: {
      fields: fs(fin(input, 'worker-name', 'box', 'sandbox', { mono: true })),
    },
    result: {
      fields: [{ icon: 'terminal', label: 'jobs', value: String(count) }],
      // A LIST of jobs, not a terminal transcript. Fall back to the raw output
      // text only when the server sent no structured rows (older agent).
      body: rows.length
        ? { kind: 'list', rows }
        : output
          ? { kind: 'text', text: output }
          : undefined,
      actions: sandbox
        ? [{ label: sandbox, icon: 'box', page: P.sandboxPage(sandbox) }]
        : [],
    },
  }
}

const sandboxJobCtl: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'sandbox-job-kill' && tool !== 'sandbox-job-stdin') return null
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

const sandboxFileRead: CardHandler = ({ tool, data, input, output }) => {
  if (tool !== 'sandbox-file-read') return null
  const path = pick(data, input, 'path')
  const sandbox = pick(data, input, 'worker-name')
  const total = n(data, 'total_lines')
  const start = n(data, 'start')
  const shown = n(data, 'shown')
  const range = total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
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
      // Show the READ CONTENT with its true absolute line numbers (the gutter
      // starts at `start + 1`), not merely a link to the file.
      body: {
        kind: 'code',
        name: basename(path),
        text: stripLineNumbers(output),
        startLine: start + 1,
      },
      actions:
        sandbox && path
          ? [
              {
                label: path,
                icon: 'folder',
                page: P.sandboxFilesPage(sandbox, path),
              },
            ]
          : [],
    },
  }
}

const sandboxFileWrite: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'sandbox-file-write' && tool !== 'sandbox-file-edit') return null
  const path = pick(data, input, 'path')
  const sandbox = pick(data, input, 'worker-name')
  const added = n(data, 'added')
  const removed = n(data, 'removed')
  const content = pick(data, input, 'content')
  const start = n(input, 'start-line')
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
      // The written/inserted payload, with line numbers for an edit.
      body: content
        ? {
            kind: 'code',
            name: basename(path),
            text: content,
            ...(tool === 'sandbox-file-edit' && start > 0
              ? { startLine: start }
              : {}),
          }
        : undefined,
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
      actions:
        sandbox && path
          ? [
              {
                label: path,
                icon: 'folder',
                page: P.sandboxFilesPage(sandbox, path),
              },
            ]
          : [],
    },
  }
}

const sandboxFileLs: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'sandbox-file-ls') return null
  const path = pick(data, input, 'path')
  const sandbox = pick(data, input, 'worker-name')
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
      actions: sandbox
        ? [
            {
              label: path || '/',
              icon: 'folder',
              page: P.sandboxFilesPage(sandbox, path),
            },
          ]
        : [],
    },
  }
}

const sandboxFileRm: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'sandbox-file-rm') return null
  const path = pick(data, input, 'path')
  const sandbox = pick(data, input, 'worker-name')
  const parent = parentOfPath(path)
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
      actions: sandbox
        ? [
            {
              label: parent || '/',
              icon: 'folder',
              page: P.sandboxFilesPage(sandbox, parent),
            },
          ]
        : [],
    },
  }
}

const sandboxInfo: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'sandbox-info') return null
  return {
    subtitle: 'sandbox',
    input: {
      fields: fs(fin(input, 'worker-name', 'box', 'sandbox', { mono: true })),
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

const sandboxFileTransfer: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'sandbox-file-download' && tool !== 'sandbox-file-upload')
    return null
  const path = pick(data, input, 'path')
  // The result carries the produced file under `data.files` (rendered as a file
  // card below); the code lives there, not at the top level.
  const files = arr<{ code: string }>(data, 'files')
  const code = files[0]?.code || s(data, 'code')
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

const serviceList: CardHandler = ({ tool, data }) => {
  if (tool !== 'service-list') return null
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
        { icon: 'server', label: 'services', value: String(services.length) },
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

const sandboxList: CardHandler = ({ tool, data }) => {
  if (tool !== 'sandbox-list') return null
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
        { icon: 'box', label: 'sandboxes', value: String(sandboxes.length) },
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

const sandboxDelete: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'sandbox-delete') return null
  const name = s(data, 'name') || pick(data, input, 'worker-name')
  return {
    subtitle: name,
    input: {
      fields: fs(fin(input, 'worker-name', 'box', 'sandbox', { mono: true })),
    },
    result: {
      fields: fs(
        data['deleted'] === true
          ? {
              icon: 'delete',
              label: 'deleted',
              value: name,
              mono: true,
              tone: 'destructive',
            }
          : null,
      ),
    },
  }
}

const pvcCreate: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'pvc-create') return null
  const name = s(data, 'name') || pick(data, input, 'name')
  return {
    subtitle: name || 'pvc',
    input: {
      fields: fs(
        fin(input, 'name', 'server', 'name', { mono: true }),
        fin(input, 'size', 'list', 'size', { mono: true }),
        fin(input, 'storage-class', 'server', 'class', { mono: true }),
      ),
    },
    result: {
      fields: fs(
        name
          ? { icon: 'server', label: 'name', value: name, mono: true }
          : null,
        fres(data, 'size', 'list', 'size', { mono: true }),
        fres(data, 'storage_class', 'server', 'class', {
          mono: true,
          tone: 'muted',
        }),
        fres(data, 'phase', 'success', 'phase'),
      ),
    },
  }
}

const pvcList: CardHandler = ({ tool, data }) => {
  if (tool !== 'pvc-list') return null
  const pvcs = arr<{
    name: string
    size: string
    storage_class: string
    phase: string
    mounted_by: string[]
  }>(data, 'pvcs')
  return {
    subtitle: 'pvcs',
    input: { fields: [] },
    result: {
      fields: [
        {
          icon: 'server',
          label: 'pvcs',
          value: String(pvcs.length || n(data, 'count')),
        },
      ],
      body: pvcs.length
        ? {
            kind: 'list',
            rows: pvcs.map(p => ({
              label: p.name,
              sub: `${p.phase} · ${p.size}${p.storage_class ? ` · class=${p.storage_class}` : ''}${(p.mounted_by ?? []).length ? ` · mounted-by=${(p.mounted_by ?? []).join(',')}` : ''}`,
              icon: 'server',
              tone:
                p.phase === 'Bound' ? ('success' as const) : ('muted' as const),
            })),
          }
        : undefined,
    },
  }
}

const pvcDelete: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'pvc-delete') return null
  const name = s(data, 'name') || pick(data, input, 'name')
  return {
    subtitle: name,
    input: {
      fields: fs(fin(input, 'name', 'server', 'name', { mono: true })),
    },
    result: {
      fields: fs(
        data['deleted'] === true
          ? {
              icon: 'delete',
              label: 'deleted',
              value: name,
              mono: true,
              tone: 'destructive',
            }
          : null,
      ),
    },
  }
}

/** Sandbox + service handlers, in match order. */
export const sandboxHandlers: CardHandler[] = [
  sandboxCreate,
  sandboxCheckout,
  sandboxPort,
  serviceDeploy,
  serviceLogs,
  serviceDelete,
  sandboxExec,
  sandboxJobList,
  sandboxJobCtl,
  sandboxFileRead,
  sandboxFileWrite,
  sandboxFileLs,
  sandboxFileRm,
  sandboxInfo,
  sandboxFileTransfer,
  sandboxDelete,
  pvcCreate,
  pvcList,
  pvcDelete,
  serviceList,
  sandboxList,
]

export type { CardCtx }
