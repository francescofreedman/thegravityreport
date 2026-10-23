"""Tests for the post-kit generator. Run: python3 -m unittest discover -s tests"""
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "social"))
import make_kit as mk  # noqa: E402


class GuardTests(unittest.TestCase):
    def test_accepts_numbers_in_source(self):
        mk.guard(["He shot .629 and played 65 games."], "ts 0.629 gp 65")

    def test_rejects_invented_number(self):
        with self.assertRaises(mk.NumberGuardError):
            mk.guard(["He shot .640 last season."], "ts 0.629")

    def test_urls_are_not_claims(self):
        mk.guard(["Read it: https://thegravityreport.com/notes/x123/"], "")

    def test_number_formats_match(self):
        mk.guard(["1,926 minutes, +5.0 BPM, −1.7 in the playoffs"], "1926 5.0 -1.7")


class LimitTests(unittest.TestCase):
    def test_x_counts_links_as_23(self):
        post = "a" * 250 + " https://thegravityreport.com/a/very/long/path/that/would/otherwise/overflow/"
        self.assertEqual(mk.x_len(post), 250 + 1 + 23)

    def test_over_limit_raises(self):
        kit = {"x_thread": ["a" * 281], "bluesky_thread": ["ok"], "threads": "ok", "instagram_caption": "ok"}
        with self.assertRaises(ValueError):
            mk.check_limits(kit)


class KitTests(unittest.TestCase):
    def test_article_kits_build_within_limits(self):
        for slug in ["kawhi", "queta", "morant"]:
            with tempfile.TemporaryDirectory() as d:
                kit, _ = mk.build_article_kit(slug, "2026-10-07", outdir=d, images=False)
                mk.check_limits(kit)
                self.assertTrue(os.path.exists(os.path.join(d, "x_thread.txt")))
                self.assertIn("thegravityreport.com", kit["x_thread"][-1])
                self.assertIn("Link in bio", kit["instagram_caption"])
                self.assertTrue(kit["reddit"]["subreddit"])

    def test_tracking_frame_dates_the_piece_and_never_says_new(self):
        arts = {a["slug"]: a for a in json.load(open(os.path.join(ROOT, "content", "articles.json"), encoding="utf-8"))}
        for slug in mk.SUBJECTS:
            with tempfile.TemporaryDirectory() as d:
                kit, _ = mk.build_article_kit(slug, "2026-10-21", outdir=d, images=False, frame="tracking")
                when = mk.pub_date(arts[slug]["date"])
                self.assertIn(when, kit["x_thread"][0])
                self.assertIn(when, kit["x_thread"][-1])
                self.assertIn(when, kit["instagram_caption"])
                allt = " ".join(kit["x_thread"] + [kit["threads"], kit["instagram_caption"], kit["reddit"]["markdown"]])
                for banned in ["new article", "out now", "just published", "today"]:
                    self.assertNotIn(banned, allt.lower())
                if not arts[slug].get("ledger"):
                    self.assertNotIn("Every call", allt)

    def test_archive_angle_leads_with_the_first_point_and_dates_the_piece(self):
        arts = {a["slug"]: a for a in json.load(open(os.path.join(ROOT, "content", "articles.json"), encoding="utf-8"))}
        self.assertEqual(mk.archive_articles(), ["morant", "queta", "duren", "kawhi", "jokic"])
        for slug in mk.archive_articles():
            with tempfile.TemporaryDirectory() as d:
                kit, _ = mk.build_article_kit(slug, "2026-11-01", outdir=d, images=False, frame="tracking", angle=2)
                s, when = arts[slug]["social"], mk.pub_date(arts[slug]["date"])
                self.assertEqual(kit["x_thread"][0], s["points"][0], "the first point leads")
                self.assertIn(s["hook"], kit["x_thread"], "the hook still appears")
                self.assertIn(f"From the archive: we published this on {when}", kit["x_thread"][-1])
                self.assertTrue(kit["threads"].startswith(s["points"][0]))
                self.assertIn(when, kit["threads"])
                self.assertEqual(kit["series"], "archive")
                self.assertEqual(kit["angle"], 2)
                for banned in ["new article", "out now", "just published", "today"]:
                    self.assertNotIn(banned, " ".join(kit["x_thread"]).lower())
        with tempfile.TemporaryDirectory() as d:
            kit, _ = mk.build_article_kit("kawhi", "2026-11-01", outdir=d, images=False, frame="tracking")
            self.assertNotIn("series", kit, "angle 1 is the plain tracking frame")

    def test_archive_sundays(self):
        import datetime
        import make_schedule as ms
        rows = ms.archive_rows()
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0][:2], ("2026-11-01", "12:00"))
        self.assertEqual(rows[0][3], "2026-11-01-article-morant")
        for day, hm, platforms, kit_id, series in rows:
            self.assertEqual(datetime.date.fromisoformat(day).weekday(), 6, f"{kit_id} is not a Sunday")
            self.assertEqual(series, "archive")
            self.assertTrue(os.path.exists(os.path.join(ROOT, "social", "kits", kit_id, "kit.json")), kit_id)
            self.assertEqual(json.load(open(os.path.join(ROOT, "social", "kits", kit_id, "kit.json"), encoding="utf-8"))["angle"], 2)

    def test_player_kits_build_for_top_and_rookie(self):
        for slug in ["nikola-jokic", "cameron-boozer", "jalen-duren"]:
            with tempfile.TemporaryDirectory() as d:
                kit, _ = mk.build_player_kit(slug, "2026-10-07", outdir=d, images=False)
                mk.check_limits(kit)

    def test_deterministic(self):
        outs = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as d:
                mk.build_article_kit("kawhi", "2026-10-07", outdir=d, images=False)
                outs.append(open(os.path.join(d, "kit.json"), encoding="utf-8").read())
        self.assertEqual(outs[0], outs[1])

    def test_every_player_kit_passes_guard(self):
        idx = json.load(open(os.path.join(ROOT, "players", "index.json"), encoding="utf-8"))["players"]
        for p in idx[:150]:
            with tempfile.TemporaryDirectory() as d:
                mk.build_player_kit(p["slug"], "2026-10-07", outdir=d, images=False)


