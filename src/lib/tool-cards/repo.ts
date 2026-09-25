// Repo cards: read / write / refs / change-requests / admin (org, mirrors,
// import, image build). Split out of the monolithic registry; each handler
// returns null when the tool is not its concern.
import * as P from '../tool-pages'
import {
  arr,
  basename,
  type CardAction,
  type CardField,
  type CardHandler,
  type CardSection,
  diffTone,
  fin,
  fs,
  loc,
  n,
  pick,
  s,
  short,
  stripLineNumbers,
} from './shared'

const repoFileRead: CardHandler = ({
  tool,
  data,
  input,
  output,
  org,
  repo,
  ref,
  path,
  sha,
  at,
}) => {
  if (tool !== 'repo-file-read' || !org || !repo || !path) return null
  const total = n(data, 'total_lines')
  const start = n(data, 'start')
  const shown = n(data, 'shown')
  const range = total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
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
      // The READ CONTENT, with its true absolute line numbers (offset+1).
      body: output
        ? {
            kind: 'code',
            name: basename(path),
            text: stripLineNumbers(output),
            startLine: start + 1,
          }
        : undefined,
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

const repoFileList: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  ref,
  at,
}) => {
  if (tool !== 'repo-file-list' || !org || !repo) return null
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

const repoLog: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  ref,
  path,
  at,
}) => {
  if (tool !== 'repo-log' || !org || !repo) return null
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
        { icon: 'history', label: 'commits', value: String(commits.length) },
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
          : { label: at, icon: 'history', page: P.repoDetail(org, repo, ref) },
      ],
    },
  }
}

