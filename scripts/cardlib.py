"""Drawing helpers for share cards and social images, in the site's look (design J).

White ground, near-black ink, electric-blue accent; Archivo (variable width/weight)
for display, IBM Plex Mono for labels and numbers. Used by make-cards.py and
scripts/social/make_kit.py.
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
ARCHIVO = os.path.join(FONTS, "Archivo[wdth,wght].ttf")
MONO = {400: "IBMPlexMono-Regular.ttf", 500: "IBMPlexMono-Medium.ttf", 600: "IBMPlexMono-SemiBold.ttf",
        700: "IBMPlexMono-Bold.ttf"}

WHITE = (255, 255, 255)
INK = (10, 10, 10)
INK2 = (51, 51, 51)
MUTED = (85, 85, 85)
RULE = (212, 212, 212)
TRACK = (230, 230, 230)
ACCENT = (42, 63, 240)
HL = (238, 240, 254)

_cache = {}


def archivo(size, weight=800, width=85):
    key = ("a", size, weight, width)
    if key not in _cache:
        f = ImageFont.truetype(ARCHIVO, size)
        f.set_variation_by_axes([weight, width])
        _cache[key] = f
    return _cache[key]


def mono(size, weight=500):
    key = ("m", size, weight)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(os.path.join(FONTS, MONO[weight]), size)
    return _cache[key]


def canvas(w, h):
    img = Image.new("RGB", (w, h), WHITE)
    return img, ImageDraw.Draw(img)


def text_w(d, s, font):
    return d.textlength(s, font=font)


def fit_archivo(d, s, max_w, start, minimum=28, weight=800, width=85):
    size = start
    while size > minimum and text_w(d, s, archivo(size, weight, width)) > max_w:
        size -= 2
    return archivo(size, weight, width)


def wrap(d, s, font, max_w):
    words, lines, cur = s.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if text_w(d, t, font) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_lines(d, xy, lines, font, fill, leading):
    x, y = xy
    for ln in lines:
        d.text((x, y), ln, font=font, fill=fill)
        y += leading
    return y


def brand(d, x, y, size=30):
    """Blue square + wordmark, as in the site header."""
    sq = int(size * 0.62)
    d.rectangle([x, y + (size - sq) // 2 + 2, x + sq, y + (size - sq) // 2 + 2 + sq], fill=ACCENT)
    d.text((x + sq + int(size * 0.45), y), "The Gravity Report", font=archivo(size, 800, 85), fill=INK)


def band(img, d, y, h, label, text, w=None):
    """Black ticker-style band with an accent label block on the left."""
    w = w or img.width
    d.rectangle([0, y, w, y + h], fill=INK)
    f = mono(int(h * 0.36), 600)
    lw = int(text_w(d, label, f)) + 44
    d.rectangle([0, y, lw, y + h], fill=ACCENT)
    d.text((22, y + h // 2), label, font=f, fill=WHITE, anchor="lm")
    d.text((lw + 22, y + h // 2), text, font=mono(int(h * 0.34), 500), fill=WHITE, anchor="lm")


def pbar(d, x, y, w, h, pct, label=True, pct_font=None):
    """Probability bar: track, accent fill, black coin-flip tick at 50%."""
    d.rectangle([x, y, x + w, y + h], fill=TRACK)
    d.rectangle([x, y, x + int(w * pct / 100), y + h], fill=ACCENT)
    tx = x + w // 2
    d.rectangle([tx - 2, y - h // 2, tx + 1, y + h + h // 2], fill=INK)
    if label:
        f = pct_font or mono(int(h * 2.2), 600)
        d.text((x + w + 18, y + h // 2), f"{pct}%", font=f, fill=INK, anchor="lm")


def save(img, path, quantize=True):
    """Flat colours + antialiased text: a 64-colour palette keeps cards small with no visible loss."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if quantize:
        img = img.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    img.save(path, optimize=True)
