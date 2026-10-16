// Pixel comparison of the before/after screenshots (WP-C FONTS). Usage: node compare.mjs <beforeDir> <afterDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire("D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/frontend/package.json");
const { chromium } = require("@playwright/test");
const [a, b] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const rows = [];
for (const f of fs.readdirSync(a).filter((x) => x.endsWith(".png"))) {
  if (!fs.existsSync(path.join(b, f))) continue;
  const A = "data:image/png;base64," + fs.readFileSync(path.join(a, f)).toString("base64");
  const B = "data:image/png;base64," + fs.readFileSync(path.join(b, f)).toString("base64");
  const r = await page.evaluate(async ([A, B]) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(A), load(B)]);
    const W = Math.min(ia.width, ib.width), H = Math.min(ia.height, ib.height);
    const get = (img) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H).data; };
    const da = get(ia), db = get(ib);
    let diff = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) {
        diff++; const p = i / 4, x = p % W, y = Math.floor(p / W);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`, diffPixels: diff, diffPct: +(100 * diff / (W * H)).toFixed(3), box: diff ? `${x0},${y0}-${x1},${y1}` : "" };
  }, [A, B]);
  rows.push({ file: f, ...r });
}
await browser.close();
console.table(rows);
fs.writeFileSync(path.join(b, "compare.json"), JSON.stringify(rows, null, 2));
