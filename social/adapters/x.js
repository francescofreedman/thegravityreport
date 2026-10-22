// X (Twitter) API v2 adapter. Docs: https://docs.x.com/x-api/posts/create-post and
// https://docs.x.com/x-api/media/upload-media (JSON body with base64 media; OAuth 1.0a user context).
// Pricing (pay-per-use, 2026): about $0.015 per post, $0.20 if it contains a link — see SOCIAL_X_MONTHLY_CAP.
import { authHeader } from "./oauth1.js";

const API = "https://api.x.com/2";

export const name = "x";

export function configured(env) {
  return !!(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET);
}

function creds(env) {
  return { consumerKey: env.X_API_KEY, consumerSecret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_SECRET };
}

function toB64(bytes) {
  let s = "";
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function call(env, f, url, body) {
  const res = await f(url, {
    method: "POST",
    headers: { authorization: await authHeader("POST", url, creds(env)), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`x ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

export async function uploadImage(env, f, bytes) {
  const data = await call(env, f, `${API}/media/upload`, { media: toB64(bytes), media_category: "tweet_image" });
  return data.data.id;
}

/**
 * payload: {posts: [text...], images: [{bytes, alt}] (first post only),
 *           poll: {options: [2-4 strings <= 25 chars], duration_minutes: 5..10080} (first post only; a poll can't carry media)}
 * returns {remote_id, ids, count}
 */
export function pollBody(poll) {
  const options = (poll.options || []).map((o) => String(o).slice(0, 25)).slice(0, 4);
  if (options.length < 2) throw new Error("a poll needs 2 to 4 options");
  return { options, duration_minutes: Math.min(10080, Math.max(5, Number(poll.duration_minutes) || 1440)) };
}

export async function post(env, payload, f = fetch) {
  const ids = [];
  let mediaIds = [];
  if (!payload.poll) for (const img of payload.images || []) mediaIds.push(await uploadImage(env, f, img.bytes));
  mediaIds = mediaIds.slice(0, 4);
  for (let i = 0; i < payload.posts.length; i++) {
    const body = { text: payload.posts[i] };
    if (i === 0 && payload.poll) body.poll = pollBody(payload.poll);
    else if (i === 0 && mediaIds.length) body.media = { media_ids: mediaIds };
    if (ids.length) body.reply = { in_reply_to_tweet_id: ids[ids.length - 1] };
    const d = await call(env, f, `${API}/tweets`, body);
    ids.push(d.data.id);
  }
  return { remote_id: ids[0], ids, count: ids.length };
}
