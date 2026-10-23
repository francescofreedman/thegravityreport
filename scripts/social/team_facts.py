#!/usr/bin/env python3
"""Per-team facts from The 644 and TORQUE, for writing team posts (social/copy/<kit>.md).

  python3 scripts/social/team_facts.py          all 30 teams
  python3 scripts/social/team_facts.py OKC TOR  some teams

Everything printed is computed from content/the644.json and the30/torque-2026-27.json, so a
post can cite it; the number guard still checks each number against the kit's own source.
Comparative lines ("no other team", "second-youngest") carry the league rank next to the value.
"""
import json
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_kit as mk
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
TORQUE_CODE = {"CHA": "CHO", "PHX": "PHO", "BKN": "BRK"}


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def rank_desc(values, code):
    """1 = highest value in the league; ties share the best rank."""
    v = values[code]
    return 1 + sum(1 for c, x in values.items() if x > v)


def rank_asc(values, code):
    v = values[code]
    return 1 + sum(1 for c, x in values.items() if x < v)


def main(argv):
    t644 = load("content/the644.json")
    tiers = t644["TIERS"]
    players = t644["players"]
    tq = {t["code"]: t for t in load("the30/torque-2026-27.json")["teams"]}
    codes = sorted({p["t"] for p in players})
    by_team = {c: mk.team_players(c) for c in codes}  # current rosters (content/rosters-2026-10.json), not July's

    # league-wide tables for the comparative lines
    top50 = {c: sum(1 for p in ps if p["r"] <= 50) for c, ps in by_team.items()}
    top100 = {c: sum(1 for p in ps if p["r"] <= 100) for c, ps in by_team.items()}
    top150 = {c: sum(1 for p in ps if p["r"] <= 150) for c, ps in by_team.items()}
    top200 = {c: sum(1 for p in ps if p["r"] <= 200) for c, ps in by_team.items()}
    def ages(ps):  # rookies have no age in The 644; age facts use the players whose age is known
        return [p["a"] for p in ps if isinstance(p["a"], int)]
    avg_age8 = {c: sum(ages(ps[:8])) / len(ages(ps[:8])) for c, ps in by_team.items()}
    rookies = {c: sum(1 for p in ps if p.get("rk")) for c, ps in by_team.items()}
    rookies8 = {c: sum(1 for p in ps[:8] if p.get("rk")) for c, ps in by_team.items()}
    best_rank = {c: ps[0]["r"] for c, ps in by_team.items()}
    eighth_rank = {c: ps[7]["r"] for c, ps in by_team.items()}
    sum8 = {c: sum(p["s"] for p in ps[:8]) for c, ps in by_team.items()}
    count = {c: len(ps) for c, ps in by_team.items()}
    tier_counts = {c: Counter(p["tier"] for p in ps) for c, ps in by_team.items()}
    top3tier = {c: sum(1 for p in ps if p["tier"] <= 3) for c, ps in by_team.items()}
    gap12 = {c: ps[0]["s"] - ps[1]["s"] for c, ps in by_team.items()}
    gap12_rank = {c: ps[1]["r"] - ps[0]["r"] for c, ps in by_team.items()}
    change = {c: tq[TORQUE_CODE.get(c, c)]["change"] for c in codes}
    move = {c: tq[TORQUE_CODE.get(c, c)]["rank_july"] - tq[TORQUE_CODE.get(c, c)]["rank"] for c in codes}
    oldest8 = {c: max(ages(ps[:8])) for c, ps in by_team.items()}
    youngest8 = {c: min(ages(ps[:8])) for c, ps in by_team.items()}
    under25 = {c: sum(1 for a in ages(ps[:8]) if a <= 24) for c, ps in by_team.items()}
    over30 = {c: sum(1 for a in ages(ps[:8]) if a >= 30) for c, ps in by_team.items()}
    noage8 = {c: 8 - len(ages(ps[:8])) for c, ps in by_team.items()}

    want = [c.upper() for c in argv] or sorted(codes, key=lambda c: tq[TORQUE_CODE.get(c, c)]["rank"])
    for c in want:
        ps = by_team[c]
        t = tq[TORQUE_CODE.get(c, c)]
        top = ps[:8]
        print(f"=== {c} {t['team']}  ({count[c]} players in The 644)")
        print(f"TORQUE: rank {t['rank']} (July {t['rank_july']}, moved {move[c]:+d} places; league rank of the move {rank_desc(move, c)}), "
              f"score {t['torque']} (July {t['torque_july']}, change {t['change']:+.1f}; league rank of the change {rank_desc(change, c)}), "
              f"wins {t['wins']} (July {t['wins_july']})")
        print("TORQUE top3: " + "; ".join(f"{x['player']} force {x['force']} min {x['min']}" for x in t["top3"]))
        print("Top 8: " + " | ".join(
            f"#{p['r']} {p['n']} {p['s']:.1f} ({p['p']}, {p['a'] if isinstance(p['a'], int) else 'rookie'}y, tier {p['tier']} {tiers[str(p['tier'])]}"
            + (f", rookie pick {p['pk']}" if p.get("rk") else "") + ")" for p in top))
        print(f"Best player: #{top[0]['r']} {top[0]['n']} {top[0]['s']:.1f}, tier {top[0]['tier']} ({tiers[str(top[0]['tier'])]}); "
              f"league rank of best-player rank: {rank_asc(best_rank, c)}")
        print(f"Gap #1 to #2 on the team: {gap12[c]:.1f} points, {gap12_rank[c]} places (league rank of the points gap: {rank_desc(gap12, c)})")
        print(f"Eighth-best player ranks #{eighth_rank[c]} (league rank of the eighth-best: {rank_asc(eighth_rank, c)}); "
              f"sum of top-8 scores {sum8[c]:.1f} (league rank {rank_desc(sum8, c)})")
        print(f"In the top 50: {top50[c]} (league rank {rank_desc(top50, c)}); top 100: {top100[c]} (rank {rank_desc(top100, c)}); "
              f"top 150: {top150[c]} (rank {rank_desc(top150, c)}); top 200: {top200[c]} (rank {rank_desc(top200, c)})")
        print(f"Tiers 1-3 (All-Star or better): {top3tier[c]} (league rank {rank_desc(top3tier, c)}); "
              f"tier counts: " + ", ".join(f"T{k} {v}" for k, v in sorted(tier_counts[c].items())))
        print(f"Average age of the top 8 ({8 - noage8[c]} with a known age; rookies have none): {avg_age8[c]:.1f} "
              f"(league rank oldest {rank_desc(avg_age8, c)}, youngest {rank_asc(avg_age8, c)}); "
              f"oldest {oldest8[c]}, youngest {youngest8[c]}; 24 or under {under25[c]} (rank {rank_desc(under25, c)}); "
              f"30 or older {over30[c]} (rank {rank_desc(over30, c)})")
        print(f"Rookies: {rookies[c]} on the roster (league rank {rank_desc(rookies, c)}), {rookies8[c]} in the top 8"
              + (": " + ", ".join(f"#{p['r']} {p['n']} (pick {p['pk']})" for p in ps if p.get("rk")) if rookies[c] else ""))
        aged = [p for p in top if isinstance(p["a"], int)]
        oldest = max(aged, key=lambda p: p["a"])
        youngest = min(aged, key=lambda p: p["a"])
        print(f"Oldest in the top 8: {oldest['n']} {oldest['a']}; youngest: {youngest['n']} {youngest['a']}")
        rest = ps[8:]
        if rest:
            print(f"Rest of roster: #{rest[0]['r']} {rest[0]['n']} {rest[0]['s']:.1f} down to #{rest[-1]['r']} {rest[-1]['n']} {rest[-1]['s']:.1f}")
        print()

    print("=== League tables (for comparative claims)")
    for label, table, best_is_high in [("top 50", top50, True), ("top 100", top100, True), ("top 150", top150, True),
                                       ("avg age top 8", avg_age8, True), ("rookies", rookies, True),
                                       ("TORQUE change Jul->Oct", change, True), ("TORQUE places moved Jul->Oct", move, True),
                                       ("eighth-best rank", eighth_rank, False), ("gap #1-#2 points", gap12, True),
                                       ("tiers 1-3", top3tier, True), ("best-player rank", best_rank, False)]:
        order = sorted(table.items(), key=lambda kv: (-kv[1] if best_is_high else kv[1], kv[0]))
        print(f"{label}: " + ", ".join(f"{c} {v:.1f}" if isinstance(v, float) else f"{c} {v}" for c, v in order))


if __name__ == "__main__":
    main(sys.argv[1:])
