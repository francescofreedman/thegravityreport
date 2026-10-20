"""Native Deep Dives (content/deep/*.md) must keep every number of the LaTeX original they replaced,
and every chart, call and source block must parse."""
import os
import re
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import deep  # noqa: E402

NUM = re.compile(r"\d[\d,]*\.?\d*")


def numbers(text):
    text = re.sub(r"https?://\S+", "", text)
    return {n.rstrip(".,") for n in NUM.findall(text)}


def tex_numbers(slug):
    s = open(os.path.join(ROOT, "papers", slug, f"{slug}.tex"), encoding="utf-8").read()
    s = s[s.index("\\begin{document}"):]
    s = re.sub(r"\\versionline\{[^}]*\}", "", s)
    s = re.sub(r"\\(src|url)\{[^}]*\}(\{[^}]*\})?", "", s)
    s = re.sub(r"\\begin\{tikzpicture\}.*?\\end\{tikzpicture\}", "", s, flags=re.S)
    s = re.sub(r"\\(vspace|enlargethispage|setlength|tabcolsep)\{[^}]*\}(\{[^}]*\})?|\[\d+pt\]|\\\\\[\d+pt\]", "", s)
    s = re.sub(r"\\begin\{tabular\}\{[^}]*\}|\\begin\{enumerate\}\[[^]]*\]", "", s)
    return numbers(s)


class NativeDeepDives(unittest.TestCase):
    def test_every_number_survives(self):
        for f in sorted(os.listdir(deep.DEEP_DIR)):
            if not f.endswith(".md"):
                continue
            slug = f[:-3]
            if not os.path.exists(os.path.join(ROOT, "papers", slug, f"{slug}.tex")):
                continue  # written natively from the start
            md = open(os.path.join(deep.DEEP_DIR, f), encoding="utf-8").read()
            missing = tex_numbers(slug) - numbers(md)
            with self.subTest(slug=slug):
                self.assertEqual(missing, set(), f"{slug}: numbers in the PDF but not the web article")

    def test_blocks_parse(self):
        for f in sorted(os.listdir(deep.DEEP_DIR)):
            if f.endswith(".md"):
                blocks = deep.read(f[:-3])
                self.assertTrue(any(b["t"] == "call" for b in blocks), f)
                for b in blocks:
                    if b["t"] == "table":
                        widths = {len(r) for r in b["rows"]}
                        self.assertEqual(len(widths), 1, f"{f}: ragged table '{b['caption'][:40]}'")


if __name__ == "__main__":
    unittest.main()
