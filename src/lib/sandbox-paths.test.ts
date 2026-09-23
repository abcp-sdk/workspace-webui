import { beforeEach, describe, expect, it } from 'vitest'
import {
  absOf,
  basename,
  crumbsOf,
  displayPath,
  normAbs,
  parentOf,
  rootOf,
  setSandboxAnchors,
} from './sandbox-paths'

describe('sandbox-paths (unix anchors)', () => {
  beforeEach(() => {
    setSandboxAnchors({ workspace: '/root/workspace', home: '/root' })
  })

  it('normAbs collapses . and .. and keeps a leading slash', () => {
    expect(normAbs('/a//b/./c')).toBe('/a/b/c')
    expect(normAbs('/a/b/../c')).toBe('/a/c')
    expect(normAbs('/../..')).toBe('/')
  })

  it('absOf anchors relative paths on the workspace; absolute as-is', () => {
    expect(absOf('hello/main.go')).toBe('/root/workspace/hello/main.go')
    expect(absOf('')).toBe('/root/workspace')
    expect(absOf('.')).toBe('/root/workspace')
    expect(absOf('/etc/hosts')).toBe('/etc/hosts')
  })

  it('absOf resolves ~ against HOME (not the workspace)', () => {
    expect(absOf('~')).toBe('/root')
    expect(absOf('~/notes.txt')).toBe('/root/notes.txt')
  })

  it('displayPath shows home as ~ and the workspace as ~/workspace', () => {
    expect(displayPath('/root')).toBe('~')
    expect(displayPath('/root/notes.txt')).toBe('~/notes.txt')
    expect(displayPath('/root/workspace')).toBe('~/workspace')
    expect(displayPath('/root/workspace/a/b')).toBe('~/workspace/a/b')
    expect(displayPath('/etc/hosts')).toBe('/etc/hosts')
  })

  it('crumbsOf anchors on ~ inside home, else on /', () => {
    expect(crumbsOf('/root/workspace/a').map(c => c.name)).toEqual([
      '~',
      'workspace',
      'a',
    ])
    expect(crumbsOf('/etc').map(c => c.name)).toEqual(['/', 'etc'])
  })

  it('parentOf walks up to the root', () => {
    expect(parentOf('/root/workspace/a/b')).toBe('/root/workspace/a')
    expect(parentOf('/a')).toBe('/')
    expect(parentOf('/')).toBe('')
  })

  it('basename', () => {
    expect(basename('/a/b/c.txt')).toBe('c.txt')
    expect(basename('/a/b/')).toBe('b')
  })

  it('rootOf', () => {
    expect(rootOf('/a/b')).toBe('/')
  })
})

describe('sandbox-paths (windows anchors)', () => {
  beforeEach(() => {
    setSandboxAnchors({ workspace: 'C:/app', home: 'C:/Users/dev' })
  })

  it('keeps the drive and normalizes', () => {
    expect(normAbs('C:/a\\b/../c')).toBe('C:/a/c')
    expect(absOf('sub/x.txt')).toBe('C:/app/sub/x.txt')
    expect(rootOf('C:/app')).toBe('C:/')
    expect(parentOf('C:/app/sub')).toBe('C:/app')
  })

  it('displayPath shows ~ for the home', () => {
    expect(displayPath('C:/Users/dev')).toBe('~')
    expect(displayPath('C:/Users/dev/x')).toBe('~/x')
  })
})
