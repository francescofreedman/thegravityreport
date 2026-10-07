#!/usr/bin/env python3
"""Social-preview cards (og:image, 1200x630) in the site's look (design J).

Usage:
  python3 scripts/make-cards.py            site + article cards (cards/*.png) and one card per player
  python3 scripts/make-cards.py --site     site + article cards only

Every number comes from content/the644.json and content/articles.json.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cardlib as cl  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
W, H = 1200, 630
PAD = 64


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def site_card(out, kicker, title, dek, band_label, band_text):
    img, d = cl.canvas(W, H)
    cl.brand(d, PAD, 52, 30)
    d.text((PAD, 150), kicker, font=cl.mono(22, 600), fill=cl.ACCENT)
    ft = cl.fit_archivo(d, title, W - 2 * PAD, 116, minimum=64)
    lines = cl.wrap(d, title, ft, W - 2 * PAD)
    if len(lines) > 1:
        ft = cl.archivo(84)
        lines = cl.wrap(d, title, ft, W - 2 * PAD)
    y = cl.draw_lines(d, (PAD - 4, 184), lines, ft, cl.INK, int(ft.size * 0.98))
    fd = cl.archivo(32, 400, 100)
    cl.draw_lines(d, (PAD, y + 22), cl.wrap(d, dek, fd, W - 2 * PAD)[:2], fd, cl.INK2, 42)
    cl.band(img, d, H - 84, 84, band_label, band_text)
    cl.save(img, os.path.join(ROOT, out))


def player_card(p, n, edition, team_name, tiers):
    img, d = cl.canvas(W, H)
    cl.brand(d, PAD, 52, 30)
    ed = f"THE 644 · {edition.upper()}"
    d.text((W - PAD, 62), ed, font=cl.mono(20, 500), fill=cl.MUTED, anchor="ra")
    score = f"{p['s']:.1f}"
    fs = cl.archivo(190, 800, 75)
    d.text((W - PAD, 150), score, font=fs, fill=cl.INK, anchor="ra")
    sw = cl.text_w(d, score, fs)
    d.text((W - PAD, 346), "GRAVITY SCORE", font=cl.mono(18, 600), fill=cl.MUTED, anchor="ra")
    d.text((PAD, 156), f"#{p['r']} OF {n}", font=cl.mono(30, 600), fill=cl.ACCENT)
    max_name = int(W - 2 * PAD - sw - 48)
    fn = cl.fit_archivo(d, p["n"], max_name, 110, minimum=60)
    lines = [p["n"]]
    if cl.text_w(d, p["n"], fn) > max_name:
        fn = cl.archivo(76)
        lines = cl.wrap(d, p["n"], fn, max_name)[:2]
    y = cl.draw_lines(d, (PAD - 3, 200), lines, fn, cl.INK, int(fn.size * 0.98))
    pos = p["p"] if p["p"] not in ("", "—") else "position TBD"
    sub = f"{team_name} · {pos}" + (f" · age {p['a']}" if p.get("a") not in ("", None) else "")
    if p.get("rk"):
        sub += f" · rookie, pick #{p['pk']}" if p.get("pk") else " · rookie"
    d.text((PAD, max(y + 18, 392)), sub, font=cl.archivo(32, 400, 100), fill=cl.INK2)
    d.text((PAD, max(y + 18, 392) + 52), f"TIER {p['tier']} — {tiers[str(p['tier'])].upper()}",
           font=cl.mono(20, 500), fill=cl.MUTED)
    cl.band(img, d, H - 84, 84, "THE 644", "50 = A LEAGUE-AVERAGE MINUTE · THEGRAVITYREPORT.COM")
    return img


def main():
    site = load("content/site.json")
    arts = load("content/articles.json")
    t644 = load("content/the644.json")
    players = t644["players"]
    top = "  ·  ".join(f"{p['r']} {p['n'].split(' ', 1)[-1].upper()} {p['s']:.1f}" for p in players[:4])
    site_card("cards/site.png", "INDEPENDENT NBA ANALYSIS", "The Gravity Report",
              "One model, every player, every forecast on the record.", "THE 644", top)
    site_card("cards/the644.png", f"THE 644 · {site['edition']['name'].upper()} EDITION",
              "The 644", "Every NBA player, one number. How good, times how often.", "THE 644", top)
    for a in arts:
        if a["kind"] == "article":
            kicker = a["kicker"].upper()
            label = f"ARTICLE №{a['n']}"
        else:
            kicker = "THE MODEL · VERSION 3 · TECHNICAL DOCUMENT"
            label = "THE MODEL"
        site_card(f"cards/{a['slug']}.png", kicker, a["title"], a["dek"], label,
                  "THEGRAVITYREPORT.COM" + a["web"].upper().rstrip("/"))
    print("site cards done")
    if "--site" in sys.argv:
        return
    # player cards: slugs come from players/index.json, written by build_site.py
    idx = {x["r"]: x for x in load("players/index.json")["players"]}
    team_name = {t["t"]: t["name"] for t in t644["TEAMS30"]}
    for p in players:
        img = player_card(p, len(players), site["edition"]["name"], team_name.get(p["t"], p["t"]), t644["TIERS"])
        cl.save(img, os.path.join(ROOT, "players", idx[p["r"]]["slug"], "card.png"))
    print(f"player cards done: {len(players)}")


if __name__ == "__main__":
    main()
