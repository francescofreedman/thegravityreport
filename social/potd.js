// Player of the day = whoever just played the best game. Every morning (from 9 AM Eastern) the cron
// pulls last night's finished games from ESPN's public JSON, scores every line with Game Score,
// keeps players who are in The 644, and queues the best one for 10 AM Eastern on every platform:
// last night's line first, then a few GRAVITY numbers. Every number in the post comes straight from
// the box score or the player's 644 record. A player picked by hand for that day (a kit named
// <date>-player-<slug> in the schedule) always wins; the dashboard's Stop works like any post.

export const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
export const POTD_HOUR_ET = 10;

export function etParts(ms) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour) };
}

export function etToUtcMs(dateStr, hour) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d, hour + 4);
  const off = etParts(guess).hour - hour;
  return guess - off * 3600000;
}

export function prevDate(dateStr) {
  const t = Date.parse(dateStr + "T12:00:00Z") - 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function normName(n) {
  return n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+(jr|sr|ii|iii|iv)$/, "").trim();
}

const num = (v) => Number(v) || 0;
const split = (v) => String(v || "0-0").split("-").map(num);

export function gameScore(L) {
  const [fg, fga] = split(L.FG), [ft, fta] = split(L.FT);
  return num(L.PTS) + 0.4 * fg - 0.7 * fga - 0.4 * (fta - ft) + 0.7 * num(L.OREB) + 0.3 * num(L.DREB)
    + num(L.STL) + 0.7 * num(L.AST) + 0.7 * num(L.BLK) - 0.4 * num(L.PF) - num(L.TO);
}

// every player line in one ESPN game summary, with the game context
export function linesFromSummary(summary) {
  const comp = summary.header.competitions[0];
  const out = [];
  for (const team of summary.boxscore.players || []) {
    const st = team.statistics[0];
    const me = comp.competitors.find((c) => c.team.id === team.team.id);
    const opp = comp.competitors.find((c) => c.team.id !== team.team.id);
    for (const a of st.athletes || []) {
      if (!a.stats || !a.stats.length) continue;
      const line = Object.fromEntries(st.names.map((n, i) => [n, a.stats[i]]));
      if (!num(line.MIN)) continue;
      const won = !!me.winner;
      out.push({ name: a.athlete.displayName, line, won, opp: opp.team.name,
        team: me.team.abbreviation || null, oppAbbr: opp.team.abbreviation || opp.team.name, home: me.homeAway === "home",
        score: won ? `${me.score}–${opp.score}` : `${opp.score}–${me.score}` });
    }
  }
  return out;
}

const fmtTs = (x) => { const s = Number(x).toFixed(3); return s.startsWith("0") ? s.slice(1) : s; };

// Phrasings rotate by day (seeded by the date and the player) so consecutive posts don't read alike.
function seedOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
const pick = (arr, seed, salt) => arr[(seed + salt) % arr.length];

