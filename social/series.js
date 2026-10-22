// Recurring series the Worker writes on its own, every week. Pure text builders: every number in a
// post is a field read from a fetched record (ESPN standings, ESPN box scores) or a loaded site file
// (The 644, The 30), or plain arithmetic on those fields (a win pace). Nothing here touches the
// database or posts anything; social/pipeline.js queues what these return.
//
//   Beating the projection   Wednesdays 1 PM ET   standings vs TORQUE win projections   /the30/
//   Best games of the week   Fridays 1 PM ET      top 5 Game Scores, Fri → Thu           /the644/
//   Who's higher?            Saturdays 11 AM ET   poll on two adjacent 644 ranks         answer Sunday 11 AM ET
import { gameScore } from "./potd.js";

export const STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
export const SEASON_GAMES = 82;
export const MIN_GAMES_PER_TEAM = 5;
// ESPN's team codes where they differ from the NBA codes used in The 644, and TORQUE's three Basketball Reference codes.
export const ESPN_CODES = { NY: "NYK", NO: "NOP", SA: "SAS", UTAH: "UTA", GS: "GSW", WSH: "WAS" };
export const TORQUE_CODES = { CHO: "CHA", PHO: "PHX", BRK: "BKN" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LIMITS = { x: 280, bluesky: 300, threads: 500, instagram: 2200 };

// ------------------------------------------------------------------ dates

export function weekday(dateStr) { // 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD civil date
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

export function isoWeek(dateStr) { // "2026-W44"
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - jan1) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function dateLabel(dateStr) { // "Oct 23"
  const [, m, d] = dateStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function rangeLabel(fromStr, toStr) { // "Oct 17–23" or "Oct 30–Nov 5"
  const [, m1, d1] = fromStr.split("-").map(Number);
  const [, m2, d2] = toStr.split("-").map(Number);
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}` : `${MONTHS[m1 - 1]} ${d1}–${MONTHS[m2 - 1]} ${d2}`;
}

// ------------------------------------------------------------------ limits

export function xLen(post) { return post.replace(/https?:\/\/\S+/g, "x".repeat(23)).length; }
export function graphemes(s) { return Array.from(s.normalize("NFC")).filter((ch) => !/\p{M}/u.test(ch)).length; }
export function fits(post) { return xLen(post) <= LIMITS.x && graphemes(post) <= LIMITS.bluesky; }

// head, then one line per item, split into posts that fit both X and Bluesky; tail is the last post
export function packPosts(head, lines, tail) {
  const posts = [];
  let cur = head;
  for (const ln of lines) {
    const nxt = cur ? cur + (cur === head ? "\n\n" : "\n") + ln : ln;
    if (fits(nxt)) cur = nxt;
    else { posts.push(cur); cur = ln; }
  }
  if (cur) posts.push(cur);
  if (tail) posts.push(tail);
  return posts;
}

export function checkLimits(kit) {
  const errs = [];
  kit.x_thread.forEach((p, i) => { if (xLen(p) > LIMITS.x) errs.push(`x post ${i + 1} is ${xLen(p)} > 280`); });
  kit.bluesky_thread.forEach((p, i) => { if (graphemes(p) > LIMITS.bluesky) errs.push(`bluesky post ${i + 1} is ${graphemes(p)} > 300`); });
  if (kit.threads.length > LIMITS.threads) errs.push(`threads post is ${kit.threads.length} > 500`);
  if (kit.instagram_caption.length > LIMITS.instagram) errs.push("instagram caption > 2200");
  if (errs.length) throw new Error(errs.join("; "));
  return kit;
}

const fit500 = (head, lines, foot) => {
  let t = head;
  for (const ln of lines) {
    if ((t + "\n" + ln + "\n\n" + foot).length > LIMITS.threads) break;
    t += (t === head ? "\n\n" : "\n") + ln;
  }
  return t + "\n\n" + foot;
};

// ------------------------------------------------------------------ Beating the projection

export function parseStandings(data) { // -> { NBA code: { w, l, name } }
  const out = {};
  for (const conf of (data && data.children) || []) {
    for (const e of (conf.standings && conf.standings.entries) || []) {
      const st = Object.fromEntries((e.stats || []).map((s) => [s.name, s]));
      if (!st.wins || !st.losses) continue;
      const raw = e.team.abbreviation;
      out[ESPN_CODES[raw] || raw] = { w: Number(st.wins.value), l: Number(st.losses.value), name: e.team.displayName };
    }
  }
  return out;
}

export const city = (team) => (team.startsWith("Portland") ? "Portland" : team.replace(/ [^ ]+$/, ""));

// standings from parseStandings, torque = the30/torque-2026-27.json. Returns null (with .reason) when too early.
export function paceTable(standings, torque) {
  const rows = [];
  for (const t of torque.teams) {
    const s = standings[TORQUE_CODES[t.code] || t.code];
    if (!s) continue;
    const g = s.w + s.l;
    rows.push({ team: t.team, code: t.code, w: s.w, l: s.l, g, projected: t.wins, pace: g ? (SEASON_GAMES * s.w) / g : null });
  }
  const avg = rows.length ? rows.reduce((a, r) => a + r.g, 0) / rows.length : 0;
  if (rows.length < 30 || avg < MIN_GAMES_PER_TEAM) return { rows, avg, reason: `too early: ${avg.toFixed(1)} games a team` };
  for (const r of rows) r.diff = r.pace - r.projected;
  rows.sort((a, b) => b.diff - a.diff);
  return { rows, avg, above: rows.slice(0, 3), below: rows.slice(-3).reverse() };
}

export function paceKit(table, siteUrl, dateStr) {
  const url = `${siteUrl}/the30/`;
  const games = Math.round(table.avg);
  const line = (r) => `${city(r.team)}: ${r.w}-${r.l}, a pace of ${Math.round(r.pace)} wins; projected ${r.projected.toFixed(1)}`;
  const head = `Beating the projection. TORQUE, our team model, projected every team's wins before the season. After about ${games} games, the three teams furthest ahead of their projection, and the three furthest behind:`;
  const lines = ["Ahead:", ...table.above.map(line), "Behind:", ...table.below.map(line)];
  const tail = `All 30 teams with their projections: ${url}`;
  const posts = packPosts(head, lines, tail);
  const kit = {
    kind: "pace", slug: "pace", date: dateStr, url, title: `Beating the projection, ${dateLabel(dateStr)}`,
    x_thread: posts, bluesky_thread: posts,
    threads: fit500(head, lines, url),
    instagram_caption: [head, lines.join("\n"), "All 30 teams at the link in bio.", "#NBA"].join("\n\n"),
    images: { card: null, ig: "/cards/the30.png", carousel: [] },
    alt: { ig: "The 30: every NBA team ranked by TORQUE." },
    source: { standings: table.rows.map((r) => ({ code: r.code, w: r.w, l: r.l, projected: r.projected })) },
  };
  return checkLimits(kit);
}

// ------------------------------------------------------------------ Best games of the week

// lines: [{name, line, won, opp, oppAbbr, home, team, score, event, date}] already limited to players in The 644,
// byName: normalised name -> 644 record (r, n, t, slug). Top 5 by Game Score, one line per game.
export function bestKit(lines, byName, normName, fromStr, toStr, siteUrl, dateStr, n = 644) {
  const url = `${siteUrl}/the644/`;
  const seen = new Set();
  const scored = [];
  for (const g of lines) {
    const p = byName.get(normName(g.name));
    if (!p) continue;
    const key = `${g.event}|${normName(g.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({ g, p, gs: g.gs != null ? g.gs : gameScore(g.line) });
  }
  scored.sort((a, b) => b.gs - a.gs);
  const top = scored.slice(0, 5);
  if (!top.length) return null;
  const line = ({ g, p }, i) => {
    const L = g.line;
    const where = `${g.home ? "vs" : "at"} ${g.oppAbbr || g.opp}`;
    return `${i + 1}. ${p.n}, ${g.team || p.t}: ${L.PTS}/${L.REB}/${L.AST} ${where}. #${p.r} in The 644.`;
  };
  const head = `The best games of the week (${rangeLabel(fromStr, toStr)}), by Game Score, among players in The 644. Points/rebounds/assists, then where he ranks in our list of every NBA player:`;
  const ls = top.map(line);
  const tail = `Game Score is John Hollinger's one-number rating of a box score. All ${n} players, ranked: ${url}`;
  const posts = packPosts(head, ls, tail);
  const kit = {
    kind: "best", slug: "best", date: dateStr, url, title: `Best games of the week, ${rangeLabel(fromStr, toStr)}`,
    x_thread: posts, bluesky_thread: posts,
    threads: fit500(head, ls, `All ${n} players, ranked: ${url}`),
    instagram_caption: [head, ls.join("\n"), "Game Score is John Hollinger's one-number rating of a box score. Every player's page is free. Link in bio.", "#NBA"].join("\n\n"),
    images: { card: null, ig: "/cards/the644.png", carousel: [] },
    alt: { ig: `The 644: every NBA player, one number. Best games of the week: ${ls.join(" ")}` },
    source: { lines: top.map(({ g, p, gs }) => ({ name: p.n, r: p.r, event: g.event, date: g.date, line: g.line, gs: Number(gs.toFixed(1)) })) },
  };
  return checkLimits(kit);
}

// ------------------------------------------------------------------ Who's higher?

export const POLL_PAIRS = 50; // adjacent ranks in the top 100: (1,2) … (99,100)

// deterministic pair for a week: week n -> pair index (n * 17) mod 50, A/B order flips on odd weeks
export function pollPair(players, weekNo) {
  const idx = ((weekNo * 17) % POLL_PAIRS + POLL_PAIRS) % POLL_PAIRS;
  const byRank = new Map(players.map((p) => [p.r, p]));
  const a = byRank.get(2 * idx + 1), b = byRank.get(2 * idx + 2);
  if (!a || !b) return null;
  return weekNo % 2 ? [b, a] : [a, b];
}

export function pollOption(p) { // X poll options are 25 characters at most
  return p.n.length <= 25 ? p.n : p.n.split(" ").slice(-1)[0].slice(0, 25);
}

const n1 = (v) => Number(v).toFixed(1);

export function playerLine(p) {
  const pos = p.p && p.p !== "—" ? p.p : "position TBD";
  const who = `${p.n} (${p.t}, ${pos})`;
  if (p.rk) return `${who}: rookie${p.pk ? `, pick #${p.pk}` : ""}`;
  if (p.pp == null || p.rp == null || p.ap == null) return who;
  return `${who}: last season ${n1(p.pp)} pts, ${n1(p.rp)} reb, ${n1(p.ap)} ast a game`;
}

export function pollKits(a, b, siteUrl, dateStr, n = 644) {
  const url = `${siteUrl}/the644/`;
  const q = "Who's higher in The 644, our ranking of every NBA player?";
  const body = `A: ${playerLine(a)}\nB: ${playerLine(b)}`;
  const xText = `${q} Answer tomorrow at 11 AM ET.\n\n${body}`;
  const replyText = `${q} Reply with your pick. Answer tomorrow at 11 AM ET.\n\n${body}`;
  const poll = {
    kind: "poll", slug: "poll", date: dateStr, url, title: `Who's higher? ${a.n} or ${b.n}`,
    x_thread: [xText], bluesky_thread: [replyText], threads: replyText,
    instagram_caption: [replyText, "Every player's page is free. Link in bio.", "#NBA"].join("\n\n"),
    poll: { options: [pollOption(a), pollOption(b)], duration_minutes: 1440 },
    images: { card: null, ig: "/cards/the644.png", carousel: [] }, // an X poll can't carry media
    alt: { ig: "The 644: every NBA player, one number." },
  };
  const hi = a.r < b.r ? a : b, lo = hi === a ? b : a;
  const first = `Who's higher? The answer: ${hi.n}, #${hi.r} of ${n} in The 644, GRAVITY score ${n1(hi.s)} (50 is a league-average minute). ${lo.n} is #${lo.r}, GRAVITY score ${n1(lo.s)}.`;
  const answerText = `${first}\n\nEvery player, ranked: ${url}`;
  const answer = {
    kind: "poll", slug: "poll-answer", date: dateStr, url, title: `Who's higher? Answer: ${hi.n}`,
    x_thread: [answerText], bluesky_thread: [answerText], threads: answerText,
    instagram_caption: [first, "Every player's page is free. Link in bio.", "#NBA"].join("\n\n"),
    images: { card: `/players/${hi.slug}/card.png`, carousel: [] },
    alt: { card: `${hi.n}, #${hi.r} of ${n} in The 644, GRAVITY score ${n1(hi.s)}.` },
  };
  return { poll: checkLimits(poll), answer: checkLimits(answer) };
}
