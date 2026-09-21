// Transport + typed client factory for the workspace gateway.
//
// The gateway is SAME-ORIGIN with this SPA (the Caddy aggregator forwards
// `/workspace.v1.*` and `/agent.v1.*` to it). The workspace client is the
// trusted session-creation surface; the agent client is only used for chat.
import {
  type Client,
  createClient,
  type Interceptor,
} from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { WorkspaceService } from '../gen/workspace/v1/workspace_pb.js'

export type WorkspaceClient = Client<typeof WorkspaceService>

function bearerInterceptor(token: string): Interceptor {
  return next => async req => {
    if (token) req.header.set('Authorization', `Bearer ${token}`)
    return await next(req)
  }
}

export function trimBase(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

/** A fresh Connect-web workspace client bound to one backend (baseUrl + bearer). */
export function createWorkspaceClient(
  baseUrl: string,
  token: string,
): WorkspaceClient {
  const transport = createConnectTransport({
    baseUrl: trimBase(baseUrl),
    useBinaryFormat: true,
    interceptors: [bearerInterceptor(token)],
  })
  return createClient(WorkspaceService, transport)
}
