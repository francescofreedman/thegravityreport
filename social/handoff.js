// Hand-off by email: platforms listed in SOCIAL_MANUAL_PLATFORMS (e.g. "instagram,threads") are not
// posted by the Worker. Instead, 15–30 minutes before a row is due, one email per post goes to
// HANDOFF_TO with the caption ready to copy, the images attached and a three-line how-to, and the
// row is marked "handoff". Nothing is sent to the platform. Needs Email Routing on the zone and the
// `send_email` binding (EMAIL) in wrangler.jsonc.

export const HANDOFF_LEAD_MS = 30 * 60 * 1000;

const NAMES = { x: "X", bluesky: "Bluesky", threads: "Threads", instagram: "Instagram" };

export function manualPlatforms(env) {
  return String(env.SOCIAL_MANUAL_PLATFORMS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function handoffReady(env) {
  return !!(env.EMAIL && env.HANDOFF_TO);
}

export function etClock(ms) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(ms)) + " ET";
}

const HOWTO = {
  instagram: ["Save the attached image(s) to Photos.", "Instagram → + → Post → pick them in order (first attachment first).", "Paste the caption below. Share."],
  threads: ["Threads → New thread.", "Paste the text below (one post; if there are several, reply to your own post with each).", "Add the attached image if you like. Post."],
};

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function wrap76(s) {
  return s.replace(/(.{76})/g, "$1\r\n");
}

function textFor(platform, payload) {
  if (platform === "instagram") return payload.caption || "";
  return (payload.posts || []).join("\n\n");
}

// one email for every manual-platform row of the same post (same kit) due at the same time
export function buildHandoffEmail({ from, to, title, atMs, items, nowMs = Date.now() }) {
  const when = etClock(atMs);
  const platforms = items.map((i) => NAMES[i.platform] || i.platform).join(" + ");
  const subject = `Post this on ${platforms} at ${when}: ${title}`;
  const lines = [`${title} — post on ${platforms} at ${when}.`, ""];
  items.forEach((i, idx) => {
    lines.push(`=== ${NAMES[i.platform] || i.platform} ===`, "");
    (HOWTO[i.platform] || ["Post the text below."]).forEach((h, n) => lines.push(`${n + 1}. ${h}`));
    lines.push("", "--- copy from here ---", textFor(i.platform, i.payload), "--- to here ---", "");
    if (i.images.length) lines.push(`Images attached: ${i.images.map((im) => im.name).join(", ")}`, "");
    if (idx < items.length - 1) lines.push("");
  });
  lines.push("Sent by thegravityreport.com. Stop a post on the schedule page: https://thegravityreport.com/admin/schedule/");
  const boundary = "gr-" + Math.random().toString(36).slice(2) + "-" + nowMs.toString(36);
  const text = b64(new TextEncoder().encode(lines.join("\r\n")));
  const seen = new Set();
  const parts = [
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap76(text), "",
  ];
  for (const i of items) {
    for (const im of i.images) {
      if (seen.has(im.name)) continue;
      seen.add(im.name);
      parts.push(`--${boundary}`, `Content-Type: ${im.type || "image/png"}; name="${im.name}"`, "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${im.name}"`, "", wrap76(b64(im.bytes)), "");
    }
  }
  parts.push(`--${boundary}--`, "");
  const headers = [
    `From: The Gravity Report <${from}>`, `To: ${to}`, `Subject: ${subject}`, `Date: ${new Date(nowMs).toUTCString()}`,
    `Message-ID: <${boundary}@thegravityreport.com>`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", "",
  ];
  return { subject, raw: headers.join("\r\n") + parts.join("\r\n") };
}

export async function defaultSendEmail(env, from, to, raw) {
  const { EmailMessage } = await import("cloudflare:email");
  await env.EMAIL.send(new EmailMessage(from, to, raw));
}

async function loadImage(env, siteUrl, url) {
  const path = url.startsWith(siteUrl) ? url.slice(siteUrl.length) : url;
  const res = await env.ASSETS.fetch(new Request(siteUrl + path));
  if (!res.ok) throw new Error(`image ${path}: ${res.status}`);
  const name = path.split("/").filter(Boolean).slice(-2).join("-");
  return { name, type: res.headers.get("content-type") || "image/png", bytes: new Uint8Array(await res.arrayBuffer()) };
}

function imageUrls(payload) {
  if (payload.image_urls && payload.image_urls.length) return payload.image_urls;
  return (payload.images || []).map((im) => im.path).filter(Boolean);
}

// Rows for manual platforms due within the lead window: claim, email, mark "handoff".
export async function runHandoffs(env, nowMs, { siteUrl, manual, iso, log, sendEmail = defaultSendEmail }) {
  const out = [];
  if (!manual.length) return out;
  const marks = manual.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM social_queue WHERE status = 'approved' AND scheduled_at IS NOT NULL AND scheduled_at <= ? AND platform IN (${marks}) ORDER BY scheduled_at, id LIMIT 20`
  ).bind(iso(nowMs + HANDOFF_LEAD_MS), ...manual).all();
  if (!results || !results.length) return out;
  if (!handoffReady(env)) {
    await log(env, nowMs, null, null, "handoff_unconfigured", results.length, "set HANDOFF_TO and the EMAIL binding");
    return out;
  }
  const groups = new Map();
  for (const row of results) {
    const claim = await env.DB.prepare("UPDATE social_queue SET status = 'posting' WHERE id = ? AND status = 'approved'").bind(row.id).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    const key = `${row.kit_id}|${row.scheduled_at}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const from = env.HANDOFF_FROM || "posts@thegravityreport.com";
  for (const rows of groups.values()) {
    try {
      const items = [];
      for (const row of rows) {
        const payload = JSON.parse(row.payload);
        const images = [];
        for (const u of imageUrls(payload)) images.push(await loadImage(env, siteUrl, u));
        items.push({ platform: row.platform, payload, images });
      }
      const title = JSON.parse(rows[0].payload).title || rows[0].kit_id;
      const atMs = Date.parse(rows[0].scheduled_at);
      const { subject, raw } = buildHandoffEmail({ from, to: env.HANDOFF_TO, title, atMs, items, nowMs });
      await sendEmail(env, from, env.HANDOFF_TO, raw);
      for (const row of rows) {
        await env.DB.prepare("UPDATE social_queue SET status = 'handoff', posted_at = ?, remote_id = 'email', error = NULL WHERE id = ?").bind(iso(nowMs), row.id).run();
        await log(env, nowMs, row.platform, row.id, "handoff", 1, subject);
        out.push({ id: row.id, platform: row.platform, result: "handoff" });
      }
    } catch (e) {
      for (const row of rows) {
        await env.DB.prepare("UPDATE social_queue SET status = 'failed', error = ? WHERE id = ?").bind("handoff: " + String(e.message).slice(0, 480), row.id).run();
        await log(env, nowMs, row.platform, row.id, "failed", 0, e.message);
        out.push({ id: row.id, platform: row.platform, result: "failed" });
      }
    }
  }
  return out;
}
