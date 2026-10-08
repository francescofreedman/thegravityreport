#!/usr/bin/env python3
"""Site QA: internal link check + proof that article text did not change.

1. Every href/src on every built page that points inside the site must resolve
   to a file in the repo (anchors are checked against ids on the target page).
2. Every URL in the legacy sitemap must still resolve.
3. For each web edition, the visible text of the article body must equal the
   legacy text, except for decorative emoji removed from button labels.

Usage: python3 scripts/check_site.py        (exit 1 on any failure)
"""
import html
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote, urldefrag

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LEGACY = "b18e539"
SKIP_DIRS = {".git", "classic", "content", "node_modules", "lab", "voice", "social", "review"}


def html_files():
    for d, dirs, files in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in files:
            if f.endswith(".html") and not f.endswith(".dc.html"):
                yield os.path.join(d, f)


def resolve(url, src_file):
    url, frag = urldefrag(url)
    if url.startswith("/"):
        p = os.path.join(ROOT, unquote(url.lstrip("/")))
    elif url == "":
        p = src_file
    else:
        p = os.path.normpath(os.path.join(os.path.dirname(src_file), unquote(url)))
    if os.path.isdir(p):
        p = os.path.join(p, "index.html")
    return p, frag


IDS_CACHE = {}


def ids_of(path):
    if path not in IDS_CACHE:
        try:
            s = open(path, encoding="utf-8").read()
        except (OSError, UnicodeDecodeError):
            s = ""
        IDS_CACHE[path] = set(re.findall(r'\bid="([^"]+)"', s))
    return IDS_CACHE[path]


def check_links():
    bad = []
    n = 0
    for f in html_files():
        s = open(f, encoding="utf-8").read()
        for attr, url in re.findall(r'\b(href|src)="([^"]+)"', s):
            if re.match(r"^(https?:|mailto:|data:|javascript:|tel:)", url):
                continue
            if url.startswith("/api/"):
                continue
            n += 1
            p, frag = resolve(html.unescape(url), f)
            if not os.path.exists(p):
                bad.append((os.path.relpath(f, ROOT), url, "missing"))
                continue
            # anchors on our own pages (not the classic inbox's JS hash routes)
            if frag and p.endswith(".html") and "/classic/" not in p and not frag.startswith("q="):
                if frag not in ids_of(p):
                    bad.append((os.path.relpath(f, ROOT), url, "missing #anchor"))
    return n, bad


def check_legacy_sitemap():
    sm = subprocess.run(["git", "show", f"{LEGACY}:sitemap.xml"], cwd=ROOT, capture_output=True, check=True).stdout.decode()
    bad = []
    for loc in re.findall(r"<loc>https://thegravityreport\.com(/[^<]*)</loc>", sm):
        p, _ = resolve(loc, os.path.join(ROOT, "index.html"))
        if not os.path.exists(p):
            bad.append(loc)
    return bad


EMOJI_RE = re.compile(r"[\U0001F300-\U0001FAFF☀-➿]️?")


def visible_text(fragment):
    t = re.sub(r"<script.*?</script>", " ", fragment, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    t = EMOJI_RE.sub("", t)
    return re.sub(r"\s+", " ", t).strip()


def check_article_text():
    out = []
    for slug, path in [("kawhi", "notes/kawhi/index.html"), ("morant", "notes/morant/index.html"),
                       ("queta", "notes/queta/index.html"), ("spec", "notes/spec/index.html"),
                       ("about", "about/index.html")]:
        legacy = json.load(open(os.path.join(ROOT, "content/pages", slug + ".json"), encoding="utf-8"))["body"]
        # published relabels are the only allowed change: apply them to the legacy text, drop their notes
        revs = json.load(open(os.path.join(ROOT, "content/revisions.json"), encoding="utf-8"))["relabels"]
        for r in revs:
            if slug in r["applies_to"]:
                for x, z in r["replace"]:
                    legacy = legacy.replace(x, z)
        now = open(os.path.join(ROOT, path), encoding="utf-8").read()
        now = re.sub(r'<div class="revnote relabel">.*?</div>', "", now, flags=re.S)
        m = re.search(r'<article class="paper">(.*?)</article>', now, re.S)
        a, b = visible_text(legacy), visible_text(m.group(1) if m else "")
        out.append((slug, a == b, a, b))
    return out


def main():
    n, bad = check_links()
    print(f"links checked: {n}; broken: {len(bad)}")
    for b in bad[:50]:
        print("  BROKEN", b)
    sm_bad = check_legacy_sitemap()
    print(f"legacy sitemap URLs missing: {len(sm_bad)}", sm_bad)
    fails = 0
    for slug, ok, a, b in check_article_text():
        print(f"article text identical: {slug}: {'yes' if ok else 'NO'}")
        if not ok:
            fails += 1
            import difflib
            for line in difflib.unified_diff(a.split(". "), b.split(". "), lineterm="", n=0):
                print("   ", line[:200])
    sys.exit(1 if (bad or sm_bad or fails) else 0)


if __name__ == "__main__":
    main()
