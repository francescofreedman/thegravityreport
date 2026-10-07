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


if __name__ == "__main__":
    unittest.main()
