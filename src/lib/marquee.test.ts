import { describe, expect, it } from 'vitest'
import { marqueeCycle, marqueePlan } from './marquee'

describe('marqueePlan', () => {
  it('does not scroll when the text fits', () => {
    expect(marqueePlan(100, 80)).toEqual({ scroll: false, distance: 0 })
    expect(marqueePlan(100, 100)).toEqual({ scroll: false, distance: 0 })
  })

  it('ignores sub-pixel overflow (epsilon)', () => {
    expect(marqueePlan(100, 100.5).scroll).toBe(false)
  })

  it('scrolls by the overflow when the text is wider', () => {
    expect(marqueePlan(100, 140)).toEqual({ scroll: true, distance: 40 })
  })

  it('rounds fractional overflow up so the tail is fully revealed', () => {
    expect(marqueePlan(100, 140.2)).toEqual({ scroll: true, distance: 41 })
  })
})

describe('marqueeCycle', () => {
  it('holds 5s at each end by default', () => {
    const c = marqueeCycle(200)
    expect(c.holdMs).toBe(5000)
    expect(c.moveMs).toBe(5000) // 200px @ 40px/s
    expect(c.totalMs).toBe(15000)
  })

  it('moves at a CONSTANT speed: move time scales with distance', () => {
    // Same speed → a name twice as long takes twice as long to travel.
    expect(marqueeCycle(40).moveMs).toBe(1000)
    expect(marqueeCycle(80).moveMs).toBe(2000)
    expect(marqueeCycle(400).moveMs).toBe(10000)
  })

  it('exposes the hold/move offsets as fractions of the cycle', () => {
    const c = marqueeCycle(200, { pxPerSec: 40, holdMs: 5000 })
    // hold 5s, move 5s, hold 5s → total 15s.
    expect(c.startHoldPct).toBeCloseTo(5000 / 15000, 5)
    expect(c.tailPct).toBeCloseTo(10000 / 15000, 5)
  })

  it('honours custom speed and hold', () => {
    const c = marqueeCycle(100, { pxPerSec: 100, holdMs: 2000 })
    expect(c.moveMs).toBe(1000)
    expect(c.holdMs).toBe(2000)
    expect(c.totalMs).toBe(5000)
  })

  it('never produces a zero move time (a positive minimum)', () => {
    expect(marqueeCycle(0).moveMs).toBeGreaterThan(0)
  })
})
