// Bluesky (AT Protocol) adapter. Uses an app password (Settings → App passwords), never the main password.
// Docs: https://docs.bsky.app/docs/advanced-guides/posts
export const name = "bluesky";

export function configured(env) {
  return !!(env.BSKY_HANDLE && env.BSKY_APP_PASSWORD);
}

const host = (env) => env.BSKY_SERVICE || "https://bsky.social";

async function xrpc(env, f, method, nsid, { body, token, contentType } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = contentType || "application/json";
  const res = await f(`${host(env)}/xrpc/${nsid}`, {
    method,
    headers,
    body: body === undefined ? undefined : contentType ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`bluesky ${nsid} ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

/** Link facets: byte offsets in UTF-8, as the protocol requires. */
export function linkFacets(text) {
  const enc = new TextEncoder();
  const facets = [];
  const re = /https?:\/\/[^\s)]+/g;
  let m;
  while ((m = re.exec(text))) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(m[0]).length;
    facets.push({ index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  return facets;
}

export async function post(env, payload, f = fetch, now = () => new Date().toISOString()) {
  const s = await xrpc(env, f, "POST", "com.atproto.server.createSession", {
    body: { identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD },
  });
  const token = s.accessJwt;
  const images = [];
  for (const img of (payload.images || []).slice(0, 4)) {
    const up = await xrpc(env, f, "POST", "com.atproto.repo.uploadBlob", { body: img.bytes, token, contentType: "image/png" });
    images.push({ alt: img.alt || "", image: up.blob, aspectRatio: img.width ? { width: img.width, height: img.height } : undefined });
  }
  let root = null;
  let parent = null;
  const uris = [];
  for (let i = 0; i < payload.posts.length; i++) {
    const text = payload.posts[i];
    const record = { $type: "app.bsky.feed.post", text, createdAt: now(), langs: ["en"] };
    const facets = linkFacets(text);
    if (facets.length) record.facets = facets;
    if (i === 0 && images.length) record.embed = { $type: "app.bsky.embed.images", images };
    if (parent) record.reply = { root, parent };
    const r = await xrpc(env, f, "POST", "com.atproto.repo.createRecord", {
      body: { repo: s.did, collection: "app.bsky.feed.post", record },
      token,
    });
    const ref = { uri: r.uri, cid: r.cid };
    if (!root) root = ref;
    parent = ref;
    uris.push(r.uri);
  }
  return { remote_id: uris[0], ids: uris, count: uris.length };
}
