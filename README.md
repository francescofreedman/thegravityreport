# The Gravity Report (GRAVITY)

**Game-Rate Adjusted Value, Impact, Talent, and Yield** — an independent basketball
research publication, delivered through a vintage inbox.

Static site, no build step, no dependencies.

```
index.html        the mail client (the whole site UI; hash-routed permalinks)
papers/           research note PDFs + LaTeX sources
papers/pages/     pre-rendered page SVGs (the in-site reading experience — vector, crisp at any zoom)
the644/           the interactive full-league ranking (July 2026 edition)
scripts/          render-pages.sh — PDF -> per-page SVGs (needs poppler's pdftocairo)
feed.xml          RSS
```

## Publishing a new research note

1. Compile the paper (`tectonic noteN.tex`), put PDF + TeX in `papers/`.
2. `scripts/render-pages.sh papers/noteN.pdf` (renders one vector SVG per page).
3. Add the message entry in `index.html` (`M` object: subject, body, pdf, pages, pagesDir).
4. Add an item to `feed.xml`. Commit, push — Cloudflare deploys automatically.

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
