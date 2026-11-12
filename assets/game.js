// A small, simplified platformer over the generated tile grid.
// Not the original engine: just enough physics to run, jump, stomp and finish.
// The player is a single sprite: running, jumping, landing and the finish are
// shown by squash, stretch, lean and a few dust and spark particles.
import { IMG, SOLID, SKY, drawFlag } from "./tiles.js";

const T = 16, VIEW_H = 14 * T, WAKE = 26 * T;
const MAX_RUN = 2.3, ACC = 0.22, AIR_ACC = 0.16, FRICTION = 0.8;
const JUMP_V = -6.5, G_HOLD = 0.24, G = 0.52, MAX_FALL = 7;
const FINISH_FRAMES = 84, FALL_FRAMES = 50;
const SPARKS = ["#FFC83D", "#FFFFFF", "#7CE07C"];

export class Game {
  constructor(canvas, { onEnd, onHud } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    canvas.height = VIEW_H; this.setView(26);
    this.onEnd = onEnd || (() => {}); this.onHud = onHud || (() => {});
    this.keys = { left: false, right: false, jump: false };
    this.running = false; this.rows = null; this.acc = 0; this.last = performance.now();
    const loop = (t) => { this.tick(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  /**
   * How many columns of the level are on screen; the view is always 14 rows tall.
   * `left` and `right` (in tiles) let the camera run past the ends of the level, so the
   * start and the flag are not hidden under controls that float over the corners.
   */
  setView(cols, { left = 0, right = 0 } = {}) {
    const vw = Math.round(cols * T), padL = left * T, padR = right * T;
    if (vw === this.vw && padL === this.padL && padR === this.padR) return;
    if (vw !== this.vw) { this.vw = vw; this.cv.width = vw; }
    this.padL = padL; this.padR = padR;
    if (this.rows) { this.follow(); this.draw(); }
  }
  follow() { this.cam = Math.max(-this.padL, Math.min(this.W * T - this.vw + this.padR, this.m.x - this.vw * 0.4)); }
  load(rows) {
    this.src = rows.map((r) => r);
    this.reset(); this.running = false; this.draw();
  }
  reset() {
    this.rows = this.src.map((r) => [...r]);
    this.W = this.rows[0].length;
    let sx = 1, sy = 12;
    this.goombas = []; this.flagX = (this.W - 2) * T; this.flagY = 12 * T;
    this.rows.forEach((row, r) => row.forEach((ch, c) => {
      if (ch === "M") { sx = c; sy = r; row[c] = "-"; }
      if (ch === "g") { this.goombas.push({ x: c * T + 1, y: r * T + 2, vx: -0.55, vy: 0, alive: true, squash: 0, awake: false }); row[c] = "-"; }
      if (ch === "F") { this.flagX = c * T; this.flagY = r * T; }
    }));
    this.m = { x: sx * T + 2, y: sy * T + 1, vx: 0, vy: 0, w: 12, h: 15, ground: false, face: 1, stride: 0, stretch: 0, squash: 0, skid: false };
    this.coins = 0; this.time = 0; this.won = false; this.cam = -this.padL; this.pops = []; this.bits = []; this.safe = 90;   // 1.5 s grace at spawn
    this.clock = 0; this.finish = null; this.falling = null;
    this.onHud(this.coins, this.time);
  }
  start() { if (!this.src) return; this.reset(); this.running = true; }
  /** Continue a run that was paused (start() always begins the level again). */
  resume() { if (this.rows) this.running = true; }
  solidAt(px, py) {
    const c = Math.floor(px / T), r = Math.floor(py / T);
    if (c < 0 || c >= this.W) return true;
    if (r < 0 || r >= 14) return false;
    return SOLID.has(this.rows[r][c]);
  }
  collide(b, axis) {
    const xs = [b.x + 0.01, b.x + b.w - 0.01], ys = [b.y + 0.01, b.y + b.h - 0.01];
    if (axis === "x") {
      for (const y of [ys[0], b.y + b.h / 2, ys[1]]) {
        if (b.vx > 0 && this.solidAt(xs[1], y)) { b.x = Math.floor(xs[1] / T) * T - b.w; return true; }
        if (b.vx < 0 && this.solidAt(xs[0], y)) { b.x = (Math.floor(xs[0] / T) + 1) * T; return true; }
      }
      return false;
    }
    for (const x of xs) {
      if (b.vy > 0 && this.solidAt(x, ys[1])) { b.y = Math.floor(ys[1] / T) * T - b.h; return "down"; }
      if (b.vy < 0 && this.solidAt(x, ys[0])) { const r = Math.floor(ys[0] / T), c = Math.floor(x / T); b.y = (r + 1) * T; return { r, c }; }
    }
    return false;
  }
  /** Small squares that fly off and fade: dust at the feet, sparks at the flag. */
  puff(x, y, n, colors = ["#FFFFFF"], speed = 1) {
    for (let i = 0; i < n; i++) {
      this.bits.push({ x, y, vx: (Math.random() - 0.5) * 1.6 * speed, vy: -(0.3 + Math.random() * 0.9) * speed, g: 0.05 * speed,
        t: 0, life: 14 + Math.random() * 10 * speed, color: colors[i % colors.length] });
    }
  }
  particles() {
    for (const p of this.pops) p.t++;
    this.pops = this.pops.filter((p) => p.t < 24);
    for (const b of this.bits) { b.t++; b.x += b.vx; b.y += b.vy; b.vy += b.g; }
    this.bits = this.bits.filter((b) => b.t < b.life);
  }
  step() {
    this.clock++;
    this.particles();
    if (this.falling) return this.fall();
    if (this.finish) return this.celebrate();
    const m = this.m, k = this.keys;
    this.time += 1 / 60;
    const acc = m.ground ? ACC : AIR_ACC;
    m.skid = m.ground && ((k.left && m.vx > 0.6) || (k.right && m.vx < -0.6));
    if (k.left) { m.vx = Math.max(-MAX_RUN, m.vx - acc); m.face = -1; }
    else if (k.right) { m.vx = Math.min(MAX_RUN, m.vx + acc); m.face = 1; }
    else if (m.ground) { m.vx *= FRICTION; if (Math.abs(m.vx) < 0.05) m.vx = 0; }
    const feet = () => [m.x + m.w / 2, m.y + m.h];
    if (k.jump && m.ground && !this.jumpHeld) { m.vy = JUMP_V; m.ground = false; m.stretch = 1; this.puff(...feet(), 3); }
    this.jumpHeld = k.jump;
    m.vy = Math.min(MAX_FALL, m.vy + (k.jump && m.vy < 0 ? G_HOLD : G));
    m.x += m.vx; if (this.collide(m, "x")) m.vx = 0;
    m.x = Math.max(0, m.x);
    const wasGround = m.ground, fallSpeed = m.vy;
    m.y += m.vy; const hit = this.collide(m, "y");
    m.ground = hit === "down";
    if (hit) {
      if (hit !== "down") {
        const ch = this.rows[hit.r][hit.c];
        if (ch === "?" || ch === "Q") { this.rows[hit.r][hit.c] = "D"; this.coins++; this.pops.push({ x: hit.c * T, y: hit.r * T - T, t: 0 }); }
      }
      m.vy = 0;
    }
    // what the drawing reads: stride phase, landing squash, take-off stretch
    if (m.ground && !wasGround && fallSpeed > 2.5) { m.squash = 1; this.puff(...feet(), 4); }
    if (m.ground) {
      const half = Math.floor(m.stride / Math.PI);
      m.stride += Math.abs(m.vx) * 0.3;
      if ((Math.abs(m.vx) > 1.4 && Math.floor(m.stride / Math.PI) !== half) || (m.skid && this.clock % 5 === 0)) this.puff(m.x + m.w / 2 - m.face * 4, m.y + m.h, 1);
    }
    m.stretch *= 0.85; m.squash *= 0.8;
    // coins
    for (let r = Math.floor(m.y / T); r <= Math.floor((m.y + m.h) / T); r++) for (let c = Math.floor(m.x / T); c <= Math.floor((m.x + m.w) / T); c++)
      if (r >= 0 && r < 14 && this.rows[r]?.[c] === "o") { this.rows[r][c] = "-"; this.coins++; }
    // goombas
    for (const g of this.goombas) {
      if (!g.alive) { g.squash++; continue; }
      if (!g.awake && g.x - m.x < WAKE) g.awake = true;
      if (!g.awake) continue;
      const gb = { x: g.x, y: g.y, w: 14, h: 14, vx: g.vx, vy: g.vy };
      gb.x += g.vx; if (this.collide(gb, "x")) g.vx = -g.vx;
      gb.vy = Math.min(MAX_FALL, g.vy + G); gb.y += gb.vy; if (this.collide(gb, "y") === "down") gb.vy = 0;
      Object.assign(g, { x: gb.x, y: gb.y, vy: gb.vy });
      if (g.y > VIEW_H + 40) g.alive = false;
      const over = m.x < g.x + 14 && m.x + m.w > g.x && m.y < g.y + 14 && m.y + m.h > g.y;
      if (over) {
        if (m.vy > 0 && m.y + m.h - g.y < 9) { g.alive = false; m.vy = -4.6; m.stretch = 0.7; this.puff(g.x + 7, g.y + 10, 4); }
        else if (this.safe <= 0) { this.falling = { t: 0, why: "A goomba got you." }; m.vx = 0; m.vy = -5.6; return; }
      }
    }
    if (m.y > VIEW_H + 20) return this.end(false, "You fell into a gap.");
    if (m.x + m.w >= this.flagX + 6) return this.reachFlag();
    this.follow();
    if (this.safe > 0) this.safe--;
    this.onHud(this.coins, this.time);
  }
  /** The flag is touched: the clock stops and the player hops twice under a shower of sparks. */
  reachFlag() {
    const m = this.m;
    this.finish = { t: 0, hops: 0 };
    m.vx = 0; m.skid = false; this.safe = 0;
    if (m.ground) { m.vy = -5; m.ground = false; m.stretch = 1; this.finish.hops = 1; }
    this.puff(this.flagX + T / 2, this.flagY - 9 * T, 26, SPARKS, 2.4);
  }
  celebrate() {
    const f = this.finish, m = this.m;
    f.t++;
    const wasGround = m.ground;
    m.vy = Math.min(MAX_FALL, m.vy + G); m.y += m.vy;
    m.ground = this.collide(m, "y") === "down";
    if (m.ground) {
      m.vy = 0;
      if (!wasGround) { m.squash = 1; this.puff(m.x + m.w / 2, m.y + m.h, 3); }
      if (f.hops < 2 && f.t < FINISH_FRAMES - 40) {
        m.vy = -4.4; m.ground = false; m.stretch = 1; f.hops++;
        this.puff(this.flagX + T / 2, this.flagY - 9 * T, 16, SPARKS, 2.2);
      }
    }
    m.stretch *= 0.85; m.squash *= 0.8;
    if (f.t >= FINISH_FRAMES || m.y > VIEW_H + 20) { this.finish = null; this.end(true); }
  }
  /** Hit by a goomba: the player pops up and tumbles off the screen. */
  fall() {
    const d = this.falling, m = this.m;
    d.t++;
    m.vy = Math.min(MAX_FALL, m.vy + G * 0.8); m.y += m.vy;
    if (d.t >= FALL_FRAMES || m.y > VIEW_H + 40) { this.falling = null; this.end(false, d.why); }
  }
  end(won, why) { this.running = false; this.won = won; this.onEnd(won, { coins: this.coins, time: this.time, why }); }
  tick(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    if (this.running) { this.acc += dt; while (this.acc >= 1 / 60 && this.running) { this.step(); this.acc -= 1 / 60; } }
    else this.acc = 0;
    if (this.rows) this.draw();
  }
  draw() {
    const ctx = this.ctx, cam = Math.round(this.cam);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = SKY; ctx.fillRect(0, 0, this.vw, VIEW_H);
    const c0 = Math.floor(cam / T), c1 = c0 + Math.ceil(this.vw / T), last = this.W - 1;
    const wave = Math.sin(this.clock * (this.finish ? 0.5 : 0.1));
    for (let r = 0; r < 14; r++) for (let c = c0; c <= c1; c++) {
      // past either end of the level the ground simply goes on
      const ch = c >= 0 && c <= last ? this.rows[r][c] : this.rows[r][c < 0 ? 0 : last] === "X" ? "X" : "-";
      const x = c * T - cam, y = r * T;
      if (ch === "F") drawFlag(ctx, x, y, T, wave);
      else if (IMG[ch] && ch !== "M" && ch !== "g") ctx.drawImage(IMG[ch], x, y, T, T);
    }
    for (const p of this.pops) { ctx.globalAlpha = 1 - p.t / 24; ctx.drawImage(IMG.o, p.x - cam, p.y - p.t, T, T); ctx.globalAlpha = 1; }
    for (const g of this.goombas) {
      if (!g.alive && g.squash > 20) continue;
      const x = g.x - 1 - cam;
      if (x < -T || x > this.vw) continue;
      if (!g.alive) { ctx.drawImage(IMG.g, x, g.y + 8, T, T / 2); continue; }
      // a two-beat waddle: the sprite mirrors as it walks
      const flip = g.awake && Math.floor(this.clock / 10) % 2 ? -1 : 1;
      ctx.save(); ctx.translate(Math.round(x) + T / 2, g.y - 2); ctx.scale(flip, 1); ctx.drawImage(IMG.g, -T / 2, 0, T, T); ctx.restore();
    }
    for (const b of this.bits) {
      ctx.globalAlpha = Math.max(0, 1 - b.t / b.life); ctx.fillStyle = b.color;
      ctx.fillRect(Math.round(b.x - cam), Math.round(b.y), 2, 2);
    }
    ctx.globalAlpha = 1;
    if (!(this.running && this.safe > 0 && Math.floor(this.safe / 5) % 2)) this.drawPlayer(ctx, cam);
  }
  drawPlayer(ctx, cam) {
    const m = this.m, run = m.ground ? Math.min(1, Math.abs(m.vx) / MAX_RUN) : 0;
    const beat = Math.sin(m.stride * 2);
    let face = m.face, lift = Math.abs(Math.sin(m.stride)) * 1.6 * run;
    let sx = 1 + 0.07 * run * beat, sy = 1 - 0.07 * run * beat, lean = 0.11 * run;
    if (m.skid) lean = -0.2;
    if (!m.ground) { lean = Math.max(-0.22, Math.min(0.28, m.vy * 0.035)); sx -= 0.04; sy += 0.06; }
    sx += 0.2 * m.squash - 0.12 * m.stretch; sy += 0.2 * m.stretch - 0.24 * m.squash;
    if (this.finish && !m.ground) { const turn = Math.cos(this.finish.t * 0.35); face = turn >= 0 ? 1 : -1; sx *= 0.35 + 0.65 * Math.abs(turn); lean = 0; }
    if (this.falling) { lean = this.falling.t * 0.3; sx = sy = 1; lift = 0; }
    // drawn from the feet, so squash and stretch keep the player on the ground
    ctx.save();
    ctx.translate(Math.round(m.x + m.w / 2 - cam), Math.round(m.y + m.h - lift));
    ctx.rotate(lean * face); ctx.scale(face * sx, sy);
    ctx.drawImage(IMG.M, -T / 2, -T, T, T);
    ctx.restore();
  }
}
