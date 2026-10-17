// GT step 4e: which picture(s) does the bulk Print Labels screen put on a label BY DEFAULT (fresh browser, nothing
// remembered)? Records the label image requests the screen makes after one scan.
import fs from "node:fs";
import { requireFE, Cases, GATE, PW, sleep } from "./lib.mjs";
const { chromium } = requireFE("@playwright/test");
const B = "http://127.0.0.1:4111";
const C = new Cases(`${GATE}/out/cases_step4e.csv`);
await sleep(3500);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const imgs = [];
ctx.on("request", (r) => { const u = new URL(r.url()); if (/\/api\/assets\/\d+\/(qr|label)\.png/.test(u.pathname)) imgs.push(u.pathname + u.search); });
const page = await ctx.newPage();
await page.goto(B + "/login");
await page.getByPlaceholder("Employee Code or Email").fill("SECHO");
await page.getByLabel("Password", { exact: true }).fill(PW);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
await page.goto(B + "/print-labels"); await page.waitForLoadState("networkidle");
const summary = await page.locator("body").innerText();
await page.getByLabel("Scan or type Serial Number / Asset Code").fill("CKSPL/ITFA-SPL/0001");
await page.keyboard.press("Enter");
await page.waitForTimeout(2500); await page.waitForLoadState("networkidle");
await page.screenshot({ path: `${GATE}/out/shots/print_labels_default.png` });
const defaultSymbol = (summary.match(/(Barcode \+ QR|QR Code|Barcode) · [^\n]+/) || [""])[0];
const uniq = [...new Set(imgs)];
C.add("GT-340", "4", "Print Labels default label pictures (fresh browser)", "observe: what the default bulk label encodes",
  `default setting "${defaultSymbol}"; images requested: ${uniq.join(", ")}`, uniq.length > 0);
C.add("GT-341", "4", "docs claim (PRODUCTION_INFRASTRUCTURE.md): Print Labels labels contain just the asset code and no URL",
  "only label.png (asset code) requested", `${uniq.some((u) => u.includes("/qr.png")) ? "the default label ALSO carries qr.png = the BASE_URL deep link" : "asset code only"}`,
  !uniq.some((u) => u.includes("/qr.png")));
await browser.close();
C.save();
