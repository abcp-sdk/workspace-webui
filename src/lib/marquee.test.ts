import { describe, expect, it } from 'vitest'
import { marqueeDuration, marqueePlan } from './marquee'

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

describe('marqueeDuration', () => {
  it('clamps to a sane floor and ceiling', () => {
    expect(marqueeDuration(1)).toBe(1200)
    expect(marqueeDuration(100000)).toBe(6000)
  })

  it('scales with distance at the default speed', () => {
    expect(marqueeDuration(200, 40)).toBe(5000)
  })
})
