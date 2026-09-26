import { describe, expect, it } from 'vitest'
import { bareToolName, cardFor } from './tool-cards'

describe('bareToolName', () => {
  it('strips one extension qualifier', () => {
    expect(bareToolName('bundled.mail-send')).toBe('mail-send')
    expect(bareToolName('workspace.repo-file-read')).toBe('repo-file-read')
    expect(bareToolName('repo-file-read')).toBe('repo-file-read')
    expect(bareToolName('web-fetch')).toBe('web-fetch')
  })
})

describe('cardFor', () => {
  it('repo-file-read: input args vs result fields + open-file action', () => {
    const c = cardFor(
      'repo-file-read',
      {
        org: 'acme',
        repo: 'web',
        ref: 'main',
        path: 'a.ts',
        sha: 'deadbeefcafe',
        total_lines: 100,
        start: 0,
        shown: 40,
      },
      { path: 'a.ts', offset: 0, limit: 40 },
      '1  const x = 1\n2  export {}',
    )!
    expect(c.subtitle).toBe('acme/web @ main')
    // INPUT: the call's arguments.
    expect(c.input.fields.map(f => f.label)).toEqual([
      'path',
      'offset',
      'limit',
    ])
    // RESULT: line range + blob sha + the read content with its line numbers.
    expect(c.result.fields.map(f => f.label)).toEqual(['lines', 'blob'])
    expect(c.result.fields[0]!.value).toBe('L1–L40 / 100')
    expect(c.result.body).toMatchObject({
      kind: 'code',
      name: 'a.ts',
      text: 'const x = 1\nexport {}',
      startLine: 1,
    })
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'repo_blob',
      path: 'a.ts',
    })
  })

  it('repo-file-read: a windowed read keeps the absolute start line', () => {
    const c = cardFor(
      'repo-file-read',
      {
        org: 'a',
        repo: 'b',
        ref: 'main',
        path: 'x',
        total_lines: 100,
        start: 19,
        shown: 2,
      },
      { path: 'x', offset: 19, limit: 2 },
      '20  a\n21  b',
    )!
    expect(c.result.body).toMatchObject({ kind: 'code', startLine: 20 })
  })

  it('repo-file-edit: input payload + result diff + commit/file actions', () => {
    const c = cardFor(
      'repo-file-edit',
      {
        org: 'a',
        repo: 'b',
        ref: 'dev',
        path: 'x',
        commit: 'abc123',
        added: 3,
        removed: 1,
        diff: '@@ -1 +1 @@',
      },
      { path: 'x', 'start-line': 1, 'end-line': 2, content: 'new' },
    )!
    // The inserted content belongs to the INPUT, shown with its target line.
    expect(c.input.body).toEqual({
      kind: 'code',
      name: 'x',
      text: 'new',
      startLine: 1,
    })
    expect(c.input.fields.map(f => f.label)).toEqual(['path', 'start', 'end'])
    // The diff/changes belong to the RESULT.
    expect(c.result.fields.find(f => f.label === 'changes')!.value).toBe(
      '+3 −1',
    )
    expect(c.result.body).toEqual({ kind: 'diff', diff: '@@ -1 +1 @@' })
    expect(c.result.actions!.map(a => a.page.kind)).toEqual([
      'repo_commit',
      'repo_blob',
    ])
  })

  it('repo-diff: input range vs result totals + files body + compare action', () => {
    const c = cardFor(
      'repo-diff',
      {
        org: 'a',
        repo: 'b',
        base: 'main',
        head: 'feat',
        files: [{ path: 'x', status: 'modified', additions: 2, deletions: 5 }],
      },
      { base: 'main', head: 'feat' },
    )!
    expect(c.input.fields.map(f => f.label)).toEqual(['base', 'head'])
    expect(c.result.fields.find(f => f.label === 'changes')!.value).toBe(
      '+2 −5',
    )
    expect(c.result.body!.kind).toBe('files')
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'repo_compare',
      base: 'main',
      head: 'feat',
    })
  })

  it('repo-log with a path links to file history', () => {
    const c = cardFor(
      'repo-log',
      { org: 'a', repo: 'b', ref: 'main', path: 'f.ts', commits: [] },
      { path: 'f.ts' },
    )!
    expect(c.subtitle).toBe('a/b @ main : f.ts')
    expect(c.input.fields.map(f => f.label)).toEqual(['path'])
    expect(c.result.actions![0]!.page.kind).toBe('repo_history')
  })

  it('repo-mr-create links to the MR page', () => {
    const c = cardFor(
      'repo-mr-create',
      { org: 'a', repo: 'b', index: 7, head: 'x', base: 'main' },
      { title: 'T', head: 'x', base: 'main' },
    )!
    expect(c.input.fields.map(f => f.label)).toEqual(['title', 'range'])
    // The NEW MR number comes back in the result.
    expect(c.result.fields.map(f => f.label)).toEqual(['mr'])
    expect(c.result.fields[0]!.value).toBe('#7')
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'repo_mr',
      index: 7,
    })
  })

  it('service-deploy: input spec vs result image/url + ports body', () => {
    const c = cardFor(
      'service-deploy',
      {
        name: 'db',
        image: 'img:1',
        url: 'http://db:80',
        replicas: 2,
        ports: [
          {
            name: '',
            preset: 'tcp80',
            port: 80,
            protocol: 'tcp',
            targetPort: 8080,
          },
        ],
      },
      { image: 'img:1', name: 'db', replicas: 2 },
    )!
    expect(c.subtitle).toBe('db')
    expect(c.input.fields.map(f => f.label)).toContain('image')
    expect(c.result.body!.kind).toBe('ports')
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'service_detail',
      name: 'db',
    })
  })

  it('sandbox-create links to the sandbox page', () => {
    const c = cardFor(
      'sandbox-create',
      { name: 'sb', phase: 'Running', url: 'http://sb:48080' },
      { name: 'sb', image: 'base:1' },
    )!
    expect(c.input.fields.map(f => f.label)).toEqual(['name', 'image'])
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'sandbox_detail',
      name: 'sb',
    })
  })

  it('sandbox-exec: command reads as a terminal in INPUT, output in RESULT', () => {
    const c = cardFor(
      'sandbox-exec',
      { 'job-id': 'j1', state: 'done', exit_code: 0 },
      {
        'worker-name': 'sb',
        command: 'ls -la',
        workdir: '/workspace',
        timeout: '30',
      },
      'total 0\nfile.txt',
    )!
    expect(c.subtitle).toBe('sb')
    // The command is a terminal-style body, not a field.
    expect(c.input.fields.map(f => f.label)).toEqual(['sandbox'])
    expect(c.input.body).toEqual({
      kind: 'command',
      command: 'ls -la',
      workdir: '/workspace',
      timeout: '30',
    })
    expect(c.result.body).toEqual({
      kind: 'terminal',
      command: 'ls -la',
      text: 'total 0\nfile.txt',
      state: 'done',
      exitCode: 0,
    })
    expect(c.result.actions!.map(a => a.page.kind)).toEqual([
      'sandbox_job',
      'sandbox_detail',
    ])
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'sandbox_job',
      name: 'sb',
      jobId: 'j1',
    })
  })

  it('sandbox-file-read renders a code body (line-number gutter stripped)', () => {
    const c = cardFor(
      'sandbox-file-read',
      { total_lines: 2, start: 0, shown: 2 },
      { 'worker-name': 'sb', path: 'src/a.ts' },
      '1  const x = 1\n2  export {}',
    )!
    expect(c.input.fields.map(f => f.label)).toEqual(['sandbox', 'path'])
    expect(c.result.body).toMatchObject({
      kind: 'code',
      name: 'a.ts',
      startLine: 1,
    })
    expect((c.result.body as { text: string }).text).toBe(
      'const x = 1\nexport {}',
    )
  })

  it('sandbox-file-read KEEPS the content indentation (only the gutter goes)', () => {
    // The producer writes `<number>` + EXACTLY two spaces + content. A greedy
    // separator regex ate the content's own leading spaces too.
    const c = cardFor(
      'sandbox-file-read',
      { total_lines: 2, start: 0, shown: 2 },
      { 'worker-name': 'sb', path: 'x.yaml' },
      '1  def foo():\n2      return 42',
    )!
    expect((c.result.body as { text: string }).text).toBe(
      'def foo():\n    return 42',
    )
  })

  it('sandbox-file-read strips a padded number but keeps deep indentation', () => {
    // A windowed read pads the number (`padStart(width)`), and YAML nests deep.
    const c = cardFor(
      'sandbox-file-read',
      { total_lines: 300, start: 199, shown: 1 },
      { 'worker-name': 'sb', path: 'a.yaml' },
      '200            descriptions:',
    )!
    expect((c.result.body as { text: string }).text).toBe(
      '          descriptions:',
    )
  })

  it('sandbox-file-edit: numbered content in INPUT, diff in RESULT', () => {
    const c = cardFor(
      'sandbox-file-edit',
      { path: 'a', added: 1, removed: 1, diff: '@@ x @@' },
      {
        'worker-name': 'sb',
        path: 'a',
        'start-line': 3,
        'end-line': 3,
        content: 'z',
      },
      '',
    )!
    expect(c.input.body).toEqual({
      kind: 'code',
      name: 'a',
      text: 'z',
      startLine: 3,
    })
    expect(c.result.body).toEqual({ kind: 'diff', diff: '@@ x @@' })
  })

  it('sandbox-file-ls renders a tree body', () => {
    const c = cardFor(
      'sandbox-file-ls',
      {
        rows: 2,
        entries: [
          { path: 'a', depth: 1, type: 'dir', size: 0 },
          { path: 'a/b', depth: 2, type: 'file', size: 3 },
        ],
      },
      { 'worker-name': 'sb', path: '.' },
    )!
    expect(c.result.body!.kind).toBe('tree')
  })

  it('sandbox-file-rm: path in INPUT, deleted in RESULT', () => {
    const c = cardFor(
      'sandbox-file-rm',
      { path: 'a', deleted: true },
      { 'worker-name': 'sb', path: 'a' },
    )!
    expect(c.input.fields.map(f => f.label)).toEqual(['sandbox', 'path'])
    expect(c.result.fields[0]!.label).toBe('deleted')
    expect(c.result.fields[0]!.tone).toBe('destructive')
    // The file is gone: the action links to its PARENT directory.
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'sandbox_files',
      name: 'sb',
      path: '',
    })
  })

  it('sandbox-file-read links into the sandbox file browser at the file', () => {
    const c = cardFor(
      'sandbox-file-read',
      { total_lines: 2, start: 0, shown: 2 },
      { 'worker-name': 'sb', path: 'hello/main.go' },
      '1  package main',
    )!
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'sandbox_files',
      name: 'sb',
      path: 'hello/main.go',
    })
  })

  it('matches an extension-qualified tool name', () => {
    const c = cardFor(
      'bundled.history-search',
      { entries: [{ role: 'user', content: 'hi' }] },
      { query: 'x' },
    )!
    expect(c.result.body!.kind).toBe('messages')
    expect(c.input.fields.map(f => f.label)).toEqual(['query'])
  })

  it('service-list renders a clickable list body', () => {
    const c = cardFor(
      'service-list',
      {
        services: [
          {
            name: 'db',
            phase: 'Running',
            image: 'i',
            url: 'http://db',
            session: '',
            publicUrl: 'https://db.x',
          },
        ],
      },
      {},
    )!
    expect(c.result.body!.kind).toBe('list')
    expect(
      (c.result.body as { rows: Array<{ link: unknown }> }).rows[0]!.link,
    ).toMatchObject({ kind: 'service_detail', name: 'db' })
  })

  it('sandbox-list renders a clickable list body', () => {
    const c = cardFor(
      'sandbox-list',
      {
        sandboxes: [
          {
            name: 'sb',
            phase: 'Running',
            image: 'i',
            url: 'u',
            creator: 't',
            session: 's',
          },
        ],
      },
      {},
    )!
    expect(
      (c.result.body as { rows: Array<{ link: unknown }> }).rows[0]!.link,
    ).toMatchObject({ kind: 'sandbox_detail', name: 'sb' })
  })

  it('file-read renders a code body', () => {
    const c = cardFor(
      'file-read',
      { code: 'abc', total_lines: 2, start: 0, shown: 2, name: 'a.go' },
      { code: 'abc' },
      '1  package main\n2  func main(){}',
    )!
    expect(c.result.body).toMatchObject({
      kind: 'code',
      name: 'a.go',
      startLine: 1,
    })
  })

  it('service-logs renders the log text as a terminal body', () => {
    const c = cardFor(
      'service-logs',
      { name: 'mariadb', lines: 4 },
      { name: 'mariadb', 'tail-lines': 20 },
      'logs for mariadb (4 lines)\nline1\nline2',
    )!
    expect(c.result.fields[0]!.value).toBe('4')
    expect(c.result.body).toEqual({
      kind: 'terminal',
      text: 'logs for mariadb (4 lines)\nline1\nline2',
    })
  })

  it('repo-show renders the commit patch as a diff body', () => {
    const c = cardFor(
      'repo-show',
      {
        org: 'a',
        repo: 'b',
        ref: 'main',
        sha: 'abc123',
        commit: { author: 'me', date: 'now' },
        message: 'fix thing',
        diff: 'diff --git a/x b/x\n+1',
      },
      { sha: 'abc123' },
      'abc123  now  me\n\nfix thing\n\ndiff --git a/x b/x\n+1',
    )!
    expect(c.result.body).toEqual({
      kind: 'diff',
      diff: 'diff --git a/x b/x\n+1',
    })
  })

  it('repo-show falls back to text when the server sent no structured diff', () => {
    const c = cardFor(
      'repo-show',
      { org: 'a', repo: 'b', ref: 'main', sha: 'abc123', commit: {} },
      { sha: 'abc123' },
      'abc123  now  me\n\nfix thing',
    )!
    expect(c.result.body).toEqual({
      kind: 'text',
      text: 'abc123  now  me\n\nfix thing',
    })
  })

  it('repo-build-image renders the build log as a terminal body', () => {
    const c = cardFor(
      'repo-build-image',
      { image_ref: 'reg/o/img:1' },
      { org: 'o', image: 'img', tag: '1' },
      'built reg/o/img:1\n\n#1 DONE',
    )!
    expect(c.result.body).toEqual({
      kind: 'terminal',
      text: 'built reg/o/img:1\n\n#1 DONE',
    })
  })

  it('web-fetch renders markdown; file-info renders kv', () => {
    expect(
      cardFor(
        'web-fetch',
        { url: 'https://x', format: 'markdown' },
        { url: 'https://x' },
        '# Hi',
      )!.result.body!.kind,
    ).toBe('markdown')
    const fi = cardFor(
      'file-info',
      {
        code: 'abc',
        meta: { name: 'x.png', mime: 'image/png', size: 12, sha256: 'ff' },
      },
      { code: 'abc' },
    )!
    expect(fi.result.body!.kind).toBe('kv')
  })

  it('audio-transcribe / image-read render audio / media bodies', () => {
    expect(
      cardFor('audio-transcribe', { code: 'a1' }, {}, 'hello')!.result.body!
        .kind,
    ).toBe('audio')
    expect(
      cardFor('image-read', { code: 'i1', mime: 'image/png' }, {}, 'a cat')!
        .result.body!.kind,
    ).toBe('media')
  })

  it('falls back to input coordinates and returns null for unknown tools', () => {
    const c = cardFor(
      'repo-file-read',
      {},
      { org: 'a', repo: 'b', ref: 'main', path: 'p' },
    )!
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'repo_blob',
      path: 'p',
    })
    expect(cardFor('image-generate', {}, {})).not.toBeNull()
    expect(cardFor('repo-file-read', { org: 'a' }, {})).toBeNull()
  })

  it('sandbox-file-upload: code comes from data.files, not the top level', () => {
    const c = cardFor(
      'sandbox-file-upload',
      { files: [{ code: 'c0de', name: 'a.txt', mime: 'text/plain', size: 4 }] },
      { 'worker-name': 'sb', path: 'dir/a.txt' },
    )!
    const codeField = c.result.fields.find(f => f.label === 'code')
    expect(codeField?.value).toBe('c0de')
  })

  it('sandbox-port: renders the unified diff body when present', () => {
    const diff = '--- a/src/a.txt\n+++ b/src/a.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'
    const c = cardFor(
      'sandbox-port',
      { org: 'acme', repo: 'web', ref: 'feature/x', commit: 'abc123', count: 1, paths: ['src/a.txt'], added: 1, removed: 1, diff },
      { 'worker-name': 'sb', path: 'app/src/a.txt', 'repo-path': 'src/a.txt' },
    )!
    expect(c.result.body).toMatchObject({ kind: 'diff', diff })
    expect(c.result.fields.map(f => f.label)).toContain('changes')
  })

  it('sandbox-job-list renders a clickable LIST of jobs (not a terminal)', () => {
    const c = cardFor(
      'sandbox-job-list',
      {
        count: 2,
        jobs: [
          { id: 'j1', state: 'done', exit_code: 0, command: 'ls' },
          { id: 'j2', state: 'running', exit_code: 0, command: 'sleep 5' },
        ],
      },
      { 'worker-name': 'sb' },
      'j1  done  ls\nj2  running  sleep 5',
    )!
    expect(c.result.body).toMatchObject({ kind: 'list' })
    const rows = (
      c.result.body as {
        rows: Array<{ label: string; link?: { kind: string }; tone?: string }>
      }
    ).rows
    // Running jobs are hoisted to the top, regardless of input order.
    expect(rows.map(r => r.label)).toEqual(['sleep 5', 'ls'])
    expect(rows[0]!.tone).toBe('warning')
    expect(rows[0]!.link).toMatchObject({
      kind: 'sandbox_job',
      name: 'sb',
      jobId: 'j2',
    })
  })

  it('repo-explore renders orgs/repos as list bodies', () => {
    const orgs = cardFor('repo-explore', { orgs: ['a', 'b'] }, {})!
    expect(orgs.result.body).toMatchObject({ kind: 'list' })
    const repos = cardFor(
      'repo-explore',
      {
        org: 'o',
        repos: [{ repo: 'r', default_branch: 'main', branches: ['main'] }],
      },
      { org: 'o' },
    )!
    const rows = (
      repos.result.body as { rows: Array<{ label: string; link?: unknown }> }
    ).rows
    expect(rows[0]!.label).toBe('o/r')
    expect(rows[0]!.link).toMatchObject({
      kind: 'repo_detail',
      org: 'o',
      repo: 'r',
    })
  })

  it('repo-list-push-mirrors renders a list body', () => {
    const c = cardFor(
      'repo-list-push-mirrors',
      {
        mirrors: [
          {
            remote_name: 'up',
            remote_address: 'https://x',
            last_error: 'boom',
          },
        ],
      },
      {},
    )!
    expect(c.result.body).toMatchObject({ kind: 'list' })
  })

  it('pvc cards: create/delete fields, list body', () => {
    const created = cardFor(
      'pvc-create',
      {
        name: 'data',
        size: '1Gi',
        storage_class: 'local-path',
        phase: 'Bound',
      },
      { name: 'data', size: '1Gi' },
    )!
    expect(created.result.fields.map(f => f.label)).toEqual([
      'name',
      'size',
      'class',
      'phase',
    ])
    const listed = cardFor(
      'pvc-list',
      {
        count: 1,
        pvcs: [
          {
            name: 'data',
            size: '1Gi',
            storage_class: 'local-path',
            phase: 'Bound',
            mounted_by: [],
          },
        ],
      },
      {},
    )!
    expect(listed.result.body).toMatchObject({ kind: 'list' })
    const deleted = cardFor(
      'pvc-delete',
      { name: 'data', deleted: true },
      { name: 'data' },
    )!
    expect(deleted.result.fields[0]).toMatchObject({
      label: 'deleted',
      value: 'data',
    })
  })

  it('sandbox-delete and time-wait render cards', () => {
    expect(
      cardFor(
        'sandbox-delete',
        { name: 'sb', deleted: true },
        { 'worker-name': 'sb' },
      )!.result.fields[0],
    ).toMatchObject({ label: 'deleted', value: 'sb' })
    expect(cardFor('time-wait', { seconds: 5 }, { seconds: 5 })!.subtitle).toBe(
      '5s',
    )
  })
})
