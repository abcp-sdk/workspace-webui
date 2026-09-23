// Session-avatar tests: every branch of one repo must share the repo's
// background tint (org-seeded), while the honeycomb pattern stays unique per
// branch. Free sessions fall back to the plain id-seeded avatar.
import { describe, expect, it } from 'vitest'
import {
  avatarSpec,
  avatarSpecFor,
  parseSessionId,
  sessionAvatarSpec,
} from './identicon'

describe('parseSessionId', () => {
  it('splits org:repo:branch', () => {
    expect(parseSessionId('acme:widget:main')).toEqual({
      org: 'acme',
      repo: 'widget',
      branch: 'main',
    })
  })

  it('returns empty parts for a non repo-bound id', () => {
    expect(parseSessionId('hello')).toEqual({ org: '', repo: '', branch: '' })
    expect(parseSessionId('a:b')).toEqual({ org: '', repo: '', branch: '' })
    expect(parseSessionId('a:b:c:d')).toEqual({ org: '', repo: '', branch: '' })
  })
})

describe('sessionAvatarSpec', () => {
  it('gives every branch of one repo the SAME background', () => {
    const main = sessionAvatarSpec('acme:widget:main')
    const feat = sessionAvatarSpec('acme:widget:feature/x')
    const other = sessionAvatarSpec('acme:widget:release/1.0')
    expect(feat.bg).toBe(main.bg)
    expect(other.bg).toBe(main.bg)
  })

  it('matches the level-aware branch spec for a repo-bound id', () => {
    const id = 'acme:widget:feature/x'
    expect(sessionAvatarSpec(id)).toEqual(
      avatarSpecFor('acme', 'widget', 'feature/x', 'branch'),
    )
  })

  it('gives different branches different patterns', () => {
    const a = sessionAvatarSpec('acme:widget:main')
      .hexes.map(h => h.on)
      .join('')
    const b = sessionAvatarSpec('acme:widget:feature/x')
      .hexes.map(h => h.on)
      .join('')
    expect(a).not.toBe(b)
  })

  it('falls back to the plain id-seeded avatar for free sessions', () => {
    expect(sessionAvatarSpec('hello')).toEqual(avatarSpec('hello'))
  })
})
