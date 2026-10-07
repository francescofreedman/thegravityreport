# Overnight log — rebrand build (Oct 6–7, 2026)

Worktree: `/Users/francesco2/gravity-rebrand`, branch `rebrand` (from main @ b18e539). Nothing pushed. Nothing deployed.
Prompt: `/Users/francesco2/gravity/.claude/overnight-build-prompt.md`

## Status
| Phase | Status | Notes |
|---|---|---|
| 0 Setup | done | worktree, fonts (self-hosted woff2 + TTFs for cards), legacy extraction (`scripts/migrate_legacy.py`) |
| 1 Build system | in progress | |
| 2 Homepage | todo | |
| 3 Other pages | todo | |
| 4 Player pages | todo | |
| 5 Site QA | todo | |
| 6 Post-kit generator | todo | |
| 7 Auto-posting pipeline | todo | |
| 8 Automatic content | todo | |
| 9 Docs + handoff | todo | |

## Decisions (running)
- Legacy data source: everything is extracted from commit b18e539 (not the working tree), so the build is reproducible after index.html is replaced.
- The644 rich data (tiers, per-game box, rookies' college lines) comes from the `DATA` array that was already public inside the old the644 page; the CSV stays the download.
- Old inbox preserved at `/classic/` with a fixed bottom banner linking to the new site; marked `noindex`.
- In article bodies, "Read it in the inbox" links now point to `/classic/#inbox/<id>` so the words stay true; "Forecast Ledger" links point to `/ledger/`.
