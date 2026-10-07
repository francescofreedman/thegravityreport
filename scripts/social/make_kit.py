#!/usr/bin/env python3
"""Post-kit generator: one event in, a ready-to-post kit out.

  python3 scripts/social/make_kit.py article kawhi [--date 2026-10-07]
  python3 scripts/social/make_kit.py player jalen-duren [--date ...]
  python3 scripts/social/make_kit.py edition
  (ledger kits come from scripts/social/ledger_tracker.py, which calls build_ledger_kit)

Writes social/kits/<date>-<kind>-<slug>/:
  kit.json               manifest (all text + image list + alt text + target platforms)
  x_thread.txt           posts separated by a line containing only "---" (each <= 280, links count 23)
  bluesky_thread.txt     same format (each <= 300 characters)
  threads.txt            one post (<= 500)
  instagram_caption.txt  (<= 2,200; says "link in bio")
  reddit.md              title + body for the team subreddit, for MANUAL posting only
  card-1200x675.png      X / Bluesky image
  ig-1080x1350-1..4.png  Instagram carousel

Number guard: every number in every post must appear in the published source
(article web edition + inbox summary, The 644 data, the ledger). If one doesn't,
the kit is refused. Nothing here posts anything.
"""
import argparse
import datetime
import html
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import cardlib as cl  # noqa: E402

SITE_URL = "https://thegravityreport.com"
LIMITS = {"x": 280, "bluesky": 300, "threads": 500, "instagram": 2200}
X_URL_LEN = 23

SUBREDDITS = {
    "ATL": "AtlantaHawks", "BOS": "bostonceltics", "BKN": "GoNets", "CHA": "CharlotteHornets",
    "CHI": "chicagobulls", "CLE": "clevelandcavs", "DAL": "Mavericks", "DEN": "denvernuggets",
    "DET": "DetroitPistons", "GSW": "warriors", "HOU": "rockets", "IND": "pacers", "LAC": "LAClippers",
    "LAL": "lakers", "MEM": "memphisgrizzlies", "MIA": "heat", "MIL": "MkeBucks", "MIN": "timberwolves",
    "NOP": "NOLAPelicans", "NYK": "NYKnicks", "OKC": "Thunder", "ORL": "OrlandoMagic", "PHI": "sixers",
    "PHX": "suns", "POR": "ripcity", "SAC": "kings", "SAS": "NBASpurs", "TOR": "torontoraptors",
    "UTA": "UtahJazz", "WAS": "washingtonwizards",
}


class NumberGuardError(ValueError):
    pass


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------ number guard

NUM_RE = re.compile(r"(?<![\w.])[-−+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)")


def norm_num(tok):
    t = tok.replace(",", "").replace("−", "-").lstrip("+")
    try:
        v = float(t)
    except ValueError:
        return None
    return f"{abs(v):.4f}"


def numbers_in(text):
    out = set()
    for m in NUM_RE.finditer(text):
        n = norm_num(m.group(0))
        if n is not None:
            out.add(n)
    return out


def plain(fragment):
    t = re.sub(r"<[^>]+>", " ", fragment or "")
    return html.unescape(re.sub(r"\s+", " ", t))


# Structural numbers that are part of names, dates and formats rather than claims.
ALWAYS_OK = {norm_num(x) for x in ["644", "30", "50", "100", "0", "2026", "2027", "2025", "26", "27", "1", "2", "3", "4"]}


def guard(texts, source_text):
    allowed = numbers_in(source_text) | ALWAYS_OK
    bad = []
    for t in texts:
        t2 = re.sub(r"https?://\S+", " ", t)  # URLs are not claims
        for m in NUM_RE.finditer(t2):
            n = norm_num(m.group(0))
            if n is not None and n not in allowed:
                bad.append(m.group(0))
    if bad:
        raise NumberGuardError(f"numbers not found in the published source: {sorted(set(bad))}")


# ------------------------------------------------------------------ limits

def x_len(post):
    return len(re.sub(r"https?://\S+", "x" * X_URL_LEN, post))


