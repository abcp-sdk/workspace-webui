// JSON codec for the local sqlite store — the exact shape the Flutter store
// writes (Drift parity). Pure functions: no DB handle, so they can be tested
// directly. Only the DRAFT attachment codec remains: the message-chain codecs
// were removed along with the message mirror.
import type { UploadedFile } from './models'

export function fileToJson(a: UploadedFile): Record<string, unknown> {
  return {
    code: a.code,
    name: a.name,
    mime: a.mime,
    size: a.size,
    localPath: a.localPath,
    state: a.uploadState,
  }
}

export function fileFromJson(j: Record<string, unknown>): UploadedFile {
  return {
    code: (j['code'] as string) || '',
    name: (j['name'] as string) ?? null,
    mime: (j['mime'] as string) ?? null,
    size: j['size'] != null ? Number(j['size']) : null,
    localPath: (j['localPath'] as string) || '',
    uploadState: (j['state'] as UploadedFile['uploadState']) || 'done',
    deduped: false,
    sha256: null,
  }
}
