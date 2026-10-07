#!/usr/bin/env python3
"""Build The Gravity Report site (design "J", locked Oct 6, 2026).

Standard library only. Reads content/ + the644 CSVs, writes the HTML pages the
site serves (the repo root is the Cloudflare assets directory). Deterministic:
running it twice produces no diff.

Usage: python3 scripts/build_site.py
"""
import csv
import html
import json
import os
import re
import unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
C = os.path.join(ROOT, "content")


# ---------------------------------------------------------------- data

def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


SITE = load("content/site.json")
ARTICLES = load("content/articles.json")
LEDGER = load("content/ledger.json")
T644 = load("content/the644.json")
MSGS = load("content/legacy/messages.json")["M"]
TIERS = {int(k): v for k, v in T644["TIERS"].items()}
TEAMS30 = T644["TEAMS30"]
TEAM_NAME = {t["t"]: t["name"] for t in TEAMS30}


def read_csv(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


CSV644 = read_csv("the644/the644-2026-07.csv")


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "player"


def fnum(x):
    if x in (None, ""):
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def build_players():
    by_rank = {int(r["rank"]): r for r in CSV644}
    out, seen = [], {}
    for d in T644["players"]:
        row = by_rank[d["r"]]
        assert row["player"] == d["n"], (row["player"], d["n"])
        slug = slugify(d["n"])
        if slug in seen:
            slug = f"{slug}-{d['t'].lower()}"
        seen[slug] = True
        p = dict(d)
        p.update({
            "slug": slug,
            "obpm": fnum(row["obpm26"]), "dbpm": fnum(row["dbpm26"]), "ws48": fnum(row["ws48_26"]),
            "onoff": fnum(row["onoff26"]), "mp": fnum(row["mp26"]),
            "mp_po": fnum(row["mp_playoffs"]), "bpm_po": fnum(row["bpm_playoffs"]),
            "csv_note": row["note"],
        })
        out.append(p)
    return out


PLAYERS = build_players()
BY_NAME = {p["n"]: p for p in PLAYERS}


# ---------------------------------------------------------------- helpers

def e(s):
    return html.escape(str(s), quote=True)


def f1(x):
    return "—" if x is None or x == "" else f"{float(x):.1f}"


def pct1(x):
    return "—" if x is None or x == "" else f"{float(x) * 100:.1f}%"


def ts3(x):
    if x is None or x == "":
        return "—"
    s = f"{float(x):.3f}"
    return s[1:] if s.startswith("0") else s


def signed(x, nd=1):
    if x is None or x == "":
        return "—"
    v = float(x)
    return f"{v:+.{nd}f}".replace("-", "−")


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]


def long_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{MONTHS[m - 1]} {d}, {y}"


def short_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{MONTHS[m - 1][:3]} {d}, {y}"


def ym_label(ym):
    y, m = (int(x) for x in ym.split("-"))
    return f"{MONTHS[m - 1][:3]} {y}"


ARROW = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path>'
         '<path d="M13 6l6 6-6 6"></path></svg>')


def pbar(p):
    return (f'<div class="pbar" role="img" aria-label="{p}% chance; the tick marks 50%, a coin flip">'
            f'<div class="pbar-fill" style="width:{p}%"></div><div class="pbar-tick"></div></div>')


def pscale():
    return '<div class="pscale" aria-hidden="true"><span>0%</span><span>coin flip</span><span>100%</span></div>'


def ledger_entry(i):
    return next(x for x in LEDGER["entries"] if x["id"] == i)


def lrow(x):
    note = f"<small>{e(x['note'])}</small>" if x.get("note") else ""
    return (f'<div class="lrow"><span class="lrow-id">{e(x["id"])}</span>'
            f'<span class="lrow-claim">{e(x["claim"])}{note}</span>{pbar(x["p"])}'
            f'<b class="pbar-pct">{x["p"]}%</b><span class="lrow-when">grades {e(x["grades"])}</span></div>')


def pitem(claim, p, note=""):
    n = f'<div class="pitem-note">{e(note)}</div>' if note else ""
    return (f'<div><div class="pitem-claim">{e(claim)}</div><div class="pbar-wrap">{pbar(p)}'
            f'<b class="pbar-pct">{p}%</b></div>{n}</div>')


def rank_li(p, hl=False, link=True, team=True):
    nm = f'<a href="/players/{p["slug"]}/">{e(p["n"])}</a>' if link else e(p["n"])
    tm = f'<span class="tm">{e(p["t"])}</span>' if team else ""
    cls = ' class="hl"' if hl else ""
    return (f'<li{cls}><span class="rk">{p["r"]}</span><span class="nm">{nm}{tm}</span>'
            f'<span class="sc">{f1(p["s"])}</span></li>')


# ---------------------------------------------------------------- layout

NAV = [("/the644/", "The 644"), ("/articles/", "Articles"), ("/ledger/", "Ledger"), ("/model/", "Model")]


def header(active=""):
    cur = ' aria-current="page"'
    links = "".join(f'<a href="{h}"{cur if h == active else ""}>{t}</a>' for h, t in NAV)
    return (
        '<a class="skip" href="#main">Skip to content</a>'
        '<header class="site-head"><div class="wrap">'
        '<a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>'
        '<span class="brand-name">The Gravity Report</span></a>'
        f'<nav class="nav" aria-label="Main">{links}<a class="btn-sub" href="/#subscribe">Subscribe</a></nav>'
        '</div></header>')


def ticker():
    top = PLAYERS[:15]
    items = "   ·   ".join(
        f'<a href="/players/{p["slug"]}/">{p["r"]} {e(p["n"].split(" ", 1)[-1].upper())} <b>{f1(p["s"])}</b></a>'
        for p in top)
    plain = "   ·   ".join(f'{p["r"]} {e(p["n"].split(" ", 1)[-1].upper())} <b>{f1(p["s"])}</b>' for p in top)
    return (
        '<div class="ticker"><a class="ticker-label" href="/the644/">THE 644</a>'
        '<div class="ticker-view"><div class="ticker-track">'
        f'<span>   {items}</span><span aria-hidden="true">   {plain}</span>'
        '</div></div></div>')


