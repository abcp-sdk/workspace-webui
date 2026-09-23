import { describe, expect, it } from 'vitest'
import { parseAnsi, stripAnsi } from './ansi'

describe('parseAnsi', () => {
  it('returns a single plain segment for text with no escapes', () => {
    expect(parseAnsi('hello world')).toEqual([{ text: 'hello world', cls: '' }])
  })

  it('colors a red run and resets', () => {
    const segs = parseAnsi('\x1b[31merr\x1b[0m ok')
    expect(segs).toEqual([
      { text: 'err', cls: 'text-red-400' },
      { text: ' ok', cls: '' },
    ])
  })

  it('handles bold + a bright color', () => {
    const segs = parseAnsi('\x1b[1;92mgo\x1b[0m')
    expect(segs).toEqual([{ text: 'go', cls: 'text-green-300 font-semibold' }])
  })

  it('treats a bare ESC[m as a reset', () => {
    const segs = parseAnsi('\x1b[31ma\x1b[mb')
    expect(segs).toEqual([
      { text: 'a', cls: 'text-red-400' },
      { text: 'b', cls: '' },
    ])
  })

  it('drops unknown/non-SGR escapes without losing text', () => {
    const segs = parseAnsi('a\x1b[Kb')
    expect(segs).toEqual([{ text: 'ab', cls: '' }])
  })

  it('ignores unsupported SGR codes (background, underline)', () => {
    const segs = parseAnsi('\x1b[4;44mx\x1b[0m')
    expect(segs).toEqual([{ text: 'x', cls: '' }])
  })
})

describe('stripAnsi', () => {
  it('removes all SGR sequences', () => {
    expect(stripAnsi('\x1b[1;31mred\x1b[0m plain')).toBe('red plain')
  })
})
