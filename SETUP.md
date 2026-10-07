# SETUP — what only you can do (in order)

Everything is built and committed on branch `rebrand` in `~/gravity-rebrand`. Nothing is
pushed, deployed or posted. Each step below is yours because it needs your accounts,
money or a final yes. Total: about 2–3 hours, spread over a few sessions.

## 1. Review the new site locally (15 min)

```bash
cd ~/gravity-rebrand && python3 -m http.server 8090
```

Open http://localhost:8090. Check the homepage, one article, The 644, a player page
(e.g. /players/jalen-duren/), /ledger/ and /corrections/. Say what to change.

## 2. Create the accounts (30–45 min)

Use the handle `thegravityreport` everywhere if it's free (else `gravityreport`).
- **X**: a normal account.
- **Bluesky**: bsky.app.
- **Instagram**: switch the account to **Professional (Creator)**. **Threads** is created from the Instagram login.

## 3. Get the keys (45–60 min; Meta takes longest)

| Platform | Where | Secrets to set |
|---|---|---|
| Bluesky (free, easiest) | Settings → Privacy and security → App passwords → Add | `BSKY_HANDLE`, `BSKY_APP_PASSWORD` |
| X (pay-per-use, about $0.015/post, $0.20 with a link) | developer.x.com → create app → User authentication: **Read and write** → generate Access Token & Secret for your account; add a little credit | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` |
| Threads | developers.facebook.com → create app → add **Threads API** use case → add yourself as tester → generate a long-lived token | `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN` |
| Instagram | same app → add **Instagram API with Instagram Login** → connect the professional account → long-lived token | `IG_USER_ID`, `IG_ACCESS_TOKEN` |
| Admin page | run `openssl rand -hex 24` and keep it in your password manager | `ADMIN_KEY` |

Meta's long-lived tokens expire after about 60 days. Refreshing them automatically is
**not built yet**. Until it is, put a calendar reminder to make new ones.

## 4. Put the secrets in Cloudflare (10 min)

```bash
cd ~/gravity-rebrand
npx wrangler login
npx wrangler secret put ADMIN_KEY
npx wrangler secret put BSKY_HANDLE
npx wrangler secret put BSKY_APP_PASSWORD
```

Repeat the last line for each secret in the table above, for the platforms you want.
A platform with no secrets simply never posts.

## 5. Substack (20 min)

1. Create the publication at substack.com (name: The Gravity Report).
2. Put its address in `content/site.json` → `"newsletter_url": "https://<name>.substack.com"`.
3. `sh scripts/build_all.sh`. The signup box on every page now sends people to Substack's
   signup with their email filled in. **Test it once** with your own email.
4. Optional: Substack custom domain (one-time $50), e.g. `newsletter.thegravityreport.com`.
5. Paste the three articles using `social/substack/<slug>/README.md` (about 15 min each).

## 6. Deploy (10 min, only after you've reviewed)

```bash
cd ~/gravity-rebrand && sh scripts/build_all.sh && npm test
git push git@github.com:francescofreedman/thegravityreport.git rebrand:main
```

`main` hasn't moved since this branch was made, so this is a clean fast-forward. Cloudflare is
live about 30 seconds later. Check it with `curl -sI https://thegravityreport.com/ | head -3`.

The first deploy also turns on the 15-minute cron. That's safe: dry run is on.

## 7. First test post, then go live one platform at a time (20 min)

1. Open https://thegravityreport.com/admin/, enter `ADMIN_KEY`.
2. Import `2026-10-07-article-kawhi`, press **Approve**, then **Run due posts now**. With dry
   run on, each row becomes **SIMULATED**. Nothing is sent.
3. To go live: in `wrangler.jsonc` set `"SOCIAL_DRY_RUN": "0"`, commit, deploy. Only
   platforms with secrets will post. Start with **Bluesky only** (free), then add X.
4. In `/admin/` → Settings, turn on **Player of the day** when you're ready. Leave
   "approve automatically" off for the first week.

## 8. Every week during the season (10 min)

```bash
cd ~/gravity-rebrand && python3 scripts/social/ledger_tracker.py && python3 scripts/social/kits_index.py
```

Commit and deploy, then in `/admin/` import the new `…-ledger-tracker` kit and approve it.
Post the Reddit drafts (`social/kits/*/reddit.md`) by hand, after reading each subreddit's rules.
