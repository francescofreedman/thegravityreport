#!/usr/bin/env python3
"""Write social/kits/index.json (the list the admin page offers for import)."""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
KITS = os.path.join(ROOT, "social", "kits")
out = []
for d in sorted(os.listdir(KITS), reverse=True) if os.path.isdir(KITS) else []:
    p = os.path.join(KITS, d, "kit.json")
    if os.path.exists(p):
        k = json.load(open(p, encoding="utf-8"))
        out.append({"id": d, "kind": k.get("kind"), "title": k.get("title"), "date": k.get("date")})
with open(os.path.join(KITS, "index.json"), "w", encoding="utf-8") as f:
    json.dump({"kits": out}, f, ensure_ascii=False, indent=1)
    f.write("\n")
print(f"kits: {len(out)}")
