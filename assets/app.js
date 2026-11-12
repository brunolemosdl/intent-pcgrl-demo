import { LevelView } from "./tiles.js";
import { Game } from "./game.js";
import { Matcher } from "./match.js";

const $ = (id) => document.getElementById(id);
// Touch play is for phones and tablets, and for any screen that has just been touched.
const coarse = matchMedia("(pointer: coarse)").matches;
let touchUi = coarse, refit = () => {};
const setTouchUi = (on) => { if (on === touchUi) return; touchUi = on; document.body.classList.toggle("touch-ui", on); refit(); };
document.body.classList.toggle("touch-ui", touchUi);
addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") setTouchUi(true); else if (e.pointerType === "mouse" && !coarse) setTouchUi(false); }, true);
const DIMS = ["enemies", "coins", "blocks", "pipes", "gaps", "verticality", "smoothness", "platforms"];
const ICON = { enemies: "goomba", coins: "coin", blocks: "question_block_coin", pipes: "pipe_top_left", platforms: "brick" };
const SVG = {
  gaps: '<svg viewBox="0 0 16 16"><rect x="0" y="9" width="6" height="7" fill="#B4501E"/><rect x="10" y="9" width="6" height="7" fill="#B4501E"/></svg>',
  verticality: '<svg viewBox="0 0 16 16"><path d="M0 16V12H4V8H8V4H12V0H16V16Z" fill="#B4501E"/></svg>',
  smoothness: '<svg viewBox="0 0 16 16"><path d="M1 11C5 5 11 16 15 8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
};
const icon = (d) => ICON[d] ? `<img src="assets/sprites/${ICON[d]}.png" alt="">` : `<span class="ico">${SVG[d]}</span>`;
const DEFAULTS = [0.5, 0.4, 0.5, 0.3, 0.4, 0.65, 0.4, 0.55];
const toast = (s) => { const t = $("toast"); t.textContent = s; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2600); };

const IDX = await (await fetch("data/index.json")).json();
const CASES = IDX.cases, byId = Object.fromEntries(CASES.map((c) => [c.id, c]));
const asks = CASES.filter((c) => c.kind === "ask");
// Hand-set presets are searchable too, so wordings with no recorded GPT-5.2
// translation (for example "flat and empty") still reach a matching level.
const PRESET_ASKS = [
  ["preset-flat-empty", "Flat & empty", "flat and empty: no enemies, no coins, no blocks, no pipes, no gaps, smooth straight ground"],
  ["preset-pipe-garden", "Pipe garden", "pipe garden: as many pipes as possible, many coins"],
  ["dial-enemies-000", "No enemies", "no enemies at all, safe"],
  ["dial-gaps-100", "Gap heavy", "as many gaps and pits as possible"],
].filter(([id]) => byId[id]).map(([id, label, words]) => ({ ...byId[id], prompt: words, presetLabel: label }));
const matcher = new Matcher([...asks, ...PRESET_ASKS]);
const cache = new Map();
async function frames(id) {
  if (!cache.has(id)) cache.set(id, fetch(`data/levels/${id}.json`).then((r) => r.json()));
  return cache.get(id);
}

/* ---------- vector bars ---------- */
function bars(el, v) {
  const SHORT = { enemies: "enemy", verticality: "vert.", smoothness: "smth.", platforms: "platf." };
  if (!el.children.length) el.innerHTML = DIMS.map((d) => `<div class="vbar" title="${d}"><span class="num">0.00</span><div class="track"><div class="fill"></div></div>${icon(d)}<span class="nm">${SHORT[d] || d}</span></div>`).join("");
  [...el.children].forEach((b, i) => { b.querySelector(".fill").style.height = `${Math.max(2, v[i] * 100)}%`; b.querySelector(".num").textContent = v[i].toFixed(2); });
}

