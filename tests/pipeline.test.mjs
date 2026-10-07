// Run: node --test tests/
// Uses node:sqlite as a stand-in for Cloudflare D1 and a mocked fetch for every platform.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as P from "../social/pipeline.js";
import { authHeader, baseString, pct } from "../social/adapters/oauth1.js";
import * as bsky from "../social/adapters/bluesky.js";
import * as xad from "../social/adapters/x.js";
import { threads, instagram } from "../social/adapters/meta.js";
import { handleAdmin } from "../social/admin-api.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    prepare: (sql) => wrap(sql),
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function fakeAssets() {
  return {
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const file = join(ROOT, path);
      if (!existsSync(file)) return new Response("nf", { status: 404 });
      return new Response(readFileSync(file));
    },
  };
}

function env(extra = {}) {
  P.resetSchemaCache();
  return { DB: fakeD1(), ASSETS: fakeAssets(), SOCIAL_DRY_RUN: "1", ...extra };
}

function okAdapter(name, calls) {
  return { name, configured: () => true, async post(e, payload) { calls.push({ name, payload }); return { remote_id: name + "-1", count: (payload.posts || [1]).length }; } };
}

const KIT = "2026-10-07-article-kawhi";
const T0 = Date.parse("2026-10-21T17:00:00Z");

test("OAuth 1.0a signature matches X's published example", async () => {
  // https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature
  const url = "https://api.twitter.com/1.1/statuses/update.json?include_entities=true";
  const creds = {
    consumerKey: "xvz1evFS4wEEPTGEFPHBog", consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  };
  const h = await authHeader("POST", url, creds, { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
    { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: 1318622958 });
  assert.match(h, new RegExp('oauth_signature="' + pct("hCtSmYh+iHYCEqBWrE7C7hYmtUk=").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"'));
  assert.ok(baseString("POST", url, {}).startsWith("POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&"));
});

test("dry run: approved + due items are simulated, never posted", async () => {
  const e = env();
  await P.ensureSocialSchema(e);
  assert.equal(await P.importKit(e, KIT, { nowMs: T0 }), 4);
  assert.equal(await P.importKit(e, KIT, { nowMs: T0 }), 0, "import is idempotent");
  assert.equal(await P.approveWeek(e, T0), 4);
  const calls = [];
  const adapters = Object.fromEntries(P.PLATFORMS.map((p) => [p, okAdapter(p, calls)]));
  const r = await P.runScheduled(e, T0 + 1000, { adapters });
  assert.equal(calls.length, 0);
  assert.deepEqual(r.processed.map((x) => x.result), ["simulated", "simulated", "simulated", "simulated"]);
  const log = await e.DB.prepare("SELECT action FROM social_log").all();
  assert.ok(log.results.every((l) => l.action === "would_post"));
});

test("live only when SOCIAL_DRY_RUN=0 AND platform configured", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0" });
  await P.ensureSocialSchema(e);
  await P.importKit(e, KIT, { nowMs: T0, platforms: ["x", "bluesky"] });
  await P.approveWeek(e, T0);
  const calls = [];
  const adapters = { ...P.ADAPTERS, x: okAdapter("x", calls), bluesky: { ...okAdapter("bluesky", calls), configured: () => false } };
  const r = await P.runScheduled(e, T0 + 1000, { adapters });
  const res = Object.fromEntries(r.processed.map((x) => [x.platform, x.result]));
  assert.equal(res.x, "posted");
  assert.equal(res.bluesky, "simulated");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].payload.images[0].bytes.length > 1000, "card image bytes loaded from assets");
});

test("no double posting: a second run finds nothing to do", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0" });
  await P.ensureSocialSchema(e);
  await P.importKit(e, KIT, { nowMs: T0, platforms: ["x"] });
  await P.approveWeek(e, T0);
  const calls = [];
  const adapters = { ...P.ADAPTERS, x: okAdapter("x", calls) };
  await Promise.all([P.runScheduled(e, T0 + 1000, { adapters }), P.runScheduled(e, T0 + 1000, { adapters })]);
  await P.runScheduled(e, T0 + 2000, { adapters });
  assert.equal(calls.length, 1);
});

test("failures are recorded and not retried automatically", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0" });
  await P.ensureSocialSchema(e);
  await P.importKit(e, KIT, { nowMs: T0, platforms: ["x"] });
  await P.approveWeek(e, T0);
  let n = 0;
  const adapters = { ...P.ADAPTERS, x: { name: "x", configured: () => true, async post() { n++; throw new Error("boom"); } } };
  await P.runScheduled(e, T0 + 1000, { adapters });
  await P.runScheduled(e, T0 + 2000, { adapters });
  assert.equal(n, 1);
  const row = await e.DB.prepare("SELECT status, error FROM social_queue").first();
  assert.equal(row.status, "failed");
  assert.match(row.error, /boom/);
});

test("monthly cap holds posts instead of sending them", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", SOCIAL_X_MONTHLY_CAP: "3" });
  await P.ensureSocialSchema(e);
  await P.importKit(e, KIT, { nowMs: T0, platforms: ["x"] }); // a 5-post thread
  await P.approveWeek(e, T0);
  const calls = [];
  const r = await P.runScheduled(e, T0 + 1000, { adapters: { ...P.ADAPTERS, x: okAdapter("x", calls) } });
  assert.equal(r.processed[0].result, "held");
  assert.equal(calls.length, 0);
});