def footer():
    return (
        '<footer class="site-foot" id="about-foot"><div class="wrap">'
        f'<div class="fb"><b>The Gravity Report</b><br>{e(SITE["model_line"])}<br>'
        'Articles are typeset in LaTeX and revised in public. An article, not a research paper.</div>'
        '<nav aria-label="Footer"><a href="/model/">Model</a><a href="/ledger/">Ledger</a>'
        '<a href="/data/">Data</a><a href="/corrections/">Corrections</a><a href="/about/">About</a>'
        '<a href="/feed.xml">RSS</a><a href="/classic/">The original inbox edition</a></nav>'
        '</div></footer>')


BEACON = """<script>
(function(){
  try{
    if (navigator.doNotTrack === '1') return;
    var item = %s, depth = %s;
    function send(t, nv){
      try{
        var body = JSON.stringify({t: t, i: item, n: nv || 0});
        if (navigator.sendBeacon) navigator.sendBeacon('/api/e', new Blob([body], {type: 'application/json'}));
        else fetch('/api/e', {method: 'POST', keepalive: true, headers: {'content-type': 'application/json'}, body: body});
      }catch(e){}
    }
    var nv = 0;
    try{
      var today = 'gravity_seen_' + new Date().toISOString().slice(0, 10);
      if (!localStorage.getItem(today)){
        nv = 1;
        for (var x = localStorage.length - 1; x >= 0; x--){
          var key = localStorage.key(x);
          if (key && key.indexOf('gravity_seen_') === 0 && key !== today) localStorage.removeItem(key);
        }
        localStorage.setItem(today, '1');
      }
    }catch(e){}
    send('pv', nv);
    if (!depth) return;
    var d3 = false, fin = false;
    addEventListener('scroll', function(){
      var p = (scrollY + innerHeight) / document.documentElement.scrollHeight;
      if (!d3 && p > 0.5){ d3 = true; send('d3'); }
      if (!fin && p > 0.9){ fin = true; send('fin'); }
    }, {passive: true});
    setTimeout(function(){ send('dwell'); }, 60000);
  }catch(e){}
})();
</script>"""


def page(path, title, desc, body, *, active="", og_image="/cards/site.png", og_type="website",
         beacon=None, depth=False, extra_head="", ld_json=None, noindex=False, scripts=""):
    url = SITE["url"] + path
    robots = '<meta name="robots" content="noindex">\n' if noindex else ""
    ld = f'<script type="application/ld+json">\n{ld_json}\n</script>\n' if ld_json else ""
    item = beacon if beacon is not None else (path.rstrip("/") or "/")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#FFFFFF">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
{robots}<link rel="canonical" href="{e(url)}">
<link rel="alternate" type="application/rss+xml" title="The Gravity Report" href="/feed.xml">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/Archivo-400-900-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
<meta property="og:type" content="{og_type}">
<meta property="og:site_name" content="The Gravity Report">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
<meta property="og:image" content="{e(SITE['url'] + og_image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
{extra_head}{ld}</head>
<body>
{header(active)}
{ticker()}
<main id="main">
{body}
</main>
{footer()}
{BEACON % (json.dumps(item), 'true' if depth else 'false')}
{scripts}</body>
</html>
"""


def write(rel, text):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


# ---------------------------------------------------------------- shared blocks

def subscribe_block():
    url = SITE.get("newsletter_url", "").rstrip("/")
    if url:
        form = (f'<form class="sub-form" action="{e(url)}/subscribe" method="get" target="_blank">'
                '<label>EMAIL ADDRESS<input type="email" name="email" placeholder="you@example.com" '
                'autocomplete="email" required></label><button type="submit">Subscribe</button></form>')
    else:
        # Not configured yet: the input has no name, so nothing is ever sent anywhere.
        form = ('<form class="sub-form" action="/subscribe/" method="get">'
                '<label>EMAIL ADDRESS<input type="email" placeholder="you@example.com" autocomplete="email">'
                '</label><button type="submit">Subscribe</button></form>')
    return (f'<section id="subscribe" class="sec"><div class="sub-box"><div>'
            '<h2 class="h-m" style="margin:0">Get the next article in your inbox</h2>'
            f'<p class="lede" style="margin-top:10px">{e(SITE["newsletter_note"])}</p></div>{form}</div></section>')


def archive_links(items):
    out = []
    for a in items:
        if a["kind"] == "article":
            meta = f'№{a["n"]} · {short_date(a["date"])}'
        else:
            meta = "The Model · Version 3"
        out.append(f'<a href="{a["web"]}"><div class="meta">{e(meta)}</div><div class="t">{e(a["title"])}</div>'
                   f'<div class="d">{e(a["teaser"])}</div></a>')
    return '<div class="arch">' + "".join(out) + "</div>"


def kawhi_stats(p):
    return (
        f'<div><div class="kstats-head">{e(p["n"].split(" ")[0])}, 2025–26</div><div class="kstats">'
        f'<div><b>#{p["r"]}</b><span>of 644 players</span></div>'
        f'<div><b>{f1(p["us"])}%</b><span>usage</span></div>'
        f'<div><b>{ts3(p["ts"])}</b><span>true shooting</span></div>'
        f'<div><b>{p["g"]}</b><span>games</span></div></div></div>')


# ---------------------------------------------------------------- pages

def build_home():
    lead = next(a for a in ARTICLES if a["kind"] == "article")  # newest first in articles.json
    sp = BY_NAME[lead["stat_player"]]
    box = "".join(pitem(ledger_entry(i).get("box", ledger_entry(i)["claim"]), ledger_entry(i)["p"])
                  for i in lead["ledger"])
    lead_cols = "".join(f"<p>{e(t)}</p>" for t in lead["lead"])
    top10 = "".join(rank_li(p, hl=(p["n"] == sp["n"])) for p in PLAYERS[:10])
    rows = sorted(LEDGER["entries"], key=lambda x: (-x["p"], x["id"]))
    n_open = sum(1 for x in LEDGER["entries"] if x["status"] == "open")
    n_graded = len(LEDGER["entries"]) - n_open
    desk = ", ".join(SITE["on_the_desk"])
    body = f"""<div class="wrap">
