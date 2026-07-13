# The Gravity Report (GRAVITY)

**Game-Rate Adjusted Value, Impact, Talent, and Yield** — an independent basketball
research publication, delivered through a vintage inbox.

Static site, no build step, no dependencies.

```
index.html        the mail client (the whole site UI; hash-routed permalinks)
papers/           research note PDFs + LaTeX sources
papers/pages/     pre-rendered page SVGs (the in-site reading experience — vector, crisp at any zoom)
notes/            plain web editions — one crawlable page per note (SEO/social skeleton;
                  the inbox stays the flagship experience)
cards/            og:image social cards (1200x630, Win98-styled)
the644/           the interactive full-league ranking (July 2026 edition)
scripts/          render-pages.sh — PDF -> per-page SVGs (needs poppler's pdftocairo)
                  make-cards.py  — social cards (PIL; add new notes to CARDS)
feed.xml          RSS · sitemap.xml + robots.txt for crawlers
worker.js         the API: /api/vote + /api/votes (real Drafts tally, D1-backed),
                  /api/e (humans-only reading telemetry: pv/read/depth/dwell,
                  no cookies, no IPs, DNT respected), /api/stats?key=STATS_KEY
                  (30-day aggregates; the key is a Worker secret)
```

## Publishing a new research note

1. Compile the paper (`tectonic noteN.tex`), put PDF + TeX in `papers/`.
2. `scripts/render-pages.sh papers/noteN.pdf` (renders one vector SVG per page).
3. Add the message entry in `index.html` (`M` object: subject, body, pdf, pages, pagesDir,
   attach incl. a `notes/<name>/` web-edition link; `rev` field for revisions).
4. Create `notes/<name>/index.html` (copy an existing one: title, abstract, findings,
   two embedded page SVGs, citation, JSON-LD) — this is the crawlable/social page.
5. Add a card entry in `scripts/make-cards.py`, run it (writes `cards/<name>.png`).
6. Add an item to `feed.xml` (link to the notes page) and a `<url>` to `sitemap.xml`.
7. Commit, push — Cloudflare deploys automatically.

## Local preview

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

(A server is required — the PDF iframes and fetch-free routing work from file://
in most browsers, but Chrome blocks PDF iframes from file:// URLs.)

## Deploy (pick one)

- **Cloudflare Workers (static assets)** — the live setup: dashboard → Workers & Pages →
  import this repo, build command empty, deploy command `npx wrangler deploy`
  (config in `wrangler.jsonc`). Pushes to `main` auto-deploy.
- **GitHub Pages**: public repo → Settings → Pages → deploy from `main` `/ (root)`.
- **Railway**: static site service, serve `/`.

Domain: **thegravityreport.com** (Cloudflare Registrar; feed.xml already points at it).

## Permalinks

- `https://thegravityreport.com/#inbox/queta` — Research Note №2 (the reading pane opens the PDF)
- `https://thegravityreport.com/#inbox/morant` — Research Note №1
- `/#ledger` — the Forecast Ledger
- `/#drafts` — vote on №3
- `/the644/` — the full player ranking

## House rules

- Notes are permanent. Only the model gets revised (versions: v1.0 → v2 → v3 CTG).
- Every forecast is registered with probabilities and falsification criteria
  before the season, and graded in the annual Forecast Audit after it.
- Errors stay visible: see Deleted Items.

## Editorial calendar

- **July 2027** — The 644, 2027 edition + Forecast Audit №1 (grades the Queta bet;
  the Outbox message "sends").
- **№3** — decided by the Drafts vote (Kawhi Anomaly vs. Jokić: Still the Best).
