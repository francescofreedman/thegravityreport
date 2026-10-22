// Weekly audience numbers for the admin panel: follower counts per platform, plus how many posts
// went out in the last seven days (from social_log). Only free, read-only endpoints:
//   Bluesky    public API, no token (app.bsky.actor.getProfile)
//   X          skipped: user lookups aren't free on the pay-per-use plan, so followers stay null
//   Threads    only with THREADS_USER_ID + THREADS_ACCESS_TOKEN (threads_insights followers_count)
//   Instagram  only with IG_USER_ID + IG_ACCESS_TOKEN (fields=followers_count)
// A failed lookup leaves followers null and is logged; it never stops the cron.
export const BSKY_PUBLIC = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile";
export const DEFAULT_BSKY_HANDLE = "thegravityreport.bsky.social";

async function getJson(f, url) {
  const res = await f(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

const int = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));

// -> { followers: number|null, skipped: string|null }
export async function followers(env, platform, f = fetch) {
  if (platform === "bluesky") {
    const handle = env.BSKY_HANDLE || DEFAULT_BSKY_HANDLE;
    const d = await getJson(f, `${BSKY_PUBLIC}?actor=${encodeURIComponent(handle)}`);
    return { followers: int(d.followersCount), skipped: null };
  }
  if (platform === "x") return { followers: null, skipped: "no free follower endpoint on X's pay-per-use plan" };
  if (platform === "threads") {
    if (!(env.THREADS_USER_ID && env.THREADS_ACCESS_TOKEN)) return { followers: null, skipped: "Threads not connected" };
    const base = `https://graph.threads.net/${env.THREADS_API_VERSION || "v1.0"}/${env.THREADS_USER_ID}`;
    const d = await getJson(f, `${base}/threads_insights?metric=followers_count&access_token=${encodeURIComponent(env.THREADS_ACCESS_TOKEN)}`);
    const m = (d.data || [])[0] || {};
    const v = m.total_value ? m.total_value.value : (m.values || [])[0] && m.values[0].value;
    return { followers: int(v), skipped: null };
  }
  if (platform === "instagram") {
    if (!(env.IG_USER_ID && env.IG_ACCESS_TOKEN)) return { followers: null, skipped: "Instagram not connected" };
    const base = `https://graph.instagram.com/${env.IG_API_VERSION || "v23.0"}/${env.IG_USER_ID}`;
    const d = await getJson(f, `${base}?fields=followers_count&access_token=${encodeURIComponent(env.IG_ACCESS_TOKEN)}`);
    return { followers: int(d.followers_count), skipped: null };
  }
  return { followers: null, skipped: "unknown platform" };
}
