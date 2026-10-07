// OAuth 1.0a (HMAC-SHA1) request signing with WebCrypto, for X user-context calls.
// Only query/form parameters are signed; JSON bodies are not part of the signature.

export function pct(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function hmacSha1B64(key, text) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
}

export function baseString(method, url, params) {
  const u = new URL(url);
  const all = [];
  for (const [k, v] of u.searchParams) all.push([k, v]);
  for (const [k, v] of Object.entries(params)) all.push([k, v]);
  const enc = all.map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const paramStr = enc.map(([k, v]) => `${k}=${v}`).join("&");
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  return `${method.toUpperCase()}&${pct(baseUrl)}&${pct(paramStr)}`;
}

/**
 * Build the Authorization header.
 * creds: {consumerKey, consumerSecret, token, tokenSecret}
 * extra: form/query params that are part of the request (not JSON body fields)
 * fixed: {nonce, timestamp} for tests
 */
export async function authHeader(method, url, creds, extra = {}, fixed = {}) {
  const oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: fixed.nonce || crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(fixed.timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const base = baseString(method, url, { ...extra, ...oauth });
  const key = `${pct(creds.consumerSecret)}&${pct(creds.tokenSecret)}`;
  oauth.oauth_signature = await hmacSha1B64(key, base);
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(", ");
}
