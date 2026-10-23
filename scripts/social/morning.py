#!/usr/bin/env python3
"""The morning brief for whoever writes today's posts (a Claude routine, or a person).

  python3 scripts/social/morning.py                 # today, as JSON on stdout
  python3 scripts/social/morning.py --date 2026-10-23

Prints one JSON object:
  date                 today's civil date (ET)
  last_night           every finished game from yesterday: score, and the top lines by Game Score
  pick                 the player of the day the site will choose (best Game Score among players in The 644,
                       needs a Game Score of 20 or more), with his full 644 record and last season's averages
  candidates           the next four lines, same shape, in case the writer prefers another angle
  tonight              every game today: tip-off in ET, each side's best player in The 644 (rank, score),
                       TORQUE rank/score/projected wins for both teams, and whether the site calls it marquee
  tiers                The 644's tier names, by tier number

Nothing here posts. It only reads ESPN's public JSON and the repo's data, so every number in a post
can be traced to this brief. Writers: use only numbers that appear here.
"""
import argparse
import datetime
import json
import os
import re
import sys
import unicodedata
import urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ET = ZoneInfo("America/New_York")
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
MIN_GAME_SCORE = 20


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "thegravityreport.com morning brief"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def norm(n):
    n = n.replace("ё", "e").replace("Ё", "E")
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"[^a-z ]", "", n)
    return re.sub(r"\s+(jr|sr|ii|iii|iv)$", "", n).strip()


def game_score(L):
    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0
    def split(v):
        a, b = (str(v or "0-0").split("-") + ["0"])[:2]
        return num(a), num(b)
    fg, fga = split(L.get("FG")); ft, fta = split(L.get("FT"))
    return (num(L.get("PTS")) + 0.4 * fg - 0.7 * fga - 0.4 * (fta - ft) + 0.7 * num(L.get("OREB")) + 0.3 * num(L.get("DREB"))
            + num(L.get("STL")) + 0.7 * num(L.get("AST")) + 0.7 * num(L.get("BLK")) - 0.4 * num(L.get("PF")) - num(L.get("TO")))


