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
      if (path === "/social/schedule.json") return new Response("nf", { status: 404 }); // schedule tests pass their own
      const file = join(ROOT, path);
      if (!existsSync(file)) return new Response("nf", { status: 404 });
      return new Response(readFileSync(file));
    },
  };
}

function env(extra = {}) {
  P.resetSchemaCache();
  return { DB: fakeD1(), ASSETS: fakeAssets(), SOCIAL_DRY_RUN: "1", SOCIAL_POTD: "0", ...extra };
}

function okAdapter(name, calls) {
  return { name, configured: () => true, async post(e, payload) { calls.push({ name, payload }); return { remote_id: name + "-1", count: (payload.posts || [1]).length }; } };
}

const KIT = "2026-10-20-article-kawhi";
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
  assert.equal(res.bluesky, "skipped", "live but not connected: skipped, never silently consumed");
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

// ESPN fixture: the real box score of MIN 131, MIA 106 (Oct 21 2026), trimmed to the fields we read.
const SUMMARY = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/espn-summary-401909091.json"), "utf8"));
function espnFetch(calls = []) {
  return async (url) => {
    calls.push(url);
    if (url.includes("/scoreboard")) return new Response(JSON.stringify({ events: [{ id: "401909091", status: { type: { completed: true } } }] }));
    if (url.includes("/summary")) return new Response(JSON.stringify(SUMMARY));
    return new Response("nf", { status: 404 });
  };
}

test("player of the day: last night's best game, real numbers, queued for 10 AM ET on every platform, once", async () => {
  const e = env({ SOCIAL_POTD: "1" });
  await P.ensureSocialSchema(e);
  const calls = [];
  const morning = Date.parse("2026-10-22T12:00:00Z"); // 8 AM ET: too early
  assert.equal(await P.maybeQueuePotd(e, morning, { fetchImpl: espnFetch(calls) }), null);
  const nine = Date.parse("2026-10-22T13:05:00Z"); // 9:05 AM ET
  assert.equal(await P.maybeQueuePotd(e, nine, { fetchImpl: espnFetch(calls) }), "potd-2026-10-22");
  assert.ok(calls[0].includes("dates=20261021"), "looks at last night's games");
  assert.equal(await P.maybeQueuePotd(e, nine + 3600e3, { fetchImpl: espnFetch(calls) }), null, "once a day");
  const rows = (await e.DB.prepare("SELECT platform, status, scheduled_at, payload FROM social_queue").all()).results;
  assert.deepEqual(rows.map((r) => r.platform).sort(), ["bluesky", "instagram", "threads", "x"]);
  assert.ok(rows.every((r) => r.status === "approved" && r.scheduled_at === "2026-10-22T14:00:00.000Z"));
  const x = JSON.parse(rows.find((r) => r.platform === "x").payload).posts;
  assert.equal(x[0], "Anthony Edwards last night: 45 points, 10 rebounds, 16-of-29 shooting and 9-of-17 from three in a 131–106 win over the Heat.");
  assert.match(x[1], /^In The 644 he's #22 of 644, GRAVITY score 63\.1/);
});

test("player of the day: a player picked by hand for that day wins; potd_on=0 turns it off", async () => {
  const e = env({ SOCIAL_POTD: "1" });
  await P.ensureSocialSchema(e);
  const nine = Date.parse("2026-10-22T13:05:00Z");
  const schedule = { posts: [{ at: "2026-10-22T14:00:00Z", platform: "x", kit: "2026-10-22-player-anthony-edwards" }] };
  assert.equal(await P.maybeQueuePotd(e, nine, { fetchImpl: espnFetch(), schedule }), null);
  const e2 = env({ SOCIAL_POTD: "1" });
  await P.ensureSocialSchema(e2);
  await P.setSetting(e2, "potd_on", "0");
  assert.equal(await P.maybeQueuePotd(e2, nine, { fetchImpl: espnFetch() }), null);
});

test("game score and name matching", async () => {
  const { gameScore, normName } = await import("../social/potd.js");
  assert.equal(normName("Nikola Jokić"), "nikola jokic");
  assert.equal(normName("Jaren Jackson Jr."), "jaren jackson");
  const L = { PTS: "45", FG: "16-29", FT: "4-5", OREB: "0", DREB: "10", STL: "2", AST: "3", BLK: "1", PF: "1", TO: "4" };
  assert.equal(gameScore(L).toFixed(1), "34.1");
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
  // a pasted key with a stray space still unlocks (password managers add them)
  assert.equal((await handleAdmin(new Request("https://t/api/admin/queue", { headers: { "x-admin-key": " s3cret-key-123 " } }), e)).status, 200);
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


// ------------------------------------------------------------------ schedule

const BSKY_LIVE = { BSKY_HANDLE: "h", BSKY_APP_PASSWORD: "p" };

test("schedule: rows go in approved at their time, post when due, never twice", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", ...BSKY_LIVE });
  await P.ensureSocialSchema(e);
  const schedule = { posts: [{ at: "2026-10-22T16:00:00Z", platform: "bluesky", kit: KIT }] };
  const calls = [];
  const adapters = { ...P.ADAPTERS, bluesky: okAdapter("bluesky", calls) };
  assert.equal(await P.syncSchedule(e, T0, { adapters, schedule }), 1);
  assert.equal(await P.syncSchedule(e, T0, { adapters, schedule }), 0, "sync is idempotent");
  let r = await P.runScheduled(e, Date.parse("2026-10-22T15:59:00Z"), { adapters });
  assert.equal(calls.length, 0, "not before its time");
  r = await P.runScheduled(e, Date.parse("2026-10-22T16:00:00Z"), { adapters });
  assert.equal(calls.length, 1);
  await P.syncSchedule(e, Date.parse("2026-10-22T16:20:00Z"), { adapters, schedule });
  await P.runScheduled(e, Date.parse("2026-10-22T16:30:00Z"), { adapters });
  assert.equal(calls.length, 1, "a posted row is never re-armed");
});

test("schedule: moving a row's time moves the queued post; skip cancels it", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", ...BSKY_LIVE });
  await P.ensureSocialSchema(e);
  const adapters = { ...P.ADAPTERS, bluesky: okAdapter("bluesky", []) };
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: [{ at: "2026-10-22T16:00:00Z", platform: "bluesky", kit: KIT }] } });
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: [{ at: "2026-10-23T16:00:00Z", platform: "bluesky", kit: KIT }] } });
  let row = await e.DB.prepare("SELECT scheduled_at, status FROM social_queue").first();
  assert.equal(row.scheduled_at, "2026-10-23T16:00:00.000Z");
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: [{ at: "2026-10-23T16:00:00Z", platform: "bluesky", kit: KIT, skip: true }] } });
  row = await e.DB.prepare("SELECT status FROM social_queue").first();
  assert.equal(row.status, "cancelled");
});