const repoShow: CardHandler = ({
  tool,
  data,
  input,
  output,
  org,
  repo,
  ref,
  sha,
  at,
}) => {
  if (tool !== 'repo-show' || !org || !repo || !sha) return null
  const c = (data['commit'] ?? {}) as Record<string, unknown>
  const message = s(data, 'message') || s(c, 'message')
  const diff = s(data, 'diff')
  return {
    subtitle: at,
    input: { fields: fs(fin(input, 'sha', 'commit', 'sha', { mono: true })) },
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
      // The commit message + patch. Prefer the structured diff (green/red);
      // fall back to the raw output text when the server sent no diff.
      body: diff
        ? { kind: 'diff', diff }
        : output
          ? { kind: 'text', text: output }
          : message
            ? { kind: 'text', text: message }
            : undefined,
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

const repoDiff: CardHandler = ({ tool, data, input, org, repo }) => {
  if (tool !== 'repo-diff') return null
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

const repoFileWrite: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  ref,
  path,
  sha,
  at,
}) => {
  if (
    tool !== 'repo-file-write' &&
    tool !== 'repo-file-edit' &&
    tool !== 'repo-file-delete'
  ) {
    return null
  }
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
  const editStart = n(input, 'start-line')
  return {
    subtitle: `${action} · ${at}`,
    input: {
      fields: inputFields,
      // The written/inserted payload is part of the INPUT, not the result. For
      // an EDIT it is shown with the target line numbers so the reader sees
      // WHERE the lines land.
      body:
        content && tool !== 'repo-file-delete'
          ? {
              kind: 'code',
              name: basename(path),
              text: content,
              ...(tool === 'repo-file-edit' && editStart > 0
                ? { startLine: editStart }
                : {}),
            }
          : undefined,
    },
    result: {
      fields: resultFields,
      body: d ? { kind: 'diff', diff: d } : undefined,
      actions,
    },
  }
}

const repoCommit: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  ref,
  sha,
  at,
}) => {
  if (tool !== 'repo-commit' || !org || !repo) return null
  const fanned = n(data, 'fanned')
  return {
    subtitle: at,
    input: { fields: fs(fin(input, 'message', 'commit', 'message')) },
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

const repoFileRestore: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  ref,
  sha,
  at,
}) => {
  if (tool !== 'repo-file-restore' || !org || !repo) return null
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
          ? { icon: 'binary', label: 'binary', value: 'yes', tone: 'muted' }
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

const repoBranchSync: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  ref,
  sha,
}) => {
  if (tool !== 'repo-branch-sync' || !org || !repo) return null
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

const repoBranches: CardHandler = ({ tool, data, org, repo, ref, at }) => {
  if (tool !== 'repo-branches' || !org || !repo) return null
  const branches = arr<{ name: string; sha: string }>(data, 'branches')
  return {
    subtitle: at,
    input: { fields: [] },
    result: {
      fields: [
        { icon: 'folder', label: 'branches', value: String(branches.length) },
      ],
      body: { kind: 'branches', branches, org, repo },
      actions: [
        { label: at, icon: 'folder', page: P.repoDetail(org, repo, ref) },
      ],
    },
  }
}

const repoTags: CardHandler = ({ tool, data, org, repo, ref, at }) => {
  if (tool !== 'repo-tags' || !org || !repo) return null
  const tags = arr<{ name: string; sha: string }>(data, 'tags')
  return {
    subtitle: at,
    input: { fields: [] },
    result: {
      fields: [{ icon: 'tag', label: 'tags', value: String(tags.length) }],
      body: { kind: 'tags', tags, org, repo },
      actions: [{ label: at, icon: 'tag', page: P.repoDetail(org, repo, ref) }],
    },
  }
}

const repoBranchCreate: CardHandler = ({
  tool,
  data,
  input,
  org,
  repo,
  at,
}) => {
  if (tool !== 'repo-branch-create' || !org || !repo) return null
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

const repoTagCreate: CardHandler = ({ tool, data, input, org, repo, at }) => {
  if (tool !== 'repo-tag-create' || !org || !repo) return null
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

const repoMr: CardHandler = ({ tool, data, input, org, repo, index }) => {
  if (
    tool !== 'repo-mr-create' &&
    tool !== 'repo-mr-comment' &&
    tool !== 'repo-mr-merge'
  ) {
    return null
  }
  if (!org || !repo || index <= 0) return null
  const head = pick(data, input, 'head')
  const base = pick(data, input, 'base')
  const url = s(data, 'url')
  const title = pick(data, input, 'title')
  const bodyText = pick(data, input, 'body')
  const indexArg = n(input, 'index')
  const indexRes = n(data, 'index')
  return {
    subtitle: `${org}/${repo}`,
    input: {
      fields: fs(
        indexArg
          ? { icon: 'merge', label: 'mr', value: `#${indexArg}`, mono: true }
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
          ? { icon: 'merge', label: 'mr', value: `#${indexRes}`, mono: true }
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
        { label: `#${index}`, icon: 'merge', page: P.repoMR(org, repo, index) },
      ],
    },
  }
}

const repoMrList: CardHandler = ({ tool, data, input, org, repo }) => {
  if (tool !== 'repo-mr-list' || !org || !repo) return null
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
    input: { fields: fs(fin(input, 'state', 'list', 'state')) },
    result: {
      fields: [{ icon: 'merge', label: 'open', value: String(pulls.length) }],
      body: pulls.length ? { kind: 'pulls', pulls, org, repo } : undefined,
    },
  }
}

const repoExplore: CardHandler = ({ tool, data, input, org }) => {
  if (tool !== 'repo-explore') return null
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
        body: {
          kind: 'list',
          rows: orgs.map(o => ({ label: o, icon: 'building' })),
        },
      },
    }
  }
  if (Array.isArray(repos)) {
    const list = repos as Array<Record<string, unknown>>
    return {
      subtitle: org || 'repos',
      input: inputSection,
      result: {
        fields: [
          { icon: 'folder', label: 'repos', value: String(list.length) },
        ],
        body: {
          kind: 'list',
          rows: list.map(r => {
            const name = s(r, 'repo') || s(r, 'full_name')
            const def = s(r, 'default_branch')
            const branches = Array.isArray(r['branches'])
              ? (r['branches'] as unknown[]).map(String)
              : []
            return {
              label: org ? `${org}/${name}` : name,
              sub: `${def ? `default: ${def}` : ''}${branches.length ? ` · branches: ${branches.join(', ')}` : ''}`,
              icon: 'folder',
              ...(org && name
                ? { link: P.repoDetail(org, name, def || 'main') }
                : {}),
            }
          }),
        },
      },
    }
  }
  return null
}

