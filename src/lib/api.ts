// AgentApi — a faithful port of flutter/lib/api.dart, retargeted at the
// workspace gateway.
//
// The webui speaks ONLY the workspace gateway (workspace.v1.WorkspaceService);
// it never talks to the agent directly. The gateway forwards the minimal,
// policy-free agent surface (chat/models/config/providers/files) and owns
// session creation (roles + immutable presets) and the sandbox/service
// lifecycle.

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import type { Session as PbSession } from '../gen/agent/v1/agent_pb.js'
import {
  IngestFileRequestSchema,
  IngestFileResponseSchema,
} from '../gen/agent/v1/agent_pb.js'
import {
  fireAuthExpired,
  isAuthError,
  makeStreamEvent,
  type StreamEvent,
} from './events'
import type {
  Identity,
  MailboxEntry,
  Message,
  MessagePart,
  ModelInfo,
  Preset,
  ProviderInfo,
  Session,
  ToolConfig,
  ToolConfigField,
  ToolInfo,
  ToolState,
  UploadedFile,
  UploadedFileSource,
} from './models'
import { modelRefOf } from './models'
import type { GatewayClient } from './workspace'
import { createGatewayClient } from './workspace'

const n = (v: bigint | number | undefined | null): number =>
  v == null ? 0 : typeof v === 'bigint' ? Number(v) : v

