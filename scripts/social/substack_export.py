#!/usr/bin/env python3
"""Paste-ready Substack copies of published articles.

Substack has no official publishing API, so this makes the paste easy instead:

  python3 scripts/social/substack_export.py            # all articles
  python3 scripts/social/substack_export.py kawhi

Writes social/substack/<slug>/:
  post.html     open it in a browser, select all, copy, paste into a new Substack post
  bars.png      the registered forecasts as one image (Substack can't run the site's bars)
  README.md     the 6 steps, title/subtitle to type, and the image alt text

The article text is the published web edition, unchanged. Links and images point at
thegravityreport.com so nothing breaks after pasting.
"""
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import cardlib as cl  # noqa: E402

SITE = "https://thegravityreport.com"


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def absolutize(body):
    body = body.replace('href="../../', f'href="{SITE}/').replace('src="../../', f'src="{SITE}/')
    body = body.replace('href="../', f'href="{SITE}/notes/')
    body = re.sub(r'href="\.\./\.\./#[^"]*"', f'href="{SITE}/"', body)
    return body


def strip_site_only(body):
    # inline-styled probability bars -> removed (replaced by bars.png); button rows -> one plain link
    body = re.sub(r'<div style="display:flex;align-items:center;gap:10px;margin-top:5px">.*?</b>\s*</div>', "", body, flags=re.S)
    body = re.sub(r'<div class="btnrow">.*?</div>', "", body, flags=re.S)
    body = re.sub(r'<pre class="mono">.*?</pre>', "", body, flags=re.S)  # citation block reads oddly in email
    body = re.sub(r"\sstyle=\"[^\"]*\"", "", body)
    body = re.sub(r"\sclass=\"[^\"]*\"", "", body)
    return body


def bars_png(path, calls):
    W = 1200
    H = 200 + 120 * len(calls)
    img, d = cl.canvas(W, H)
    d.text((60, 50), "REGISTERED FORECASTS · GRADED IN PUBLIC", font=cl.mono(24, 600), fill=cl.ACCENT)
    fs = cl.mono(20, 500)
    d.text((60, 100), "0%", font=fs, fill=cl.MUTED)
    d.text((60 + 400, 100), "coin flip", font=fs, fill=cl.MUTED, anchor="ma")
    d.text((60 + 800, 100), "100%", font=fs, fill=cl.MUTED, anchor="ra")
    y = 140
    for c in calls:
        d.text((60, y), c.get("box", c["claim"]), font=cl.archivo(34, 600, 100), fill=cl.INK)
        cl.pbar(d, 60, y + 52, 800, 18, c["p"], pct_font=cl.mono(40, 600))
        y += 120
    cl.save(img, path)


def export(slug):
    a = next(x for x in load("content/articles.json") if x["slug"] == slug)
    pg = load(f"content/pages/{slug}.json")
    ledger = {e["id"]: e for e in load("content/ledger.json")["entries"]}
    calls = [ledger[i] for i in a.get("ledger", [])]
    out = os.path.join(ROOT, "social", "substack", slug)
    os.makedirs(out, exist_ok=True)
    # the kicker, title and subtitle go into Substack's own fields, not the body
    raw = re.sub(r'<div class="(kicker|subtitle)">.*?</div>|<h1>.*?</h1>', "", pg["body"], flags=re.S)
    body = strip_site_only(absolutize(raw))
    bars = ""
    if calls:
        bars_png(os.path.join(out, "bars.png"), calls)
        alt = "Registered forecasts: " + "; ".join(f"{c.get('box', c['claim'])}, {c['p']}%" for c in calls) + "."
        bars = f'<p><img src="bars.png" alt="{html.escape(alt)}" width="600"></p>'
    web = SITE + a["web"]
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(a['title'])} — for Substack</title>
<style>body{{max-width:680px;margin:40px auto;font:18px/1.6 Georgia,serif;padding:0 16px}}img{{max-width:100%}}</style></head><body>
<p><em>Originally published at <a href="{web}">thegravityreport.com</a>, where every forecast is tracked in the public <a href="{SITE}/ledger/">Forecast Ledger</a>.</em></p>
{body}
{bars}
<p><strong>Read it on the site, with the charts and the PDF:</strong> <a href="{web}">{web}</a></p>
</body></html>
"""
    with open(os.path.join(out, "post.html"), "w", encoding="utf-8") as f:
        f.write(doc)
    readme = f"""# Paste "{a['title']}" into Substack (about 15 minutes)

1. Open `post.html` in your browser (double-click it).
2. In Substack: **New post**. Title: `{a['title']}`. Subtitle: `{a['dek']}`
3. Back in the browser tab: select all (Cmd+A), copy (Cmd+C), paste into the Substack body (Cmd+V).
4. {"Where the forecasts are, drag in `bars.png`. Alt text: " + chr(96) + alt + chr(96) if calls else "No forecast image for this article."}
5. Check the two figures loaded (they come from thegravityreport.com). Settings → set the post's canonical URL to `{web}` if Substack offers it.
6. Preview the email, then publish. Nothing here publishes on its own.
"""
    with open(os.path.join(out, "README.md"), "w", encoding="utf-8") as f:
        f.write(readme)
    return out


def main():
    slugs = sys.argv[1:] or [a["slug"] for a in load("content/articles.json") if a["kind"] == "article"]
    for s in slugs:
        print(os.path.relpath(export(s), ROOT))


if __name__ == "__main__":
    main()