/* ---------- gauges ---------- */
$("gauges").innerHTML = DIMS.map((d) => `<div class="gauge"><span>${d}</span><div class="tr"><div class="m"></div><div class="t"></div></div><span class="v">—</span></div>`).join("");
const G = [...$("gauges").children];
function gauges(target, measured) {
  G.forEach((g, i) => {
    const m = measured ? measured[i] : 0;
    g.querySelector(".m").style.width = `${measured ? Math.max(0.8, m * 100) : 0}%`;
    g.querySelector(".t").style.left = `${target[i] * 100}%`;
    g.querySelector(".v").textContent = measured ? m.toFixed(2) : "—";
    g.classList.toggle("ok", !!measured && Math.abs(m - target[i]) <= 0.05);
  });
}

/* ---------- episode player ---------- */
const view = new LevelView($("levelCv"));
const PH = { compose: ["stitch", "var(--green)"], stitched: ["stitch", "var(--green)"], edit: ["safe edit", "var(--purple)"], polish: ["touch-up", "var(--gold)"] };
let ep = null, epI = 0, timer = null;
function showFrame(i, instant = false) {
  epI = i;
  const f = ep.frames[i], [lab, col] = PH[f.phase];
  view.show(f.rows, { cols: f.phase === "compose" ? f.cols : 152, wave: f.phase === "compose" ? 0 : 3, instant });
  $("phase").textContent = lab; $("phase").style.color = col;
  $("err").textContent = f.error.toFixed(3);
  $("op").textContent = f.phase === "compose" ? `Stitching: ${f.cols} of 152 columns placed from pieces of real levels.`
    : f.phase === "stitched" ? "Level stitched from pieces of real levels. Now the same policy starts editing."
    : f.phase === "edit" ? `Safe edit: ${f.op.replace(/_/g, " ")} (segment ${f.segment + 1} of 8), kept because the level stays valid.`
    : "Final touch-up: every number checked against the request; the A* agent then completed the level.";
  $("scrub").max = ep.frames.length - 1; $("scrub").value = i; $("stepLbl").textContent = `${i + 1} / ${ep.frames.length}`;
  gauges(ep.target, f.measured);
}
function play() {
  clearInterval(timer); let i = 0; showFrame(0);
  timer = setInterval(() => { i++; if (i >= ep.frames.length) return clearInterval(timer); showFrame(i); }, 520);
}
$("replay").onclick = () => ep && play();
$("scrub").oninput = (e) => { clearInterval(timer); if (ep) showFrame(+e.target.value); };

/* ---------- game ---------- */
const game = new Game($("gameCv"), {
  onHud: (c, t) => { $("hudCoins").textContent = `COINS ${c}`; $("hudTime").textContent = `TIME ${t.toFixed(1)}`; },
  onEnd: (won, s) => {
    $("ovTitle").textContent = won ? "Level clear!" : "Ouch!";
    $("ovText").textContent = won ? `${s.coins} coins in ${s.time.toFixed(1)} s. Try another request?` : touchUi ? s.why : `${s.why} Press R or try again.`;
    $("ovBtn").textContent = won ? "Play again" : "Try again"; $("gameOverlay").hidden = false;
    $("gameShell").classList.remove("playing");
  },
});
let paused = false;
function startGame() {
  if (!ep) return;
  // On a touch screen the game is played in full screen, where the controls are.
  if (touchUi && !inFs()) enterFs();
  $("gameOverlay").hidden = true;
  if (paused) game.resume(); else game.start();
  paused = false; shell.classList.add("playing"); $("gameWrap").focus({ preventScroll: true });
}
function pauseGame() {
  game.running = false; paused = true; shell.classList.remove("playing");
  $("ovTitle").textContent = "Paused"; $("ovText").textContent = "The game continues in full screen."; $("ovBtn").textContent = "Continue";
  $("gameOverlay").hidden = false;
}
$("ovBtn").onclick = startGame;