export function potdTexts(p, g, siteUrl, n = 644, { seed = 0, tiers = null } = {}) {
  const L = g.line;
  const bits = [`${L.PTS} points`];
  if (num(L.REB) >= 8) bits.push(`${L.REB} rebounds`);
  if (num(L.AST) >= 6) bits.push(`${L.AST} assists`);
  const [fg, fga] = split(L.FG); bits.push(`${fg}-of-${fga} shooting`);
  const [t3, t3a] = split(L["3PT"]); if (t3 >= 4) bits.push(`${t3}-of-${t3a} from three`);
  const stats = bits.length > 1 ? bits.slice(0, -1).join(", ") + " and " + bits[bits.length - 1] : bits[0];
  const res = g.won ? `${g.score} win over the ${g.opp}` : `${g.score} loss to the ${g.opp}`;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const first = pick([
    `${p.n} last night: ${stats} in a ${res}.`,
    `${cap(stats)} for ${p.n} in last night's ${res}.`,
    `The best game of the night was ${p.n}'s: ${stats} in a ${res}.`,
    `${p.n} put up ${stats} on the ${g.opp} last night, a ${g.score} ${g.won ? "win" : "loss"}.`,
    `Nobody had a better night than ${p.n}: ${stats} in a ${res}.`,
  ], seed, 0);
  const score = Number(p.s).toFixed(1);
  const tierName = tiers && p.tier != null ? tiers[String(p.tier)] : null;
  const grav = p.rk
    ? pick([
      `In The 644 he's #${p.r} of ${n} as a rookie, GRAVITY score ${score}.`,
      `We rank him #${p.r} of ${n} in The 644, as a rookie, with a GRAVITY score of ${score}.`,
    ], seed, 1)
    : pick([
      `In The 644 he's #${p.r} of ${n}, GRAVITY score ${score} (50 is a league-average minute).`,
      `We rank him #${p.r} of ${n} in The 644, with a GRAVITY score of ${score}; 50 is a league-average minute.`,
      `His place in The 644, our ranking of every NBA player: #${p.r}, with a score of ${score} (50 is a league-average minute).`,
      tierName ? `#${p.r} of ${n} in The 644, GRAVITY score ${score}, which puts him in our "${tierName}" tier (50 is a league-average minute).`
        : `#${p.r} of ${n} in The 644, GRAVITY score ${score} (50 is a league-average minute).`,
    ], seed, 2);
  let last = "";
  if (!p.rk && p.pp != null && p.ts != null) {
    const pp = Number(p.pp).toFixed(1), ts = fmtTs(p.ts);
    last = pick([
      `Last season: ${pp} points a game on ${ts} true shooting.`,
      `A ${L.PTS}-point night from a player who averaged ${pp} last season, on ${ts} true shooting.`,
      `For scale, he averaged ${pp} points a game last season, with ${ts} true shooting.`,
    ], seed, 3);
  }
  const url = `${siteUrl}/players/${p.slug}/`;
  return { first, grav, last, url };
}

export function potdKitFromPerformance(p, team, g, siteUrl, n = 644, { date = "", tiers = null } = {}) {
  const t = potdTexts(p, g, siteUrl, n, { seed: seedOf(date + p.slug), tiers });
  const x = [t.first, [t.grav, t.last].filter(Boolean).join("\n\n") + `\n\nFull profile: ${t.url}`];
  return {
    kind: "player", slug: p.slug, title: `${p.n}: player of the day`,
    x_thread: x, bluesky_thread: x,
    threads: [t.first, t.grav, t.last, t.url].filter(Boolean).join("\n\n"),
    instagram_caption: [t.first, t.grav, t.last, "Every player's page is free. Link in bio.", "#NBA"].filter(Boolean).join("\n\n"),
    images: { card: `/players/${p.slug}/card.png`, carousel: [] },
    alt: { card: `${p.n}, #${p.r} of ${n} in The 644, GRAVITY score ${Number(p.s).toFixed(1)}. ${team}.` },
    source: { line: g.line, opp: g.opp, score: g.score },
  };
}

// best line of the night among players in The 644 (needs >= 20 Game Score to count as a big night)
export function pickBest(lines, byName) {
  let best = null;
  for (const g of lines) {
    const p = byName.get(normName(g.name));
    if (!p) continue;
    const gs = gameScore(g.line);
    if (!best || gs > best.gs) best = { p, g, gs };
  }
  return best && best.gs >= 20 ? best : null;
}

export async function fetchLastNight(dateStr, fetchImpl = fetch) {
  const ymd = dateStr.replace(/-/g, "");
  const sb = await (await fetchImpl(`${ESPN}/scoreboard?dates=${ymd}`)).json();
  const done = (sb.events || []).filter((e) => e.status && e.status.type && e.status.type.completed);
  const lines = [];
  for (const e of done) {
    const s = await (await fetchImpl(`${ESPN}/summary?event=${e.id}`)).json();
    lines.push(...linesFromSummary(s).map((l) => ({ ...l, event: e.id })));
  }
  return { games: done.length, lines };
}
