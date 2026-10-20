"""The 644 and players search hide rows with the `hidden` attribute. Row styles set display:flex,
which beats the browser's own [hidden] rule, so the site stylesheet must restore it."""
import os
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class FilterCss(unittest.TestCase):
    def test_hidden_rows_stay_hidden(self):
        css = open(os.path.join(ROOT, "assets", "site.css"), encoding="utf-8").read()
        self.assertIn("[hidden]{display:none!important}", css)


if __name__ == "__main__":
    unittest.main()
