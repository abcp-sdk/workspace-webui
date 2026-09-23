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
  it('repo-file-read: path + line range + blob sha + open-file action', () => {
    const c = cardFor('repo-file-read', { org: 'acme', repo: 'web', ref: 'main', path: 'a.ts', sha: 'deadbeefcafe', total_lines: 100, start: 0, shown: 40 }, {})!
    expect(c.subtitle).toBe('acme/web @ main')
    expect(c.fields.map(f => f.label)).toEqual(['path', 'lines', 'blob'])
    expect(c.fields[1]!.value).toBe('L1–L40 / 100')
    expect(c.actions![0]!.page).toMatchObject({ kind: 'repo_blob', path: 'a.ts' })
  })

  it('repo-file-edit: changes + inline diff + commit/file actions', () => {
    const c = cardFor('repo-file-edit', { org: 'a', repo: 'b', ref: 'dev', path: 'x', commit: 'abc123', added: 3, removed: 1, diff: '@@ -1 +1 @@' }, {})!
    expect(c.fields.find(f => f.label === 'changes')!.value).toBe('+3 −1')
    expect(c.body).toEqual({ kind: 'diff', diff: '@@ -1 +1 @@' })
    expect(c.actions!.map(a => a.page.kind)).toEqual(['repo_commit', 'repo_blob'])
  })

  it('repo-diff: range + totals + files body + compare action', () => {
    const c = cardFor('repo-diff', { org: 'a', repo: 'b', base: 'main', head: 'feat', files: [{ path: 'x', status: 'modified', additions: 2, deletions: 5 }] }, {})!
    expect(c.fields.find(f => f.label === 'range')!.value).toBe('main … feat')
    expect(c.fields.find(f => f.label === 'changes')!.value).toBe('+2 −5')
    expect(c.body!.kind).toBe('files')
    expect(c.actions![0]!.page).toMatchObject({ kind: 'repo_compare', base: 'main', head: 'feat' })
  })

  it('repo-log with a path links to file history', () => {
    const c = cardFor('repo-log', { org: 'a', repo: 'b', ref: 'main', path: 'f.ts', commits: [] }, {})!
    expect(c.subtitle).toBe('a/b @ main : f.ts')
    expect(c.actions![0]!.page.kind).toBe('repo_history')
  })

  it('repo-mr-create links to the MR page', () => {
    const c = cardFor('repo-mr-create', { org: 'a', repo: 'b', index: 7, head: 'x', base: 'main' }, {})!
    expect(c.fields.find(f => f.label === 'mr')!.value).toBe('#7')
    expect(c.actions![0]!.page).toMatchObject({ kind: 'repo_mr', index: 7 })
  })

  it('service-deploy: image/url + ports body + open-service action', () => {
    const c = cardFor('service-deploy', { name: 'db', image: 'img:1', url: 'http://db:80', ports: [{ name: '', preset: 'tcp80', port: 80, protocol: 'tcp', targetPort: 8080 }] }, {})!
    expect(c.subtitle).toBe('db')
    expect(c.body!.kind).toBe('ports')
    expect(c.actions![0]!.page).toMatchObject({ kind: 'service_detail', name: 'db' })
  })

  it('sandbox-create links to the sandbox page', () => {
    const c = cardFor('sandbox-create', { name: 'sb', phase: 'Running', url: 'http://sb:48080' }, {})!
    expect(c.actions![0]!.page).toMatchObject({ kind: 'sandbox_detail', name: 'sb' })
  })

  it('sandbox-exec renders a terminal body with command + output', () => {
    const c = cardFor(
      'sandbox-exec',
      { 'job-id': 'j1', state: 'done', exit_code: 0 },
      { 'worker-name': 'sb', command: 'ls -la' },
      'total 0\nfile.txt',
    )!
    expect(c.subtitle).toBe('sb')
    expect(c.body).toEqual({ kind: 'terminal', command: 'ls -la', text: 'total 0\nfile.txt', state: 'done', exitCode: 0 })
    expect(c.actions!.map(a => a.page.kind)).toEqual(['sandbox_job', 'sandbox_detail'])
    expect(c.actions![0]!.page).toMatchObject({ kind: 'sandbox_job', name: 'sb', jobId: 'j1' })
  })

  it('sandbox-file-read renders a code body (line-number gutter stripped)', () => {
    const c = cardFor('sandbox-file-read', { total_lines: 2, start: 0, shown: 2 }, { 'worker-name': 'sb', path: 'src/a.ts' }, '1  const x = 1\n2  export {}')!
    expect(c.body).toMatchObject({ kind: 'code', name: 'a.ts' })
    expect((c.body as { text: string }).text).toBe('const x = 1\nexport {}')
  })

  it('sandbox-file-edit renders a diff body', () => {
    const c = cardFor('sandbox-file-edit', { path: 'a', added: 1, removed: 1, diff: '@@ x @@' }, { 'worker-name': 'sb' }, '')!
    expect(c.body).toEqual({ kind: 'diff', diff: '@@ x @@' })
  })

  it('sandbox-file-ls renders a tree body', () => {
    const c = cardFor('sandbox-file-ls', { rows: 2, entries: [{ path: 'a', depth: 1, type: 'dir', size: 0 }, { path: 'a/b', depth: 2, type: 'file', size: 3 }] }, { 'worker-name': 'sb' }, '')!
    expect(c.body!.kind).toBe('tree')
  })

  it('matches an extension-qualified tool name', () => {
    const c = cardFor('bundled.history-search', { entries: [{ role: 'user', content: 'hi' }] }, {})!
    expect(c.body!.kind).toBe('messages')
  })

  it('service-list renders a clickable list body', () => {
    const c = cardFor('service-list', { services: [{ name: 'db', phase: 'Running', image: 'i', url: 'http://db', session: '', publicUrl: 'https://db.x' }] }, {})!
    expect(c.body!.kind).toBe('list')
    expect((c.body as { rows: Array<{ link: unknown }> }).rows[0]!.link).toMatchObject({ kind: 'service_detail', name: 'db' })
  })

  it('sandbox-list renders a clickable list body', () => {
    const c = cardFor('sandbox-list', { sandboxes: [{ name: 'sb', phase: 'Running', image: 'i', url: 'u', creator: 't', session: 's' }] }, {})!
    expect((c.body as { rows: Array<{ link: unknown }> }).rows[0]!.link).toMatchObject({ kind: 'sandbox_detail', name: 'sb' })
  })

  it('file-read renders a code body', () => {
    const c = cardFor('file-read', { code: 'abc', total_lines: 2, start: 0, shown: 2, name: 'a.go' }, {}, '1  package main\n2  func main(){}')!
    expect(c.body).toMatchObject({ kind: 'code', name: 'a.go' })
  })

  it('web-fetch renders markdown; file-info renders kv', () => {
    expect(cardFor('web-fetch', { url: 'https://x', format: 'markdown' }, {}, '# Hi')!.body!.kind).toBe('markdown')
    const fi = cardFor('file-info', { code: 'abc', meta: { name: 'x.png', mime: 'image/png', size: 12, sha256: 'ff' } }, {})!
    expect(fi.body!.kind).toBe('kv')
  })

  it('audio-transcribe / image-read render audio / media bodies', () => {
    expect(cardFor('audio-transcribe', { code: 'a1' }, {}, 'hello')!.body!.kind).toBe('audio')
    expect(cardFor('image-read', { code: 'i1', mime: 'image/png' }, {}, 'a cat')!.body!.kind).toBe('media')
  })

  it('falls back to input coordinates and returns null for unknown tools', () => {
    const c = cardFor('repo-file-read', {}, { org: 'a', repo: 'b', ref: 'main', path: 'p' })!
    expect(c.actions![0]!.page).toMatchObject({ kind: 'repo_blob', path: 'p' })
    expect(cardFor('image-generate', {}, {})).not.toBeNull()
    expect(cardFor('repo-file-read', { org: 'a' }, {})).toBeNull()
  })
})
