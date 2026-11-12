// Sprites + an animated level view: Mario tiles fly in, persist across
// frames of the same episode, and fall away when an edit removes them.
export const SOLID = new Set(["X", "S", "D", "?", "Q", "<", ">", "[", "]"]);
const SPR = { X: "solid", S: "brick", D: "used_block", o: "coin", g: "goomba", "?": "question_block_coin", Q: "question_block_empty",
  "<": "pipe_top_left", ">": "pipe_top_right", "[": "pipe_body_left", "]": "pipe_body_right", M: "player" };
export const IMG = {};
for (const k in SPR) { const im = new Image(); im.src = `assets/sprites/${SPR[k]}.png`; IMG[k] = im; }
export const SKY = "#5C94FC";

/** The goal flag; `wave` in [-1, 1] moves the tip of the pennant. */
export function drawFlag(ctx, x, y, s, wave = 0) {
  ctx.fillStyle = "#7CE07C"; ctx.fillRect(x + s * 0.44, y - s * 9, s * 0.12, s * 10);
  ctx.fillStyle = "#1E9E2E"; ctx.beginPath(); ctx.arc(x + s * 0.5, y - s * 9, s * 0.28, 0, 6.283); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(x + s * 0.44, y - s * 8.6); ctx.lineTo(x - s * 0.5, y - s * (8.1 + 0.2 * wave)); ctx.lineTo(x + s * 0.44, y - s * 7.6); ctx.fill();
}

/** A 152-column level shown as two stacked 76-column halves. */
export class LevelView {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    this.P = new Map(); this.t = performance.now(); this.alpha = 0;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    const loop = (t) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  resize() {
    const w = this.cv.parentElement.clientWidth || 600, dpr = Math.min(2.5, devicePixelRatio || 1);
    this.tile = w / 76; this.gap = this.tile * 0.9;
    const h = this.tile * 28 + this.gap;
    this.cv.style.height = h + "px"; this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); this.dpr = dpr;
  }
  /** Show one frame: rows (14 strings), only the first `cols` columns. */
  show(rows, { cols = 152, wave = 0, instant = false, ns = "L" } = {}) {
    const want = new Map(), now = performance.now();
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (c >= cols || !(ch in SPR || ch === "F")) return;
      want.set(`${ns}${ch}${c},${r}`, { ch, c, r, d: wave * c });
    }));
    const next = new Map(), pool = {};
    for (const [k, p] of this.P) {
      const t = want.get(k);
      if (t && !p.dead) { Object.assign(p, { tc: t.c, tr: t.r, ta: 1, start: now }); next.set(k, p); want.delete(k); }
      else if (!p.dead) (pool[p.ch] ??= []).push(p);
      else if (p.a > 0.01) next.set(k + "~" + Math.random(), p);
    }
    for (const a of Object.values(pool)) a.sort((u, v) => u.c - v.c || u.r - v.r);
    for (const [k, t] of [...want].sort((u, v) => u[1].c - v[1].c)) {
      const a = pool[t.ch];
      if (a && a.length) { const p = a.shift(); Object.assign(p, { tc: t.c, tr: t.r, ta: 1, start: now + t.d }); next.set(k, p); }
      else next.set(k, { ch: t.ch, c: t.c, r: t.r - 4, tc: t.c, tr: t.r, a: 0, ta: 1, start: now + t.d });
    }
    let n = 0;
    for (const a of Object.values(pool)) for (const p of a) { Object.assign(p, { dead: true, ta: 0, tr: p.r + 3, start: now }); next.set(`~${n++}`, p); }
    this.P = next;
    if (instant) for (const p of this.P.values()) { p.c = p.tc; p.r = p.tr; p.a = p.ta; p.start = 0; }
  }
  clear() { this.show([]); }
  pos(c, r) { const h = c >= 76 ? 1 : 0; return [(c - h * 76) * this.tile, h * (14 * this.tile + this.gap) + r * this.tile]; }
  frame(t) {
    const dt = Math.min(0.05, (t - this.t) / 1000); this.t = t;
    const k = 1 - Math.pow(0.02, dt * 2.2), ctx = this.ctx, s = this.tile;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = SKY;
    for (const h of [0, 1]) { ctx.beginPath(); ctx.roundRect(0, h * (14 * s + this.gap), 76 * s, 14 * s, 8); ctx.fill(); }
    for (const [key, p] of this.P) {
      if (t >= p.start) { p.c += (p.tc - p.c) * k; p.r += (p.tr - p.r) * k; p.a += (p.ta - p.a) * Math.min(1, k * 1.4); }
      if (p.dead && p.a < 0.01) { this.P.delete(key); continue; }
      if (p.a < 0.01) continue;
      const [x, y] = this.pos(p.c, p.r);
      ctx.globalAlpha = p.a;
      if (p.ch === "F") drawFlag(ctx, x, y, s);
      else if (IMG[p.ch].complete) ctx.drawImage(IMG[p.ch], x, y, s + 0.5, s + 0.5);
    }
    ctx.globalAlpha = 1;
  }
}