<section class="sec"><div class="split">
<article class="col-2">
<div class="kicker">{e(lead['kicker'])}</div>
<h1 class="h-xl">{e(lead['title'])}</h1>
<p class="dek">{e(lead['home_dek'])}</p>
<div class="lead-cols">{lead_cols}</div>
<div class="btn-row"><a class="btn-dark" href="{lead['web']}">Read the article {ARROW}</a>
<span class="small">{lead['pages']} pages · web and <a href="{lead['pdf']}">PDF</a> · {short_date(lead['date'])}</span></div>
</article>
<aside class="col-1" style="display:flex;flex-direction:column;gap:28px">
<div class="box"><div class="box-title">What we think happens next</div>{pscale()}<div class="pitems">{box}</div>
<p class="small" style="margin:18px 0 0">Registered {short_date(ledger_entry(lead['ledger'][0])['registered'])}. Graded by Brier score.</p></div>
{kawhi_stats(sp)}
</aside>
</div></section>

<section class="sec"><div class="split">
<div class="col-h" id="the644">
<div class="kicker">The 644 · {e(SITE['edition']['name'])} edition</div>
<h2 class="h-m">Every NBA player, one number</h2>
<p class="lede" style="margin:10px 0 18px;font-size:16px">How good, times how often. Next edition at the All-Star break.</p>
<ol class="rank-list">{top10}</ol>
<a class="more" href="/the644/">See all 644 players</a>
</div>
<div class="col-h" id="articles">
<div class="kicker">The archive</div>
<h2 class="h-m">Articles</h2>
<p class="lede" style="margin:10px 0 18px;font-size:16px">Written in plain language, typeset in LaTeX, revised in public.</p>
{archive_links(ARTICLES)}
<p style="margin:16px 0 0;font-size:15px" class="muted"><b style="color:var(--ink)">On the desk:</b> {e(desk)}.</p>
</div>
</div></section>

<section class="sec" id="ledger">
<div class="sec-head"><div style="flex:1 1 480px">
<div class="kicker">The Forecast Ledger</div>
<h2 class="h-l">Every call, on the record before the season</h2>
<p class="lede">Each forecast gets a probability before tip-off and a grade after the season. {e(LEDGER['rule'])}</p>
</div>
<div class="counts"><div><b>{n_open}</b><span>open</span></div><div><b>{n_graded}</b><span>graded</span></div><div><b>Apr</b><span>first grades, 2027</span></div></div>
</div>
<div class="lrows">{''.join(lrow(x) for x in rows)}</div>
<a class="more" href="/ledger/">See the full ledger and grading rules</a>
</section>

{subscribe_block()}
</div>"""
    ld = json.dumps({"@context": "https://schema.org", "@type": "WebSite", "name": "The Gravity Report",
                     "url": SITE["url"] + "/", "description": SITE["tagline"]}, ensure_ascii=False, indent=1)
    write("index.html", page("/", "The Gravity Report — independent NBA analysis",
                             "Independent NBA analysis built on GRAVITY, one public model: every player ranked "
                             "in The 644, every forecast registered before the season and graded after.",
                             body, ld_json=ld, beacon="/", scripts='<script src="/assets/legacy-redirect.js"></script>\n'))


def build_articles_index():
    items = []
    for a in ARTICLES:
        label = f'Article №{a["n"]}' if a["kind"] == "article" else "The Model · technical document"
        items.append(
            f'<a href="{a["web"]}"><div class="meta">{e(label)} · {short_date(a["date"])} · {a["pages"]} pages</div>'
            f'<div class="t">{e(a["title"])}</div><div class="d">{e(a["dek"])}</div></a>')
    body = f"""<div class="wrap">
<section class="page-head"><div class="kicker">The archive</div><h1 class="h-xl">Articles</h1>
<p class="lede">One player, one question, one forecast you can check. Every piece is an article typeset in LaTeX, not a research paper, and every revision ships with a public note.</p></section>
<section class="sec"><div class="arch">{''.join(items)}</div>
<p class="muted" style="margin-top:18px"><b style="color:var(--ink)">On the desk:</b> {e(', '.join(SITE['on_the_desk']))}.</p></section>
</div>"""
    write("articles/index.html", page("/articles/", "Articles — The Gravity Report",
                                      "Every Gravity Report article: plain-language NBA analysis with a registered forecast.",
                                      body, active="/articles/"))


# legacy links inside article bodies -> new homes (link text stays true)
LINK_MAP = [
    ('href="../../#inbox/', 'href="/classic/#inbox/'),
    ('href="../../#spec/specdoc"', 'href="/classic/#spec/specdoc"'),
    ('href="../../#ledger"', 'href="/ledger/"'),
    ('href="../#ledger"', 'href="/ledger/"'),
    ('href="../#deleted"', 'href="/classic/#deleted"'),
    ('href="../#inbox/spec"', 'href="/model/"'),
    ('href="../"', 'href="/classic/"'),
    ('href="../../', 'href="/'),
    ('src="../../', 'src="/'),
    ('href="../', 'href="/'),
]
STYLE_MAP = [("#E3E6E6", "#E6E6E6"), ("#3E7C5F", "#2A3FF0"), ("#5E6E75", "#0A0A0A"), ("#0E5A3A", "#0A0A0A")]
EMOJI_RE = re.compile(r"[\U0001F300-\U0001FAFF☀-➿]️?\s?")


def transform_body(b):
    for a, z in LINK_MAP:
        b = b.replace(a, z)
    for a, z in STYLE_MAP:
        b = b.replace(a, z)
    # emoji only ever appeared as decoration on buttons; strip it from the button labels
    b = re.sub(r'(<a class="btn"[^>]*>)(.*?)(</a>)', lambda m: m.group(1) + EMOJI_RE.sub("", m.group(2)) + m.group(3),
               b, flags=re.S)
    return b


def article_side(a):
    if not a or not a.get("ledger"):
        return ""
    items = "".join(pitem(ledger_entry(i)["claim"], ledger_entry(i)["p"], ledger_entry(i).get("note", ""))
                    for i in a["ledger"])
    return (f'<aside class="paper-side"><div class="box"><div class="box-title">Registered forecasts</div>'
            f'{pscale()}<div class="pitems">{items}</div>'
            f'<p class="small" style="margin:16px 0 0"><a href="/ledger/">The Forecast Ledger</a></p></div></aside>')


def build_web_edition(slug, path, active):
    pg = load(f"content/pages/{slug}.json")
    a = next((x for x in ARTICLES if x["slug"] == slug), None)
    body_html = transform_body(pg["body"])
    side = ""  # forecasts already live inside each article body
    inner = (f'<div class="paper-wrap"><article class="paper">{body_html}</article>{side}</div>'
             if side else f'<article class="paper">{body_html}</article>')
    body = f'<div class="wrap">{inner}</div>'
    m = pg["meta"]
    og = m.get("og:image", SITE["url"] + "/cards/site.png").replace(SITE["url"], "")
    pub = m.get("article:published_time")
    extra = f'<meta property="article:published_time" content="{e(pub)}">\n' if pub else ""
    write(path + "index.html",
          page("/" + path, pg["title"], m.get("description", ""), body, active=active, og_image=og,
               og_type=m.get("og:type", "article"), beacon=pg.get("beacon_item"), depth=bool(a),
               extra_head=extra, ld_json=pg.get("ld_json")))


def build_the644():
    tiers = "".join(f'<li><span class="rk">T{k}</span><span class="nm">{e(v)}</span></li>' for k, v in sorted(TIERS.items()))
    rows = []
    for p in PLAYERS:
        note = f'<span class="note">{e(p["note"])}</span>' if p.get("note") else ""
        pos = p["p"] if p["p"] not in ("", "—") else ""
        rows.append(
            f'<li data-n="{e(p["n"].lower())}" data-t="{e(p["t"])}" data-p="{e(pos)}" data-r="{1 if p["rk"] else 0}">'
            f'<span class="rk">{p["r"]}</span><span class="tier">T{p["tier"]}</span>'
            f'<span class="nm"><a href="/players/{p["slug"]}/">{e(p["n"])}</a><span class="tm">{e(p["t"])}'
            f'{" · " + e(pos) if pos else ""}{" · rookie" if p["rk"] else ""}</span>{note}</span>'
            f'<span class="sc">{f1(p["s"])}</span></li>')
    teams = sorted({p["t"] for p in PLAYERS})
    topts = "".join(f'<option value="{e(t)}">{e(t)}{" — " + e(TEAM_NAME[t]) if t in TEAM_NAME else ""}</option>' for t in teams)
    trows = "".join(
        f'<tr><td class="n">{t["rk"]}</td><td>{e(t["name"])} <span class="muted mono" style="font-size:12px">{e(t["t"])}</span></td>'
        f'<td class="n">{f1(t["g"])}</td><td class="n">{f1(t["st"])}</td><td class="n">{f1(t["bn"])}</td>'
        f'<td class="n">{t["s3"]}%</td><td>{e(t["best"])} <span class="muted mono" style="font-size:12px">({f1(t["bf"])})</span></td>'
        f'<td class="n">{f1(t["fill"])}</td></tr>' for t in TEAMS30)
    ed = SITE["edition"]
    n_rook = sum(1 for p in PLAYERS if p["rk"])
    e30 = ledger_entry("E1")
    body = f"""<div class="wrap">
