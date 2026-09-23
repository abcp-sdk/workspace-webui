// Marquee layout math — pure, so it can be unit-tested without a DOM.
//
// A label is given a FIXED slot width. When the text fits, nothing moves. When
// it overflows, the text is allowed to travel from 0 to -(overflow) and back
// (a ping-pong scroll) so the whole name becomes readable without widening the
// slot or clipping it.

export interface MarqueePlan {
  /** Whether the text overflows its slot and must scroll. */
  scroll: boolean
  /** How far (px) the text must travel to fully reveal its tail. */
  distance: number
}

/** Plan a marquee for `contentW` of text inside a `containerW` slot. A small
 *  epsilon absorbs sub-pixel measurement noise so text that only just fits is
 *  not needlessly animated. */
export function marqueePlan(containerW: number, contentW: number): MarqueePlan {
  const distance = Math.max(0, Math.ceil(contentW - containerW))
  return { scroll: distance > 1, distance }
}

/** Milliseconds for one leg of the ping-pong, clamped so very long names do
 *  not crawl and short ones do not blink. `pxPerSec` is the travel speed. */
export function marqueeDuration(distance: number, pxPerSec = 40): number {
  const ms = (distance / pxPerSec) * 1000
  return Math.max(1200, Math.min(6000, Math.round(ms)))
}
