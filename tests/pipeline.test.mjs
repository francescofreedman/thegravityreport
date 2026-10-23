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
import { buildHandoffEmail } from "../social/handoff.js";
import * as S from "../social/series.js";

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
  return { DB: fakeD1(), ASSETS: fakeAssets(), SOCIAL_DRY_RUN: "1", SOCIAL_POTD: "0", SOCIAL_SERIES: "0", ...extra };
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
    if (r.skip) continue; // a retired kit: the row only cancels what's queued
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

test("schedule: a re-rendered kit (new v) refreshes a queued post that hasn't gone out", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", ...BSKY_LIVE });
  await P.ensureSocialSchema(e);
  const adapters = { ...P.ADAPTERS, bluesky: okAdapter("bluesky", []) };
  const row = { at: "2026-10-26T13:00:00Z", platform: "bluesky", kit: KIT, v: "aaaaaaaaaa", series: "tracker" };
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: [row] } });
  await e.DB.prepare("UPDATE social_queue SET payload = ?").bind(JSON.stringify({ posts: ["old numbers"], images: [], v: "aaaaaaaaaa" })).run();
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: [row] } });
  let p = JSON.parse((await e.DB.prepare("SELECT payload FROM social_queue").first()).payload);
  assert.equal(p.posts[0], "old numbers", "same version: untouched");
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: [{ ...row, v: "bbbbbbbbbb" }] } });
  p = JSON.parse((await e.DB.prepare("SELECT payload FROM social_queue").first()).payload);
  assert.notEqual(p.posts[0], "old numbers");
  assert.equal(p.v, "bbbbbbbbbb");
  await e.DB.prepare("UPDATE social_queue SET status = 'posted'").run();
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: [{ ...row, v: "cccccccccc" }] } });
  p = JSON.parse((await e.DB.prepare("SELECT payload FROM social_queue").first()).payload);
  assert.equal(p.v, "bbbbbbbbbb", "a posted row is never rewritten");
});

// ESPN standings fixture: the real table on Oct 21, 2026 (one game each), trimmed to the fields we read.
const STANDINGS = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/espn-standings.json"), "utf8"));
const TORQUE = JSON.parse(readFileSync(join(ROOT, "the30/torque-2026-27.json"), "utf8"));
// the same table with every record multiplied, so there's a season to talk about
function scaledStandings(k) {
  const d = structuredClone(STANDINGS);
  for (const c of d.children) for (const e of c.standings.entries) for (const s of e.stats) if (s.name === "wins" || s.name === "losses") s.value *= k;
  return d;
}
const standingsFetch = (data, calls = []) => async (url) => { calls.push(String(url)); return new Response(JSON.stringify(data)); };

test("series helpers: ISO week, weekday, date labels, packing", () => {
  assert.equal(S.isoWeek("2026-10-28"), "2026-W44");
  assert.equal(S.isoWeek("2027-01-03"), "2026-W53");
  assert.equal(S.weekday("2026-10-28"), 3, "Wednesday");
  assert.equal(S.weekday("2026-10-24"), 6, "Saturday");
  assert.equal(S.addDays("2026-10-30", -7), "2026-10-23");
  assert.equal(S.rangeLabel("2026-10-23", "2026-10-29"), "Oct 23–29");
  assert.equal(S.rangeLabel("2026-10-30", "2026-11-05"), "Oct 30–Nov 5");
  const posts = S.packPosts("head", Array.from({ length: 12 }, (_, i) => `line ${i} ` + "x".repeat(40)), "tail https://thegravityreport.com/");
  assert.ok(posts.length > 2 && posts.every(S.fits) && posts.at(-1).startsWith("tail"));
});

