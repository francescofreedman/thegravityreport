#!/usr/bin/env python3
"""Post-kit generator: one event in, a ready-to-post kit out.

  python3 scripts/social/make_kit.py article kawhi [--date 2026-10-07]
  python3 scripts/social/make_kit.py article kawhi --frame tracking --angle 2   ("From the archive")
  python3 scripts/social/make_kit.py player jalen-duren [--date ...]
  python3 scripts/social/make_kit.py team OKC [--date ...]          ("The 644 on your team")
  python3 scripts/social/make_kit.py team all --date 2026-10-24     (all 30, one a day, TORQUE order)
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

# The 644 uses NBA codes; TORQUE (the30/torque-2026-27.json) uses Basketball Reference's for three teams.
TORQUE_CODE = {"CHA": "CHO", "PHX": "PHO", "BKN": "BRK"}
FROM_TORQUE = {v: k for k, v in TORQUE_CODE.items()}


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


def fits(post):
    return x_len(post) <= LIMITS["x"] and graphemes(post) <= LIMITS["bluesky"]


def pack_posts(head, lines, tail=None):
    """head, then one line per item, split into posts that fit both X and Bluesky; tail is the last post."""
    posts, cur = [], head
    for ln in lines:
        nxt = (cur + ("\n\n" if cur == head else "\n") + ln) if cur else ln
        if fits(nxt):
            cur = nxt
        else:
            posts.append(cur)
            cur = ln
    if cur:
        posts.append(cur)
    if tail:
        posts.append(tail)
    return posts


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


def latin(s):
    """Archivo has no Cyrillic: the data spells one name with a Cyrillic ё, which the card swaps for ë."""
    return s.replace("ё", "ë").replace("Ё", "Ë")


def team_card(path, name, rows):
    """1200x675: a team's top eight in The 644, two columns of rank + name + score."""
    W, H = 1200, 675
    img, d = cl.canvas(W, H)
    cl.brand(d, 64, 52, 30)
    d.text((64, 130), "THE 644 ON YOUR TEAM", font=cl.mono(22, 600), fill=cl.ACCENT)
    ft = cl.fit_archivo(d, name, W - 128, 84, minimum=48)
    y = cl.draw_lines(d, (60, 160), [name], ft, cl.INK, int(ft.size * 1.0)) + 20
    col_w = (W - 128 - 48) // 2
    for i, (r, nm, s, rk) in enumerate(rows[:8]):
        x = 64 + (i // 4) * (col_w + 48)
        yy = y + (i % 4) * 68
        d.text((x, yy + 6), f"#{r}", font=cl.mono(24, 600), fill=cl.MUTED)
        fn = cl.fit_archivo(d, latin(nm), col_w - 190, 32, minimum=20, weight=700, width=100)
        d.text((x + 86, yy), latin(nm), font=fn, fill=cl.INK)
        d.text((x + col_w, yy + 2), f"{s:.1f}", font=cl.mono(30, 600), fill=cl.ACCENT, anchor="ra")
    cl.band(img, d, H - 84, 84, "GRAVITY SCORE", "50 = LEAGUE AVERAGE · THEGRAVITYREPORT.COM/THE644")
    cl.save(img, path)


def ig_table(path, kicker, title, rows, band_label, band_text, note):
    """1080x1350: a ranked list of up to eight (rank, name, score, rookie) rows."""
    img, d, W, H = ig_frame()
    d.text((72, 220), kicker, font=cl.mono(26, 600), fill=cl.ACCENT)
    ft = cl.fit_archivo(d, title, W - 144, 96, minimum=56)
    lines = cl.wrap(d, title, ft, W - 144)[:2]
    y = cl.draw_lines(d, (66, 262), lines, ft, cl.INK, int(ft.size * 1.0)) + 36
    for r, nm, s, rk in rows[:8]:
        d.text((72, y + 10), f"#{r}", font=cl.mono(30, 600), fill=cl.MUTED)
        fn = cl.fit_archivo(d, latin(nm), 640, 44, minimum=28, weight=700, width=100)
        d.text((190, y), latin(nm), font=fn, fill=cl.INK)
        d.text((1008, y + 4), f"{s:.1f}", font=cl.mono(40, 600), fill=cl.ACCENT, anchor="ra")
        y += 86
    d.text((72, y + 12), note, font=cl.mono(22, 500), fill=cl.MUTED)
    cl.band(img, d, H - 96, 96, band_label, band_text)
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


# "tracking" frame: for pieces published before the accounts existed. The posts say when the
# piece came out and what we're watching, instead of presenting it as news.
SUBJECTS = {"kawhi": "Kawhi Leonard", "queta": "Neemias Queta", "morant": "Ja Morant",
            "duren": "Jalen Duren", "jokic": "Nikola Jokić"}
COUNT_WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine"}


def pub_date(iso):
    d = datetime.date.fromisoformat(iso)
    return f"{d.strftime('%B')} {d.day}"


def short_article(slug):
    """A short Article's JSON front matter + body text, or None."""
    path = os.path.join(ROOT, "content", "short", slug + ".md")
    if not os.path.exists(path):
        return None, ""
    raw = open(path, encoding="utf-8").read()
    _, head, body = raw.split("---\n", 2)
    a = json.loads(head)
    a.setdefault("web", f"/articles/{slug}/")
    a.setdefault("format", "short")
    a.setdefault("kicker", "Article")
    return a, body


def archive_articles():
    """Deep Dives with a social block, in Deep Dive order: the "From the archive" rotation."""
    arts = [a for a in load("content/articles.json") if a.get("social") and a["slug"] in SUBJECTS]
    return [a["slug"] for a in sorted(arts, key=lambda a: int(a.get("n") or 0))]


def all_archive_kits(start_date, images=True):
    """"From the archive": one tracking-frame, angle-2 kit per article, one Sunday apart from start_date."""
    d0 = datetime.date.fromisoformat(start_date)
    outs = []
    for i, slug in enumerate(archive_articles()):
        day = (d0 + datetime.timedelta(days=7 * i)).isoformat()
        outs.append(build_article_kit(slug, day, images=images, frame="tracking", angle=2)[1])
    return outs


def build_article_kit(slug, date, outdir=None, images=True, frame="news", angle=1):
    """angle 2 (tracking frame only, "From the archive"): the first point leads instead of the hook,
    and the closer names the publish date."""
    arts = load("content/articles.json")
    a = next((x for x in arts if x["slug"] == slug), None)
    short_body = ""
    if a is None:
        a, short_body = short_article(slug)
        if a is None:
            raise KeyError(f"no article {slug}")
    s = a["social"]
    ledger = {e["id"]: e for e in load("content/ledger.json")["entries"]}
    url = SITE_URL + a["web"]
    calls = [ledger[i] for i in a.get("ledger", [])]
    tracking = frame == "tracking"
    archive = tracking and angle == 2
    extra_source = ""
    if tracking:
        who, when = SUBJECTS[slug], pub_date(a["date"])
        extra_source = when
        if calls:
            opener = (f"The season is underway. On {when}, before tip-off, we put {COUNT_WORDS[len(calls)]} "
                      f"calls on {who}'s year. Each one gets graded in public.")
        else:
            opener = f"The season is underway. On {when}, we took a hard look at {who}. Here's what we found."
        call_label, ig_call_label = "What we said:", "What we said:"
        if archive:
            closer = (f"From the archive: we published this on {when}. Every call is tracked on our public ledger. The full piece, free:\n{url}"
                      if calls else f"From the archive: we published this on {when}. The full piece, free:\n{url}")
            x_posts = [s["points"][0], opener, s["hook"]] + list(s["points"][1:])
        else:
            closer = (f"Every call is tracked on our public ledger. The full piece, from {when}:\n{url}" if calls
                      else f"The full piece, from {when}:\n{url}")
            x_posts = [opener, s["hook"]] + list(s["points"])
    else:
        call_label = "Our calls, registered before tip-off and graded in public:"
        ig_call_label = "Our calls, registered before tip-off:"
        closer = (f"The full article, in plain language ({a['pages']} pages):\n{url}" if a.get("pages")
                  else f"The full article, free:\n{url}")
        x_posts = [s["hook"]] + list(s["points"])
    shown = calls[:4]
    if calls:
        lines = "\n".join(f"{c['p']}%  {c.get('box', c['claim'])}" for c in shown)
        if len(calls) > len(shown):
            lines += f"\n…and {len(calls) - len(shown)} more, all on the public ledger."
            extra_source += f" {len(calls) - len(shown)}"
        x_posts.append(call_label + "\n" + lines)
    x_posts.append(closer)
    if archive:
        lead = f"{s['points'][0]}\n\n{opener}"
        threads = f"{lead}\n\n{s['hook']}\n\nFrom the archive, {when}: {url}"
        if len(threads) > LIMITS["threads"]:
            threads = f"{lead}\n\nFrom the archive, {when}: {url}"
    else:
        lead = f"{opener}\n\n{s['hook']}" if tracking else s["hook"]
        threads = f"{lead}\n\n{s['points'][0]}\n\nRead it: {url}"
        if len(threads) > LIMITS["threads"]:
            threads = f"{lead}\n\nRead it: {url}"
    ig = "\n\n".join(x_posts[:len(x_posts) - (2 if calls else 1)])
    if calls:
        ig += f"\n\n{ig_call_label}\n" + "\n".join(f"{c['p']}% · {c.get('box', c['claim'])}" for c in shown)
        if len(calls) > len(shown):
            ig += f"\n…and {len(calls) - len(shown)} more on the ledger."
    ig += (f"\n\nThe full piece, from {pub_date(a['date'])}, is free. Link in bio.\n\n#NBA" if tracking
           else "\n\nThe full article is free. Link in bio.\n\n#NBA")
    sub = SUBREDDITS.get(s.get("team", ""), "nbadiscussion")
    if tracking:
        title = (f"Before the season, we put numbers on {SUBJECTS[slug]}. Here's what we're watching" if calls
                 else f"{a['title']}: {a['dek'].rstrip('.')} (from {pub_date(a['date'])})")
        link_line = f"Full piece, from {pub_date(a['date'])} (free, no ads): {url}"
    else:
        title = f"{a['title']}: {a['dek'].rstrip('.')}"
        link_line = f"Full article (free, no ads): {url}"
    reddit = (f"# r/{sub} (post by hand; read the sub's self-promotion rules first)\n\n"
              f"**Title:** {title}\n\n**Body:**\n\n" + "\n\n".join(x_posts[:-1]) +
              f"\n\n{link_line}\n\nHappy to answer questions about the method in the comments.\n")
    kit = {
        "kind": "article", "slug": slug, "date": date, "url": url,
        "title": a["title"], "frame": frame, "angle": angle, **({"series": "archive"} if archive else {}),
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
                f"{c.get('box', c['claim'])}, {c['p']}%" for c in shown) + ".") if calls else s["points"][-1],
            "ig-1080x1350-4.png": f"Read {a['title']} free at thegravityreport.com. Link in bio.",
        },
    }
    texts = x_posts + [threads, ig, reddit] + list(kit["alt"].values()) + [s["big"]["value"], s["big"]["label"]]
    src = article_source(slug) if not short_body else short_body + " " + json.dumps(a, ensure_ascii=False) + " " + " ".join(
        json.dumps(e, ensure_ascii=False) for e in load("content/ledger.json")["entries"] if e["id"] in a.get("ledger", []))
    guard(texts, src + " " + extra_source)
    check_limits(kit)
    if outdir is None:
        outdir = os.path.join(ROOT, "social", "kits", f"{date}-article-{slug}")
    copy_override(kit, os.path.basename(outdir), src + " " + extra_source)
    write_kit(kit, outdir)
    if images:
        label = "ARTICLE" if a.get("format") == "short" or "n" not in a else f"DEEP DIVE №{a['n']}"
        landscape(os.path.join(outdir, "card-1200x675.png"), a["kicker"].upper(), a["title"], a["dek"], label,
                  "THEGRAVITYREPORT.COM" + a["web"].upper().rstrip("/"))
        ig_cover(os.path.join(outdir, "ig-1080x1350-1.png"), a["kicker"].upper(), a["title"], a["dek"], label, "1/4")
        ig_fact(os.path.join(outdir, "ig-1080x1350-2.png"), s["big"]["value"], s["big"]["label"], label, "2/4")
        if calls:
            ig_bars(os.path.join(outdir, "ig-1080x1350-3.png"), "What we think happens next",
                    [(c.get("box", c["claim"]), c["p"]) for c in shown], "3/4",
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


# ------------------------------------------------------------------ "The 644 on your team"
#
# One team a day: its top eight players in The 644 by rank, each with his GRAVITY score. Every
# number comes from content/the644.json (the player's r and s, and the team's player count).

def team_name(code):
    tc = TORQUE_CODE.get(code, code)
    return next(x["team"] for x in load("the30/torque-2026-27.json")["teams"] if x["code"] == tc)


def current_rosters():
    """Who is on which team now. The 644's `t` is the July edition; content/rosters-2026-10.json
    (ESPN rosters, dated) overrides it when present so team posts never list a traded player."""
    path = os.path.join(ROOT, "content", "rosters-2026-10.json")
    if not os.path.exists(path):
        return None
    r = load("content/rosters-2026-10.json")
    return {n: code for code, names in r["teams"].items() for n in names}


def team_players(code, t644=None):
    t644 = t644 or load("content/the644.json")
    now = current_rosters()
    def team_of(p):
        # with a current roster file, a player on no roster (waived, unsigned) is on no team
        return now.get(p["n"]) if now else p["t"]
    return sorted((p for p in t644["players"] if team_of(p) == code), key=lambda p: p["r"])


def build_team_kit(code, date, outdir=None, images=True):
    code = FROM_TORQUE.get(code.upper(), code.upper())
    if code not in SUBREDDITS:
        raise KeyError(f"unknown team {code}")
    name = team_name(code)
    ps = team_players(code)
    top = ps[:8]
    url = SITE_URL + "/the644/"
    rows = [(p["r"], p["n"], p["s"], bool(p.get("rk"))) for p in top]
    lines = [f"#{p['r']} {p['n']} {p['s']:.1f}" + (" (rookie)" if p.get("rk") else "") for p in top]
    count = COUNT_WORDS[len(top)]
    head = (f"The {name} in The 644, our ranking of every NBA player. The top {count} by rank, "
            f"with each player's GRAVITY score (50 is a league-average minute):")
    short_head = f"The {name} in The 644: the top {count} by rank, with each player's GRAVITY score (50 is a league-average minute)."
    rookie_note = "Rookies start from a draft-slot prior." if any(p.get("rk") for p in top) else ""
    tail = " ".join(x for x in [f"All {len(ps)} {name} players are in The 644, each with a free profile page.", rookie_note,
                                 f"Filter by team: {url}"] if x)
    posts = pack_posts(head, lines, tail)
    threads = short_head + "\n\n" + "\n".join(lines) + f"\n\nEvery player, with a free page: {url}"
    while len(threads) > LIMITS["threads"]:
        lines_t = threads.split("\n")
        threads = "\n".join(lines_t[:-3] + lines_t[-2:])  # drop the last player line
    ig = "\n\n".join(x for x in [head, "\n".join(lines), rookie_note, "Every player's page is free. Link in bio.", "#NBA"] if x)
    sub = SUBREDDITS[code]
    reddit = (f"# r/{sub} (post by hand; read the sub's self-promotion rules first)\n\n"
              f"**Title:** Where the {name} stand in The 644, our ranking of all 644 NBA players\n\n**Body:**\n\n"
              f"{head}\n\n" + "\n".join(f"- {ln}" for ln in lines) + "\n\n" + (rookie_note + " " if rookie_note else "") +
              "GRAVITY is our one-number player rating: how good, times how often. "
              f"Every player has a free profile page, and the table filters by team: {url}\n\n"
              "Happy to answer questions about the method in the comments.\n")
    alt = f"The {name} in The 644, top {count} by rank with GRAVITY scores: " + "; ".join(lines) + ". 50 is a league-average minute."
    torque = next(x for x in load("the30/torque-2026-27.json")["teams"] if x["code"] == TORQUE_CODE.get(code, code))
    best = top[0]
    fact_label = (f"{best['n']}'s GRAVITY score, #{best['r']} of 644 and the best on the roster. TORQUE, our team model, "
                  f"ranks the {name} #{torque['rank']} of 30 at {torque['torque']:.1f}, projecting {torque['wins']:.1f} wins.")
    carousel = ["ig-1080x1350-1.png", "ig-1080x1350-2.png", "ig-1080x1350-3.png", "ig-1080x1350-4.png", "ig-1080x1350-5.png"]
    moved = torque["rank_july"] - torque["rank"]
    move_txt = (f"up from {torque['rank_july']}th in July" if moved > 0 else f"down from {torque['rank_july']}th in July" if moved < 0
                else "the same as in July")
    torque_label = (f"TORQUE score: #{torque['rank']} of 30, {move_txt}, projecting {torque['wins']:.1f} wins. "
                    f"TORQUE is our team model, built from every player's GRAVITY impact and expected minutes.")
    kit = {"kind": "team", "slug": code.lower(), "team": code, "date": date, "url": url,
           "title": f"The 644 on your team: {name}",
           "x_thread": posts, "bluesky_thread": posts, "threads": threads, "instagram_caption": ig,
           "reddit": {"subreddit": sub, "markdown": reddit},
           "images": {"card": "card-1200x675.png", "carousel": carousel},
           "alt": {"card-1200x675.png": alt,
                   "ig-1080x1350-1.png": f"The 644 on your team: {name}. Cover slide.",
                   "ig-1080x1350-2.png": alt,
                   "ig-1080x1350-3.png": f"{torque['torque']:.1f}: {torque_label}",
                   "ig-1080x1350-4.png": f"{best['s']:.1f}: {fact_label}",
                   "ig-1080x1350-5.png": f"Every {name} player has a free page at thegravityreport.com/the644. Link in bio."}}
    source = (json.dumps(top, ensure_ascii=False) + f" {len(ps)} {name} " + json.dumps(torque, ensure_ascii=False)
              + " " + json.dumps([p for p in ps[8:]], ensure_ascii=False))
    guard(posts + [threads, ig, reddit] + list(kit["alt"].values()), source)
    check_limits(kit)
    outdir = outdir or os.path.join(ROOT, "social", "kits", f"{date}-team-{code.lower()}")
    copy_override(kit, os.path.basename(outdir), source)
    write_kit(kit, outdir)
    if images:
        team_card(os.path.join(outdir, "card-1200x675.png"), name, rows)
        # Instagram carousel: cover (the post's own angle), the table, one fact, the link
        dek = re.split(r"(?<=[.!?])\s", kit["x_thread"][0].strip())[0]
        ig_cover(os.path.join(outdir, "ig-1080x1350-1.png"), "THE 644 ON YOUR TEAM", name, dek, "THE 644", "1/5")
        ig_table(os.path.join(outdir, "ig-1080x1350-2.png"), "THE 644 ON YOUR TEAM", name, rows,
                 "THE 644", "2/5", "GRAVITY score. 50 is a league-average minute.")
        ig_fact(os.path.join(outdir, "ig-1080x1350-3.png"), f"{torque['torque']:.1f}", torque_label, f"TORQUE · #{torque['rank']} OF 30", "3/5")
        ig_fact(os.path.join(outdir, "ig-1080x1350-4.png"), f"{best['s']:.1f}", fact_label, "THE BEST ON THE ROSTER", "4/5")
        ig_cta(os.path.join(outdir, "ig-1080x1350-5.png"), f"Every {name} player, one number.", "thegravityreport.com/the644", "5/5")
    return kit, outdir


def all_team_kits(start_date, images=True):
    """One kit per team, dated one day apart from start_date, in The 30's TORQUE order."""
    teams = sorted(load("the30/torque-2026-27.json")["teams"], key=lambda x: x["rank"])
    d0 = datetime.date.fromisoformat(start_date)
    outs = []
    for i, x in enumerate(teams):
        code = FROM_TORQUE.get(x["code"], x["code"])
        outs.append(build_team_kit(code, (d0 + datetime.timedelta(days=i)).isoformat(), images=images)[1])
    return outs


def build_ledger_kit(rows, as_of, date, outdir=None, images=True, source_text=""):
    """rows: [{id, claim, p, status_line, later}] — status lines come from ledger_tracker.py with their own source.

    Calls tracked week by week get a line each, misses included. Calls that can only be graded on a
    fixed date (`later`) are grouped by that date so the thread stays short but still names every call.
    """
    url = SITE_URL + "/ledger/"
    live = [r for r in rows if not r.get("later")]
    later = [r for r in rows if r.get("later")]
    head = f"Is the model winning? Where our {len(rows)} open calls stand, as of {as_of}:"
    lines = [f"{r['id']} · {r['p']}% · {r['claim']}: {r['status_line']}" for r in live]
    for when in dict.fromkeys(r["status_line"] for r in later):
        group = [r for r in later if r["status_line"] == when]
        for i in range(0, len(group), 4):
            chunk = group[i:i + 4]
            lines.append(f"{when[0].upper()}{when[1:]}: " + "; ".join(f"{r['id']} · {r['p']}% · {r['claim']}" for r in chunk))
    tail = f"Every call was registered before tip-off and is graded in public, misses included.\n{url}"
    posts = pack_posts(head, lines, tail)
    threads = head
    for ln in lines:
        if len(threads + "\n" + ln + f"\n\n{url}") > LIMITS["threads"]:
            break
        threads += ("\n\n" if threads == head else "\n") + ln
    threads += f"\n\n{url}"
    ig = head + "\n\n" + "\n\n".join(lines) + "\n\nLink in bio.\n\n#NBA"
    while len(ig) > LIMITS["instagram"] and lines:
        lines = lines[:-1]
        ig = head + "\n\n" + "\n\n".join(lines) + "\n\nLink in bio.\n\n#NBA"
    kit = {"kind": "ledger", "slug": "tracker", "date": date, "url": url, "title": "Is the model winning?",
           "x_thread": posts, "bluesky_thread": posts, "threads": threads,
           "instagram_caption": ig, "reddit": None,
           "images": {"card": "card-1200x675.png", "carousel": ["ig-1080x1350-1.png"]},
           "alt": {"card-1200x675.png": f"Forecast Ledger tracker, as of {as_of}: {len(rows)} open calls, tracked against this season's numbers.",
                   "ig-1080x1350-1.png": "Open forecasts as probability bars: " + "; ".join(f"{r['claim']}, {r['p']}%" for r in live[:6]) + "."}}
    guard(posts + [threads, ig] + list(kit["alt"].values()), source_text + f" {len(rows)}")
    check_limits(kit)
    if outdir is None:
        outdir = os.path.join(ROOT, "social", "kits", f"{date}-ledger-tracker")
    write_kit(kit, outdir)
    if images:
        landscape(os.path.join(outdir, "card-1200x675.png"), f"FORECAST LEDGER · AS OF {as_of.upper()}",
                  "Is the model winning?", f"{len(rows)} open calls, tracked against this season's numbers.",
                  "THE LEDGER", "THEGRAVITYREPORT.COM/LEDGER")
        ig_bars(os.path.join(outdir, "ig-1080x1350-1.png"), "Is the model winning?",
                [(f"{r['id']}: {r['claim']}", r["p"]) for r in (live or rows)[:6]], "1/1", f"As of {as_of}.")
    return kit, outdir


def build_the30_kit(date, outdir=None, images=True):
    """The 30 (team rankings by TORQUE): the current edition's top 10 in two posts."""
    d = load("the30/torque-2026-27.json")
    t = d["teams"]
    url = SITE_URL + "/the30/"
    line = lambda x: f"{x['rank']}. {x['team']} {x['torque']:.1f}"
    head = "The 30: every NBA team ranked by TORQUE, our team model. Opening Night 2026–27 update."
    p1 = head + "\n\n" + "\n".join(line(x) for x in t[:5])
    p2 = "\n".join(line(x) for x in t[5:10]) + f"\n\nAll 30, with each team's top three players:\n{url}"
    ig = p1 + "\n" + "\n".join(line(x) for x in t[5:10]) + "\n\nAll 30 at the link in bio.\n\n#NBA"
    kit = {"kind": "edition", "slug": "the30", "date": date, "url": url, "title": "The 30",
           "x_thread": [p1, p2], "bluesky_thread": [p1, p2], "threads": p1 + f"\n\n{url}",
           "instagram_caption": ig, "reddit": None,
           "images": {"card": "/cards/the30.png", "carousel": []},
           "alt": {"card": "The 30: every NBA team ranked by TORQUE."}}
    guard([p1, p2, ig], json.dumps(d, ensure_ascii=False))
    check_limits(kit)
    outdir = outdir or os.path.join(ROOT, "social", "kits", f"{date}-edition-the30")
    write_kit(kit, outdir)
    if images:
        img, dr, _, _ = ig_frame()
        dr.text((72, 230), "THE 30 · OPENING NIGHT 2026–27", font=cl.mono(26, 600), fill=cl.ACCENT)
        y = cl.draw_lines(dr, (66, 280), ["Every team,", "one number."], cl.archivo(96), cl.INK, 98) + 30
        for x in t[:10]:
            dr.text((72, y), f"{x['rank']:>2}", font=cl.mono(34, 600), fill=cl.MUTED)
            dr.text((150, y - 4), x["team"], font=cl.archivo(40, 700, 100), fill=cl.INK)
            dr.text((1008, y), f"{x['torque']:.1f}", font=cl.mono(34, 600), fill=cl.ACCENT, anchor="ra")
            y += 64
        cl.band(img, dr, 1350 - 96, 96, "THE GRAVITY REPORT", "THEGRAVITYREPORT.COM/THE30")
        cl.save(img, os.path.join(outdir, "ig-1080x1350-2.png"))
        ig_cover(os.path.join(outdir, "ig-1080x1350-1.png"), "THE 30 · OPENING NIGHT 2026–27", "Every team, one number.",
                 f"{t[0]['team']} first at {t[0]['torque']:.1f}, {t[0]['torque'] - t[1]['torque']:.1f} clear of {t[1]['team']}. TORQUE is our team model.",
                 "THE 30", "1/3")
        ig_cta(os.path.join(outdir, "ig-1080x1350-3.png"), "All 30, with each team's top three players.", "thegravityreport.com/the30", "3/3")
        kit["images"]["carousel"] = ["ig-1080x1350-1.png", "ig-1080x1350-2.png", "ig-1080x1350-3.png"]
        kit["alt"].update({"ig-1080x1350-1.png": "The 30: every team, one number. Cover slide.",
                           "ig-1080x1350-2.png": "The top ten teams by TORQUE.", "ig-1080x1350-3.png": "All 30 at thegravityreport.com/the30. Link in bio."})
        write_kit(kit, outdir)
    return kit, outdir


# ------------------------------------------------------------------ performance (player of the day)
#
# Player of the day = someone who just played a big game: last night's line first, then a few
# GRAVITY numbers. Box scores come from ESPN's public JSON; the raw box score is saved with the kit
# as source.json and the number guard checks every number against it + the player's 644 record.
# The Worker (social/potd.js) does the same thing automatically every morning; this is for picking
# a player by hand.

ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={}"


def norm_name(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"[^a-z ]", "", n)
    return re.sub(r"\s+(jr|sr|ii|iii|iv)$", "", n).strip()


def box_line(summary, name):
    """The player's box score line + game context from an ESPN summary, or None."""
    comp = summary["header"]["competitions"][0]
    for team in summary["boxscore"]["players"]:
        st = team["statistics"][0]
        for a in st["athletes"]:
            if norm_name(a["athlete"]["displayName"]) != norm_name(name) or not a.get("stats"):
                continue
            line = dict(zip(st["names"], a["stats"]))
            me = next(c for c in comp["competitors"] if c["team"]["id"] == team["team"]["id"])
            opp = next(c for c in comp["competitors"] if c["team"]["id"] != team["team"]["id"])
            return {"line": line, "home": me["homeAway"] == "home", "won": bool(me.get("winner")),
                    "score": f"{me['score']}–{opp['score']}" if me.get("winner") else f"{opp['score']}–{me['score']}",
                    "opp": opp["team"]["name"], "opp_city": opp["team"]["location"]}
    return None


def perf_sentence(name, g):
    L = g["line"]
    bits = [f"{L['PTS']} points"]
    if int(L["REB"]) >= 8:
        bits.append(f"{L['REB']} rebounds")
    if int(L["AST"]) >= 6:
        bits.append(f"{L['AST']} assists")
    fg, fga = L["FG"].split("-")
    bits.append(f"{fg}-of-{fga} shooting")
    t3, t3a = L["3PT"].split("-")
    if int(t3) >= 4:
        bits.append(f"{t3}-of-{t3a} from three")
    stats = ", ".join(bits[:-1]) + " and " + bits[-1] if len(bits) > 1 else bits[0]
    where = f"over the {g['opp']}" if g["won"] else f"to the {g['opp']}"
    res = f"in a {g['score']} win {where}" if g["won"] else f"in a {g['score']} loss {where}"
    return f"{name} last night: {stats} {res}."


def perf_texts(p, team, g, n=644):
    url = f"{SITE_URL}/players/{p['slug']}/"
    first = perf_sentence(p["n"], g)
    grav = (f"In The 644 he's #{p['r']} of {n}, GRAVITY score {p['s']:.1f} (50 is a league-average minute)."
            if not p.get("rk") else f"In The 644 he's #{p['r']} of {n} as a rookie, GRAVITY score {p['s']:.1f}.")
    last = ""
    if not p.get("rk") and p.get("pp") is not None and p.get("ts") is not None:
        last = f"Last season: {p['pp']:.1f} points a game on {fmt_ts(p['ts'])} true shooting."
    return first, grav, last, url


def build_performance_kit(slug, event_id, date, outdir=None, images=True, summary=None):
    import urllib.request
    idx = {x["slug"]: x for x in load("players/index.json")["players"]}
    t644 = load("content/the644.json")
    ref = idx[slug]
    p = dict(next(x for x in t644["players"] if x["r"] == ref["r"]))
    p["slug"] = slug
    if summary is None:
        with urllib.request.urlopen(ESPN_SUMMARY.format(event_id)) as r:
            summary = json.load(r)
    g = box_line(summary, p["n"])
    if not g:
        raise ValueError(f"{p['n']} not in the box score of game {event_id}")
    first, grav, last, url = perf_texts(p, ref["team"], g, len(t644["players"]))
    x_posts = [first, "\n\n".join(x for x in [grav, last] if x) + f"\n\nFull profile: {url}"]
    threads = "\n\n".join(x for x in [first, grav, last, url] if x)
    ig = "\n\n".join(x for x in [first, grav, last, "Every player's page is free. Link in bio.", "#NBA"] if x)
    kit = {"kind": "player", "slug": slug, "date": date, "url": url, "title": f"{p['n']}: player of the day",
           "x_thread": x_posts, "bluesky_thread": x_posts, "threads": threads, "instagram_caption": ig, "reddit": None,
           "images": {"card": f"/players/{slug}/card.png", "carousel": []},
           "alt": {"card": f"{p['n']}, #{p['r']} of 644 in The 644, GRAVITY score {p['s']:.1f}. {ref['team']}."},
           "source": {"espn_event": str(event_id), "url": ESPN_SUMMARY.format(event_id), "line": g["line"]}}
    guard(x_posts + [threads, ig], json.dumps(p) + " " + json.dumps(g, ensure_ascii=False) + " 644")
    check_limits(kit)
    outdir = outdir or os.path.join(ROOT, "social", "kits", f"{date}-player-{slug}")
    write_kit(kit, outdir)
    with open(os.path.join(outdir, "source.json"), "w", encoding="utf-8") as f:
        json.dump({"espn_event": str(event_id), "boxscore_line": g}, f, ensure_ascii=False, indent=1)
    return kit, outdir


# ------------------------------------------------------------------ hand-written copy
#
# social/copy/<kit id>.md overrides the generated text of a kit, so each post can have its own
# angle instead of a template. Sections: "## X" (posts separated by a line "---"), "## Bluesky"
# (optional; defaults to X), "## Threads", "## Instagram". The number guard and the platform limits
# still apply to every line.

def copy_override(kit, kit_id, source_text):
    path = os.path.join(ROOT, "social", "copy", kit_id + ".md")
    if not os.path.exists(path):
        return kit
    secs, cur = {}, None
    for line in open(path, encoding="utf-8").read().split("\n"):
        if line.startswith("## "):
            cur = line[3:].strip().lower()
            secs[cur] = []
        elif cur is not None:
            secs[cur].append(line)
    def block(name):
        return "\n".join(secs.get(name, [])).strip()
    def thread(name):
        return [p.strip() for p in block(name).split("\n---\n") if p.strip()]
    if block("x"):
        kit["x_thread"] = thread("x")
        kit["bluesky_thread"] = thread("bluesky") if block("bluesky") else list(kit["x_thread"])
    if block("threads"):
        kit["threads"] = block("threads")
    if block("instagram"):
        kit["instagram_caption"] = block("instagram")
    kit["copy"] = os.path.relpath(path, ROOT)
    guard(kit["x_thread"] + kit["bluesky_thread"] + [kit["threads"], kit["instagram_caption"]], source_text)
    check_limits(kit)
    return kit


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
    ap.add_argument("kind", choices=["article", "player", "edition", "the30", "performance", "team"])
    ap.add_argument("--game", help="ESPN event id (performance kits)")
    ap.add_argument("slug", nargs="?")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--no-images", action="store_true")
    ap.add_argument("--frame", choices=["news", "tracking"], default="news",
                    help="tracking: for back-catalog pieces; says when it came out, never presents it as new")
    ap.add_argument("--angle", type=int, choices=[1, 2], default=1,
                    help="2 (with --frame tracking): From the archive; the first point leads, the closer names the publish date")
    a = ap.parse_args(argv)
    if a.kind == "article":
        if (a.slug or "").lower() == "all":
            # From the archive: every Deep Dive, one Sunday apart from --date
            for out in all_archive_kits(a.date, images=not a.no_images):
                print(os.path.relpath(out, ROOT))
            return
        kit, out = build_article_kit(a.slug, a.date, images=not a.no_images, frame=a.frame, angle=a.angle)
    elif a.kind == "player":
        kit, out = build_player_kit(a.slug, a.date, images=not a.no_images)
    elif a.kind == "performance":
        kit, out = build_performance_kit(a.slug, a.game, a.date, images=not a.no_images)
    elif a.kind == "the30":
        kit, out = build_the30_kit(a.date, images=not a.no_images)
    elif a.kind == "team":
        if (a.slug or "").lower() == "all":
            for out in all_team_kits(a.date, images=not a.no_images):
                print(os.path.relpath(out, ROOT))
            return
        kit, out = build_team_kit(a.slug, a.date, images=not a.no_images)
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
