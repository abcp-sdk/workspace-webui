// Parsed watch/prompt stream events — port of flutter/lib/api.dart types.

/** A parsed watchSession frame. `params` is the decoded google.protobuf.Struct. */
export interface StreamEvent {
  event: string
  params: Record<string, unknown>
  /** Per-event id from the server (dedup key across replay/live overlap). */
  eid: string
  /** Turn id this event belongs to, when present. */
  runId: string
  /**
   * JetStream stream sequence of this event (0 when the server omitted it).
   * The client echoes the newest one back as `sinceSeq` on reconnect so the
   * server resumes the ordered consumer with an O(1) seek.
   */
  seq: number
}

export function makeStreamEvent(
  event: string,
  params?: Record<string, unknown> | null,
  eid = '',
  runId = '',
  seq = 0,
): StreamEvent {
  return { event, params: params ?? {}, eid, runId, seq }
}

/** One frame of the watchSessions list stream. */
export interface SessionListEvent {
  snapshot: boolean
  upserts: import('./models').Session[]
  removed: string[]
}

export type AuthExpiredReason = 'expired' | 'addedUser'

let onAuthExpired: ((reason: AuthExpiredReason) => void) | null = null

/** Global auth-expiry hook (mirrors flutter api.dart's onAuthExpired). */
export function setAuthExpiredHandler(
  cb: ((reason: AuthExpiredReason) => void) | null,
) {
  onAuthExpired = cb
}

export function fireAuthExpired(reason: AuthExpiredReason) {
  onAuthExpired?.(reason)
}

/** Connect error code check for auth failures (unauthenticated/permission). */
export function isAuthError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    'code' in e &&
    ((e as { code?: unknown }).code === 'unauthenticated' ||
      (e as { code?: unknown }).code === 'permission_denied')
  )
}
