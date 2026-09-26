// Marquee layout math — pure, so it can be unit-tested without a DOM.
//
// A label is given a FIXED slot width. When the text fits, nothing moves. When
// it overflows, it runs a fixed cycle:
//
//   hold at the start (5s) → move LINEARLY to the tail at a CONSTANT speed
//   (the same px/s for every label, so a longer name simply takes longer) →
//   hold at the tail (5s) → jump back to the start and repeat.
//
// The speed is constant, so the move duration scales with the distance.

export interface MarqueePlan {
  /** Whether the text overflows its slot and must scroll. */
  scroll: boolean
  /** How far (px) the text must travel to fully reveal its tail. */
  distance: number
}

export interface MarqueeCycle {
  /** Hold time at each end (start and tail), ms. */
  holdMs: number
  /** Linear travel time from start to tail, ms. */
  moveMs: number
  /** One full cycle (hold + move + hold), ms. */
  totalMs: number
  /** Fraction of the cycle spent holding at the start (offset of move start). */
  startHoldPct: number
  /** Fraction of the cycle at which the tail is reached (offset of tail hold). */
  tailPct: number
}

/** Plan a marquee for `contentW` of text inside a `containerW` slot. A small
 *  epsilon absorbs sub-pixel measurement noise so text that only just fits is
 *  not needlessly animated. */
export function marqueePlan(containerW: number, contentW: number): MarqueePlan {
  const distance = Math.max(0, Math.ceil(contentW - containerW))
  return { scroll: distance > 1, distance }
}

/**
 * The animation cycle for a travel `distance` at a CONSTANT `pxPerSec`, with a
 * `holdMs` pause at each end. The move time is `distance / pxPerSec` — never
 * clamped — so every label moves at the SAME speed regardless of its length.
 */
export function marqueeCycle(
  distance: number,
  opts: { pxPerSec?: number; holdMs?: number } = {},
): MarqueeCycle {
  const pxPerSec = opts.pxPerSec ?? 40
  const holdMs = opts.holdMs ?? 5000
  const moveMs = Math.max(1, Math.round((distance / pxPerSec) * 1000))
  const totalMs = holdMs + moveMs + holdMs
  return {
    holdMs,
    moveMs,
    totalMs,
    startHoldPct: holdMs / totalMs,
    tailPct: (holdMs + moveMs) / totalMs,
  }
}
