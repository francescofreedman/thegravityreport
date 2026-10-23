// Game nights: what's happening in the NBA, seen through The 644 and TORQUE.
//
// "Tonight" (daily, 5 PM ET): the evening's games ranked by the best player on each side, with
// TORQUE's view of both teams. "Tip-off" (as it happens): when a marquee game is about to start,
// a post saying who's on the floor and where they rank. Both read ESPN's public scoreboard and
// only ever state ranks, scores and tip times that come from our data or the schedule.

export const SCOREBOARD = (ymd) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${ymd}`;
export const TIP_LEAD_MS = 20 * 60 * 1000;
export const TIPS_PER_NIGHT = 2;

export function gamesFromScoreboard(sb) {
  const out = [];
  for (const e of sb.events || []) {
    const comp = e.competitions && e.competitions[0];
    if (!comp) continue;
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    out.push({
      id: String(e.id), tipMs: Date.parse(e.date),
      state: (e.status && e.status.type && e.status.type.state) || "pre",
      home: { name: home.team.displayName, short: home.team.name || home.team.shortDisplayName, abbr: home.team.abbreviation },
      away: { name: away.team.displayName, short: away.team.name || away.team.shortDisplayName, abbr: away.team.abbreviation },
    });
  }
  return out;
}

export function etTime(ms) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(ms)) + " ET";
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// the best player (by 644 rank) on each team, by the team's display name
export function bestByTeam(byName) {
  const best = new Map();
  for (const p of byName.values()) {
    if (!p || !p.team || p.r == null) continue;
    const cur = best.get(p.team);
    if (!cur || p.r < cur.r) best.set(p.team, p);
  }
  return best;
}

export function fanName(p) {
  // what fans call him: the surname for most, the first name for the famous few
  const first = { "Shai Gilgeous-Alexander": "Shai", "Giannis Antetokounmpo": "Giannis", "Luka Dončić": "Luka", "LeBron James": "LeBron",
    "Stephen Curry": "Steph", "Kawhi Leonard": "Kawhi", "Victor Wembanyama": "Wemby", "Anthony Edwards": "Ant", "Cade Cunningham": "Cade",
    "Nikola Jokić": "Jokić", "Karl-Anthony Towns": "KAT", "Kevin Durant": "KD", "Jalen Duren": "Duren" };
  if (first[p.n]) return first[p.n];
  const parts = p.n.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ").replace(/\s(Jr\.|Sr\.|II|III|IV)$/, "") : p.n;
}

// score each game by the two best players' ranks (lower is better); attach TORQUE ranks
export function matchups(games, best, torqueByName) {
  return games.map((g) => {
    const a = best.get(g.away.name), h = best.get(g.home.name);
    const ta = torqueByName.get(g.away.name), th = torqueByName.get(g.home.name);
    const score = (a ? a.r : 400) + (h ? h.r : 400);
    const marquee = !!(a && h && ((a.r <= 10 && h.r <= 10) || (ta && th && ta.rank <= 6 && th.rank <= 6)));
    return { ...g, a, h, ta, th, score, marquee };
  }).sort((x, y) => x.score - y.score);
}

function seedOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
const pick = (arr, seed, salt) => arr[(seed + salt) % arr.length];

function torqueLine(m) {
  if (!m.ta || !m.th) return "";
  if (m.ta.rank <= 3 && m.th.rank <= 3) return `TORQUE, our team model, has both in its top three: the ${m.home.short} ${ordinal(m.th.rank)}, the ${m.away.short} ${ordinal(m.ta.rank)}.`;
  return `TORQUE, our team model, has the ${m.home.short} ${ordinal(m.th.rank)} and the ${m.away.short} ${ordinal(m.ta.rank)}.`;
}

export function tonightKit(ms, siteUrl, dateStr, n = 644) {
  const games = ms.filter((m) => m.a && m.h);
  if (!games.length) return null;
  const seed = seedOf("tonight" + dateStr);
  const top = games.slice(0, 4);
  const head = pick([
    `Tonight's games, ranked by the best player on the floor (The 644, our ranking of all ${n} NBA players):`,
    `Where the good players are tonight, by The 644:`,
    `${top.length === 1 ? "One game" : top.length + " games"} worth your evening, sorted by The 644:`,
    `Tonight in the NBA, in the order our numbers would watch them:`,
  ], seed, 0);
  const lines = top.map((m) => {
    const who = m.a.r < m.h.r
      ? `${fanName(m.a)} (#${m.a.r}) vs ${fanName(m.h)} (#${m.h.r})`
      : `${fanName(m.h)} (#${m.h.r}) vs ${fanName(m.a)} (#${m.a.r})`;
    return `${m.away.short} at ${m.home.short}, ${etTime(m.tipMs)}: ${who}`;
  });
  const lead = games[0];
  const closer = pick([
    `${torqueLine(lead)} Every player's number: ${siteUrl}/the644/`,
    `${torqueLine(lead)} The full ranking, free: ${siteUrl}/the644/`,
    `${torqueLine(lead)} All ${n} players, one number each: ${siteUrl}/the644/`,
  ], seed, 1).replace(/^ /, "");
  // X: head + lines must fit 280; split lines across posts if needed
  const posts = [];
  let cur = head;
  for (const ln of lines) {
    const next = cur + "\n\n" + ln;
    if (next.length > 270) { posts.push(cur); cur = ln; } else cur = next;
  }
  posts.push(cur);
  posts.push(closer);
  return {
    kind: "tonight", slug: `tonight-${dateStr}`, title: `Tonight in The 644 (${dateStr})`,
    x_thread: posts, bluesky_thread: posts, threads: posts.join("\n\n"),
    instagram_caption: "", images: { card: null, carousel: [] }, alt: {},
  };
}

export function tipKit(m, siteUrl, n = 644) {
  const seed = seedOf("tip" + m.id);
  const [p1, p2] = m.a.r < m.h.r ? [m.a, m.h] : [m.h, m.a];
  const first = pick([
    `${fanName(p1)} and ${fanName(p2)} are about to tip off: #${p1.r} and #${p2.r} in The 644, our ranking of all ${n} NBA players, on the same floor. ${m.away.short} at ${m.home.short}, ${etTime(m.tipMs)}.`,
    `If you watch one game tonight, make it ${m.away.short} at ${m.home.short} (${etTime(m.tipMs)}). ${fanName(p1)} is #${p1.r} in The 644, our ranking of all ${n} NBA players, and ${fanName(p2)} is #${p2.r}.`,
    `Tip-off in a few minutes: ${m.away.short} at ${m.home.short}. By The 644, that's ${fanName(p1)}, the #${p1.r} player in the league, against ${fanName(p2)}, #${p2.r}.`,
    `${m.away.short} at ${m.home.short} is starting (${etTime(m.tipMs)}), and by our numbers it's the game of the night: ${fanName(p1)} is #${p1.r} in The 644 and ${fanName(p2)} is #${p2.r}.`,
  ], seed, 0);
  const second = [torqueLine(m), `GRAVITY scores: ${fanName(p1)} ${Number(p1.s).toFixed(1)}, ${fanName(p2)} ${Number(p2.s).toFixed(1)} (50 is a league-average minute).`,
    `${siteUrl}/the644/`].filter(Boolean).join("\n\n");
  return {
    kind: "tip", slug: `tip-${m.id}`, title: `Tip-off: ${m.away.short} at ${m.home.short}`,
    x_thread: [first, second], bluesky_thread: [first, second], threads: first + "\n\n" + second,
    instagram_caption: "", images: { card: null, carousel: [] }, alt: {},
  };
}
