#!/usr/bin/env python3
"""The posting schedule: "this post goes on this platform at this time".

  python3 scripts/social/make_schedule.py

Edit PLAN below (times are US Eastern), run this, commit. Writes:
  social/schedule.json   what the site's cron reads (UTC times); every row in it is approved
  social/SCHEDULE.md     the same thing as a table to read, plus the list of recurring series

Checks every row: the kit exists, the platform is known, the post fits that platform.

Recurring series that are pre-rendered as kits (The 644 on your team, From the archive, the Monday
ledger tracker) are generated into PLAN here. Series the Worker writes on its own (player of the day,
Beating the projection, Best games of the week, Who's higher?) never appear in schedule.json; they
are listed in SERIES below so SCHEDULE.md documents all of them in one place.
"""
import datetime
import hashlib
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
KINDS = {"player": "Player of the day", "article": "Deep Dive", "edition": "Edition", "the30": "The 30",
         "team": "The 644 on your team", "ledger": "Is the model winning?", "archive": "From the archive"}

# (date, time ET, platforms, kit id[, series]).
# Articles we wrote: one a day at noon (Predictions, The 30, then the Deep Dives).
ALL = ["x", "bluesky", "threads", "instagram"]
PLAN = [
    # Player of the day is automatic (last night's best game, 10 AM ET). Rows here override a day by hand.
    # Oct 22: X was connected in the evening, so its two posts went out then (Bluesky had them in the morning).
    ("2026-10-22", "10:00", ["bluesky", "threads", "instagram"], "2026-10-22-player-anthony-edwards"),
    ("2026-10-22", "20:10", ["x"], "2026-10-22-player-anthony-edwards"),
    ("2026-10-22", "12:00", ["bluesky", "threads", "instagram"], "2026-10-21-article-predictions"),
    ("2026-10-22", "20:12", ["x"], "2026-10-21-article-predictions"),
    ("2026-10-23", "12:00", ALL, "2026-10-21-edition-the30"),
    ("2026-10-24", "12:00", ALL, "2026-10-20-article-kawhi"),
    ("2026-10-25", "12:00", ALL, "2026-10-20-article-duren"),
    ("2026-10-26", "12:00", ALL, "2026-10-20-article-jokic"),
    ("2026-10-27", "12:00", ALL, "2026-10-20-article-queta"),
    ("2026-10-28", "12:00", ALL, "2026-10-20-article-morant"),
]

# "The 644 on your team": one team a day at 6 PM ET for 30 days, in The 30's TORQUE order.
# Kits: python3 scripts/social/make_kit.py team all --date 2026-10-24
# To turn the series off: set TEAM644_START = None (or set social_settings series_team644 = 0 on the site).
TEAM644_START = "2026-10-22"   # Oct 22: a late first post (9 PM ET) the night the Thunder opened at home
TEAM644_TIME = "18:00"
TEAM644_FIRST_TIME = "21:00"


def team644_rows():
    """One team a day in TORQUE order. Kits are named by the date they were rendered (`<date>-team-<code>`);
    the posting date comes from here, so moving the start never needs new kits."""
    if not TEAM644_START:
        return []
    teams = sorted(mk.load("the30/torque-2026-27.json")["teams"], key=lambda x: x["rank"])
    d0 = datetime.date.fromisoformat(TEAM644_START)
    kits = os.listdir(os.path.join(ROOT, "social", "kits"))
    rows = []
    for i, x in enumerate(teams):
        code = mk.FROM_TORQUE.get(x["code"], x["code"]).lower()
        kit_id = sorted(k for k in kits if k.endswith(f"-team-{code}"))[-1]
        day = (d0 + datetime.timedelta(days=i)).isoformat()
        rows.append((day, TEAM644_FIRST_TIME if i == 0 else TEAM644_TIME, ALL, kit_id, "team644"))
    return rows


# "Is the model winning?": Mondays 9 AM ET. scripts/social/ledger_tracker.py --schedule writes the kit
# `<monday>-ledger-tracker`; every such kit is picked up here. Set TRACKER_ON = False to stop the series.
TRACKER_ON = True
TRACKER_TIME = "09:00"