def graphemes(s):
    # close enough for Bluesky: count characters, not combining marks
    return sum(1 for ch in unicodedata.normalize("NFC", s) if not unicodedata.combining(ch))


def check_limits(kit):
    errs = []
    for i, p in enumerate(kit["x_thread"]):
        if x_len(p) > LIMITS["x"]:
            errs.append(f"x post {i + 1} is {x_len(p)} > 280")
    for i, p in enumerate(kit["bluesky_thread"]):
        if graphemes(p) > LIMITS["bluesky"]:
            errs.append(f"bluesky post {i + 1} is {graphemes(p)} > 300")
    if len(kit["threads"]) > LIMITS["threads"]:
        errs.append(f"threads post is {len(kit['threads'])} > 500")
    if len(kit["instagram_caption"]) > LIMITS["instagram"]:
        errs.append("instagram caption > 2200")
    if errs:
        raise ValueError("; ".join(errs))


# ------------------------------------------------------------------ images

def landscape(path, kicker, title, dek, band_label, band_text):
    W, H = 1200, 675
    img, d = cl.canvas(W, H)
    cl.brand(d, 64, 52, 30)
    d.text((64, 156), kicker, font=cl.mono(22, 600), fill=cl.ACCENT)
    ft = cl.fit_archivo(d, title, W - 128, 116, minimum=64)
    lines = cl.wrap(d, title, ft, W - 128)
    if len(lines) > 1:
        ft = cl.archivo(84)
        lines = cl.wrap(d, title, ft, W - 128)[:2]
    y = cl.draw_lines(d, (60, 190), lines, ft, cl.INK, int(ft.size * 0.98))
    fd = cl.archivo(32, 400, 100)
    cl.draw_lines(d, (64, y + 22), cl.wrap(d, dek, fd, W - 128)[:3], fd, cl.INK2, 42)
    cl.band(img, d, H - 84, 84, band_label, band_text)
    cl.save(img, path)


def ig_frame():
    W, H = 1080, 1350
    img, d = cl.canvas(W, H)
    cl.brand(d, 72, 72, 34)
    return img, d, W, H


def ig_cover(path, kicker, title, dek, band_label, n_of):
    img, d, W, H = ig_frame()
    d.text((72, 360), kicker, font=cl.mono(26, 600), fill=cl.ACCENT)
    ft = cl.archivo(124)
    lines = cl.wrap(d, title, ft, W - 144)
    if len(lines) > 3:
        ft = cl.archivo(96)
        lines = cl.wrap(d, title, ft, W - 144)
    y = cl.draw_lines(d, (66, 410), lines, ft, cl.INK, int(ft.size * 0.98))
    fd = cl.archivo(40, 400, 100)
    cl.draw_lines(d, (72, y + 30), cl.wrap(d, dek, fd, W - 144)[:4], fd, cl.INK2, 54)
    cl.band(img, d, H - 96, 96, band_label, f"SWIPE · {n_of}")
    cl.save(img, path)


def ig_fact(path, value, label, kicker, n_of):
    img, d, W, H = ig_frame()
    d.text((72, 300), kicker, font=cl.mono(26, 600), fill=cl.ACCENT)
    fv = cl.fit_archivo(d, value, W - 144, 300, minimum=120, width=75)
    d.text((64, 340), value, font=fv, fill=cl.INK)
    fl = cl.archivo(48, 500, 100)
    cl.draw_lines(d, (72, 360 + int(fv.size * 1.05)), cl.wrap(d, label, fl, W - 144)[:5], fl, cl.INK2, 62)
    cl.band(img, d, H - 96, 96, "THE GRAVITY REPORT", n_of)
    cl.save(img, path)


