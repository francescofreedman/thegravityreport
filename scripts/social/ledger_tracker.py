#!/usr/bin/env python3
"""Weekly "Is the model winning?" tracker.

Pulls the current season's Basketball Reference advanced table, works out where
each open ledger call stands *so far*, and writes a `ledger` post kit.

  python3 scripts/social/ledger_tracker.py                 # fetch (polite, cached 6h) and build a kit
  python3 scripts/social/ledger_tracker.py --html FILE     # use a saved page instead of fetching
  python3 scripts/social/ledger_tracker.py --dry           # print the status lines only

Calls that can only be graded from a 644 edition or the final standings say so.
Before tip-off (or if the page doesn't exist yet) the stat calls read "no games yet".
"""
import argparse
import datetime
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import make_kit as mk  # noqa: E402

SEASON_END_YEAR = 2027
URL = f"https://www.basketball-reference.com/leagues/NBA_{SEASON_END_YEAR}_advanced.html"
CACHE = os.path.join(ROOT, "social", ".cache")
UA = "TheGravityReport-ledger-tracker/1.0 (+https://thegravityreport.com/ledger/)"
SEASON_GAMES = 82


def fetch(url=URL, max_age_h=6):
    """One polite request at most every 6 hours; Basketball Reference asks for < 20 requests a minute."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, os.path.basename(url))
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < max_age_h * 3600:
        return open(path, encoding="utf-8", errors="replace").read()
    time.sleep(3)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return ""
        raise
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return text


def cell(row, stat):
    m = re.search(r'data-stat="' + stat + r'"[^>]*>(.*?)</t[dh]>', row, re.S)
    if not m:
        return None
    return htmllib.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def parse(page):
    """name -> {team, g, mp, ts, usg, bpm}. A traded player's first row is his season total."""
    out = {}
    tbody = re.search(r'<table[^>]*id="advanced"[^>]*>.*?<tbody>(.*?)</tbody>', page or "", re.S)
    if not tbody:
        return out
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", tbody.group(1), re.S):
        name = cell(row, "name_display") or cell(row, "player")
        if not name or name in out or name == "League Average":
            continue
        out[name] = {
            "team": cell(row, "team_name_abbr") or cell(row, "team_id"),
            "g": num(cell(row, "games") or cell(row, "g")),
            "mp": num(cell(row, "mp")),
            "ts": num(cell(row, "ts_pct")),
            "usg": num(cell(row, "usg_pct")),
            "bpm": num(cell(row, "bpm")),
        }
    return out


def ts3(v):
    s = f"{v:.3f}"
    return s[1:] if s.startswith("0") else s


def status_lines(stats, ledger):
    """Return (rows for the kit, source text containing every number used)."""
    rows, src = [], []
    games_so_far = max([p["g"] or 0 for p in stats.values()] or [0])
    for e in ledger["entries"]:
        if e["status"] != "open":
            continue
        line = None
        who = stats.get(e.get("player") or "")
        if e["id"] in ("2", "2b", "K1"):
            line = "graded from the July 2027 edition of The 644"
        elif e["id"] == "E1":
            line = "graded when the regular season is final"
        elif not stats:
            line = "no games yet"
        elif not who:
            line = "no minutes yet this season"
        elif e["id"] == "K3":
            # 1,500 minutes prorated to the games played so far, so the comparison group is fair mid-season
            need = 1500 * games_so_far / SEASON_GAMES
            pool = sorted((p["bpm"] for p in stats.values() if p["mp"] and p["mp"] >= need and p["bpm"] is not None),
                          reverse=True)
            if who["bpm"] is None or not who["mp"] or who["mp"] < need:
                line = f"not on pace for 1,500 minutes yet ({int(who['mp'] or 0):,} so far)"
            else:
                rank = 1 + sum(1 for b in pool if b > who["bpm"])
                line = f"Box Plus/Minus {who['bpm']:+.1f} so far, #{rank} among {len(pool)} players on pace for 1,500 minutes"
                src.append(f"{who['bpm']} {rank} {len(pool)} 1500 {who['mp']}")
        elif e["id"] == "K4":
            ok = who["usg"] is not None and who["usg"] >= 30
            line = f"usage {who['usg']:.1f}% so far ({'on track' if ok else 'behind'}), {int(who['mp']):,} minutes"
            src.append(f"{who['usg']} {who['mp']}")
        elif e["id"] == "K5":
            ok = who["ts"] is not None and who["ts"] < 0.610
            line = f"true shooting {ts3(who['ts'])} so far ({'on track' if ok else 'not yet'}), {int(who['mp']):,} minutes"
            src.append(f"{who['ts']} {who['mp']}")
        if line:
            rows.append({"id": e["id"], "p": e["p"], "claim": e["short"], "status_line": line})
    src.append(json.dumps(ledger, ensure_ascii=False))
    return rows, " ".join(src)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", help="use a saved Basketball Reference page")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--outdir")
    a = ap.parse_args(argv)
    page = open(a.html, encoding="utf-8", errors="replace").read() if a.html else fetch()
    stats = parse(page)
    ledger = mk.load("content/ledger.json")
    rows, source = status_lines(stats, ledger)
    as_of = datetime.date.fromisoformat(a.date).strftime("%b %-d, %Y")
    if a.dry:
        for r in rows:
            print(f"{r['id']:>3} {r['p']:>3}%  {r['claim']}: {r['status_line']}")
        return rows
    kit, out = mk.build_ledger_kit(rows, as_of, a.date, outdir=a.outdir, source_text=source + " " + as_of)
    print(os.path.relpath(out, ROOT))
    return rows


if __name__ == "__main__":
    main()
