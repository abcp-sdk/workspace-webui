// Route tests — encode/decode round-trips for every page kind, plus the
// canonical stack reconstruction (stackFor) from a decoded URL.
import { describe, expect, it } from 'vitest'
import type { AppPage } from './nav'
import { stackFor } from './nav'
import { decodeRoute, encodeRoute } from './route'

// Every page kind with a canonical example.
const cases: AppPage[] = [
  { kind: 'chat_list', key: 'chat_list' },
  { kind: 'chat_session', key: 'chat_session', session: 'acme:web:main' },
  {
    kind: 'chat_overlay',
    key: 'chat_overlay',
    overlay: 'mailbox',
    session: 's1',
  },
  { kind: 'code_root', key: 'code_root' },
  { kind: 'code_root', key: 'code_root', tab: 'commits', mrState: 'all' },
  { kind: 'repo_detail', key: 'k', org: 'acme', repo: 'web', ref: 'main' },
  {
    kind: 'repo_detail',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'feat/x',
    tab: 'changes',
    mrState: 'closed',
  },
  {
    kind: 'repo_blob',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    path: 'src/index.ts',
    view: 'blame',
  },
  {
    kind: 'repo_history',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    path: 'a/b.md',
  },
  {
    kind: 'repo_history_diff',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    path: 'a/b.md',
    sha: 'deadbeef',
  },
  {
    kind: 'repo_commit',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    sha: 'abc123',
  },
  {
    kind: 'repo_mr',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    index: 7,
  },
  {
    kind: 'repo_release',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    tag: 'v1.2.3',
  },
  {
    kind: 'repo_tag',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'v1.0.0',
    tab: 'tags',
  },
  {
    kind: 'repo_compare',
    key: 'k',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    base: 'main',
    head: 'feat/x',
  },
  { kind: 'service_root', key: 'service_root' },
  { kind: 'sandbox_detail', key: 'k', name: 'sbx-1' },
  { kind: 'sandbox_job', key: 'k', name: 'sbx-1', jobId: 'job-9' },
  { kind: 'service_detail', key: 'k', name: 'svc-1' },
  {
    kind: 'service_detail',
    key: 'k',
    name: 'svc-1',
    logs: 'follow',
    prev: true,
  },
  { kind: 'config_root', key: 'config_root' },
  { kind: 'config_sub', key: 'k', id: 'appearance' },
  { kind: 'providers_list', key: 'providers_list' },
  { kind: 'provider_form', key: 'provider_form' },
  { kind: 'provider_models', key: 'k', modelId: 'gpt' },
]

describe('encode/decode round-trip', () => {
  for (const leaf of cases) {
    it(`${leaf.kind} ${JSON.stringify(leaf).slice(0, 60)}`, () => {
      const url = encodeRoute(leaf)
      const [path, search] = url.split('?')
      const back = decodeRoute(path!, search ? `?${search}` : '')
      expect(back).not.toBeNull()
      // `key` is a derived cache; compare the semantic fields.
      const { key: _ek, ...expected } = leaf as Record<string, unknown>
      const { key: _bk, ...got } = back!.leaf as Record<string, unknown>
      expect(got).toEqual(expected)
    })
  }
})

describe('decodeRoute special cases', () => {
  it('unknown paths return null', () => {
    expect(decodeRoute('/nope')).toBeNull()
    expect(decodeRoute('/code/acme/web/bogus')).toBeNull()
    expect(decodeRoute('/code/acme/web/blob')).toBeNull() // missing path
  })

  it('empty path is the chat list', () => {
    expect(decodeRoute('/')).toEqual({
      tab: 'chat',
      leaf: { kind: 'chat_list', key: 'chat_list' },
    })
  })

  it('repo kind defaults ref to main', () => {
    const r = decodeRoute('/code/acme/web/tree')
    expect(r?.leaf).toMatchObject({
      kind: 'repo_detail',
      org: 'acme',
      repo: 'web',
      ref: 'main',
    })
  })

  it('encodes slashes in session ids and file paths safely', () => {
    const url = encodeRoute({
      kind: 'repo_blob',
      key: 'k',
      org: 'o',
      repo: 'r',
      ref: 'main',
      path: 'a/b/c.ts',
    })
    expect(url).toContain('path=a%2Fb%2Fc.ts')
    const r = decodeRoute(...splitUrl(url))
    expect(r?.leaf).toMatchObject({ path: 'a/b/c.ts' })
  })
})

describe('stackFor from a decoded URL (canonical ancestry)', () => {
  it('deep-linking a blob restores the full code stack', () => {
    const r = decodeRoute('/code/acme/web/blob', '?ref=main&path=src/index.ts')!
    expect(stackFor(r.leaf).map(p => p.kind)).toEqual([
      'code_root',
      'repo_detail',
      'repo_blob',
    ])
  })

  it('deep-linking a sandbox job restores root + detail + job', () => {
    const r = decodeRoute('/service/sandboxes/sbx-1/jobs/job-9')!
    expect(stackFor(r.leaf).map(p => p.kind)).toEqual([
      'service_root',
      'sandbox_detail',
      'sandbox_job',
    ])
  })
})

function splitUrl(url: string): [string, string] {
  const i = url.indexOf('?')
  return i === -1 ? [url, ''] : [url.slice(0, i), url.slice(i)]
}
