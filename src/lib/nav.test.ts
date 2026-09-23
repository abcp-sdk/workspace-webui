// Navigation tests — the FOREST model: a page's ancestry is a pure function,
// and a path never contains two pages of the same kind (so sibling sessions
// can never share a path).
import { describe, expect, it } from 'vitest'
import {
  type AppPage,
  ancestry,
  laneOf,
  parentOf,
  popPage,
  pushPath,
  rootPageFor,
  stackFor,
  tabForPage,
} from './nav'

const root = rootPageFor('chat')
const session: AppPage = {
  kind: 'chat_session',
  key: 'chat_session',
  session: 's1',
}

describe('rootPageFor / laneOf', () => {
  it('maps each lane to its root', () => {
    expect(rootPageFor('chat')).toEqual({ kind: 'chat_list', key: 'chat_list' })
    expect(rootPageFor('code')).toEqual({ kind: 'code_root', key: 'code_root' })
    expect(rootPageFor('service')).toEqual({
      kind: 'service_root',
      key: 'service_root',
    })
    expect(rootPageFor('config')).toEqual({
      kind: 'config_root',
      key: 'config_root',
    })
  })

  it('routes each page kind to its lane', () => {
    expect(laneOf(session)).toBe('chat')
    expect(
      laneOf({
        kind: 'repo_blob',
        key: 'k',
        org: 'o',
        repo: 'r',
        ref: 'main',
        path: 'a',
      }),
    ).toBe('code')
    expect(
      laneOf({ kind: 'sandbox_job', key: 'k', name: 'n', jobId: 'j' }),
    ).toBe('service')
    expect(laneOf({ kind: 'provider_form', key: 'provider_form' })).toBe(
      'config',
    )
  })
})

describe('parentOf / ancestry (the forest)', () => {
  it('lane roots have no parent', () => {
    for (const lane of ['chat', 'code', 'service', 'config'] as const) {
      expect(parentOf(rootPageFor(lane))).toBeNull()
    }
  })

  it('every page kind reaches a root without repeating a kind', () => {
    const samples: AppPage[] = [
      session,
      {
        kind: 'chat_overlay',
        key: 'chat_overlay',
        overlay: 'mailbox',
        session: 's1',
      },
      { kind: 'config_sub', key: 'k', id: 'appearance' },
      { kind: 'providers_list', key: 'providers_list' },
      { kind: 'provider_form', key: 'provider_form' },
      { kind: 'provider_models', key: 'k', modelId: 'm' },
      { kind: 'repo_detail', key: 'k', org: 'o', repo: 'r', ref: 'main' },
      {
        kind: 'repo_blob',
        key: 'k',
        org: 'o',
        repo: 'r',
        ref: 'main',
        path: 'a',
      },
      {
        kind: 'repo_history',
        key: 'k',
        org: 'o',
        repo: 'r',
        ref: 'main',
        path: 'a',
      },
      {
        kind: 'repo_history_diff',
        key: 'k',
        org: 'o',
        repo: 'r',
        ref: 'main',
        path: 'a',
        sha: 'x',
      },
      {
        kind: 'repo_commit',
        key: 'k',
        org: 'o',
        repo: 'r',
        ref: 'main',
        sha: 'x',
      },
      { kind: 'repo_mr', key: 'k', org: 'o', repo: 'r', index: 1 },
      { kind: 'repo_release', key: 'k', org: 'o', repo: 'r', tag: 'v1' },
      { kind: 'repo_tag', key: 'k', org: 'o', repo: 'r', ref: 'v1' },
      {
        kind: 'repo_compare',
        key: 'k',
        org: 'o',
        repo: 'r',
        base: 'main',
        head: 'f',
      },
      { kind: 'sandbox_detail', key: 'k', name: 'sb' },
      { kind: 'sandbox_job', key: 'k', name: 'sb', jobId: 'j' },
      { kind: 'sandbox_files', key: 'k', name: 'sb', path: '' },
      { kind: 'service_detail', key: 'k', name: 'sv' },
    ]
    for (const leaf of samples) {
      const path = ancestry(leaf)
      expect(path.length).toBeGreaterThan(0)
      expect(path[path.length - 1]).toEqual(leaf)
      // no repeated kind — this is the invariant that forbids siblings in a path
      const kinds = path.map(p => p.kind)
      expect(new Set(kinds).size).toBe(kinds.length)
    }
  })

  it('builds the five-level file chain for repo_history_diff', () => {
    const stack = ancestry({
      kind: 'repo_history_diff',
      key: 'histdiff:o/r@main:a.md:abc',
      org: 'o',
      repo: 'r',
      ref: 'main',
      path: 'a.md',
      sha: 'abc',
    })
    expect(stack.map(p => p.kind)).toEqual([
      'code_root',
      'repo_detail',
      'repo_blob',
      'repo_history',
      'repo_history_diff',
    ])
  })

  it('a repo blob always carries its repo_detail parent', () => {
    const stack = ancestry({
      kind: 'repo_blob',
      key: 'blob:o/r@main:a',
      org: 'o',
      repo: 'r',
      ref: 'main',
      path: 'a',
    })
    expect(stack.map(p => p.kind)).toEqual([
      'code_root',
      'repo_detail',
      'repo_blob',
    ])
  })

  it('commit/mr/release/compare/tag parent under repo_detail', () => {
    for (const leaf of [
      {
        kind: 'repo_commit',
        key: 'c',
        org: 'o',
        repo: 'r',
        ref: 'main',
        sha: 'x',
      },
      { kind: 'repo_mr', key: 'm', org: 'o', repo: 'r', index: 1 },
      { kind: 'repo_release', key: 'rel', org: 'o', repo: 'r', tag: 'v1' },
      {
        kind: 'repo_compare',
        key: 'cmp',
        org: 'o',
        repo: 'r',
        base: 'main',
        head: 'f',
      },
      { kind: 'repo_tag', key: 't', org: 'o', repo: 'r', ref: 'v1' },
    ] as AppPage[]) {
      expect(ancestry(leaf).map(p => p.kind)).toEqual([
        'code_root',
        'repo_detail',
        leaf.kind,
      ])
    }
  })

  it('sandbox job nests under sandbox detail under service root', () => {
    expect(
      ancestry({ kind: 'sandbox_job', key: 'j', name: 'n', jobId: 'j1' }).map(
        p => p.kind,
      ),
    ).toEqual(['service_root', 'sandbox_detail', 'sandbox_job'])
  })

  it('sandbox files nests under sandbox detail under service root', () => {
    expect(
      ancestry({ kind: 'sandbox_files', key: 'f', name: 'n', path: '' }).map(
        p => p.kind,
      ),
    ).toEqual(['service_root', 'sandbox_detail', 'sandbox_files'])
  })

  it('stackFor is an alias of ancestry', () => {
    expect(stackFor(session)).toEqual(ancestry(session))
  })

  it('tabForPage is an alias of laneOf', () => {
    expect(tabForPage(session)).toBe(laneOf(session))
  })
})

