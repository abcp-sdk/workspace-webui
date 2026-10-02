// Guard: the checked-in ES bindings (src/gen/...) must carry the HelmReleaseInfo
// fields the UI reads. The gateway's `gen/es` output has historically lagged its
// Go output, so a new server field silently never arrives unless the descriptor
// is regenerated. This asserts the descriptor itself, so a stale file fails CI.
import { describe, expect, it } from 'vitest'
import { HelmReleaseInfoSchema } from '../gen/workspace/v1/workspace_pb'

describe('HelmReleaseInfo ES descriptor', () => {
  it('exposes the current-revision chart metadata fields', () => {
    const byName = new Map(HelmReleaseInfoSchema.fields.map(f => [f.name, f]))
    expect(byName.get('chart_version')?.number).toBe(14)
    expect(byName.get('app_version')?.number).toBe(15)
    const objects = byName.get('objects')
    expect(objects?.number).toBe(16)
    expect(objects?.fieldKind).toBe('list')
  })
})
