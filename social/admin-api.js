// /api/admin/* — the approval queue. Every call needs header `x-admin-key` matching env.ADMIN_KEY.
// If ADMIN_KEY is not set, the whole admin API is off (503).
import {
  ensureSocialSchema, importKit, approve, approveWeek, setStatus, schedule, setSetting, queueView, runScheduled,
} from "./pipeline.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function body(request) {
  const t = await request.text();
  if (t.length > 20000) throw new Error("too long");
  return t ? JSON.parse(t) : {};
}

export async function handleAdmin(request, env, deps = {}) {
  if (!env.ADMIN_KEY) return json({ ok: false, error: "admin disabled (ADMIN_KEY not set)" }, 503);
  if (!sameKey(request.headers.get("x-admin-key") || "", env.ADMIN_KEY)) return json({ ok: false, error: "unauthorized" }, 401);
  await ensureSocialSchema(env);
  const path = new URL(request.url).pathname.replace(/^\/api\/admin\/?/, "");
  try {
    if (request.method === "GET" && path === "queue") return json({ ok: true, ...(await queueView(env, deps.adapters)) });
    if (request.method === "GET" && path === "kits") {
      const r = await env.ASSETS.fetch(new Request("https://thegravityreport.com/social/kits/index.json"));
      return json({ ok: r.ok, kits: r.ok ? (await r.json()).kits : [] });
    }
    if (request.method !== "POST") return json({ ok: false, error: "not found" }, 404);
    const b = await body(request);
    const id = Number(b.id);
    switch (path) {
      case "import": return json({ ok: true, added: await importKit(env, String(b.kit_id || ""), { scheduledAt: b.scheduled_at || null, platforms: b.platforms }) });
      case "approve": return json({ ok: true, changed: await approve(env, id, b.scheduled_at || null) });
      case "approve-week": return json({ ok: true, changed: await approveWeek(env) });
      case "reject": return json({ ok: true, changed: await setStatus(env, id, "rejected", ["draft", "approved", "held"]) });
      case "retry": return json({ ok: true, changed: await setStatus(env, id, "approved", ["failed", "held"]) });
      case "schedule": return json({ ok: true, changed: await schedule(env, id, String(b.scheduled_at || "")) });
      case "settings": await setSetting(env, String(b.key), String(b.value)); return json({ ok: true });
      case "run-now": return json({ ok: true, report: await runScheduled(env, Date.now(), deps) });
      default: return json({ ok: false, error: "not found" }, 404);
    }
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 400);
  }
}
