// Bundled-extension cards: history, file-info / file-read, web-fetch, audio
// (transcribe / TTS), image-read, generation, cross-session and brave-search.
import {
  arr,
  basename,
  type CardCtx,
  type CardHandler,
  fin,
  fres,
  fs,
  n,
  pick,
  s,
  stripLineNumbers,
} from './shared'

const history: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'history-search' && tool !== 'history-range') return null
  const entries = arr<{
    role: string
    content: string
    tool_name?: string
    change_id?: string
    created_at?: string
    depth?: number
  }>(data, 'entries')
  return {
    subtitle: 'history',
    input: {
      fields: fs(
        fin(input, 'query', 'search', 'query'),
        fin(input, 'start', 'clock', 'start'),
        fin(input, 'end', 'clock', 'end'),
        fin(input, 'limit', 'list', 'limit', { mono: true }),
      ),
    },
    result: {
      fields: [
        { icon: 'history', label: 'entries', value: String(entries.length) },
      ],
      body: entries.length ? { kind: 'messages', entries } : undefined,
    },
  }
}

const fileInfo: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'file-info') return null
  const meta = (data['meta'] ?? {}) as Record<string, unknown>
  const rows = [
    { k: 'name', v: s(meta, 'name') },
    { k: 'mime', v: s(meta, 'mime'), mono: true },
    { k: 'size', v: String(n(meta, 'size')) },
    { k: 'sha256', v: s(meta, 'sha256'), mono: true },
  ].filter(r => r.v !== '')
  return {
    subtitle: s(meta, 'name') || s(data, 'code') || 'file',
    input: { fields: fs(fin(input, 'code', 'file', 'code', { mono: true })) },
    result: {
      fields: fs(
        s(data, 'code')
          ? {
              icon: 'file',
              label: 'code',
              value: s(data, 'code'),
              mono: true,
              tone: 'muted',
            }
          : null,
      ),
      body: rows.length ? { kind: 'kv', rows } : undefined,
    },
  }
}

const fileRead: CardHandler = ({ tool, data, input, output }) => {
  if (tool !== 'file-read') return null
  const name =
    s(data, 'name') || pick(data, input, 'name') || pick(data, input, 'code')
  const total = n(data, 'total_lines')
  const start = n(data, 'start')
  const shown = n(data, 'shown')
  const range = total > 0 ? `L${start + 1}–L${start + shown} / ${total}` : ''
  return {
    subtitle: name,
    input: {
      fields: fs(
        fin(input, 'code', 'file', 'code', { mono: true }),
        fin(input, 'name', 'file_code', 'name', { mono: true }),
        fin(input, 'offset', 'list', 'offset', { mono: true }),
        fin(input, 'limit', 'list', 'limit', { mono: true }),
      ),
    },
    result: {
      fields: fs(
        range
          ? { icon: 'list', label: 'lines', value: range, mono: true }
          : null,
      ),
      body: {
        kind: 'code',
        name: basename(name),
        text: stripLineNumbers(output),
        startLine: start + 1,
      },
    },
  }
}

const webFetch: CardHandler = ({ tool, data, input, output }) => {
  if (tool !== 'web-fetch') return null
  const url = s(data, 'url') || pick(data, input, 'url')
  const format = s(data, 'format') || pick(data, input, 'format')
  const ctype = s(data, 'contentType')
  return {
    subtitle: url,
    input: {
      fields: fs(
        fin(input, 'url', 'link', 'url', { mono: true, tone: 'muted' }),
        fin(input, 'format', 'list', 'format', { tone: 'muted' }),
      ),
    },
    result: {
      fields: fs(
        ctype
          ? {
              icon: 'file',
              label: 'type',
              value: ctype,
              mono: true,
              tone: 'muted',
            }
          : null,
        format
          ? { icon: 'list', label: 'format', value: format, tone: 'muted' }
          : null,
      ),
      body: { kind: 'markdown', text: output },
    },
  }
}

const audioTranscribe: CardHandler = ({ tool, data, input, output }) => {
  if (tool !== 'audio-transcribe') return null
  const code = pick(data, input, 'code')
  return {
    subtitle: s(data, 'name') || code || 'audio',
    input: {
      fields: fs(
        fin(input, 'code', 'file', 'code', { mono: true, tone: 'muted' }),
      ),
    },
    result: {
      fields: fs(
        s(data, 'name')
          ? { icon: 'file', label: 'name', value: s(data, 'name') }
          : null,
        fres(data, 'model', 'server', 'model', { mono: true, tone: 'muted' }),
      ),
      body: code
        ? { kind: 'audio', code, caption: output }
        : { kind: 'text', text: output },
    },
  }
}

