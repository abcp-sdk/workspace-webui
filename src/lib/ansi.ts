// A tiny SGR (ANSI color) parser for terminal output. It is deliberately
// minimal: it understands the common `ESC[...m` select-graphic-rendition
// sequences (reset, bold, dim, the 8 base foreground colors, the 8 bright
// ones, and default-fg) and turns a line into a list of styled segments. No
// dependency, no full VT emulation, and — importantly — it returns plain
// strings + a class name, so callers render `<span class=…>{text}</span>` and
// never need `{@html}`.

export interface AnsiSegment {
  text: string
  /** Tailwind classes for this run ('' = default terminal color). */
  cls: string
}

// SGR code -> Tailwind text color. Only the base + bright foreground palette;
// anything else (background, underline, ...) is ignored.
const FG: Record<number, string> = {
  30: 'text-zinc-500',
  31: 'text-red-400',
  32: 'text-green-400',
  33: 'text-yellow-300',
  34: 'text-blue-400',
  35: 'text-fuchsia-400',
  36: 'text-cyan-300',
  37: 'text-zinc-200',
  90: 'text-zinc-400',
  91: 'text-red-300',
  92: 'text-green-300',
  93: 'text-yellow-200',
  94: 'text-blue-300',
  95: 'text-fuchsia-300',
  96: 'text-cyan-200',
  97: 'text-white',
}

interface Style {
  fg: string
  bold: boolean
  dim: boolean
}

function clsOf(s: Style): string {
  const parts: string[] = []
  if (s.fg) parts.push(s.fg)
  if (s.bold) parts.push('font-semibold')
  if (s.dim) parts.push('opacity-70')
  return parts.join(' ')
}

/**
 * Parse one line into styled segments. Unknown escape codes are dropped (their
 * text effect is ignored) so the visible text stays clean.
 */
export function parseAnsi(line: string): AnsiSegment[] {
  const out: AnsiSegment[] = []
  const style: Style = { fg: '', bold: false, dim: false }
  let buf = ''
  let i = 0

  const flush = () => {
    if (buf) {
      out.push({ text: buf, cls: clsOf(style) })
      buf = ''
    }
  }

  while (i < line.length) {
    const ch = line[i]
    if (ch === '\x1b' && line[i + 1] === '[') {
      // A CSI sequence ESC [ <params> <final-byte>. Find the final byte in the
      // 0x40–0x7E range (the params are 0x30–0x3F).
      let j = i + 2
      while (j < line.length) {
        const c = line.charCodeAt(j)
        if (c >= 0x40 && c <= 0x7e) break
        j++
      }
      if (j < line.length) {
        if (line[j] === 'm') {
          // SGR: the style is about to change — flush the current run first.
          flush()
          applySgr(line.slice(i + 2, j), style)
        }
        i = j + 1
        continue
      }
      // Unterminated CSI: drop the ESC and carry on.
      i++
      continue
    }
    buf += ch
    i++
  }
  flush()
  return out
}

function applySgr(params: string, style: Style) {
  const codes = params === '' ? [0] : params.split(';').map(p => Number(p) || 0)
  for (const c of codes) {
    if (c === 0) {
      style.fg = ''
      style.bold = false
      style.dim = false
    } else if (c === 1) style.bold = true
    else if (c === 2) style.dim = true
    else if (c === 22) {
      style.bold = false
      style.dim = false
    } else if (c === 39) style.fg = ''
    else if (FG[c]) style.fg = FG[c]!
  }
}

/** Strip every SGR sequence (for copy-to-clipboard / download). */
export function stripAnsi(line: string): string {
  // Build the ESC char without a literal control character in the regex.
  const esc = String.fromCharCode(0x1b)
  return line.split(esc).reduce<string>((acc, part, i) => {
    if (i === 0) return part
    // Drop a leading `[...m` SGR sequence from each subsequent part.
    return acc + part.replace(/^\[[0-9;]*m/, '')
  }, '')
}
