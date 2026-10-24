// Daily Dive: loads the day's file from /dive/days/ (written by the question engine) and runs the game in a
// pixel-art scene. Points come only from the day's answer key, fixed when the day is pushed. Player counts,
// when a day file has them, are display-only.
(function () {
  "use strict";

  const M_PER_PT = 10, SLOTS = 7, DESCEND = 3;
  const PXM = 2;   // scene: CSS px per meter of depth
  const REVEAL_Y = 0.64; // where the landing depth sits on screen during a reveal, below the banner text
  const LOW = 2;   // scene: CSS px per art pixel
  const EMOJI = ["🫧", "🐡", "🐟", "🦑", "🐋", "🏀"];
  const NOTES = [
    ["Everyone's first thought. Still counts.", "The answer half the country typed."],
    ["You thought this was the sneaky one. So did everyone else."],
    ["A real fan's answer.", "Good pull. Most fans would know it."],
    ["Now the light is fading.", "That takes real basketball memory."],
    ["Deep cut. The scouts would be proud.", "A name most fans have forgotten."],
    ["Nothing but net, from the bottom of the ocean."],
  ];
  const BANDS = [[0, "Shallows"], [150, "Reef"], [250, "Twilight"], [350, "Midnight"], [450, "Trench"]];
  const bandOf = (p) => BANDS.filter((b) => p >= b[0]).pop()[1];
  // Depth markers along the way down, in meters.
  const MARKS = [
    [29, "a full court, end to end · 28.65 m"], [95, "the light begins to thin"], [224, "100 Wembys, head to toe"],
    [430, "15 courts laid end to end"], [1000, "the midnight zone. no sunlight past here"], [2000, "sperm whales hunt down here"],
    [3050, "1,000 rims stacked up"], [4000, "the abyss"], [6000, "the hadal zone"], [7000, "a perfect dive"],
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
      // a low sea hum that darkens with depth
      const n = this.ctx.sampleRate * 4, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = buf; s.loop = true; f.type = "lowpass"; f.frequency.value = 420; g.gain.value = 0.05;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      this.amb = f;
    },
    depth(m) { if (this.amb) this.amb.frequency.setTargetAtTime(420 - 300 * Math.min(1, m / 3000), this.ctx.currentTime, 0.5); },
    click() { this.tone(660, 0.05, { vol: 0.06 }); },
    key() { this.tone(1500 + Math.random() * 400, 0.018, { vol: 0.025 }); },
    start() { this.noise(1.1, { vol: 0.16, from: 300, to: 1800, type: "bandpass", q: 0.8 }); this.tone(196, 0.9, { type: "sine", vol: 0.12, to: 98 }); },
    countdown(n) { this.tone(n > 1 ? 520 : 780, 0.08, { type: "triangle", vol: 0.12 }); },
    go() { this.tone(880, 0.07, { vol: 0.08 }); this.tone(1320, 0.1, { vol: 0.08, at: 0.07 }); },
    tick() { this.tone(1046, 0.05, { vol: 0.07 }); },
    wrong() { this.tone(170, 0.2, { type: "sawtooth", vol: 0.1, to: 110 }); this.tone(120, 0.22, { vol: 0.05 }); },
    near() { this.tone(660, 0.07, { type: "triangle", vol: 0.1 }); this.tone(880, 0.1, { type: "triangle", vol: 0.1, at: 0.08 }); },
    hit() {
      this.tone(1046, 0.9, { type: "sine", vol: 0.16, attack: 0.002 }); this.tone(1046, 0.6, { type: "sine", vol: 0.05, at: 0.28 });
      this.noise(3.2, { vol: 0.12, from: 1400, to: 160, at: 0.5 });
      for (let i = 0; i < 14; i++) this.tone(300 + Math.random() * 700, 0.06, { type: "sine", vol: 0.05, at: 0.6 + Math.random() * 2.8, to: 900 + Math.random() * 600 });
    },
    banner(tier) {
      const base = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
      for (let i = 0; i <= tier + 1 && i < base.length; i++) this.tone(base[i] * (tier >= 4 ? 1.12 : 1), 0.35, { type: "triangle", vol: 0.1, at: i * 0.07 });
      if (tier === 5) { this.tone(233, 0.55, { type: "sawtooth", vol: 0.09, at: 0.45 }); this.tone(236, 0.55, { type: "square", vol: 0.05, at: 0.45 }); this.noise(1.2, { vol: 0.08, from: 2000, to: 700, at: 0.5, type: "bandpass" }); }
    },
    miss() { this.tone(440, 0.7, { type: "sine", vol: 0.12, to: 110 }); for (let i = 0; i < 4; i++) this.tone(180 + i * 40, 0.08, { type: "sine", vol: 0.06, at: 0.1 + i * 0.12, to: 400 }); },
    surface() { [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.3, { type: "triangle", vol: 0.1, at: i * 0.09 })); },
  };
  document.addEventListener("pointerdown", () => SFX.init(), { capture: true });
  document.addEventListener("keydown", () => SFX.init(), { capture: true });

  // ======================================================================== scene
  const sea = $("sea"), ink = $("ink"), sx = sea.getContext("2d"), ix = ink.getContext("2d");
  const V = { W: 0, H: 0, dpr: 1, phone: false, cam: 0, camTarget: 0, level: 0, t: 0, last: 0,
    shownM: 0, diver: { x: 0, y: 0 }, tag: null, tiers: null, bubbles: [], clouds: [], mode: "start" };

  function resize() {
    V.W = innerWidth; V.H = innerHeight; V.dpr = Math.min(2, devicePixelRatio || 1); V.phone = V.W < 700;
    sea.width = Math.ceil(V.W / LOW); sea.height = Math.ceil(V.H / LOW);
    ink.width = Math.round(V.W * V.dpr); ink.height = Math.round(V.H * V.dpr);
    V.level = Math.round(V.H * (V.phone ? 0.21 : 0.27));
    document.documentElement.style.setProperty("--level", V.level + "px");
    if (!V.clouds.length) V.clouds = Array.from({ length: 9 }, (_, i) => ({ x: rnd(i, "cx") * 1.4 - 0.2, y: 0.15 + rnd(i, "cy") * 0.55, w: 40 + rnd(i, "cw") * 70, v: 0.004 + rnd(i, "cv") * 0.006 }));
    camAim(true);
  }
  addEventListener("resize", resize);

  const surfaceScreen = () => -V.cam;                       // screen y of the waterline
  const yOf = (m) => m * PXM - V.cam;                       // screen y of a depth
  const rulerX = () => (V.phone ? V.W - 14 : Math.min(V.W - 40, V.W / 2 + 446));

  function camAim(snap) {
    if (V.mode === "start" || V.mode === "done") V.camTarget = -V.H * 0.56;
    else if (V.mode === "reveal" && V.tag) V.camTarget = V.tag.d * PXM - V.H * REVEAL_Y;
    else if (V.mode === "reveal") V.camTarget = S.depthM * PXM - V.H * REVEAL_Y;
    else V.camTarget = (S ? S.depthM : 0) * PXM - V.level;
    if (snap) V.cam = V.camTarget;
  }

  const WATER = [[0, [46, 108, 156]], [40, [30, 84, 128]], [160, [21, 64, 104]], [600, [13, 44, 78]], [1500, [9, 31, 58]], [3500, [6, 20, 40]], [7200, [3, 8, 18]]];
  function waterAt(m) {
    if (m <= 0) return WATER[0][1];
    for (let i = 1; i < WATER.length; i++) if (m <= WATER[i][0]) {
      const [m0, a] = WATER[i - 1], [m1, b] = WATER[i], t = (m - m0) / (m1 - m0);
      return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t));
    }
    return WATER[WATER.length - 1][1];
  }
  const rgb = (c, f = 1) => `rgb(${Math.round(c[0] * f)},${Math.round(c[1] * f)},${Math.round(c[2] * f)})`;

  function drawSea(dt) {
    const lw = sea.width, lh = sea.height, t = V.t, sY = surfaceScreen() / LOW;
    // sky and water, row by row
    for (let y = 0; y < lh; y++) {
      const wy = V.cam + y * LOW;
      if (wy < 0) {
        const f = clamp(1 + wy / (V.H * 0.62), 0, 1);
        sx.fillStyle = `rgb(${Math.round(132 + 104 * f)},${Math.round(196 + 50 * f)},${Math.round(232 + 18 * f)})`;
      } else sx.fillStyle = rgb(waterAt(wy / PXM));
      sx.fillRect(0, y, lw, 1);
    }
    if (sY > -40) {
      // sun and clouds
      const sunX = Math.round(lw * 0.82), sunY = Math.round(sY - V.H * 0.47 / LOW), r = 22;
      sx.fillStyle = "rgba(255,226,140,.18)"; for (const k of [40, 32]) { sx.beginPath(); sx.arc(sunX, sunY, k, 0, 7); sx.fill(); }
      sx.fillStyle = "#FFD978";
      for (let dy = -r; dy <= r; dy += 2) { const w = Math.floor(Math.sqrt(r * r - dy * dy) / 2) * 2; sx.fillRect(sunX - w, sunY + dy, w * 2, 2); }
      for (const c of V.clouds) {
        c.x += c.v * dt; if (c.x > 1.25) c.x = -0.3;
        const cx = Math.round(c.x * lw), cy = Math.round(sY - c.y * V.H * 0.6 / LOW), w = Math.round(c.w);
        sx.fillStyle = "#DCE9F3"; sx.fillRect(cx + 4, cy + 4, w, 6);
        sx.fillStyle = "#FFFFFF"; sx.fillRect(cx, cy, w, 6); sx.fillRect(cx + w * 0.15, cy - 4, w * 0.5, 4); sx.fillRect(cx + w * 0.3, cy - 8, w * 0.28, 4);
      }
      // waterline: waves, foam, and the hoop buoy
      for (let x = 0; x < lw; x++) {
        const off = Math.round(Math.sin(x * 0.045 + t * 1.3) * 1.6 + Math.sin(x * 0.011 - t * 0.7) * 2.2);
        sx.fillStyle = rgb(WATER[0][1]); sx.fillRect(x, Math.round(sY) + off, 1, 4 - off);
        sx.fillStyle = "rgba(234,246,255,.55)"; sx.fillRect(x, Math.round(sY) + off, 1, 1);
      }
      drawBuoy(Math.round(lw * (V.phone ? 0.3 : 0.29)), Math.round(sY + Math.sin(t * 1.6) * 1.2));
    }
    // light rays from the surface
    const rayTop = Math.max(0, sY), fadeEnd = sY + 600 * PXM / LOW;
    if (fadeEnd > 0) {
      const g = sx.createLinearGradient(0, rayTop, 0, fadeEnd);
      g.addColorStop(0, "rgba(220,240,255,.07)"); g.addColorStop(1, "rgba(220,240,255,0)");
      sx.fillStyle = g;
      for (let i = 0; i < 6; i++) {
        const x0 = lw * (0.12 + i * 0.16) + Math.sin(t * 0.3 + i) * 10, w = 14 + (i % 3) * 8;
        sx.beginPath(); sx.moveTo(x0, rayTop); sx.lineTo(x0 + w, rayTop); sx.lineTo(x0 + w - 90, fadeEnd); sx.lineTo(x0 - 110, fadeEnd); sx.fill();
      }
    }
    // fish: a field of schools, every 70 m
    const m0 = Math.max(0, V.cam / PXM), m1 = (V.cam + V.H) / PXM;
    for (let k = Math.floor(m0 / 70); k * 70 < m1 + 70; k++) {
      if (k < 0) continue;
      const n = 2 + Math.floor(rnd(k, "n") * 4), dir = rnd(k, "d") > 0.5 ? 1 : -1, sp = 6 + rnd(k, "s") * 10;
      for (let j = 0; j < n; j++) {
        const fm = k * 70 + rnd(k, "m" + j) * 60, fy = (fm * PXM - V.cam) / LOW;
        if (fy < sY + 6 || fy > lh + 4) continue;
        const span = lw + 40, fx = (((rnd(k, "x" + j) * span + dir * sp * t + j * 9) % span) + span) % span - 20;
        const big = rnd(k, "b" + j) > 0.85 ? 2 : 1, col = rgb(waterAt(fm), 0.45);
        drawFish(Math.round(fx), Math.round(fy), dir, big, col);
      }
    }
    // marine snow
    sx.fillStyle = "rgba(220,235,255,.25)";
    for (let i = 0; i < 70; i++) {
      const px = rnd(i, "px") * lw, py = ((rnd(i, "py") * lh - V.cam / LOW * 0.35 - t * 3) % lh + lh) % lh;
      if (py > sY) sx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
    // bubbles
    V.bubbles = V.bubbles.filter((b) => (b.life -= dt) > 0);
    sx.strokeStyle = "rgba(220,240,255,.55)"; sx.lineWidth = 1;
    for (const b of V.bubbles) {
      b.y -= b.vy * dt; b.x += Math.sin(V.t * 3 + b.p) * 0.2;
      const by = (b.y - V.cam) / LOW; if (by < sY + 2) { b.life = 0; continue; }
      sx.beginPath(); sx.arc(Math.round(b.x / LOW) + 0.5, Math.round(by) + 0.5, b.r, 0, 7); sx.stroke();
    }
    // seaweed in the bottom corners
    if (sY < lh * 0.7) for (const side of [0, 1]) for (let i = 0; i < 5; i++) {
      const h = (0.22 + rnd(i, "h" + side) * 0.28) * lh, bx = side ? lw - 8 - i * 9 - rnd(i, "o") * 6 : 6 + i * 9 + rnd(i, "o") * 6;
      if (V.phone && i > 2) continue;
      sx.fillStyle = rgb(waterAt((V.cam + V.H) / PXM), 0.45);
      for (let y = 0; y < h; y += 2) {
        const sw = Math.sin(t * 0.8 + y * 0.05 + i * 1.7) * 4 * (y / h), x = Math.round(bx + sw);
        sx.fillRect(x, lh - y, 2, 2);
        if (y % 8 === 0 && y > 6) sx.fillRect(x + (y % 16 ? 2 : -3), lh - y, 3, 1);
      }
    }
    drawDiver();
  }

  function drawBuoy(x, y) {
    const c = "#0B1626";
    sx.fillStyle = c; sx.fillRect(x - 15, y - 2, 30, 4); sx.fillRect(x - 13, y + 2, 26, 2);
    sx.fillRect(x - 9, y - 34, 2, 32);                               // pole
    sx.fillStyle = "#2A3FF0"; sx.fillRect(x - 7, y - 34, 6, 4);       // flag
    sx.fillStyle = c; sx.fillRect(x - 8, y - 26, 6, 2);               // arm
    sx.fillStyle = "#F2F6FA"; sx.fillRect(x - 3, y - 31, 15, 10);     // backboard
    sx.fillStyle = c; sx.fillRect(x + 2, y - 28, 5, 1); sx.fillRect(x + 2, y - 24, 5, 1); sx.fillRect(x + 2, y - 28, 1, 4); sx.fillRect(x + 6, y - 28, 1, 4);
    sx.fillStyle = "#FF8A3D"; sx.fillRect(x + 2, y - 21, 9, 1);       // rim
    sx.fillStyle = "rgba(242,246,250,.85)";                            // net
    for (let r = 0; r < 4; r++) for (let k = 0; k < 5 - r; k++) sx.fillRect(x + 3 + r * 0.5 + k * 2 - (r % 2), y - 20 + r, 1, 1);
  }

  function drawFish(x, y, dir, s, col) {
    sx.fillStyle = col;
    sx.fillRect(x - 3 * s, y - s, 6 * s, 2 * s); sx.fillRect(x - 2 * s, y - 2 * s, 4 * s, s); sx.fillRect(x - 2 * s, y + s, 4 * s, s);
    const tx = dir > 0 ? x - 4 * s : x + 3 * s; sx.fillRect(tx, y - 2 * s, s, 4 * s);
  }

  // the diver: a basketball pufferfish
  function drawDiver() {
    const d = V.diver, lx = Math.round(d.x / LOW), ly = Math.round(d.y / LOW), r = 6;
    if (ly < -20 || ly > sea.height + 20) return;
    sx.fillStyle = "#F2C14E";
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + 0.2; sx.fillRect(Math.round(lx + Math.cos(a) * (r + 1.5)), Math.round(ly + Math.sin(a) * (r + 1.5)), 1, 1); }
    sx.fillStyle = "#FF8A3D";
    for (let dy = -r; dy <= r; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy)); sx.fillRect(lx - w, ly + dy, w * 2 + 1, 1); }
    sx.fillStyle = "#5A2108";
    sx.fillRect(lx - r, ly, r * 2 + 1, 1); sx.fillRect(lx, ly - r, 1, r * 2 + 1);
    for (let dy = -r + 2; dy <= r - 2; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy) * 0.55); sx.fillRect(lx - w - 1, ly + dy, 1, 1); }
    sx.fillStyle = "#FFFFFF"; sx.fillRect(lx + 2, ly - 3, 3, 3); sx.fillStyle = "#050A14"; sx.fillRect(lx + 3, ly - 2, 2, 2);
    sx.fillStyle = "#F2C14E"; sx.fillRect(lx - r - 3, ly - 2, 2, 5); sx.fillRect(lx - r - 1, ly - 1, 1, 3);
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
      const mA = Math.max(0, Math.floor((V.cam + top) / PXM / 20) * 20), mB = (V.cam + bottom) / PXM;
      for (let m = mA; m <= mB; m += 20) {
        const y = Math.round(yOf(m)) + 0.5; if (y < top || y > bottom) continue;
        const major = m % 100 === 0;
        ix.beginPath(); ix.moveTo(rx - (major ? 14 : 6), y); ix.lineTo(rx, y); ix.stroke();
        if (major && Math.abs(y - yOf(V.shownM)) > 12) { ix.fillStyle = "rgba(159,178,207,.6)"; ix.textAlign = "right"; ix.fillText(m ? `-${m}m` : "0m", rx - 18, y); }
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
      ix.fillText(text, left ? x + 26 : x - 26, y);
    });
    // tier lines for this round's reveal
    if (V.tiers) {
      const x0 = V.phone ? 8 : Math.max(16, W / 2 - 430), x1 = V.phone ? W - 26 : rx - 56;
      ix.font = "18px VT323, monospace"; ix.textAlign = "right";
      V.tiers.list.forEach((tl, i) => {
        const y = Math.round(yOf(tl.d)) + 0.5; if (y < 70 || y > H + 10) return;
        let bright = 0;
        if (tl.passedAt !== null) bright = clamp(1 - (V.t - tl.passedAt) / 0.6, 0, 1);
        const a = tl.on ? 0.95 : 0.45 + bright * 0.5;
        ix.strokeStyle = `rgba(234,246,255,${a * 0.6})`; ix.setLineDash([6, 6]); ix.lineWidth = tl.on ? 2 : 1;
        ix.beginPath(); ix.moveTo(x0, y); ix.lineTo(x1, y); ix.stroke(); ix.setLineDash([]); ix.lineWidth = 1;
        ix.fillStyle = tl.color; ix.globalAlpha = a; ix.fillText(`${EMOJI[i]} ${tl.name.toUpperCase()} · ${tl.points}`, x1 - 4, y - 10); ix.globalAlpha = 1;
      });
    }
    // the answer, sinking
    if (V.tag && V.tag.alpha > 0) {
      const y = yOf(V.tag.d), x = W / 2;
      ix.save(); ix.translate(x, y); ix.rotate(-0.21); ix.globalAlpha = V.tag.alpha;
      ix.font = `${V.phone ? 22 : 28}px VT323, monospace`; ix.textAlign = "center";
      const label = `“${V.tag.text.toUpperCase()}” ▼`, w = ix.measureText(label).width + 36, h = V.phone ? 38 : 46;
      ix.fillStyle = "rgba(9,18,34,.94)"; ix.fillRect(-w / 2, -h / 2, w, h);
      ix.fillStyle = "rgba(0,0,0,.35)"; ix.fillRect(-w / 2 + 4, h / 2, w - 4, 4);
      ix.fillStyle = "#D7E3F4"; ix.fillText(label, 0, 2);
      ix.restore();
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, V.last ? (now - V.last) / 1000 : 0.016); V.last = now; V.t += dt;
    if (V.sink) stepSink(now); else { camAim(false); V.cam += (V.camTarget - V.cam) * (1 - Math.exp(-dt * 3.2)); }
    // where the diver swims
    let tx, ty;
    if (V.tag) { tx = V.phone ? V.W * 0.1 : V.W / 2 - 170; ty = yOf(V.tag.d) - 34; }
    else if (V.mode === "start" || V.mode === "done") { tx = V.W * (V.phone ? 0.62 : 0.58); ty = surfaceScreen() + 120; }
    else if (V.mode === "reveal") { tx = V.phone ? V.W * 0.1 : V.W / 2 - 170; ty = V.H * REVEAL_Y - 34; }
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
    $("mTop").textContent = fmt(V.shownM) + "m";
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
      V.shownM = from + (to - from) * easeOut(p); $("mTop").textContent = fmt(V.shownM) + "m";
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
    $("begin").innerHTML = resume ? `<i>▼</i> CONTINUE · PROMPT ${S.answers.length + 1} <i>▼</i>` : "<i>▼</i> START THE DIVE <i>▼</i>";
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
    $("qrule").textContent = pr.rule || "rarer answers sink deeper";
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
    $("descendNext").textContent = last ? "SURFACE ▲" : "DESCEND ▼";
    $("descendNext").classList.remove("up");
    V.tiers = { d0: beforeM, list: pr.tiers.map((t, i) => ({ d: beforeM + t.points * M_PER_PT, name: t.name, points: t.points, color: tierHex(i), passedAt: null, on: a && a.tier === i })) };
    if (a) {
      SFX.hit(); $("flash").classList.remove("go"); void $("flash").offsetWidth; $("flash").classList.add("go");
      const gain = a.points * M_PER_PT, t0 = performance.now();
      V.tag = { text: a.name, d: beforeM, alpha: 1 };
      V.sink = { t0, from: beforeM, to: beforeM + gain };
      countM(beforeM, beforeM + gain, 0); V.shownM = beforeM;
      later(600, () => countM(beforeM, beforeM + gain, 3000));
      const notes = NOTES[Math.min(a.tier, NOTES.length - 1)], note = notes[Math.floor(hash(a.name) * notes.length)];
      $("rvBanner").textContent = pr.tiers[a.tier].name.toUpperCase(); $("rvBanner").style.setProperty("--c", tierHex(a.tier));
      $("rvQuote").textContent = `“${a.name}”`;
      $("rvPts").innerHTML = `+${a.points} PTS · <b>sink ${fmt(gain)}m</b>`;
      $("rvNote").textContent = a.note || note;
      later(3750, () => {
        only("revealView", "descendNext"); rv.classList.add("land"); $("descendNext").classList.add("up");
        SFX.banner(a.tier); if (V.tag) V.tag.fade = true;
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
      $("rvBanner").textContent = "OUT OF AIR"; $("rvBanner").style.setProperty("--c", "#9FB2CF");
      $("rvQuote").textContent = `the easy one: “${easiest(pr).name}”`;
      $("rvPts").innerHTML = "+0 PTS · <b>sink 0m</b>";
      $("rvNote").textContent = `The Buzzer Beater was ${deep.name}.${deep.note ? " " + deep.note : ""}`;
      later(900, () => { only("revealView", "descendNext"); rv.classList.add("land"); $("descendNext").classList.add("up"); renderHud(); $("descendNext").focus({ preventScroll: true }); });
    }
    later(600, () => { if ($("card").classList.contains("out")) $("card").hidden = true; });
    renderHud(total() - (a ? a.points : 0));
  }

  function stepSink(now) {
    const k = V.sink, p = (now - k.t0 - 600) / 3000;
    const d = k.from + (k.to - k.from) * easeOut(reduced() ? 1 : p);
    if (V.tag) {
      V.tag.d = d;
      if (V.tag.fade) V.tag.alpha = Math.max(0, V.tag.alpha - 0.06);
    }
    V.cam = d * PXM - V.H * REVEAL_Y;
    if (V.tiers) V.tiers.list.forEach((tl) => { if (tl.passedAt === null && d >= tl.d - 0.5) tl.passedAt = V.t; });
    if (Math.random() < 0.5 && p > 0 && p < 1) V.bubbles.push({ x: V.W / 2 + (Math.random() - 0.5) * 120, y: d * PXM + 10, r: 1 + Math.random() * 2, vy: 50 + Math.random() * 60, life: 3, p: Math.random() * 6 });
    SFX.depth(d);
    if (p >= 1.4 && V.tag && V.tag.alpha <= 0) { V.tag = null; V.sink = null; }
  }

  function next() {
    SFX.click(); clearLater(); V.sink = null; V.tag = null;
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
    const step = top > 2000 ? 1000 : top > 800 ? 500 : top > 300 ? 100 : 50;
    let grid = "";
    for (let v = 0; v <= top; v += step) grid += `<line x1="40" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#1E3150" stroke-dasharray="4 4"/><text x="34" y="${y(v) + 4}" text-anchor="end">-${fmt(v)}</text>`;
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
    $("rM").textContent = `-${fmt(m)}m`;
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
      return `<details><summary><span>${a ? EMOJI[a.tier] : "⬛"}</span><span class="who">${who}<small>${k + 1}. ${esc(pr.text)} · ${sub}</small></span><span class="p">+${pts(k)}<small>${fmt(pts(k) * M_PER_PT)}m</small></span></summary><div class="allans">${list}</div></details>`;
    }).join("");
    $("rate").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" aria-pressed="${S.rating === n}" aria-label="Rate ${n} of 5">${n}</button>`).join("");
    $("shareTxt").textContent = shareText();
    $("doneView").scrollTop = 0;
  }

  const shareText = () => `Daily Dive #${DAY.n} 🏀\n${total()} pts · ${fmt(meters())} m\n\n${P.map((_, k) => { const a = hit(k); return a ? EMOJI[a.tier] : "⬛"; }).join("")}\nthegravityreport.com/dive`;

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