test("items scheduled in the future wait", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0" });
  await P.ensureSocialSchema(e);
  await P.importKit(e, KIT, { nowMs: T0, platforms: ["x"], scheduledAt: "2026-10-25T16:00:00.000Z" });
  const row = await e.DB.prepare("SELECT id FROM social_queue").first();
  await P.approve(e, row.id, null, T0);
  const calls = [];
  const r = await P.runScheduled(e, T0 + 1000, { adapters: { ...P.ADAPTERS, x: okAdapter("x", calls) } });
  assert.equal(r.processed.length, 0);
});

test("player of the day: off by default, queues once per day when on", async () => {
  const e = env();
  await P.ensureSocialSchema(e);
  assert.equal(await P.maybeQueuePotd(e, T0), null);
  await P.setSetting(e, "potd_on", "1");
  const kid = await P.maybeQueuePotd(e, T0);
  assert.equal(kid, "potd-2026-10-21");
  assert.equal(await P.maybeQueuePotd(e, T0 + 3600e3), null);
  const rows = await e.DB.prepare("SELECT platform, status, payload FROM social_queue").all();
  assert.deepEqual(rows.results.map((r) => r.platform).sort(), ["bluesky", "threads", "x"]);
  assert.ok(rows.results.every((r) => r.status === "draft"));
  const text = JSON.parse(rows.results[0].payload).posts[0];
  assert.match(text, /^#2 of 644 in The 644: Shai Gilgeous-Alexander/); // day 1 after tip-off = rank 2
  assert.equal(P.potdIndex("2026-10-20", 644), 0);
  assert.equal(P.potdIndex("2026-10-01", 644), 0);
});

test("bluesky link facets use UTF-8 byte offsets", () => {
  const t = "Dončić → https://thegravityreport.com/x/";
  const f = bsky.linkFacets(t);
  const bytes = new TextEncoder().encode(t);
  assert.equal(new TextDecoder().decode(bytes.slice(f[0].index.byteStart, f[0].index.byteEnd)), "https://thegravityreport.com/x/");
});

test("adapters call the documented endpoints (mocked fetch)", async () => {
  const seen = [];
  const f = async (url, init) => {
    seen.push([String(url), init && init.method]);
    const u = String(url);
    let body = {};
    if (u.includes("createSession")) body = { accessJwt: "jwt", did: "did:plc:abc" };
    else if (u.includes("uploadBlob")) body = { blob: { $type: "blob", ref: { $link: "b" }, mimeType: "image/png", size: 3 } };
    else if (u.includes("createRecord")) body = { uri: "at://did:plc:abc/app.bsky.feed.post/" + seen.length, cid: "c" + seen.length };
    else if (u.includes("/2/media/upload")) body = { data: { id: "m1" } };
    else if (u.includes("/2/tweets")) body = { data: { id: "t" + seen.length } };
    else body = { id: "meta" + seen.length };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const img = [{ bytes: new Uint8Array([1, 2, 3]), alt: "a", width: 1200, height: 630 }];
  const e = { BSKY_HANDLE: "h", BSKY_APP_PASSWORD: "p", X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts",
    THREADS_USER_ID: "1", THREADS_ACCESS_TOKEN: "tok", IG_USER_ID: "2", IG_ACCESS_TOKEN: "tok" };
  const b = await bsky.post(e, { posts: ["one https://x.y/", "two"], images: img }, f);
  assert.equal(b.count, 2);
  const x = await xad.post(e, { posts: ["one", "two"], images: img }, f);
  assert.equal(x.count, 2);
  await threads.post(e, { posts: ["hello"], image_urls: ["https://thegravityreport.com/cards/site.png"] }, f);
  await instagram.post(e, { caption: "c", image_urls: ["https://a/1.png", "https://a/2.png"] }, f);
  const urls = seen.map((s) => s[0]);
  assert.ok(urls.some((u) => u === "https://api.x.com/2/media/upload"));
  assert.ok(urls.some((u) => u === "https://api.x.com/2/tweets"));
  assert.ok(urls.some((u) => u.endsWith("/xrpc/com.atproto.repo.createRecord")));
  assert.ok(urls.some((u) => u.startsWith("https://graph.threads.net/v1.0/1/threads_publish")));
  assert.ok(urls.some((u) => u.startsWith("https://graph.instagram.com/") && u.endsWith("/media_publish")));
});

test("admin API: off without ADMIN_KEY, rejects wrong key, imports + approves with the right one", async () => {
  const e = env();
  assert.equal((await handleAdmin(new Request("https://t/api/admin/queue"), e)).status, 503);
  e.ADMIN_KEY = "s3cret-key-123";
  assert.equal((await handleAdmin(new Request("https://t/api/admin/queue", { headers: { "x-admin-key": "nope" } }), e)).status, 401);
  const H = { "x-admin-key": "s3cret-key-123", "content-type": "application/json" };
  let r = await handleAdmin(new Request("https://t/api/admin/import", { method: "POST", headers: H, body: JSON.stringify({ kit_id: KIT }) }), e);
  assert.equal((await r.json()).added, 4);
  r = await handleAdmin(new Request("https://t/api/admin/approve-week", { method: "POST", headers: H, body: "{}" }), e);
  assert.equal((await r.json()).changed, 4);
  r = await handleAdmin(new Request("https://t/api/admin/queue", { headers: H }), e);
  const q = await r.json();
  assert.equal(q.dry_run, true);
  assert.equal(q.rows.length, 4);
  r = await handleAdmin(new Request("https://t/api/admin/import", { method: "POST", headers: H, body: JSON.stringify({ kit_id: "../etc" }) }), e);
  assert.equal(r.status, 400);
});