const repoImport: CardHandler = ({ tool, data, input, org, repo }) => {
  if (tool !== 'repo-import') return null
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
          ? { icon: 'folder', label: 'branch', value: branch, mono: true }
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

const repoSetPushMirror: CardHandler = ({ tool, data, input, at }) => {
  if (tool !== 'repo-set-push-mirror') return null
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
          ? { icon: 'commit', label: 'on-commit', value: 'yes', tone: 'muted' }
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

const repoListPushMirrors: CardHandler = ({ tool, data, at }) => {
  if (tool !== 'repo-list-push-mirrors') return null
  const mirrors = arr<Record<string, unknown>>(data, 'mirrors')
  return {
    subtitle: at || 'push mirrors',
    input: { fields: [] },
    result: {
      fields: [
        { icon: 'branch', label: 'mirrors', value: String(mirrors.length) },
      ],
      body: mirrors.length
        ? {
            kind: 'list',
            rows: mirrors.map(m => {
              const err = s(m, 'last_error')
              return {
                label: s(m, 'remote_name') || s(m, 'remote_address'),
                sub: `${s(m, 'remote_address')}${s(m, 'branch_filter') ? ` [${s(m, 'branch_filter')}]` : ''}${m['sync_on_commit'] === true ? ' (on commit)' : ''}${s(m, 'interval') ? ` every ${s(m, 'interval')}` : ''}${err ? ` ⚠ ${err}` : ''}`,
                icon: 'branch',
                tone: err ? ('destructive' as const) : ('muted' as const),
              }
            }),
          }
        : undefined,
    },
  }
}

const repoDeletePushMirror: CardHandler = ({ tool, input, at }) => {
  if (tool !== 'repo-delete-push-mirror') return null
  return {
    subtitle: at || 'push mirror',
    input: {
      fields: fs(fin(input, 'remote-name', 'branch', 'remote', { mono: true })),
    },
    result: { fields: [] },
  }
}

const repoRemove: CardHandler = ({ tool, input, org, repo }) => {
  if (tool !== 'repo-remove') return null
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

const repoCreateOrg: CardHandler = ({ tool, input, org }) => {
  if (tool !== 'repo-create-org') return null
  return {
    subtitle: org,
    input: { fields: fs(fin(input, 'org', 'building', 'org', { mono: true })) },
    result: {
      fields: [{ icon: 'building', label: 'org', value: org, mono: true }],
    },
  }
}

const repoCreateRepo: CardHandler = ({ tool, data, input, org, repo }) => {
  if (tool !== 'repo-create-repo') return null
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

const repoMailSend: CardHandler = ({ tool, data, input, org, repo }) => {
  if (tool !== 'repo-mail-send') return null
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

/** Repo handlers, in match order. */
export const repoHandlers: CardHandler[] = [
  repoFileRead,
  repoFileList,
  repoLog,
  repoShow,
  repoDiff,
  repoFileWrite,
  repoCommit,
  repoFileRestore,
  repoBranchSync,
  repoBranches,
  repoTags,
  repoBranchCreate,
  repoTagCreate,
  repoMr,
  repoMrList,
  repoExplore,
  repoImport,
  repoSetPushMirror,
  repoListPushMirrors,
  repoDeletePushMirror,
  repoRemove,
  repoCreateOrg,
  repoCreateRepo,
  repoMailSend,
]
