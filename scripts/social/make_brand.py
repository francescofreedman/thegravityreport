#!/usr/bin/env python3
"""Profile picture + banner for every social account: the gravity well.

  python3 scripts/social/make_brand.py

Writes social/brand/:
  avatar-1080.png, avatar-400.png   white ground, blue grid bent around a blue mass (all platforms crop to a circle)
  banner-1500x500.png               X / Bluesky header: the same well seen from the side
  banner-3000x1000.png              same, at 2x
"""
import math
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import cardlib as cl  # noqa: E402

OUT = os.path.join(ROOT, "social", "brand")
K = 4  # supersample, then downscale for clean edges


def avatar(size):
    S = 1080 * K
    c = S // 2
    im = Image.new("RGB", (S, S), cl.WHITE)
    d = ImageDraw.Draw(im)

    def warp(x, y):
        dx, dy = x - c, y - c
        r = math.hypot(dx, dy) + 1e-6
        s = 1 - 0.7 * math.exp(-(r / (360 * K)) ** 2)
        return c + dx * s, c + dy * s

    for g in range(-4, 5):
        X = c + g * 150 * K
        d.line([warp(X, y) for y in range(-200, S + 200, 8)], fill=cl.ACCENT, width=22 * K, joint="curve")
        d.line([warp(x, X) for x in range(-200, S + 200, 8)], fill=cl.ACCENT, width=22 * K, joint="curve")
    r = 120 * K
    d.ellipse([c - r, c - r, c + r, c + r], fill=cl.ACCENT)
    return im.resize((size, size), Image.LANCZOS)


def banner(w, h):
    W, H = w * K // (w // 1500), h * K // (w // 1500)  # draw at 1500x500 * K, then resize
    im = Image.new("RGB", (W, H), cl.WHITE)
    d = ImageDraw.Draw(im)
    cx, cy = int(W * 0.62), int(H * 0.36)
    tilt = math.radians(34)
    sc = H * 0.95

    def proj(x, y):
        r = math.hypot(x, y)
        z = -0.5 * math.exp(-(r / 0.42) ** 2)
        p = 1 / (1 + 0.3 * y * math.cos(tilt))
        return cx + x * p * sc, cy + (-y * math.sin(tilt) - z * math.cos(tilt)) * p * sc

    lw = 5 * K
    xs, ys = 2.4, 1.1
    for i in range(-16, 17):
        u = xs * i / 16
        d.line([proj(u, -ys + 2 * ys * k / 300) for k in range(301)], fill=cl.ACCENT, width=lw, joint="curve")
    for i in range(-8, 9):
        v = ys * i / 8
        d.line([proj(-xs + 2 * xs * k / 600, v) for k in range(601)], fill=cl.ACCENT, width=lw, joint="curve")
    px, py = proj(0, 0)
    r = int(H * 0.085)
    d.ellipse([px - r, py - 2 * r + lw, px + r, py + lw], fill=cl.ACCENT)
    return im.resize((w, h), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    a = avatar(1080)
    a.save(os.path.join(OUT, "avatar-1080.png"))
    a.resize((400, 400), Image.LANCZOS).save(os.path.join(OUT, "avatar-400.png"))
    for w, h in [(1500, 500), (3000, 1000)]:
        banner(w, h).save(os.path.join(OUT, f"banner-{w}x{h}.png"))
    print(os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