def ig_bars(path, title, items, n_of, note):
    img, d, W, H = ig_frame()
    d.text((72, 220), "REGISTERED BEFORE TIP-OFF", font=cl.mono(26, 600), fill=cl.ACCENT)
    ft = cl.archivo(76)
    y = cl.draw_lines(d, (68, 262), cl.wrap(d, title, ft, W - 144)[:2], ft, cl.INK, 78)
    y += 30
    fs = cl.mono(22, 500)
    d.text((72, y), "0%", font=fs, fill=cl.MUTED)
    d.text((72 + 380, y), "coin flip", font=fs, fill=cl.MUTED, anchor="ma")
    d.text((72 + 760, y), "100%", font=fs, fill=cl.MUTED, anchor="ra")
    y += 50
    fc = cl.archivo(38, 600, 100)
    for claim, p in items:
        lines = cl.wrap(d, claim, fc, W - 144)[:2]
        y = cl.draw_lines(d, (72, y), lines, fc, cl.INK, 48)
        cl.pbar(d, 72, y + 14, 760, 20, p, pct_font=cl.mono(44, 600))
        y += 96
    d.text((72, min(y + 10, H - 170)), note, font=cl.mono(22, 500), fill=cl.MUTED)
    cl.band(img, d, H - 96, 96, "THE GRAVITY REPORT", n_of)
    cl.save(img, path)


def ig_cta(path, title, url_text, n_of):
    img, d, W, H = ig_frame()
    d.text((72, 380), "READ IT FREE", font=cl.mono(28, 600), fill=cl.ACCENT)
    ft = cl.archivo(104)
    y = cl.draw_lines(d, (66, 430), cl.wrap(d, title, ft, W - 144)[:3], ft, cl.INK, 102)
    fd = cl.archivo(44, 500, 100)
    cl.draw_lines(d, (72, y + 30), ["Link in bio.", url_text], fd, cl.INK2, 60)
    d.rectangle([72, y + 190, 72 + 360, y + 290], fill=cl.ACCENT)
    d.text((72 + 180, y + 240), "Follow for more", font=cl.archivo(40, 700, 100), fill=cl.WHITE, anchor="mm")
    cl.band(img, d, H - 96, 96, "THE GRAVITY REPORT", n_of)
    cl.save(img, path)


# ------------------------------------------------------------------ kits

def article_source(slug):
    """Everything already published about this article: web edition text + inbox summary + data."""
    parts = []
    pg = os.path.join(ROOT, "content/pages", slug + ".json")
    if os.path.exists(pg):
        parts.append(plain(load(f"content/pages/{slug}.json")["body"]))
    msgs = load("content/legacy/messages.json")["M"]
    if slug in msgs:
        parts.append(plain(msgs[slug]["body"]) + " " + msgs[slug]["subject"])
    a = next(x for x in load("content/articles.json") if x["slug"] == slug)
    parts.append(json.dumps({k: v for k, v in a.items() if k != "social"}, ensure_ascii=False))
    for e in load("content/ledger.json")["entries"]:
        if e.get("article") == slug:
            parts.append(json.dumps(e, ensure_ascii=False))
    return " ".join(parts)


