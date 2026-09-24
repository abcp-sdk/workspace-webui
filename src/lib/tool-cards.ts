// Tool-card registry — per-tool "pretty" rendering of a tool call, split into
// TWO independent sections:
//
//   input  — the arguments the model passed (from `state.input`)
//   result — what came back (from `state.data` + the result `output` text)
//
// Each section has its own Pretty/raw toggle in `ToolPartView` (input: Pretty |
// JSON; result: Pretty | Text). This module is PURE (no Svelte): it returns a
// plain spec the component renders, so the mapping is unit-testable. Tools
// without a spec fall back to raw JSON + the output text.
//
// The registry is split by DOMAIN under `./tool-cards/` (repo / images /
// sandbox / bundled); this file owns the shared types (re-exported), the
// `bareToolName` normalizer, and `cardFor`, which builds one {@link CardCtx}
// and walks the domain handlers in order.
import type { AppPage } from './nav'
import { bundledHandlers } from './tool-cards/bundled'
import { imageHandlers } from './tool-cards/images'
import { repoHandlers } from './tool-cards/repo'
import { sandboxHandlers } from './tool-cards/sandbox'
import {
  bareToolName,
  type CardCtx,
  type CardHandler,
  loc,
  n,
  pick,
  s,
} from './tool-cards/shared'

export type {
  CardAction,
  CardBody,
  CardField,
  CardSection,
  CardSpec,
} from './tool-cards/shared'
export { bareToolName } from './tool-cards/shared'

/** Every domain handler, in match order. */
const HANDLERS: CardHandler[] = [
  ...repoHandlers,
  ...imageHandlers,
  ...sandboxHandlers,
  ...bundledHandlers,
]

type Data = Record<string, unknown>

/**
 * Build a card for a tool, or null to fall back to raw JSON. `output` is the
 * result TEXT (used by the terminal/code/markdown bodies, whose payload is not
 * in `data`).
 */
export function cardFor(
  rawTool: string,
  data: Data,
  input: Data,
  output = '',
): ReturnType<CardHandler> {
  const tool = bareToolName(rawTool)
  const org = pick(data, input, 'org')
  const repo = pick(data, input, 'repo')
  const ref = pick(data, input, 'ref') || pick(data, input, 'branch')
  const path = pick(data, input, 'path')
  const sha = s(data, 'sha') || s(data, 'commit')
  const index = n(data, 'index') || n(input, 'index')
  const ctx: CardCtx = {
    tool,
    data,
    input,
    output,
    org,
    repo,
    ref,
    path,
    sha,
    index,
    at: org && repo ? loc(org, repo, ref) : '',
  }
  for (const h of HANDLERS) {
    const spec = h(ctx)
    if (spec) return spec
  }
  return null
}

export type { AppPage }