def tracker_rows():
    if not TRACKER_ON:
        return []
    kits = os.path.join(ROOT, "social", "kits")
    rows = []
    for d in sorted(os.listdir(kits)):
        if d.endswith("-ledger-tracker") and os.path.exists(os.path.join(kits, d, "kit.json")):
            rows.append((d[:10], TRACKER_TIME, [p for p in ALL if p != "instagram"], d, "tracker"))
    return rows


# "From the archive": Sundays at noon ET, one Deep Dive a week in Deep Dive order, led by a different
# line than the first time round (make_kit.py article all --date <first Sunday>: tracking frame, angle 2).
# Set ARCHIVE_START = None to stop the series.
ARCHIVE_START = "2026-11-01"
ARCHIVE_TIME = "12:00"


def archive_rows():
    if not ARCHIVE_START:
        return []
    d0 = datetime.date.fromisoformat(ARCHIVE_START)
    rows = []
    for i, slug in enumerate(mk.archive_articles()):
        day = (d0 + datetime.timedelta(days=7 * i)).isoformat()
        rows.append((day, ARCHIVE_TIME, ALL, f"{day}-article-{slug}", "archive"))
    return rows


# Every recurring series, for the "Recurring series" section of SCHEDULE.md.
# (name, when, source, how to turn it off)
SERIES = [
    ("Player of the day", "Daily, 10 AM ET (picked each morning from last night's box scores)",
     "Worker, automatic (social/potd.js)", "`potd_on = 0` in social_settings (admin page toggle)"),
    ("The 644 on your team", "Daily, 6 PM ET, one team a day for 30 days from Sat Oct 24, 2026 (TORQUE order)",
     "schedule.json (kits `<date>-team-<code>`, make_kit.py team all)",
     "`series_team644 = 0` in social_settings, or TEAM644_START = None in make_schedule.py"),
    ("Is the model winning?", "Mondays, 9 AM ET, from Mon Oct 26, 2026 (each week's kit is written Sunday night / Monday morning)",
     "schedule.json (kit `<monday>-ledger-tracker`, written weekly by `python3 scripts/social/ledger_tracker.py --schedule`, "
     "then commit + push; Basketball Reference can't be fetched from the Worker)",
     "`series_tracker = 0` in social_settings, or TRACKER_ON = False in make_schedule.py"),
    ("Beating the projection", "Wednesdays, 1 PM ET (skipped, and marked, while teams average under 5 games)",
     "Worker, automatic (social/series.js: ESPN standings vs TORQUE win projections); X, Bluesky, Threads only",
     "`series_pace = 0` in social_settings"),
    ("Best games of the week", "Fridays, 1 PM ET (last Friday through Thursday)",
     "Worker, automatic (social/series.js: top 5 Game Scores among players in The 644 from ESPN box scores, cached per day; "
     "X, Bluesky, Threads only)", "`series_best = 0` in social_settings"),
    ("Who's higher?", "Saturdays, 11 AM ET; the answer Sundays, 11 AM ET",
     "Worker, automatic (social/series.js: two adjacent ranks in the top 100 of The 644, rotating by week; an X poll, "
     "'reply with your pick' elsewhere; the answer post names both ranks and scores)", "`series_poll = 0` in social_settings"),
    ("From the archive", "Sundays, 12 PM ET, one Deep Dive a week from Sun Nov 1, 2026 (Deep Dive order)",
     "schedule.json (kits `<sunday>-article-<slug>`, make_kit.py article all --date 2026-11-01: tracking frame, angle 2)",
     "`series_archive = 0` in social_settings, or ARCHIVE_START = None in make_schedule.py"),
    ("Instagram + Threads hand-off (not a post)", "15–30 minutes before any Instagram or Threads row is due",
     "Worker, automatic (social/handoff.js): emails the caption, the images and a 3-line how-to to HANDOFF_TO; the row shows "
     "'Sent to your phone'. The Worker never posts to Instagram or Threads itself.",
     "remove the platform from SOCIAL_MANUAL_PLATFORMS in wrangler.jsonc (then its posts need that platform's API keys)"),
    ("Metrics panel (not a post)", "Weekly, first cron tick of each ISO week",
     "Worker, automatic (social/metrics.js: Bluesky followers from the public API, Threads/Instagram only with tokens, X left blank; "
     "posts sent that week from social_log; shown at the top of /admin/schedule/ when unlocked)", "`series_metrics = 0` in social_settings"),
]


