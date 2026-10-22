#!/bin/sh
# One-shot Cloudflare secrets for Bluesky posting. Run with the Bluesky app password on the clipboard.
#   sh scripts/social/set_secrets.sh
# Nothing is printed except the admin key (on the clipboard at the end, to save in your password manager).
set -e
cd "$HOME/gravity"
APP_PW="$(pbpaste | tr -d '[:space:]')"
echo "$APP_PW" | grep -Eq '^[a-z0-9]{4}(-[a-z0-9]{4}){3}$' || { echo "Clipboard isn't a Bluesky app password (xxxx-xxxx-xxxx-xxxx). Copy it and rerun."; exit 1; }
npx --yes wrangler whoami 2>/dev/null | grep -q "You are logged in" || npx --yes wrangler login
# Must be the account that already runs thegravityreport.com, or the secrets land on a new, empty Worker.
npx --yes wrangler deployments list >/dev/null 2>&1 || { echo "This Cloudflare account has no 'thegravityreport' Worker. Run 'npx wrangler logout', then rerun and log in with the account that hosts thegravityreport.com."; exit 1; }
printf '%s' "$APP_PW" | npx --yes wrangler secret put BSKY_APP_PASSWORD
printf '%s' "thegravityreport.bsky.social" | npx --yes wrangler secret put BSKY_HANDLE
ADMIN="$(openssl rand -hex 24)"
printf '%s' "$ADMIN" | npx --yes wrangler secret put ADMIN_KEY
printf '%s' "$ADMIN" | pbcopy
echo
echo "Done. Your ADMIN_KEY is now on the clipboard: paste it into your password manager now (it's the /admin/ login)."
