// Capture README media from the running demo: hero screenshot, social
// preview and a GIF-ready frame sequence of an episode being built.
//   node tools/readme_media.mjs   -> media/hero.png, work/frames/build-*.png (og.png is cropped from hero)
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FR = path.join(ROOT, "work", "frames"); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json" };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
await new Promise((r) => srv.listen(0, r));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const id = process.argv[2] || "ask072";
await p.goto(`http://localhost:${srv.address().port}/#${id}`);
await p.waitForFunction(() => document.body.dataset.ready === "1"); await p.evaluate(() => document.fonts.ready);
await p.addStyleTag({ content: "html{scroll-behavior:auto!important} .top{position:static!important}" });
// episode frames of the build card
await p.click("#replay");
const card = p.locator("#build");
for (let i = 0; i < 95; i++) { await card.screenshot({ path: path.join(FR, `build-${String(i).padStart(3, "0")}.png`) }); await p.waitForTimeout(60); }
await p.waitForTimeout(600);
// hero = top of the page (title + both cards), taken at a taller viewport
await p.setViewportSize({ width: 1440, height: 1180 });
await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(900);
await p.screenshot({ path: path.join(ROOT, "media", "hero.png") });
console.log("captured");
await b.close(); srv.close();
