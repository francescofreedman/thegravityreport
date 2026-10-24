// Daily Dive answer matching: turns a day file's prompt into a lookup table and checks typed answers.
// Runs in the page (window.DiveMatch) and in Node (tests).
(function (root) {
  "use strict";

  function norm(s) {
    return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/ø/gi, "o").replace(/đ/gi, "d").replace(/ł/gi, "l").replace(/ß/g, "ss")
      .toLowerCase().replace(/[.'’`]/g, "").replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ").trim().replace(/ (jr|sr|ii|iii|iv)$/, "");
  }

  function lev(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let low = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < low) low = cur[j];
      }
      if (low > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // prompt: {text, rule?, tiers: [{name, points}], answers: [{name, match?, points, tier, aliases?, note?, players?}], traps?}
  // note: the story behind a Buzzer Beater, shown on the reveal.
  function prepare(prompt) {
    const tiers = prompt.tiers.slice().sort((a, b) => a.points - b.points);
    const tierOf = (a) => {
      const i = tiers.findIndex((t) => t.name === a.tier);
      return i >= 0 ? i : Math.max(0, tiers.findIndex((t) => t.points >= a.points));
    };
    const answers = prompt.answers.map((a) => ({ name: a.name, points: a.points, tier: tierOf(a), players: a.players || 0, note: a.note || "" }));
    const exact = new Map();
    const put = (k, i) => {
      if (!k) return;
      const j = exact.get(k);
      // Two players with the same name: the typed name gets the better score.
      if (j === undefined || answers[i].points > answers[j].points) exact.set(k, i);
    };
    prompt.answers.forEach((a, i) => {
      put(norm(a.name), i);
      if (a.match) put(norm(a.match), i);
      (a.aliases || []).forEach((x) => put(norm(x), i));
    });

    // Short forms: a last name alone counts when only one answer has it. When a last name is shared
    // (two Malones, or every answer to "last name Johnson"), a unique first name counts instead.
    const words = answers.map((a) => norm(a.name).split(" "));
    const surnames = words.map((w) => (w.length > 1 ? [...new Set([w[w.length - 1], w.slice(1).join(" ")])] : []));
    const count = new Map();
    const bump = (m, k, i) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(i); };
    surnames.forEach((list, i) => list.forEach((k) => bump(count, k, i)));
    const cand = new Map();
    surnames.forEach((list, i) => {
      list.forEach((k) => bump(cand, k, i));
      if (list.some((k) => count.get(k).size > 1)) bump(cand, words[i][0], i);
    });
    const short = new Map(), ambig = new Set();
    cand.forEach((set, k) => {
      if (exact.has(k)) return;
      if (set.size === 1) short.set(k, [...set][0]);
      else ambig.add(k);
    });

    const traps = new Map(Object.entries(prompt.traps || {}).map(([k, v]) => [norm(k), v]));
    return { text: prompt.text, rule: prompt.rule || "", id: prompt.id || "", tiers, answers, exact, short, ambig, traps };
  }

  // -> {i} a match, {guess: i} a near miss to confirm, {err, free} not on the board (free: no shake)
  function lookup(input, P) {
    const n = norm(input);
    const shown = String(input).trim();
    if (!n) return { err: "Type a name first.", free: true };
    if (P.exact.has(n)) return { i: P.exact.get(n) };
    if (P.short.has(n)) return { i: P.short.get(n) };
    if (P.ambig.has(n)) return { err: `More than one ${shown} on the board. Type the full name.`, free: true };
    for (const [k, msg] of P.traps) if (k === n || k.split(" ").pop() === n) return { err: msg };
    const cap = Math.max(1, Math.floor(n.length / 4));
    let best = -1, bd = cap + 1;
    const scan = (k, i) => { if (k.length < 4) return; const d = lev(n, k, cap); if (d < bd) { bd = d; best = i; } };
    P.exact.forEach((i, k) => scan(k, i));
    P.short.forEach((i, k) => scan(k, i));
    if (best >= 0 && bd <= cap) return { guess: best };
    return { err: `“${shown}” doesn't fit this prompt.` };
  }

  const api = { norm, prepare, lookup };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DiveMatch = api;
})(typeof window !== "undefined" ? window : globalThis);
