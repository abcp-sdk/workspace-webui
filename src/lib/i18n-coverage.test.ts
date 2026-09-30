// Guard: the UI must not render un-localized literal text. This scans the
// Svelte markup for hardcoded text nodes and for `label`/`title`/`subtitle`/
// `placeholder`/`aria-label` literals that are NOT i18n keys, so a new string
// cannot silently ship in only one language.
//
// It is intentionally conservative: class lists, dynamic expressions, symbols,
// URLs and a small allowlist of non-translatable marks are ignored.
import { describe, expect, it } from 'vitest'
import { setLocale, t } from './i18n.svelte'

setLocale('en')

/** Raw Svelte sources (markup) via Vite's glob — no node builtins needed. */
const SVELTE = import.meta.glob('./**/*.svelte', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Raw i18n module source, to enumerate the `en` keys. */
const I18N_SRC = (
  import.meta.glob('./i18n.svelte.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
)['./i18n.svelte.ts']!

const UI_PREFIX = './components/ui/'
/** Marks/symbols that are deliberately not localized. */
const ALLOW = new Set(['AW', '+1', '-1', '—', '$', '·', '/'])

function i18nKeys(): Set<string> {
  const en = I18N_SRC.split('const zh = {', 1)[0]!
  const keys = new Set<string>()
  for (const m of en.matchAll(/^\s+([a-zA-Z][a-zA-Z0-9_]*):\s*`/gm))
    keys.add(m[1]!)
  return keys
}

function markup(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

describe('i18n coverage', () => {
  const keys = i18nKeys()

  it('resolves label keys (a missing key would render as itself)', () => {
    expect(keys.has('cancel')).toBe(true)
    expect(t('cancel')).not.toBe('cancel')
  })

  it('has no hardcoded text nodes in Svelte markup', () => {
    const offenders: string[] = []
    for (const [file, src] of Object.entries(SVELTE)) {
      if (file.includes(UI_PREFIX)) continue
      markup(src)
        .split('\n')
        .forEach((line: string, i: number) => {
          for (const m of line.matchAll(
            />\s*([A-Za-z][A-Za-z0-9 ,.!?:%()/-]{1,40}?)\s*</g,
          )) {
            const s = m[1]!.trim()
            if (ALLOW.has(s)) continue
            offenders.push(`${file}:${i + 1}: ${JSON.stringify(s)}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })

  it('has no un-localized label/title/placeholder literals', () => {
    const propRe =
      /\b(label|title|placeholder|aria-label|confirmLabel|cancelLabel|subtitle|alt)\s*[:=]\s*(['"])((?:[^'"\\]|\\.){1,70})\2/g
    const offenders: string[] = []
    for (const [file, src] of Object.entries(SVELTE)) {
      if (file.includes(UI_PREFIX)) continue
      src.split('\n').forEach((line: string, i: number) => {
        const ls = line.trim()
        if (ls.startsWith('//') || ls.startsWith('*')) return
        for (const m of line.matchAll(propRe)) {
          const v = m[3]!
          if (keys.has(v) || ALLOW.has(v)) continue
          if (/^[a-z0-9\-.[\]:/%#{}_]+$/.test(v)) continue // class / token / dynamic
          if (v.startsWith('$')) continue
          offenders.push(`${file}:${i + 1}: [${m[1]}] ${JSON.stringify(v)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