/* ---------- full screen ---------- */
const shell = $("gameShell"), wrap = $("gameWrap");
const inFs = () => shell.classList.contains("fs");
// The level is 14 tiles tall. In the page the view is 26 tiles wide; in full screen it takes
// the shape of the screen, from the 16 tiles of the original game up to 34. A screen too
// narrow for 16 (a phone held upright) shows the game on top, and the touch controls get
// the space below it instead of floating over the level.
const ROWS = 14, PAGE_COLS = 26, MIN_COLS = 16, MAX_COLS = 34;
function fitView() {
  if (!inFs()) { game.setView(PAGE_COLS); wrap.style.width = wrap.style.height = ""; shell.classList.remove("tall"); return; }
  const W = shell.clientWidth, H = shell.clientHeight;
  const cols = Math.max(MIN_COLS, Math.min(MAX_COLS, (W / H) * ROWS));
  const w = Math.min(W, (H * cols) / ROWS), h = Math.min(H, (w * ROWS) / cols), tall = H - h >= Math.min(W, H) * 0.3;
  wrap.style.width = `${w}px`; wrap.style.height = `${h}px`;
  shell.classList.toggle("tall", tall);
  // Controls floating over the corners: the camera may run past both ends of the level by
  // their width, so the start and the flag stay in view beside them.
  const pad = { left: 0, right: 0 };
  if (touchUi && !tall) {
    const tile = w / cols, box = wrap.getBoundingClientRect(), gap = 6;
    pad.left = Math.max(0, ($("pad").getBoundingClientRect().right - box.left + gap) / tile - 1);
    pad.right = Math.max(0, (box.right - $("jumpBtn").getBoundingClientRect().left + gap) / tile - 1);
  }
  game.setView(cols, pad);
}
new ResizeObserver(fitView).observe(shell);
refit = fitView;
function setFs(on) {
  shell.classList.toggle("fs", on); document.documentElement.classList.toggle("fs-lock", on); fitView();
  $("fsBtn").setAttribute("aria-label", on ? "Leave full screen" : "Full screen");
  // The touch controls exist only in full screen: leaving it mid-run pauses the game.
  if (!on && touchUi && game.running) pauseGame();
}
async function enterFs() {
  setFs(true);
  // Where an element cannot go full screen (iPhone) the page-filling layout above is what stays.
  try { await shell.requestFullscreen?.({ navigationUI: "hide" }); await screen.orientation?.lock?.("landscape"); } catch { /* not available here */ }
}
async function leaveFs() {
  setFs(false);
  try { screen.orientation?.unlock?.(); if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* already left */ }
}
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && inFs()) setFs(false); });
$("fsBtn").onclick = () => { (inFs() ? leaveFs() : enterFs()); wrap.focus({ preventScroll: true }); };
$("ovExit").onclick = leaveFs;
const KEY = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", Space: "jump", ArrowUp: "jump", KeyW: "jump", KeyZ: "jump" };
addEventListener("keydown", (e) => {
  if (e.code === "Escape" && inFs() && !document.fullscreenElement) return leaveFs();
  // Keys typed into a field, and browser shortcuts, are not for the game.
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const active = game.running || document.activeElement === wrap;
  if (e.code === "KeyF" && (inFs() || active)) { e.preventDefault(); return inFs() ? leaveFs() : enterFs(); }
  if (e.code === "KeyR" && active) { paused = false; return startGame(); }
  if (!game.running) return;
  if (KEY[e.code]) { game.keys[KEY[e.code]] = true; e.preventDefault(); }
});
addEventListener("keyup", (e) => { if (KEY[e.code]) game.keys[KEY[e.code]] = false; });
// Touch controls: each one keeps its finger (pointer capture), so a thumb that drifts
// off the button keeps running, and sliding across the pad changes direction.
function hold(el, set) {
  const release = () => { el.classList.remove("on"); set(null); };
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add("on"); set(e); });
  el.addEventListener("pointermove", (e) => { if (el.hasPointerCapture(e.pointerId)) set(e); });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(type, release);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}