<section class="page-head"><div class="kicker">The 644 · {e(ed['name'])} edition · final</div>
<h1 class="h-xl">Every NBA player, one number</h1>
<p class="lede">{len(PLAYERS)} players ({len(PLAYERS) - n_rook} veterans + {n_rook} rookies), ranked by GRAVITY v3: how good per minute, times how reliably he's on the floor. Published {long_date(ed['published'])}. Next edition: {e(ed['next'])}. Editions are permanent once published; old numbers never get quietly revised.</p>
<div class="btn-row"><a class="btn-line" href="{ed['csv']}" download>Download the644.csv</a><a class="btn-line" href="#teams">The 30 (teams)</a><a class="btn-line" href="/model/">How the score works</a></div>
</section>

<section class="sec" aria-labelledby="players-h">
<h2 class="vh" id="players-h">All players</h2>
<form class="filter" role="search" onsubmit="return false">
<label>FIND A PLAYER<input type="search" id="f-q" placeholder="Name" autocomplete="off"></label>
<label>TEAM<select id="f-t"><option value="">All teams</option>{topts}</select></label>
<label>POSITION<select id="f-p"><option value="">All positions</option><option value="G">Guards</option><option value="F">Forwards</option><option value="C">Centers</option></select></label>
<label style="flex-direction:row;align-items:center;gap:8px;min-height:44px"><input type="checkbox" id="f-r" style="min-width:0;height:20px;width:20px"> ROOKIES ONLY</label>
<output id="f-count" aria-live="polite">{len(PLAYERS)} players</output>
</form>
<ol class="rank-list full-list" id="list644" style="margin-top:20px">{''.join(rows)}</ol>
<p class="small" style="margin-top:14px">Weighted by counted-on minutes (last-season blend; rookies get draft-slot priors). T = tier. Scores: 50 is a league-average minute.</p>
</section>

<section class="sec"><div class="split">
<div class="col-h"><h2 class="h-m" style="margin-top:0">Tiers</h2><ol class="rank-list" style="margin-top:16px">{tiers}</ol></div>
<div class="col-h"><h2 class="h-m" style="margin-top:0">Edition calendar</h2><ol class="rank-list" style="margin-top:16px">
<li><span class="rk" style="width:90px">Jul 2026</span><span class="nm">The 644 — July 2026</span><span class="sc">final</span></li>
<li><span class="rk" style="width:90px">Feb 2027</span><span class="nm">All-Star Break edition</span><span class="sc">scheduled</span></li>
<li><span class="rk" style="width:90px">Apr 2027</span><span class="nm">End of Season edition</span><span class="sc">scheduled</span></li>
<li><span class="rk" style="width:90px">Jun 2027</span><span class="nm">Post-Playoffs edition + Forecast Audit No. 1</span><span class="sc">scheduled</span></li>
</ol></div>
</div></section>

