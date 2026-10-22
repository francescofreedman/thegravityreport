// Social posting pipeline: queue in D1, approval, scheduled posting, player of the day.
//
// Safety: nothing is ever sent to a platform unless env.SOCIAL_DRY_RUN === "0" AND that
// platform's secrets exist. Otherwise a due item is marked "simulated" and logged as
// "would post". Each row is claimed atomically (approved -> posting) so overlapping cron
// runs can never post the same item twice; failed items are never retried automatically.
import * as x from "./adapters/x.js";
import * as bluesky from "./adapters/bluesky.js";
import { threads, instagram } from "./adapters/meta.js";
import { etParts, etToUtcMs, prevDate, normName, gameScore, pickBest, potdKitFromPerformance, fetchLastNight, POTD_HOUR_ET } from "./potd.js";
import { STANDINGS_URL, weekday, addDays, isoWeek, parseStandings, paceTable, paceKit, bestKit, pollPair, pollKits } from "./series.js";
import { followers } from "./metrics.js";

export const ADAPTERS = { x, bluesky, threads, instagram };
export const PLATFORMS = ["x", "bluesky", "threads", "instagram"];
export const SITE_URL = "https://thegravityreport.com";
export const SEASON_START = "2026-10-20";
// Every recurring series has an off switch: series_<name> = "0" in social_settings (default on).
export const SERIES = ["team644", "tracker", "pace", "best", "poll", "archive", "metrics"];
export const SETTINGS_KEYS = ["potd_on", "potd_auto_approve", "potd_platforms", "potd_hour_utc", ...SERIES.map((s) => `series_${s}`)];
const DEFAULT_CAPS = { x: 60, bluesky: 300, threads: 200, instagram: 60 };