describe('pushPath (the one-kind-per-path rule)', () => {
  it('appends a genuinely deeper kind', () => {
    const detail: AppPage = {
      kind: 'repo_detail',
      key: 'repo:o/r@main',
      org: 'o',
      repo: 'r',
      ref: 'main',
    }
    const blob: AppPage = {
      kind: 'repo_blob',
      key: 'blob:o/r@main:a',
      org: 'o',
      repo: 'r',
      ref: 'main',
      path: 'a',
    }
    expect(pushPath([rootPageFor('code'), detail], blob)).toEqual([
      rootPageFor('code'),
      detail,
      blob,
    ])
  })

  it('replaces a same-kind page at its depth (sibling swap)', () => {
    const a: AppPage = {
      kind: 'chat_session',
      key: 'chat_session',
      session: 'a',
    }
    const b: AppPage = {
      kind: 'chat_session',
      key: 'chat_session',
      session: 'b',
    }
    expect(pushPath([root, a], b)).toEqual([root, b])
  })

  it('a sibling swap truncates any deeper pages', () => {
    const a: AppPage = {
      kind: 'chat_session',
      key: 'chat_session',
      session: 'a',
    }
    const mailbox: AppPage = {
      kind: 'chat_overlay',
      key: 'chat_overlay',
      overlay: 'mailbox',
      session: 'a',
    }
    const b: AppPage = {
      kind: 'chat_session',
      key: 'chat_session',
      session: 'b',
    }
    expect(pushPath([root, a, mailbox], b)).toEqual([root, b])
  })

  it('can never produce two sessions in one path', () => {
    const a: AppPage = {
      kind: 'chat_session',
      key: 'chat_session',
      session: 'a',
    }
    const b: AppPage = {
      kind: 'chat_session',
      key: 'chat_session',
      session: 'b',
    }
    const path = pushPath(pushPath([root], a), b)
    expect(path.map(p => p.kind)).toEqual(['chat_list', 'chat_session'])
    expect((path[1] as { session: string }).session).toBe('b')
  })
})

describe('popPage', () => {
  it('pops the top page', () => {
    expect(popPage([root, session])).toEqual([root])
  })

  it('never pops below the root', () => {
    expect(popPage([root])).toEqual([root])
    expect(popPage([])).toEqual([])
  })
})