test("schedule: a dry-run simulation is re-armed when the platform goes live, but stale rows are not", async () => {
  const dry = env();
  await P.ensureSocialSchema(dry);
  const calls = [];
  const adapters = { ...P.ADAPTERS, bluesky: okAdapter("bluesky", calls) };
  const schedule = { posts: [
    { at: "2026-10-21T17:00:00Z", platform: "bluesky", kit: KIT },
    { at: "2026-10-22T16:00:00Z", platform: "bluesky", kit: "2026-10-20-article-duren" },
  ] };
  await P.syncSchedule(dry, T0, { adapters, schedule });
  await P.runScheduled(dry, Date.parse("2026-10-22T16:00:00Z"), { adapters }); // both simulated
  assert.equal(calls.length, 0);
  const live = { ...dry, SOCIAL_DRY_RUN: "0", ...BSKY_LIVE };
  // going live on the 22nd at 16:30: the Duren row (30 min old) is re-armed, the Kawhi row (day old) is not
  await P.syncSchedule(live, Date.parse("2026-10-22T16:30:00Z"), { adapters, schedule });
  await P.runScheduled(live, Date.parse("2026-10-22T16:30:00Z"), { adapters });
  assert.deepEqual(calls.map((c) => c.payload.posts[0].slice(0, 40)).length, 1);
  const st = (await live.DB.prepare("SELECT kit_id, status FROM social_queue ORDER BY kit_id").all()).results;
  assert.deepEqual(st.map((x) => x.status), ["posted", "simulated"]);
});

test("schedule file: every row names a real kit, a known platform and a valid time", () => {
  const s = JSON.parse(readFileSync(join(ROOT, "social/schedule.json"), "utf8"));
  for (const r of s.posts) {
    assert.ok(P.PLATFORMS.includes(r.platform), r.platform);
    assert.ok(existsSync(join(ROOT, "social/kits", r.kit, "kit.json")), r.kit);
    assert.ok(!Number.isNaN(Date.parse(r.at)), r.at);
  }
});

test("dashboard: cancel stops a scheduled post for good; restore brings it back", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0" });
  await P.ensureSocialSchema(e);
  const calls = [];
  const adapters = { ...P.ADAPTERS, bluesky: okAdapter("bluesky", calls) };
  const schedule = { posts: [{ at: "2026-10-22T16:00:00Z", platform: "bluesky", kit: KIT }] };
  // cancelled before the cron ever saw it
  assert.equal(await P.cancelScheduled(e, KIT, "bluesky", T0), 1);
  await P.syncSchedule(e, T0, { adapters, schedule });
  await P.runScheduled(e, Date.parse("2026-10-22T16:00:00Z"), { adapters });
  assert.equal(calls.length, 0, "cancelled post never goes out, even though it's still in the schedule");
  assert.equal(await P.restoreScheduled(e, KIT, "bluesky"), 1);
  await P.syncSchedule(e, Date.parse("2026-10-22T16:05:00Z"), { adapters, schedule });
  await P.runScheduled(e, Date.parse("2026-10-22T16:05:00Z"), { adapters });
  assert.equal(calls.length, 1);
});

// ------------------------------------------------------------------ recurring series

test("series off switch: series_team644=0 cancels that series' schedule rows, nothing else", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", ...BSKY_LIVE });
  await P.ensureSocialSchema(e);
  const adapters = { ...P.ADAPTERS, bluesky: okAdapter("bluesky", []) };
  const schedule = { posts: [
    { at: "2026-10-24T22:00:00Z", platform: "bluesky", kit: "2026-10-24-team-okc", series: "team644" },
    { at: "2026-10-24T16:00:00Z", platform: "bluesky", kit: KIT },
  ] };
  assert.equal(await P.syncSchedule(e, T0, { adapters, schedule }), 2);
  await P.setSetting(e, "series_team644", "0");
  await P.syncSchedule(e, T0, { adapters, schedule });
  const st = Object.fromEntries((await e.DB.prepare("SELECT kit_id, status FROM social_queue").all()).results.map((r) => [r.kit_id, r.status]));
  assert.equal(st["2026-10-24-team-okc"], "cancelled");
  assert.equal(st[KIT], "approved");
  assert.ok(P.SETTINGS_KEYS.includes("series_team644"));
});