def plan_rows():
    return list(PLAN) + team644_rows() + tracker_rows() + archive_rows()


# Kits removed from the plan after their rows were already queued on the site. A queued row stays
# approved until something cancels it, so each of these gets a skip row on every platform.
RETIRED = [f"{d}-player-{slug}" for d, slug in [
    ("2026-10-23", "shai-gilgeous-alexander"), ("2026-10-24", "victor-wembanyama"), ("2026-10-25", "giannis-antetokounmpo"),
    ("2026-10-26", "luka-doncic"), ("2026-10-27", "kawhi-leonard"), ("2026-10-28", "cade-cunningham"),
    ("2026-10-29", "karl-anthony-towns"), ("2026-10-30", "donovan-mitchell"), ("2026-10-31", "tyrese-maxey"),
    ("2026-11-01", "lamelo-ball"), ("2026-11-02", "chet-holmgren"), ("2026-11-03", "stephen-curry"),
    ("2026-11-04", "jalen-duren"),
]]


def main():
    rows, md = [], ["# Posting schedule", "", "Times are US Eastern. Every row here posts on its own; nothing to approve.",
                    "To change it, ask Claude. Source: `scripts/social/make_schedule.py`.", "",
                    "| When (ET) | Platform | Post | First line |", "|---|---|---|---|"]
    items = sorted(plan_rows(), key=lambda r: (r[0], r[1]))
    # Instagram is posted by hand and rewards one good post over three: on a day with a noon article
    # carousel, the 6 PM team post skips Instagram.
    ig_days = {it[0] for it in items if "instagram" in it[2] and (len(it) < 5 or it[4] in (None, "archive"))}
    for item in items:
        day, hm, platforms, kit_id = item[:4]
        series = item[4] if len(item) > 4 else None
        if series == "team644" and day in ig_days:
            platforms = [p for p in platforms if p != "instagram"]
        kit_path = os.path.join(ROOT, "social", "kits", kit_id, "kit.json")
        if not os.path.exists(kit_path):
            sys.exit(f"missing kit: {kit_id}")
        raw = open(kit_path, "rb").read()
        kit = json.loads(raw)
        mk.check_limits(kit)
        version = hashlib.sha1(raw).hexdigest()[:10]  # a re-rendered kit (new numbers) refreshes its queued post
        local = datetime.datetime.fromisoformat(f"{day}T{hm}").replace(tzinfo=ET)
        at = local.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        first = (kit.get("x_thread") or [kit.get("threads", "")])[0].replace("|", "/").replace("\n", " ")
        for p in platforms:
            if p not in PLATFORMS:
                sys.exit(f"unknown platform: {p}")
            row = {"at": at, "platform": p, "kit": kit_id, "v": version}
            if series:
                row["series"] = series
            rows.append(row)
            md.append(f"| {local.strftime('%a %b %-d, %-I:%M %p')} | {NAMES[p]} | {kit['title']} | {first[:90]}… |")
    md += ["", "## Recurring series", "",
           "Each series has an off switch in `social_settings` (set it to `0`); the Worker checks it every run.",
           "Series that come from schedule.json are also removed by editing `scripts/social/make_schedule.py` and rerunning it.", "",
           "| Series | When | Comes from | Turn it off |", "|---|---|---|---|"]
    for name, when, source, off in SERIES:
        md.append(f"| {name} | {when} | {source} | {off} |")
    for kit_id in RETIRED:
        for p in PLATFORMS:
            rows.append({"at": f"{kit_id[:10]}T22:00:00Z", "platform": p, "kit": kit_id, "skip": True})
    with open(os.path.join(ROOT, "social", "schedule.json"), "w", encoding="utf-8") as f:
        json.dump({"timezone_note": "times are UTC; SCHEDULE.md shows Eastern", "posts": rows}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(os.path.join(ROOT, "social", "SCHEDULE.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    print(f"schedule: {len(rows)} posts")


if __name__ == "__main__":
    main()
