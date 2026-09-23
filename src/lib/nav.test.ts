// Navigation tests — the canonical ancestry (`stackFor`) plus the push/pop
// helpers kept for ad-hoc stack building.
import { describe, expect, it } from 'vitest'
import {
  type AppPage,
  popPage,
  pushChild,
  pushPage,
  pushSibling,
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

describe('rootPageFor', () => {
  it('maps each tab to its root', () => {
    expect(rootPageFor('chat')).toEqual({ kind: 'chat_list', key: 'chat_list' })
    expect(rootPageFor('config')).toEqual({
      kind: 'config_root',
      key: 'config_root',
    })
  })
})

describe('tabForPage', () => {
  it('routes each page kind to its tab', () => {
    expect(tabForPage(session)).toBe('chat')
    expect(
      tabForPage({
        kind: 'repo_blob',
        key: 'k',
        org: 'o',
        repo: 'r',
        ref: 'main',
        path: 'a',
      }),
    ).toBe('code')
    expect(
      tabForPage({ kind: 'sandbox_job', key: 'k', name: 'n', jobId: 'j' }),
    ).toBe('service')
    expect(tabForPage({ kind: 'provider_form', key: 'provider_form' })).toBe(
      'config',
    )
  })
})

describe('stackFor (canonical ancestry)', () => {
  it('is a single root for the four roots', () => {
    expect(stackFor(rootPageFor('chat'))).toHaveLength(1)
    expect(stackFor(rootPageFor('code'))).toHaveLength(1)
    expect(stackFor(rootPageFor('service'))).toHaveLength(1)
    expect(stackFor(rootPageFor('config'))).toHaveLength(1)
  })

  it('chat session hangs off the list; mailbox off the session', () => {
    expect(stackFor(session)).toEqual([root, session])
    expect(
      stackFor({
        kind: 'chat_overlay',
        key: 'chat_overlay',
        overlay: 'mailbox',
        session: 's1',
      }),
    ).toEqual([
      root,
      session,
      {
        kind: 'chat_overlay',
        key: 'chat_overlay',
        overlay: 'mailbox',
        session: 's1',
      },
    ])
  })

  it('builds the five-level file chain for repo_history_diff', () => {
    const stack = stackFor({
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

  it('a repo blob always carries its repo_detail parent (canonical)', () => {
    const stack = stackFor({
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

  it('commit/mr/release/compare parent under repo_detail', () => {
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
        head: 'feat',
      },
    ] as AppPage[]) {
      expect(stackFor(leaf).map(p => p.kind)).toEqual([
        'code_root',
        'repo_detail',
        leaf.kind,
      ])
    }
  })

  it('sandbox job nests under sandbox detail under service root', () => {
    expect(
      stackFor({ kind: 'sandbox_job', key: 'j', name: 'n', jobId: 'j1' }).map(
        p => p.kind,
      ),
    ).toEqual(['service_root', 'sandbox_detail', 'sandbox_job'])
  })
})

describe('pushPage', () => {
  it('appends a new page', () => {
    expect(pushPage([root], session)).toEqual([root, session])
  })

  it('replaces at the depth of a same-key page (truncating deeper pages)', () => {
    const a: AppPage = { kind: 'config_sub', key: 'sub', id: 'a' }
    const b: AppPage = { kind: 'config_sub', key: 'sub', id: 'b' }
    const stack = [root, a]
    expect(pushPage(stack, b)).toEqual([root, b])
  })

  it('does not mutate the input', () => {
    const stack = [root]
    pushPage(stack, session)
    expect(stack).toEqual([root])
  })
})

describe('pushSibling', () => {
  it('keeps the stack at [root, current] then pushes the sibling', () => {
    const a: AppPage = { kind: 'config_sub', key: 'a', id: 'a' }
    const b: AppPage = { kind: 'config_sub', key: 'b', id: 'b' }
    const stack: AppPage[] = [
      root,
      a,
      { kind: 'provider_form', key: 'provider_form' },
    ]
    expect(pushSibling(stack, b)).toEqual([root, b])
  })

  it('behaves like pushPage from a bare root', () => {
    expect(pushSibling([root], session)).toEqual([root, session])
  })
})

describe('pushChild', () => {
  const codeRoot = rootPageFor('code')
  const detail: AppPage = {
    kind: 'repo_detail',
    key: 'repo:acme/web@main',
    org: 'acme',
    repo: 'web',
    ref: 'main',
  }
  const blobA: AppPage = {
    kind: 'repo_blob',
    key: 'blob:acme/web@main:README.md',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    path: 'README.md',
  }
  const blobB: AppPage = {
    kind: 'repo_blob',
    key: 'blob:acme/web@main:src/index.ts',
    org: 'acme',
    repo: 'web',
    ref: 'main',
    path: 'src/index.ts',
  }

  it('appends a child of a different kind', () => {
    expect(pushChild([codeRoot, detail], blobA)).toEqual([
      codeRoot,
      detail,
      blobA,
    ])
  })

  it('replaces the top when the same kind is already on top (bounded stack)', () => {
    expect(pushChild([codeRoot, detail, blobA], blobB)).toEqual([
      codeRoot,
      detail,
      blobB,
    ])
  })

  it('appends from a bare root', () => {
    expect(pushChild([codeRoot], detail)).toEqual([codeRoot, detail])
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
