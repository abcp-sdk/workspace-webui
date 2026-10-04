// Guard: the checked-in ES bindings (src/gen/...) must match the agent proto.
// The gateway's `gen/es` output has historically lagged its Go output, so a
// stale descriptor silently keeps removed fields (or drops new ones). This
// asserts the Session descriptor carries the SINGLE-STEP counters only — the
// cumulative input/output/total_tokens (7/8/9) were removed in proto #4.
import { describe, expect, it } from 'vitest'
import { SessionSchema } from '../gen/agent/v1/agent_pb'

describe('Session ES descriptor', () => {
  it('has no cumulative token fields (7/8/9 were removed in proto #4)', () => {
    const names = new Set(SessionSchema.fields.map(f => f.name))
    expect(names.has('input_tokens')).toBe(false)
    expect(names.has('output_tokens')).toBe(false)
    expect(names.has('total_tokens')).toBe(false)
    const numbers = new Set(SessionSchema.fields.map(f => f.number))
    expect(numbers.has(7)).toBe(false)
    expect(numbers.has(8)).toBe(false)
    expect(numbers.has(9)).toBe(false)
  })

  it('keeps the single-step counters 10/11', () => {
    const byName = new Map(SessionSchema.fields.map(f => [f.name, f]))
    expect(byName.get('last_input_tokens')?.number).toBe(10)
    expect(byName.get('last_output_tokens')?.number).toBe(11)
  })
})
