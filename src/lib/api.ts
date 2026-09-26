// AgentApi — a faithful port of flutter/lib/api.dart, retargeted at the
// workspace gateway.
//
// The webui speaks ONLY the workspace gateway (workspace.v1.BranchSessionService);
// it never talks to the agent directly. The gateway forwards the minimal,
// policy-free agent surface (chat/models/config/providers/files) and owns
// session creation (roles + immutable presets) and the sandbox/service
// lifecycle.
//
// The pure pb↔model mappers and the XHR upload helper live in api-mappers.ts.

import {
  encodeIngestRequest,
  messageFromPb,
  n,
  sessionFromPb,
  uploadIngest,
  valueToJson,
} from './api-mappers'
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
   * binds the immutable preset. `model`/`image`/`locale` are optional; the
   * locale pins the session's agent language at creation.
   */
  async ensureBranchSession(
    org: string,
    repo: string,
    branch: string,
    model = '',
    image = '',
    locale = '',
  ): Promise<Session> {
    const r = await this._guard(() =>
      this._c.ensureBranchSession({ org, repo, branch, model, image, locale }),
    )
    const w = r.branchSession
    return w ? branchSessionToSession(w) : emptySession('')
  }

  /** Create a free session with a tenant-scoped role (admin|explorer). */
  async createFreeSession(
    name: string,
    role: 'admin' | 'explorer',
    model = '',
    locale = '',
  ): Promise<Session> {
    const r = await this._guard(() =>
      this._c.createFreeSession({ name, role, model, locale }),
    )
    return emptySession(r.session)
  }

  async getSession(id: string): Promise<Session> {
    const r = await this._c.getSession({ id })
    return r.session ? sessionFromPb(r.session) : emptySession('')
  }

  /** Delete a session (branch or free). Authorized + cascading server-side. */
  async deleteSession(id: string): Promise<void> {
    await this._c.deleteBranchSession({ session: id })
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
    const req = encodeIngestRequest(bytes, src.name)
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

  /** Delete a repository AND all its branch sessions (admin). */
  async deleteRepo(org: string, repo: string): Promise<void> {
    await this._guard(() => this._c.deleteRepo({ org, repo }))
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

  /** Create an org owned by the tenant (admin; idempotent). */
  async createOrg(org: string): Promise<string> {
    const r = await this._guard(() => this._c.createOrg({ org }))
    return r.org
  }

  /** List the tenant-owned orgs (including empty ones). */
  async listOrgs(): Promise<string[]> {
    const r = await this._guard(() => this._c.listOrgs({}))
    return r.orgs ?? []
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
        private: false,
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

  /** Per-file diff between two refs (gateway go-git; Forgejo's compare
   *  `patch` is empty on 1.22). */
  async compare(
    org: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<CompareFile[]> {
    const r = await this._guard(() =>
      this._c.compare({ org, repo, base, head }),
    )
    return (r.files ?? []).map(f => ({
      path: f.path,
      status: f.status,
      additions: Number(f.additions),
      deletions: Number(f.deletions),
      patch: f.patch,
    }))
  }

  /** Unified diff of ONE file between two refs (gateway go-git; Forgejo's
   *  compare `patch` is empty on 1.22). */
  async fileDiff(
    org: string,
    repo: string,
    base: string,
    head: string,
    path: string,
  ): Promise<string> {
    const r = await this._guard(() =>
      this._c.fileDiff({ org, repo, base, head, path }),
    )
    return r.diff
  }

  /** Per-line authorship of one file at a ref (gateway go-git blame). */
  async blame(
    org: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<BlameLine[]> {
    const r = await this._guard(() => this._c.blame({ org, repo, ref, path }))
    return (r.lines ?? []).map(l => ({
      line: Number(l.line),
      sha: l.sha,
      author: l.author,
      authorEmail: l.authorEmail,
      date: l.date,
      // proto3 omits empty strings, so a blank line carries no `content`.
      content: l.content ?? '',
    }))
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
    return (r.sandboxes ?? []).map(sandboxFromPb)
  }

  async getSandbox(name: string): Promise<SandboxInfo | null> {
    try {
      const r = await this._guard(() => this._c.getSandbox({ name }))
      return r.sandbox ? sandboxFromPb(r.sandbox) : null
    } catch {
      return null
    }
  }

  /** List a sandbox directory (or a single file). `path` is passed to the
   *  worker verbatim (relative = workspace, absolute = as-is). */
  async listSandboxFiles(
    name: string,
    path: string,
    depth = 1,
    limit = 1000,
  ): Promise<{ isDir: boolean; files: SandboxFileEntry[] }> {
    const r = await this._guard(() =>
      this._c.listSandboxFiles({ name, path, depth, limit }),
    )
    return {
      isDir: r.isDir,
      files: (r.files ?? []).map(f => ({
        path: f.path,
        size: Number(f.size),
        isDir: f.isDir,
      })),
    }
  }

  /** Read a sandbox file's raw bytes (optionally a line window). */
  async readSandboxFile(
    name: string,
    path: string,
    startLine = 0,
    endLine = 0,
  ): Promise<{
    data: Uint8Array
    totalLines: number
    startLine: number
    endLine: number
  }> {
    const r = await this._guard(() =>
      this._c.readSandboxFile({ name, path, startLine, endLine }),
    )
    return {
      data: r.content,
      totalLines: r.totalLines,
      startLine: r.startLine,
      endLine: r.endLine,
    }
  }

  async createSandbox(name: string, image = '', session = ''): Promise<void> {
    await this._guard(() => this._c.createSandbox({ name, image, session }))
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
    return (r.services ?? []).map(serviceFromPb)
  }

  async getService(name: string): Promise<ServiceInfo | null> {
    const all = await this.listServices()
    return all.find(s => s.name === name) ?? null
  }

  /** Delete a service the tenant owns (Deployment + its Services). */
  async deleteService(name: string): Promise<boolean> {
    const r = await this._guard(() => this._c.deleteService({ name }))
    return r.ok
  }

  /** Scale a service to zero replicas (remembering the prior count). */
  async pauseService(name: string): Promise<ServiceInfo | null> {
    const r = await this._guard(() => this._c.pauseService({ name }))
    return r.service ? serviceFromPb(r.service) : null
  }

  /** Restore a paused service to its pre-pause replica count. */
  async resumeService(name: string): Promise<ServiceInfo | null> {
    const r = await this._guard(() => this._c.resumeService({ name }))
    return r.service ? serviceFromPb(r.service) : null
  }

  /** Tail a service's container log (previous = the crashed instance). */
  async serviceLogs(
    name: string,
    tailLines = 500,
    previous = false,
  ): Promise<string[]> {
    const r = await this._guard(() =>
      this._c.serviceLogs({ name, tailLines: BigInt(tailLines), previous }),
    )
    return r.lines ?? []
  }

  /** Follow a service's container log until the stream ends / aborted. */
  async *watchServiceLogs(
    name: string,
    previous = false,
    signal?: AbortSignal,
  ): AsyncGenerator<{ output: string; done: boolean; error: string }> {
    const opts = signal ? { signal } : undefined
    for await (const ev of this._c.watchServiceLogs({ name, previous }, opts)) {
      yield { output: ev.output, done: ev.done, error: ev.error }
    }
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
    locale: '',
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
// ---- workspace-gateway view models ----

export interface SandboxRef {
  name: string
  phase: string
  ready: boolean
}
export interface BranchSession {
  session: string
  org: string
  repo: string
  branch: string
  role: string
  preset: string
  /** Representative sandbox (prefer Running/Ready, else newest). */
  sandbox: string
  phase: string
  /** Every sandbox the session owns, representative first then newest-first. */
  sandboxes: SandboxRef[]
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
export interface CompareFile {
  path: string
  status: string
  additions: number
  deletions: number
  patch: string
}
export interface BlameLine {
  line: number
  sha: string
  author: string
  authorEmail: string
  date: string
  content: string
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
  session: string
  createdAt: number
  /** Worker workspace root (relative paths resolve here); '' until reachable. */
  workspace: string
  /** Worker user's home dir (the OS `~`); '' when unknown. */
  home: string
  os: string
  arch: string
}
export interface SandboxFileEntry {
  path: string
  size: number
  isDir: boolean
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
export interface ServicePortInfo {
  name: string
  preset: string
  port: number
  protocol: string
  targetPort: number
  publicUrl: string
}

export interface ServiceInfo {
  name: string
  image: string
  phase: string
  ready: boolean
  replicas: number
  url: string
  publicUrl: string
  ports: ServicePortInfo[]
  creator: string
  session: string
  stage: string
  podPhase: string
  restarts: number
  message: string
  expiresAt: number
  /** Scaled to zero by PauseService (resume restores the prior count). */
  paused: boolean
  /** Deployment creation time (unix ms); the list is sorted by this desc. */
  createdAt: number
}

type PbSandboxInfo = {
  name: string
  image: string
  phase: string
  ready: boolean
  url: string
  creator: string
  session: string
  createdAt: bigint
  workspace: string
  home: string
  os: string
  arch: string
}
function sandboxFromPb(s: PbSandboxInfo): SandboxInfo {
  return {
    name: s.name,
    image: s.image,
    phase: s.phase,
    ready: s.ready,
    url: s.url,
    creator: s.creator,
    session: s.session,
    createdAt: Number(s.createdAt),
    workspace: s.workspace,
    home: s.home,
    os: s.os,
    arch: s.arch,
  }
}

type PbServiceInfo = {
  name: string
  image: string
  phase: string
  ready: boolean
  replicas: number
  url: string
  publicUrl: string
  ports: {
    name: string
    preset: string
    port: number
    protocol: string
    targetPort: number
    publicUrl: string
  }[]
  creator: string
  session: string
  stage: string
  podPhase: string
  restarts: number
  message: string
  expiresAt: bigint
  paused: boolean
  createdAt: bigint
}
function serviceFromPb(s: PbServiceInfo): ServiceInfo {
  return {
    name: s.name,
    image: s.image,
    phase: s.phase,
    ready: s.ready,
    replicas: s.replicas,
    url: s.url,
    publicUrl: s.publicUrl,
    ports: (s.ports ?? []).map(p => ({
      name: p.name,
      preset: p.preset,
      port: p.port,
      protocol: p.protocol,
      targetPort: p.targetPort,
      publicUrl: p.publicUrl,
    })),
    creator: s.creator,
    session: s.session,
    stage: s.stage,
    podPhase: s.podPhase,
    restarts: s.restarts,
    message: s.message,
    expiresAt: Number(s.expiresAt),
    paused: s.paused,
    createdAt: Number(s.createdAt),
  }
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
  sandboxes: Array<{ name: string; phase: string; ready: boolean }>
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
    sandboxes: (w.sandboxes ?? []).map(s => ({
      name: s.name,
      phase: s.phase,
      ready: s.ready,
    })),
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
