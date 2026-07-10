# The Gravity Report (GRAVITY)

**Game-Rate Adjusted Value, Impact, Talent, and Yield** — an independent basketball
research publication, delivered through a vintage inbox.

Static site, no build step, no dependencies.

```
index.html        the mail client (the whole site UI; hash-routed permalinks)
papers/           research note PDFs + LaTeX sources
the644/           the interactive full-league ranking (July 2026 edition)
feed.xml          RSS
```

## Local preview

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

(A server is required — the PDF iframes and fetch-free routing work from file://
in most browsers, but Chrome blocks PDF iframes from file:// URLs.)

## Deploy (pick one)

- **Cloudflare Pages** (recommended — DNS is already on Cloudflare): create a Pages
  project, connect this repo (works from a private repo), framework = None,
  build command = none, output dir = `/`.
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
