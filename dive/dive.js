// Daily Dive: loads the day's file from /dive/days/ (written by the question engine) and runs the game in a
// top-down pixel-art court ("Deep Range"): every point is a foot further from the rim. Points come only from the day's answer key, fixed when the day is pushed. Player counts,
// when a day file has them, are display-only.
(function () {
  "use strict";

  const M_PER_PT = 1, SLOTS = 7, DESCEND = 3;   // 1 point = 1 foot of range
  let PXM = 13;    // scene: CSS px per foot (8 on phones, set in resize)
  const REVEAL_Y = 0.64; // where the landing depth sits on screen during a reveal, below the banner text
  const LOW = 2;   // scene: CSS px per art pixel
  const EMOJI = ["⚪", "🟡", "🟢", "🔵", "🟣", "🏀"];
  const NOTES = [
    ["Everyone's first thought. Still counts.", "The answer half the country typed."],
    ["You thought this was the sneaky one. So did everyone else."],
    ["A real fan's answer.", "Good pull. Most fans would know it."],
    ["Now you're pulling up from the logo.", "That takes real basketball memory."],
    ["Deep cut. The scouts would be proud.", "A name most fans have forgotten."],
    ["Nothing but net, from the parking lot."],
  ];
  const BANDS = [[0, "In the paint"], [150, "Mid-range"], [250, "Downtown"], [350, "Logo range"], [450, "Full-court heave"]];
  const bandOf = (p) => BANDS.filter((b) => p >= b[0]).pop()[1];
  // Landmarks on the way out, in feet from the rim.
  const MARKS = [
    [13.75, "the free-throw line"], [23.75, "the three-point line · 23 ft 9 in"], [32, "Steph range"], [41.75, "half court · the logo"],
    [64.75, "their three-point line"], [88.75, "the far baseline"], [118, "the upper deck"], [160, "the players' tunnel"],
    [225, "the concourse · $14 nachos"], [265, "the arena doors"], [300, "the statue out front"], [380, "the parking lot"],
    [450, "across the street"], [560, "the blacktop where it started"], [665, "the river"], [700, "a perfect game"],
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const dayName = (ds) => new Date(ds + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  const rnd = (i, k) => hash(i * 7919 + ":" + k);
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tierHex = (t) => getComputedStyle(document.documentElement).getPropertyValue("--t-" + t).trim();

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // Reading telemetry, same endpoint and rules as the rest of the site (no cookies, respects DNT).
  function beacon(t, item) {
    try {
      if (navigator.doNotTrack === "1" || !DAY || DAY.preview || window.DIVE_DATA) return;
      const body = JSON.stringify({ t, i: item, n: 0 });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/e", new Blob([body], { type: "application/json" }));
      else fetch("/api/e", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body });
    } catch (e) {}
  }

  // ======================================================================== sound
  // Every sound is synthesized here; nothing is loaded.
  const SFX = {
    ctx: null, master: null, amb: null, muted: !!store.get("dive_mute"),
    init() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      try { this.ctx = new C(); } catch (e) { return; }
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(this.ctx.destination);
      this.ambient();
    },
    setMuted(m) { this.muted = m; store.set("dive_mute", m); if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05); },
    tone(f, dur, { type = "square", vol = 0.12, to = null, at = 0, attack = 0.005 } = {}) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, { vol = 0.1, from = 800, to = 200, q = 1, at = 0, type = "lowpass" } = {}) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + at, n = Math.floor(this.ctx.sampleRate * dur), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = buf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
    },
    ambient() {
      // the arena: a crowd murmur that fades as you leave the building
      const n = this.ctx.sampleRate * 4, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.06 * (Math.random() * 2 - 1)) / 1.06; d[i] = last * 3 * (0.75 + 0.25 * Math.sin(i / this.ctx.sampleRate * 1.7)); }
      const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = buf; s.loop = true; f.type = "bandpass"; f.Q.value = 0.6; f.frequency.value = 900; g.gain.value = 0.06;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      this.amb = f; this.ambG = g;
    },
    depth(ft) { if (this.amb) { this.amb.frequency.setTargetAtTime(900 - 600 * Math.min(1, ft / 260), this.ctx.currentTime, 0.5); this.ambG.gain.setTargetAtTime(0.06 - 0.035 * Math.min(1, ft / 260), this.ctx.currentTime, 0.5); } },
    click() { this.tone(660, 0.05, { vol: 0.06 }); },
    key() { this.tone(1500 + Math.random() * 400, 0.018, { vol: 0.025 }); },
    start() {
      // the ref's whistle, then the crowd comes up
      for (const [f, at, d] of [[2950, 0, 0.18], [2950, 0.24, 0.42]]) { this.tone(f, d, { type: "sine", vol: 0.12, at }); this.tone(f * 1.012, d, { type: "sine", vol: 0.08, at }); this.noise(d, { vol: 0.03, from: 4000, to: 3000, type: "bandpass", q: 4, at }); }
      this.noise(1.6, { vol: 0.12, from: 700, to: 1100, type: "bandpass", q: 0.6, at: 0.3 });
    },
    countdown(n) { this.tone(n > 1 ? 520 : 780, 0.08, { type: "triangle", vol: 0.12 }); },
    go() { this.tone(880, 0.07, { vol: 0.08 }); this.tone(1320, 0.1, { vol: 0.08, at: 0.07 }); },
    tick() { this.tone(1046, 0.05, { vol: 0.07 }); },
    wrong() { [620, 931, 1377].forEach((f, i) => this.tone(f, 0.22 - i * 0.04, { type: "triangle", vol: 0.07 })); this.tone(150, 0.12, { type: "sine", vol: 0.1, to: 80 }); }, // a brick off the rim
    near() { this.tone(660, 0.07, { type: "triangle", vol: 0.1 }); this.tone(880, 0.1, { type: "triangle", vol: 0.1, at: 0.08 }); },
    hit() {
      // swish, then the ball takes off down the floor
      this.noise(0.35, { vol: 0.18, from: 6000, to: 1800, type: "highpass" }); this.noise(0.5, { vol: 0.08, from: 2500, to: 900, type: "bandpass", q: 1.5, at: 0.08 });
      this.noise(3.0, { vol: 0.08, from: 500, to: 1600, type: "bandpass", q: 0.7, at: 0.6 });
      for (let i = 0; i < 5; i++) this.tone(140 - i * 6, 0.1, { type: "sine", vol: 0.1 - i * 0.015, at: 0.7 + i * 0.55 * Math.pow(0.85, i), to: 60 });
    },
    banner(tier) {
      const base = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
      for (let i = 0; i <= tier + 1 && i < base.length; i++) this.tone(base[i] * (tier >= 4 ? 1.12 : 1), 0.35, { type: "triangle", vol: 0.1, at: i * 0.07 });
      if (tier === 5) { this.tone(233, 0.55, { type: "sawtooth", vol: 0.09, at: 0.45 }); this.tone(236, 0.55, { type: "square", vol: 0.05, at: 0.45 }); this.noise(1.2, { vol: 0.08, from: 2000, to: 700, at: 0.5, type: "bandpass" }); }
    },
    cross(i) { this.tone(392 * Math.pow(2, (i * 3) / 12), 0.12, { type: "square", vol: 0.06 }); this.tone(784 * Math.pow(2, (i * 3) / 12), 0.18, { type: "triangle", vol: 0.05, at: 0.03 }); },
    land(t) {
      this.tone(150, 0.14, { type: "sine", vol: 0.16, to: 60 }); this.tone(150, 0.1, { type: "sine", vol: 0.08, to: 60, at: 0.22 }); // the ball lands
      if (t >= 2) this.noise(0.8 + t * 0.4, { vol: 0.05 + t * 0.03, from: 700, to: 1300, type: "bandpass", q: 0.5, at: 0.05 }); // the crowd reacts
      if (t >= 3) for (let i = 0; i < 6 + t * 2; i++) this.tone(1200 + Math.random() * 1800, 0.05, { type: "triangle", vol: 0.035, at: 0.05 + i * 0.045 });
    },
    pop() { this.noise(0.25, { vol: 0.09, from: 3000, to: 400, type: "bandpass", q: 0.7 }); this.tone(1400 + Math.random() * 600, 0.08, { type: "triangle", vol: 0.05 }); },
    miss() {
      this.tone(220, 0.7, { type: "sawtooth", vol: 0.08 }); this.tone(224, 0.7, { type: "square", vol: 0.05 }); // shot clock horn
      this.noise(1.4, { vol: 0.08, from: 900, to: 300, type: "bandpass", q: 0.8, at: 0.4 }); // and the groan
    },
    surface() {
      this.tone(233, 0.9, { type: "sawtooth", vol: 0.08 }); this.tone(236, 0.9, { type: "square", vol: 0.05 }); this.noise(2.4, { vol: 0.16, from: 600, to: 1400, type: "bandpass", q: 0.5, at: 0.3 }); // final horn and the cheer
      [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.3, { type: "triangle", vol: 0.1, at: i * 0.09 })); },
  };
  document.addEventListener("pointerdown", () => SFX.init(), { capture: true });
  document.addEventListener("keydown", () => SFX.init(), { capture: true });

  // ======================================================================== scene
  const sea = $("sea"), ink = $("ink"), sx = sea.getContext("2d"), ix = ink.getContext("2d");
  const V = { W: 0, H: 0, dpr: 1, phone: false, cam: 0, camTarget: 0, level: 0, t: 0, last: 0,
    shownM: 0, diver: { x: 0, y: 0 }, tag: null, tiers: null, bubbles: [], clouds: [], mode: "start",
    fx: [], rings: [], tint: null, kick: 0, dt: 0.016 };

  function resize() {
    V.W = innerWidth; V.H = innerHeight; V.dpr = Math.min(2, devicePixelRatio || 1); V.phone = V.W < 700; PXM = V.phone ? 8 : 13;
    sea.width = Math.ceil(V.W / LOW); sea.height = Math.ceil(V.H / LOW);
    ink.width = Math.round(V.W * V.dpr); ink.height = Math.round(V.H * V.dpr);
    V.level = Math.round(V.H * (V.phone ? 0.21 : 0.27));
    document.documentElement.style.setProperty("--level", V.level + "px");
    if (!V.clouds.length) V.clouds = Array.from({ length: 9 }, (_, i) => ({ x: rnd(i, "cx") * 1.4 - 0.2, y: 0.15 + rnd(i, "cy") * 0.55, w: 40 + rnd(i, "cw") * 70, v: 0.004 + rnd(i, "cv") * 0.006 }));
    camAim(true);
  }
  addEventListener("resize", resize);

  const surfaceScreen = () => -V.cam;                       // screen y of the rim
  const yOf = (m) => m * PXM - V.cam;                       // screen y of a distance (ft)
  const rulerX = () => (V.phone ? V.W - 14 : Math.min(V.W - 40, V.W / 2 + 446));

  function camAim(snap) {
    if (V.mode === "start" || V.mode === "done") V.camTarget = -V.H * 0.56;
    else if (V.mode === "reveal" && V.tag) V.camTarget = V.tag.d * PXM - V.H * REVEAL_Y;
    else if (V.mode === "reveal") V.camTarget = S.depthM * PXM - V.H * REVEAL_Y;
    else V.camTarget = (S ? S.depthM : 0) * PXM - V.level;
    if (snap) V.cam = V.camTarget;
  }

  // The world, top down, in feet from the near rim: the court, then out the far end of the arena and across town.
  // NBA court geometry: baseline 5.25 ft behind the rim, free-throw line 13.75 ft in front, arc 23.75 ft,
  // corners 22 ft, half court 41.75 ft, far baseline 88.75 ft.
  const CT = { base: -5.25, ft: 13.75, arc: 23.75, corner: 22, half: 41.75, farRim: 83.5, far: 88.75, side: 25 };
  const Z = { stands: 100, tunnel: 135, concourse: 195, doors: 262, plaza: 268, lot: 330, street: 430, walk: 470, city: 478, river: 630, bank: 700 };
  const WOOD = ["#8E5F36", "#94643A", "#895A32", "#90613A"], LINE = "#E9DCC6", PAINT = "#1D3961", APRON = "#172B4A";
  const FANS = ["#F2C14E", "#E9DCC6", "#FF8A3D", "#4DE3FF", "#C9D6EA", "#D96C4E", "#8C9BFF", "#5E6E86"];
  const CARS = ["#B8423A", "#3E6FB0", "#D9D2C3", "#2B2F36", "#7A8794", "#C99A3B", "#3F8A6B"];

  function drawSea(dt) {
    const lw = sea.width, lh = sea.height, t = V.t, F = PXM / LOW, cx = lw / 2;
    const X = (ft) => Math.round(cx + ft * F), Y = (ft) => Math.round((ft * PXM - V.cam) / LOW);
    const f0 = V.cam / PXM - 2, f1 = (V.cam + V.H) / PXM + 2, hw = cx / F + 2;
    const vis = (a, b) => b > f0 && a < f1;
    const rect = (x0, y0, x1, y1, c) => {
      if (!vis(y0, y1)) return;
      const ax = X(x0), ay = Y(y0); sx.fillStyle = c; sx.fillRect(ax, ay, Math.max(1, X(x1) - ax), Math.max(1, Y(y1) - ay));
    };
    const dot = (x, y, c, s = 1) => { sx.fillStyle = c; sx.fillRect(X(x), Y(y), s, s); };
    const circle = (x, y, r, c, from = 0, to = Math.PI * 2) => {
      if (!vis(y - r, y + r)) return;
      sx.fillStyle = c; const n = Math.ceil(r * F * 7);
      for (let i = 0; i <= n; i++) { const a = from + (to - from) * i / n; sx.fillRect(X(x + Math.cos(a) * r), Y(y + Math.sin(a) * r), 1, 1); }
    };
    const disc = (x, y, r, c) => { if (!vis(y - r, y + r)) return; sx.fillStyle = c; for (let dy = -r; dy <= r; dy += 1 / F) { const w = Math.sqrt(Math.max(0, r * r - dy * dy)); sx.fillRect(X(x - w), Y(y + dy), Math.max(1, X(x + w) - X(x - w)), 1); } };

    // arena floor everywhere, then the zones on top
    sx.fillStyle = "#0B111D"; sx.fillRect(0, 0, lw, lh);

    // crowd: rows of seats with fans who bob, and the odd camera flash
    const crowd = (x0, x1, y0, y1, seed, rowGap = 2.6) => {
      if (!vis(y0, y1)) return;
      const cheer = V.mode === "reveal" ? 1 : 0.25;
      for (let ry = Math.max(y0, Math.floor((f0 - y0) / rowGap) * rowGap + y0); ry < Math.min(y1, f1); ry += rowGap) {
        const row = Math.round((ry - y0) / rowGap), shade = 0.5 + 0.5 * Math.sin(row * 0.9);
        rect(x0, ry, x1, ry + rowGap * 0.55, shade > 0.5 ? "#141C2B" : "#111827");
        for (let sxf = x0 + 1; sxf < x1 - 0.5; sxf += 2) {
          if (Math.abs(sxf) > hw) continue;
          const h = rnd(row * 131 + Math.round(sxf * 3), seed);
          if (h < 0.16) continue;                       // empty seat
          const bob = Math.sin(t * (4 + h * 3) + h * 40) > 1 - cheer * 0.6 ? 1 : 0;
          const flash = rnd(row * 977 + Math.round(sxf), seed + Math.floor(t * 3)) < 0.0025;
          sx.fillStyle = flash ? "#FFFFFF" : FANS[Math.floor(h * 97) % FANS.length];
          sx.fillRect(X(sxf), Y(ry + 0.2) - bob, 2, 2);
        }
      }
    };

    // ---- behind the near baseline: the stanchion end of the arena
    if (vis(-60, CT.base)) {
      rect(-hw, -60, hw, CT.base - 3, "#0D1422");
      crowd(-hw, hw, -60, CT.base - 7, "nb");
      rect(-hw, CT.base - 7, hw, CT.base - 3, "#101828");
      for (let x = -20; x <= 20; x += 5) if (Math.abs(x) > 4) rect(x - 1, CT.base - 6, x + 1, CT.base - 4.5, "#2A3346"); // photographers
    }
    // ---- the court
    if (vis(CT.base - 3, CT.far + 3)) {
      // courtside: dark floor, then crowd up the sides
      rect(-hw, CT.base - 3, hw, CT.far + 3, "#0E1626");
      crowd(-hw, -CT.side - 9, CT.base - 3, CT.far + 3, "ls");
      crowd(CT.side + 9, hw, CT.base - 3, CT.far + 3, "rs");
      for (const s of [-1, 1]) for (let y = 2; y < CT.far - 2; y += 2.2) if (y < 30 || y > 53) rect(s > 0 ? CT.side + 4 : -CT.side - 6, y, s > 0 ? CT.side + 6 : -CT.side - 4, y + 1.6, y % 6.6 < 2.2 ? "#2B3A55" : "#24324A"); // courtside chairs
      rect(-CT.side - 7, 34, -CT.side - 3.5, 49.5, "#1F2B40"); rect(-CT.side - 7, 34, -CT.side - 6.4, 49.5, "#FF8A3D"); // scorer's table
      // apron and hardwood planks
      rect(-CT.side - 3, CT.base - 3, CT.side + 3, CT.far + 3, APRON);
      const px0 = X(-CT.side), px1 = X(CT.side), py0 = Math.max(0, Y(CT.base)), py1 = Math.min(lh, Y(CT.far));
      for (let x = px0; x < px1; x += 3) {
        sx.fillStyle = WOOD[(x / 3 | 0) % WOOD.length]; sx.fillRect(x, py0, Math.min(3, px1 - x), py1 - py0);
        sx.fillStyle = "rgba(0,0,0,.18)";
        const step = 34 + ((x * 7) % 23), off = (x * 13) % step;
        for (let y = py0 - ((py0 + V.cam / LOW + off) % step); y < py1; y += step) if (y >= py0) sx.fillRect(x, y, 3, 1); // board joints
      }
      // painted areas: both lanes and the center logo
      for (const [rim, dir] of [[0, 1], [CT.farRim, -1]]) {
        const bl = rim - dir * 5.25, fl = rim + dir * 13.75;
        rect(-8, Math.min(bl, fl), 8, Math.max(bl, fl), PAINT);
      }
      disc(0, CT.half, 6, PAINT);
      // lines
      const L = (x0, y0, x1, y1) => rect(x0, y0, x1 === x0 ? x0 + 0.17 : x1, y1 === y0 ? y0 + 0.17 : y1, LINE);
      L(-CT.side, CT.base, -CT.side, CT.far); L(CT.side, CT.base, CT.side, CT.far);
      L(-CT.side, CT.base, CT.side, CT.base); L(-CT.side, CT.far, CT.side, CT.far); L(-CT.side, CT.half, CT.side, CT.half);
      circle(0, CT.half, 6, LINE); circle(0, CT.half, 2, LINE);
      for (const [rim, dir] of [[0, 1], [CT.farRim, -1]]) {
        const bl = rim - dir * 5.25, fl = rim + dir * 13.75, cy = Math.sqrt(CT.arc * CT.arc - CT.corner * CT.corner);
        L(-8, Math.min(bl, fl), -8, Math.max(bl, fl)); L(8, Math.min(bl, fl), 8, Math.max(bl, fl)); L(-8, fl, 8, fl);
        circle(0, fl, 6, LINE);
        circle(0, rim, 4, LINE, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI : Math.PI * 2);
        for (const s of [-1, 1]) L(s * CT.corner, Math.min(bl, rim + dir * cy), s * CT.corner, Math.max(bl, rim + dir * cy));
        const a = Math.acos(CT.corner / CT.arc);
        circle(0, rim, CT.arc, LINE, dir > 0 ? a : Math.PI + a, dir > 0 ? Math.PI - a : Math.PI * 2 - a);
        // the hoop: stanchion, backboard, rim and net
        rect(-0.5, Math.min(bl - dir * 4, rim - dir * 1.25), 0.5, Math.max(bl - dir * 4, rim - dir * 1.25), "#3A4458");
        rect(-3, bl - dir * 5.5 - 1.2, 3, bl - dir * 5.5 + 1.2, "#1D2A44");
        rect(-3, rim - dir * 1.25 - 0.15, 3, rim - dir * 1.25 + 0.15, "#F2F6FA");
        disc(0, rim, 0.75, "rgba(242,246,250,.55)"); circle(0, rim, 0.75, "#FF8A3D");
      }
      // center logo: a pixel basketball
      disc(0, CT.half, 3.2, "#D9732F"); circle(0, CT.half, 3.2, "#5A2108");
      rect(-3.2, CT.half - 0.12, 3.2, CT.half + 0.12, "#5A2108"); rect(-0.12, CT.half - 3.2, 0.12, CT.half + 3.2, "#5A2108");
      circle(-4.6, CT.half, 2.6, "#5A2108", -0.9, 0.9); circle(4.6, CT.half, 2.6, "#5A2108", Math.PI - 0.9, Math.PI + 0.9);
    }
    // ---- far end: baseline seats and the stands
    if (vis(CT.far + 3, Z.tunnel)) {
      rect(-hw, CT.far + 3, hw, Z.tunnel, "#0D1422");
      crowd(-hw, hw, CT.far + 5, Z.stands, "fb", 2.4);
      rect(-hw, Z.stands, hw, Z.stands + 1, "#1E2A40");
      crowd(-hw, -9, Z.stands + 1, Z.tunnel, "ud", 2.8); crowd(9, hw, Z.stands + 1, Z.tunnel, "ue", 2.8);
      rect(-8, CT.far + 3, 8, Z.tunnel, "#161E2E");                 // the aisle down to the tunnel
    }
    // ---- the players' tunnel
    if (vis(Z.tunnel, Z.concourse)) {
      rect(-hw, Z.tunnel, hw, Z.concourse, "#0A0F18");
      rect(-8, Z.tunnel, 8, Z.concourse, "#262D3B");
      rect(-8, Z.tunnel, -7.6, Z.concourse, "#F2C14E"); rect(7.6, Z.tunnel, 8, Z.concourse, "#F2C14E");
      for (let y = Z.tunnel + 6; y < Z.concourse; y += 12) for (const s of [-1, 1]) {
        const flick = Math.sin(t * 9 + y) > 0.97 ? 0.3 : 1;
        glow(s * 7, y, 6, flick);
        rect(s * 8 - 0.6, y - 0.6, s * 8 + 0.6, y + 0.6, "#FFE2A0");
      }
      for (let y = Z.tunnel + 20; y < Z.concourse; y += 20) rect(-2, y, 2, y + 0.4, "#3A4458");
    }
    // ---- the concourse
    if (vis(Z.concourse, Z.doors)) {
      for (let y = Z.concourse; y < Z.doors; y += 2) for (let x = -Math.ceil(hw / 2) * 2; x < hw; x += 2)
        if (vis(y, y + 2)) rect(x, y, x + 2, y + 2, ((x + y) / 2) % 2 ? "#343A48" : "#2E3441");
      const stands = [["#B8423A", "#F2F6FA"], ["#F2C14E", "#B8423A"], ["#3E6FB0", "#F2F6FA"], ["#3F8A6B", "#F2C14E"]];
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const y = Z.concourse + 8 + i * 15, x0 = s > 0 ? 14 : -26, [a, b] = stands[(i + (s > 0 ? 1 : 0)) % 4];
        rect(x0, y, x0 + 12, y + 3, "#1A1F2B");
        for (let k = 0; k < 6; k++) rect(x0 + k * 2, y + 3, x0 + k * 2 + 2, y + 4.5, k % 2 ? a : b); // awning
        rect(x0, y + 4.5, x0 + 12, y + 6, "#4A5160");                                              // counter
      }
      for (let i = 0; i < 26; i++) {                                                               // people walking
        const y = Z.concourse + 4 + rnd(i, "py") * (Z.doors - Z.concourse - 8), dir = rnd(i, "pd") > 0.5 ? 1 : -1;
        const span = 70, x = ((rnd(i, "px") * span + dir * t * (2 + rnd(i, "ps") * 3)) % span + span) % span - span / 2;
        if (vis(y, y + 1)) dot(x, y, FANS[i % FANS.length], 2);
      }
    }
    // ---- the doors, the plaza and the statue
    if (vis(Z.doors, Z.lot)) {
      rect(-hw, Z.doors, hw, Z.plaza, "#141A26");
      for (let x = -20; x < 20; x += 4) rect(x + 0.4, Z.doors + 1.5, x + 3.6, Z.plaza - 1.5, "rgba(140,200,240,.45)");
      rect(-hw, Z.plaza, hw, Z.lot, "#3D424C");
      for (let y = Z.plaza; y < Z.lot; y += 6) rect(-hw, y, hw, y + 0.18, "#353941");
      for (let x = -60; x < 60; x += 6) rect(x, Z.plaza, x + 0.18, Z.lot, "#353941");
      disc(0, 300, 7, "#2B3038"); disc(0, 300, 4, "#4A505C");                                     // statue on its plinth
      disc(0, 299, 1.1, "#7A8794"); rect(-0.8, 299.5, 0.8, 302, "#7A8794"); rect(0.6, 297, 1, 299.5, "#7A8794"); disc(1.2, 296.6, 0.7, "#C99A3B");
      for (let y = Z.plaza + 10; y < Z.lot; y += 22) for (const s of [-1, 1]) lamp(s * 20, y);
    }
    // ---- the parking lot
    if (vis(Z.lot, Z.street)) {
      rect(-hw, Z.lot, hw, Z.street, "#22252C");
      for (const r0 of [Z.lot + 8, Z.lot + 40, Z.lot + 72]) {
        for (let x = -Math.floor(hw / 9) * 9; x < hw; x += 9) {
          rect(x, r0, x + 0.18, r0 + 18, "#C9C2B0");
          const h = rnd(Math.round(x * 3) + r0, "car");
          if (h < 0.62) {
            const c = CARS[Math.floor(h * 71) % CARS.length], x0 = x + 1.6, y0 = r0 + 2 + h * 2;
            rect(x0, y0, x0 + 6, y0 + 14, c); rect(x0 + 0.8, y0 + 3, x0 + 5.2, y0 + 5, "#10141A"); rect(x0 + 0.8, y0 + 10.5, x0 + 5.2, y0 + 12, "#10141A");
            rect(x0 + 0.5, y0 + 5, x0 + 5.5, y0 + 10.5, "rgba(255,255,255,.08)");
          }
        }
        rect(-hw, r0 + 18, hw, r0 + 18.18, "#C9C2B0");
      }
      for (let y = Z.lot + 30; y < Z.street; y += 32) for (const s of [-1, 1]) lamp(s * 28, y);
    }
    // ---- the street, with traffic
    if (vis(Z.street, Z.city)) {
      rect(-hw, Z.street, hw, Z.walk, "#1A1D23");
      rect(-hw, Z.street, hw, Z.street + 0.3, "#8A8F99");
      for (let x = -Math.ceil(hw / 10) * 10; x < hw; x += 10) { rect(x, 449.4, x + 5, 449.7, "#F2C14E"); rect(x, 450.3, x + 5, 450.6, "#F2C14E"); }
      for (let x = -7; x < 7; x += 2.5) rect(x, Z.street + 2, x + 1.4, Z.walk - 2, "#C9C2B0"); // crosswalk
      for (let i = 0; i < 6; i++) {
        const lane = i % 2, dir = lane ? -1 : 1, span = hw * 2 + 40, y = lane ? 455 : 439;
        const x = ((rnd(i, "tx") * span + dir * t * (16 + i * 3)) % span + span) % span - span / 2;
        rect(x, y, x + 14, y + 6, CARS[i % CARS.length]); rect(dir > 0 ? x + 9 : x + 2, y + 0.8, dir > 0 ? x + 11 : x + 4, y + 5.2, "#10141A");
        if (V.mode !== "start") rect(dir > 0 ? x + 14 : x - 0.6, y + 0.6, dir > 0 ? x + 14.6 : x, y + 5.4, "#FFE9A8");
      }
      rect(-hw, Z.walk, hw, Z.city, "#5A5F69");
      for (let x = -Math.ceil(hw / 8) * 8; x < hw; x += 8) rect(x, Z.walk, x + 0.18, Z.city, "#4D525B");
    }
    // ---- the city: blocks of rooftops, a park, and the blacktop
    if (vis(Z.city, Z.river)) {
      rect(-hw, Z.city, hw, Z.river, "#191C22");
      for (let by = Z.city + 4; by < Z.river - 10; by += 76) for (let bx = -Math.ceil(hw / 84) * 84 - 32; bx < hw; bx += 84) {
        const k = Math.round(bx * 7 + by), h = rnd(k, "blk"), w = 64, d = 58;
        if (!vis(by, by + d)) continue;
        if (Math.abs(bx + 32) < 1 && by > 540 && by < 580) {
          // the blacktop where it started: a pickup court with chain-link around it
          rect(bx, by, bx + w, by + d, "#2B4A2E"); rect(bx + 10, by + 6, bx + w - 10, by + d - 6, "#2A2D33");
          const m = by + d / 2; rect(bx + 10, m, bx + w - 10, m + 0.18, "#E9DCC6");
          circle(bx + w / 2, m, 4, "#E9DCC6"); circle(bx + w / 2, by + 9, 0.6, "#FF8A3D"); circle(bx + w / 2, by + d - 9, 0.6, "#FF8A3D");
          circle(bx + w / 2, by + 9, 15, "#E9DCC6", 0.1, Math.PI - 0.1); circle(bx + w / 2, by + d - 9, 15, "#E9DCC6", Math.PI + 0.1, Math.PI * 2 - 0.1);
          rect(bx + 9, by + 5, bx + w - 9, by + 5.2, "#6E7682"); rect(bx + 9, by + d - 5.2, bx + w - 9, by + d - 5, "#6E7682");
          continue;
        }
        if (h < 0.18) {                                               // a park
          rect(bx, by, bx + w, by + d, "#22422A");
          for (let i = 0; i < 9; i++) disc(bx + 6 + rnd(k + i, "tx") * (w - 12), by + 6 + rnd(k + i, "ty") * (d - 12), 3, i % 2 ? "#2F5F38" : "#2A5532");
          continue;
        }
        const roof = ["#3A3F4A", "#454B57", "#33373F", "#4B4540"][Math.floor(h * 41) % 4];
        rect(bx, by, bx + w, by + d, roof); rect(bx, by, bx + w, by + 0.6, "#5A616E"); rect(bx, by + d - 1.2, bx + w, by + d, "rgba(0,0,0,.35)");
        for (let i = 0; i < 3; i++) rect(bx + 8 + i * 18, by + 10 + (h * 30 | 0), bx + 14 + i * 18, by + 15 + (h * 30 | 0), "#5E6570"); // AC units
        if (h > 0.6) { disc(bx + w - 12, by + 14, 4, "#6B4F35"); circle(bx + w - 12, by + 14, 4, "#3E2D1F"); }             // water tower
        for (let i = 0; i < 10; i++) if (Math.sin(t * 0.7 + i + h * 30) > 0.2) dot(bx + 4 + rnd(k + i, "wx") * (w - 8), by + 4 + rnd(k + i, "wy") * (d - 8), "rgba(255,226,160,.55)");
      }
      for (let y = Z.city + 66; y < Z.river; y += 76) for (let x = -Math.ceil(hw / 30) * 30; x < hw; x += 30) lamp(x, y);
    }
    // ---- the river, and the far bank
    if (vis(Z.river - 2, Z.bank + 80)) {
      rect(-hw, Z.river, hw, Z.bank, "#0F2E4F");
      for (let i = 0; i < 40; i++) {
        const y = Z.river + 3 + rnd(i, "ry") * (Z.bank - Z.river - 6), x = ((rnd(i, "rx") * hw * 2 + t * 4) % (hw * 2)) - hw;
        rect(x, y, x + 3 + rnd(i, "rw") * 6, y + 0.25, "rgba(160,210,255,.35)");
      }
      rect(-hw, Z.river - 1, hw, Z.river, "#5A5F69"); rect(-hw, Z.bank, hw, Z.bank + 1, "#3A4A3A");
      rect(-hw, Z.bank + 1, hw, Z.bank + 200, "#12251A");
      for (let i = 0; i < 30; i++) disc(-hw + rnd(i, "bx") * hw * 2, Z.bank + 6 + rnd(i, "by") * 60, 2.5, "#1B3A26");
    }

    // a stepped, pixel-style pool of warm light
    function glow(x, y, r, k) {
      for (const [f, a] of [[1, 0.04], [0.7, 0.05], [0.42, 0.06]]) disc(x, y, r * f, `rgba(255,214,140,${a * k})`);
    }
    function lamp(x, y) {
      if (!vis(y - 8, y + 8)) return;
      glow(x, y, 9, 1);
      rect(x - 0.5, y - 0.5, x + 0.5, y + 0.5, "#FFE2A0");
    }

    // arena lights: the court is lit, everything else falls off into the dark
    const g = sx.createRadialGradient(cx, lh * 0.5, Math.min(lw, lh) * 0.2, cx, lh * 0.5, Math.max(lw, lh) * 0.75);
    g.addColorStop(0, "rgba(5,10,20,0)"); g.addColorStop(1, "rgba(5,10,20,.55)");
    sx.fillStyle = g; sx.fillRect(0, 0, lw, lh);
    sx.fillStyle = `rgba(5,10,20,${V.mode === "reveal" ? 0.42 : V.mode === "play" ? 0.18 : 0.1})`; sx.fillRect(0, 0, lw, lh);

    // sneaker dust (the old bubbles): little specks that drift and fade
    V.bubbles = V.bubbles.filter((b) => (b.life -= dt) > 0);
    for (const b of V.bubbles) {
      b.y -= b.vy * dt * 0.3; b.x += Math.sin(V.t * 3 + b.p) * 0.3;
      sx.fillStyle = `rgba(233,220,198,${Math.min(0.6, b.life / 3)})`; sx.fillRect(Math.round(b.x / LOW), Math.round((b.y - V.cam) / LOW), 1, 1);
    }
    drawDiver();
  }

  // "you": a basketball, seen from above, dribbling in place and spinning as it travels
  function drawDiver() {
    const d = V.diver, bounce = Math.abs(Math.sin(V.t * (V.tag ? 9 : 5))), r = 5 + bounce * 1.2;
    const lx = Math.round(d.x / LOW), ly = Math.round(d.y / LOW);
    if (ly < -20 || ly > sea.height + 20) return;
    sx.fillStyle = "rgba(0,0,0,.45)";
    for (let dy = -4; dy <= 4; dy++) { const w = Math.round(Math.sqrt(16 - dy * dy) * 1.2); sx.fillRect(lx + 2 + Math.round(bounce * 3) - w, ly + 3 + Math.round(bounce * 4) + Math.round(dy * 0.6), w * 2, 1); }
    const rot = (V.cam / PXM) * 0.08 + V.t * 0.6, ca = Math.cos(rot), sa = Math.sin(rot), R = Math.round(r);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      if (x * x + y * y > r * r) continue;
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      const seam = Math.abs(u) < 0.55 || Math.abs(v) < 0.55 || Math.abs(Math.hypot(u - r * 1.25, v) - r * 0.95) < 0.5 || Math.abs(Math.hypot(u + r * 1.25, v) - r * 0.95) < 0.5;
      const lit = (x + y) / (2 * r);
      sx.fillStyle = seam ? "#4A1C08" : lit < -0.25 ? "#FFA25C" : lit > 0.35 ? "#C75F22" : "#F07F35";
      sx.fillRect(lx + x, ly + y, 1, 1);
    }
  }

  // crisp layer: ruler, depth markers, tier lines, the sinking tag, glows
  function drawInk() {
    const { W, H, dpr } = V;
    ix.setTransform(dpr, 0, 0, dpr, 0, 0); ix.clearRect(0, 0, W, H);
    ix.font = "13px VT323, monospace"; ix.textBaseline = "middle";
    const rx = rulerX(), sY = surfaceScreen();
    // diver glow
    ix.save(); const g = ix.createRadialGradient(V.diver.x, V.diver.y, 2, V.diver.x, V.diver.y, 34);
    g.addColorStop(0, "rgba(255,138,61,.35)"); g.addColorStop(1, "rgba(255,138,61,0)"); ix.fillStyle = g; ix.fillRect(V.diver.x - 40, V.diver.y - 40, 80, 80); ix.restore();
    // ruler
    const top = Math.max(sY, 0), bottom = H - (V.phone ? 90 : 90);
    if (bottom > top) {
      ix.strokeStyle = "rgba(159,178,207,.35)"; ix.lineWidth = 1;
      ix.beginPath(); ix.moveTo(rx + 0.5, top); ix.lineTo(rx + 0.5, bottom); ix.stroke();
      const mA = Math.max(0, Math.floor((V.cam + top) / PXM / 5) * 5), mB = (V.cam + bottom) / PXM;
      for (let m = mA; m <= mB; m += 5) {
        const y = Math.round(yOf(m)) + 0.5; if (y < top || y > bottom) continue;
        const major = m % 10 === 0;
        ix.beginPath(); ix.moveTo(rx - (major ? 14 : 6), y); ix.lineTo(rx, y); ix.stroke();
        if (major && !V.phone && Math.abs(y - yOf(V.shownM)) > 12) { ix.fillStyle = "rgba(159,178,207,.6)"; ix.textAlign = "right"; ix.fillText(`${m} ft`, rx - 18, y); }
      }
      // you
      const yy = yOf(V.shownM);
      if (yy > top && yy < bottom) {
        ix.strokeStyle = ix.fillStyle = "#FF8A3D"; ix.lineWidth = 2;
        ix.beginPath(); ix.moveTo(rx - 22, yy); ix.lineTo(rx + 4, yy); ix.stroke();
        ix.beginPath(); ix.moveTo(rx + 2, yy); ix.lineTo(rx + 10, yy - 5); ix.lineTo(rx + 10, yy + 5); ix.fill();
        ix.textAlign = "right"; ix.fillText("YOU", rx - 26, yy); ix.lineWidth = 1;
      }
    }
    // depth markers
    ix.font = "17px VT323, monospace";
    MARKS.forEach(([m, text], i) => {
      const y = yOf(m); if (y < sY + 10 || y < 90 || y > H - 110) return;
      if (V.mode === "reveal" && y > H * 0.22 && y < H * 0.58) return;
      ix.fillStyle = ix.strokeStyle = "rgba(159,178,207,.55)";
      const left = i % 2 === 0, x = left ? (V.phone ? 16 : Math.max(24, W / 2 - 420)) : (V.phone ? W - 40 : rx - 90);
      ix.textAlign = left ? "left" : "right";
      ix.beginPath(); ix.moveTo(left ? x : x, y); ix.lineTo(left ? x + 18 : x - 18, y); ix.stroke();
      ix.lineWidth = 4; ix.strokeStyle = "rgba(5,10,20,.8)"; ix.strokeText(text, left ? x + 26 : x - 26, y); ix.lineWidth = 1;
      ix.fillText(text, left ? x + 26 : x - 26, y);
    });
    // tier lines for this round's reveal
    if (V.tiers) {
      const x0 = V.phone ? 8 : Math.max(16, W / 2 - 430), x1 = V.phone ? W - 26 : rx - 56;
      ix.font = `${V.phone ? 16 : 18}px VT323, monospace`; ix.textAlign = V.phone ? "left" : "right";
      V.tiers.list.forEach((tl, i) => {
        const y = Math.round(yOf(tl.d)) + 0.5; if (y < 70 || y > H + 10) return;
        let bright = 0;
        if (tl.passedAt !== null) bright = clamp(1 - (V.t - tl.passedAt) / 0.6, 0, 1);
        const a = tl.on ? 0.95 : 0.45 + bright * 0.5;
        ix.strokeStyle = `rgba(234,246,255,${a * 0.6})`; ix.setLineDash([6, 6]); ix.lineWidth = tl.on ? 2 : 1;
        ix.beginPath(); ix.moveTo(x0, y); ix.lineTo(x1, y); ix.stroke(); ix.setLineDash([]); ix.lineWidth = 1;
        const lab = `${EMOJI[i]} ${tl.name.toUpperCase()} · ${tl.points}`, lx = V.phone ? x0 + 4 : x1 - 4;
        ix.globalAlpha = a; ix.lineWidth = 4; ix.strokeStyle = "rgba(5,10,20,.85)"; ix.strokeText(lab, lx, y - 10); ix.lineWidth = 1;
        ix.fillStyle = tl.color; ix.fillText(lab, lx, y - 10); ix.globalAlpha = 1;
      });
    }
    drawFx();
    // the answer, sinking: it takes the color of each tier line it passes and lands in its own
    const T = V.tag;
    if (T && T.alpha > 0) {
      const k = V.sink, p = k ? clamp((performance.now() - k.t0 - 600) / 3000, 0, 1) : 1;
      const speed = k && p > 0 && p < 1 ? 3 * (1 - p) * (1 - p) * Math.min(1, (k.to - k.from) / 300) : 0;
      const col = tierCol(T.cur), pop = Math.max(0, 1 - (V.t - T.pop) / 0.35);
      const sway = T.landed ? Math.sin(V.t * 1.6) * 0.03 : Math.sin(V.t * 5.2) * (0.05 + speed * 0.05);
      const x = W / 2 + (T.landed ? Math.sin(V.t * 0.9) * 6 : Math.sin(V.t * 3.1) * (6 + speed * 10));
      const y = yOf(T.d) + (T.landed ? Math.sin(V.t * 1.6) * 4 : 0);
      ix.font = `${V.phone ? 22 : 28}px VT323, monospace`; ix.textAlign = "center";
      const label = `“${T.text.toUpperCase()}” ▼`, w = ix.measureText(label).width + 36, h = V.phone ? 38 : 46;
      // afterimages while it falls fast
      if (speed > 0.15 && !reduced()) for (let g = 3; g >= 1; g--) {
        ix.save(); ix.translate(x, y - g * (10 + speed * 14)); ix.rotate(-0.21 + sway * 0.6);
        ix.globalAlpha = T.alpha * 0.16 * speed * (4 - g) / 3; ix.fillStyle = col; ix.fillRect(-w / 2, -h / 2, w, h); ix.restore();
      }
      // speed lines from Deep Bench up
      if (T.tier >= 3 && speed > 0.1 && !reduced()) {
        ix.save(); ix.strokeStyle = col; ix.lineWidth = 2;
        for (let i = 0; i < 6 + T.tier * 2; i++) {
          const lx = x + (rnd(i, "sl") - 0.5) * (w + 80), len = 30 + speed * 90 * rnd(i, "sll"), ly = y - h / 2 - 8 - ((V.t * 900 + rnd(i, "slo") * 400) % 260);
          ix.globalAlpha = T.alpha * 0.5 * speed; ix.beginPath(); ix.moveTo(Math.round(lx) + 0.5, ly); ix.lineTo(Math.round(lx) + 0.5, ly - len); ix.stroke();
        }
        ix.restore();
      }
      ix.save(); ix.translate(x, y); ix.rotate(-0.21 + sway);
      const sc = 1 + pop * 0.22 + (T.landed ? 0 : speed * 0.04); ix.scale(sc, sc * (1 + speed * 0.06));
      ix.globalAlpha = T.alpha;
      ix.shadowColor = col; ix.shadowBlur = 6 + T.cur * 5 + pop * 24;
      ix.fillStyle = "rgba(9,18,34,.94)"; ix.fillRect(-w / 2, -h / 2, w, h);
      ix.shadowBlur = 0;
      ix.fillStyle = "rgba(0,0,0,.35)"; ix.fillRect(-w / 2 + 4, h / 2, w - 4, 4);
      ix.strokeStyle = col; ix.lineWidth = 2; ix.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
      if (T.tier >= 5 && T.landed) {
        // Buzzer Beater: a light sweeps across the box
        const sw = ((V.t * 0.8) % 1.6) * w * 1.4 - w * 0.7;
        const gr = ix.createLinearGradient(sw - 40, 0, sw + 40, 0);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,.28)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        ix.fillStyle = gr; ix.fillRect(-w / 2, -h / 2, w, h);
      }
      ix.fillStyle = col; ix.shadowColor = col; ix.shadowBlur = 4 + T.cur * 3;
      ix.fillText(label, 0, 2);
      ix.restore();
    }
    // a full-screen wash in the tier's color on the big landings
    if (V.tint) {
      V.tint.a -= V.dt * 1.6;
      if (V.tint.a <= 0) V.tint = null;
      else { ix.globalAlpha = V.tint.a; ix.fillStyle = V.tint.c; ix.fillRect(0, 0, W, H); ix.globalAlpha = 1; }
    }
  }

  // ---------- effects: pixel sparks, confetti and rings, in world coordinates so they scroll with the scene
  let TCOL = null;
  const tierCol = (i) => (TCOL || (TCOL = [0, 1, 2, 3, 4, 5].map(tierHex)))[clamp(i, 0, 5)];
  function burst(x, y, n, colors, { speed = 180, up = 0.3, grav = 160, life = 1.1, size = 3, conf = false } = {}) {
    if (reduced()) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.65);
      V.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * up, g: grav, life: life * (0.6 + Math.random() * 0.6), max: life,
        c: colors[i % colors.length], s: size + (Math.random() < 0.3 ? 1 : 0), conf, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14 });
    }
  }
  const ring = (x, y, c, { r = 10, vr = 420, life = 0.6, w = 3 } = {}) => { if (!reduced()) V.rings.push({ x, y, c, r, vr, life, max: life, w }); };
  function drawFx() {
    const dt = V.dt;
    V.fx = V.fx.filter((f) => (f.life -= dt) > 0);
    for (const f of V.fx) {
      f.vx *= 1 - dt * (f.conf ? 2.2 : 1.2); f.vy += f.g * dt; if (f.conf) f.vy = Math.min(f.vy, 70);
      f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt;
      const sy = f.y - V.cam; if (sy < -20 || sy > V.H + 20) continue;
      ix.globalAlpha = clamp(f.life / f.max * 1.6, 0, 1); ix.fillStyle = f.c;
      if (f.conf) { const cw = Math.abs(Math.cos(f.rot)) * 5 + 1; ix.fillRect(Math.round(f.x - cw / 2), Math.round(sy - 3), Math.round(cw), 6); }
      else ix.fillRect(Math.round(f.x / 2) * 2, Math.round(sy / 2) * 2, f.s, f.s);
    }
    V.rings = V.rings.filter((r) => (r.life -= dt) > 0);
    for (const r of V.rings) {
      r.r += r.vr * dt; const sy = r.y - V.cam;
      ix.globalAlpha = clamp(r.life / r.max, 0, 1); ix.strokeStyle = r.c; ix.lineWidth = r.w;
      ix.beginPath(); ix.ellipse(r.x, sy, r.r, r.r * 0.42, 0, 0, Math.PI * 2); ix.stroke();
    }
    ix.globalAlpha = 1;
  }
  // what each tier gets when the answer lands: more points, more show
  function land(t) {
    const x = V.W / 2, y = V.tag.d * PXM, c = tierCol(t), all = [0, 1, 2, 3, 4, 5].map(tierCol);
    SFX.land(t);
    burst(x, y, 10 + t * 14, [c, "#EAF6FF"], { speed: 120 + t * 50, life: 0.8 + t * 0.15 });
    if (t >= 1) ring(x, y, c, { vr: 300 + t * 80 });
    if (t >= 2) { ring(x, y, "#EAF6FF", { vr: 220, life: 0.5, w: 2 }); V.kick = 3 + t; }
    if (t >= 3) { V.tint = { c, a: 0.12 + (t - 3) * 0.06 }; burst(x, y, 24, [c], { speed: 420, up: 0, grav: 0, life: 0.5, size: 2 }); }
    if (t >= 4) { ring(x, y, c, { vr: 700, life: 0.9, w: 4 }); document.body.classList.remove("shake"); void document.body.offsetWidth; document.body.classList.add("shake"); later(520, () => document.body.classList.remove("shake")); }
    if (t >= 5) {
      // Buzzer Beater: confetti rains from the top of the screen and fireworks pop around the answer
      for (let i = 0; i < 70; i++) V.fx.push({ x: Math.random() * V.W, y: V.cam - 10 - Math.random() * 160, vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 60, g: 30,
        life: 3 + Math.random() * 1.5, max: 4, c: all[i % 6], s: 3, conf: true, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10 });
      [[-0.32, -60, 250], [0.3, -90, 450], [-0.12, -150, 700], [0.18, -30, 950]].forEach(([dx, dy, ms]) => later(ms, () => {
        const fx = x + dx * Math.min(V.W, 900), fy = y + dy; burst(fx, fy, 36, [all[(ms / 250) % 6 | 0], "#FFFFFF", c], { speed: 260, up: 0.1, grav: 120, life: 1.2 }); ring(fx, fy, c, { vr: 260, life: 0.5, w: 2 }); SFX.pop();
      }));
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, V.last ? (now - V.last) / 1000 : 0.016); V.last = now; V.t += dt; V.dt = dt;
    if (V.sink) stepSink(now); else { camAim(false); V.cam += (V.camTarget - V.cam) * (1 - Math.exp(-dt * 3.2)); }
    // where the diver swims
    let tx, ty;
    if (V.tag) { tx = V.phone ? V.W * 0.86 : V.W / 2 - 170; ty = yOf(V.tag.d) - 34; }
    else if (V.mode === "start" || V.mode === "done") { tx = V.W * (V.phone ? 0.62 : 0.58); ty = surfaceScreen() + 120; }
    else if (V.mode === "reveal") { tx = V.phone ? V.W * 0.86 : V.W / 2 - 170; ty = V.H * REVEAL_Y - 34; }
    else { tx = V.W * (V.phone ? 0.12 : Math.max(0.1, 0.5 - 330 / V.W)); ty = V.level + V.H * 0.36; }
    tx += Math.sin(V.t * 0.7) * 18; ty += Math.sin(V.t * 1.3) * 6;
    V.diver.x += (tx - V.diver.x) * (1 - Math.exp(-dt * 2.5)); V.diver.y += (ty - V.diver.y) * (1 - Math.exp(-dt * 2.5));
    if (Math.random() < dt * 1.6) V.bubbles.push({ x: V.diver.x + 8, y: V.diver.y + V.cam - 6, r: 1 + Math.random() * 1.5, vy: 26 + Math.random() * 20, life: 6, p: Math.random() * 6 });
    drawSea(dt); drawInk();
    requestAnimationFrame(frame);
  }

  // ======================================================================== day
  let DAY = null, P = [], S = null, pending = null, tick = null, timers = [];
  const LIMIT = () => (DAY.secondsPerPrompt || 25) * 1000;
  const saveKey = () => "dive_v1_" + DAY.date;
  const later = (ms, f) => timers.push(setTimeout(f, reduced() ? Math.min(ms, 50) : ms));
  const clearLater = () => { timers.forEach(clearTimeout); timers = []; };
  // A new dive every midnight Eastern, wherever the player is.
  const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const source = window.DIVE_DATA
    ? { index: async () => window.DIVE_DATA.index, day: async (d) => window.DIVE_DATA.days[d] }
    : { index: async () => (await fetch("/dive/days/index.json", { cache: "no-cache" })).json(), day: async (d) => (await fetch(`/dive/days/${d}.json`, { cache: "no-cache" })).json() };

  async function load() {
    const asked = window.DIVE_PICK || new URLSearchParams(location.search).get("d");
    const index = await source.index();
    const days = index.days.slice().sort();
    const today = todayET();
    let date = asked && days.includes(asked) ? asked : days.filter((d) => d <= today).pop();
    let preview = !!(asked && days.includes(asked) && asked !== today);
    let warn = "";
    if (!date) { date = days[0]; preview = true; warn = `Dive #1 opens ${dayName(date)}. This is a preview, so nothing is saved.`; }
    else if (preview) warn = `Preview of ${dayName(date)}. Nothing is saved.`;
    const day = await source.day(date);
    DAY = { ...day, date, days, n: days.indexOf(date) + 1, preview, warn };
    P = day.prompts.slice().sort((a, b) => a.slot - b.slot).slice(0, SLOTS).map(DiveMatch.prepare);
  }

  // A round's result: {i: answer index, status: "ok"} or {status: "time"}.
  const result = (k) => S.answers[k];
  const hit = (k) => { const r = result(k); return r && r.status === "ok" ? P[k].answers[r.i] : null; };
  const pts = (k) => { const a = hit(k); return a ? a.points : 0; };
  const total = () => S.answers.reduce((s, _, k) => s + pts(k), 0);
  const meters = () => total() * M_PER_PT;

  // The round in progress is saved with absolute deadlines, so a reload resumes it with the clock still running.
  function persist() {
    if (DAY.preview) return;
    const round = S.phase === "descend" || S.phase === "live" ? { cur: S.cur, phase: S.phase, descendEndsAt: S.descendEndsAt, answerEndsAt: S.answerEndsAt } : null;
    store.set(saveKey(), { answers: S.answers, rating: S.rating, round });
  }

  // ======================================================================== HUD
  function renderHud(scoreShown) {
    $("mTop").textContent = fmt(V.shownM) + " ft";
    $("ptsTop").textContent = scoreShown === undefined ? total() : scoreShown;
    $("progTxt").textContent = `PROMPT ${Math.min(S.cur + 1, P.length)} OF ${P.length}`;
    $("pips").innerHTML = P.map((_, k) => {
      const r = result(k), a = hit(k), live = k === S.cur && (S.phase === "descend" || S.phase === "live");
      const st = live ? ' class="pip cur"' : r ? ` class="pip" style="background:${a ? tierHex(a.tier) : "#2A3A55"};box-shadow:none"` : ' class="pip"';
      return `<span${st}></span>`;
    }).join("");
  }
  function countM(from, to, ms) {
    const t0 = performance.now();
    const step = (now) => {
      const p = reduced() ? 1 : clamp((now - t0) / ms, 0, 1);
      V.shownM = from + (to - from) * easeOut(p); $("mTop").textContent = fmt(V.shownM) + " ft";
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ======================================================================== views
  const VIEWS = ["loadView", "startView", "card", "descBox", "form", "revealView", "descendNext", "doneView", "confirm", "reject"];
  function only(...ids) { VIEWS.forEach((v) => ($(v).hidden = !ids.includes(v))); }
  function animate(el, cls) { el.classList.remove("in", "out", "pre"); void el.offsetWidth; if (cls) el.classList.add(cls); }

  function renderStart() {
    V.mode = "start"; S.phase = "start"; V.tiers = null; V.tag = null;
    only("startView"); $("hud").classList.add("off"); $("dim").classList.remove("on"); $("floor").hidden = true;
    const resume = S.answers.length > 0;
    $("begin").innerHTML = resume ? `<i>▼</i> CONTINUE · PROMPT ${S.answers.length + 1} <i>▼</i>` : "<i>▼</i> TIP OFF <i>▼</i>";
    $("startSub").textContent = `DIVE #${DAY.n} · ${dayName(DAY.date).toUpperCase()}`;
    $("startWarn").hidden = !DAY.warn; $("startWarn").textContent = DAY.warn;
    if (window.DIVE_DATA) {
      $("picker").hidden = false;
      $("picker").innerHTML = DAY.days.map((d) => `<button type="button" data-d="${d}" aria-pressed="${d === DAY.date}">${dayName(d).split(",")[0].toUpperCase()}</button>`).join("");
    }
  }

  function showPrompt() {
    const pr = P[S.cur];
    $("qnum").textContent = `PROMPT ${S.cur + 1} OF ${P.length}`;
    $("q").textContent = pr.text;
    $("qrule").textContent = pr.rule || "rarer answers shoot from further out";
  }

  // ---------- rounds
  function startRound() {
    clearLater(); clearInterval(tick);
    S.phase = "descend"; S.descendEndsAt = Date.now() + DESCEND * 1000; S.answerEndsAt = S.descendEndsAt + LIMIT();
    persist(); descend(true);
  }
  // The card swims in half a second into the descent; the clock starts when the descent ends.
  function descend(fresh) {
    S.phase = "descend"; V.mode = "play"; V.tiers = null; V.tag = null; V.shownM = S.depthM;
    only("card", "descBox"); $("hud").classList.remove("off"); $("floor").hidden = false; $("dim").classList.remove("on");
    showPrompt(); renderHud();
    const card = $("card");
    if (fresh) { card.classList.add("pre"); later(500, () => animate(card, "in")); } else animate(card, null);
    let lastN = 0;
    const step = () => {
      const left = S.descendEndsAt - Date.now();
      if (left > 0) { const n = Math.ceil(left / 1000); $("descN").textContent = n; if (n !== lastN) { lastN = n; if (fresh) SFX.countdown(n); } return; }
      clearInterval(tick); goLive();
    };
    step(); clearInterval(tick); tick = setInterval(step, 100);
  }
  function goLive() {
    S.phase = "live"; V.mode = "play"; pending = null; persist();
    only("card", "form"); $("card").classList.remove("pre"); showPrompt(); renderHud();
    $("guess").value = ""; syncGo();
    $("guess").focus(); SFX.go();
    clearInterval(tick); let lastS = 99; const step = () => { lastS = air(lastS); }; step(); tick = setInterval(step, 100);
  }

  // ---------- air
  function air(lastS) {
    const ms = S.answerEndsAt - Date.now(), s = Math.ceil(Math.max(0, ms) / 1000);
    $("tsec").textContent = s;
    $("fuse").style.transform = `scaleX(${clamp(ms / LIMIT(), 0, 1)})`;
    $("timer").classList.toggle("low", ms < 6000);
    document.body.classList.toggle("edge", ms > 0 && ms <= 5000);
    if (s !== lastS && s <= 5 && s > 0) SFX.tick();
    if (ms <= 0) {
      // Time's up: whatever is in the box counts if it's an exact match. Near misses don't get a confirm.
      const r = DiveMatch.lookup($("guess").value, P[S.cur]);
      settle(r.i !== undefined ? { i: r.i, status: "ok" } : { status: "time" });
    }
    return s;
  }

  function settle(r) {
    clearInterval(tick); clearLater(); document.body.classList.remove("edge");
    const before = meters();
    S.answers[S.cur] = r; S.phase = "reveal"; S.depthM = meters(); persist();
    $("guess").blur();
    reveal(before);
  }

  function setReject(msg) {
    const el = $("reject"); el.hidden = !msg; el.textContent = msg || "";
    if (msg) { el.classList.remove("jolt"); void el.offsetWidth; el.classList.add("jolt"); }
  }
  function setConfirm(html) { $("confirm").hidden = !html; $("confirm").innerHTML = html || ""; }
  const syncGo = () => { $("go").disabled = !$("guess").value.trim(); };

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (S.phase !== "live") return;
    const val = $("guess").value;
    if (!val.trim()) return;
    if (pending && pending.text === val) { setConfirm(""); return settle({ i: pending.i, status: "ok" }); }
    const r = DiveMatch.lookup(val, P[S.cur]);
    if (r.i !== undefined) { setConfirm(""); setReject(""); return settle({ i: r.i, status: "ok" }); }
    if (r.guess !== undefined) {
      // Near miss: the box takes the suggestion, and submitting again confirms it.
      const name = P[S.cur].answers[r.guess].name;
      pending = { text: name, i: r.guess };
      $("guess").value = name; syncGo(); setReject("");
      setConfirm(`“${esc(val.trim())}” → <b>“${esc(name)}”</b><small>submit again to confirm · or edit</small>`);
      SFX.near();
      return;
    }
    pending = null; setConfirm(""); setReject("");
    if (r.free) { setReject(r.err); return; }
    // the typed text stays in the box; the message lands a beat later with a jolt
    // Traps carry their own explanation; everything else gets the plain "not on the board".
    const msg = /doesn't fit/.test(r.err) ? `“${val.trim()}” isn't on the board. try again` : r.err + " Try again.";
    later(300, () => { if (S.phase === "live") { setReject(msg); SFX.wrong(); } });
  });
  $("guess").addEventListener("input", () => {
    syncGo(); SFX.key();
    if (pending && $("guess").value !== pending.text) { pending = null; setConfirm(""); }
    if (!$("reject").hidden) setReject("");
  });

  // ---------- reveal
  // Timeline (from the answer): the card leaves in 0.6 s; the answer sinks from 0.6 to 3.6 s, passing this round's
  // tier lines while the depth counts up; at 3.75 s the tier banner pops, the points count up and Descend rises.
  const easiest = (pr) => pr.answers.reduce((b, a) => (a.points < b.points || (a.points === b.points && a.players > b.players) ? a : b));
  const deepest = (pr) => pr.answers.reduce((b, a) => (a.points > b.points ? a : b));

  function reveal(beforeM) {
    const pr = P[S.cur], a = hit(S.cur), last = S.cur === P.length - 1;
    V.mode = "reveal";
    animate($("card"), "out"); $("form").hidden = true; setConfirm(""); setReject("");
    const rv = $("revealView"); rv.classList.remove("land");
    $("descendNext").textContent = last ? "FINAL HORN ▶" : "NEXT SHOT ▼";
    $("descendNext").classList.remove("up");
    V.tiers = { d0: beforeM, list: pr.tiers.map((t, i) => ({ d: beforeM + t.points * M_PER_PT, name: t.name, points: t.points, color: tierHex(i), passedAt: null, on: a && a.tier === i })) };
    if (a) {
      SFX.hit(); $("flash").classList.remove("go"); void $("flash").offsetWidth; $("flash").classList.add("go");
      const gain = a.points * M_PER_PT, t0 = performance.now();
      V.tag = { text: a.name, d: beforeM, alpha: 1, tier: a.tier, cur: 0, pop: -9, landed: false };
      V.sink = { t0, from: beforeM, to: beforeM + gain };
      countM(beforeM, beforeM + gain, 0); V.shownM = beforeM;
      later(600, () => countM(beforeM, beforeM + gain, 3000));
      const notes = NOTES[Math.min(a.tier, NOTES.length - 1)], note = notes[Math.floor(hash(a.name) * notes.length)];
      $("rvBanner").textContent = pr.tiers[a.tier].name.toUpperCase(); $("rvBanner").style.setProperty("--c", tierHex(a.tier));
      $("rvQuote").textContent = `“${a.name}”`; $("rvQuote").style.color = tierHex(a.tier);
      $("rvPts").innerHTML = `+${a.points} PTS · <b>+${fmt(gain)} ft</b>`;
      $("rvNote").textContent = a.note || note;
      later(3750, () => {
        only("revealView", "descendNext"); rv.classList.add("land"); $("descendNext").classList.add("up");
        SFX.banner(a.tier);
        const s0 = total() - a.points, t1 = performance.now();
        const up = (now) => { const p = clamp((now - t1) / 350, 0, 1); renderHud(Math.round(s0 + a.points * p)); if (p < 1) requestAnimationFrame(up); };
        requestAnimationFrame(up);
        $("descendNext").focus({ preventScroll: true });
      });
    } else {
      V.tag = null; V.sink = null; V.shownM = beforeM;
      document.body.classList.add("shake"); later(520, () => document.body.classList.remove("shake"));
      SFX.miss();
      const deep = deepest(pr);
      $("rvBanner").textContent = "SHOT CLOCK"; $("rvBanner").style.setProperty("--c", "#9FB2CF");
      $("rvQuote").textContent = `the easy one: “${easiest(pr).name}”`; $("rvQuote").style.color = "";
      $("rvPts").innerHTML = "+0 PTS · <b>+0 ft</b>";
      $("rvNote").textContent = `The Buzzer Beater was ${deep.name}.${deep.note ? " " + deep.note : ""}`;
      later(900, () => { only("revealView", "descendNext"); rv.classList.add("land"); $("descendNext").classList.add("up"); renderHud(); $("descendNext").focus({ preventScroll: true }); });
    }
    later(600, () => { if ($("card").classList.contains("out")) $("card").hidden = true; });
    renderHud(total() - (a ? a.points : 0));
  }

  function stepSink(now) {
    const k = V.sink, p = (now - k.t0 - 600) / 3000;
    const d = k.from + (k.to - k.from) * easeOut(reduced() ? 1 : p), T = V.tag;
    if (T) {
      T.d = d;
      if (T.fade) T.alpha = Math.max(0, T.alpha - 0.06);
      if (!T.landed && p >= 1) { T.landed = true; T.cur = T.tier; T.pop = V.t; land(T.tier); }
    }
    V.kick *= Math.exp(-V.dt * 9);
    V.cam = d * PXM - V.H * REVEAL_Y + (V.kick > 0.3 ? (Math.random() - 0.5) * V.kick * 2 : 0);
    if (V.tiers) V.tiers.list.forEach((tl, i) => {
      if (tl.passedAt !== null || d < tl.d - 0.5) return;
      tl.passedAt = V.t;
      // crossing a tier line: the answer takes its color, with a pop, a spark and a rising note
      if (T && i < T.tier) {
        T.cur = i; T.pop = V.t; SFX.cross(i);
        burst(V.W / 2, tl.d * PXM, 8 + i * 5, [tl.color], { speed: 140 + i * 30, up: 0.6, life: 0.7 });
        ring(V.W / 2, tl.d * PXM, tl.color, { vr: 260 + i * 40, life: 0.45, w: 2 });
      }
    });
    // a trail of the current tier's color while it falls
    if (T && p > 0 && p < 1 && !reduced() && Math.random() < 0.35 + T.cur * 0.12) {
      const c = tierCol(T.cur);
      V.fx.push({ x: V.W / 2 + (Math.random() - 0.5) * 160, y: d * PXM - 18, vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 60, g: 0, life: 0.9, max: 0.9, c, s: 2 + (T.cur >= 3 ? 1 : 0), conf: false, rot: 0, vr: 0 });
    }
    if (Math.random() < 0.3 && p > 0 && p < 1) V.bubbles.push({ x: V.W / 2 + (Math.random() - 0.5) * 120, y: d * PXM + 10, r: 1 + Math.random() * 2, vy: 50 + Math.random() * 60, life: 3, p: Math.random() * 6 });
    SFX.depth(d);
  }

  function next() {
    SFX.click(); clearLater(); V.sink = null; V.tag = null; V.fx = []; V.rings = []; V.tint = null;
    S.depthM = meters();
    if (S.answers.length >= P.length) { beacon("fin", "/dive"); SFX.surface(); return renderDone(); }
    S.cur = S.answers.length;
    startRound();
  }
  $("descendNext").addEventListener("click", next);

  // ======================================================================== results
  function drawLog() {
    const W = 448, H = 220, x = (i) => 40 + i * ((W - 60) / P.length);
    const top = Math.max(100, meters()), y = (m) => 14 + (m / top) * (H - 44);
    let m = 0, d = `M${x(0)},${y(0)}`, dots = "";
    S.answers.forEach((_, k) => {
      const a = hit(k); m += pts(k) * M_PER_PT;
      d += `L${x(k + 1).toFixed(1)},${y(m).toFixed(1)}`;
      dots += `<rect x="${(x(k + 1) - 5).toFixed(1)}" y="${(y(m) - 5).toFixed(1)}" width="10" height="10" fill="${a ? tierHex(a.tier) : "#2A3A55"}"/>`;
    });
    const step = top > 300 ? 100 : top > 150 ? 50 : 25;
    let grid = "";
    for (let v = 0; v <= top; v += step) grid += `<line x1="40" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#1E3150" stroke-dasharray="4 4"/><text x="34" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    const xl = P.map((_, k) => `<text x="${x(k + 1)}" y="${H - 6}" text-anchor="middle">${k + 1}</text>`).join("");
    $("log").innerHTML = grid + xl + `<path d="${d}" fill="none" stroke="#4DE3FF" stroke-width="2"/>` + dots;
  }

  function renderDone() {
    clearInterval(tick); clearLater(); document.body.classList.remove("edge");
    S.phase = "done"; V.mode = "done"; V.tiers = null; V.tag = null; V.sink = null; S.cur = P.length;
    S.depthM = meters(); V.shownM = S.depthM;
    only("doneView"); $("hud").classList.add("off"); $("floor").hidden = true; $("dim").classList.add("on");
    const p = total(), m = meters();
    $("rLabel").textContent = `DIVE #${DAY.n} COMPLETE`;
    $("rPts").textContent = p;
    $("rM").textContent = `${fmt(m)} ft`;
    $("rBand").textContent = bandOf(p).toUpperCase();
    drawLog();
    const maxP = P.reduce((s, pr) => s + Math.max(...pr.tiers.map((t) => t.points)), 0);
    $("bands").innerHTML = BANDS.map((b, i) => {
      const hi = BANDS[i + 1] ? BANDS[i + 1][0] - 1 : maxP;
      return `<div class="${bandOf(p) === b[1] ? "on" : ""}">${b[1].toUpperCase()}<span>${b[0]}–${hi} pts</span></div>`;
    }).reverse().join("");
    $("haul").innerHTML = P.map((pr, k) => {
      const a = hit(k);
      const who = a ? esc(a.name) : "Out of air";
      const sub = a ? (a.note ? esc(a.note) : esc(pr.tiers[a.tier].name)) : `the easy one: ${esc(easiest(pr).name)}`;
      const list = pr.answers.slice().sort((x, y) => y.points - x.points || x.name.localeCompare(y.name))
        .map((x) => `<div class="${x === a ? "me" : ""}"><span>${EMOJI[x.tier]} ${esc(x.name)}</span><span>${x.points}${x.players ? ` · ${fmt(x.players)} picked` : ""}</span></div>`).join("");
      return `<details><summary><span>${a ? EMOJI[a.tier] : "⬛"}</span><span class="who">${who}<small>${k + 1}. ${esc(pr.text)} · ${sub}</small></span><span class="p">+${pts(k)}<small>${fmt(pts(k) * M_PER_PT)} ft</small></span></summary><div class="allans">${list}</div></details>`;
    }).join("");
    $("rate").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" aria-pressed="${S.rating === n}" aria-label="Rate ${n} of 5">${n}</button>`).join("");
    $("shareTxt").textContent = shareText();
    $("doneView").scrollTop = 0;
  }

  const shareText = () => `Daily Dive #${DAY.n} 🏀\n${total()} pts · ${fmt(meters())} ft\n\n${P.map((_, k) => { const a = hit(k); return a ? EMOJI[a.tier] : "⬛"; }).join("")}\nthegravityreport.com/dive`;

  $("rate").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    SFX.click(); S.rating = +b.textContent; persist();
    beacon("use", `dive/rate/${S.rating}`);
    $("rate").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(+x.textContent === S.rating)));
  });
  function copyText(btn, txt, done) {
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("shareTxt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = "SELECTED"; };
    try { navigator.clipboard.writeText(txt).then(() => { btn.textContent = done; }, fallback); } catch (e) { fallback(); }
  }
  $("copy").addEventListener("click", () => { SFX.click(); copyText($("copy"), shareText(), "COPIED ✓"); });
  $("shareBtn").addEventListener("click", () => {
    SFX.click();
    if (navigator.share) navigator.share({ text: shareText() }).catch(() => {});
    else copyText($("shareBtn"), shareText(), "COPIED ✓");
  });
  $("begin").addEventListener("click", () => {
    SFX.init(); SFX.start();
    if (!S.answers.length) beacon("use", "dive/start");
    S.cur = S.answers.length; S.depthM = meters(); startRound();
  });
  $("howBtn").addEventListener("click", () => {
    const open = $("howBody").hidden; $("howBody").hidden = !open; $("howBtn").setAttribute("aria-expanded", String(open));
    $("howBtn").textContent = (open ? "▼" : "▶") + " HOW TO PLAY"; SFX.click();
  });
  $("picker").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; SFX.click(); window.DIVE_PICK = b.dataset.d; boot(); });

  // ---------- menu + sound
  const openMenu = (o) => { $("menu").hidden = !o; $("scrim").hidden = !o; $("menuBtn").setAttribute("aria-expanded", String(o)); if (o) $("menuX").focus(); else $("menuBtn").focus(); };
  $("menuBtn").addEventListener("click", () => { SFX.click(); openMenu(true); });
  $("menuX").addEventListener("click", () => openMenu(false));
  $("scrim").addEventListener("click", () => openMenu(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("menu").hidden) openMenu(false); });
  const syncMute = () => { $("muteBtn").setAttribute("aria-pressed", String(SFX.muted)); $("muteBtn").setAttribute("aria-label", SFX.muted ? "Turn sound on" : "Mute sound"); };
  $("muteBtn").addEventListener("click", () => { SFX.init(); SFX.setMuted(!SFX.muted); syncMute(); });
  syncMute();
  if (window.DIVE_DATA) document.querySelectorAll('a[href^="/"]').forEach((a) => { a.href = "https://thegravityreport.com" + a.getAttribute("href"); });

  // ======================================================================== boot
  function boot() {
    clearInterval(tick); clearLater(); document.body.classList.remove("edge");
    return load().then(() => {
      const saved = DAY.preview ? null : store.get(saveKey());
      S = { answers: ((saved && saved.answers) || []).slice(0, P.length), cur: 0, phase: "start", rating: (saved && saved.rating) || 0 };
      S.cur = Math.min(S.answers.length, P.length - 1); S.depthM = meters(); V.shownM = S.depthM;
      const round = saved && saved.round;
      $("menuTiers").innerHTML = P[0].tiers.map((t, i) => `<div><span style="color:${tierHex(i)}">${EMOJI[i]} ${esc(t.name.toUpperCase())}</span><span>${t.points}</span></div>`).join("");
      beacon("pv", "/dive");
      if (S.answers.length >= P.length) { renderDone(); camAim(true); return; }
      if (round && round.cur === S.answers.length) {
        // A reload mid-round picks the round back up; its clock never stopped. The typed draft is gone.
        Object.assign(S, { cur: round.cur, descendEndsAt: round.descendEndsAt, answerEndsAt: round.answerEndsAt });
        if (Date.now() < round.descendEndsAt) { descend(false); camAim(true); return; }
        if (Date.now() < round.answerEndsAt) { goLive(); camAim(true); return; }
        settle({ status: "time" }); camAim(true); return;
      }
      renderStart(); camAim(true);
    }).catch(() => { only("loadView"); $("loadView").textContent = "today's dive didn't load. refresh to try again."; });
  }

  resize();
  V.diver.x = V.W * 0.58; V.diver.y = V.H * 0.7;
  requestAnimationFrame(frame);
  boot();
})();
