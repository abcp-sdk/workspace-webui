import { describe, expect, it } from 'vitest'
import { gutterDigits, gutterWidth } from './line-gutter'

describe('gutterDigits', () => {
  it('reserves at least two digits', () => {
    expect(gutterDigits(1)).toBe(2)
    expect(gutterDigits(9)).toBe(2)
  })

  it('grows with the digit count of the largest line', () => {
    expect(gutterDigits(10)).toBe(2)
    expect(gutterDigits(99)).toBe(2)
    expect(gutterDigits(100)).toBe(3)
    expect(gutterDigits(99999)).toBe(5)
  })

  it('handles zero / negatives defensively', () => {
    expect(gutterDigits(0)).toBe(2)
    expect(gutterDigits(-5)).toBe(2)
  })
})

describe('gutterWidth', () => {
  it('returns a ch-based width plus a padding term', () => {
    expect(gutterWidth(100, 0)).toBe('calc(3ch + 0rem)')
    expect(gutterWidth(100, 1.25)).toBe('calc(3ch + 1.25rem)')
  })

  it('grows the ch term with the digit count', () => {
    expect(gutterWidth(99999, 0)).toBe('calc(5ch + 0rem)')
  })
})