function decodeJson(data: string): Record<string, unknown> {
  if (!data) return {}
  try {
    const v = JSON.parse(data)
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

// ---- pb → model mappers (agent native) ----

/** google.protobuf.Value (kind oneof) → plain JSON value. */
function valueToJson(v: unknown): unknown {
  if (!v || typeof v !== 'object') return null
  const k = (v as { kind?: { case?: string; value?: unknown } }).kind
  if (!k?.case) return null
  switch (k.case) {
    case 'nullValue':
      return null
    case 'numberValue':
    case 'stringValue':
    case 'boolValue':
      return k.value
    case 'listValue':
      return ((k.value as { values?: unknown[] })?.values ?? []).map(
        valueToJson,
      )
    case 'structValue':
      return structToJson(k.value)
    default:
      return null
  }
}

function structToJson(v: unknown): Record<string, unknown> {
  const fields = (v as { fields?: Record<string, unknown> })?.fields
  if (!fields) return {}
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(fields)) out[k] = valueToJson(val)
  return out
}

export function sessionFromPb(s: PbSession): Session {
  // Sessions created through the workspace gateway are named `org:repo:branch`.
  // The agent's Session carries legacy org/repo/branch fields that are NOT
  // populated for gateway sessions, so derive them from the name (and never
  // overwrite a populated value).
  const parts = s.name.split(':')
  const [dOrg, dRepo, dBranch] =
    parts.length === 3 ? (parts as [string, string, string]) : ['', '', '']
  return {
    id: s.name,
    org: s.org || dOrg,
    repo: s.repo || dRepo,
    branch: s.branch || dBranch,
    model: s.model,
    variant: s.variant,
    preset: s.preset,
    tipId: s.tipId || undefined,
    maxTurns: s.maxTurns || undefined,
    systemPrompt: s.systemPrompt || undefined,
    locale: s.locale || undefined,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    totalTokens: s.totalTokens,
    lastInputTokens: s.lastInputTokens,
    lastOutputTokens: s.lastOutputTokens,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    unreadCount: s.unreadCount,
    lastMessageAt: s.lastMessageAt,
    lastMessagePreview: s.lastMessagePreview,
    messageSeq: s.messageSeq,
    group: s.group,
  }
}

type PbPart = {
  id: string
  messageId: string
  type: string
  data: string
}

type PbMessage = {
  id: string
  role: string
  createdAt: string
  prevId: string
  parts: PbPart[]
}

export function messageFromPb(m: PbMessage): Message {
  // Pair each tool call with its result (tool_use_id) so history renders one
  // tool card per call — matching the live stream shape.
  const decoded = m.parts.map(p => [p, decodeJson(p.data)] as const)
  const results: Record<string, Record<string, unknown>> = {}
  for (const [p, d] of decoded) {
    if (p.type === 'tool_result') {
      const id = d['tool_use_id'] as string | undefined
      if (id) results[id] = d
    }
  }
  const parts: MessagePart[] = []
  for (const [p, d] of decoded) {
    switch (p.type) {
      case 'text':
        parts.push({
          id: p.id,
          type: 'text',
          text: (d['text'] as string) || '',
        })
        break
      case 'reasoning':
        parts.push({
          id: p.id,
          type: 'reasoning',
          text: (d['text'] as string) || '',
        })
        break
      case 'summary':
      case 'compaction':
        parts.push({
          id: p.id,
          type: 'compaction',
          text: (d['summary'] as string) || '',
        })
        break
      case 'file':
        parts.push({
          id: p.id,
          type: 'file',
          code: (d['code'] as string) || '',
          name: (d['name'] as string) || '',
          mime: d['mime'] as string | undefined,
          size: d['size'] != null ? Number(d['size']) : undefined,
          width: d['width'] != null ? Number(d['width']) : undefined,
          height: d['height'] != null ? Number(d['height']) : undefined,
          durationMs:
            d['duration_ms'] != null
              ? Number(d['duration_ms'])
              : d['durationMs'] != null
                ? Number(d['durationMs'])
                : undefined,
          thumbCode:
            (d['thumb_code'] as string | undefined) ??
            (d['thumbCode'] as string | undefined),
          thumbhash: (d['thumbhash'] as string | undefined) ?? undefined,
        })
        break
      case 'tool': {
        const callId = (d['id'] as string) || p.messageId
        const res = results[callId]
        const content = res?.['content']
        parts.push({
          id: p.id,
          type: 'tool',
          tool: (d['name'] as string) || '',
          toolCallId: callId,
          state: {
            status: res ? 'complete' : 'running',
            title: (d['name'] as string) || '',
            input: (d['input'] as Record<string, unknown>) || null,
            output: typeof content === 'string' ? content : null,
            data: (res?.['metadata'] as Record<string, unknown>) || null,
          },
        })
        break
      }
      case 'tool_result': {
        const id = (d['tool_use_id'] as string) || p.messageId
        if (results[id] && m.parts.some(q => q.type === 'tool')) break
        const content = d['content']
        parts.push({
          id: p.id,
          type: 'tool',
          tool: '',
          toolCallId: id,
          state: {
            status: 'complete',
            title: '',
            output: typeof content === 'string' ? content : null,
          },
        })
        break
      }
    }
  }
  return {
    id: m.id,
    role: m.role,
    createdAt: m.createdAt || null,
    prevId: m.prevId,
    parts,
  }
}

/**
 * Connect-unary POST of a pre-serialised protobuf message with upload
 * progress. `Content-Type: application/proto` + a bare message body is exactly
 * what the Connect binary unary protocol is; success returns the response
 * message (also bare protobuf), a Connect error is surfaced as an Error.
 *
 * The IngestFile RPC is forwarded by the gateway (`/agent.v1.*`), so the same
 * same-origin URL works.
 *
 * Falls back to `fallback()` when XHR progress is unusable (no
 * XMLHttpRequest, or the transport refuses the hand-rolled request), so the
 * upload itself can never regress just because progress is unavailable.
 */
function uploadIngest(
  baseUrl: string,
  token: string,
  body: Uint8Array,
  onProgress: ((done: number, total: number) => void) | undefined,
  fallback: () => Promise<{ code: string; mime: string }>,
): Promise<{ code: string; mime: string }> {
  if (typeof XMLHttpRequest === 'undefined' || onProgress === undefined) {
    return fallback()
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const useFallback = () => {
      if (settled) return
      settled = true
      fallback().then(resolve, reject)
    }
    try {
      xhr.open('POST', `${baseUrl}/agent.v1.AgentService/IngestFile`, true)
      xhr.responseType = 'arraybuffer'
      xhr.setRequestHeader('Content-Type', 'application/proto')
      xhr.setRequestHeader('Connect-Protocol-Version', '1')
      if (token !== '') xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    } catch {
      useFallback()
      return
    }
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onerror = () => useFallback()
    xhr.ontimeout = () => useFallback()
    xhr.onload = () => {
      if (settled) return
      if (xhr.status >= 200 && xhr.status < 300) {
        settled = true
        try {
          const msg = fromBinary(
            IngestFileResponseSchema,
            new Uint8Array(xhr.response as ArrayBuffer),
          )
          resolve({ code: msg.code, mime: msg.mime })
        } catch (e) {
          reject(e)
        }
        return
      }
      // A protocol-level refusal (auth/validation): surface it as an error
      // rather than silently retrying through the fallback transport.
      settled = true
      reject(
        new Error(
          `upload failed: HTTP ${xhr.status} ${
            xhr.response instanceof ArrayBuffer
              ? new TextDecoder().decode(new Uint8Array(xhr.response))
              : ''
          }`.trim(),
        ),
      )
    }
    // Copy into a plain ArrayBuffer to satisfy the XHR body types (TS models
    // Uint8Array's buffer as ArrayBufferLike, which may be a SharedArrayBuffer).
    xhr.send(body.slice().buffer)
  })
}

// ---- the facade ----

export interface AgentApiEvents {
  onAuthExpired?: (reason: 'expired' | 'addedUser') => void
}

export class AgentApi {
  readonly baseUrl: string
  readonly token: string
  private readonly _c: GatewayClient

