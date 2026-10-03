import { describe, expect, it } from 'vitest'
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

describe('SessionStream resume anchor', () => {
  it('a FRESH connect (page load) sends sinceSeq=0 and the sinceMsg tip', async () => {
    const { api, calls } = stubApi()
    const s = new SessionStream(api, handlers({ getSinceMsg: () => 'msg-42' }))
    s.connect('s1')
    await flush()
    expect(calls[0]).toEqual({ sinceSeq: 0, sinceMsg: 'msg-42' })
    s.dispose()
  })

  it('a page refresh does NOT resume from a previous instance seq (regression)', async () => {
    // Instance 1: a live event advances the in-memory sequence to 1234.
    const a = stubApi()
    const s1 = new SessionStream(a.api, handlers())
    s1.connect('s1')
    await flush()
    a.push(makeStreamEvent('text-delta', {}, 'e1', 'r1', 1234))
    await flush()
    s1.dispose()

    // Instance 2 is a PAGE REFRESH (a brand-new SessionStream). It must NOT
    // resume from 1234 — the server would then skip the running turn's earlier
    // structural events. It replays from the tip message instead.
    const b = stubApi()
    const s2 = new SessionStream(
      b.api,
      handlers({ getSinceMsg: () => 'msg-42' }),
    )
    s2.connect('s1')
    await flush()
    expect(b.calls[0]).toEqual({ sinceSeq: 0, sinceMsg: 'msg-42' })
    s2.dispose()
  })

  it('a SAME-PAGE reconnect resumes by sequence (O(1)) and drops sinceMsg', async () => {
    const { api, calls, push } = stubApi()
    const s = new SessionStream(api, handlers({ getSinceMsg: () => 'msg-42' }))
    s.connect('s1')
    await flush()
    push(makeStreamEvent('text-delta', {}, 'e1', 'r1', 1234))
    await flush()
    // The SAME instance reconnects: resume AFTER 1234, no sinceMsg.
    s.connect('s1')
    await flush()
    expect(calls[calls.length - 1]).toEqual({ sinceSeq: 1234, sinceMsg: '' })
    s.dispose()
  })

  it('switching to a DIFFERENT session resets the seq and uses the tip fallback', async () => {
    const { api, calls, push } = stubApi()
    const s = new SessionStream(
      api,
      handlers({ getSessionId: () => 's2', getSinceMsg: () => 'msg-9' }),
    )
    s.connect('s1')
    await flush()
    push(makeStreamEvent('text-delta', {}, 'e1', 'r1', 999))
    await flush()
    s.connect('s2')
    await flush()
    expect(calls[calls.length - 1]).toEqual({ sinceSeq: 0, sinceMsg: 'msg-9' })
    s.dispose()
  })
})