<section class="sec" id="teams">
<div class="kicker">The 30 · {e(ed['name'])} · rosters as of {e(T644.get('ROSTER_DATE30', ''))}</div>
<h2 class="h-l">Every team, one number</h2>
<p class="lede">Team GRAVITY is the expected force of one minute of a team's floor time, built from a fixed 240-minute game. Every roster spot supplies the minutes a team can actually count on (a two-season blend; draft-slot priors for rookies); minutes nobody on the roster can cover are priced at replacement force {f1(T644.get('F_REPL30'))}. Because availability enters through minutes, a fragile star is priced once — never twice. Teams land on the same scale as players: 50 is a league-average minute.</p>
<p class="lede">Two honesty notes. Unsigned is unsigned: free agents — restricted ones included — are nobody's minutes yet, so Cleveland is priced without Harden, Detroit without Duren, Sacramento without DeRozan. Those holes show up as replacement-priced fill, and the All-Star edition re-prices whatever has been signed by then. And one trade doesn't exist yet: the agreed Leonard–Ingram swap is unconsummated while the league's investigation runs, so Kawhi is a Clipper here and Toronto keeps Ingram. Official rosters only.</p>
<div class="tbl-box"><table class="tbl" style="min-width:820px">
<thead><tr><th class="n">#</th><th>Team</th><th class="n">Team GRAVITY</th><th class="n">Starters</th><th class="n">Bench</th><th class="n">Top-3 share</th><th>Best player (force)</th><th class="n">Fill min</th></tr></thead>
<tbody>{trows}</tbody></table></div>
<div class="lrows" style="margin-top:28px">{lrow(e30)}</div>
<p class="small" style="margin-top:12px">ρ ≥ 0.60 = win · 0.50–0.60 = near miss · below 0.50 = miss. Scored in Forecast Audit №1, July 2027.</p>
<div class="btn-row"><a class="btn-line" href="{ed['teams_csv']}" download>Download the30.csv</a></div>
</section>
</div>"""
    write("the644/index.html", page("/the644/", "The 644 — July 2026 Edition · The Gravity Report",
                                    "Every NBA player plus the 2026 draft class, ranked by GRAVITY. July 2026 edition — final. Searchable, with The 30 team ranking.",
                                    body, active="/the644/", og_image="/cards/the644.png", beacon="/the644",
                                    scripts='<script src="/assets/filter644.js"></script>\n'))


STAT_DEFS = {
    "g": ("Games", "Regular-season games played."),
    "mp": ("Minutes", "Regular-season minutes played."),
    "mpg": ("Minutes per game", ""),
    "pp": ("Points per game", ""),
    "rp": ("Rebounds per game", ""),
    "ap": ("Assists per game", ""),
    "sp": ("Steals per game", ""),
    "bp": ("Blocks per game", ""),
    "f": ("FG%", "Share of field-goal attempts made."),
    "f3": ("3P%", "Share of three-point attempts made."),
    "ft": ("FT%", "Share of free throws made."),
    "ts": ("True shooting", "Scoring efficiency that counts threes and free throws."),
    "us": ("Usage", "Share of his team's possessions he finishes while on the floor."),
    "b": ("Box Plus/Minus", "Points per 100 possessions he adds over an average player, estimated from the box score. 0 is average."),
    "obpm": ("Offensive BPM", "The offense half of Box Plus/Minus."),
    "dbpm": ("Defensive BPM", "The defense half of Box Plus/Minus."),
    "v": ("VORP", "Value over a replacement-level player, from Box Plus/Minus and minutes."),
    "ws48": ("Win Shares per 48", "Wins credited to him per 48 minutes played."),
    "onoff": ("On/off", "His team's point margin per 100 possessions with him on the court minus with him off. Basketball Reference, raw."),
}


def stat_cell(key, val):
    name, d = STAT_DEFS[key]
    dd = f"<em>{e(d)}</em>" if d else ""
    return f"<div><b>{val}</b><span>{e(name)}</span>{dd}</div>"


def build_players_pages():
    n = len(PLAYERS)
    idx = []
    for i, p in enumerate(PLAYERS):
        prev_p = PLAYERS[i - 1] if i > 0 else None
        next_p = PLAYERS[i + 1] if i + 1 < n else None
        pos = p["p"] if p["p"] not in ("", "—") else "position TBD"
        team = TEAM_NAME.get(p["t"], p["t"])
        age = f' · age {p["a"]}' if p["a"] not in ("", None) else ""
        tier = f'Tier {p["tier"]} — {TIERS[p["tier"]]}'
        rook = f' · rookie, pick #{p["pk"]}' if p["rk"] and p.get("pk") else (" · rookie" if p["rk"] else "")
        note = f'<p class="lede" style="margin-top:14px"><b>Note:</b> {e(p["note"])}</p>' if p.get("note") else ""
        box_keys = ["mpg", "pp", "rp", "ap"] + (["sp", "bp"] if p.get("sp") is not None else [])
        fmt_box = {"mpg": f1, "pp": f1, "rp": f1, "ap": f1, "sp": f1, "bp": f1, "f": pct1, "f3": pct1, "ft": pct1}
        if p.get("pp") is None:
            box = '<p class="lede">No box score: he did not play in 2025–26.</p>'
        else:
            cells = "".join(stat_cell(k, fmt_box[k](p.get(k))) for k in box_keys + ["f", "f3", "ft"])
            box = f'<div class="statgrid">{cells}</div>'
        box_title = "College box, 2025–26" if p.get("col") else "2025–26 season box"
        if p["rk"]:
            inputs = ""
            if p.get("ts") is not None:
                inputs = ('<div class="statgrid">' + stat_cell("ts", ts3(p["ts"])) + stat_cell("us", f1(p["us"]) + "%")
                          + "</div>")
            impact = (f'<section class="sec"><h2 class="h-m" style="margin-top:0">How a rookie gets a score</h2>'
                      f'<p class="lede">Rookies have no NBA minutes yet, so their score starts from a prior based on draft slot'
                      f'{" and an adjusted college line" if p.get("col") else ""}.</p>'
                      f'{"<p class=small style=margin-top:14px>COLLEGE, 2025–26</p>" if inputs and p.get("col") else ""}{inputs}</section>')
        else:
            cells = (stat_cell("g", p["g"] if p["g"] is not None else "—")
                     + stat_cell("mp", f'{int(p["mp"]):,}' if p.get("mp") else "—")
                     + stat_cell("b", signed(p["b"]))
                     + stat_cell("obpm", signed(p["obpm"])) + stat_cell("dbpm", signed(p["dbpm"]))
                     + stat_cell("v", f1(p["v"])) + stat_cell("ws48", ts3(p["ws48"]))
                     + stat_cell("ts", ts3(p["ts"])) + stat_cell("us", f1(p["us"]) + "%" if p.get("us") is not None else "—")
                     + stat_cell("onoff", signed(p["onoff"])))
            po = ""
            if p.get("mp_po"):
                po = (f'<p class="small" style="margin-top:14px">2026 playoffs: {int(p["mp_po"])} minutes, '
                      f'Box Plus/Minus {signed(p["bpm_po"])}.</p>')
            impact = (f'<section class="sec"><h2 class="h-m" style="margin-top:0">The impact numbers</h2>'
                      f'<p class="lede" style="margin-bottom:18px">The public stats behind the score, 2025–26 regular season (Basketball Reference).</p>'
                      f'<div class="statgrid">{cells}</div>{po}</section>')
        feats = [a for a in ARTICLES if p["n"] in a.get("players", [])]
        feat = ""
        if feats:
            feat = ('<section class="sec"><h2 class="h-m" style="margin-top:0">Featured in</h2>'
                    + archive_links(feats) + "</section>")
        calls = [x for x in LEDGER["entries"] if x.get("player") == p["n"]]
        callh = ""
        if calls:
            callh = ('<section class="sec"><h2 class="h-m" style="margin-top:0">Open forecasts about him</h2>'
                     f'<div class="lrows">{"".join(lrow(x) for x in calls)}</div>'
                     '<a class="more" href="/ledger/">How forecasts are graded</a></section>')
        pn = '<nav class="pn" aria-label="Neighbours in the ranking">'
        pn += (f'<a href="/players/{prev_p["slug"]}/">← #{prev_p["r"]} {e(prev_p["n"])}</a>' if prev_p else "<span></span>")
        pn += f'<a href="/the644/">All 644</a>'
        pn += (f'<a href="/players/{next_p["slug"]}/">#{next_p["r"]} {e(next_p["n"])} →</a>' if next_p else "<span></span>")
        pn += "</nav>"
        body = f"""<div class="wrap">
