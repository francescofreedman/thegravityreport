**First, about 1 minute: preview the new site.**

```bash
cd ~/gravity-rebrand && python3 -m http.server 8090
```

Then open http://localhost:8090.

All 9 phases are done. Everything is committed on branch `rebrand` in `~/gravity-rebrand`.
**Nothing is pushed, deployed or posted.** `main` and `preseason-2026` are untouched.

## What's done and how to see it
1. **New site in the locked J design:**
   - homepage, articles, The 644 (+ The 30), ledger, model, corrections, data, about;
   - the old inbox, kept at `/classic/`;
   - every old link still works (`/#inbox/kawhi` → `/notes/kawhi/`).
   - Checks passed: 0 broken links, the 4 articles and the About page are word-for-word identical to the live versions, and nothing scrolls sideways on a phone.
2. **A page and share card for each of the 644 players.** Try `/players/jalen-duren/` and `/players/cameron-boozer/` (a rookie). The cards are in `players/<slug>/card.png`.
3. **Post kits for Kawhi, Queta and Morant.** Each kit has an X/Bluesky thread, a Threads post, a 4-slide Instagram carousel and a Reddit draft for the team's subreddit. Open `social/kits/2026-10-07-article-kawhi/`. A number guard refuses any number that isn't already published.
4. **The auto-posting pipeline:**
   - It lives in your Worker: an approval page at `/admin/` that works on a phone, a 15-minute cron, and connectors for X, Bluesky, Threads and Instagram.
   - It's dry-run by default, X posts are capped at 60 a month, and nothing is retried automatically, so nothing double-posts.
   - 11 Node tests pass, including X's official signature example.
5. **Automatic content:**
   - Player of the day: off until you switch it on.
   - Weekly "Is the model winning?" tracker: a sample is in `review/sample-ledger-kit-2025-26-data/`.
   - Substack paste-ready posts: `social/substack/<slug>/`.
   - Podcast pitch kit: `docs/outreach/podcast-pitch.md`.

Screenshots are in `review/`. Tests: `npm test` (23 pass). Full rebuild: `sh scripts/build_all.sh`.

## Decisions to confirm (ranked)
1. **The 644 page is now a list with filters** (search, team, position, rookies). The old sortable columns (BPM, VORP…) are gone, per "The 644 is always a list." The numbers live on each player page.
2. **The old inbox stays at `/classic/`,** linked in the footer as "The original inbox edition" and hidden from Google. Keep it or drop it?
3. **Kit files are public at unlisted URLs** (`/social/kits/...`). Instagram and Threads need public image links, so draft text can be read before it posts if someone finds the URL.
4. **The newsletter box goes to "Sign-up opens soon"** until you set the Substack address. No email is ever sent or stored.
5. **Player of the day runs in rank order from tip-off** (Oct 20 = #1 Jokić). It posts only rank, name, team, position and score.

## Not built (needs you, or later)
- Accounts, keys and secrets, plus deploying: see **SETUP.md**, about 2–3 hours in total. Bluesky first, since it's free.
- Automatic refresh of Meta tokens (they expire after about 60 days). For now, a calendar reminder.
- `PROGRESS.md` lives on `preseason-2026`, which I didn't touch. Add a rebrand line there when you merge.
- The weekly tracker runs by hand (one command, in SETUP.md step 8). It isn't scheduled yet.

**Next action, about 2 minutes:** run the preview command at the top and open the homepage. Then tell me the first thing you'd change, or say "go" to start SETUP.md.