def et_time(iso):
    t = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET)
    return t.strftime("%-I:%M %p ET")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.datetime.now(ET).date().isoformat())
    a = ap.parse_args()
    today = datetime.date.fromisoformat(a.date)
    yday = today - datetime.timedelta(days=1)

    t644 = load("content/the644.json")
    idx = {p["n"]: p for p in load("players/index.json")["players"]}
    rosters = load("content/rosters-2026-10.json")["teams"] if os.path.exists(os.path.join(ROOT, "content/rosters-2026-10.json")) else {}
    team_of = {n: code for code, names in rosters.items() for n in names}
    torque = load("the30/torque-2026-27.json")["teams"]
    tq_by_name = {t["team"]: t for t in torque}
    tq_by_code = {t["code"]: t for t in torque}
    code_alias = {"BKN": "BRK", "CHA": "CHO", "PHX": "PHO"}
    tiers = t644["TIERS"]

    def record(p):
        code = team_of.get(p["n"], p["t"])
        tq = tq_by_code.get(code_alias.get(code, code))
        return {
            "name": p["n"], "slug": idx.get(p["n"], {}).get("slug"), "rank": p["r"], "score": p["s"], "tier": p["tier"],
            "tier_name": tiers.get(str(p["tier"])), "age": p.get("a"), "position": p.get("p"), "rookie": bool(p.get("rk")),
            "team_code": code, "team": tq["team"] if tq else None, "bpm": p.get("b"), "true_shooting": p.get("ts"),
            "usage": p.get("us"), "games": p.get("g"), "mpg": p.get("mpg"), "pts_per_game": p.get("pp"),
            "reb_per_game": p.get("rp"), "ast_per_game": p.get("ap"), "fg3_pct": p.get("f3"), "ft_pct": p.get("ft"),
        }

    by_name = {norm(p["n"]): p for p in t644["players"]}

    # last night
    sb = fetch(f"{ESPN}/scoreboard?dates={yday.strftime('%Y%m%d')}")
    games, lines = [], []
    for e in sb.get("events", []):
        if not e["status"]["type"].get("completed"):
            continue
        s = fetch(f"{ESPN}/summary?event={e['id']}")
        comp = s["header"]["competitions"][0]
        g = {"id": e["id"], "name": e["name"], "score": {c["team"]["abbreviation"]: c.get("score") for c in comp["competitors"]},
             "winner": next((c["team"]["displayName"] for c in comp["competitors"] if c.get("winner")), None), "lines": []}
        for team in s["boxscore"]["players"]:
            st = team["statistics"][0]
            me = next(c for c in comp["competitors"] if c["team"]["id"] == team["team"]["id"])
            opp = next(c for c in comp["competitors"] if c["team"]["id"] != team["team"]["id"])
            for ath in st["athletes"]:
                if not ath.get("stats"):
                    continue
                L = dict(zip(st["names"], ath["stats"]))
                if not L.get("MIN") or L["MIN"] in ("0", ""):
                    continue
                gs = round(game_score(L), 1)
                p = by_name.get(norm(ath["athlete"]["displayName"]))
                row = {"player": ath["athlete"]["displayName"], "in_644": bool(p), "game_score": gs, "line": L,
                       "team": me["team"]["displayName"], "opponent": opp["team"]["displayName"], "won": bool(me.get("winner")),
                       "final": f"{me['score']}–{opp['score']}" if me.get("winner") else f"{opp['score']}–{me['score']}", "event": e["id"]}
                if p:
                    row["record"] = record(p)
                g["lines"].append(row); lines.append(row)
        g["lines"] = sorted(g["lines"], key=lambda r: -r["game_score"])[:3]
        games.append(g)
    ranked = sorted((r for r in lines if r["in_644"]), key=lambda r: -r["game_score"])
    pick = ranked[0] if ranked and ranked[0]["game_score"] >= MIN_GAME_SCORE else None

    # tonight
    sb2 = fetch(f"{ESPN}/scoreboard?dates={today.strftime('%Y%m%d')}")
    best = {}
    for p in sorted(t644["players"], key=lambda p: p["r"]):
        code = team_of.get(p["n"])
        if code and code not in best:
            best[code] = record(p)
    tonight = []
    for e in sb2.get("events", []):
        comp = e["competitions"][0]
        home = next(c for c in comp["competitors"] if c["homeAway"] == "home")
        away = next(c for c in comp["competitors"] if c["homeAway"] == "away")
        def side(c):
            code = {"GS": "GSW", "NO": "NOP", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}.get(c["team"]["abbreviation"], c["team"]["abbreviation"])
            tq = tq_by_name.get(c["team"]["displayName"])
            return {"team": c["team"]["displayName"], "short": c["team"]["name"], "best": best.get(code),
                    "torque": {"rank": tq["rank"], "score": tq["torque"], "projected_wins": tq["wins"]} if tq else None}
        h, aw = side(home), side(away)
        marquee = bool(h["best"] and aw["best"] and ((h["best"]["rank"] <= 10 and aw["best"]["rank"] <= 10)
                       or (h["torque"] and aw["torque"] and h["torque"]["rank"] <= 6 and aw["torque"]["rank"] <= 6)))
        tonight.append({"id": e["id"], "name": e["name"], "tip_et": et_time(e["date"]), "home": h, "away": aw, "marquee": marquee,
                        "status": e["status"]["type"]["name"]})
    tonight.sort(key=lambda g: (g["home"]["best"]["rank"] if g["home"]["best"] else 400) + (g["away"]["best"]["rank"] if g["away"]["best"] else 400))

    json.dump({"date": today.isoformat(), "last_night": games, "pick": pick, "candidates": ranked[1:5], "tonight": tonight, "tiers": tiers},
              sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main()
