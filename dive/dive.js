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
  let DAY = null, P = [], S = null, pending = null, tick = null, deadline = 0;
  const LIMIT = () => (DAY.secondsPerPrompt || 25) * 1000;
  const saveKey = () => "dive_v1_" + DAY.date;
  const tierColor = (t) => `var(--t-${t})`;

  async function load() {
    const params = new URLSearchParams(location.search);
    const asked = params.get("d");
    const index = await (await fetch("/dive/days/index.json", { cache: "no-cache" })).json();
    const days = index.days.slice().sort();
    const today = localDate(new Date());
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

  function persist() {
    if (DAY.preview) return;
    store.set(saveKey(), { answers: S.answers, rating: S.rating });
  }

  // ---------- ocean + ruler
  const mix = (a, b, t) => "#" + [0, 2, 4].map((i) => Math.round(parseInt(a.substr(i + 1, 2), 16) * (1 - t) + parseInt(b.substr(i + 1, 2), 16) * t).toString(16).padStart(2, "0")).join("");
  const yPct = (m) => 2 + Math.min(1, m / maxM()) * 96;
  function renderOcean() {
    const t = Math.min(1, meters() / maxM());
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
  function renderTop() {
    const m = meters();
    $("rMe").style.top = yPct(m) + "%";
    $("mTop").textContent = fmt(m) + " m";
    $("ptsTop").textContent = total() + " pts";
    $("pips").innerHTML = P.map((_, k) => {
      const r = result(k), a = hit(k);
      const cls = k === S.cur && S.view === "play" ? " cur" : r && !a ? " miss" : "";
      return `<span class="pip${cls}">${r ? (a ? EMOJI[a.tier] : "·") : ""}</span>`;
    }).join("");
    renderOcean();
  }

  // ---------- views
  function show(v) { ["load", "start", "play", "reveal", "done"].forEach((k) => ($(k + "View").hidden = k !== v)); S.view = v; }

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
    if (S.phase === "descend") { $("hint").className = "hint"; $("hint").textContent = ""; }
    $("gStatus").textContent = `${S.answers.length} of ${P.length} played`;
  }

  function ladder(t, pr) {
    const step = 84 / Math.max(1, pr.tiers.length - 1);
    const lines = pr.tiers.map((x, i) => `<div class="ln${i === t ? " on" : ""}" style="top:${8 + i * step}%;--c:${tierColor(i)}">${esc(x.name)} · ${x.points}</div>`).join("");
    const to = t === null ? 96 : 8 + t * step;
    return `<div class="ladder" aria-hidden="true">${lines}<div class="sinker" id="sinker" style="top:2%" data-to="${to}%"><svg viewBox="-60 -60 120 120"><use href="#puffer"/></svg></div></div>`;
  }
  const badge = (t, pr) => t === null ? '<span class="badge zero">No score</span>' : `<span class="badge" style="--c:${tierColor(t)}">${EMOJI[t]} ${esc(pr.tiers[t].name)}</span>`;
  const easiest = (pr) => pr.answers.reduce((b, a) => (a.points < b.points || (a.points === b.points && a.players > b.players) ? a : b));
  const deepest = (pr) => pr.answers.reduce((b, a) => (a.points > b.points ? a : b));
  const chose = (a) => (a.players ? ` ${fmt(a.players)} other divers chose this.` : "");

  function renderReveal() {
    show("reveal"); renderTop();
    const pr = P[S.cur], a = hit(S.cur), last = S.cur === P.length - 1;
    $("rvNum").textContent = `Round ${S.cur + 1} of ${P.length}`;
    const btn = `<button class="btn btn-dive" id="descendNext" type="button">${last ? "Surface" : "Descend"}</button>`;
    if (!a) {
      $("rvBody").innerHTML = `<div><div class="rv-name">Out of air</div><div class="rv-tier">${badge(null, pr)}</div><div class="rv-nums"><div><b>0</b>points</div><div><b>+0 m</b>sunk</div></div><div class="rv-note">The easy one was ${esc(easiest(pr).name)}. The Buzzer Beater was ${esc(deepest(pr).name)}${deepest(pr).note ? ": " + esc(deepest(pr).note) : "."}</div>${btn}</div>${ladder(null, pr)}`;
    } else {
      const notes = NOTES[Math.min(a.tier, NOTES.length - 1)], note = notes[Math.floor(hash(a.name) * notes.length)];
      $("rvBody").innerHTML = `<div><div class="rv-name">${esc(a.name)}</div><div class="rv-tier">${badge(a.tier, pr)}</div><div class="rv-nums"><div><b>${a.points}</b>points</div><div><b>+${fmt(a.points * M_PER_PT)} m</b>sunk</div></div><div class="rv-note">${a.note ? esc(a.note) : note}${chose(a)}</div>${btn}</div>${ladder(a.tier, pr)}`;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { const s = $("sinker"); if (s) s.style.top = s.dataset.to; }));
    $("descendNext").addEventListener("click", next);
    $("descendNext").focus();
  }

  function next() {
    if (S.answers.length >= P.length) { beacon("fin", "/dive"); return renderDone(); }
    S.cur = S.answers.length;
    startRound();
  }

  function startRound() {
    S.phase = "descend"; renderPlay();
    let n = DESCEND; $("descN").textContent = n;
    clearInterval(tick);
    tick = setInterval(() => {
      n--;
      if (n > 0) { $("descN").textContent = n; return; }
      clearInterval(tick);
      S.phase = "live"; pending = null; renderPlay();
      $("guess").value = ""; $("hint").className = "hint"; $("hint").textContent = "";
      // Leaving mid-round costs the round, so a reload can't buy a second look at the prompt.
      S.answers[S.cur] = { status: "time" }; persist();
      startAir(); $("guess").focus();
    }, 1000);
  }

  // ---------- air
  const CIRC = 2 * Math.PI * 25;
  $("ringFg").style.strokeDasharray = CIRC;
  function setAir(ms) {
    $("ringFg").style.strokeDashoffset = CIRC * (1 - Math.max(0, ms / LIMIT()));
    $("tsec").textContent = Math.ceil(Math.max(0, ms) / 1000);
    $("ring").classList.toggle("low", ms < 6000);
  }
  function startAir() {
    deadline = performance.now() + LIMIT(); setAir(LIMIT()); clearInterval(tick);
    tick = setInterval(() => { const left = deadline - performance.now(); setAir(left); if (left <= 0) settle({ status: "time" }); }, 100);
  }
  function settle(r) {
    clearInterval(tick);
    S.answers[S.cur] = r; S.phase = "reveal"; persist();
    renderReveal();
  }
  function miss(msg, shake) {
    if (shake) { const r = $("ring"); r.classList.remove("hit"); void r.offsetWidth; r.classList.add("hit"); }
    $("hint").className = "hint err";
    $("hint").textContent = shake ? `Not on the board. ${msg} The clock keeps running.` : msg;
    $("guess").select();
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (S.phase !== "live") return;
    const val = $("guess").value;
    if (pending && pending.text === val) return settle({ i: pending.i, status: "ok" });
    const r = DiveMatch.lookup(val, P[S.cur]);
    if (r.i !== undefined) return settle({ i: r.i, status: "ok" });
    if (r.guess !== undefined) {
      pending = { text: val, i: r.guess };
      $("hint").className = "hint confirm";
      $("hint").innerHTML = `Did you mean <b>${esc(P[S.cur].answers[r.guess].name)}</b>? Submit again to confirm, or edit.`;
      return;
    }
    pending = null; miss(r.err, !r.free);
  });
  $("guess").addEventListener("input", () => {
    if (pending && $("guess").value !== pending.text) { pending = null; $("hint").className = "hint"; $("hint").textContent = ""; }
  });

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
    clearInterval(tick);
    show("done"); S.cur = P.length; renderTop();
    const p = total(), m = meters(), maxP = maxM() / M_PER_PT;
    $("rLabel").textContent = `Dive №${DAY.n} · you reached`;
    $("rM").innerHTML = `${fmt(m)}<small>m</small>`;
    $("rPts").textContent = p;
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

  const shareText = () => `Daily Dive №${DAY.n} · ${fmt(meters())} m\n${P.map((_, k) => { const a = hit(k); return a ? EMOJI[a.tier] : "⬛"; }).join("")}\nthegravityreport.com/dive`;

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
  $("copy").addEventListener("click", () => copyText($("copy"), shareText(), "Copied"));
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
    S = { view: "load", answers: (saved && saved.answers) || [], cur: 0, phase: "descend", rating: (saved && saved.rating) || 0 };
    S.answers = S.answers.slice(0, P.length);
    S.cur = Math.min(S.answers.length, P.length - 1);
    $("menuNum").textContent = `№${DAY.n}`;
    $("menuTiers").innerHTML = P[0].tiers.map((t, i) => `<span class="badge" style="--c:${tierColor(i)}">${EMOJI[i]} ${esc(t.name)} · ${t.points}</span>`).join("");
    buildRuler();
    beacon("pv", "/dive");
    if (S.answers.length >= P.length) renderDone(); else renderStart();
  }).catch(() => {
    $("loadView").innerHTML = '<p class="pill">Today\'s dive didn\'t load. Refresh to try again.</p>';
  });
})();