hold($("pad"), (e) => {
  const box = $("pad").getBoundingClientRect(), side = e ? (e.clientX < box.left + box.width / 2 ? "left" : "right") : "";
  game.keys.left = side === "left"; game.keys.right = side === "right"; $("pad").dataset.side = side;
});
hold($("jumpBtn"), (e) => { game.keys.jump = !!e; });

/* ---------- agent ---------- */
$("agentBtn").onclick = () => {
  if (!ep) return;
  const s = $("agentScreen"), show = s.hidden;
  s.hidden = !show; $("agentBtn").textContent = show ? "■ Hide the A* agent" : "▶\uFE0E Watch the A* agent play it";
  if (show) $("agentImg").src = `gameplay/${ep.id}.webp?${Date.now()}`;
};

/* ---------- load a case ---------- */
async function load(id, { label, scroll = true } = {}) {
  const c = byId[id]; if (!c) return toast("That level is not available.");
  const data = await frames(id);
  ep = { ...c, frames: data.frames };
  $("req").classList.remove("placeholder");
  $("req").textContent = label || (c.kind === "ask" ? `“${c.prompt}”` : "Your eight numbers");
  play();
  game.load(data.frames[data.frames.length - 1].rows); paused = false;
  $("gameOverlay").hidden = false; $("ovTitle").textContent = "Ready?"; $("ovText").textContent = "Run to the flag. Stomp goombas, grab coins."; $("ovBtn").textContent = "Play";
  $("agentScreen").hidden = true; $("agentBtn").textContent = "▶\uFE0E Watch the A* agent play it";
  $("agentCap").textContent = `Recorded run of the Mario AI Framework A* agent on this exact level · distance from the request ${c.error.toFixed(3)}.`;
  history.replaceState(null, "", `#${id}`);
  if (scroll && innerWidth < 980) $("build").scrollIntoView({ behavior: "smooth" });
}

/* ---------- tabs ---------- */
document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
  document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
});

/* ---------- in words ---------- */
const hand = asks.filter((c) => c.handwritten), templ = asks.filter((c) => !c.handwritten);
function chips(list) {
  $("chips").innerHTML = list.map((c) => `<button data-id="${c.id}">${c.prompt}</button>`).join("") +
    (list.length < asks.length ? `<button data-more="1" style="color:var(--gold)">+ ${templ.length} structured requests</button>` : "");
}
chips(hand);
function pickAsk(c, typed) {
  document.querySelectorAll("#chips button").forEach((b) => b.classList.toggle("on", b.dataset.id === c.id));
  bars($("askBars"), c.target);
  $("rationale").textContent = c.rationale ? `GPT-5.2’s rationale: ${c.rationale}` : "";
  const m = $("match");
  if (typed) {
    m.hidden = false; m.classList.toggle("low", typed.score < 0.25);
    m.innerHTML = typed.score < 0.25
      ? `No recorded request is close to <b>“${typed.text}”</b>. The nearest one is shown; try the examples or the <b>In numbers</b> tab.`
      : `Live model calls are off in this static demo, so your text was matched to the closest <b>recorded</b> request (similarity ${(typed.score * 100).toFixed(0)}%): <b>“${c.prompt}”</b>`;
    if (typed.others?.length) m.innerHTML += `<div class="alts">Other close requests: ${typed.others.map((o) => `<button data-alt="${o.item.id}">${o.item.prompt}</button>`).join("")}</div>`;
  } else m.hidden = true;
  load(c.id);
}
function pickPreset(p, typed) {
  document.querySelectorAll("#chips button").forEach((b) => b.classList.remove("on"));
  bars($("askBars"), p.target);
  $("rationale").textContent = `No GPT-5.2 translation is recorded for this wording, so the page shows the hand-set preset “${p.presetLabel}” (its eight numbers were set directly).`;
  const m = $("match"); m.hidden = false; m.classList.remove("low");
  m.innerHTML = `Closest match for <b>“${typed}”</b>: the <b>${p.presetLabel}</b> preset.`;
  load(p.id, { label: `Preset: ${p.presetLabel}` });
}
$("chips").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.more) return chips(asks);
  $("askInput").value = byId[b.dataset.id].prompt; pickAsk(byId[b.dataset.id]);
};
$("askForm").onsubmit = (e) => {
  e.preventDefault();
  const text = $("askInput").value.trim(); if (!text) return toast("Type a request first.");
  const exact = asks.find((c) => c.prompt.toLowerCase() === text.toLowerCase());
  if (exact) return pickAsk(exact);
  const { item, score } = matcher.best(text);
  if (!item) return toast("Try words like enemies, coins, gaps, pipes, flat or vertical.");
  if (item.presetLabel) return pickPreset(item, text);
  pickAsk(item, { text, score, others: matcher.best(text).others });
};
$("match").onclick = (e) => {
  const id = e.target.closest("[data-alt]")?.dataset.alt; if (!id) return;
  const preset = PRESET_ASKS.find((p) => p.id === id);
  if (preset) return pickPreset(preset, $("askInput").value);
  $("askInput").value = byId[id].prompt; pickAsk(byId[id]);
};

