#!/usr/bin/env python3
"""Generate the WorkSpace app icons (browser favicon + PWA + maskable).

Design: two lucide glyphs STACKED on a blue rounded square, each in its own
colour:

    terminal  (lower-left,  light blue)  — the agent's shell/workspace
    sparkles  (upper-right, amber)       — the AI

Both glyphs are the real lucide 24x24 stroke paths (stroke-width 2, round caps),
so the mark stays on-brand with the in-app icon set. The MASKABLE variant scales
the whole composition by 0.80 (Material safe zone) so an adaptive launcher does
not crop it.

Usage:  python3 tool/gen-icons.py [out-dir]     (default: public/)
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import cairosvg
from PIL import Image

BG = "#2563eb"          # blue-600
TERMINAL = "#f8fafc"    # near-white (slate-50) — the shell prompt
SPARKLES = "#fbbf24"    # amber-400 — the AI

# lucide paths (24x24 viewBox, stroke-based).
TERMINAL_PATHS = ['<path d="M12 19h8"/>', '<path d="m4 17 6-6-6-6"/>']
SPARKLES_PATHS = [
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>',
    '<path d="M20 2v4"/>',
    '<path d="M22 4h-4"/>',
    '<circle cx="4" cy="20" r="2"/>',
]

SIZE = 128
RADIUS = 28

# Ink extents of each glyph in its 24-unit viewBox (stroke included), used to
# centre each glyph's VISIBLE ink (not its nominal box).
TERMINAL_INK = (3, 4, 21, 20)
SPARKLES_INK = (1, 1, 23, 23)


def glyph(paths: list[str], colour: str, ink: tuple[int, int, int, int], scale: float, cx: float, cy: float) -> str:
    """Place a glyph so its ink centre lands at (cx, cy)."""
    x0, y0, x1, y1 = ink
    tx = cx - (x1 - x0) * scale / 2 - x0 * scale
    ty = cy - (y1 - y0) * scale / 2 - y0 * scale
    inner = "".join(paths)
    return (
        f'<g transform="translate({tx:.2f} {ty:.2f}) scale({scale})" fill="none" '
        f'stroke="{colour}" stroke-width="2.1" stroke-linecap="round" '
        f'stroke-linejoin="round">{inner}</g>'
    )


def svg(maskable: bool) -> str:
    # Two glyphs, diagonally STACKED with equal visual weight: the terminal
    # (shell) lower-left, the sparkles (AI) upper-right. Each is scaled so its
    # ink is ~46px tall (of 128).
    terminal = glyph(TERMINAL_PATHS, TERMINAL, TERMINAL_INK, 2.875, 40, 86)
    sparkles = glyph(SPARKLES_PATHS, SPARKLES, SPARKLES_INK, 2.09, 86, 40)
    inner = terminal + sparkles
    if maskable:
        inner = f'<g transform="translate(64 64) scale(0.80) translate(-64 -64)">{inner}</g>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" '
        f'width="{SIZE}" height="{SIZE}">'
        f'<rect width="{SIZE}" height="{SIZE}" rx="{RADIUS}" fill="{BG}"/>'
        f'{inner}</svg>'
    )


def render(svg_text: str, px: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=px, output_height=px)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public")
    out.mkdir(parents=True, exist_ok=True)
    any_svg = svg(False)
    mask_svg = svg(True)

    # Standalone icon.svg (browser tab / includeAssets).
    (out / "icon.svg").write_text(any_svg, encoding="utf-8")

    for px, name in [(192, "icon-192.png"), (512, "icon-512.png")]:
        render(any_svg, px).save(out / name)
    for px, name in [(192, "icon-192-maskable.png"), (512, "icon-512-maskable.png")]:
        render(mask_svg, px).save(out / name)
    # favicon: 64px reads well in a tab.
    render(any_svg, 64).save(out / "favicon.png")
    print(f"wrote icons to {out.resolve()}")


if __name__ == "__main__":
    main()
