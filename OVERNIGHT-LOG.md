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
| 6 Post-kit generator | in progress | |
| 7 Auto-posting pipeline | todo | |
| 8 Automatic content | todo | |
| 9 Docs + handoff | todo | |

## Decisions (running)
- Legacy data source: everything is extracted from commit b18e539 (not the working tree), so the build is reproducible after index.html is replaced.
- The644 rich data (tiers, per-game box, rookies' college lines) comes from the `DATA` array that was already public inside the old the644 page; the CSV stays the download.
- Old inbox preserved at `/classic/` with a fixed bottom banner linking to the new site; marked `noindex`.
- In article bodies, "Read it in the inbox" links now point to `/classic/#inbox/<id>` so the words stay true; "Forecast Ledger" links point to `/ledger/`.
- `.assetsignore` keeps build notes, docs drafts, the social queue and adapters, and the legacy message dump off the public site. Scripts and LaTeX stay public as before.
- Unconfigured newsletter: the signup form's email field has no `name`, so nothing is sent; the button lands on `/subscribe/` ("opens soon" + RSS).
- Player rookies: page labels college numbers as college; method wording limited to what the old 644 page said (draft-slot priors, college-adjusted).