<section class="page-head"><div class="p-head"><div style="min-width:0">
<div class="p-rank">THE 644 · {e(SITE['edition']['name'].upper())} · #{p['r']} OF {n}</div>
<h1 class="h-xl">{e(p['n'])}</h1>
<p class="dek" style="font-size:20px">{e(team)} · {e(pos)}{e(age)}{e(rook)}</p>
<p class="small" style="margin-top:8px">{e(tier)}</p>
</div>
<div class="p-score"><b>{f1(p['s'])}</b><span>GRAVITY SCORE · 50 = LEAGUE-AVERAGE MINUTE</span></div></div>
{note}
<p class="lede" style="margin-top:14px">GRAVITY scores every player the same way: how good per minute, times how reliably he's on the floor. 60+ is a quality starter; 80+ is a franchise engine. <a href="/model/">How it works</a>.</p>
</section>
{impact}
<section class="sec"><h2 class="h-m" style="margin-top:0">{box_title}</h2>{box}</section>
{feat}{callh}
<section class="sec">{pn}</section>
</div>"""
        desc = f'{p["n"]} is #{p["r"]} of {n} in The 644 ({SITE["edition"]["name"]}), with a GRAVITY score of {f1(p["s"])}. {team}, {pos}.'
        write(f'players/{p["slug"]}/index.html',
              page(f'/players/{p["slug"]}/', f'{p["n"]} — #{p["r"]} in The 644 · The Gravity Report', desc, body,
                   active="/the644/", og_image=f'/players/{p["slug"]}/card.png', beacon=f'/players/{p["slug"]}'))
        idx.append({"r": p["r"], "n": p["n"], "t": p["t"], "team": team, "p": p["p"], "s": p["s"], "tier": p["tier"],
                    "rk": p["rk"], "slug": p["slug"]})
    write("players/index.json", json.dumps({"edition": SITE["edition"]["name"], "count": n, "players": idx},
                                           ensure_ascii=False, separators=(",", ":")) + "\n")
    lis = "".join(
        f'<li data-n="{e(p["n"].lower())}" data-t="{e(p["t"])}" data-p="{e(p["p"])}" data-r="{1 if p["rk"] else 0}">'
        f'<span class="rk">{p["r"]}</span><span class="nm"><a href="/players/{p["slug"]}/">{e(p["n"])}</a>'
        f'<span class="tm">{e(p["t"])}</span></span><span class="sc">{f1(p["s"])}</span></li>' for p in PLAYERS)
    body = f"""<div class="wrap">
<section class="page-head"><div class="kicker">Players</div><h1 class="h-xl">Find any player</h1>
<p class="lede">Every player in The 644 has a page: rank, score, the public numbers behind it, and any forecasts about him.</p>
<form class="filter" role="search" onsubmit="return false"><label>FIND A PLAYER<input type="search" id="f-q" placeholder="Name" autocomplete="off"></label>
<output id="f-count" aria-live="polite">{n} players</output></form></section>
<section class="sec"><ol class="rank-list" id="list644">{lis}</ol></section>
</div>"""
    write("players/index.html", page("/players/", "Players — The 644 · The Gravity Report",
                                     "Every NBA player in The 644, with a page each: rank, GRAVITY score and the public numbers behind it.",
                                     body, active="/the644/", og_image="/cards/the644.png",
                                     scripts='<script src="/assets/filter644.js"></script>\n'))


def build_ledger():
    ent = LEDGER["entries"]
    n_open = sum(1 for x in ent if x["status"] == "open")
    amend = "".join(f'<div class="revnote" style="border-left:4px solid var(--accent);background:var(--hl);padding:14px 16px;margin-top:16px">'
                    f'<b>Amended {e(a["label"])}</b> — {e(a["text"])}</div>' for a in LEDGER["amendments"])
    body = f"""<div class="wrap">
