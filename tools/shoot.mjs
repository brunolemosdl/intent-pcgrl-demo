// Screenshot the demo at desktop and phone sizes and exercise the main flows.
//   node tools/shoot.mjs   -> work/shots/*.png (needs `npm i playwright`)
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.env.SHOTS || path.join(ROOT, "work", "shots"); fs.mkdirSync(OUT, { recursive: true });
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json", ".pdf": "application/pdf" };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
await new Promise((r) => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/`;
const b = await chromium.launch();
const errs = [];
for (const [name, vp] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844, isMobile: true, hasTouch: true }]]) {
  const p = await b.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => errs.push(`${name}: ${e.message}`)); p.on("console", (m) => m.type() === "error" && errs.push(`${name}: ${m.text()}`));
  await p.goto(url); await p.waitForFunction(() => document.body.dataset.ready === "1"); await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${name}-1-start.png`, fullPage: true });
  await p.waitForTimeout(9000); await p.screenshot({ path: `${OUT}/${name}-2-built.png`, fullPage: true });
  // free text
  await p.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await p.fill("#askInput", "lots of coins and no enemies please"); await p.press("#askInput", "Enter");
  await p.waitForTimeout(1500); await p.locator("#ask").screenshot({ path: `${OUT}/${name}-3-typed.png` });
  // numbers tab
  await p.locator('[data-tab="numbers"]').dispatchEvent("click"); await p.locator('[data-p="Flat & empty"]').dispatchEvent("click"); await p.locator("#numGo").dispatchEvent("click");
  await p.waitForTimeout(9000); await p.screenshot({ path: `${OUT}/${name}-4-numbers.png`, fullPage: true });
  // play: hold right + jump for a while
  await p.locator("#ovBtn").dispatchEvent("click");
  if (name === "desktop") { await p.keyboard.down("ArrowRight"); for (let i = 0; i < 8; i++) { await p.keyboard.down("Space"); await p.waitForTimeout(350); await p.keyboard.up("Space"); await p.waitForTimeout(250); } await p.keyboard.up("ArrowRight"); }
  await p.waitForTimeout(400); await p.locator("#play").screenshot({ path: `${OUT}/${name}-5-play.png` });
  await p.close();
}
console.log(errs.length ? "ERRORS:\n" + [...new Set(errs)].join("\n") : "no errors");
await b.close(); srv.close();
