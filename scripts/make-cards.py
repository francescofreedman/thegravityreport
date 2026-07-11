#!/usr/bin/env python3
"""Social-preview cards (og:image), 1200x630, drawn in the site's Win98 language.
Usage: python3 scripts/make-cards.py          (writes cards/*.png)
Add new notes to CARDS below when publishing."""
import os

from PIL import Image, ImageDraw, ImageFont

F = "/System/Library/Fonts/Supplemental"
GEORGIA_B = f"{F}/Georgia Bold.ttf"
GEORGIA = f"{F}/Georgia.ttf"
TAHOMA_B = f"{F}/Tahoma Bold.ttf"
TAHOMA = f"{F}/Tahoma.ttf"

TEAL = (10, 122, 112)
CHROME = (212, 208, 200)
CHROME_DK = (128, 128, 128)
CHROME_DKR = (64, 64, 64)
COURT = (14, 90, 58)
COURT2 = (46, 107, 79)
AMBER = (178, 106, 31)
INK = (23, 26, 30)

W, H = 1200, 630

CARDS = [
    dict(out="site.png",
         kicker="AN INDEPENDENT NBA ANALYTICS PUBLICATION",
         title=["The Gravity Report"],
         chips=["research notes", "registered forecasts", "The 644"],
         tag="GRAVITY, the player-value model  ·  How good × how often"),
    dict(out="queta.png",
         kicker="RESEARCH NOTE No. 2  ·  A PREDICTION PAPER",
         title=["The Queta Problem"],
         chips=["#41 of 644", "registered bet: 75% top-50", "scores July 2027"],
         tag="The GRAVITY player-value model  ·  thegravityreport.com"),
    dict(out="morant.png",
         kicker="RESEARCH NOTE No. 1  ·  A CAREER AUTOPSY",
         title=["The Rise and Fall", "of Ja Morant"],
         chips=["97th percentile, 2021-22", "#140 of 644", "79 of 246 games"],
         tag="The GRAVITY player-value model  ·  thegravityreport.com"),
    dict(out="spec.png",
         kicker="TECHNICAL DOCUMENT  ·  VERSION 3  ·  CITABLE",
         title=["The GRAVITY", "Specification"],
         chips=["the player-value model", "every equation & weight", "5 pages"],
         tag="Game-Rate Adjusted Value, Impact, Talent, and Yield"),
    dict(out="the644.png",
         kicker="FLAGSHIP RANKING  ·  JULY 2026 EDITION  ·  FINAL",
         title=["The 644"],
         chips=["every NBA player, ranked", "GRAVITY v3", "next: All-Star 2027"],
         tag="The GRAVITY player-value model  ·  thegravityreport.com"),
]


def bevel(d, x0, y0, x1, y1, raised=True, w=3):
    lt = (255, 255, 255) if raised else CHROME_DKR
    rb = CHROME_DKR if raised else (255, 255, 255)
    for i in range(w):
        d.line([(x0 + i, y0 + i), (x1 - i, y0 + i)], fill=lt)   # top
        d.line([(x0 + i, y0 + i), (x0 + i, y1 - i)], fill=lt)   # left
        d.line([(x0 + i, y1 - i), (x1 - i, y1 - i)], fill=rb)   # bottom
        d.line([(x1 - i, y0 + i), (x1 - i, y1 - i)], fill=rb)   # right


def titlebar_gradient(img, x0, y0, x1, y1):
    for x in range(x0, x1):
        t = (x - x0) / max(1, (x1 - x0))
        c = tuple(int(COURT[i] + (79 + i * 0 - COURT[i] + (79, 122, 99)[i] - 79 + COURT2[i] - COURT2[i]) * 0) for i in range(3))
        # simple two-stop lerp court -> (79,122,99)
        end = (79, 122, 99)
        c = tuple(int(COURT[i] + (end[i] - COURT[i]) * t) for i in range(3))
        for y in range(y0, y1):
            img.putpixel((x, y), c)