def build_article_kit(slug, date, outdir=None, images=True):
    arts = load("content/articles.json")
    a = next(x for x in arts if x["slug"] == slug)
    s = a["social"]
    ledger = {e["id"]: e for e in load("content/ledger.json")["entries"]}
    url = SITE_URL + a["web"]
    calls = [ledger[i] for i in a.get("ledger", [])]
    x_posts = [s["hook"]] + list(s["points"])
    if calls:
        lines = "\n".join(f"{c['p']}%  {c.get('box', c['claim'])}" for c in calls)
        x_posts.append("Our calls, registered before tip-off and graded in public:\n" + lines)
    x_posts.append(f"The full article, in plain language ({a['pages']} pages):\n{url}")
    threads = f"{s['hook']}\n\n{s['points'][0]}\n\nRead it: {url}"
    if len(threads) > LIMITS["threads"]:
        threads = f"{s['hook']}\n\nRead it: {url}"
    ig = "\n\n".join([s["hook"]] + list(s["points"]))
    if calls:
        ig += "\n\nOur calls, registered before tip-off:\n" + "\n".join(
            f"{c['p']}% · {c.get('box', c['claim'])}" for c in calls)
    ig += "\n\nThe full article is free. Link in bio.\n\n#NBA"
    sub = SUBREDDITS.get(s.get("team", ""), "nbadiscussion")
    reddit = (f"# r/{sub} (post by hand; read the sub's self-promotion rules first)\n\n"
              f"**Title:** {a['title']}: {a['dek'].rstrip('.')}\n\n**Body:**\n\n" + "\n\n".join(x_posts[:-1]) +
              f"\n\nFull article (free, no ads): {url}\n\nHappy to answer questions about the method in the comments.\n")
    kit = {
        "kind": "article", "slug": slug, "date": date, "url": url,
        "title": a["title"],
        "x_thread": x_posts, "bluesky_thread": x_posts, "threads": threads, "instagram_caption": ig,
        "reddit": {"subreddit": sub, "markdown": reddit},
        "images": {
            "card": "card-1200x675.png",
            "carousel": ["ig-1080x1350-1.png", "ig-1080x1350-2.png", "ig-1080x1350-3.png", "ig-1080x1350-4.png"],
        },
        "alt": {
            "card-1200x675.png": f"{a['title']}. {a['dek']} The Gravity Report.",
            "ig-1080x1350-1.png": f"{a['title']}: {a['dek']}",
            "ig-1080x1350-2.png": f"{s['big']['value']} — {s['big']['label']}.",
            "ig-1080x1350-3.png": ("Registered forecasts as probability bars: " + "; ".join(
                f"{c.get('box', c['claim'])}, {c['p']}%" for c in calls) + ".") if calls else s["points"][-1],
            "ig-1080x1350-4.png": f"Read {a['title']} free at thegravityreport.com. Link in bio.",
        },
    }
    texts = x_posts + [threads, ig, reddit] + list(kit["alt"].values()) + [s["big"]["value"], s["big"]["label"]]
    guard(texts, article_source(slug))
    check_limits(kit)
    if outdir is None:
        outdir = os.path.join(ROOT, "social", "kits", f"{date}-article-{slug}")
    write_kit(kit, outdir)
    if images:
        label = f"ARTICLE №{a['n']}"
        landscape(os.path.join(outdir, "card-1200x675.png"), a["kicker"].upper(), a["title"], a["dek"], label,
                  "THEGRAVITYREPORT.COM" + a["web"].upper().rstrip("/"))
        ig_cover(os.path.join(outdir, "ig-1080x1350-1.png"), a["kicker"].upper(), a["title"], a["dek"], label, "1/4")
        ig_fact(os.path.join(outdir, "ig-1080x1350-2.png"), s["big"]["value"], s["big"]["label"], label, "2/4")
        if calls:
            ig_bars(os.path.join(outdir, "ig-1080x1350-3.png"), "What we think happens next",
                    [(c.get("box", c["claim"]), c["p"]) for c in calls], "3/4",
                    "The black tick marks 50%, a coin flip.")
        else:
            ig_fact(os.path.join(outdir, "ig-1080x1350-3.png"), s["big"]["value"], s["points"][-1], label, "3/4")
        ig_cta(os.path.join(outdir, "ig-1080x1350-4.png"), a["title"], "thegravityreport.com", "4/4")
    return kit, outdir


def player_source(p, extra):
    # the player's own record + the published scale ("50 ... 60+ ... 80+") from the spec note
    scale = plain(load("content/legacy/messages.json")["M"]["spec"]["body"])
    return json.dumps(p, ensure_ascii=False) + " " + json.dumps(extra, ensure_ascii=False) + " " + scale


def fmt_ts(x):
    s = f"{float(x):.3f}"
    return s[1:] if s.startswith("0") else s


def player_text(p, team, n=644):
    pos = p["p"] if p["p"] not in ("", "—") else "position TBD"
    url = f"{SITE_URL}/players/{p['slug']}/"
    hook = f"#{p['r']} of {n} in The 644: {p['n']} ({team}, {pos})."
    score = f"GRAVITY score {p['s']:.1f}. 50 is a league-average minute; 60+ a quality starter; 80+ a franchise engine."
    if p.get("rk"):
        line = (f"Rookie, pick #{p['pk']}. His score starts from a draft-slot prior." if p.get("pk")
                else "Rookie. His score starts from a draft-slot prior.")
    else:
        bits = []
        if p.get("us") is not None:
            bits.append(f"{p['us']:.1f}% usage")
        if p.get("ts") is not None:
            bits.append(f"{fmt_ts(p['ts'])} true shooting")
        if p.get("b") is not None:
            bits.append(f"Box Plus/Minus {p['b']:+.1f}")
        line = "2025–26: " + ", ".join(bits) + "." if bits else ""
    return hook, score, line, url