const tts: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'tts-generate' && tool !== 'tts-clone') return null
  const files = arr<{ code: string; mime: string; name: string }>(data, 'files')
  const first = files[0]
  const text = pick(data, input, 'text')
  return {
    subtitle: 'tts',
    input: {
      fields: fs(
        fin(input, 'model', 'server', 'model', { mono: true, tone: 'muted' }),
        fin(input, 'reference', 'file', 'reference', {
          mono: true,
          tone: 'muted',
        }),
        fin(input, 'code', 'file', 'code', { mono: true, tone: 'muted' }),
      ),
      body: text ? { kind: 'text', text } : undefined,
    },
    result: {
      fields: fs(
        fres(data, 'model', 'server', 'model', { mono: true, tone: 'muted' }),
        fres(data, 'reference', 'file', 'reference', {
          mono: true,
          tone: 'muted',
        }),
      ),
      body: first?.code
        ? { kind: 'audio', code: first.code, caption: text }
        : undefined,
    },
  }
}

const imageRead: CardHandler = ({ tool, data, input, output }) => {
  if (tool !== 'image-read') return null
  const code = pick(data, input, 'code')
  return {
    subtitle: s(data, 'name') || code || 'image',
    input: {
      fields: fs(
        fin(input, 'code', 'file', 'code', { mono: true, tone: 'muted' }),
      ),
    },
    result: {
      fields: fs(
        s(data, 'name')
          ? { icon: 'file', label: 'name', value: s(data, 'name') }
          : null,
        fres(data, 'model', 'server', 'model', { mono: true, tone: 'muted' }),
      ),
      body: code
        ? {
            kind: 'media',
            code,
            mime: s(data, 'mime') || undefined,
            caption: output,
          }
        : { kind: 'text', text: output },
    },
  }
}

const generation: CardHandler = ({ tool, data, input }) => {
  if (
    tool !== 'image-generate' &&
    tool !== 'image-edit' &&
    tool !== 'video-generate'
  )
    return null
  return {
    subtitle: tool,
    input: {
      fields: fs(
        fin(input, 'prompt', 'sparkles', 'prompt'),
        fin(input, 'source', 'file', 'source', { mono: true, tone: 'muted' }),
        fin(input, 'code', 'file', 'code', { mono: true, tone: 'muted' }),
      ),
    },
    result: {
      fields: fs(
        fres(data, 'model', 'server', 'model', { mono: true, tone: 'muted' }),
        fres(data, 'source', 'file', 'source', { mono: true, tone: 'muted' }),
      ),
    },
  }
}

const subsessionCreate: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'subsession-create') return null
  const name = s(data, 'name') || pick(data, input, 'name')
  const desc = s(data, 'description') || pick(data, input, 'description')
  const prompt = pick(data, input, 'prompt')
  return {
    subtitle: name || 'subsession',
    input: {
      fields: fs(
        fin(input, 'name', 'bot', 'session', { mono: true }),
        fin(input, 'description', 'info', 'label'),
      ),
      body: prompt ? { kind: 'text', text: prompt } : undefined,
    },
    result: {
      fields: fs(
        name
          ? { icon: 'bot', label: 'session', value: name, mono: true }
          : null,
        desc ? { icon: 'info', label: 'label', value: desc } : null,
      ),
    },
  }
}

const mailSend: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'mail-send') return null
  const to = s(data, 'to') || pick(data, input, 'to')
  const text = s(data, 'text') || pick(data, input, 'text')
  return {
    subtitle: to || 'mail',
    input: {
      fields: fs(fin(input, 'to', 'mail', 'to', { mono: true })),
      body: text ? { kind: 'text', text } : undefined,
    },
    result: {
      fields: fs(
        to ? { icon: 'mail', label: 'to', value: to, mono: true } : null,
      ),
    },
  }
}

const braveSearch: CardHandler = ({ tool, data, input }) => {
  if (tool !== 'brave-search') return null
  const results = arr<{ title: string; url: string; description?: string }>(
    data,
    'results',
  )
  const query = s(data, 'query') || pick(data, input, 'query')
  return {
    subtitle: query || 'search',
    input: { fields: fs(fin(input, 'query', 'search', 'query')) },
    result: {
      fields: [
        { icon: 'list', label: 'results', value: String(results.length) },
      ],
      body: results.length
        ? {
            kind: 'list',
            rows: results.map(r => ({
              label: r.title || r.url,
              sub: r.description || r.url,
              icon: 'link',
            })),
          }
        : undefined,
    },
  }
}

/** Bundled-extension handlers, in match order. */
export const bundledHandlers: CardHandler[] = [
  history,
  fileInfo,
  fileRead,
  webFetch,
  audioTranscribe,
  tts,
  imageRead,
  generation,
  subsessionCreate,
  mailSend,
  braveSearch,
]

export type { CardCtx }
