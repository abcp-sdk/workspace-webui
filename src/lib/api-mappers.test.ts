import { describe, expect, it } from 'vitest'
import { messageFromPb } from './api-mappers'

/** Build a persisted tool call part (data.id = the AI SDK toolCallId). */
function toolPart(messageId: string, dbId: string, callId: string, name = 'sandbox-list') {
  return {
    id: dbId,
    messageId,
    type: 'tool',
    data: JSON.stringify({ id: callId, name, input: {} }),
  }
}
function toolResultPart(messageId: string, dbId: string, callId: string) {
  return {
    id: dbId,
    messageId,
    type: 'tool_result',
    data: JSON.stringify({ tool_use_id: callId, content: 'ok' }),
  }
}

describe('messageFromPb tool part ids', () => {
  it('keys a tool part by toolCallId (not the DB row id) so the live card is reused', () => {
    const msg = messageFromPb({
      id: 'm1',
      role: 'assistant',
      createdAt: '',
      prevId: '',
      source: '',
      parts: [toolPart('m1', 'db-uuid-1', 'tc-abc'), toolResultPart('m1', 'db-uuid-2', 'tc-abc')],
    })
    expect(msg.parts).toHaveLength(1)
    expect(msg.parts[0]!.id).toBe('tc-abc')
    expect(msg.parts[0]!.toolCallId).toBe('tc-abc')
    expect(msg.parts[0]!.state?.status).toBe('complete')
  })

  it('keys an orphan tool_result by tool_use_id', () => {
    const msg = messageFromPb({
      id: 'm2',
      role: 'assistant',
      createdAt: '',
      prevId: '',
      source: '',
      parts: [toolResultPart('m2', 'db-uuid-3', 'tc-orphan')],
    })
    expect(msg.parts).toHaveLength(1)
    expect(msg.parts[0]!.id).toBe('tc-orphan')
  })
})
