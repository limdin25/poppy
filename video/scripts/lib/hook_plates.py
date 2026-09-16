"""The opening hook look engine. Black and white only, everything else moves.

Called by the assembler worker, once per post, to draw the three transparent
text plates that go over the blurred clip. Needs python3 and Pillow on the host.

  python3 scripts/lib/hook_plates.py <seed> '<json list of line-groups>' out1 out2 out3

Prints the chosen look as JSON on stdout: the worker reads the blur, dim and
beat timings out of it so the render and the plan can never disagree.

Given a seed it picks a typeface, a treatment, a position, an alignment, a case
and a size, and draws the two text plates. Same seed, same look, so any specific
opening can be reproduced and fixed. Different seed, different look.

Nothing in here is coloured. Hugo, 26 Aug 2026: black and white, vary the font,
the way it is written and the position instead.
"""

from PIL import Image, ImageDraw, ImageFont
import hashlib
import os
import sys
import json

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, "..", "..", "assets", "fonts-ttf")
W, H = 1080, 1920

FONTS = [
    "Archivo-ExtraBold",
    "Anton-Regular",
    "InterTight-ExtraBold",
    "BricolageGrotesque-ExtraBold",
    "Manrope-ExtraBold",
    "SchibstedGrotesk-ExtraBold",
    "Sora-ExtraBold",
    "SpaceGrotesk-Bold",
    "PlayfairDisplay-ExtraBold",
    "InstrumentSerif-Italic",
]

# how the words sit on the blurred footage
TREATMENTS = ["halo", "black-slab", "white-slab", "band"]
# Kept close to the middle of the screen. Hugo, 26 Aug 2026: the opening
# text belongs in the centre, not drifting to the top or the bottom.
POSITIONS = [0.42, 0.46, 0.50, 0.54]
ALIGNS = ["centre", "left"]
CASES = ["upper", "sentence"]


def rng(seed):
    """A repeatable 0..1 stream from a text seed."""
    h = int(hashlib.sha256(seed.encode()).hexdigest(), 16)

    def nxt():
        nonlocal h
        h = (h * 6364136223846793005 + 1442695040888963407) % (2**64)
        return (h >> 11) / float(2**53)

    return nxt


def plan(seed):
    r = rng(seed)
    return {
        "font": FONTS[int(r() * len(FONTS))],
        "treatment": TREATMENTS[int(r() * len(TREATMENTS))],
        "y": POSITIONS[int(r() * len(POSITIONS))],
        "align": ALIGNS[int(r() * len(ALIGNS))],
        "case": CASES[int(r() * len(CASES))],
        "scale": 0.82 + r() * 0.18,
        "blur": 34 + r() * 18,
        "dim": 0.06 + r() * 0.14,
        # three beats now, and the whole opening runs longer, so the tension
        # has somewhere to build before the clip starts.
        "beat1": 1.35 + r() * 0.25,
        "beat2": 1.30 + r() * 0.25,
        "beat3": 1.35 + r() * 0.30,
        "gap": 0.10 + r() * 0.12,
    }


def cased(text, mode):
    return text.upper() if mode == "upper" else text


def fit_font(d, lines, path, max_w, ceiling):
    size = ceiling
    while size > 34:
        f = ImageFont.truetype(path, size)
        if max(d.textlength(l, font=f) for l in lines) <= max_w:
            return f
        size -= 3
    return ImageFont.truetype(path, 34)


def draw_plate(lines, p, out):
    lines = [cased(l, p["case"]) for l in lines]
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    path = os.path.join(FONT_DIR, p["font"] + ".ttf")
    max_w = W - 150
    f = fit_font(d, lines, path, max_w, int(140 * p["scale"]))
    lh = int(f.size * 1.12)
    block_h = lh * len(lines)
    block_w = max(d.textlength(l, font=f) for l in lines)
    top = H * p["y"] - block_h / 2

    left_margin = 78
    def line_x(w):
        if p["align"] == "left":
            return left_margin
        return (W - w) / 2

    t = p["treatment"]
    if t == "band":
        d.rectangle([0, top - 46, W, top + block_h + 46], fill=(0, 0, 0, 205))
    elif t in ("black-slab", "white-slab"):
        pad = 40
        x0 = (left_margin - pad) if p["align"] == "left" else (W - block_w) / 2 - pad
        fill = (0, 0, 0, 232) if t == "black-slab" else (255, 255, 255, 240)
        d.rounded_rectangle([x0, top - pad, x0 + block_w + pad * 2, top + block_h + pad],
                            radius=18, fill=fill)

    ink = (17, 17, 17, 255) if t == "white-slab" else (255, 255, 255, 255)

    y = top
    for l in lines:
        w = d.textlength(l, font=f)
        x = line_x(w)
        if t == "halo":
            for dx, dy in ((-5, 0), (5, 0), (0, -5), (0, 5), (-4, -4), (4, 4), (-4, 4), (4, -4)):
                d.text((x + dx, y + dy), l, font=f, fill=(0, 0, 0, 200))
        d.text((x, y), l, font=f, fill=ink)
        y += lh

    img.save(out)


if __name__ == "__main__":
    seed = sys.argv[1]
    texts = json.loads(sys.argv[2])          # list of line-groups, one per beat
    outs = sys.argv[3:]
    p = plan(seed)
    for lines, out in zip(texts, outs):
        draw_plate(lines, p, out)
    total = p["beat1"] + p["beat2"] + p["beat3"] + p["gap"] * 2
    p["total"] = round(total, 2)
    print(json.dumps(p))