  private constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
    this._c = createGatewayClient(baseUrl, token)
  }

  static async create(baseUrl: string, token: string): Promise<AgentApi> {
    // Web has no bundled CA (the browser trust store + CORS apply).
    return new AgentApi(baseUrl, token)
  }

  /** Wrap an RPC so 401/403 anywhere raises the global auth-expired dialog. */
  private async _guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (isAuthError(e)) fireAuthExpired('expired')
      throw e
    }
  }

  // ---- sessions ----

  async listSessions(): Promise<Session[]> {
    return await this._guard(async () => {
      const r = await this._c.listSessions({})
      return r.sessions.map(sessionFromPb)
    })
  }

  /**
   * Create a repo-bound workspace session (`org:repo:branch`). The gateway
   * derives the role from the branch (main → maintainer, else developer) and
   * binds the immutable preset. `model`/`image` are optional.
   */
  async ensureBranchSession(
    org: string,
    repo: string,
    branch: string,
    model = '',
    image = '',
  ): Promise<Session> {
    const r = await this._guard(() =>
      this._c.ensureBranchSession({ org, repo, branch, model, image }),
    )
    const w = r.branchSession
    return w ? branchSessionToSession(w) : emptySession('')
  }

  /** Create a free session with a tenant-scoped role (admin|explorer|planner). */
  async createFreeSession(
    name: string,
    role: 'admin' | 'explorer' | 'planner',
    model = '',
  ): Promise<Session> {
    const r = await this._guard(() =>
      this._c.createFreeSession({ name, role, model }),
    )
    return emptySession(r.session)
  }

  async getSession(id: string): Promise<Session> {
    const r = await this._c.getSession({ id })
    return r.session ? sessionFromPb(r.session) : emptySession('')
  }

  async deleteSession(id: string): Promise<void> {
    await this._c.deleteSession({ id })
  }

  async prompt(
    id: string,
    prompt: string,
    attachments: string[] = [],
  ): Promise<string> {
    // File codes MUST be forwarded as attachment refs; omitting them silently
    // drops every picked image / file / recording.
    for await (const ev of this._c.prompt({
      id,
      prompt,
      attachments: attachments.map(code => ({ code })),
    })) {
      if (ev.event === 'accepted') {
        return (
          ((ev.params as Record<string, unknown>)['message_id'] as string) || ''
        )
      }
    }
    return ''
  }

  // ---- attachment upload / download ----

  /**
   * Upload a file's bytes (IngestFile) reporting REAL byte-level progress.
   *
   * The Connect client has no upload-progress hook (fetch cannot report
   * request-body progress), so this issues the equivalent Connect-UNARY
   * request by hand with XMLHttpRequest: `Content-Type: application/proto`
   * plus the bare protobuf message body — byte-for-byte what
   * `createConnectTransport(useBinaryFormat: true)` sends for a unary call.
   * `xhr.upload.onprogress` then gives true `loaded/total` (including the
   * client's own send buffer), which is what makes the attachment tile's
   * "42%" honest rather than a fake timer. Falls back to the typed client
   * where XHR upload progress is unavailable.
   *
   * No mime is sent: the agent derives the authoritative type from the bytes.
   */
  async uploadFile(
    src: UploadedFileSource,
    onProgress?: (done: number, total: number) => void,
  ): Promise<UploadedFile> {
    const bytes = src.bytes
    if (!bytes?.length) throw new Error(`attachment has no bytes: ${src.name}`)
    const req = toBinary(
      IngestFileRequestSchema,
      create(IngestFileRequestSchema, { data: bytes, name: src.name }),
    )
    const out = await uploadIngest(
      this.baseUrl,
      this.token,
      req,
      onProgress,
      () => this._c.ingestFile({ data: bytes, name: src.name }),
    )
    return {
      code: out.code,
      name: src.name,
      mime: out.mime || src.mimeType,
      size: bytes.length,
      deduped: false,
      localPath: '',
      uploadState: 'done',
    }
  }

  async fetchFileBytes(code: string): Promise<Uint8Array> {
    const r = await this._c.getFile({ code })
    return r.data
  }

  /** Stream a file's bytes in order (GetFileStream, ConnectRPC). Yields chunks
   *  as they arrive so large media can render progressively. */
  async *streamFileBytes(code: string): AsyncGenerator<Uint8Array> {
    for await (const chunk of this._c.getFileStream({ code })) {
      if (chunk.data.length > 0) yield chunk.data
    }
  }

  /** Stream a file into a Blob, invoking `onProgress(done,total)` as it goes. */
  async streamFileBlob(
    code: string,
    mime: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Blob> {
    const parts: Uint8Array[] = []
    let done = 0
    let total = 0
    for await (const chunk of this._c.getFileStream({ code })) {
      parts.push(chunk.data)
      done += chunk.data.length
      total = Number(chunk.total)
      onProgress?.(done, total)
    }
    return new Blob(parts as BlobPart[], {
      type: mime || 'application/octet-stream',
    })
  }

  async fetchFileBlob(code: string): Promise<Blob> {
    const bytes = await this.fetchFileBytes(code)
    const meta = await this.fileHead(code)
    return new Blob([new Uint8Array(bytes)], {
      type: meta.contentType || 'application/octet-stream',
    })
  }

  async fileHead(code: string): Promise<{
    contentType: string | null
    length: number
    width?: number | null
    height?: number | null
    durationMs?: number | null
    thumbCode?: string | null
    thumbhash?: string | null
  }> {
    const r = await this._c.getFileMeta({ code })
    return {
      contentType: r.mime || null,
      length: Number(r.size),
      width: r.width ?? null,
      height: r.height ?? null,
      durationMs: r.durationMs != null ? Number(r.durationMs) : null,
      thumbCode: r.thumbCode ?? null,
      thumbhash: r.thumbhash ?? null,
    }
  }

  // ---- messages ----

  async messages(
    id: string,
    before?: string,
    limit = 30,
  ): Promise<[Message[], boolean]> {
    const r = await this._c.listMessages({ id, limit, before: before ?? '' })
    const msgs = r.messages.map(messageFromPb)
    return [msgs, msgs.length >= limit]
  }

  async messagesAfter(
    id: string,
    after: string,
    limit = 200,
  ): Promise<{ messages: Message[]; resync: boolean; tipId: string }> {
    const r = await this._c.listMessages({ id, limit, after })
    return {
      messages: r.messages.map(messageFromPb),
      resync: r.resync,
      tipId: r.tipId,
    }
  }

  // ---- session ops ----

  async switchModel(id: string, model: string, variant = ''): Promise<string> {
    await this._c.setModel({ id, model, variant })
    return model
  }

  /**
   * Update the ONLY user-editable session settings: model, variant, locale.
   * The preset / max_turns / system_prompt are bound by the gateway and are
   * not part of the workspace surface.
   */
  async settings(
    id: string,
    settings: Record<string, unknown>,
  ): Promise<Session> {
    const model = (settings['model'] as string) || ''
    const variant = (settings['variant'] as string) || ''
    const locale = (settings['locale'] as string) || ''
    const r = await this._guard(() =>
      this._c.updateSettings({
        id,
        ...(model ? { model } : {}),
        variant,
        locale,
      }),
    )
    return r.session ? sessionFromPb(r.session) : emptySession('')
  }

  /**
   * Fork a workspace session onto a NEW branch. The gateway derives org/repo
   * from the parent and binds the developer preset; branch materialization is
   * driven by the agent's `forked` lifecycle event.
   */
  async forkBranchSession(
    id: string,
    branch: string,
    messageId = '',
  ): Promise<Session> {
    const r = await this._guard(() =>
      this._c.forkBranchSession({ session: id, branch, messageId }),
    )
    const w = r.branchSession
    return w ? branchSessionToSession(w) : emptySession('')
  }

  async revert(id: string, messageId?: string | null): Promise<void> {
    await this._c.undo({ id, messageId: messageId ?? '' })
  }

  async interrupt(id: string): Promise<boolean> {
    const r = await this._c.interrupt({ id })
    return r.ok
  }

  async compact(id: string): Promise<boolean> {
    const r = await this._c.compact({ id })
    return r.ok
  }

  async state(id: string): Promise<[string, unknown[]]> {
    const r = await this._c.state({ id })
    const st = (r.state ?? {}) as Record<string, unknown>
    return [
      (st['status'] as string) || 'idle',
      (st['parts'] as unknown[]) || [],
    ]
  }

  /** One page of the mailbox, newest-first. `before` is the id of the oldest
   *  entry the caller already holds ('' = the newest page); `hasMore` says
   *  whether older entries remain. */
  async mailbox(
    id: string,
    before = '',
    limit = 0,
  ): Promise<{ entries: MailboxEntry[]; hasMore: boolean }> {
    const r = await this._c.mailbox({ id, before, limit })
    return {
      hasMore: r.hasMore,
      entries: r.mailbox.map(m => ({
        id: m.id,
        msgType: m.msgType,
        source: m.source,
        payload: m.payload,
        effectiveAt: m.effectiveAt || null,
        status: m.status,
        createdAt: m.createdAt,
        consumedAt: m.consumedAt || null,
      })),
    }
  }

  // ---- streams ----

  async *streamEvents(
    sessionId: string,
    since = '',
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    // The signal lets the controller tear down a HALF-OPEN stream (a socket
    // that never errors but stops delivering) and reconnect from the anchor.
    const opts = signal ? { signal } : undefined
    for await (const e of this._c.watchSession(
      { id: sessionId, since },
      opts,
    )) {
      const params = (e.params ?? {}) as Record<string, unknown>
      const runId = params['run_id']
      yield makeStreamEvent(
        e.event,
        params,
        e.eid,
        typeof runId === 'string' ? runId : '',
      )
    }
  }

  async *watchSessions(): AsyncGenerator<{
    snapshot: boolean
    upserts: Session[]
    removed: string[]
  }> {
    for await (const e of this._c.watchSessions({})) {
      yield {
        snapshot: e.snapshot,
        upserts: e.upserts.map(sessionFromPb),
        removed: [...e.removed],
      }
    }
  }

  // ---- config / providers / models / presets / tools ----

  async setToolConfigValue(
    extId: string,
    name: string,
    value: unknown,
  ): Promise<void> {
    await this._c.setExtensionConfig({
      extId,
      name,
      value: {
        kind: {
          case: 'stringValue',
          value: value == null ? '' : String(value),
        },
      },
    })
  }

  /** Server capability matrix (ListProvidersCatalog): canonical api type ->
   * capabilities a model of that type may declare. */
  async providerCatalog(): Promise<Record<string, string[]>> {
    const r = await this._guard(() => this._c.listProvidersCatalog({}))
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(r.apiTypes)) {
      out[k] = [...v.capabilities]
    }
    return out
  }

  async providers(): Promise<Record<string, ProviderInfo>> {
    const r = await this._guard(() => this._c.listProviders({}))
    const out: Record<string, ProviderInfo> = {}
    for (const p of r.providers) {
      out[p.providerId] = {
        providerId: p.providerId,
        capability: p.capability || 'text',
        apiType: p.apiType,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        headers: { ...p.headers },
        models: p.models.map(m => ({
          id: m.id,
          name: m.name || m.id,
          contextLimit: Number(m.contextLimit ?? 0),
          modelType: m.modelType,
        })),
      }
    }
    return out
  }

  async registerProvider(p: ProviderInfo): Promise<void> {
    await this._c.registerProvider({
      provider: {
        providerId: p.providerId,
        capability: p.capability,
        apiType: p.apiType,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        headers: p.headers ?? {},
        models: p.models.map(m => ({
          id: m.id,
          name: m.name,
          contextLimit: BigInt(m.contextLimit ?? 0),
          modelType: m.modelType,
        })),
      },
    })
  }

  async deleteProvider(pid: string): Promise<void> {
    await this._c.deleteProvider({ providerId: pid })
  }

  async testProvider(opts: {
    apiType: string
    baseUrl: string
    apiKey: string
    providerId?: string
    model?: string | null
    capability?: string
  }): Promise<{ ok: boolean; result: unknown }> {
    const r = await this._c.testProvider({
      apiType: opts.apiType,
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      providerId: opts.providerId ?? '',
      model: opts.model ?? '',
      capability: opts.capability ?? 'text',
    })
    return { ok: r.ok, result: r.result }
  }

  async models(providerId: string): Promise<ModelInfo[]> {
    if (!providerId) return []
    const r = await this._guard(() => this._c.listModels({ providerId }))
    return r.models.map(m => ({
      id: m.id,
      name: m.name,
      providerId,
      contextLimit: n(m.contextLimit),
      variants: m.variants.map(v => ({
        id: v.id,
        name: v.name,
        description: v.description,
      })),
    }))
  }

  async presets(locale?: string): Promise<Preset[]> {
    const r = await this._guard(() =>
      this._c.listPresets({ locale: locale ?? '' }),
    )
    return r.presets.map(p => ({
      id: p.id,
      systemPrompt: p.systemPrompt,
      systemPromptI18n: {},
      tools: [...p.tools],
      maxTurns: p.maxTurns,
      isSystem: p.isSystem,
    }))
  }

  async tools(locale?: string): Promise<ToolInfo[]> {
    const r = await this._guard(() =>
      this._c.listTools({ locale: locale ?? '' }),
    )
    return r.tools.map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      parameters: (t.parameters ?? null) as Record<string, unknown> | null,
      configFields: t.configFields.map(
        (c): ToolConfigField => ({
          key: c.name,
          label: c.description || c.name,
          type: c.type,
          placeholder: '',
        }),
      ),
      config: t.configFields.map(
        (c): ToolConfig => ({
          name: c.name,
          type: c.type,
          kind: c.kind || 'value',
          capability: c.capability,
          enumValues: [...c.enumValues],
          defaultValue: c.default ? valueToJson(c.default) : null,
          description: c.description,
          scope: c.scope,
        }),
      ),
      requiredConfig: [...t.requiredConfig],
    }))
  }

  async setConfigKey(key: string, value: string): Promise<void> {
    await this._c.setConfig({ key, value })
  }

  async config(key: string): Promise<string> {
    const r = await this._guard(() => this._c.getConfig({ key }))
    return r.value
  }

  async sessionLocale(id: string, locale: string): Promise<Session> {
    return this.settings(id, { locale })
  }

  async toolConfig(): Promise<Record<string, unknown>> {
    const r = await this._c.getToolConfig({})
    const values = (r.config?.values ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) out[k] = valueToJson(v)
    return out
  }

  async health(): Promise<boolean> {
    const r = await this._c.health({})
    return r.ok
  }

  /** The caller's resolved identity (tenant id/name + role). */
  async identity(): Promise<Identity> {
    const r = await this._guard(() => this._c.getIdentity({}))
    return {
      tenant: r.tenant,
      tenantName: r.tenantName,
      role: r.role === 'admin' ? 'admin' : 'tenant',
    }
  }

  // ---- workspace gateway (workspace.v1): git + sandboxes + services ----

  async listBranchSessions(): Promise<BranchSession[]> {
    const r = await this._guard(() => this._c.listBranchSessions({}))
    return (r.branchSessions ?? []).map(branchSessionFromPb)
  }

  async deleteBranchSession(session: string): Promise<void> {
    await this._guard(() => this._c.deleteBranchSession({ session }))
  }

  /** Delete a repo branch AND its branch session (session + sandboxes cascade). */
  async deleteBranch(org: string, repo: string, branch: string): Promise<void> {
    await this._guard(() => this._c.deleteBranch({ org, repo, branch }))
  }

  async listRepos(): Promise<RepoInfo[]> {
    const r = await this._guard(() => this._c.listRepos({}))
    return (r.repos ?? []).map(x => ({
      org: x.org,
      repo: x.repo,
      defaultBranch: x.defaultBranch,
      private: x.private,
    }))
  }

  async ensureRepo(org: string, repo: string): Promise<boolean> {
    const r = await this._guard(() => this._c.ensureRepo({ org, repo }))
    return r.created
  }

  /** Import (migrate) an EXTERNAL git repo into `org` (admin). `ref` given =
   *  single-branch import (that ref becomes the default; others are deleted).
   *  Refuses to overwrite an existing repo. */
  async importRepo(params: {
    org: string
    url: string
    repo?: string
    ref?: string
    authUser?: string
    authToken?: string
    private?: boolean
    mirror?: boolean
    description?: string
  }): Promise<RepoInfo> {
    const r = await this._guard(() =>
      this._c.importRepo({
        org: params.org,
        url: params.url,
        repo: params.repo ?? '',
        ref: params.ref ?? '',
        authUser: params.authUser ?? '',
        authToken: params.authToken ?? '',
        private: params.private ?? true,
        mirror: params.mirror ?? false,
        description: params.description ?? '',
      }),
    )
    const x = r.repo
    return x
      ? {
          org: x.org,
          repo: x.repo,
          defaultBranch: x.defaultBranch,
          private: x.private,
        }
      : {
          org: params.org,
          repo: params.repo ?? '',
          defaultBranch: params.ref ?? 'main',
          private: true,
        }
  }

  async tree(
    org: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<TreeEntry[]> {
    const r = await this._guard(() => this._c.tree({ org, repo, ref, path }))
    return (r.entries ?? []).map(e => ({
      path: e.path,
      type: e.type,
      size: Number(e.size),
    }))
  }

  async readBlob(
    org: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<{ content: string; sha: string }> {
    const r = await this._guard(() =>
      this._c.readBlob({ org, repo, ref, path }),
    )
    return { content: r.content, sha: r.sha }
  }

  /** Raw bytes of a repo file (any type) + a MIME hint and text flag. */
  async readRaw(
    org: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<{ data: Uint8Array; mime: string; isText: boolean }> {
    const r = await this._guard(() => this._c.readRaw({ org, repo, ref, path }))
    return { data: r.data, mime: r.mime, isText: r.isText }
  }

  async log(
    org: string,
    repo: string,
    ref: string,
    path: string,
    limit = 50,
  ): Promise<CommitInfo[]> {
    const r = await this._guard(() =>
      this._c.log({ org, repo, ref, path, limit }),
    )
    return (r.commits ?? []).map(c => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      date: c.date,
    }))
  }

  async branches(org: string, repo: string): Promise<BranchInfo[]> {
    const r = await this._guard(() => this._c.branches({ org, repo }))
    return (r.branches ?? []).map(b => ({ name: b.name, sha: b.sha }))
  }

  async tags(org: string, repo: string): Promise<TagInfo[]> {
    const r = await this._guard(() => this._c.tags({ org, repo }))
    return (r.tags ?? []).map(t => ({ name: t.name, sha: t.sha }))
  }

  async listReleases(org: string, repo: string): Promise<ReleaseInfo[]> {
    const r = await this._guard(() => this._c.listReleases({ org, repo }))
    return (r.releases ?? []).map(rel => ({
      id: Number(rel.id),
      tagName: rel.tagName,
      name: rel.name,
      body: rel.body,
      draft: rel.draft,
      prerelease: rel.prerelease,
      author: rel.author,
      createdAt: rel.createdAt,
      publishedAt: rel.publishedAt,
      htmlUrl: rel.htmlUrl,
      assets: (rel.assets ?? []).map(a => ({
        id: Number(a.id),
        releaseId: Number(a.releaseId),
        name: a.name,
        size: Number(a.size),
        downloadCount: Number(a.downloadCount),
      })),
    }))
  }

  /** Fetch one release asset's bytes (gateway-proxied from Forgejo). */
  async getReleaseAsset(
    org: string,
    repo: string,
    releaseId: number,
    assetId: number,
  ): Promise<{ data: Uint8Array; name: string; mime: string }> {
    const r = await this._guard(() =>
      this._c.getReleaseAsset({
        org,
        repo,
        releaseId: BigInt(releaseId),
        assetId: BigInt(assetId),
      }),
    )
    return { data: r.data, name: r.name, mime: r.mime }
  }

  async getCommit(
    org: string,
    repo: string,
    sha: string,
  ): Promise<CommitDetail | null> {
    try {
      const r = await this._guard(() => this._c.getCommit({ org, repo, sha }))
      const c = r.commit
      return c
        ? {
            sha: c.sha,
            message: c.message,
            author: c.author,
            authorEmail: c.authorEmail,
            date: c.date,
            parents: [...c.parents],
            htmlUrl: c.htmlUrl,
          }
        : null
    } catch {
      return null
    }
  }

  async commitDiff(org: string, repo: string, sha: string): Promise<string> {
    const r = await this._guard(() => this._c.commitDiff({ org, repo, sha }))
    return r.diff
  }

  async listMRs(org: string, repo: string, state = 'open'): Promise<MRInfo[]> {
    const r = await this._guard(() => this._c.listMRs({ org, repo, state }))
    return (r.mrs ?? []).map(mrFromPb)
  }

  async getMR(
    org: string,
    repo: string,
    index: number,
  ): Promise<MRInfo | null> {
    try {
      const r = await this._guard(() => this._c.getMR({ org, repo, index }))
      return r.mr ? mrFromPb(r.mr) : null
    } catch {
      return null
    }
  }

  async mrDiff(org: string, repo: string, index: number): Promise<string> {
    const r = await this._guard(() => this._c.mRDiff({ org, repo, index }))
    return r.diff
  }

  async listMRComments(
    org: string,
    repo: string,
    index: number,
  ): Promise<MRCommentInfo[]> {
    const r = await this._guard(() =>
      this._c.listMRComments({ org, repo, index }),
    )
    return (r.comments ?? []).map(c => ({
      id: Number(c.id),
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    const r = await this._guard(() => this._c.listSandboxes({}))
    return (r.sandboxes ?? []).map(s => ({
      name: s.name,
      image: s.image,
      phase: s.phase,
      ready: s.ready,
      url: s.url,
      creator: s.creator,
      createdAt: Number(s.createdAt),
    }))
  }

  async getSandbox(name: string): Promise<SandboxInfo | null> {
    try {
      const r = await this._guard(() => this._c.getSandbox({ name }))
      const s = r.sandbox
      return s
        ? {
            name: s.name,
            image: s.image,
            phase: s.phase,
            ready: s.ready,
            url: s.url,
            creator: s.creator,
            createdAt: Number(s.createdAt),
          }
        : null
    } catch {
      return null
    }
  }

  async createSandbox(name: string, image = ''): Promise<void> {
    await this._guard(() => this._c.createSandbox({ name, image }))
  }

  async deleteSandbox(name: string): Promise<void> {
    await this._guard(() => this._c.deleteSandbox({ name }))
  }

  async listSandboxJobs(name: string): Promise<SandboxJob[]> {
    const r = await this._guard(() => this._c.listSandboxJobs({ name }))
    return (r.jobs ?? []).map(j => ({
      id: j.id,
      command: j.command,
      state: j.state,
      exitCode: j.exitCode,
      startedAt: Number(j.startedAt),
      finishedAt: Number(j.finishedAt),
    }))
  }

  async getSandboxJobOutput(
    name: string,
    jobId: string,
    start = -200,
    end = 0,
    stream = 'all',
  ): Promise<JobOutput> {
    const r = await this._guard(() =>
      this._c.getSandboxJobOutput({ name, jobId, start, end, stream }),
    )
    return {
      lines: [...r.lines],
      totalLines: r.totalLines,
      startLine: r.startLine,
      endLine: r.endLine,
      done: r.done,
    }
  }

  /** Stream a running job's output (history then live) via WatchSandboxJob. */
  async *watchSandboxJob(
    name: string,
    jobId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<{ output: string; done: boolean; exitCode: number }> {
    const opts = signal ? { signal } : undefined
    for await (const ev of this._c.watchSandboxJob({ name, jobId }, opts)) {
      yield { output: ev.output, done: ev.done, exitCode: ev.exitCode }
    }
  }

  async listServices(): Promise<ServiceInfo[]> {
    const r = await this._guard(() => this._c.listServices({}))
    return (r.services ?? []).map(s => ({
      name: s.name,
      image: s.image,
      phase: s.phase,
      ready: s.ready,
      replicas: s.replicas,
      url: s.url,
    }))
  }
}

// ---- workspace-gateway view models ----

export interface BranchSession {
  session: string
  org: string
  repo: string
  branch: string
  role: string
  preset: string
  sandbox: string
  phase: string
}
export interface RepoInfo {
  org: string
  repo: string
  defaultBranch: string
  private: boolean
}
export interface TreeEntry {
  path: string
  type: string
  size: number
}
export interface CommitInfo {
  sha: string
  message: string
  author: string
  date: string
}
export interface BranchInfo {
  name: string
  sha: string
}
export interface TagInfo {
  name: string
  sha: string
}
export interface CommitDetail {
  sha: string
  message: string
  author: string
  authorEmail: string
  date: string
  parents: string[]
  htmlUrl: string
}
export interface MRInfo {
  index: number
  title: string
  state: string
  head: string
  base: string
  body: string
  author: string
  createdAt: string
  updatedAt: string
  merged: boolean
  mergeable: boolean
  additions: number
  deletions: number
  changedFiles: number
  htmlUrl: string
}
export interface MRCommentInfo {
  id: number
  author: string
  body: string
  createdAt: string
  updatedAt: string
}
export interface ReleaseAsset {
  id: number
  releaseId: number
  name: string
  size: number
  downloadCount: number
}
export interface ReleaseInfo {
  id: number
  tagName: string
  name: string
  body: string
  draft: boolean
  prerelease: boolean
  author: string
  createdAt: string
  publishedAt: string
  htmlUrl: string
  assets: ReleaseAsset[]
}
export interface SandboxInfo {
  name: string
  image: string
  phase: string
  ready: boolean
  url: string
  creator: string
  createdAt: number
}
export interface SandboxJob {
  id: string
  command: string
  state: string
  exitCode: number
  startedAt: number
  finishedAt: number
}
export interface JobOutput {
  lines: string[]
  totalLines: number
  startLine: number
  endLine: number
  done: boolean
}
export interface ServiceInfo {
  name: string
  image: string
  phase: string
  ready: boolean
  replicas: number
  url: string
}

type PbBranchSession = {
  session: string
  org: string
  repo: string
  branch: string
  role: string
  preset: string
  sandbox: string
  phase: string
}
function branchSessionFromPb(w: PbBranchSession): BranchSession {
  return {
    session: w.session,
    org: w.org,
    repo: w.repo,
    branch: w.branch,
    role: w.role,
    preset: w.preset,
    sandbox: w.sandbox,
    phase: w.phase,
  }
}

type PbMR = {
  index: number
  title: string
  state: string
  head: string
  base: string
  body: string
  author: string
  createdAt: string
  updatedAt: string
  merged: boolean
  mergeable: boolean
  additions: number
  deletions: number
  changedFiles: number
  htmlUrl: string
}
function mrFromPb(m: PbMR): MRInfo {
  return {
    index: m.index,
    title: m.title,
    state: m.state,
    head: m.head,
    base: m.base,
    body: m.body,
    author: m.author,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    merged: m.merged,
    mergeable: m.mergeable,
    additions: m.additions,
    deletions: m.deletions,
    changedFiles: m.changedFiles,
    htmlUrl: m.htmlUrl,
  }
}

/** Project a created workspace into the Session shape the UI list uses. */
function branchSessionToSession(w: BranchSession): Session {
  return {
    id: w.session,
    org: w.org,
    repo: w.repo,
    branch: w.branch,
    model: '',
    variant: '',
    preset: w.preset,
    createdAt: '',
    updatedAt: '',
    lastMessageAt: '',
    lastMessagePreview: '',
    messageSeq: 0,
    group: '',
  }
}

export function emptySession(id: string): Session {
  return {
    id,
    org: '',
    repo: '',
    branch: '',
    model: '',
    variant: '',
    preset: '',
    createdAt: '',
    updatedAt: '',
    lastMessageAt: '',
    lastMessagePreview: '',
    messageSeq: 0,
    group: '',
  }
}

export type { ToolState }
export { modelRefOf }
