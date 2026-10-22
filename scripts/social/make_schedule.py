#!/usr/bin/env python3
"""The posting schedule: "this post goes on this platform at this time".

  python3 scripts/social/make_schedule.py

Edit PLAN below (times are US Eastern), run this, commit. Writes:
  social/schedule.json   what the site's cron reads (UTC times); every row in it is approved
  social/SCHEDULE.md     the same thing as a table to read

Checks every row: the kit exists, the platform is known, the post fits that platform.
"""
import datetime
import json
import os
import sys
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import make_kit as mk  # noqa: E402

ET = ZoneInfo("America/New_York")
PLATFORMS = ["x", "bluesky", "threads", "instagram"]
NAMES = {"x": "X", "bluesky": "Bluesky", "threads": "Threads", "instagram": "Instagram"}

# (date, time ET, platforms, kit id).
# Articles: one a day at noon (Predictions, The 30, then the Deep Dives). Player of the day: The 644 from #1 down, every day at 6 PM.
ALL = ["x", "bluesky", "threads", "instagram"]
PLAN = [
    ("2026-10-22", "12:00", ALL, "2026-10-21-article-predictions"),
    ("2026-10-23", "12:00", ALL, "2026-10-21-edition-the30"),
    ("2026-10-24", "12:00", ALL, "2026-10-20-article-kawhi"),
    ("2026-10-25", "12:00", ALL, "2026-10-20-article-duren"),
    ("2026-10-26", "12:00", ALL, "2026-10-20-article-jokic"),
    ("2026-10-27", "12:00", ALL, "2026-10-20-article-queta"),
    ("2026-10-28", "12:00", ALL, "2026-10-20-article-morant"),
    ("2026-10-22", "18:00", ALL, "2026-10-22-player-nikola-jokic"),
    ("2026-10-23", "18:00", ALL, "2026-10-23-player-shai-gilgeous-alexander"),
    ("2026-10-24", "18:00", ALL, "2026-10-24-player-victor-wembanyama"),
    ("2026-10-25", "18:00", ALL, "2026-10-25-player-giannis-antetokounmpo"),
    ("2026-10-26", "18:00", ALL, "2026-10-26-player-luka-doncic"),
    ("2026-10-27", "18:00", ALL, "2026-10-27-player-kawhi-leonard"),
    ("2026-10-28", "18:00", ALL, "2026-10-28-player-cade-cunningham"),
    ("2026-10-29", "18:00", ALL, "2026-10-29-player-karl-anthony-towns"),
    ("2026-10-30", "18:00", ALL, "2026-10-30-player-donovan-mitchell"),
    ("2026-10-31", "18:00", ALL, "2026-10-31-player-tyrese-maxey"),
    ("2026-11-01", "18:00", ALL, "2026-11-01-player-lamelo-ball"),
    ("2026-11-02", "18:00", ALL, "2026-11-02-player-chet-holmgren"),
    ("2026-11-03", "18:00", ALL, "2026-11-03-player-stephen-curry"),
    ("2026-11-04", "18:00", ALL, "2026-11-04-player-jalen-duren"),
    ("2026-11-05", "18:00", ALL, "2026-11-05-player-anthony-edwards"),
]


def main():
    rows, md = [], ["# Posting schedule", "", "Times are US Eastern. Every row here posts on its own; nothing to approve.",
                    "To change it, ask Claude. Source: `scripts/social/make_schedule.py`.", "",
                    "| When (ET) | Platform | Post | First line |", "|---|---|---|---|"]
    for day, hm, platforms, kit_id in PLAN:
        kit_path = os.path.join(ROOT, "social", "kits", kit_id, "kit.json")
        if not os.path.exists(kit_path):
            sys.exit(f"missing kit: {kit_id}")
        kit = json.load(open(kit_path, encoding="utf-8"))
        mk.check_limits(kit)
        local = datetime.datetime.fromisoformat(f"{day}T{hm}").replace(tzinfo=ET)
        at = local.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        first = (kit.get("x_thread") or [kit.get("threads", "")])[0].replace("|", "/")
        for p in platforms:
            if p not in PLATFORMS:
                sys.exit(f"unknown platform: {p}")
            rows.append({"at": at, "platform": p, "kit": kit_id})
            md.append(f"| {local.strftime('%a %b %-d, %-I:%M %p')} | {NAMES[p]} | {kit['title']} | {first[:90]}… |")
    with open(os.path.join(ROOT, "social", "schedule.json"), "w", encoding="utf-8") as f:
        json.dump({"timezone_note": "times are UTC; SCHEDULE.md shows Eastern", "posts": rows}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(os.path.join(ROOT, "social", "SCHEDULE.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    print(f"schedule: {len(rows)} posts")


if __name__ == "__main__":
    main()
