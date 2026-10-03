import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentApi } from './api'
import { makeStreamEvent, type StreamEvent } from './events'
import { SessionStream, type StreamHandlers } from './session-stream'

/** A streamEvents stub that records the (sinceSeq, sinceMsg) it was called with
 *  and yields the queued events, then never resolves (the stream stays open). */
function stubApi(): {
  api: AgentApi
  calls: Array<{ sinceSeq: number; sinceMsg: string }>
  push: (ev: StreamEvent) => void
} {
  const calls: Array<{ sinceSeq: number; sinceMsg: string }> = []
  const queue: StreamEvent[] = []
  const waiters: Array<(ev: StreamEvent) => void> = []
  const api = {
    streamEvents: async function* (
      _sid: string,
      sinceSeq = 0,
      signal?: AbortSignal,
      sinceMsg = '',
    ) {
      calls.push({ sinceSeq, sinceMsg })
      for (;;) {
        if (signal?.aborted) return
        const next =
          queue.shift() ??
          (await new Promise<StreamEvent | null>(r => {
            waiters.push(r as (ev: StreamEvent) => void)
            signal?.addEventListener('abort', () => r(null), { once: true })
          }))
        if (next === null) return
        yield next
      }
    },
  } as unknown as AgentApi
  return {
    api,
    calls,
    push: ev => {
      const w = waiters.shift()
      if (w) w(ev)
      else queue.push(ev)
    },
  }
}

function handlers(over: Partial<StreamHandlers> = {}): StreamHandlers {
  return {
    getSessionId: () => 's1',
    getSinceMsg: () => '',
    isSending: () => false,
    onEvent: () => {},
    onRunBoundary: () => {},
    onIdle: () => {},
    onStreamClosed: () => {},
    onBusy: () => {},
    onDisconnected: () => {},
    onConnected: () => {},
    ...over,
  }
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('SessionStream refresh resume', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useRealTimers()
  })

  it('a FRESH connect with no persisted seq sends sinceSeq=0 and the sinceMsg fallback', async () => {
    const { api, calls } = stubApi()
    const s = new SessionStream(api, handlers({ getSinceMsg: () => 'msg-42' }))
    s.connect('s1')
    await flush()
    expect(calls[0]).toEqual({ sinceSeq: 0, sinceMsg: 'msg-42' })
    s.dispose()
  })

  it('persists the newest event seq and RESUMES from it after a page refresh', async () => {
    const { api, calls, push } = stubApi()
    const s1 = new SessionStream(api, handlers())
    s1.connect('s1')
    await flush()
    // A live event advances + persists the sequence.
    push(makeStreamEvent('text-delta', {}, 'e1', 'r1', 1234))
    await flush()
    expect(sessionStorage.getItem('ws.session.seq.s1')).toBe('1234')
    s1.dispose()

    // A NEW SessionStream (simulating a page refresh) resumes from the stored
    // seq, so it does NOT fall back to sinceMsg.
    const { api: api2, calls: calls2 } = stubApi()
    const s2 = new SessionStream(
      api2,
      handlers({ getSinceMsg: () => 'msg-42' }),
    )
    s2.connect('s1')
    await flush()
    expect(calls2[0]).toEqual({ sinceSeq: 1234, sinceMsg: '' })
    s2.dispose()
  })

  it('a DIFFERENT session does not inherit the previous session seq', async () => {
    const { api, calls, push } = stubApi()
    const s = new SessionStream(api, handlers({ getSessionId: () => 's2' }))
    s.connect('s1')
    await flush()
    push(makeStreamEvent('text-delta', {}, 'e1', 'r1', 999))
    await flush()
    s.connect('s2')
    await flush()
    expect(calls[calls.length - 1]).toEqual({ sinceSeq: 0, sinceMsg: '' })
    s.dispose()
  })
})
