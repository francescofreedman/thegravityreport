// Social posting pipeline: queue in D1, approval, scheduled posting, player of the day.
//
// Safety: nothing is ever sent to a platform unless env.SOCIAL_DRY_RUN === "0" AND that
// platform's secrets exist. Otherwise a due item is marked "simulated" and logged as
// "would post". Each row is claimed atomically (approved -> posting) so overlapping cron
// runs can never post the same item twice; failed items are never retried automatically.
import * as x from "./adapters/x.js";
import * as bluesky from "./adapters/bluesky.js";
import { threads, instagram } from "./adapters/meta.js";

export const ADAPTERS = { x, bluesky, threads, instagram };
export const PLATFORMS = ["x", "bluesky", "threads", "instagram"];
export const SITE_URL = "https://thegravityreport.com";
export const SEASON_START = "2026-10-20";
export const SETTINGS_KEYS = ["potd_on", "potd_auto_approve", "potd_platforms", "potd_hour_utc"];
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
    ]).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export function resetSchemaCache() { ready = null; }

const iso = (ms) => new Date(ms).toISOString();

export async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM social_settings").all();
  const s = { potd_on: "0", potd_auto_approve: "0", potd_platforms: "x,bluesky,threads", potd_hour_utc: "16" };
  for (const r of results || []) s[r.key] = r.value;
  return s;
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
  const altFor = (p) => (kit.alt && (kit.alt[p] || kit.alt.card)) || "";
  const carousel = ((kit.images && kit.images.carousel) || []).map((p) => absPath(kitId, p));
  const cardAlt = card ? altFor(kit.images.card) : "";
  return {
    x: { posts: kit.x_thread, images: card ? [{ path: card, alt: cardAlt }] : [] },
    bluesky: { posts: kit.bluesky_thread, images: card ? [{ path: card, alt: cardAlt, width: 1200, height: card.includes("/players/") || card.includes("/cards/") ? 630 : 675 }] : [] },
    threads: { posts: [kit.threads], image_urls: card ? [SITE_URL + card] : [] },
    instagram: { caption: kit.instagram_caption, image_urls: (carousel.length ? carousel : card ? [card] : []).map((p) => SITE_URL + p) },
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

export function potdIndex(dateStr, n) {
  const days = Math.floor((Date.parse(dateStr + "T00:00:00Z") - Date.parse(SEASON_START + "T00:00:00Z")) / 86400000);
  return ((Math.max(0, days) % n) + n) % n;
}

export function potdKit(p, count) {
  const pos = p.p && p.p !== "—" ? p.p : "position TBD";
  const url = `${SITE_URL}/players/${p.slug}/`;
  const text = `#${p.r} of ${count} in The 644: ${p.n} (${p.team}, ${pos}).\n\nGRAVITY score ${Number(p.s).toFixed(1)} (50 is a league-average minute).\n\nFull profile: ${url}`;
  return {
    kind: "player", slug: p.slug, url, title: p.n,
    x_thread: [text], bluesky_thread: [text], threads: text,
    instagram_caption: `#${p.r} of ${count} in The 644: ${p.n} (${p.team}, ${pos}).\n\nGRAVITY score ${Number(p.s).toFixed(1)}. 50 is a league-average minute.\n\nEvery player's page is free. Link in bio.\n\n#NBA`,
    images: { card: `/players/${p.slug}/card.png`, carousel: [] },
    alt: { card: `${p.n}, #${p.r} of ${count} in The 644, GRAVITY score ${Number(p.s).toFixed(1)}. ${p.team}.` },
  };
}

export async function maybeQueuePotd(env, nowMs) {
  const s = await getSettings(env);
  if (s.potd_on !== "1") return null;
  const day = iso(nowMs).slice(0, 10);
  const kitId = `potd-${day}`;
  const exists = await env.DB.prepare("SELECT id FROM social_queue WHERE kit_id = ? LIMIT 1").bind(kitId).first();
  if (exists) return null;
  const idx = await assetJson(env, "/players/index.json");
  const p = idx.players[potdIndex(day, idx.players.length)];
  const kit = potdKit(p, idx.count || idx.players.length);
  const at = `${day}T${String(Number(s.potd_hour_utc) || 16).padStart(2, "0")}:00:00.000Z`;
  const platforms = s.potd_platforms.split(",").map((v) => v.trim()).filter((v) => PLATFORMS.includes(v));
  await importKit(env, kitId, { platforms, scheduledAt: at, nowMs, kit });
  if (s.potd_auto_approve === "1") {
    await env.DB.prepare("UPDATE social_queue SET status = 'approved', approved_at = ? WHERE kit_id = ? AND status = 'draft'")
      .bind(iso(nowMs), kitId).run();
  }
  return kitId;
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

export async function runScheduled(env, nowMs = Date.now(), { adapters = ADAPTERS, fetchImpl = fetch } = {}) {
  await ensureSocialSchema(env);
  const report = { potd: null, processed: [] };
  try { report.potd = await maybeQueuePotd(env, nowMs); } catch (e) { await log(env, nowMs, null, null, "potd_error", 0, e.message); }
  const { results } = await env.DB.prepare(
    "SELECT * FROM social_queue WHERE status = 'approved' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at, id LIMIT 10"
  ).bind(iso(nowMs)).all();
  for (const row of results || []) {
    const claim = await env.DB.prepare("UPDATE social_queue SET status = 'posting' WHERE id = ? AND status = 'approved'").bind(row.id).run();
    if (!claim.meta || claim.meta.changes !== 1) continue; // another run took it
    const payload = JSON.parse(row.payload);
    const n = payload.posts ? payload.posts.length : 1;
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
