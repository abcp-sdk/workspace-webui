import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatPart } from './models'
import {
  isTodoWrite,
  latestTodos,
  parseTodos,
  type Todo,
  todoCounts,
} from './todos'

function toolPart(name: string, input: Record<string, unknown>): ChatPart {
  return {
    id: `p-${name}-${Math.random()}`,
    type: 'tool',
    text: '',
    tool: name,
    state: { status: 'complete', title: name, input },
  }
}

function msg(parts: ChatPart[]): ChatMessage {
  return {
    id: `m${Math.random()}`,
    role: 'assistant',
    parts,
    createdAt: '',
    prevId: '',
    source: '',
    status: 'complete',
    seq: 0,
    isLocal: false,
  }
}

describe('isTodoWrite', () => {
  it('matches bare and extension-qualified names', () => {
    expect(isTodoWrite('todo-write')).toBe(true)
    expect(isTodoWrite('todowrite')).toBe(true)
    expect(isTodoWrite('bundled.todo-write')).toBe(true)
    expect(isTodoWrite('repo-write')).toBe(false)
    expect(isTodoWrite('')).toBe(false)
    expect(isTodoWrite(null)).toBe(false)
  })
})

describe('parseTodos', () => {
  it('parses a full list', () => {
    const got = parseTodos({
      todos: [{ content: 'a', status: 'in_progress', priority: 'high' }],
    })
    expect(got).toEqual([
      { content: 'a', status: 'in_progress', priority: 'high' },
    ])
  })

  it('defaults missing status/priority and tolerates junk items', () => {
    const got = parseTodos({
      todos: [
        { content: 'a' },
        null,
        'x',
        { content: 'b', status: 'weird', priority: 'nope' },
      ],
    })
    expect(got).toEqual([
      { content: 'a', status: 'pending', priority: 'medium' },
      { content: 'b', status: 'pending', priority: 'medium' },
    ])
  })

  it('returns null for a non-todo shape', () => {
    expect(parseTodos(null)).toBeNull()
    expect(parseTodos({})).toBeNull()
    expect(parseTodos({ todos: 'x' })).toBeNull()
    expect(parseTodos([])).toBeNull()
  })

  it('returns [] for an empty list', () => {
    expect(parseTodos({ todos: [] })).toEqual([])
  })
})

describe('latestTodos', () => {
  it('returns the LAST todo-write (overwrite semantics)', () => {
    const first = msg([
      toolPart('todo-write', {
        todos: [{ content: 'old', status: 'pending', priority: 'low' }],
      }),
    ])
    const second = msg([
      toolPart('todo-write', {
        todos: [{ content: 'new', status: 'completed', priority: 'high' }],
      }),
    ])
    expect(latestTodos([first, second])).toEqual([
      { content: 'new', status: 'completed', priority: 'high' },
    ])
  })

  it('ignores non-todo tools and empty history', () => {
    const m = msg([
      toolPart('repo-write', { path: 'a' }),
      toolPart('todo-write', {
        todos: [{ content: 't', status: 'pending', priority: 'medium' }],
      }),
    ])
    expect(latestTodos([m])).toHaveLength(1)
    expect(latestTodos([])).toEqual([])
  })

  it('skips a still-streaming todo-write (no input yet)', () => {
    const streaming: ChatPart = {
      id: 's',
      type: 'tool',
      text: '',
      tool: 'todo-write',
      state: {
        status: 'running',
        title: 'todo-write',
        inputText: '{"todos":[',
      },
    }
    const streamingMsg: ChatMessage = {
      ...msg([streaming]),
      status: 'streaming',
    }
    const done = msg([
      toolPart('todo-write', {
        todos: [{ content: 'ok', status: 'pending', priority: 'low' }],
      }),
    ])
    expect(latestTodos([streamingMsg, done])).toEqual([
      { content: 'ok', status: 'pending', priority: 'low' },
    ])
  })
})

describe('todoCounts', () => {
  it('counts remaining as not completed/cancelled', () => {
    const todos: Todo[] = [
      { content: 'a', status: 'completed', priority: 'high' },
      { content: 'b', status: 'cancelled', priority: 'low' },
      { content: 'c', status: 'in_progress', priority: 'medium' },
      { content: 'd', status: 'pending', priority: 'medium' },
    ]
    expect(todoCounts(todos)).toEqual({ total: 4, done: 2, remaining: 2 })
    expect(todoCounts([])).toEqual({ total: 0, done: 0, remaining: 0 })
  })
})