def build_player_kit(slug, date, outdir=None, images=True):
    idx = {x["slug"]: x for x in load("players/index.json")["players"]}
    t644 = load("content/the644.json")
    ref = idx[slug]
    p = dict(next(x for x in t644["players"] if x["r"] == ref["r"]))
    p["slug"] = slug
    team = ref["team"]
    hook, score, line, url = player_text(p, team, len(t644["players"]))
    short = f"GRAVITY score {p['s']:.1f} (50 is a league-average minute)."
    post = "\n\n".join(x for x in [hook, short, line, f"Full profile: {url}"] if x)
    ig = "\n\n".join(x for x in [hook, score, line, "Every player's page is free. Link in bio.", "#NBA"] if x)
    sub = SUBREDDITS.get(p["t"], "nbadiscussion")
    kit = {
        "kind": "player", "slug": slug, "date": date, "url": url, "title": p["n"],
        "x_thread": [post], "bluesky_thread": [post], "threads": post, "instagram_caption": ig,
        "reddit": {"subreddit": sub, "markdown": f"# r/{sub} (post by hand; read the sub's rules first)\n\n**Title:** Where {p['n']} ranks among all 644 NBA players\n\n**Body:**\n\n{hook} {score} {line}\n\n{url}\n"},
        "images": {"card": f"/players/{slug}/card.png", "carousel": ["ig-1080x1350-1.png"]},
        "alt": {"card": f"{p['n']}, #{p['r']} of 644 in The 644, GRAVITY score {p['s']:.1f}. {team}.",
                "ig-1080x1350-1.png": f"{p['n']}, #{p['r']} of 644, GRAVITY score {p['s']:.1f}."},
    }
    guard([post, ig, kit["reddit"]["markdown"]] + list(kit["alt"].values()), player_source(p, {"team": team}))
    check_limits(kit)
    if outdir is None:
        outdir = os.path.join(ROOT, "social", "kits", f"{date}-player-{slug}")
    write_kit(kit, outdir)
    if images:
        ig_fact(os.path.join(outdir, "ig-1080x1350-1.png"), f"{p['s']:.1f}",
                f"{p['n']}: #{p['r']} of 644 in The 644. {team}, {p['p'] if p['p'] not in ('', '—') else 'position TBD'}.",
                "THE 644 · GRAVITY SCORE", "THEGRAVITYREPORT.COM")
    return kit, outdir


