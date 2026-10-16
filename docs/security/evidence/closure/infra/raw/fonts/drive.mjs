// WP-C FONTS check. Signs in ONCE as SECHO, visits the main screens under the CSP of the served build, and records:
// every request host (googleapis/gstatic must be 0), CSP violations, console errors, page errors, which font faces
// loaded, computed font families, and whether the rupee sign is drawn by Inter / IBM Plex Mono. Screenshots at
// 1366x768 of Home, Assets, a PO page and Receive. Usage: node drive.mjs <base> <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const REPO = "D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build";
const require = createRequire(REPO + "/frontend/package.json");
const { chromium } = require("@playwright/test");
const BASE = process.argv[2] || "http://127.0.0.1:3498";
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const PW = process.env.SEC_PW; // the throw-away ckam-sec fixture password (not stored in the repository)

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
const page = await ctx.newPage();
const requests = [];
const violations = [];
const consoleErrors = [];
const pageErrors = [];
const fontResponses = [];
await page.exposeFunction("__cspReport", (v) => violations.push(v));
await page.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (e) => {
    // @ts-ignore
    window.__cspReport({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, at: location.pathname });
  });
});
page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType(), at: page.url() }));
page.on("response", (r) => { if (r.request().resourceType() === "font") fontResponses.push({ url: r.url(), status: r.status(), type: r.headers()["content-type"] }); });
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ at: page.url(), text: m.text().slice(0, 300) }); });
page.on("pageerror", (e) => pageErrors.push({ at: page.url(), text: String(e).slice(0, 300) }));

const visited = [];
const fontInfo = {};
const step = async (label, fn) => {
  try { await fn(); visited.push({ label, ok: true, url: page.url() }); }
  catch (e) { visited.push({ label, ok: false, url: page.url(), error: String(e).slice(0, 200) }); }
};
async function probeFonts(label) {
  fontInfo[label] = await page.evaluate(async () => {
    await document.fonts.ready;
    // Make sure the faces that cover the rupee sign are requested, then compare widths against two very different
    // fallbacks: equal widths = the glyph really comes from the named font.
    await document.fonts.load('400 16px "Inter Variable"', "₹1").catch(() => {});
    await document.fonts.load('400 16px "Inter"', "₹1").catch(() => {});
    await document.fonts.load('600 16px "IBM Plex Mono"', "₹1").catch(() => {});
    const c = document.createElement("canvas").getContext("2d");
    const w = (font) => { c.font = font; return c.measureText("₹").width; };
    const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
    const numeric = getComputedStyle(document.documentElement).getPropertyValue("--font-numeric").trim();
    const first = (stack) => stack.split(",")[0].trim();
    const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family}|${f.weight}|${f.style}|${f.unicodeRange.slice(0, 24)}`);
    const numEl = document.querySelector(".num, [data-numeric]");
    return {
      htmlFontFamily: getComputedStyle(document.documentElement).fontFamily,
      bodyFontFamily: getComputedStyle(document.body).fontFamily,
      numericSample: numEl ? { text: numEl.textContent.slice(0, 30), family: getComputedStyle(numEl).fontFamily, weight: getComputedStyle(numEl).fontWeight } : null,
      sansVar: sans, numericVar: numeric,
      check: {
        sans400: document.fonts.check(`400 14px ${first(sans)}`), sans650: document.fonts.check(`650 14px ${first(sans)}`),
        sans700: document.fonts.check(`700 14px ${first(sans)}`), mono600: document.fonts.check(`600 14px ${first(numeric)}`),
      },
      rupee: {
        sans: [w(`400 32px ${first(sans)}, serif`), w(`400 32px ${first(sans)}, monospace`)],
        mono: [w(`600 32px ${first(numeric)}, serif`), w(`600 32px ${first(numeric)}, sans-serif`)],
      },
      loadedFaces: loaded,
    };
  });
}
const go = (p, shot) => step(p, async () => {
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(900);
  if (shot) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, `${shot}.png`) });
    await probeFonts(shot);
  }
});

await step("login", async () => {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, "00-login.png") });
  await probeFonts("login");
  await page.getByLabel("User ID", { exact: true }).fill("SECHO");
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  await page.waitForLoadState("networkidle");
});
await go("/dashboard", "01-home");
await go("/assets", "02-assets");
await go("/assets/1", "03-asset360");
await go("/purchase-orders", "04-po-list");
await go("/purchase-orders/1", "05-po-page");
await go("/receive", "06-receive");
await go("/asset-movement", "07-move");
await go("/reports", "08-reports");
await go("/settings", "09-settings");
await go("/settings/system/logs", "10-logs");
await step("report-a-problem dialog", async () => {
  await page.getByRole("button", { name: "Report a problem" }).first().click();
  await page.getByRole("dialog").waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "11-report-problem.png") });
  await probeFonts("11-report-problem");
  await page.keyboard.press("Escape");
});

await browser.close();
const hosts = {};
for (const r of requests) { const h = new URL(r.url).host; hosts[h] = (hosts[h] || 0) + 1; }
const google = requests.filter((r) => /googleapis|gstatic/i.test(r.url));
const result = { base: BASE, visited, hosts, googleRequests: google.length, violations, consoleErrors, pageErrors, fontResponses, fontInfo };
fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
const failed = visited.filter((v) => !v.ok);
console.log(`steps=${visited.length} failed=${failed.length} hosts=${JSON.stringify(hosts)} google=${google.length} violations=${violations.length} consoleErrors=${consoleErrors.length} pageErrors=${pageErrors.length} fontResponses=${fontResponses.length}`);
for (const f of failed) console.log("  step failed:", f.label, f.error);
for (const v of violations) console.log("  VIOLATION", JSON.stringify(v));
for (const c of consoleErrors) console.log("  CONSOLE", c.at, c.text);
for (const e of pageErrors) console.log("  PAGEERROR", e.at, e.text);
for (const f of fontResponses) console.log("  FONT", f.status, f.type, f.url.slice(0, 120));
console.log("  fontInfo[01-home]", JSON.stringify(fontInfo["01-home"]));
