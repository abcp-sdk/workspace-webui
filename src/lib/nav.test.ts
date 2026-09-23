// Navigation-stack tests — the push/replace/sibling/pop rules.
import { describe, expect, it } from 'vitest'
import {
  type AppPage,
  popPage,
  pushChild,
  pushPage,
  pushSibling,
  rootPageFor,
} from './nav'

const root = rootPageFor('chat')
const session: AppPage = { kind: 'chat_session', key: 'chat_session' }

describe('rootPageFor', () => {
  it('maps each tab to its root', () => {
    expect(rootPageFor('chat')).toEqual({ kind: 'chat_list', key: 'chat_list' })
    expect(rootPageFor('config')).toEqual({
      kind: 'config_root',
      key: 'config_root',
    })
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

  it('keeps code_root + a repo detail side by side', () => {
    const codeRoot = rootPageFor('code')
    const detail: AppPage = {
      kind: 'repo_detail',
      key: 'repo:acme/web@main',
      org: 'acme',
      repo: 'web',
      ref: 'main',
    }
    expect(pushSibling([codeRoot], detail)).toEqual([codeRoot, detail])
  })

  it('replaces the detail with a blob, then back to the detail', () => {
    const codeRoot = rootPageFor('code')
    const detail: AppPage = {
      kind: 'repo_detail',
      key: 'repo:acme/web@main',
      org: 'acme',
      repo: 'web',
      ref: 'main',
    }
    const blob: AppPage = {
      kind: 'repo_blob',
      key: 'blob:acme/web@main:README.md',
      org: 'acme',
      repo: 'web',
      ref: 'main',
      path: 'README.md',
    }
    const withBlob = pushSibling([codeRoot, detail], blob)
    expect(withBlob).toEqual([codeRoot, blob])
    expect(pushSibling(withBlob, detail)).toEqual([codeRoot, detail])
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

  it('appends a child of a different kind (keeps tree + detail + blob)', () => {
    expect(pushChild([codeRoot, detail], blobA)).toEqual([codeRoot, detail, blobA])
  })

  it('replaces the top when the same kind is already on top (bounded stack)', () => {
    expect(pushChild([codeRoot, detail, blobA], blobB)).toEqual([codeRoot, detail, blobB])
  })

  it('appends from a bare root', () => {
    expect(pushChild([codeRoot], detail)).toEqual([codeRoot, detail])
  })

  it('builds the five-level file chain tree > detail > blob > history > diff', () => {
    const history: AppPage = {
      kind: 'repo_history',
      key: 'hist:acme/web@main:README.md',
      org: 'acme',
      repo: 'web',
      ref: 'main',
      path: 'README.md',
    }
    const histDiff: AppPage = {
      kind: 'repo_history_diff',
      key: 'histdiff:acme/web@main:README.md:abc123',
      org: 'acme',
      repo: 'web',
      ref: 'main',
      path: 'README.md',
      sha: 'abc123',
    }
    let stack: AppPage[] = [codeRoot, detail]
    stack = pushChild(stack, blobA)
    stack = pushChild(stack, history)
    stack = pushChild(stack, histDiff)
    expect(stack).toEqual([codeRoot, detail, blobA, history, histDiff])
  })

  it('opens a commit and a change request as their own pages', () => {
    const commit: AppPage = { kind: 'repo_commit', key: 'commit:acme/web@abc', org: 'acme', repo: 'web', ref: 'main', sha: 'abc' }
    const mr: AppPage = { kind: 'repo_mr', key: 'mr:acme/web:1', org: 'acme', repo: 'web', index: 1 }
    expect(pushChild([codeRoot, detail], commit)).toEqual([codeRoot, detail, commit])
    expect(pushChild([codeRoot, detail, commit], mr)).toEqual([codeRoot, detail, commit, mr])
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