test("standings: every ESPN team maps to a TORQUE team, win pace vs projection", () => {
  const st = S.parseStandings(STANDINGS);
  assert.equal(Object.keys(st).length, 30);
  for (const t of TORQUE.teams) assert.ok(st[S.TORQUE_CODES[t.code] || t.code], t.code);
  assert.deepEqual(st.OKC, { w: 1, l: 0, name: "Oklahoma City Thunder" });
  assert.deepEqual(st.NYK, { w: 0, l: 1, name: "New York Knicks" });
  const early = S.paceTable(st, TORQUE);
  assert.match(early.reason, /too early: 0\.9 games/);
  const t = S.paceTable(S.parseStandings(scaledStandings(10)), TORQUE);
  assert.equal(t.reason, undefined);
  assert.equal(t.above.length, 3);
  assert.equal(t.below.length, 3);
  assert.ok(t.above[0].diff > t.above[1].diff && t.below[0].diff < t.below[1].diff);
  const okc = t.rows.find((r) => r.code === "OKC");
  assert.equal(okc.pace, 82);
  assert.equal(okc.projected, 66.7);
  const kit = S.paceKit(t, "https://thegravityreport.com", "2026-10-28");
  assert.match(kit.x_thread[0], /^Beating the projection\. TORQUE, our team model/);
  assert.match(kit.x_thread.join("\n"), /Ahead:\n/);
  assert.match(kit.x_thread.at(-1), /\/the30\/$/);
  for (const r of [...t.above, ...t.below]) {
    assert.ok(kit.instagram_caption.includes(`${S.city(r.team)}: ${r.w}-${r.l}, a pace of ${Math.round(r.pace)} wins; projected ${r.projected.toFixed(1)}`));
  }
  assert.equal(kit.images.ig, "/cards/the30.png");
});

test("beating the projection: Wednesdays 1 PM ET, once a week, skipped and marked when too early", async () => {
  const e = env({ SOCIAL_SERIES: "1" });
  await P.ensureSocialSchema(e);
  const calls = [];
  const wedEarly = Date.parse("2026-10-28T12:30:00Z"); // 8:30 AM ET: not yet
  assert.equal(await P.maybeQueuePace(e, wedEarly, { fetchImpl: standingsFetch(STANDINGS, calls) }), null);
  assert.equal(calls.length, 0);
  const wed = Date.parse("2026-10-28T13:30:00Z"); // 9:30 AM ET
  assert.equal(await P.maybeQueuePace(e, wed, { fetchImpl: standingsFetch(STANDINGS, calls) }), null, "one game a team: too early");
  assert.equal(calls.length, 1);
  const marked = await e.DB.prepare("SELECT value FROM social_settings WHERE key = 'pace_week_2026-W44'").first();
  assert.match(marked.value, /too early/);
  assert.equal(await P.maybeQueuePace(e, wed + 3600e3, { fetchImpl: standingsFetch(scaledStandings(10), calls) }), null, "marked: not retried this week");
  assert.equal(calls.length, 1);
  // next Wednesday, with a season's worth of games
  const e2 = env({ SOCIAL_SERIES: "1" });
  await P.ensureSocialSchema(e2);
  const tue = Date.parse("2026-11-03T15:00:00Z");
  assert.equal(await P.maybeQueuePace(e2, tue, { fetchImpl: standingsFetch(scaledStandings(10)) }), null, "not a Wednesday");
  const wed2 = Date.parse("2026-11-04T15:00:00Z"); // 10 AM ET
  assert.equal(await P.maybeQueuePace(e2, wed2, { fetchImpl: standingsFetch(scaledStandings(10)) }), "pace-2026-11-04");
  assert.equal(await P.maybeQueuePace(e2, wed2 + 60e3, { fetchImpl: standingsFetch(scaledStandings(10)) }), null, "once a week");
  const rows = (await e2.DB.prepare("SELECT platform, status, scheduled_at, payload FROM social_queue").all()).results;
  assert.deepEqual(rows.map((r) => r.platform).sort(), ["bluesky", "threads", "x"], "text-only weekly series skip Instagram");
  assert.ok(rows.every((r) => r.status === "approved" && r.scheduled_at === "2026-11-04T18:00:00.000Z"), "1 PM ET = 18:00 UTC in November");
  const th = JSON.parse(rows.find((r) => r.platform === "threads").payload);
  assert.equal(th.kind, "pace");
  assert.equal(JSON.parse(rows.find((r) => r.platform === "x").payload).images.length, 0, "text-only on X");
  // off switch
  const e3 = env({ SOCIAL_SERIES: "1" });
  await P.ensureSocialSchema(e3);
  await P.setSetting(e3, "series_pace", "0");
  assert.equal(await P.maybeQueuePace(e3, wed2, { fetchImpl: standingsFetch(scaledStandings(10)) }), null);
});

