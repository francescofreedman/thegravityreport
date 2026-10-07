#!/bin/sh
# Rebuild the whole site: pages, then share cards. Deterministic; safe to re-run.
set -e
cd "$(dirname "$0")/.."
python3 scripts/build_site.py
python3 scripts/make-cards.py
python3 scripts/check_site.py
