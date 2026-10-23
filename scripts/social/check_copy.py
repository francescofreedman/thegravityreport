#!/usr/bin/env python3
"""Check hand-written copy for the Worker-written posts before committing it.

  python3 scripts/social/check_copy.py social/copy/potd-2026-10-23.json social/copy/tonight-2026-10-23.json /tmp/brief.json

For each JSON copy file: X posts <= 280 (a URL counts 23), Bluesky <= 300, Threads <= 500, and every
number in the text appears in the brief (the same rule the site's robot applies before using the copy,
so a post that fails here would be silently dropped there). Exit code 1 on any failure.
"""
import json
import re
import sys

ALWAYS_OK = {"644", "30", "50", "100", "0", "2026", "2027", "2025", "1", "2", "3", "4"}
NUM = re.compile(r"(?<![\w.])[-−+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)")


def norm(tok):
    try:
        return f"{abs(float(tok.replace(',', '').replace('−', '-').lstrip('+'))):.4f}"
    except ValueError:
        return None


def numbers(text):
    return {n for n in (norm(m.group(0)) for m in NUM.finditer(re.sub(r"https?://\S+", " ", str(text)))) if n}


def main(args):
    files, brief = args[:-1], args[-1]
    allowed = numbers(open(brief, encoding="utf-8").read()) | {norm(x) for x in ALWAYS_OK}
    bad = 0
    for f in files:
        try:
            c = json.load(open(f, encoding="utf-8"))
        except FileNotFoundError:
            print(f"{f}: not written (fine if there was nothing to post)")
            continue
        x = c.get("x") or []
        bs = c.get("bluesky") or x
        th = c.get("threads") or "\n\n".join(x)
        for i, p in enumerate(x):
            if len(re.sub(r"https?://\S+", "x" * 23, p)) > 280:
                print(f"{f}: X post {i + 1} is over 280"); bad += 1
        for i, p in enumerate(bs):
            if len(p) > 300:
                print(f"{f}: Bluesky post {i + 1} is over 300"); bad += 1
        if len(th) > 500:
            print(f"{f}: Threads post is over 500"); bad += 1
        for t in x + bs + [th]:
            missing = sorted(numbers(t) - allowed)
            if missing:
                print(f"{f}: numbers not in the brief: {missing} in: {t[:80]}…"); bad += 1
        if not bad:
            print(f"{f}: ok ({len(x)} X posts)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
