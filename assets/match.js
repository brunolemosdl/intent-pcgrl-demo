// Match free text to the closest *recorded* request (no model runs here).
// TF-IDF cosine over lightly stemmed words, with a few domain synonyms.
const STOP = new Set("a an the of with and or to in on for is it be just very some so that this my me i want make give level levels stage map please".split(" "));
const SYN = { goomba: "enemy", goombas: "enemy", monster: "enemy", monsters: "enemy", foe: "enemy", danger: "enemy", dangerous: "enemy", hazard: "enemy", hazards: "enemy",
  pit: "gap", pits: "gap", hole: "gap", holes: "gap", chasm: "gap", chasms: "gap", jump: "gap", jumps: "gap",
  hill: "vertical", hills: "vertical", hilly: "vertical", mountain: "vertical", mountainous: "vertical", climb: "vertical", climbing: "vertical", tall: "vertical", staircase: "vertical", sky: "vertical",
  flat: "flat", straight: "flat", linear: "flat", smooth: "smooth", gentle: "smooth", rough: "rough", bumpy: "rough",
  coin: "coin", coins: "coin", treasure: "coin", collect: "coin", brick: "block", bricks: "block", blocks: "block", question: "block",
  pipe: "pipe", pipes: "pipe", plumbing: "pipe", platform: "platform", platforms: "platform", floating: "platform",
  empty: "none", no: "none", zero: "none", without: "none", few: "few", little: "few", sparse: "few", barely: "few",
  many: "many", lots: "many", lot: "many", everywhere: "many", tons: "many", loads: "many", crowded: "many", packed: "many", full: "many", plenty: "many", max: "max", maximum: "max", everything: "max",
  easy: "easy", hard: "hard", difficult: "hard", brutal: "hard", challenge: "hard", challenging: "hard" };
const norm = (w) => { w = w.toLowerCase(); if (SYN[w]) return SYN[w]; w = w.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, ""); return SYN[w] || w; };
export const tokens = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter((w) => w && !STOP.has(w)).map(norm);

export class Matcher {
  constructor(items) {
    this.items = items.map((it) => ({ it, tf: this.tf(tokens(it.prompt)) }));
    const df = new Map();
    for (const { tf } of this.items) for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    const N = this.items.length;
    this.idf = (w) => Math.log((N + 1) / ((df.get(w) || 0) + 0.5));
    for (const x of this.items) x.vec = this.weigh(x.tf);
  }
  tf(ws) { const m = new Map(); ws.forEach((w) => m.set(w, (m.get(w) || 0) + 1)); return m; }
  weigh(tf) { const v = new Map(); let n = 0; for (const [w, c] of tf) { const x = c * this.idf(w); v.set(w, x); n += x * x; } v.norm = Math.sqrt(n) || 1; return v; }
  rank(text) {
    const q = this.weigh(this.tf(tokens(text)));
    return this.items.map((x) => {
      let dot = 0; for (const [w, a] of q) if (x.vec.has(w)) dot += a * x.vec.get(w);
      return { item: x.it, score: dot / (q.norm * x.vec.norm) };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  }
  best(text) { const r = this.rank(text); return r[0] ? { ...r[0], others: r.slice(1, 4) } : { item: null, score: 0, others: [] }; }
}