// ESPN over a week: the fixture game happened on Oct 21 only; a second copy with a different id on Oct 24
function weekFetch(calls = []) {
  return async (url) => {
    calls.push(url);
    const m = String(url).match(/dates=(\d{8})/);
    if (m) {
      const d = m[1];
      const events = d === "20261021" ? [{ id: "401909091", status: { type: { completed: true } } }]
        : d === "20261024" ? [{ id: "401909200", status: { type: { completed: true } } }] : [];
      return new Response(JSON.stringify({ events }));
    }
    if (String(url).includes("/summary")) return new Response(JSON.stringify(SUMMARY));
    return new Response("nf", { status: 404 });
  };
}

test("best games of the week: Fridays 1 PM ET, last Friday through Thursday, top 5 Game Scores among The 644, cached per day", async () => {
  const e = env({ SOCIAL_SERIES: "1" });
  await P.ensureSocialSchema(e);
  const calls = [];
  const thu = Date.parse("2026-10-29T15:00:00Z");
  assert.equal(await P.maybeQueueBest(e, thu, { fetchImpl: weekFetch(calls) }), null, "not a Friday");
  const fri = Date.parse("2026-10-30T15:00:00Z"); // 11 AM ET
  assert.equal(await P.maybeQueueBest(e, fri, { fetchImpl: weekFetch(calls) }), "best-2026-10-30");
  const days = calls.filter((u) => u.includes("/scoreboard")).map((u) => u.match(/dates=(\d+)/)[1]);
  assert.deepEqual(days, ["20261023", "20261024", "20261025", "20261026", "20261027", "20261028", "20261029"], "Fri → Thu");
  assert.equal(await P.maybeQueueBest(e, fri + 60e3, { fetchImpl: weekFetch(calls) }), null, "once a week");
  const rows = (await e.DB.prepare("SELECT platform, status, scheduled_at, payload FROM social_queue").all()).results;
  assert.equal(rows.length, 3, "X, Bluesky, Threads; Instagram is by hand and text-only series skip it");
  assert.ok(rows.every((r) => r.status === "approved" && r.scheduled_at === "2026-10-30T17:00:00.000Z"), "1 PM EDT");
  const x = JSON.parse(rows.find((r) => r.platform === "x").payload);
  assert.equal(x.kind, "best");
  assert.match(x.posts[0], /^The best games of the week \(Oct 23–29\), by Game Score/);
  assert.match(x.posts.join("\n"), /1\. Anthony Edwards, MIN: 45\/10\/3 at MIA\. #22 in The 644\./);
  assert.match(x.posts.join("\n"), /2\. /);
  assert.ok(!x.posts.join("\n").includes("6. "), "five lines at most");
  assert.match(x.posts.at(-1), /\/the644\/$/);
  assert.equal(x.images.length, 0, "text-only on X");
  assert.ok(!rows.find((r) => r.platform === "instagram"), "Instagram is posted by hand; this text-only series skips it");
  // the per-day cache: the next Friday re-reads Oct 24's lines without fetching them again
  const n = calls.length;
  const fri2 = Date.parse("2026-11-06T15:00:00Z");
  await P.maybeQueueBest(e, fri2, { fetchImpl: weekFetch(calls) });
  const again = calls.slice(n).filter((u) => u.includes("dates=20261024") || u.includes("dates=20261029"));
  assert.equal(again.length, 0, "days already fetched come from social_cache");
  const cached = await e.DB.prepare("SELECT COUNT(*) AS n FROM social_cache").first();
  assert.ok(cached.n >= 14);
  const settings = await P.getSettings(e);
  assert.ok(!Object.keys(settings).some((k) => k.startsWith("lines_")), "cached lines never show up as settings");
});

test("who's higher: Saturdays 11 AM ET with an X poll, answer queued for Sunday 11 AM, pairs rotate by week", async () => {
  const players = JSON.parse(readFileSync(join(ROOT, "content/the644.json"), "utf8")).players;
  const pairs = new Set();
  for (let w = 1; w <= 50; w++) {
    const [a, b] = S.pollPair(players, w);
    assert.equal(Math.abs(a.r - b.r), 1, "adjacent ranks");
    assert.ok(Math.max(a.r, b.r) <= 100);
    pairs.add(Math.min(a.r, b.r));
  }
  assert.equal(pairs.size, 50, "fifty weeks, fifty different pairs");
  assert.ok(players.slice(0, 100).every((p) => S.pollOption(p).length <= 25));
  const e = env({ SOCIAL_SERIES: "1" });
  await P.ensureSocialSchema(e);
  const fri = Date.parse("2026-10-30T15:00:00Z");
  assert.equal(await P.maybeQueuePoll(e, fri), null, "not a Saturday");
  const sat = Date.parse("2026-10-31T14:00:00Z"); // 10 AM ET
  assert.equal(await P.maybeQueuePoll(e, sat), "poll-2026-10-31");
  assert.equal(await P.maybeQueuePoll(e, sat + 60e3), null, "once a week");
  const rows = (await e.DB.prepare("SELECT kit_id, platform, status, scheduled_at, payload FROM social_queue ORDER BY kit_id, platform").all()).results;
  assert.equal(rows.length, 6);
  const q = rows.filter((r) => r.kit_id === "poll-2026-10-31"), a = rows.filter((r) => r.kit_id === "poll-2026-10-31-answer");
  assert.ok(q.every((r) => r.status === "approved" && r.scheduled_at === "2026-10-31T15:00:00.000Z"), "11 AM EDT");
  assert.ok(a.every((r) => r.status === "approved" && r.scheduled_at === "2026-11-01T16:00:00.000Z"), "Sunday 11 AM EST (clocks went back)");
  const x = JSON.parse(q.find((r) => r.platform === "x").payload);
  assert.equal(x.poll.options.length, 2);
  assert.equal(x.poll.duration_minutes, 1440);
  assert.match(x.posts[0], /^Who's higher in The 644, our ranking of every NBA player\? Answer tomorrow at 11 AM ET\./);
  assert.ok(!/#\d/.test(x.posts[0]), "the question never shows a rank");
  const b = JSON.parse(q.find((r) => r.platform === "bluesky").payload);
  assert.match(b.posts[0], /Reply with your pick/);
  assert.equal(b.poll, undefined);
  const ans = JSON.parse(a.find((r) => r.platform === "x").payload);
  assert.match(ans.posts[0], /^Who's higher\? The answer: .+, #\d+ of 644 in The 644, GRAVITY score \d+\.\d \(50 is a league-average minute\)\. .+ is #\d+, GRAVITY score \d+\.\d\./);
  assert.ok(ans.images[0].path.startsWith("/players/"), "the answer carries the winner's card");
  for (const r of rows) assert.ok(JSON.parse(r.payload).kind === "poll");
  // the X adapter sends the poll and never attaches media to it
  const seen = [];
  const f = async (url, init) => { seen.push(JSON.parse(init.body)); return new Response(JSON.stringify({ data: { id: "t1" } })); };
  const xe = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" };
  await xad.post(xe, { ...x, images: [{ bytes: new Uint8Array([1]), alt: "" }] }, f);
  assert.deepEqual(seen[0].poll, { options: x.poll.options, duration_minutes: 1440 });
  assert.equal(seen[0].media, undefined);
  assert.equal(seen.length, 1, "no media upload call for a poll");
});

test("metrics: once a week, Bluesky from the public API, X null, Threads/Instagram only with tokens, posts sent from the log", async () => {
  const { followers } = await import("../social/metrics.js");
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    const u = String(url);
    if (u.startsWith("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=thegravityreport.bsky.social")) {
      return new Response(JSON.stringify({ handle: "thegravityreport.bsky.social", followersCount: 12, followsCount: 2, postsCount: 0 }));
    }
    if (u.includes("graph.instagram.com")) return new Response(JSON.stringify({ followers_count: 7, id: "2" }));
    if (u.includes("threads_insights")) return new Response(JSON.stringify({ data: [{ name: "followers_count", total_value: { value: 3 } }] }));
    return new Response("nf", { status: 404 });
  };
  assert.deepEqual(await followers({}, "x", f), { followers: null, skipped: "no free follower endpoint on X's pay-per-use plan" });
  assert.deepEqual(await followers({}, "threads", f), { followers: null, skipped: "Threads not connected" });
  assert.equal((await followers({ THREADS_USER_ID: "1", THREADS_ACCESS_TOKEN: "t" }, "threads", f)).followers, 3);
  assert.equal((await followers({ IG_USER_ID: "2", IG_ACCESS_TOKEN: "t" }, "instagram", f)).followers, 7);
  const e = env({ SOCIAL_SERIES: "1", SOCIAL_DRY_RUN: "0", ...BSKY_LIVE, BSKY_HANDLE: "thegravityreport.bsky.social" });
  await P.ensureSocialSchema(e);
  // two Bluesky posts went out this week, one a month ago
  await e.DB.prepare("INSERT INTO social_log (ts, platform, queue_id, action, count) VALUES ('2026-10-20T15:00:00.000Z', 'bluesky', 1, 'posted', 2)").run();
  await e.DB.prepare("INSERT INTO social_log (ts, platform, queue_id, action, count) VALUES ('2026-09-20T15:00:00.000Z', 'bluesky', 2, 'posted', 1)").run();
  const r = await P.maybeCollectMetrics(e, T0, { fetchImpl: f });
  assert.equal(r.week, "2026-W43");
  assert.equal(await P.maybeCollectMetrics(e, T0 + 86400000, { fetchImpl: f }), null, "once a week");
  assert.equal(calls.filter((u) => u.includes("bsky")).length, 1, "no token needed, one public call");
  assert.ok(!calls.some((u) => u.includes("api.x.com")), "X is never called");
  const weeks = await P.metricsView(e);
  assert.equal(weeks.length, 1);
  assert.deepEqual(weeks[0].platforms.bluesky, { followers: 12, posts_sent_week: 2, clicks: null });
  assert.deepEqual(weeks[0].platforms.x, { followers: null, posts_sent_week: 0, clicks: null });
  assert.equal(weeks[0].platforms.instagram.followers, null, "no token: skipped, not invented");
  // the admin API serves it
  e.ADMIN_KEY = "k-k-k-k-k-k";
  const res = await handleAdmin(new Request("https://t/api/admin/metrics", { headers: { "x-admin-key": "k-k-k-k-k-k" } }), e);
  assert.equal((await res.json()).weeks[0].platforms.bluesky.followers, 12);
  // off switch
  const e2 = env({ SOCIAL_SERIES: "1" });
  await P.ensureSocialSchema(e2);
  await P.setSetting(e2, "series_metrics", "0");
  assert.equal(await P.maybeCollectMetrics(e2, T0, { fetchImpl: f }), null);
});

test("player of the day shares the day's cached lines with the Friday round-up", async () => {
  const e = env({ SOCIAL_POTD: "1" });
  await P.ensureSocialSchema(e);
  const calls = [];
  const nine = Date.parse("2026-10-22T13:05:00Z");
  assert.equal(await P.maybeQueuePotd(e, nine, { fetchImpl: espnFetch(calls) }), "potd-2026-10-22");
  const row = await e.DB.prepare("SELECT value FROM social_cache WHERE key = 'lines_2026-10-21'").first();
  const day = JSON.parse(row.value);
  assert.equal(day.games, 1);
  assert.equal(day.lines[0].name, "Anthony Edwards");
  assert.equal(day.lines[0].team, "MIN");
  assert.equal(day.lines[0].home, false);
  assert.ok(day.lines.every((l) => l.gs != null));
});

test("schedule: moving a failed post's time retries it once; leaving it alone does not", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", ...BSKY_LIVE });
  await P.ensureSocialSchema(e);
  const calls = [];
  let fail = true;
  const adapters = { ...P.ADAPTERS, bluesky: { name: "bluesky", configured: () => true, async post(_, payload) {
    if (fail) throw new Error("bluesky 402: no credit"); calls.push(payload); return { remote_id: "b-1", count: payload.posts.length }; } } };
  const t1 = "2026-10-22T23:45:00Z";
  await P.syncSchedule(e, Date.parse(t1), { adapters, schedule: { posts: [{ at: t1, platform: "bluesky", kit: KIT }] } });
  await P.runScheduled(e, Date.parse(t1), { adapters });
  let row = await e.DB.prepare("SELECT status FROM social_queue").first();
  assert.equal(row.status, "failed");
  fail = false;
  await P.syncSchedule(e, Date.parse(t1) + 600e3, { adapters, schedule: { posts: [{ at: t1, platform: "bluesky", kit: KIT }] } });
  await P.runScheduled(e, Date.parse(t1) + 600e3, { adapters });
  assert.equal(calls.length, 0, "same time: stays failed");
  const t2 = "2026-10-23T00:10:00Z";
  await P.syncSchedule(e, Date.parse(t2), { adapters, schedule: { posts: [{ at: t2, platform: "bluesky", kit: KIT }] } });
  await P.runScheduled(e, Date.parse(t2), { adapters });
  assert.equal(calls.length, 1, "moved time: retried");
  row = await e.DB.prepare("SELECT status FROM social_queue").first();
  assert.equal(row.status, "posted");
});

// ------------------------------------------------------------------ hand-off by email

test("hand-off: Instagram + Threads rows are emailed 15-30 min early in one email, marked handoff, never posted", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", SOCIAL_MANUAL_PLATFORMS: "instagram,threads", HANDOFF_TO: "me@example.com", EMAIL: {} });
  await P.ensureSocialSchema(e);
  const sent = [], calls = [];
  const adapters = Object.fromEntries(P.PLATFORMS.map((p) => [p, okAdapter(p, calls)]));
  const at = "2026-10-23T22:00:00Z"; // 6 PM ET
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: ["instagram", "threads", "bluesky"].map((platform) => ({ at, platform, kit: KIT })) } });
  const sendEmail = async (_env, from, to, raw) => { sent.push({ from, to, raw }); };
  await P.runScheduled(e, Date.parse(at) - 45 * 60e3, { adapters, sendEmail });
  assert.equal(sent.length, 0, "45 minutes early is too early");
  const r = await P.runScheduled(e, Date.parse(at) - 20 * 60e3, { adapters, sendEmail });
  assert.equal(sent.length, 1, "one email for both platforms");
  assert.equal(sent[0].to, "me@example.com");
  assert.match(sent[0].raw, /^From: The Gravity Report <posts@thegravityreport.com>\r\nTo: me@example.com\r\nSubject: Post this on Instagram \+ Threads at 6:00 PM ET: The Kawhi Anomaly/);
  assert.match(sent[0].raw, /Content-Disposition: attachment; filename="2026-10-20-article-kawhi-ig-1080x1350-1.png"/);
  assert.match(sent[0].raw, /Content-Type: multipart\/mixed/);
  assert.deepEqual(r.handoff.map((x) => x.result), ["handoff", "handoff"]);
  const rows = (await e.DB.prepare("SELECT platform, status FROM social_queue ORDER BY platform").all()).results;
  assert.deepEqual(rows.map((x) => [x.platform, x.status]), [["bluesky", "approved"], ["instagram", "handoff"], ["threads", "handoff"]]);
  await P.runScheduled(e, Date.parse(at) + 60e3, { adapters, sendEmail });
  assert.equal(sent.length, 1, "not emailed twice");
  assert.deepEqual(calls.map((c) => c.name), ["bluesky"], "the Worker posts Bluesky itself, never Instagram or Threads");
});

