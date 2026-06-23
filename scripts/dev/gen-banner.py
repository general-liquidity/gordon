#!/usr/bin/env python3
"""Generate the animated GORDON banner GIF for the README.

Recreates the landing-page hero effect: random block characters scramble and
settle into the wordmark, color shifting from the scramble green to the brand
green. Rendered with a real monospace font so the box-drawing glyphs align
exactly (the reason the live-SVG approach looked chaotic).

Run from the repo root:  python scripts/dev/gen-banner.py
Outputs: assets/gordon-banner.gif
"""
import random

from PIL import Image, ImageDraw, ImageFont
from matplotlib import font_manager

random.seed(7)  # deterministic output

OUT = "assets/gordon-banner.gif"
BANNER = [
    " ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗",
    "██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║",
    "██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║",
    "██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║",
    "╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║",
    " ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝",
]
BLOCK_CHARS = "█▓▒░▄▀▐▌■□▪▫#@$%&*+=~"
SCRAMBLE = (143, 191, 159)   # #8fbf9f
SETTLED = (21, 128, 61)      # #15803d
BG = (13, 17, 23)            # #0d1117  (GitHub-dark canvas; clean on both themes)

SIZE = 22
PAD = 26
SETTLE_FRAMES = 26
HOLD_FRAMES = 1              # one long final frame holds the settled wordmark

font = ImageFont.truetype(font_manager.findfont("DejaVu Sans Mono"), SIZE)
probe = Image.new("RGB", (10, 10))
d0 = ImageDraw.Draw(probe)
cw = d0.textlength("█", font=font)
asc, desc = font.getmetrics()
lh = asc + desc + 4

cols = max(len(line) for line in BANNER)
grid = [line.ljust(cols) for line in BANNER]
W = round(cols * cw) + PAD * 2
H = len(grid) * lh + PAD * 2

# each ink cell locks at a randomized frame, so the wordmark resolves in a scatter
lock = {}
for r, line in enumerate(grid):
    for c, ch in enumerate(line):
        if ch != " ":
            lock[(r, c)] = random.randint(0, SETTLE_FRAMES - 6)


def render(frame: int, settled: bool) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    for r, line in enumerate(grid):
        y = PAD + r * lh
        for c, ch in enumerate(line):
            if ch == " ":
                continue
            x = PAD + round(c * cw)
            if settled or frame >= lock[(r, c)]:
                draw.text((x, y), ch, font=font, fill=SETTLED)
            else:
                draw.text((x, y), random.choice(BLOCK_CHARS), font=font, fill=SCRAMBLE)
    return img


frames = [render(f, settled=False) for f in range(SETTLE_FRAMES)]
frames += [render(0, settled=True) for _ in range(HOLD_FRAMES)]
durations = [55] * SETTLE_FRAMES + [3200] * HOLD_FRAMES  # quick scramble, long hold

frames[0].save(
    OUT,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    optimize=True,
    disposal=2,
)
print(f"wrote {OUT}  ({W}x{H}, {len(frames)} frames)")