def build_ledger_kit(rows, as_of, date, outdir=None, images=True, source_text=""):
    """rows: [{id, claim, p, status_line}] — status lines come from ledger_tracker.py with their own source."""
    url = SITE_URL + "/ledger/"
    head = f"Is the model winning? Our open calls, as of {as_of}:"
    lines = [f"{r['id']} · {r['p']}% · {r['claim']}: {r['status_line']}" for r in rows]
    posts, cur = [], head
    for ln in lines:
        if x_len(cur + "\n\n" + ln) > LIMITS["x"]:
            posts.append(cur)
            cur = ln
        else:
            cur = cur + "\n\n" + ln
    posts.append(cur)
    posts.append(f"Every call was registered before tip-off. Grades are final in April and July 2027.\n{url}")
    ig = head + "\n\n" + "\n\n".join(lines) + "\n\nLink in bio.\n\n#NBA"
    kit = {"kind": "ledger", "slug": "tracker", "date": date, "url": url, "title": "Is the model winning?",
           "x_thread": posts, "bluesky_thread": posts, "threads": (head + "\n\n" + "\n".join(lines))[:470] + f"\n{url}",
           "instagram_caption": ig, "reddit": None,
           "images": {"card": "card-1200x675.png", "carousel": ["ig-1080x1350-1.png"]},
           "alt": {"card-1200x675.png": "Forecast Ledger tracker: " + "; ".join(lines),
                   "ig-1080x1350-1.png": "Open forecasts as probability bars with where each stands so far."}}
    if len(kit["threads"]) > LIMITS["threads"]:
        kit["threads"] = head + f"\n{url}"
    guard(posts + [ig], source_text)
    check_limits(kit)
    if outdir is None:
        outdir = os.path.join(ROOT, "social", "kits", f"{date}-ledger-tracker")
    write_kit(kit, outdir)
    if images:
        landscape(os.path.join(outdir, "card-1200x675.png"), f"FORECAST LEDGER · AS OF {as_of.upper()}",
                  "Is the model winning?", f"{len(rows)} open calls, tracked against this season's numbers.",
                  "THE LEDGER", "THEGRAVITYREPORT.COM/LEDGER")
        ig_bars(os.path.join(outdir, "ig-1080x1350-1.png"), "Is the model winning?",
                [(f"{r['id']}: {r['claim']}", r["p"]) for r in rows[:6]], "1/1", f"As of {as_of}.")
    return kit, outdir


def write_kit(kit, outdir):
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "kit.json"), "w", encoding="utf-8") as f:
        json.dump(kit, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(os.path.join(outdir, "x_thread.txt"), "w", encoding="utf-8") as f:
        f.write("\n---\n".join(kit["x_thread"]) + "\n")
    with open(os.path.join(outdir, "bluesky_thread.txt"), "w", encoding="utf-8") as f:
        f.write("\n---\n".join(kit["bluesky_thread"]) + "\n")
    with open(os.path.join(outdir, "threads.txt"), "w", encoding="utf-8") as f:
        f.write(kit["threads"] + "\n")
    with open(os.path.join(outdir, "instagram_caption.txt"), "w", encoding="utf-8") as f:
        f.write(kit["instagram_caption"] + "\n")
    if kit.get("reddit"):
        with open(os.path.join(outdir, "reddit.md"), "w", encoding="utf-8") as f:
            f.write(kit["reddit"]["markdown"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["article", "player", "edition"])
    ap.add_argument("slug", nargs="?")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--no-images", action="store_true")
    a = ap.parse_args(argv)
    if a.kind == "article":
        kit, out = build_article_kit(a.slug, a.date, images=not a.no_images)
    elif a.kind == "player":
        kit, out = build_player_kit(a.slug, a.date, images=not a.no_images)
    else:
        # a new 644 edition: the edition card + the top-10 post
        idx = load("players/index.json")
        top = "\n".join(f"{p['r']}. {p['n']} {p['s']:.1f}" for p in idx["players"][:10])
        post = f"The 644, {idx['edition']} edition: every NBA player, one number.\n\n{top}"
        if x_len(post) > LIMITS["x"]:
            top = "\n".join(f"{p['r']}. {p['n']} {p['s']:.1f}" for p in idx["players"][:5])
            post = f"The 644, {idx['edition']} edition: every NBA player, one number.\n\n{top}"
        kit = {"kind": "edition", "slug": "the644", "date": a.date, "url": SITE_URL + "/the644/",
               "title": "The 644", "x_thread": [post, f"All 644, searchable: {SITE_URL}/the644/"],
               "bluesky_thread": [post, f"All 644, searchable: {SITE_URL}/the644/"],
               "threads": post + f"\n\n{SITE_URL}/the644/", "instagram_caption": post + "\n\nLink in bio.\n\n#NBA",
               "reddit": None, "images": {"card": "/cards/the644.png", "carousel": []},
               "alt": {"card": "The 644: every NBA player, one number."}}
        guard(kit["x_thread"] + [kit["instagram_caption"]], json.dumps(idx, ensure_ascii=False))
        check_limits(kit)
        out = os.path.join(ROOT, "social", "kits", f"{a.date}-edition-the644")
        write_kit(kit, out)
    print(os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