class TeamKitTests(unittest.TestCase):
    """"The 644 on your team": every team builds, passes the number guard and fits every platform."""

    def test_every_team_kit_builds(self):
        now = mk.current_rosters() or {}
        listed = {}  # player -> the team whose kit lists him
        for code in mk.SUBREDDITS:
            with tempfile.TemporaryDirectory() as d:
                kit, _ = mk.build_team_kit(code, "2026-10-24", outdir=d, images=False)
                mk.check_limits(kit)
                self.assertEqual(kit["kind"], "team")
                self.assertEqual(kit["reddit"]["subreddit"], mk.SUBREDDITS[code])
                self.assertIn("50 is a league-average minute", kit["x_thread"][0])
                self.assertIn("/the644/", kit["x_thread"][-1])
                self.assertTrue(os.path.exists(os.path.join(d, "reddit.md")))
                # the top eight by rank on the CURRENT roster (content/rosters-2026-10.json), not The 644's July label
                top = mk.team_players(code)[:8]
                for p in top:  # each with his real rank and score
                    self.assertIn(f"#{p['r']} {p['n']} {p['s']:.1f}", kit["threads"])
                    self.assertIn(f"#{p['r']} {p['n']} {p['s']:.1f}", kit["instagram_caption"])
                    self.assertNotIn(p["n"], listed, f"{p['n']} is listed by both {listed.get(p['n'])} and {code}")
                    listed[p["n"]] = code
                    self.assertEqual(now.get(p["n"], code), code, f"{p['n']} is on {now.get(p['n'])} now, not {code}")

    def test_team_kits_never_name_a_player_who_moved(self):
        """The rendered kits in social/kits (templated or hand-written copy) name no player whose current team differs."""
        now = mk.current_rosters()
        if not now:
            self.skipTest("no content/rosters-2026-10.json")
        names = [p["n"] for p in mk.load("content/the644.json")["players"]]
        kits_dir = os.path.join(ROOT, "social", "kits")
        for kit_id in sorted(os.listdir(kits_dir)):
            if "-team-" not in kit_id:
                continue
            kit = json.load(open(os.path.join(kits_dir, kit_id, "kit.json"), encoding="utf-8"))
            text = " ".join(kit["x_thread"] + [kit["threads"], kit["instagram_caption"]])
            for n in names:
                if n in text and now.get(n) not in (None, kit["team"]):
                    self.fail(f"{kit_id} names {n}, who is on {now[n]} now")

    def test_torque_codes_map_to_644_codes(self):
        for code in ("CHO", "PHO", "BRK"):
            with tempfile.TemporaryDirectory() as d:
                kit, _ = mk.build_team_kit(code, "2026-10-24", outdir=d, images=False)
                self.assertEqual(kit["team"], mk.FROM_TORQUE[code])
        self.assertEqual(mk.team_name("PHX"), "Phoenix Suns")

    def test_schedule_has_thirty_team_days_at_six_pm_et(self):
        import make_schedule as ms
        rows = ms.team644_rows()
        self.assertEqual(len(rows), 30)
        self.assertEqual(rows[0][0], "2026-10-22")
        self.assertEqual(rows[0][3], "2026-10-24-team-okc", "kit names keep their render date; the posting date is the row's")
        self.assertEqual(rows[-1][0], "2026-11-20")
        self.assertEqual(rows[0][1], "21:00", "the first post was a late one the night it was added")
        self.assertEqual({r[1] for r in rows[1:]}, {"18:00"})
        self.assertEqual(len({r[3].rsplit("-", 1)[1] for r in rows}), 30, "every team exactly once")
        for r in rows:
            self.assertTrue(os.path.exists(os.path.join(ROOT, "social", "kits", r[3], "kit.json")), r[3])
        sched = json.load(open(os.path.join(ROOT, "social", "schedule.json"), encoding="utf-8"))
        tagged = [p for p in sched["posts"] if p.get("series") == "team644"]
        self.assertEqual(len([p for p in tagged if p["platform"] in ("x", "bluesky")]), 60)
        # Instagram auto-shares to Threads: no kit has both an Instagram and a Threads row at the same time
        live = [p for p in sched["posts"] if not p.get("skip")]
        both = {(p["kit"], p["at"]) for p in live if p["platform"] == "instagram"} & \
               {(p["kit"], p["at"]) for p in live if p["platform"] == "threads"}
        self.assertEqual(both, set())
        # Instagram: at most one post a day across the whole schedule (it's posted by hand)
        import collections
        per_day = collections.Counter(p["at"][:10] for p in sched["posts"] if p["platform"] == "instagram" and not p.get("skip"))
        self.assertLessEqual(max(n for d, n in per_day.items() if d >= "2026-10-23"), 1)


