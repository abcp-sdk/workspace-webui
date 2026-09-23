// Line-number gutter sizing — pure helpers shared by the code surface, the
// diff view and the blame view. The gutter must be wide enough for the widest
// number it will show, so its width is derived from the DIGIT COUNT of the
// largest line number (never a fixed px width that a 5-digit number overflows).
//
// The width is a `calc()` of the digits (in `ch`) PLUS a padding term: the
// gutter spans have `box-sizing: border-box` and horizontal padding, so a bare
// `Nch` width would clip the digits. `padRem` must cover the element's total
// horizontal padding (e.g. `px-2` on both sides = 1rem).

/** How many characters the gutter must fit (at least 2, so a 1-line file still
 *  reserves room and does not jump around). */
export function gutterDigits(maxLine: number): number {
  return Math.max(2, String(Math.max(0, Math.floor(maxLine))).length)
}

/** A CSS width for the gutter that fits `maxLine`'s digits and its padding. */
export function gutterWidth(maxLine: number, padRem = 1.25): string {
  return `calc(${gutterDigits(maxLine)}ch + ${padRem}rem)`
}
