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
    )!
    expect(c.subtitle).toBe('acme/web @ main')
    // INPUT: the call's arguments.
    expect(c.input.fields.map(f => f.label)).toEqual([
      'path',
      'offset',
      'limit',
    ])
    // RESULT: line range + blob sha.
    expect(c.result.fields.map(f => f.label)).toEqual(['lines', 'blob'])
    expect(c.result.fields[0]!.value).toBe('L1–L40 / 100')
    expect(c.result.actions![0]!.page).toMatchObject({
      kind: 'repo_blob',
      path: 'a.ts',
    })
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
    // The inserted content belongs to the INPUT.
    expect(c.input.body).toEqual({ kind: 'text', text: 'new' })
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

  it('sandbox-exec: command in INPUT, terminal body in RESULT', () => {
    const c = cardFor(
      'sandbox-exec',
      { 'job-id': 'j1', state: 'done', exit_code: 0 },
      { 'worker-name': 'sb', command: 'ls -la' },
      'total 0\nfile.txt',
    )!
    expect(c.subtitle).toBe('sb')
    expect(c.input.fields.map(f => f.label)).toEqual(['sandbox', 'command'])
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
    expect(c.result.body).toMatchObject({ kind: 'code', name: 'a.ts' })
    expect((c.result.body as { text: string }).text).toBe(
      'const x = 1\nexport {}',
    )
  })

  it('sandbox-file-edit: content in INPUT, diff in RESULT', () => {
    const c = cardFor(
      'sandbox-file-edit',
      { path: 'a', added: 1, removed: 1, diff: '@@ x @@' },
      {
        'worker-name': 'sb',
        path: 'a',
        'start-line': 1,
        'end-line': 1,
        content: 'z',
      },
      '',
    )!
    expect(c.input.body).toEqual({ kind: 'text', text: 'z' })
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
    expect(c.result.body).toMatchObject({ kind: 'code', name: 'a.go' })
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
})