class TrackerTests(unittest.TestCase):
    """Synthetic Basketball Reference page built from the published 644 CSV (TEST FIXTURE, never published)."""

    def fixture(self):
        import csv
        rows = []
        with open(os.path.join(ROOT, "the644", "the644-2026-07.csv"), encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["is_rookie"] == "True" or not r["mp26"]:
                    continue
                rows.append(
                    f'<tr><td data-stat="name_display"><a>{r["player"]}</a></td><td data-stat="team_name_abbr">{r["team"]}</td>'
                    f'<td data-stat="games">{int(float(r["gp26"]))}</td><td data-stat="mp">{int(float(r["mp26"]))}</td>'
                    f'<td data-stat="ts_pct">{r["ts26"]}</td><td data-stat="usg_pct">{r["usg26"]}</td><td data-stat="bpm">{r["bpm26"]}</td></tr>')
        return '<table id="advanced"><tbody>' + "".join(rows) + "</tbody></table>"

    def standings(self, scale=1):
        """The real ESPN standings fixture (Oct 21, 2026: one game each), optionally with every record multiplied."""
        sys.path.insert(0, os.path.join(ROOT, "scripts", "social"))
        import ledger_tracker as lt
        with open(os.path.join(ROOT, "tests", "fixtures", "espn-standings.json"), encoding="utf-8") as f:
            st = lt.parse_standings(json.load(f))
        return {k: {**v, "w": v["w"] * scale, "l": v["l"] * scale} for k, v in st.items()}

    def test_standings_parse_covers_all_thirty_with_644_codes(self):
        st = self.standings()
        self.assertEqual(len(st), 30)
        for code in mk.SUBREDDITS:
            self.assertIn(code, st, code)
        self.assertEqual(st["OKC"], {"w": 1, "l": 0, "name": "Oklahoma City Thunder"})

    def test_status_lines_and_kit(self):
        import ledger_tracker as lt
        stats = lt.parse(self.fixture())
        self.assertIn("Kawhi Leonard", stats)
        ledger = mk.load("content/ledger.json")
        open_ids = {e["id"] for e in ledger["entries"] if e["status"] == "open"}
        rows, src = lt.status_lines(stats, ledger, self.standings(scale=10))
        self.assertEqual({r["id"] for r in rows}, open_ids, "every open call gets a line")
        by = {r["id"]: r for r in rows}
        self.assertIn("so far", by["K4"]["status_line"])
        self.assertIn("not yet", by["K5"]["status_line"], "a call that is behind says so")
        self.assertIn("graded from the July 2027 edition", by["K1"]["status_line"])
        self.assertTrue(by["K1"]["later"] and by["P3"]["later"] and by["P18"]["later"])
        self.assertEqual(by["P23"]["status_line"], "10-0 so far, a pace of 82 wins (on track)")
        self.assertEqual(by["P25"]["status_line"], "0-10 so far, a pace of 0 wins (behind)")
        self.assertIn("rank correlation", by["E1"]["status_line"])
        self.assertFalse(by["P20"]["later"])
        with tempfile.TemporaryDirectory() as d:
            kit, _ = mk.build_ledger_kit(rows, "Oct 7, 2026", "2026-10-07", outdir=d, images=False, source_text=src + " Oct 7, 2026")
            mk.check_limits(kit)
            allt = " ".join(kit["x_thread"])
            for i in open_ids:
                self.assertIn(f"{i} · ", allt, f"{i} named in the thread")
            self.assertIn("/ledger/", kit["x_thread"][-1])
            self.assertIn("misses included", kit["x_thread"][-1])

    def test_early_season_groups_team_calls(self):
        import ledger_tracker as lt
        rows, _ = lt.status_lines(lt.parse(self.fixture()), mk.load("content/ledger.json"), self.standings())
        by = {r["id"]: r for r in rows}
        self.assertTrue(by["P23"]["later"])
        self.assertIn("too early", by["P23"]["status_line"])
        self.assertTrue(by["E1"]["later"])

    def test_no_games_yet(self):
        import ledger_tracker as lt
        rows, _ = lt.status_lines({}, mk.load("content/ledger.json"))
        for r in rows:
            self.assertTrue(r["status_line"] == "no games yet" or r["later"], r)

    def test_unpublished_bpm_is_said_not_invented(self):
        import ledger_tracker as lt
        page = ('<table id="advanced"><tbody><tr><td data-stat="name_display">Kawhi Leonard</td><td data-stat="games">1</td>'
                '<td data-stat="mp">30</td><td data-stat="ts_pct">.500</td><td data-stat="usg_pct">31.0</td></tr></tbody></table>')
        rows, src = lt.status_lines(lt.parse(page), mk.load("content/ledger.json"))
        by = {r["id"]: r["status_line"] for r in rows}
        self.assertEqual(by["K3"], "Box Plus/Minus not published yet, 30 minutes")
        self.assertIn("31.0%", by["K4"])
        mk.guard([by["K3"], by["K4"]], src)

    def test_team_call_parsing_and_spearman(self):
        import ledger_tracker as lt
        cities = lt.city_codes()
        self.assertEqual(cities["Portland"], "POR")
        code, ok = lt.team_call("Surprise team: Toronto wins 47 or more games", cities)
        self.assertEqual(code, "TOR")
        self.assertTrue(ok(47) and not ok(46))
        code, ok = lt.team_call("Washington under 34.5.", cities)
        self.assertEqual(code, "WAS")
        self.assertTrue(ok(34) and not ok(35))
        self.assertIsNone(lt.team_call("Jokić wins the 2026–27 MVP", cities))
        self.assertAlmostEqual(lt.spearman([(1, 1), (2, 2), (3, 3)]), 1.0)
        self.assertAlmostEqual(lt.spearman([(1, 3), (2, 2), (3, 1)]), -1.0)

    def test_next_monday(self):
        import datetime
        import ledger_tracker as lt
        ET = lt.ET
        self.assertEqual(lt.next_monday(datetime.datetime(2026, 10, 21, 12, tzinfo=ET)), datetime.date(2026, 10, 26))
        self.assertEqual(lt.next_monday(datetime.datetime(2026, 10, 26, 7, tzinfo=ET)), datetime.date(2026, 10, 26))
        self.assertEqual(lt.next_monday(datetime.datetime(2026, 10, 26, 9, tzinfo=ET)), datetime.date(2026, 11, 2))

    def test_schedule_picks_up_tracker_kits_on_mondays_9am(self):
        import make_schedule as ms
        for day, hm, platforms, kit_id, series in ms.tracker_rows():
            self.assertEqual(series, "tracker")
            self.assertEqual(hm, "09:00")
            import datetime
            self.assertEqual(datetime.date.fromisoformat(day).weekday(), 0, f"{kit_id} is not a Monday")


if __name__ == "__main__":
    unittest.main()
