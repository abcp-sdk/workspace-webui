import { describe, expect, it } from 'vitest'
import { toolLinks } from './tool-links'

describe('toolLinks', () => {
  it('repo-read links to the file content only (its sha is a BLOB sha)', () => {
    const links = toolLinks(
      'repo-read',
      { org: 'acme', repo: 'web', ref: 'main', path: 'src/a.ts', sha: 'abc123def456' },
      {},
    )
    expect(links).toHaveLength(1)
    expect(links[0]!.page).toMatchObject({ kind: 'repo_blob', org: 'acme', repo: 'web', ref: 'main', path: 'src/a.ts' })
  })

  it('falls back to input for coordinates when data lacks them', () => {
    const links = toolLinks('repo-read', {}, { org: 'acme', repo: 'web', ref: 'dev', path: 'x.md' })
    expect(links[0]!.page).toMatchObject({ kind: 'repo_blob', ref: 'dev', path: 'x.md' })
  })

  it('repo-write links to the resulting commit + file', () => {
    const links = toolLinks('repo-write', { org: 'a', repo: 'b', ref: 'main', path: 'p', commit: 'deadbeef' }, {})
    expect(links.map(l => l.page.kind)).toEqual(['repo_commit', 'repo_blob'])
  })

  it('repo-diff links to a compare page', () => {
    const links = toolLinks('repo-diff', { org: 'a', repo: 'b', base: 'main', head: 'feat' }, {})
    expect(links[0]!.page).toMatchObject({ kind: 'repo_compare', base: 'main', head: 'feat' })
  })

  it('repo-log with a path links to file history; without, the repo', () => {
    const withPath = toolLinks('repo-log', { org: 'a', repo: 'b', ref: 'main', path: 'f.ts' }, {})
    expect(withPath[0]!.page.kind).toBe('repo_history')
    const noPath = toolLinks('repo-log', { org: 'a', repo: 'b', ref: 'main' }, {})
    expect(noPath[0]!.page.kind).toBe('repo_detail')
  })

  it('repo-mr-create links to the MR page', () => {
    const links = toolLinks('repo-mr-create', { org: 'a', repo: 'b', index: 7 }, {})
    expect(links[0]!.page).toMatchObject({ kind: 'repo_mr', index: 7 })
  })

  it('service-deploy / sandbox-create link to their detail pages', () => {
    expect(toolLinks('service-deploy', { name: 'db' }, {})[0]!.page).toMatchObject({ kind: 'service_detail', name: 'db' })
    expect(toolLinks('sandbox-create', { name: 'sb' }, {})[0]!.page).toMatchObject({ kind: 'sandbox_detail', name: 'sb' })
  })

  it('returns nothing for an unknown tool or missing coordinates', () => {
    expect(toolLinks('web-fetch', {}, {})).toEqual([])
    expect(toolLinks('repo-read', { org: 'a' }, {})).toEqual([])
  })
})