test("hand-off: without HANDOFF_TO the rows wait as approved and are never consumed by the posting loop", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", SOCIAL_MANUAL_PLATFORMS: "instagram" });
  await P.ensureSocialSchema(e);
  const adapters = { ...P.ADAPTERS, instagram: { ...okAdapter("instagram", []), configured: () => false } };
  const at = "2026-10-23T22:00:00Z";
  await P.syncSchedule(e, T0, { adapters, schedule: { posts: [{ at, platform: "instagram", kit: KIT }] } });
  await P.runScheduled(e, Date.parse(at) + 3600e3, { adapters });
  const row = await e.DB.prepare("SELECT status FROM social_queue").first();
  assert.equal(row.status, "approved");
  const logged = (await e.DB.prepare("SELECT action FROM social_log").all()).results.map((l) => l.action);
  assert.ok(logged.includes("handoff_unconfigured"));
});

test("hand-off email: caption and how-to are in the body, images attached once", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const { subject, raw } = buildHandoffEmail({ from: "posts@thegravityreport.com", to: "me@example.com", title: "Test", atMs: Date.parse("2026-10-23T14:00:00Z"),
    items: [{ platform: "instagram", payload: { caption: "Hello caption #NBA" }, images: [{ name: "a.png", type: "image/png", bytes: png }] },
            { platform: "threads", payload: { posts: ["Hello threads"] }, images: [{ name: "a.png", type: "image/png", bytes: png }] }], nowMs: 0 });
  assert.equal(subject, "Post this on Instagram + Threads at 10:00 AM ET: Test");
  const body = Buffer.from(raw.split("Content-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(body, /Hello caption #NBA/);
  assert.match(body, /Hello threads/);
  assert.match(body, /Save the attached image/);
  assert.equal((raw.match(/filename="a.png"/g) || []).length, 1);
});

test("health view: public, no post text, shows last error per platform", async () => {
  const e = env({ SOCIAL_DRY_RUN: "0", ...BSKY_LIVE });
  await P.ensureSocialSchema(e);
  const adapters = { ...P.ADAPTERS, bluesky: { name: "bluesky", configured: () => true, async post() { throw new Error("bluesky 402: Payment Required"); } } };
  const at = "2026-10-22T23:45:00Z";
  await P.syncSchedule(e, Date.parse(at), { adapters, schedule: { posts: [{ at, platform: "bluesky", kit: KIT }] } });
  await P.runScheduled(e, Date.parse(at), { adapters });
  const h = await P.healthView(e, Date.parse(at), adapters);
  assert.equal(h.platforms.bluesky.last_error, "bluesky 402: Payment Required");
  assert.deepEqual(h.platforms.bluesky.recent, ["failed@2026-10-22T23:45"]);
  assert.ok(!JSON.stringify(h).includes("Kawhi"), "no post text leaks");
});
