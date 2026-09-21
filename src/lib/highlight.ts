// highlight.ts — a single Shiki highlighter for the Code tab.
//
// Deliberately fine-grained and browser-first:
//   * `shiki/core` + the pure-JS RegExp engine (`oniguruma-to-es`), so no
//     Oniguruma WebAssembly is shipped (smaller bundle, faster startup; all
//     built-in languages are supported by the JS engine).
//   * languages are imported LAZILY by id, so only the syntaxes actually viewed
//     are downloaded.
//   * two GitHub themes (light/dark) chosen from the app's resolved theme.
//
// The public API returns tokens PER LINE (not HTML), which is what the
// virtualized CodeSurface and the diff renderer need.
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

export type ThemeName = 'github-light' | 'github-dark'

interface Token {
  content: string
  color?: string
}

/** Map a file name to a Shiki language id ('' = plain text). */
export function langForName(name: string): string {
  const base = name.toLowerCase()
  if (base === 'dockerfile') return 'dockerfile'
  if (base === 'makefile') return 'makefile'
  const ext = base.includes('.') ? (base.split('.').pop() as string) : ''
  return LANG_BY_EXT[ext] ?? ''
}

const LANG_BY_EXT: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  fish: 'fish',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
  dart: 'dart',
  scala: 'scala',
  clj: 'clojure',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  ml: 'ocaml',
  toml: 'toml',
  ini: 'ini',
  conf: 'ini',
  env: 'dotenv',
  gradle: 'groovy',
  tf: 'hcl',
  proto: 'proto',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'json5',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  csv: 'csv',
  tsv: 'tsv',
  txt: 'text',
  log: 'text',
  graphql: 'graphql',
  gql: 'graphql',
  nginx: 'nginx',
  diff: 'diff',
  patch: 'diff',
}

/** Lazily-importable language map (Shiki's fine-grained `@shikijs/langs`). */
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  python: () => import('@shikijs/langs/python'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  ruby: () => import('@shikijs/langs/ruby'),
  php: () => import('@shikijs/langs/php'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  fish: () => import('@shikijs/langs/fish'),
  sql: () => import('@shikijs/langs/sql'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  less: () => import('@shikijs/langs/less'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  lua: () => import('@shikijs/langs/lua'),
  perl: () => import('@shikijs/langs/perl'),
  r: () => import('@shikijs/langs/r'),
  dart: () => import('@shikijs/langs/dart'),
  scala: () => import('@shikijs/langs/scala'),
  clojure: () => import('@shikijs/langs/clojure'),
  elixir: () => import('@shikijs/langs/elixir'),
  erlang: () => import('@shikijs/langs/erlang'),
  haskell: () => import('@shikijs/langs/haskell'),
  ocaml: () => import('@shikijs/langs/ocaml'),
  toml: () => import('@shikijs/langs/toml'),
  ini: () => import('@shikijs/langs/ini'),
  dotenv: () => import('@shikijs/langs/dotenv'),
  groovy: () => import('@shikijs/langs/groovy'),
  hcl: () => import('@shikijs/langs/hcl'),
  proto: () => import('@shikijs/langs/proto'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  json5: () => import('@shikijs/langs/json5'),
  yaml: () => import('@shikijs/langs/yaml'),
  xml: () => import('@shikijs/langs/xml'),
  html: () => import('@shikijs/langs/html'),
  markdown: () => import('@shikijs/langs/markdown'),
  mdx: () => import('@shikijs/langs/mdx'),
  csv: () => import('@shikijs/langs/csv'),
  tsv: () => import('@shikijs/langs/tsv'),
  graphql: () => import('@shikijs/langs/graphql'),
  nginx: () => import('@shikijs/langs/nginx'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  makefile: () => import('@shikijs/langs/makefile'),
}

let corePromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()
const loadedThemes = new Set<string>()

function core(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = createHighlighterCore({
      themes: [],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  }
  return corePromise
}

async function ensureTheme(h: HighlighterCore, theme: ThemeName) {
  if (loadedThemes.has(theme)) return
  if (theme === 'github-dark') {
    await h.loadTheme(import('@shikijs/themes/github-dark') as never)
  } else {
    await h.loadTheme(import('@shikijs/themes/github-light') as never)
  }
  loadedThemes.add(theme)
}

async function ensureLang(h: HighlighterCore, lang: string) {
  if (!lang || loadedLangs.has(lang)) return
  const load = LANG_LOADERS[lang]
  if (!load) return
  await h.loadLanguage((await load()) as never)
  loadedLangs.add(lang)
}

/** Per-line tokens for `code` in `lang`, or null when the language is unknown
 *  (the caller renders plain text). */
export async function highlightLines(
  code: string,
  lang: string,
  theme: ThemeName,
): Promise<Token[][] | null> {
  if (!lang || !LANG_LOADERS[lang]) return null
  const h = await core()
  await Promise.all([ensureTheme(h, theme), ensureLang(h, lang)])
  const lines = h.codeToTokensBase(code, { lang, theme }) as Token[][]
  return lines
}

/** The theme name for the app's resolved dark/light mode. */
export function themeFor(dark: boolean): ThemeName {
  return dark ? 'github-dark' : 'github-light'
}

export type { Token }
