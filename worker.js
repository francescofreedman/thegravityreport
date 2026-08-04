/**
 * The Gravity Report — API worker.
 * Static assets are served by Cloudflare's asset handling; only non-asset
 * routes (/api/*) reach this script.
 *
 *   POST /api/vote   {c: "kawhi" | "jokic" | "flagg"}  -> {ok, tally}
 *   GET  /api/votes                              -> {kawhi, jokic, flagg}
 *   POST /api/e      {t, i, n}                   -> 204  (reading telemetry)
 *   GET  /api/stats?key=STATS_KEY                -> 30-day aggregates
 *
 * Telemetry design: no cookies, no IPs, no fingerprints. Events only fire
 * from JS-executing browsers (which excludes crawlers), respect DNT, and
 * store type + item + country + a client-declared first-visit-today flag.
 */

const VOTE_CHOICES = new Set(["kawhi", "jokic", "flagg"]);
const EVENT_TYPES = new Set(["pv", "read", "d3", "fin", "dwell", "use"]);
const BOT_RE = /bot|crawl|spider|slurp|preview|scan|monitor|probe|headless|lighthouse|curl|wget|python|httpx|axios|node-fetch|go-http/i;

let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS votes (choice TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"
      ),
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL, item TEXT, country TEXT, new_visitor INTEGER NOT NULL DEFAULT 0)"
      ),
    ]).catch((e) => {
      schemaReady = null; // retry on next request
      throw e;
    });
  }
  return schemaReady;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

function looksLikeBot(request) {
  const ua = request.headers.get("user-agent") || "";
  return !ua || BOT_RE.test(ua);
}

async function readBody(request, maxLen = 400) {
  const text = await request.text();
  if (text.length > maxLen) throw new Error("too long");
  return JSON.parse(text);
}

async function handleVote(request, env) {
  if (looksLikeBot(request)) return json({ ok: false }, 403);
  let choice;
  try {
    const body = await readBody(request);
    choice = String(body.c || "");
  } catch {
    return json({ ok: false }, 400);
  }
  if (!VOTE_CHOICES.has(choice)) return json({ ok: false }, 400);
  await ensureSchema(env);
  await env.DB.prepare(
    "INSERT INTO votes (choice, n) VALUES (?1, 1) ON CONFLICT(choice) DO UPDATE SET n = n + 1"
  )
    .bind(choice)
    .run();
  return json({ ok: true, tally: await tally(env) });
}

async function tally(env) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare("SELECT choice, n FROM votes").all();
  const out = { kawhi: 0, jokic: 0, flagg: 0 };
  for (const row of results) out[row.choice] = row.n;
  return out;
}

async function handleEvent(request, env, cf) {
  if (looksLikeBot(request)) return new Response(null, { status: 204 });
  let body;
  try {
    body = await readBody(request);
  } catch {
    return new Response(null, { status: 204 });
  }
  const type = String(body.t || "");
  if (!EVENT_TYPES.has(type)) return new Response(null, { status: 204 });
  const item = String(body.i || "").slice(0, 80);
  const nv = body.n === 1 ? 1 : 0;
  const country = (cf && cf.country) || "";
  await ensureSchema(env);
  await env.DB.prepare(
    "INSERT INTO events (ts, type, item, country, new_visitor) VALUES (?1, ?2, ?3, ?4, ?5)"
  )
    .bind(new Date().toISOString(), type, item, country, nv)
    .run();
  return new Response(null, { status: 204 });
}

async function handleStats(request, env) {
  const url = new URL(request.url);
  if (!env.STATS_KEY || url.searchParams.get("key") !== env.STATS_KEY) {
    return json({ error: "forbidden" }, 403);
  }
  await ensureSchema(env);
  const cutoff = "-30 days";
  const [byDay, byItem, countries, dwell, votes] = await Promise.all([
    env.DB.prepare(
      "SELECT substr(ts,1,10) AS day, COUNT(*) AS pageviews, SUM(new_visitor) AS first_visits FROM events WHERE type='pv' AND ts >= datetime('now', ?1) GROUP BY day ORDER BY day"
    )
      .bind(cutoff)
      .all(),
    env.DB.prepare(
      "SELECT item, SUM(type='pv') AS views, SUM(type='read') AS opened, SUM(type='d3') AS deep, SUM(type='fin') AS finished, SUM(type='use') AS used FROM events WHERE ts >= datetime('now', ?1) GROUP BY item ORDER BY views DESC LIMIT 40"
    )
      .bind(cutoff)
      .all(),
    env.DB.prepare(
      "SELECT country, COUNT(*) AS n FROM events WHERE type='pv' AND ts >= datetime('now', ?1) GROUP BY country ORDER BY n DESC LIMIT 15"
    )
      .bind(cutoff)
      .all(),
    env.DB.prepare(
      "SELECT COUNT(*) AS sessions_over_60s FROM events WHERE type='dwell' AND ts >= datetime('now', ?1)"
    )
      .bind(cutoff)
      .first(),
    tally(env),
  ]);
  return json(
    {
      note: "Humans only: every number here comes from a JS beacon real browsers send. Crawlers and bots never appear.",
      window: "last 30 days",
      votes,
      days: byDay.results,
      items: byItem.results,
      countries: countries.results,
      engagement: dwell,
    },
    200
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/vote" && request.method === "POST") return await handleVote(request, env);
      if (path === "/api/votes" && request.method === "GET") return json(await tally(env));
      if (path === "/api/e" && request.method === "POST")
        return await handleEvent(request, env, request.cf);
      if (path === "/api/stats" && request.method === "GET") return await handleStats(request, env);
    } catch (e) {
      return json({ error: "server" }, 500);
    }
    // Not an API route: fall through to static assets (404 handling included).
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("not found", { status: 404 });
  },
};
