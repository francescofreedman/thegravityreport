# Overnight log — rebrand build (Oct 6–7, 2026)

Worktree: `/Users/francesco2/gravity-rebrand`, branch `rebrand` (from main @ b18e539). Nothing pushed. Nothing deployed.
Prompt: `/Users/francesco2/gravity/.claude/overnight-build-prompt.md`

## Status
| Phase | Status | Notes |
|---|---|---|
| 0 Setup | done | worktree, fonts (self-hosted woff2 + TTFs for cards), legacy extraction (`scripts/migrate_legacy.py`) |
| 1 Build system | done | `scripts/build_site.py` (stdlib), `assets/site.css`, self-hosted fonts, `.assetsignore` |
| 2 Homepage | done | matches J at 1440 + 390; old `#folder/msg` links redirect (`assets/legacy-redirect.js`) |
| 3 Other pages | done | articles, the644 (+The 30), ledger, model, corrections, data, about, subscribe, 404, classic |
| 4 Player pages | done | 644 pages + 644 cards; players/index.json |
| 5 Site QA | done | 0 broken links (27k checked), legacy sitemap OK, article text identical x5, no h-scroll at 390, alt text OK, review/*.png |
| 6 Post-kit generator | done | `scripts/social/make_kit.py`; number guard; 10 Python tests; kits for 3 articles + 1 player + edition |
| 7 Auto-posting pipeline | done | `social/pipeline.js`, adapters (X, Bluesky, Threads, Instagram), `/api/admin/*`, `/admin/`, cron; 11 Node tests incl. X's OAuth example vector |
| 8 Automatic content | done | player of the day (Worker, off by default), `ledger_tracker.py` (+tests; sample in review/), `substack_export.py` (3 articles), `docs/outreach/podcast-pitch.md` |
| 9 Docs + handoff | todo | |

## Decisions (running)
- Legacy data source: everything is extracted from commit b18e539 (not the working tree), so the build is reproducible after index.html is replaced.
- The644 rich data (tiers, per-game box, rookies' college lines) comes from the `DATA` array that was already public inside the old the644 page; the CSV stays the download.
- Old inbox preserved at `/classic/` with a fixed bottom banner linking to the new site; marked `noindex`.
- In article bodies, "Read it in the inbox" links now point to `/classic/#inbox/<id>` so the words stay true; "Forecast Ledger" links point to `/ledger/`.
- `.assetsignore` keeps build notes, docs drafts, the social queue and adapters, and the legacy message dump off the public site. Scripts and LaTeX stay public as before.
- Unconfigured newsletter: the signup form's email field has no `name`, so nothing is sent; the button lands on `/subscribe/` ("opens soon" + RSS).
- Player rookies: page labels college numbers as college; method wording limited to what the old 644 page said (draft-slot priors, college-adjusted).
- Social: posting is dry-run unless `SOCIAL_DRY_RUN="0"` (set in wrangler.jsonc vars) AND that platform's secrets exist. Failed posts are never retried automatically (no double posts); retry is a button.
- X monthly cap defaults to 60 posts (pay-per-use pricing). A thread counts each post.
- Kits under `/social/kits/` are public assets on purpose: Instagram and Threads fetch images from public URLs. Their text is visible at an unlisted URL before posting.
- Player of the day: OFF by default. Rotation is rank order starting at tip-off (Oct 20 = #1). Text uses only rank, name, team, position, score.
- Ledger tracker: K3 compares Kawhi with players on pace for 1,500 minutes (1,500 × games so far / 82), so mid-season ranks are fair. It makes one request per run at most every 6 hours (cached in social/.cache, gitignored).
- Substack: no official API, so the export is a paste-ready post.html + bars.png + 6-step README per article. Article text unchanged.
