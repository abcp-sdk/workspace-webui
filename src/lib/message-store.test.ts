// MessageStore bounds: the in-memory window is capped at HISTORY_CAP history
// rows so a long session never grows the load/render cost without bound, and
// `sorted` is cached (recomputed only when the list or revision changes).
import { describe, expect, it } from 'vitest'
import { HISTORY_CAP } from './message-order'
import { MessageStore } from './message-store.svelte'
import type { ChatMessage } from './models'

function msg(i: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${i}`,
    role: 'user',
    status: 'complete',
    parts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    prevId: i === 0 ? '' : `m${i - 1}`,
    isLocal: false,
    source: '',
    seq: i,
    ...over,
  }
}

describe('MessageStore.trimHistory', () => {
  it('is a no-op below the cap', () => {
    const s = new MessageStore()
    s.messages = [msg(0), msg(1), msg(2)]
    expect(s.trimHistory(true)).toBe(null)
    expect(s.messages).toHaveLength(3)
  })

  it('keeps the NEWEST cap rows when following the tail (drops oldest)', () => {
    const s = new MessageStore()
    const n = HISTORY_CAP + 5
    s.messages = Array.from({ length: n }, (_, i) => msg(i))
    expect(s.trimHistory(true)).toBe('oldest')
    expect(s.messages).toHaveLength(HISTORY_CAP)
    // Newest retained, oldest dropped.
    expect(s.messages[s.messages.length - 1]!.id).toBe(`m${n - 1}`)
    expect(s.messages.some(m => m.id === 'm0')).toBe(false)
  })

  it('keeps the OLDEST cap rows when the reader scrolled up (drops newest)', () => {
    const s = new MessageStore()
    const n = HISTORY_CAP + 5
    s.messages = Array.from({ length: n }, (_, i) => msg(i))
    expect(s.trimHistory(false)).toBe('newest')
    expect(s.messages).toHaveLength(HISTORY_CAP)
    expect(s.messages[0]!.id).toBe('m0')
    expect(s.messages.some(m => m.id === `m${n - 1}`)).toBe(false)
  })

  it('never drops local-only rows', () => {
    const s = new MessageStore()
    const n = HISTORY_CAP + 3
    s.messages = [
      ...Array.from({ length: n }, (_, i) => msg(i)),
      msg(9999, { id: 'err1', role: 'error', isLocal: true }),
    ]
    s.trimHistory(true)
    expect(s.messages.some(m => m.id === 'err1')).toBe(true)
  })
})

describe('MessageStore.sorted cache', () => {
  it('returns the SAME array until the list or revision changes', () => {
    const s = new MessageStore()
    s.messages = [msg(1, { seq: 1 }), msg(0, { seq: 0 })]
    const a = s.sorted
    expect(s.sorted).toBe(a) // cached, not recomputed
    s.notify() // revision bump invalidates
    expect(s.sorted).not.toBe(a)
  })
})

// ---- durable todos ----

/** A message carrying a `todo-write` tool part with the given statuses. */
function todoMsg(
  i: number,
  statuses: string[],
  over: Partial<ChatMessage> = {},
): ChatMessage {
  return msg(i, {
    role: 'assistant',
    parts: [
      {
        id: `t${i}`,
        type: 'tool',
        text: '',
        tool: 'todo-write',
        state: {
          status: 'complete',
          title: 'todo-write',
          input: {
            todos: statuses.map((st, k) => ({
              content: `task ${k}`,
              status: st,
              priority: 'medium',
            })),
          },
        },
      },
    ],
    ...over,
  })
}

const statusesOf = (s: MessageStore) => s.todos.map(t => t.status)

describe('MessageStore durable todos', () => {
  it('adopts the newest todo-write from a newer batch (live/delta)', () => {
    const s = new MessageStore()
    s.messages = [todoMsg(0, ['pending', 'pending'])]
    s.refreshTodosFromWindow()
    expect(statusesOf(s)).toEqual(['pending', 'pending'])
    // A later delta carries an updated list.
    s.adoptTodosFrom([todoMsg(5, ['completed', 'pending'])])
    expect(statusesOf(s)).toEqual(['completed', 'pending'])
  })

  it('adopts a LIVE todo-write immediately via addToolPart', () => {
    const s = new MessageStore()
    s.addToolPart('a1', 'tc1', 'todo-write', {
      todos: [{ content: 'x', status: 'in_progress', priority: 'high' }],
    })
    expect(statusesOf(s)).toEqual(['in_progress'])
  })

  it('does NOT roll back when the window slides to OLDER history', () => {
    const s = new MessageStore()
    // Window currently at the tail with a completed list.
    s.messages = [todoMsg(0, ['pending']), todoMsg(1, ['completed'])]
    s.refreshTodosFromWindow()
    expect(statusesOf(s)).toEqual(['completed'])
    // The reader scrolls up: the window slides, dropping the NEWEST row (the
    // one that carried the completed list). Todos must stay completed.
    s.hasNewer = true
    s.messages = [todoMsg(0, ['pending'])] // only the older todo-write remains
    s.trimHistory(false)
    // (trim is a no-op at 1 row, but the point stands: no re-derivation)
    expect(statusesOf(s)).toEqual(['completed'])
  })

  it('keeps the last list when a prepended batch has no todo-write', () => {
    const s = new MessageStore()
    s.messages = [todoMsg(1, ['completed'])]
    s.refreshTodosFromWindow()
    // Prepend older plain messages: adopting from them must not clear todos.
    s.adoptTodosFrom([msg(0), msg(0, { id: 'x' })])
    expect(statusesOf(s)).toEqual(['completed'])
  })

  it('reset() clears todos for a new session', () => {
    const s = new MessageStore()
    s.todos = [{ content: 'x', status: 'pending', priority: 'low' }]
    s.reset()
    expect(s.todos).toEqual([])
  })
})
