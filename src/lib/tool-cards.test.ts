import { describe, expect, it } from 'vitest'
import { cardFor } from './tool-cards'

describe('cardFor', () => {
  it('repo-read: path + line range + blob sha + open-file action', () => {
    const c = cardFor('repo-read', { org: 'acme', repo: 'web', ref: 'main', path: 'a.ts', sha: 'deadbeefcafe', total_lines: 100, start: 0, shown: 40 }, {})!
    expect(c.subtitle).toBe('acme/web @ main')
    expect(c.fields.map(f => f.label)).toEqual(['path', 'lines', 'blob'])
    expect(c.fields[1]!.value).toBe('L1–L40 / 100')
    expect(c.actions![0]!.page).toMatchObject({ kind: 'repo_blob', path: 'a.ts' })
  })

  it('repo-edit: changes + inline diff + commit/file actions', () => {
    const c = cardFor('repo-edit', { org: 'a', repo: 'b', ref: 'dev', path: 'x', commit: 'abc123', added: 3, removed: 1, diff: '@@ -1 +1 @@' }, {})!
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

  it('falls back to input coordinates and returns null for unknown tools', () => {
    const c = cardFor('repo-read', {}, { org: 'a', repo: 'b', ref: 'main', path: 'p' })!
    expect(c.actions![0]!.page).toMatchObject({ kind: 'repo_blob', path: 'p' })
    expect(cardFor('web-fetch', {}, {})).toBeNull()
    expect(cardFor('repo-read', { org: 'a' }, {})).toBeNull()
  })
})
