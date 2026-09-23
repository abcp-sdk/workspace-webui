// Session todos — derived from the LAST `todo-write` tool call in a session's
// message history. The bundled `todo-write` tool REPLACES the whole list each
// call (stored agent-side in `bundled_todos`), so the most recent call's input
// IS the current list. There is no todos RPC and no `todos-updated` event, so
// message history is the only source; the message store is reactive, so this
// updates live as the agent streams a new call.

import type { ChatMessage } from './models'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoPriority = 'high' | 'medium' | 'low'

export interface Todo {
  content: string
  status: TodoStatus
  priority: TodoPriority
}

const STATUSES: readonly TodoStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]
const PRIORITIES: readonly TodoPriority[] = ['high', 'medium', 'low']

/** True for the bundled todo tool, bare or extension-qualified. */
export function isTodoWrite(name: string | null | undefined): boolean {
  if (!name) return false
  return (
    name === 'todo-write' ||
    name === 'todowrite' ||
    name.endsWith('.todo-write')
  )
}

function asStatus(v: unknown): TodoStatus {
  return STATUSES.includes(v as TodoStatus) ? (v as TodoStatus) : 'pending'
}

function asPriority(v: unknown): TodoPriority {
  return PRIORITIES.includes(v as TodoPriority) ? (v as TodoPriority) : 'medium'
}

/**
 * Parse a `todo-write` tool input (`{ todos: [...] }`) into a typed list.
 * Returns null when the shape is not a todo list (so callers can tell "not a
 * todo call" / "still streaming" from "empty list").
 */
export function parseTodos(input: unknown): Todo[] | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return null
  const raw = (input as Record<string, unknown>)['todos']
  if (!Array.isArray(raw)) return null
  const out: Todo[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item))
      continue
    const o = item as Record<string, unknown>
    const content = typeof o['content'] === 'string' ? o['content'] : ''
    out.push({
      content,
      status: asStatus(o['status']),
      priority: asPriority(o['priority']),
    })
  }
  return out
}

/**
 * The session's current todos: scan the messages NEWEST-first and return the
 * first `todo-write` whose input parses. Empty when the session has none.
 */
export function latestTodos(messages: readonly ChatMessage[]): Todo[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]!.parts
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j]!
      if (p.type !== 'tool' || !isTodoWrite(p.tool)) continue
      const todos = parseTodos(p.state?.input)
      if (todos !== null) return todos
    }
  }
  return []
}

/** Counts for the button badge: `remaining` = not completed and not cancelled. */
export function todoCounts(todos: readonly Todo[]): {
  total: number
  done: number
  remaining: number
} {
  let done = 0
  for (const t of todos)
    if (t.status === 'completed' || t.status === 'cancelled') done++
  return { total: todos.length, done, remaining: todos.length - done }
}