<section class="page-head"><div class="kicker">The Forecast Ledger</div><h1 class="h-xl">Every call, on the record before the season</h1>
<p class="lede">{e(LEDGER['intro'])}</p>
<div class="counts" style="margin-top:22px"><div><b>{n_open}</b><span>open</span></div><div><b>{len(ent) - n_open}</b><span>graded</span></div><div><b>Apr</b><span>first grades, 2027</span></div></div>
</section>
<section class="sec"><h2 class="h-m" style="margin-top:0">Open forecasts</h2>
<p class="lede">In the order they were registered. The bar shows the chance we gave; the black tick marks 50%, a coin flip.</p>
<div class="lrows">{''.join(lrow(x) for x in ent)}</div>
<div class="tbl-box"><table class="tbl" style="min-width:640px"><thead><tr><th>ID</th><th>Claim as registered</th><th class="n">Chance</th><th>Registered</th><th>Scores</th><th>Status</th></tr></thead><tbody>
{''.join(f'<tr><td class="mono">{e(x["id"])}</td><td>{e(x["legacy"])}</td><td class="n">{x["p"]}%</td><td class="mono">{short_date(x["registered"])}</td><td class="mono">{ym_label(x["grades"])}</td><td><span class="chip">OPEN</span></td></tr>' for x in ent)}
</tbody></table></div>
</section>
<section class="sec" id="rules"><h2 class="h-m" style="margin-top:0">How grading works</h2>
<p class="lede">Every call starts <b>OPEN</b> and becomes <b>WIN</b>, <b>NEAR MISS</b> or <b>MISS</b> when scored. A near miss is a failed prediction that owes a diagnosis, not partial credit. {e(LEDGER['rule'])}</p>
<p class="lede">The overall score is the <b>Brier score</b>: for each call, the squared gap between the chance we gave and what happened (1 if it happened, 0 if it didn't), averaged over all calls. Lower is better. Saying 50% on everything would score 0.25.</p>
{amend}
</section>
<section class="sec" id="scheduled"><h2 class="h-m" style="margin-top:0">Scheduled grades</h2>
<ol class="rank-list" style="margin-top:16px">
<li><span class="rk" style="width:90px">Jul 2027</span><span class="nm">Grading Article №2: when the July 2027 edition of The 644 is computed, one line — where Queta finished, and WIN / NEAR MISS / MISS for forecast №2.</span></li>
<li><span class="rk" style="width:90px">2027</span><span class="nm">Grading The 30 vs the standings: when the 2026-27 regular season is final, the rank correlation with final wins, and WIN / NEAR MISS / MISS for E1. The July edition it grades is frozen.</span></li>
<li><span class="rk" style="width:90px">2027</span><span class="nm">Forecast Audit 2027 — an annual report. What the model got right, what it got wrong, and why.</span></li>
</ol>
</section>
</div>"""
    write("ledger/index.html", page("/ledger/", "The Forecast Ledger — The Gravity Report",
                                    "Every Gravity Report forecast, registered before the season with a probability and graded in public after it.",
                                    body, active="/ledger/"))


def build_model():
    spec = next(a for a in ARTICLES if a["slug"] == "spec")
    body = f"""<div class="wrap">
<section class="page-head"><div class="kicker">The Model</div><h1 class="h-xl">How GRAVITY works</h1>
<p class="dek">GRAVITY stands for Game-Rate Adjusted Value, Impact, Talent, and Yield.</p>
<p class="lede">It estimates a player's per-minute quality and adjusts for role, availability, and documented injury risk — measuring not just how good a player is, but how much of that ability a team actually receives.</p>
<p class="lede"><b>In plain terms:</b> GRAVITY = (how good per minute) × (how reliably he's on the floor), graded against the whole league by the same formula. No reputation inputs, no external rankings — the judgment lives in the formula, which is published in full and applied identically to all 644 players.</p>
</section>
<section class="sec"><div class="split">
<div class="col-h"><h2 class="h-m" style="margin-top:0">The scale</h2><ol class="rank-list" style="margin-top:16px">
<li><span class="rk" style="width:60px">50</span><span class="nm">a league-average minute</span></li>
<li><span class="rk" style="width:60px">60+</span><span class="nm">a quality starter</span></li>
<li><span class="rk" style="width:60px">80+</span><span class="nm">a franchise engine</span></li>
<li><span class="rk" style="width:60px">97.8</span><span class="nm"><a href="/players/{BY_NAME['Nikola Jokić']['slug']}/">Nikola Jokić</a> (2025-26 max)</span></li>
</ol></div>
<div class="col-h"><h2 class="h-m" style="margin-top:0">Version history</h2><ol class="rank-list" style="margin-top:16px">
<li><span class="rk" style="width:60px">v1.0</span><span class="nm">Jul 10 — initial 644-player ranking</span></li>
<li><span class="rk" style="width:60px">v2</span><span class="nm">Jul 10 — Butler ACL correction (#13 → #58), <a href="/corrections/#butler">kept on display</a></span></li>
<li><span class="rk" style="width:60px">v3</span><span class="nm">Jul 10 — Cleaning the Glass filtered on/off integrated</span></li>
</ol></div>
</div></section>
<section class="sec"><h2 class="h-m" style="margin-top:0">The full mathematics</h2>
<p class="lede">Every equation, weight, shrinkage rule, tier cut, and the complete injury-override table is published as a standalone technical document, typeset like everything else here.</p>
<div class="btn-row"><a class="btn-dark" href="{spec['web']}">Read the specification {ARROW}</a><a class="btn-line" href="{spec['pdf']}">spec.pdf ({spec['pages']} pp)</a><a class="btn-line" href="{spec['tex']}">LaTeX source</a></div>
</section>
</div>"""
    write("model/index.html", page("/model/", "How GRAVITY works — The Gravity Report",
                                   "GRAVITY, in plain terms: how good per minute, times how reliably a player is on the floor — one published formula for all 644 players.",
                                   body, active="/model/", og_image="/cards/spec.png"))


def build_corrections():
    revs = []
    for key, slug in [("kawhi", "kawhi"), ("specdoc", "spec"), ("queta", "queta"), ("morant", "morant")]:
        r = MSGS[key].get("rev")
        if not r:
            continue
        a = next(x for x in ARTICLES if x["slug"] == slug)
        revs.append(f'<li id="rev-{slug}" style="display:block"><div class="meta mono small" style="text-transform:uppercase">{e(a["title"])}</div>'
                    f'<p style="margin:6px 0 0">{e(r)}</p><p class="small" style="margin:6px 0 0"><a href="{a["web"]}">Read the current version</a></p></li>')
    butler = MSGS["del_butler"]
    bbody = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", butler["body"])).strip()
    bbody = html.unescape(bbody).replace("Deleted Items · kept visible on purpose ", "")
    bbody = re.sub(r"^RECALLED\s+", "", bbody)
    amend = "".join(f'<li style="display:block"><div class="meta mono small">FORECAST LEDGER · {e(a["label"]).upper()}</div><p style="margin:6px 0 0">{e(a["text"])}</p></li>'
                    for a in LEDGER["amendments"])
    body = f"""<div class="wrap">
<section class="page-head"><div class="kicker">Corrections and revisions</div><h1 class="h-xl">Errors get corrected in public</h1>
<p class="lede">Published articles are permanent. Every revision ships with a dated public note, and recalled numbers stay on display. That is what makes the wins believable.</p></section>
<section class="sec"><h2 class="h-m" style="margin-top:0">Revision notes</h2>
<ol class="rank-list" style="margin-top:16px">{''.join(revs)}</ol></section>
<section class="sec" id="butler"><h2 class="h-m" style="margin-top:0">Recalled: Jimmy Butler at #13 (v1)</h2>
<p class="small">{e(butler['date'])} · The 644 (Rankings Desk)</p>
<p class="lede">{e(bbody)}</p></section>
<section class="sec"><h2 class="h-m" style="margin-top:0">Forecast amendments</h2><ol class="rank-list" style="margin-top:16px">{amend}</ol></section>
</div>"""
    write("corrections/index.html", page("/corrections/", "Corrections and revisions — The Gravity Report",
                                         "Every revision note, recall and forecast amendment The Gravity Report has published, kept on display.",
                                         body))


def build_data():
    cols644 = [
        ("rank", "Rank in The 644"), ("player", "Name"), ("team", "Team (July 2026)"), ("pos", "Position"),
        ("age", "Age"), ("score", "GRAVITY score (50 = league-average minute)"),
        ("bpm26 / obpm26 / dbpm26", "Box Plus/Minus, total / offense / defense, 2025–26"),
        ("vorp26", "Value over replacement player, 2025–26"), ("ws48_26", "Win Shares per 48 minutes, 2025–26"),
        ("ts26", "True shooting, 2025–26"), ("usg26", "Usage %, 2025–26"),
        ("onoff26", "Raw on/off per 100 possessions, 2025–26 (Basketball Reference)"),
        ("gp26 / mp26", "Games and minutes, 2025–26"), ("mp_playoffs / bpm_playoffs", "2026 playoff minutes and BPM"),
        ("note", "Injury or rookie note"), ("is_rookie / draft_pick", "Rookie flag and draft slot"),
    ]
    lis = "".join(f'<li><span class="rk mono" style="width:auto;min-width:200px">{e(k)}</span><span class="nm" style="font-size:16px">{e(v)}</span></li>' for k, v in cols644)
    ed = SITE["edition"]
    body = f"""<div class="wrap">
<section class="page-head"><div class="kicker">Open data</div><h1 class="h-xl">Download the numbers</h1>
<p class="lede">The full edition of The 644 and The 30, as published. If you use them, please credit The Gravity Report and link to the edition.</p>
<div class="btn-row"><a class="btn-dark" href="{ed['csv']}" download>the644-2026-07.csv</a><a class="btn-line" href="{ed['teams_csv']}" download>the30-2026-07.csv</a><a class="btn-line" href="/players/index.json">players/index.json</a></div></section>
<section class="sec"><h2 class="h-m" style="margin-top:0">Columns in the644.csv</h2><ol class="rank-list" style="margin-top:16px">{lis}</ol></section>
<section class="sec"><h2 class="h-m" style="margin-top:0">How it's made</h2><p class="lede">One published formula, applied to every player. <a href="/model/">How GRAVITY works</a> · <a href="/notes/spec/">the full specification</a>.</p></section>
</div>"""
    write("data/index.html", page("/data/", "Open data — The Gravity Report",
                                  "Download The 644 and The 30 as CSV, with column definitions.", body))


def build_about():
    build_web_edition("about", "about/", "")


def build_subscribe():
    body = """<div class="wrap"><section class="page-head"><div class="kicker">Newsletter</div><h1 class="h-xl">Email sign-up opens soon</h1>
<p class="lede">The newsletter isn't live yet, and nothing you typed was saved or sent. Until it opens, the RSS feed carries every new article.</p>
<div class="btn-row"><a class="btn-dark" href="/feed.xml">RSS feed</a><a class="btn-line" href="/">Back to the front page</a></div></section></div>"""
    write("subscribe/index.html", page("/subscribe/", "Newsletter — The Gravity Report",
                                       "The Gravity Report newsletter.", body, noindex=True))


def build_404():
    body = """<div class="wrap"><section class="page-head"><div class="kicker">404</div><h1 class="h-xl">That page isn't here</h1>
<p class="lede">It may have moved in the redesign. Every article, edition and correction is still on the site.</p>
<div class="btn-row"><a class="btn-dark" href="/">Front page</a><a class="btn-line" href="/articles/">Articles</a><a class="btn-line" href="/the644/">The 644</a></div></section></div>"""
    write("404.html", page("/404.html", "Not found — The Gravity Report", "Page not found.", body, noindex=True))


def build_sitemap():
    urls = [("/", "1.0"), ("/the644/", "0.9"), ("/articles/", "0.8"), ("/ledger/", "0.8"), ("/model/", "0.7"),
            ("/notes/kawhi/", "0.8"), ("/notes/queta/", "0.8"), ("/notes/morant/", "0.8"), ("/notes/spec/", "0.7"),
            ("/about/", "0.6"), ("/corrections/", "0.5"), ("/data/", "0.5"), ("/players/", "0.6")]
    urls += [(f"/players/{p['slug']}/", "0.4") for p in PLAYERS]
    body = "".join(f"  <url><loc>{SITE['url']}{u}</loc><priority>{pr}</priority></url>\n" for u, pr in urls)
    write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + body + "</urlset>\n")


def main():
    build_home()
    build_articles_index()
    build_web_edition("kawhi", "notes/kawhi/", "/articles/")
    build_web_edition("queta", "notes/queta/", "/articles/")
    build_web_edition("morant", "notes/morant/", "/articles/")
    build_web_edition("spec", "notes/spec/", "/model/")
    build_about()
    build_the644()
    build_players_pages()
    build_ledger()
    build_model()
    build_corrections()
    build_data()
    build_subscribe()
    build_404()
    build_sitemap()
    print(f"built: {len(PLAYERS)} players + core pages")


if __name__ == "__main__":
    main()