let ready = null;
export function ensureSocialSchema(env) {
  if (!ready) {
    ready = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS social_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kit_id TEXT NOT NULL, platform TEXT NOT NULL,
        payload TEXT NOT NULL, scheduled_at TEXT, status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL, approved_at TEXT, posted_at TEXT, remote_id TEXT, error TEXT,
        UNIQUE(kit_id, platform))`),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS social_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS social_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, platform TEXT, queue_id INTEGER,
        action TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, detail TEXT)`),
      // fetched data kept for the weekly series (a day's best box-score lines), never shown as settings
      env.DB.prepare("CREATE TABLE IF NOT EXISTS social_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts TEXT NOT NULL)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS social_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, platform TEXT NOT NULL,
        followers INTEGER, posts_sent_week INTEGER NOT NULL DEFAULT 0, clicks INTEGER)`),
    ]).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export function resetSchemaCache() { ready = null; }

const iso = (ms) => new Date(ms).toISOString();

export async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM social_settings").all();
  const s = { potd_on: "1", potd_auto_approve: "1", potd_platforms: "x,bluesky,threads,instagram", potd_hour_utc: "14" };
  for (const r of results || []) s[r.key] = r.value;
  return s;
}

export function seriesOff(settings, name) {
  return !!name && settings[`series_${name}`] === "0";
}

export async function setSetting(env, key, value) {
  if (!SETTINGS_KEYS.includes(key)) throw new Error("unknown setting");
  await env.DB.prepare("INSERT INTO social_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, String(value)).run();
}

async function log(env, nowMs, platform, queueId, action, count, detail) {
  await env.DB.prepare("INSERT INTO social_log (ts, platform, queue_id, action, count, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(iso(nowMs), platform, queueId, action, count, detail ? String(detail).slice(0, 1000) : null).run();
}

async function assetJson(env, path) {
  const res = await env.ASSETS.fetch(new Request(SITE_URL + path));
  if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------------ kits -> queue rows

function absPath(kitId, p) {
  return p.startsWith("/") ? p : `/social/kits/${kitId}/${p}`;
}

export function payloadsFromKit(kitId, kit) {
  const card = kit.images && kit.images.card ? absPath(kitId, kit.images.card) : null;
  const igOnly = kit.images && kit.images.ig ? absPath(kitId, kit.images.ig) : null; // Instagram needs an image; the others stay text
  const altFor = (p) => (kit.alt && (kit.alt[p] || kit.alt.card)) || "";
  const carousel = ((kit.images && kit.images.carousel) || []).map((p) => absPath(kitId, p));
  const cardAlt = card ? altFor(kit.images.card) : "";
  return {
    x: { posts: kit.x_thread, images: card ? [{ path: card, alt: cardAlt }] : [] },
    bluesky: { posts: kit.bluesky_thread, images: card ? [{ path: card, alt: cardAlt, width: 1200, height: card.includes("/players/") || card.includes("/cards/") ? 630 : 675 }] : [] },
    threads: { posts: [kit.threads], image_urls: card ? [SITE_URL + card] : [] },
    instagram: { caption: kit.instagram_caption, image_urls: (carousel.length ? carousel : card ? [card] : igOnly ? [igOnly] : []).map((p) => SITE_URL + p) },
  };
}

export async function importKit(env, kitId, { platforms = PLATFORMS, scheduledAt = null, nowMs = Date.now(), kit = null } = {}) {
  if (!/^[a-z0-9-]+$/.test(kitId)) throw new Error("bad kit id");
  kit = kit || (await assetJson(env, `/social/kits/${kitId}/kit.json`));
  const p = payloadsFromKit(kitId, kit);
  let added = 0;
  for (const pl of platforms) {
    if (!p[pl]) continue;
    const r = await env.DB.prepare(
      "INSERT OR IGNORE INTO social_queue (kit_id, platform, payload, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, 'draft', ?)"
    ).bind(kitId, pl, JSON.stringify(p[pl]), scheduledAt, iso(nowMs)).run();
    added += (r.meta && r.meta.changes) || 0;
  }
  return added;
}

export async function approve(env, id, scheduledAt, nowMs = Date.now()) {
  const r = await env.DB.prepare(
    "UPDATE social_queue SET status = 'approved', approved_at = ?, scheduled_at = COALESCE(?, scheduled_at, ?) WHERE id = ? AND status IN ('draft', 'rejected')"
  ).bind(iso(nowMs), scheduledAt || null, iso(nowMs), id).run();
  return (r.meta && r.meta.changes) || 0;
}

export async function approveWeek(env, nowMs = Date.now()) {
  const until = iso(nowMs + 7 * 86400000);
  const r = await env.DB.prepare(
    "UPDATE social_queue SET status = 'approved', approved_at = ?, scheduled_at = COALESCE(scheduled_at, ?) WHERE status = 'draft' AND (scheduled_at IS NULL OR scheduled_at <= ?)"
  ).bind(iso(nowMs), iso(nowMs), until).run();
  return (r.meta && r.meta.changes) || 0;
}

export async function setStatus(env, id, status, from) {
  const r = await env.DB.prepare(`UPDATE social_queue SET status = ? WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`)
    .bind(status, id, ...from).run();
  return (r.meta && r.meta.changes) || 0;
}

export async function schedule(env, id, scheduledAt) {
  const r = await env.DB.prepare("UPDATE social_queue SET scheduled_at = ? WHERE id = ? AND status IN ('draft', 'approved')")
    .bind(scheduledAt, id).run();
  return (r.meta && r.meta.changes) || 0;
}

// ------------------------------------------------------------------ player of the day
// Last night's best game, automatically (social/potd.js). On by default; potd_on = "0" turns it off.

export async function maybeQueuePotd(env, nowMs, { fetchImpl = fetch, schedule = null } = {}) {
  const s = await getSettings(env);
  if (s.potd_on === "0" || env.SOCIAL_POTD === "0") return null;
  const { date, hour } = etParts(nowMs);
  if (hour < 9) return null;
  const kitId = `potd-${date}`;
  const done = await env.DB.prepare("SELECT value FROM social_settings WHERE key = ?").bind(`potd_checked_${date}`).first();
  if (done) return null;
  const mark = (v) => env.DB.prepare("INSERT OR REPLACE INTO social_settings (key, value) VALUES (?, ?)").bind(`potd_checked_${date}`, v).run();
  // a player picked by hand for today wins
  const manual = await env.DB.prepare("SELECT id FROM social_queue WHERE kit_id LIKE ? LIMIT 1").bind(`${date}-player-%`).first();
  const inSchedule = schedule && (schedule.posts || []).some((r) => r.kit.startsWith(`${date}-player-`));
  if (manual || inSchedule) { await mark("manual"); return null; }
  const { byName, n } = await players644(env);
  const { games, lines } = await linesFor(env, prevDate(date), fetchImpl, byName);
  if (!games) { await mark("no games"); return null; }
  const best = pickBest(lines, byName);
  if (!best) { await mark("no big night"); return null; }
  const kit = potdKitFromPerformance(best.p, best.p.team, best.g, SITE_URL, n);
  const at = Math.max(nowMs, etToUtcMs(date, POTD_HOUR_ET));
  await queueSeries(env, kitId, kit, at, nowMs);
  await mark(best.p.slug);
  await log(env, nowMs, null, null, "potd_picked", 0, `${best.p.n} (Game Score ${best.gs.toFixed(1)}): ${kit.x_thread[0]}`);
  return kitId;
}

// ------------------------------------------------------------------ Worker-written series: shared pieces

// The 644 by normalised name, each record carrying its slug and team name from players/index.json.
async function players644(env) {
  const idx = await assetJson(env, "/players/index.json");
  const t644 = await assetJson(env, "/content/the644.json");
  const rec = new Map(t644.players.map((x) => [x.r, x]));
  const byName = new Map(idx.players.map((x) => [normName(x.n), { ...rec.get(x.r), slug: x.slug, team: x.team }]));
  return { byName, players: t644.players, n: t644.players.length };
}

// One day's box-score lines for players in The 644 (top 25 by Game Score), fetched once and kept
// in social_cache so the morning pick and the Friday round-up share one ESPN visit per day.
export async function linesFor(env, dateStr, fetchImpl, byName) {
  const key = `lines_${dateStr}`;
  const hit = await env.DB.prepare("SELECT value FROM social_cache WHERE key = ?").bind(key).first();
  if (hit) return JSON.parse(hit.value);
  const { games, lines } = await fetchLastNight(dateStr, fetchImpl);
  const kept = lines.filter((l) => byName.has(normName(l.name)))
    .map((l) => ({ ...l, date: dateStr, gs: Number(gameScore(l.line).toFixed(2)) }))
    .sort((a, b) => b.gs - a.gs).slice(0, 25);
  const out = { games, lines: kept };
  await env.DB.prepare("INSERT OR REPLACE INTO social_cache (key, value, ts) VALUES (?, ?, ?)").bind(key, JSON.stringify(out), iso(Date.now())).run();
  return out;
}

// Approved rows for a Worker-written kit on every platform; the payload carries title/kind for the dashboard.
export async function queueSeries(env, kitId, kit, atMs, nowMs, platforms = PLATFORMS) {
  const p = payloadsFromKit(kitId, kit);
  let added = 0;
  for (const pl of platforms) {
    if (!p[pl]) continue;
    const payload = { ...p[pl], title: kit.title, kind: kit.kind };
    if (kit.poll && pl === "x") payload.poll = kit.poll;
    const r = await env.DB.prepare(
      "INSERT OR IGNORE INTO social_queue (kit_id, platform, payload, scheduled_at, status, created_at, approved_at) VALUES (?, ?, ?, ?, 'approved', ?, ?)"
    ).bind(kitId, pl, JSON.stringify(payload), iso(atMs), iso(nowMs), iso(nowMs)).run();
    added += (r.meta && r.meta.changes) || 0;
  }
  return added;
}

// A weekly series runs once per ISO week, on its weekday between 9 AM and 6 PM ET, and posts at
// hourEt (or right away if the Worker only woke up later that day). Marker: <name>_week_<week>.
async function weeklySlot(env, name, nowMs, day, hourEt) {
  if (env.SOCIAL_SERIES === "0") return null; // every Worker-written weekly series off (tests)
  const s = await getSettings(env);
  if (seriesOff(s, name)) return null;
  const { date, hour } = etParts(nowMs);
  if (weekday(date) !== day || hour < 9 || hour > 18) return null;
  const week = isoWeek(date);
  const key = `${name}_week_${week}`;
  const done = await env.DB.prepare("SELECT value FROM social_settings WHERE key = ?").bind(key).first();
  if (done) return null;
  const mark = (v) => env.DB.prepare("INSERT OR REPLACE INTO social_settings (key, value) VALUES (?, ?)").bind(key, String(v)).run();
  return { date, week, at: Math.max(nowMs, etToUtcMs(date, hourEt)), mark };
}

// ------------------------------------------------------------------ Beating the projection (Wednesdays 1 PM ET)

export async function maybeQueuePace(env, nowMs, { fetchImpl = fetch } = {}) {
  const slot = await weeklySlot(env, "pace", nowMs, 3, 13);
  if (!slot) return null;
  const res = await fetchImpl(STANDINGS_URL);
  if (!res.ok) throw new Error(`standings ${res.status}`);
  const standings = parseStandings(await res.json());
  const torque = await assetJson(env, "/the30/torque-2026-27.json");
  const table = paceTable(standings, torque);
  if (table.reason) { await slot.mark(table.reason); await log(env, nowMs, null, null, "pace_skipped", 0, table.reason); return null; }
  const kitId = `pace-${slot.date}`;
  const kit = paceKit(table, SITE_URL, slot.date);
  await queueSeries(env, kitId, kit, slot.at, nowMs);
  await slot.mark(kitId);
  await log(env, nowMs, null, null, "pace_queued", 0, kit.x_thread[0]);
  return kitId;
}

// ------------------------------------------------------------------ Best games of the week (Fridays 1 PM ET)

export async function maybeQueueBest(env, nowMs, { fetchImpl = fetch } = {}) {
  const slot = await weeklySlot(env, "best", nowMs, 5, 13);
  if (!slot) return null;
  const { byName, n } = await players644(env);
  const from = addDays(slot.date, -7), to = addDays(slot.date, -1); // last Friday through yesterday (Thursday)
  const lines = [];
  for (let d = from; d <= to; d = addDays(d, 1)) lines.push(...(await linesFor(env, d, fetchImpl, byName)).lines);
  const kit = bestKit(lines, byName, normName, from, to, SITE_URL, slot.date, n);
  if (!kit) { await slot.mark("no games"); await log(env, nowMs, null, null, "best_skipped", 0, "no games"); return null; }
  const kitId = `best-${slot.date}`;
  await queueSeries(env, kitId, kit, slot.at, nowMs);
  await slot.mark(kitId);
  await log(env, nowMs, null, null, "best_queued", 0, kit.x_thread[0]);
  return kitId;
}

// ------------------------------------------------------------------ Who's higher? (Saturdays 11 AM ET, answer Sunday 11 AM ET)

export async function maybeQueuePoll(env, nowMs) {
  const slot = await weeklySlot(env, "poll", nowMs, 6, 11);
  if (!slot) return null;
  const { byName, players, n } = await players644(env);
  const pair = pollPair(players, Number(slot.week.slice(-2)));
  if (!pair) { await slot.mark("no pair"); return null; }
  const [a, b] = pair.map((p) => byName.get(normName(p.n)) || p);
  const { poll, answer } = pollKits(a, b, SITE_URL, slot.date, n);
  const kitId = `poll-${slot.date}`;
  await queueSeries(env, kitId, poll, slot.at, nowMs);
  await queueSeries(env, `${kitId}-answer`, answer, etToUtcMs(addDays(slot.date, 1), 11), nowMs);
  await slot.mark(kitId);
  await log(env, nowMs, null, null, "poll_queued", 0, poll.x_thread[0]);
  return kitId;
}

// ------------------------------------------------------------------ metrics (weekly, first cron tick of each ISO week)

export async function maybeCollectMetrics(env, nowMs, { fetchImpl = fetch } = {}) {
  if (env.SOCIAL_SERIES === "0") return null;
  const s = await getSettings(env);
  if (seriesOff(s, "metrics")) return null;
  const week = isoWeek(iso(nowMs).slice(0, 10));
  const key = `metrics_week_${week}`;
  if (await env.DB.prepare("SELECT value FROM social_settings WHERE key = ?").bind(key).first()) return null;
  await env.DB.prepare("INSERT OR REPLACE INTO social_settings (key, value) VALUES (?, ?)").bind(key, iso(nowMs)).run();
  const since = iso(nowMs - 7 * 86400000);
  const out = [];
  for (const pl of PLATFORMS) {
    let f = { followers: null, skipped: null };
    try { f = await followers(env, pl, fetchImpl); } catch (e) { await log(env, nowMs, pl, null, "metrics_error", 0, e.message); }
    if (f.skipped) await log(env, nowMs, pl, null, "metrics_skipped", 0, f.skipped);
    const sent = await env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM social_log WHERE platform = ? AND action = 'posted' AND ts >= ?")
      .bind(pl, since).first();
    await env.DB.prepare("INSERT INTO social_metrics (ts, platform, followers, posts_sent_week, clicks) VALUES (?, ?, ?, ?, NULL)")
      .bind(iso(nowMs), pl, f.followers, Number((sent && sent.n) || 0)).run();
    out.push({ platform: pl, followers: f.followers, posts_sent_week: Number((sent && sent.n) || 0) });
  }
  return { week, rows: out };
}

// the last `weeks` collections, newest first: [{ts, platforms: {x: {followers, posts_sent_week, clicks}, …}}]
export async function metricsView(env, weeks = 8) {
  const { results } = await env.DB.prepare(
    "SELECT ts, platform, followers, posts_sent_week, clicks FROM social_metrics ORDER BY ts DESC, id DESC LIMIT ?"
  ).bind(weeks * PLATFORMS.length).all();
  const byTs = new Map();
  for (const r of results || []) {
    if (!byTs.has(r.ts)) byTs.set(r.ts, { ts: r.ts, platforms: {} });
    byTs.get(r.ts).platforms[r.platform] = { followers: r.followers, posts_sent_week: r.posts_sent_week, clicks: r.clicks };
  }
  return Array.from(byTs.values()).slice(0, weeks);
}

// ------------------------------------------------------------------ posting

export function isLive(env, platform, adapters = ADAPTERS) {
  return env.SOCIAL_DRY_RUN === "0" && !!adapters[platform] && adapters[platform].configured(env);
}

export function capFor(env, platform) {
  const v = Number(env[`SOCIAL_${platform.toUpperCase()}_MONTHLY_CAP`]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CAPS[platform];
}

async function usedThisMonth(env, platform, nowMs) {
  const start = iso(nowMs).slice(0, 7) + "-01T00:00:00.000Z";
  const r = await env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM social_log WHERE platform = ? AND action = 'posted' AND ts >= ?")
    .bind(platform, start).first();
  return Number((r && r.n) || 0);
}

async function loadImages(env, images) {
  const out = [];
  for (const im of images || []) {
    const res = await env.ASSETS.fetch(new Request(SITE_URL + im.path));
    if (!res.ok) throw new Error(`image ${im.path}: ${res.status}`);
    out.push({ ...im, bytes: new Uint8Array(await res.arrayBuffer()) });
  }
  return out;
}

// ------------------------------------------------------------------ schedule
//
// social/schedule.json is the plan: "this post goes on this platform at this time". Approving the
// schedule (committing it) approves every row in it. Each cron tick copies rows into the queue as
// approved; a row already in the queue is moved to its new time if it hasn't gone out yet. A row
// marked "skip": true is cancelled. Rows only simulated in dry run (or skipped because the platform
// wasn't connected) are re-armed once the platform is live, unless their time is more than
// REARM_WINDOW_MS in the past, so going live never dumps a backlog of old posts at once.
// A row carries "v", a hash of its kit: when the kit is re-rendered (the weekly tracker gets fresh
// numbers), the queued post that hasn't gone out yet is refreshed from the new kit.
export const REARM_WINDOW_MS = 2 * 3600 * 1000;

export async function syncSchedule(env, nowMs = Date.now(), { adapters = ADAPTERS, schedule = null } = {}) {
  if (!schedule) {
    const res = await env.ASSETS.fetch(new Request(SITE_URL + "/social/schedule.json"));
    if (res.status === 404) return 0;
    if (!res.ok) throw new Error(`asset /social/schedule.json: ${res.status}`);
    schedule = await res.json();
  }
  const settings = await getSettings(env);
  let added = 0;
  for (const row of schedule.posts || []) {
    if (!PLATFORMS.includes(row.platform) || !/^[a-z0-9-]+$/.test(row.kit || "")) continue;
    const at = new Date(row.at).toISOString();
    if (row.skip || seriesOff(settings, row.series)) {
      await env.DB.prepare("UPDATE social_queue SET status = 'cancelled' WHERE kit_id = ? AND platform = ? AND status IN ('draft', 'approved')")
        .bind(row.kit, row.platform).run();
      continue;
    }
    const exists = await env.DB.prepare("SELECT id, status, payload FROM social_queue WHERE kit_id = ? AND platform = ?").bind(row.kit, row.platform).first();
    if (!exists) {
      const kit = await assetJson(env, `/social/kits/${row.kit}/kit.json`);
      const p = { ...payloadsFromKit(row.kit, kit)[row.platform], v: row.v || null };
      const r = await env.DB.prepare(
        "INSERT OR IGNORE INTO social_queue (kit_id, platform, payload, scheduled_at, status, created_at, approved_at) VALUES (?, ?, ?, ?, 'approved', ?, ?)"
      ).bind(row.kit, row.platform, JSON.stringify(p), at, iso(nowMs), iso(nowMs)).run();
      added += (r.meta && r.meta.changes) || 0;
      continue;
    }
    await env.DB.prepare("UPDATE social_queue SET scheduled_at = ? WHERE id = ? AND status IN ('draft', 'approved')").bind(at, exists.id).run();
    if (row.v && ["draft", "approved"].includes(exists.status) && JSON.parse(exists.payload).v !== row.v) {
      const kit = await assetJson(env, `/social/kits/${row.kit}/kit.json`);
      const p = { ...payloadsFromKit(row.kit, kit)[row.platform], v: row.v };
      await env.DB.prepare("UPDATE social_queue SET payload = ? WHERE id = ? AND status IN ('draft', 'approved')").bind(JSON.stringify(p), exists.id).run();
    }
    if (isLive(env, row.platform, adapters) && Date.parse(at) >= nowMs - REARM_WINDOW_MS) {
      await env.DB.prepare("UPDATE social_queue SET status = 'approved', scheduled_at = ?, posted_at = NULL, error = NULL WHERE id = ? AND status IN ('simulated', 'skipped')")
        .bind(at, exists.id).run();
    }
  }
  return added;
}

// Dashboard: stop one scheduled post (it stays stopped even though it's still in schedule.json),
// or bring it back. A row the cron hasn't copied in yet is created as cancelled.
export async function cancelScheduled(env, kitId, platform, nowMs = Date.now()) {
  if (!PLATFORMS.includes(platform) || !/^[a-z0-9-]+$/.test(kitId)) throw new Error("bad kit or platform");
  const r = await env.DB.prepare("UPDATE social_queue SET status = 'cancelled' WHERE kit_id = ? AND platform = ? AND status IN ('draft', 'approved', 'simulated', 'skipped', 'held')")
    .bind(kitId, platform).run();
  if (r.meta && r.meta.changes) return r.meta.changes;
  const exists = await env.DB.prepare("SELECT id FROM social_queue WHERE kit_id = ? AND platform = ?").bind(kitId, platform).first();
  if (exists) return 0; // already posted, failed or cancelled
  const kit = await assetJson(env, `/social/kits/${kitId}/kit.json`);
  await env.DB.prepare("INSERT INTO social_queue (kit_id, platform, payload, scheduled_at, status, created_at) VALUES (?, ?, ?, NULL, 'cancelled', ?)")
    .bind(kitId, platform, JSON.stringify(payloadsFromKit(kitId, kit)[platform]), iso(nowMs)).run();
  return 1;
}

export async function restoreScheduled(env, kitId, platform) {
  const r = await env.DB.prepare("UPDATE social_queue SET status = 'approved', error = NULL WHERE kit_id = ? AND platform = ? AND status = 'cancelled'")
    .bind(kitId, platform).run();
  return (r.meta && r.meta.changes) || 0;
}

export async function runScheduled(env, nowMs = Date.now(), { adapters = ADAPTERS, fetchImpl = fetch } = {}) {
  await ensureSocialSchema(env);
  const report = { potd: null, schedule: 0, processed: [] };
  let sched = null;
  try {
    const res = await env.ASSETS.fetch(new Request(SITE_URL + "/social/schedule.json"));
    if (res.ok) sched = await res.json();
  } catch (e) { /* no schedule file */ }
  try { report.schedule = sched ? await syncSchedule(env, nowMs, { adapters, schedule: sched }) : 0; } catch (e) { await log(env, nowMs, null, null, "schedule_error", 0, e.message); }
  try { report.potd = await maybeQueuePotd(env, nowMs, { fetchImpl, schedule: sched }); } catch (e) { await log(env, nowMs, null, null, "potd_error", 0, e.message); }
  try { report.pace = await maybeQueuePace(env, nowMs, { fetchImpl }); } catch (e) { await log(env, nowMs, null, null, "pace_error", 0, e.message); }
  try { report.best = await maybeQueueBest(env, nowMs, { fetchImpl }); } catch (e) { await log(env, nowMs, null, null, "best_error", 0, e.message); }
  try { report.poll = await maybeQueuePoll(env, nowMs); } catch (e) { await log(env, nowMs, null, null, "poll_error", 0, e.message); }
  try { report.metrics = await maybeCollectMetrics(env, nowMs, { fetchImpl }); } catch (e) { await log(env, nowMs, null, null, "metrics_error", 0, e.message); }
  const { results } = await env.DB.prepare(
    "SELECT * FROM social_queue WHERE status = 'approved' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at, id LIMIT 10"
  ).bind(iso(nowMs)).all();
  for (const row of results || []) {
    const claim = await env.DB.prepare("UPDATE social_queue SET status = 'posting' WHERE id = ? AND status = 'approved'").bind(row.id).run();
    if (!claim.meta || claim.meta.changes !== 1) continue; // another run took it
    const payload = JSON.parse(row.payload);
    const n = payload.posts ? payload.posts.length : 1;
    if (env.SOCIAL_DRY_RUN === "0" && !isLive(env, row.platform, adapters)) {
      await env.DB.prepare("UPDATE social_queue SET status = 'skipped', error = 'platform not connected' WHERE id = ?").bind(row.id).run();
      report.processed.push({ id: row.id, platform: row.platform, result: "skipped" });
      continue;
    }
    if (!isLive(env, row.platform, adapters)) {
      await env.DB.prepare("UPDATE social_queue SET status = 'simulated', posted_at = ? WHERE id = ?").bind(iso(nowMs), row.id).run();
      await log(env, nowMs, row.platform, row.id, "would_post", n, (payload.posts || [payload.caption])[0]);
      report.processed.push({ id: row.id, platform: row.platform, result: "simulated" });
      continue;
    }
    const used = await usedThisMonth(env, row.platform, nowMs);
    if (used + n > capFor(env, row.platform)) {
      await env.DB.prepare("UPDATE social_queue SET status = 'held', error = ? WHERE id = ?")
        .bind(`monthly cap reached (${used}/${capFor(env, row.platform)})`, row.id).run();
      report.processed.push({ id: row.id, platform: row.platform, result: "held" });
      continue;
    }
    try {
      if (payload.images) payload.images = await loadImages(env, payload.images);
      const r = await adapters[row.platform].post(env, payload, fetchImpl);
      await env.DB.prepare("UPDATE social_queue SET status = 'posted', posted_at = ?, remote_id = ?, error = NULL WHERE id = ?")
        .bind(iso(nowMs), r.remote_id || null, row.id).run();
      await log(env, nowMs, row.platform, row.id, "posted", r.count || n, r.remote_id);
      report.processed.push({ id: row.id, platform: row.platform, result: "posted" });
    } catch (e) {
      await env.DB.prepare("UPDATE social_queue SET status = 'failed', error = ? WHERE id = ?").bind(String(e.message).slice(0, 500), row.id).run();
      await log(env, nowMs, row.platform, row.id, "failed", 0, e.message);
      report.processed.push({ id: row.id, platform: row.platform, result: "failed" });
    }
  }
  return report;
}

export async function queueView(env, adapters = ADAPTERS) {
  const { results } = await env.DB.prepare(
    "SELECT id, kit_id, platform, payload, scheduled_at, status, approved_at, posted_at, remote_id, error FROM social_queue ORDER BY COALESCE(scheduled_at, created_at) DESC, id DESC LIMIT 200"
  ).all();
  const platforms = {};
  for (const p of PLATFORMS) platforms[p] = { configured: adapters[p].configured(env), live: isLive(env, p, adapters), cap: capFor(env, p) };
  return { dry_run: env.SOCIAL_DRY_RUN !== "0", platforms, settings: await getSettings(env), rows: results || [] };
}