def make(card):
    img = Image.new("RGB", (W, H), TEAL)
    d = ImageDraw.Draw(img)
    # subtle desktop vignette
    for y in range(H):
        if y % 3 == 0:
            continue
    # window
    wx0, wy0, wx1, wy1 = 46, 42, W - 46, H - 42
    d.rectangle([wx0, wy0, wx1, wy1], fill=CHROME)
    # drop shadow
    d.rectangle([wx1 + 1, wy0 + 8, wx1 + 8, wy1 + 8], fill=(6, 74, 68))
    d.rectangle([wx0 + 8, wy1 + 1, wx1 + 8, wy1 + 8], fill=(6, 74, 68))
    bevel(d, wx0, wy0, wx1, wy1, raised=True, w=3)
    # titlebar
    tx0, ty0, tx1, ty1 = wx0 + 8, wy0 + 8, wx1 - 8, wy0 + 62
    titlebar_gradient(img, tx0, ty0, tx1, ty1)
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(TAHOMA_B, 26)
    d.text((tx0 + 18, (ty0 + ty1) // 2), "The Gravity Report", font=f_title,
           fill=(255, 255, 255), anchor="lm")
    # window buttons
    for i, glyph in enumerate(["_", "□", "×"][::-1]):
        bx1 = tx1 - 12 - i * 44
        bx0 = bx1 - 36
        by0 = ty0 + 10
        by1 = ty1 - 10
        d.rectangle([bx0, by0, bx1, by1], fill=CHROME)
        bevel(d, bx0, by0, bx1, by1, raised=True, w=2)
        fb = ImageFont.truetype(TAHOMA_B, 20)
        d.text(((bx0 + bx1) // 2, (by0 + by1) // 2 - 2), glyph, font=fb, fill=INK, anchor="mm")
    # content pane (white, sunken)
    px0, py0, px1, py1 = wx0 + 8, ty1 + 8, wx1 - 8, wy1 - 64
    d.rectangle([px0, py0, px1, py1], fill=(255, 255, 255))
    bevel(d, px0, py0, px1, py1, raised=False, w=2)
    # kicker
    f_kick = ImageFont.truetype(TAHOMA_B, 24)
    d.text((px0 + 44, py0 + 46), card["kicker"], font=f_kick, fill=AMBER)
    # title (Georgia bold, up to 2 lines)
    lines = card["title"]
    size = 96 if len(lines) == 1 and len(lines[0]) <= 20 else 76
    f_big = ImageFont.truetype(GEORGIA_B, size)
    ty = py0 + 108
    for ln in lines:
        d.text((px0 + 40, ty), ln, font=f_big, fill=INK)
        ty += int(size * 1.12)
    # rule
    d.line([(px0 + 44, ty + 18), (px1 - 44, ty + 18)], fill=(200, 197, 189), width=2)
    # chips
    f_chip = ImageFont.truetype(TAHOMA_B, 25)
    cx = px0 + 44
    cy = ty + 44
    for chip in card["chips"]:
        tw = d.textlength(chip, font=f_chip)
        pad = 16
        d.rectangle([cx, cy, cx + tw + 2 * pad, cy + 46], fill=(237, 242, 238),
                    outline=COURT, width=2)
        d.text((cx + pad, cy + 9), chip, font=f_chip, fill=COURT)
        cx += tw + 2 * pad + 16
    # status bar
    sx0, sy0, sx1, sy1 = wx0 + 8, wy1 - 52, wx1 - 8, wy1 - 8
    d.rectangle([sx0, sy0, sx1, sy1], fill=CHROME)
    bevel(d, sx0, sy0, sx1, sy1, raised=False, w=2)
    f_tag = ImageFont.truetype(TAHOMA, 21)
    d.text((sx0 + 16, (sy0 + sy1) // 2), card["tag"], font=f_tag, fill=(60, 60, 60), anchor="lm")
    out = os.path.join(os.path.dirname(__file__), "..", "cards", card["out"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    print(f"cards/{card['out']}  ({os.path.getsize(out)//1024} KB)")


for c in CARDS:
    make(c)