/* ---------- in numbers ---------- */
$("sliders").innerHTML = DIMS.map((d, i) => `<label class="sl">${icon(d)}<span>${d}</span><input type="range" min="0" max="1" step="0.05" value="${DEFAULTS[i]}" data-i="${i}"><span class="v">${DEFAULTS[i].toFixed(2)}</span></label>`).join("");
const SL = [...$("sliders").querySelectorAll("input")];
SL.forEach((s) => (s.oninput = () => (s.parentElement.querySelector(".v").textContent = (+s.value).toFixed(2))));
const PRESETS = { "Typical Mario": DEFAULTS, "Flat & empty": [0, 0, 0, 0, 0, 0, 1, 0], "No enemies": [0, 0.4, 0.5, 0.3, 0.4, 0.65, 0.4, 0.55], "Gap heavy": [0.5, 0.4, 0.5, 0.3, 1, 0.65, 0.4, 0.55], "Pipe garden": [0.5, 0.7, 0.5, 1, 0.4, 0.65, 0.4, 0.55], "Random": null };
$("presets").innerHTML = Object.keys(PRESETS).map((k) => `<button data-p="${k}">${k}</button>`).join("");
$("presets").onclick = (e) => {
  const k = e.target.dataset.p; if (!k) return;
  const v = PRESETS[k] || DIMS.map(() => Math.round(Math.random() * 20) / 20);
  SL.forEach((s, i) => { s.value = v[i]; s.oninput(); });
};
$("numGo").onclick = () => {
  const v = SL.map((s) => +s.value);
  let best = null, bd = 1e9;
  for (const c of CASES) { const d = Math.sqrt(c.target.reduce((a, t, i) => a + (t - v[i]) ** 2, 0)); if (d < bd) { bd = d; best = c; } }
  const m = $("numMatch"); m.hidden = false; m.classList.toggle("low", bd > 0.6);
  m.innerHTML = `No model runs in your browser, so this shows the closest of ${CASES.length} levels generated offline by the policy (distance ${bd.toFixed(2)} in the 8-D space). The gauges compare against <b>that</b> level's target.`;
  load(best.id, { label: `Your numbers: closest generated level${best.kind === "ask" ? `: “${best.prompt}”` : ""}` });
};

/* ---------- boot ---------- */
const first = byId[location.hash.slice(1)] || hand.find((c) => /peaceful/i.test(c.prompt)) || hand[0];
if (first.kind === "ask") { $("askInput").value = first.prompt; pickAsk(first); } else load(first.id, { scroll: false });
document.body.dataset.ready = "1";
