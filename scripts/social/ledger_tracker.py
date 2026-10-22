#!/usr/bin/env python3
"""Weekly "Is the model winning?" tracker (Mondays, 9 AM ET).

Pulls the current season's Basketball Reference advanced table and ESPN's standings, works out
where each open ledger call stands *so far*, and writes a `ledger` post kit.

  python3 scripts/social/ledger_tracker.py --schedule       # the weekly run: kit for next Monday + schedule rows
  python3 scripts/social/ledger_tracker.py                  # fetch (polite, cached 6h) and build a kit dated today
  python3 scripts/social/ledger_tracker.py --html FILE --standings FILE   # use saved pages instead of fetching
  python3 scripts/social/ledger_tracker.py --dry            # print the status lines only

Why this stays a script and not a Worker series: Basketball Reference is HTML behind bot
protection and asks for slow, polite scraping (one cached request every 6 hours), which a
Cloudflare Worker cron can't promise. So the numbers are fetched here, checked by the number
guard, committed as a kit, and the site's cron posts the kit like any other scheduled row.

Weekly routine (Sunday night or Monday before 9 AM ET):
  python3 scripts/social/ledger_tracker.py --schedule && git add -A && git commit -m "Tracker: <date>" && git push

Every number in the post comes from the fetched table, the standings, or the ledger itself.
Calls that can only be graded later (award votes, the July 2027 edition of The 644, the
February deadline) are listed too, grouped by when they get graded.
"""
import argparse
import datetime
import html as htmllib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import make_kit as mk  # noqa: E402

SEASON_END_YEAR = 2027
URL = f"https://www.basketball-reference.com/leagues/NBA_{SEASON_END_YEAR}_advanced.html"
STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings"
CACHE = os.path.join(ROOT, "social", ".cache")
UA = "TheGravityReport-ledger-tracker/1.0 (+https://thegravityreport.com/ledger/)"
SEASON_GAMES = 82
ET = ZoneInfo("America/New_York")

# ESPN's team codes where they differ from the NBA codes used in The 644.
ESPN_CODES = {"NY": "NYK", "NO": "NOP", "SA": "SAS", "UTAH": "UTA", "GS": "GSW", "WSH": "WAS"}

# Calls whose ledger entry has no player field but which track one player's season line.
PLAYER_FOR = {"P6": "Dylan Harper", "P20": "LeBron James", "P19": "Nikola Jokić"}


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


