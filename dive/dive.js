// Daily Dive: loads the day's file from /dive/days/ (written by the question engine) and runs the game.
// Points come only from the day's answer key, fixed when the day is pushed. Player counts, when a day
// file has them, are display-only.
(function () {
  "use strict";

  const M_PER_PT = 10, SLOTS = 7, DESCEND = 3;
  const EMOJI = ["🫧", "🐡", "🐟", "🦑", "🐋", "🏀"];
  const NOTES = [
    ["Everyone's first thought. Still counts.", "The obvious one. Safe points."],
    ["You thought this was the sneaky one. So did everyone else."],
    ["A solid answer from a real fan.", "Good pull. Most fans would know it."],
    ["Now the light is fading.", "That takes some real basketball memory."],
    ["Deep cut. The scouts would be proud.", "A name most fans have forgotten."],
    ["Nothing but net, from the bottom of the ocean."],
  ];
  const BANDS = [[0, "Shallows"], [150, "Reef"], [250, "Twilight"], [350, "Midnight"], [450, "Trench"]];
  const bandOf = (p) => BANDS.filter((b) => p >= b[0]).pop()[1];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => n.toLocaleString("en-US");
  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayName = (ds) => new Date(ds + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // Reading telemetry, same endpoint and rules as the rest of the site (no cookies, respects DNT).
  function beacon(t, item) {
    try {
      if (navigator.doNotTrack === "1" || DAY.preview) return;
      const body = JSON.stringify({ t, i: item, n: 0 });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/e", new Blob([body], { type: "application/json" }));
      else fetch("/api/e", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body });
    } catch (e) {}
  }

  // ---------- day
  let DAY = null, P = [], S = null, pending = null, tick = null, timers = [];
  const LIMIT = () => (DAY.secondsPerPrompt || 25) * 1000;
  const saveKey = () => "dive_v1_" + DAY.date;
  const tierColor = (t) => `var(--t-${t})`;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const later = (ms, f) => timers.push(setTimeout(f, reduced() ? 0 : ms));
  const clearLater = () => { timers.forEach(clearTimeout); timers = []; };
  // A new dive every midnight Eastern, wherever the player is.
  const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  async function load() {
    const params = new URLSearchParams(location.search);
    const asked = params.get("d");
    const index = await (await fetch("/dive/days/index.json", { cache: "no-cache" })).json();
    const days = index.days.slice().sort();
    const today = todayET();
    let date = asked && days.includes(asked) ? asked : days.filter((d) => d <= today).pop();
    let preview = !!(asked && days.includes(asked) && asked !== today);
    let warn = "";
    if (!date) { date = days[0]; preview = true; warn = `Dive №1 opens ${dayName(date)}. This is a preview, so nothing is saved.`; }
    else if (preview) warn = `Preview of ${dayName(date)}. Nothing is saved.`;
    const day = await (await fetch(`/dive/days/${date}.json`, { cache: "no-cache" })).json();
    DAY = { ...day, date, n: days.indexOf(date) + 1, preview, warn, next: days.find((d) => d > date) || null };
    P = day.prompts.slice().sort((a, b) => a.slot - b.slot).slice(0, SLOTS).map(DiveMatch.prepare);
  }

  // A round's result: {i: answer index, status: "ok"} or {status: "time"}.
  const result = (k) => S.answers[k];
  const hit = (k) => { const r = result(k); return r && r.status === "ok" ? P[k].answers[r.i] : null; };
  const pts = (k) => { const a = hit(k); return a ? a.points : 0; };
  const total = () => S.answers.reduce((s, _, k) => s + pts(k), 0);
  const meters = () => total() * M_PER_PT;
  const maxM = () => P.reduce((s, p) => s + Math.max(...p.tiers.map((t) => t.points)), 0) * M_PER_PT;

  // The round in progress is saved with absolute deadlines, so a reload resumes it with the clock still running.
  function persist() {
    if (DAY.preview) return;
    const round = S.phase === "descend" || S.phase === "live" ? { cur: S.cur, phase: S.phase, descendEndsAt: S.descendEndsAt, answerEndsAt: S.answerEndsAt } : null;
    store.set(saveKey(), { answers: S.answers, rating: S.rating, round });
  }

  // ---------- ocean + ruler
  const mix = (a, b, t) => "#" + [0, 2, 4].map((i) => Math.round(parseInt(a.substr(i + 1, 2), 16) * (1 - t) + parseInt(b.substr(i + 1, 2), 16) * t).toString(16).padStart(2, "0")).join("");
  const yPct = (m) => 2 + Math.min(1, m / maxM()) * 96;
  function renderOcean(m) {
    const t = Math.min(1, m / maxM());
    $("ocean").style.setProperty("--sea-top", mix("#0E4A6E", "#0A1426", Math.min(1, t * 1.6)));
    $("ocean").style.setProperty("--sea-bot", mix("#06223A", "#020408", Math.min(1, t * 1.6)));
    $("rays").style.opacity = String(Math.max(0, 1 - t * 1.8));
  }
  function buildRuler() {
    let h = '<div class="r-line"></div>';
    for (let m = 0; m <= maxM(); m += 1000) h += `<div class="r-tick" style="top:${yPct(m)}%"></div>`;
    h += '<div class="r-me" id="rMe"><svg viewBox="-60 -60 120 120"><use href="#puffer"/></svg></div>';
    $("ruler").innerHTML = h;
  }
  // shown: the depth on screen, which lags the real one while a reveal counts up.
  function renderTop(shown) {
    const m = shown === undefined ? meters() : shown;
    $("rMe").style.top = yPct(m) + "%";
    $("mTop").textContent = fmt(m) + " m";
    $("ptsTop").textContent = Math.round(m / M_PER_PT) + " pts";
    $("pips").innerHTML = P.map((_, k) => {
      const r = result(k), a = hit(k), live = k === S.cur && (S.phase === "descend" || S.phase === "live");
      const cls = live ? " cur" : r && !a ? " miss" : "";
      return `<span class="pip${cls}">${r && !live ? (a ? EMOJI[a.tier] : "·") : ""}</span>`;
    }).join("");
    renderOcean(m);
  }

  // ---------- views
  function show(v) { ["load", "start", "play", "reveal", "done"].forEach((k) => ($(k + "View").hidden = k !== v)); S.view = v; }
  const card = () => document.querySelector(".card");
  function animateCard(cls) { const c = card(); c.classList.remove("in", "out", "fade"); void c.offsetWidth; if (cls && !reduced()) c.classList.add(cls); }

  function renderStart() {
    show("start"); renderTop();
    const resume = S.answers.length > 0;
    $("begin").textContent = resume ? `Continue from round ${S.answers.length + 1}` : "Start the descent";
    $("startSub").textContent = `Dive №${DAY.n} · ${dayName(DAY.date)} · one scored dive a day`;
    $("startWarn").hidden = !DAY.warn;
    $("startWarn").textContent = DAY.warn;
  }

  function renderPlay() {
    show("play"); renderTop();
    const pr = P[S.cur];
    $("qnum").textContent = `Round ${S.cur + 1} of ${P.length}`;
    $("q").textContent = pr.text;
    $("qrule").textContent = pr.rule;
    $("descBox").hidden = S.phase !== "descend";
    $("form").hidden = S.phase !== "live";
    $("gStatus").textContent = `${S.answers.length} of ${P.length} played`;
  }

  // ---------- rounds
  function startRound() {
    clearLater(); clearInterval(tick);
    S.phase = "descend"; S.descendEndsAt = Date.now() + DESCEND * 1000; S.answerEndsAt = S.descendEndsAt + LIMIT();
    persist(); descend(true);
  }
  // The prompt card swims in half a second into the descent; the clock starts when the descent ends.
  function descend(fresh) {
    S.phase = "descend"; renderPlay(); setHint("", "");
    if (fresh) { card().classList.add("pre"); later(500, () => { card().classList.remove("pre"); animateCard("in"); }); }
    const step = () => {
      const left = S.descendEndsAt - Date.now();
      if (left > 0) { $("descN").textContent = Math.ceil(left / 1000); return; }
      clearInterval(tick); goLive();
    };
    step(); clearInterval(tick); tick = setInterval(step, 100);
  }
  function goLive() {
    S.phase = "live"; pending = null; persist(); renderPlay();
    $("guess").value = ""; syncGo(); setHint("", "");
    $("guess").focus();
    clearInterval(tick); air(); tick = setInterval(air, 100);
  }

  // ---------- air
  const CIRC = 2 * Math.PI * 25;
  $("ringFg").style.strokeDasharray = CIRC;
  function air() {
    const ms = S.answerEndsAt - Date.now();
    $("ringFg").style.strokeDashoffset = CIRC * (1 - Math.max(0, ms / LIMIT()));
    $("tsec").textContent = Math.ceil(Math.max(0, ms) / 1000);
    $("ring").classList.toggle("low", ms < 6000);
    document.body.classList.toggle("edge", ms > 0 && ms <= 5000);
    if (ms <= 0) {
      // Time's up: whatever is in the box counts if it's an exact match. Near misses don't get a confirm.
      const r = DiveMatch.lookup($("guess").value, P[S.cur]);
      settle(r.i !== undefined ? { i: r.i, status: "ok" } : { status: "time" });
    }
  }
  function settle(r) {
    clearInterval(tick); clearLater(); document.body.classList.remove("edge");
    S.answers[S.cur] = r; S.phase = "reveal"; persist();
    animateCard("out");
    later(600, () => { animateCard("fade"); renderReveal(); });
  }

  function setHint(cls, html) { $("hint").className = "hint" + (cls ? " " + cls : ""); $("hint").innerHTML = html; }
  function miss(input, msg, free) {
    setHint("", "");
    if (free) return setHint("err", esc(msg));
    // the typed text stays in the box; the message lands a beat later with a jolt
    later(300, () => { if (S.phase === "live") setHint("err jolt", `Not on the board. ${esc(msg)} The clock keeps running.`); });
  }
  const syncGo = () => { $("go").disabled = !$("guess").value.trim(); };

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (S.phase !== "live") return;
    const val = $("guess").value;
    if (!val.trim()) return;
    if (pending && pending.text === val) return settle({ i: pending.i, status: "ok" });
    const r = DiveMatch.lookup(val, P[S.cur]);
    if (r.i !== undefined) return settle({ i: r.i, status: "ok" });
    if (r.guess !== undefined) {
      // Near miss: the box takes the suggestion, and submitting again confirms it.
      const name = P[S.cur].answers[r.guess].name;
      pending = { text: name, i: r.guess };
      $("guess").value = name; syncGo();
      setHint("confirm", `<span class="typed">“${esc(val.trim())}”</span> → <b>“${esc(name)}”</b><small>submit again to confirm · or edit</small>`);
      return;
    }
    pending = null; miss(val, r.err, r.free);
  });
  $("guess").addEventListener("input", () => {
    syncGo();
    if (pending && $("guess").value !== pending.text) pending = null;
    if ($("hint").textContent) setHint("", "");
  });

  // ---------- reveal
  // Timeline (from the answer): card out 0.6 s; depth counts up 0.6 to 3.6 s while the puffer sinks past
  // the tier lines; at 3.75 s the tier banner pops and Descend rises; points count up in 0.35 s.
  function ladder(t, pr) {
    const step = 84 / Math.max(1, pr.tiers.length - 1);
    const to = t === null ? 96 : 8 + t * step;
    // the sinker eases out (cubic), so it passes line y at t = 1 - (1 - y)^(1/3) of the way through its 3 s
    const when = (y) => (0.6 + 3 * (1 - Math.cbrt(1 - Math.min(1, (y - 2) / (to - 2 || 1))))).toFixed(2);
    const lines = pr.tiers.map((x, i) => {
      const y = 8 + i * step, passed = y <= to;
      return `<div class="ln${i === t ? " on" : ""}${passed ? " pass" : ""}" style="top:${y}%;--c:${tierColor(i)};--d:${passed ? when(y) : 0}s">${esc(x.name)} · ${x.points}</div>`;
    }).join("");
    return `<div class="ladder" aria-hidden="true">${lines}<div class="sinker" id="sinker" style="top:2%" data-to="${to}%"><svg viewBox="-60 -60 120 120"><use href="#puffer"/></svg></div></div>`;
  }
  const easiest = (pr) => pr.answers.reduce((b, a) => (a.points < b.points || (a.points === b.points && a.players > b.players) ? a : b));
  const deepest = (pr) => pr.answers.reduce((b, a) => (a.points > b.points ? a : b));
  const chose = (a) => (a.players ? ` ${fmt(a.players)} other divers chose this.` : "");

  function countUp(el, from, to, ms, f) {
    if (reduced() || ms <= 0) { el.textContent = f(to); return; }
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / ms), v = from + (to - from) * (1 - Math.pow(1 - t, 3));
      el.textContent = f(Math.round(v));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function renderReveal() {
    show("reveal");
    $("rvBody").classList.remove("land", "missed");
    const pr = P[S.cur], a = hit(S.cur), last = S.cur === P.length - 1;
    const before = meters() - pts(S.cur) * M_PER_PT;
    renderTop(before);
    $("rvNum").textContent = `Round ${S.cur + 1} of ${P.length}`;
    const btn = `<button class="btn btn-dive rise" id="descendNext" type="button">${last ? "Surface" : "Descend"}</button>`;
    if (!a) {
      const deep = deepest(pr);
      $("rvBody").innerHTML = `<div><div class="rv-banner zero">Out of air</div><div class="rv-nums"><div><b>0</b>points</div><div><b>+0 m</b>sunk</div></div><div class="rv-note">The easy one was ${esc(easiest(pr).name)}. The Buzzer Beater was ${esc(deep.name)}${deep.note ? ": " + esc(deep.note) : "."}</div>${btn}</div>${ladder(null, pr)}`;
      $("rvBody").classList.add("missed");
      later(900, () => $("rvBody").classList.add("land"));
    } else {
      const notes = NOTES[Math.min(a.tier, NOTES.length - 1)], note = notes[Math.floor(hash(a.name) * notes.length)];
      $("rvBody").innerHTML = `<div><div class="rv-banner" style="--c:${tierColor(a.tier)}">${EMOJI[a.tier]} ${esc(pr.tiers[a.tier].name)}</div><div class="rv-name">${esc(a.name)}</div><div class="rv-nums"><div><b id="rvPts">0</b>points</div><div><b id="rvM">+0 m</b>sunk</div></div><div class="rv-note">${a.note ? esc(a.note) : note}${chose(a)}</div>${btn}</div>${ladder(a.tier, pr)}`;
      $("rvBody").classList.remove("missed");
      const gain = a.points * M_PER_PT;
      later(0, () => { countUp($("rvM"), 0, gain, 3000, (v) => `+${fmt(v)} m`); countUp($("mTop"), before, before + gain, 3000, (v) => `${fmt(v)} m`); });
      later(3750, () => { $("rvBody").classList.add("land"); renderTop(); countUp($("rvPts"), 0, a.points, 350, String); });
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { const s = $("sinker"); if (s) s.style.top = s.dataset.to; }));
    if (reduced()) { $("rvBody").classList.add("land"); renderTop(); }
    $("descendNext").addEventListener("click", next);
    later(a ? 3750 : 900, () => $("descendNext").focus());
  }

  function next() {
    clearLater();
    if (S.answers.length >= P.length) { beacon("fin", "/dive"); return renderDone(); }
    S.cur = S.answers.length;
    startRound();
  }

  // ---------- results
  function drawLog() {
    const top = maxM(), x = (i) => 30 + i * (250 / P.length), y = (m) => 18 + (m / top) * 150;
    let m = 0, d = `M${x(0)},${y(0)}`, dots = "";
    const css = getComputedStyle(document.documentElement);
    S.answers.forEach((_, k) => {
      const a = hit(k); m += pts(k) * M_PER_PT;
      d += `L${x(k + 1).toFixed(1)},${y(m).toFixed(1)}`;
      dots += `<circle cx="${x(k + 1).toFixed(1)}" cy="${y(m).toFixed(1)}" r="5" fill="${a ? css.getPropertyValue("--t-" + a.tier).trim() : "#6F8DA6"}" stroke="#050A14" stroke-width="2"/>`;
    });
    const grid = [0, 2000, 4000, 6000].filter((v) => v <= top).map((v) => `<line x1="30" x2="280" y1="${y(v)}" y2="${y(v)}" stroke="rgba(234,246,255,.08)"/><text x="24" y="${y(v) + 4}" text-anchor="end">${v / 1000}k</text>`).join("");
    const xl = P.map((_, k) => `<text x="${x(k + 1)}" y="186" text-anchor="middle">${k + 1}</text>`).join("");
    $("log").innerHTML = grid + xl + `<path d="${d}" fill="none" stroke="#EAF6FF" stroke-width="2" stroke-linejoin="round"/>` + dots;
  }

  function renderDone() {
    clearInterval(tick); clearLater(); animateCard("fade");
    S.phase = "done"; show("done"); S.cur = P.length; renderTop();
    const p = total(), m = meters(), maxP = maxM() / M_PER_PT;
    $("rLabel").textContent = `Dive №${DAY.n} complete`;
    $("rM").innerHTML = `${p}<small>pts</small>`;
    $("rPts").textContent = `${fmt(m)} m`;
    $("rBand").textContent = bandOf(p);
    $("nextTxt").textContent = DAY.preview ? "preview" : "next dive tomorrow";
    drawLog();
    $("bands").innerHTML = BANDS.map((b, i) => {
      const hi = BANDS[i + 1] ? BANDS[i + 1][0] - 1 : maxP;
      return `<div class="${bandOf(p) === b[1] ? "on" : ""}">${b[1]}<span>${b[0]}–${hi} pts</span></div>`;
    }).reverse().join("");
    $("haul").innerHTML = P.map((pr, k) => {
      const a = hit(k);
      const who = a ? esc(a.name) : "Out of air";
      const sub = a ? (a.note ? esc(a.note) : a.players ? `${fmt(a.players)} other divers chose this` : esc(pr.tiers[a.tier].name)) : `The easy one: ${esc(easiest(pr).name)}`;
      const list = pr.answers.slice().sort((x, y) => y.points - x.points || x.name.localeCompare(y.name))
        .map((x) => `<div class="${x === a ? "me" : ""}"><span><i>${EMOJI[x.tier]}</i>${esc(x.name)}</span><span>${x.points} pts${x.players ? ` · ${fmt(x.players)} picked` : ""}</span></div>`).join("");
      return `<details><summary><span class="e">${a ? EMOJI[a.tier] : "⬛"}</span><span class="who">${who}<small>${k + 1}. ${esc(pr.text)} · ${sub}</small></span><span class="p">+${pts(k)}<small>${fmt(pts(k) * M_PER_PT)} m</small></span></summary><div class="allans">${list}</div></details>`;
    }).join("");
    $("rate").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" aria-pressed="${S.rating === n}" aria-label="Rate ${n} of 5">${n}</button>`).join("");
    $("shareTxt").textContent = shareText();
  }

  const shareText = () => `Daily Dive #${DAY.n} 🏀\n${total()} pts · ${fmt(meters())} m\n\n${P.map((_, k) => { const a = hit(k); return a ? EMOJI[a.tier] : "⬛"; }).join("")}\nthegravityreport.com/dive`;

  $("rate").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.rating = +b.textContent; persist();
    beacon("use", `dive/rate/${S.rating}`);
    $("rate").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(+x.textContent === S.rating)));
  });
  function copyText(btn, txt, done) {
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("shareTxt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = "Selected"; };
    try { navigator.clipboard.writeText(txt).then(() => { btn.textContent = done; }, fallback); } catch (e) { fallback(); }
  }
  $("copy").addEventListener("click", () => copyText($("copy"), shareText(), "Copied ✓"));
  $("shareBtn").addEventListener("click", () => {
    if (navigator.share) navigator.share({ text: shareText() }).catch(() => {});
    else copyText($("shareBtn"), shareText(), "Copied");
  });
  $("begin").addEventListener("click", () => {
    if (!S.answers.length) beacon("use", "dive/start");
    S.cur = S.answers.length; startRound();
  });

  // ---------- menu
  const openMenu = (o) => { $("menu").hidden = !o; $("scrim").hidden = !o; $("menuBtn").setAttribute("aria-expanded", String(o)); if (o) $("menuX").focus(); else $("menuBtn").focus(); };
  $("menuBtn").addEventListener("click", () => openMenu(true));
  $("menuX").addEventListener("click", () => openMenu(false));
  $("scrim").addEventListener("click", () => openMenu(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("menu").hidden) openMenu(false); });

  // ---------- art
  $("spikes").innerHTML = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2, p = (r, o) => `${(Math.cos(a + o) * r).toFixed(1)},${(Math.sin(a + o) * r).toFixed(1)}`; return `<polygon points="${p(36, -0.13)} ${p(52, 0)} ${p(36, 0.13)}"/>`; }).join("");
  $("bubbles").innerHTML = Array.from({ length: 18 }, (_, i) => { const s = 4 + ((i * 7) % 14); return `<span style="left:${(i * 37) % 100}%;width:${s}px;height:${s}px;--dx:${(i % 2 ? 1 : -1) * ((i * 13) % 40)}px;animation-duration:${9 + ((i * 5) % 12)}s;animation-delay:-${(i * 3) % 14}s"></span>`; }).join("");

  // ---------- boot
  load().then(() => {
    const saved = DAY.preview ? null : store.get(saveKey());
    S = { view: "load", answers: ((saved && saved.answers) || []).slice(0, P.length), cur: 0, phase: "start", rating: (saved && saved.rating) || 0 };
    S.cur = Math.min(S.answers.length, P.length - 1);
    const round = saved && saved.round;
    $("menuNum").textContent = `№${DAY.n}`;
    $("menuTiers").innerHTML = P[0].tiers.map((t, i) => `<span class="badge" style="--c:${tierColor(i)}">${EMOJI[i]} ${esc(t.name)} · ${t.points}</span>`).join("");
    buildRuler();
    beacon("pv", "/dive");
    if (S.answers.length >= P.length) return renderDone();
    if (round && round.cur === S.answers.length) {
      // A reload mid-round picks the round back up; its clock never stopped. The typed draft is gone.
      Object.assign(S, { cur: round.cur, descendEndsAt: round.descendEndsAt, answerEndsAt: round.answerEndsAt });
      if (Date.now() < round.descendEndsAt) return descend(false);
      if (Date.now() < round.answerEndsAt) return goLive();
      S.answers[S.cur] = { status: "time" }; S.phase = "reveal"; persist();
      return renderReveal();
    }
    renderStart();
  }).catch(() => {
    $("loadView").innerHTML = '<p class="pill">Today\'s dive didn\'t load. Refresh to try again.</p>';
  });
})();
