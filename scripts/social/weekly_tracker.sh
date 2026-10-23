#!/bin/sh
# Sunday night: write next Monday's "Is the model winning?" kit and push it, so the site posts it
# Monday 9 AM ET. Runs from a dedicated clone so it never touches a checkout you're working in.
# Installed as a launchd job (scripts/social/com.thegravityreport.tracker.plist); log in ~/Library/Logs/gravity-tracker.log
set -e
CLONE="$HOME/.gravity-tracker"
REPO="git@github.com:francescofreedman/thegravityreport.git"
if [ ! -d "$CLONE/.git" ]; then git clone -q "$REPO" "$CLONE"; fi
cd "$CLONE"
git fetch -q origin main
git reset -q --hard origin/main
python3 scripts/social/ledger_tracker.py --schedule
if [ -n "$(git status --porcelain)" ]; then
  git add -A social/kits social/schedule.json social/SCHEDULE.md
  git -c user.name="Gravity tracker" -c user.email="posts@thegravityreport.com" commit -qm "Tracker: Is the model winning? kit $(ls social/kits | grep ledger-tracker | tail -1)"
  git push -q origin HEAD:main
  echo "$(date): pushed"
else
  echo "$(date): nothing to commit"
fi
