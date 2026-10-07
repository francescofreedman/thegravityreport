#!/usr/bin/env python3
"""One-time extraction of the Win98-era site into data files for the new build.

Reads every source file from the pinned commit LEGACY (the last inbox-era
commit on main), never from the working tree, so it is reproducible after the
build has overwritten index.html, notes/* and the644/.

Writes:
  content/legacy/messages.json   every inbox message (M) and folder (FOLDERS)
  content/the644.json            the 644 player records + tiers + The 30 teams
  content/pages/<slug>.json      head metadata + article body of each web edition
  classic/index.html             the original inbox, paths fixed for the subfolder

Usage: python3 scripts/migrate_legacy.py
"""
import json
import os
import re
import subprocess

LEGACY = "b18e539"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def git_show(path):
    return subprocess.run(["git", "show", f"{LEGACY}:{path}"], cwd=ROOT, check=True,
                          capture_output=True).stdout.decode("utf-8")


def write(rel, text):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


def node_eval(js):
    out = subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True)
    return json.loads(out.stdout.decode("utf-8"))


def extract_messages(index_html):
    lines = index_html.split("\n")
    start = next(i for i, l in enumerate(lines) if l.startswith("const M = {"))
    end = next(i for i, l in enumerate(lines) if l.startswith("let curFolder"))
    src = "\n".join(lines[start:end])
    js = ("const f=new Function(" + json.dumps(src + "\n;return {M, FOLDERS};") + ");"
          "process.stdout.write(JSON.stringify(f()));")
    return node_eval(js)


def extract_the644(page):
    out = {}
    m = re.search(r"const DATA = (\[.*?\]);\n", page, re.S)
    out["players"] = json.loads(m.group(1))
    js_consts = {}
    for name in ["TIERS", "TEAMS30", "ROSTERS30", "F_REPL30", "ROSTER_DATE30"]:
        mm = re.search(r"const " + name + r"\s*=\s*", page)
        if not mm:
            continue
        # evaluate the literal with node: take text up to the terminating ';' at depth 0
        i = mm.end()
        depth, j, q = 0, i, None
        while j < len(page):
            c = page[j]
            if q:
                if c == "\\":
                    j += 2
                    continue
                if c == q:
                    q = None
            elif c in "\"'`":
                q = c
            elif c in "[{(":
                depth += 1
            elif c in "]})":
                depth -= 1
            elif c == ";" and depth == 0:
                break
            j += 1
        js_consts[name] = page[i:j]
    js = "const o={};" + "".join(
        f"o[{json.dumps(k)}]=({v});" for k, v in js_consts.items()) + "process.stdout.write(JSON.stringify(o));"
    out.update(node_eval(js))
    return out


META_RE = re.compile(r'<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"\s*/?>')


def extract_page(html_text):
    head = html_text.split("</head>")[0]
    title = re.search(r"<title>(.*?)</title>", head, re.S).group(1).strip()
    meta = {k: v for k, v in META_RE.findall(head)}
    canon = re.search(r'<link rel="canonical" href="([^"]+)"', head)
    ld = re.search(r'<script type="application/ld\+json">(.*?)</script>', head, re.S)
    m = re.search(r'<article class="paper">(.*?)</article>', html_text, re.S)
    beacon = re.search(r"var item = '([^']+)'", html_text)
    return {
        "title": title,
        "meta": meta,
        "canonical": canon.group(1) if canon else None,
        "ld_json": ld.group(1).strip() if ld else None,
        "body": m.group(1) if m else None,
        "beacon_item": beacon.group(1) if beacon else None,
    }


def classic(index_html):
    """The original inbox, served from /classic/: rewrite root-relative asset paths."""
    s = re.sub(r"""(["'`])(papers/|notes/|the644/|about/|feed\.xml)""", r"\1../\2", index_html)
    s = s.replace('<link rel="canonical" href="https://thegravityreport.com/">',
                  '<link rel="canonical" href="https://thegravityreport.com/classic/">'
                  '\n<meta name="robots" content="noindex">')
    banner = ('<div style="position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#0A0A0A;color:#fff;'
              'font:13px/1.4 monospace;padding:8px 12px;text-align:center">This is the original inbox edition '
              '(July–October 2026), kept as it was. <a href="../" style="color:#9fb0ff">Go to the current site</a></div>')
    s = s.replace("</body>", banner + "\n</body>", 1)
    return s


def main():
    index_html = git_show("index.html")
    msgs = extract_messages(index_html)
    write("content/legacy/messages.json", json.dumps(msgs, ensure_ascii=False, indent=1) + "\n")

    the644 = extract_the644(git_show("the644/index.html"))
    write("content/the644.json", json.dumps(the644, ensure_ascii=False, separators=(",", ":")) + "\n")

    for slug, path in [("kawhi", "notes/kawhi/index.html"), ("morant", "notes/morant/index.html"),
                       ("queta", "notes/queta/index.html"), ("spec", "notes/spec/index.html"),
                       ("about", "about/index.html")]:
        page = extract_page(git_show(path))
        write(f"content/pages/{slug}.json", json.dumps(page, ensure_ascii=False, indent=1) + "\n")

    write("classic/index.html", classic(index_html))
    print("messages:", len(msgs["M"]), "players:", len(the644["players"]),
          "teams:", len(the644.get("TEAMS30", [])))


if __name__ == "__main__":
    main()