def fetch_standings(max_age_h=1):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "espn-standings.json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < max_age_h * 3600:
        return json.load(open(path, encoding="utf-8"))
    # ESPN answers 403 to a UA that contains a URL; a plain product token is fine.
    req = urllib.request.Request(STANDINGS_URL, headers={"User-Agent": "TheGravityReport-tracker/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return data


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


def parse_standings(data):
    """ESPN standings JSON -> {NBA code: {w, l, name}} for all 30 teams."""
    out = {}
    for conf in (data or {}).get("children") or []:
        for e in conf.get("standings", {}).get("entries", []):
            st = {s["name"]: s for s in e.get("stats", [])}
            if "wins" not in st or "losses" not in st:
                continue
            code = e["team"]["abbreviation"]
            code = ESPN_CODES.get(code, code)
            out[code] = {"w": int(st["wins"]["value"]), "l": int(st["losses"]["value"]), "name": e["team"]["displayName"]}
    return out


def ts3(v):
    s = f"{v:.3f}"
    return s[1:] if s.startswith("0") else s


def city_codes():
    """'Toronto' -> 'TOR' etc., from The 30's team names."""
    out = {}
    for t in mk.load("the30/torque-2026-27.json")["teams"]:
        name = t["team"]
        city = "Portland" if name.startswith("Portland") else name.rsplit(" ", 1)[0]
        out[city] = mk.FROM_TORQUE.get(t["code"], t["code"])
    return out


TEAM_CALL = re.compile(r"(?P<city>[A-Z][A-Za-z. ]*?) (?:wins (?P<n>\d+) or (?P<dir>more|fewer) games|(?P<ou>over|under) (?P<line>\d+\.5))")


def team_call(claim, cities):
    """(code, test(pace) -> bool) for a win-total claim, or None."""
    m = TEAM_CALL.search(claim)
    if not m:
        return None
    city = m.group("city").split(": ")[-1].strip()
    if city not in cities:
        return None
    if m.group("n"):
        n, more = int(m.group("n")), m.group("dir") == "more"
        return cities[city], (lambda pace: pace >= n) if more else (lambda pace: pace <= n)
    line, over = float(m.group("line")), m.group("ou") == "over"
    return cities[city], (lambda pace: pace > line) if over else (lambda pace: pace < line)


def spearman(pairs):
    """Spearman rank correlation of [(a, b)], average ranks for ties."""
    def ranks(vals):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        r = [0.0] * len(vals)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2 + 1
            i = j + 1
        return r
    n = len(pairs)
    if n < 2:
        return None
    ra, rb = ranks([p[0] for p in pairs]), ranks([p[1] for p in pairs])
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va, vb = sum((x - ma) ** 2 for x in ra), sum((y - mb) ** 2 for y in rb)
    return cov / (va * vb) ** 0.5 if va and vb else None


def status_lines(stats, ledger, standings=None, torque=None):
    """Return (rows for the kit, source text containing every number used).

    rows: [{id, p, claim, status_line, later}] in ledger order. `later` marks calls that can only be
    graded at a fixed date (grouped in the post) rather than tracked week by week.
    """
    rows, src = [], []
    games_so_far = int(max([p["g"] or 0 for p in stats.values()] or [0]))
    cities = city_codes()
    torque = torque or mk.load("the30/torque-2026-27.json")
    avg_games = (sum(t["w"] + t["l"] for t in standings.values()) / len(standings)) if standings else 0

    def on(ok):
        return "on track" if ok else "behind"

    for e in ledger["entries"]:
        if e["status"] != "open":
            continue
        eid, claim = e["id"], e["claim"]
        pname = e.get("player") or PLAYER_FOR.get(eid)
        who = stats.get(pname or "")
        line, later = None, False
        tc = team_call(claim, cities)
        if e.get("grades") == "2027-07" and "The 644" in claim:
            line, later = "graded from the July 2027 edition of The 644", True
        elif eid == "E1":
            if standings and avg_games >= 5:
                pairs = []
                for t in torque["teams"]:
                    s = standings.get(mk.FROM_TORQUE.get(t["code"], t["code"]))
                    if s and s["w"] + s["l"]:
                        pairs.append((-t["rank"], s["w"] / (s["w"] + s["l"])))
                rho = spearman(pairs)
                line = f"rank correlation with the standings {rho:.2f} so far (needs 0.60 when the season is final)"
                src.append(f"{rho:.2f} 0.60")
            else:
                line, later = "graded when the regular season is final", True
        elif eid == "P18":
            line, later = "graded at the February 11 trade deadline", True
        elif tc:
            code, ok = tc
            s = (standings or {}).get(code)
            if not s or not (s["w"] + s["l"]):
                line = "no games yet"
            elif avg_games < 5:
                line, later = "too early to call, under 5 games a team", True
                src.append("5")
            else:
                pace = round(SEASON_GAMES * s["w"] / (s["w"] + s["l"]))
                line = f"{s['w']}-{s['l']} so far, a pace of {pace} wins ({on(ok(pace))})"
                src.append(f"{s['w']} {s['l']} {pace}")
        elif e.get("grades") == "2027-06":
            line, later = "decided in June 2027", True
        elif eid == "P19":
            line, later = "graded from his season averages in April 2027", True
        elif not stats:
            line = "no games yet"
        elif not who:
            line = "no minutes yet this season"
        elif who["bpm"] is None and eid in ("K3", "J2", "D3", "P6"):
            # Basketball Reference publishes BPM only once the season has a few games of data
            line = f"Box Plus/Minus not published yet, {int(who['mp'] or 0):,} minutes"
            src.append(f"{who['mp'] or 0}")
        elif eid in ("K3", "J2"):
            # 1,500 minutes prorated to the games played so far, so the comparison group is fair mid-season
            need = 1500 * games_so_far / SEASON_GAMES
            pool = sorted((p["bpm"] for p in stats.values() if p["mp"] and p["mp"] >= need and p["bpm"] is not None),
                          reverse=True)
            if not who["mp"] or who["mp"] < need:
                line = f"not on pace for 1,500 minutes yet ({int(who['mp'] or 0):,} so far)"
            else:
                rank = 1 + sum(1 for b in pool if b > who["bpm"])
                target = 8 if eid == "K3" else 1
                line = (f"Box Plus/Minus {who['bpm']:+.1f} so far, #{rank} among {len(pool)} players on pace for 1,500 minutes "
                        f"({on(rank <= target)})")
                src.append(f"{who['bpm']} {rank} {len(pool)} 1500 {who['mp']}")
        elif eid == "K4":
            ok = who["usg"] is not None and who["usg"] >= 30
            line = (f"usage {who['usg']:.1f}% so far ({on(ok)}), {int(who['mp'] or 0):,} minutes" if who["usg"] is not None
                    else f"usage not published yet, {int(who['mp'] or 0):,} minutes")
            src.append(f"{who['usg']} {who['mp'] or 0}")
        elif eid == "K5":
            ok = who["ts"] is not None and who["ts"] < 0.610
            line = (f"true shooting {ts3(who['ts'])} so far ({'on track' if ok else 'not yet'}), {int(who['mp'] or 0):,} minutes"
                    if who["ts"] is not None else f"true shooting not published yet, {int(who['mp'] or 0):,} minutes")
            src.append(f"{who['ts']} {who['mp'] or 0}")
        elif eid == "D3":
            line = f"Box Plus/Minus {who['bpm']:+.1f} so far, {int(who['mp'] or 0):,} minutes; ranked among centers in April"
            src.append(f"{who['bpm']} {who['mp'] or 0}")
        elif eid == "P6":
            ok = who["bpm"] is not None and who["bpm"] >= 3.0
            line = f"Box Plus/Minus {who['bpm']:+.1f} so far ({on(ok)}), {int(who['mp'] or 0):,} minutes"
            src.append(f"{who['bpm']} {who['mp'] or 0}")
        elif eid == "P20":
            g = int(who["g"] or 0)
            line = f"{g} of {games_so_far} game{'s' if games_so_far != 1 else ''} so far ({on(g >= 60 * games_so_far / SEASON_GAMES)})"
            src.append(f"{g} {games_so_far}")
        if line:
            rows.append({"id": eid, "p": e["p"], "claim": e["short"], "status_line": line, "later": later})
    src.append(json.dumps(ledger, ensure_ascii=False))
    return rows, " ".join(src)


def next_monday(now=None):
    """The Monday this run is for: today if it's Monday before 8 AM ET, else the next one."""
    now = now or datetime.datetime.now(ET)
    d = now.date()
    if d.weekday() == 0 and now.hour < 8:
        return d
    return d + datetime.timedelta(days=(7 - d.weekday()) % 7 or 7)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", help="use a saved Basketball Reference page")
    ap.add_argument("--standings", help="use a saved ESPN standings JSON")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--schedule", action="store_true", help="kit dated next Monday + regenerate schedule.json, SCHEDULE.md, kits index")
    ap.add_argument("--outdir")
    a = ap.parse_args(argv)
    page = open(a.html, encoding="utf-8", errors="replace").read() if a.html else fetch()
    stats = parse(page)
    standings = parse_standings(json.load(open(a.standings, encoding="utf-8")) if a.standings else fetch_standings())
    ledger = mk.load("content/ledger.json")
    rows, source = status_lines(stats, ledger, standings)
    date = next_monday().isoformat() if a.schedule else a.date
    as_of = datetime.date.today().strftime("%b %-d, %Y")
    if a.dry:
        for r in rows:
            print(f"{r['id']:>3} {r['p']:>3}%  {r['claim']}: {r['status_line']}")
        return rows
    kit, out = mk.build_ledger_kit(rows, as_of, date, outdir=a.outdir, source_text=source + " " + as_of)
    print(os.path.relpath(out, ROOT))
    if a.schedule:
        import make_schedule
        make_schedule.main()
        subprocess.run([sys.executable, os.path.join(HERE, "kits_index.py")], check=True)
    return rows


if __name__ == "__main__":
    main()
