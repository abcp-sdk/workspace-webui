import { describe, expect, it, vi } from 'vitest'
import { PageDataCache } from './page-cache'

describe('PageDataCache', () => {
  it('loads once and serves the cached value thereafter', async () => {
    const c = new PageDataCache()
    const load = vi.fn(async () => 42)
    expect(await c.load('k', load)).toBe(42)
    expect(await c.load('k', load)).toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('dedups concurrent loads of the same key', async () => {
    const c = new PageDataCache()
    let resolve!: (v: number) => void
    const load = vi.fn(() => new Promise<number>(r => (resolve = r)))
    const a = c.load('k', load)
    const b = c.load('k', load)
    resolve(7)
    expect(await a).toBe(7)
    expect(await b).toBe(7)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keys are independent', async () => {
    const c = new PageDataCache()
    expect(await c.load('a', async () => 1)).toBe(1)
    expect(await c.load('b', async () => 2)).toBe(2)
    expect(c.has('a')).toBe(true)
    expect(c.has('b')).toBe(true)
  })

  it('does not cache a rejected load (retries next time)', async () => {
    const c = new PageDataCache()
    const load = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(9)
    await expect(c.load('k', load)).rejects.toThrow('boom')
    expect(c.has('k')).toBe(false)
    expect(await c.load('k', load)).toBe(9)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('drop forces a refetch; set seeds a value', async () => {
    const c = new PageDataCache()
    const load = vi.fn(async () => 1)
    await c.load('k', load)
    c.set('k', 5)
    expect(c.get<number>('k')).toBe(5)
    c.drop('k')
    expect(c.has('k')).toBe(false)
    expect(await c.load('k', load)).toBe(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('dropPrefix removes only matching keys', async () => {
    const c = new PageDataCache()
    await c.load('repo:1', async () => 1)
    await c.load('repo:2', async () => 2)
    await c.load('sbx:1', async () => 3)
    c.dropPrefix('repo:')
    expect(c.has('repo:1')).toBe(false)
    expect(c.has('repo:2')).toBe(false)
    expect(c.has('sbx:1')).toBe(true)
  })
})
