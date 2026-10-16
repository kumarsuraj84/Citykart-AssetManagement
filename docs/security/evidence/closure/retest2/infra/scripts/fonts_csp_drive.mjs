// CL2-IF item 2 (FONTS / AU-14 CSP): Chromium (Playwright) through nginx http://localhost:3411 as SECHO, SECOPIT and
// SECSELF. Each persona signs in ONCE through the real login page (>= 4 s between sign-ins: shared IP, 20/min limit).
// Recorded for every page: every request's host (anything other than the app's own origin counts, googleapis /
// gstatic named separately), CSP violations (securitypolicyviolation event + console "Content Security Policy"),
// console errors, page errors, font responses (origin, status, type), document.fonts faces that loaded, and whether
// the rupee sign is drawn by Inter / IBM Plex Mono (width equal against two very different fallbacks).
// usage: node fonts_csp_drive.mjs <base> <out-json>
import { createRequire } from "node:module";
import fs from "node:fs";
const REPO = "D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build";
const require = createRequire(REPO + "/frontend/package.json");
const { chromium } = require("@playwright/test");
const BASE = process.argv[2] || "http://localhost:3411";
const OUT = process.argv[3];
const ORIGIN = new URL(BASE).origin;
const PW = "Sec#Test2026ok";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAN = {
  SECHO: ["/dashboard", "/assets", "/assets/1", "/purchase-orders", "/purchase-orders/1", "/receive", "/receive/2",
    "/asset-movement", "/reports", "EXPORT", "/settings", "/settings/organisation", "/settings/catalogue/items",
    "/settings/vendors", "/settings/users-access", "/settings/advanced/code-format", "/settings/erp/inbox",
    "/settings/system/logs", "/settings/system/diagnostics", "/print-labels?assets=1,3", "REPORT_DIALOG"],
  SECOPIT: ["/dashboard", "/assets", "/assets/3", "/purchase-orders", "/purchase-orders/1", "/receive",
    "/asset-movement", "/reports", "EXPORT", "/settings", "/print-labels?assets=3", "REPORT_DIALOG"],
  SECSELF: ["/my-assets", "/dashboard", "/assets/1", "/settings", "REPORT_DIALOG"],
};

const browser = await chromium.launch();
const result = { base: BASE, personas: {} };
let first = true;
for (const [persona, steps] of Object.entries(PLAN)) {
  if (!first) await sleep(4500);
  first = false;
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const R = { requests: {}, foreign: [], google: 0, violations: [], cspConsole: [], consoleErrors: [], pageErrors: [],
    fontResponses: [], pages: [], downloads: [], fontProbe: {} };
  await page.exposeFunction("__cspReport", (v) => R.violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      // @ts-ignore
      window.__cspReport({ directive: e.violatedDirective, blocked: e.blockedURI, at: location.pathname });
    });
  });
  page.on("request", (r) => {
    const u = new URL(r.url());
    const key = u.protocol === "data:" || u.protocol === "blob:" ? u.protocol : u.origin;
    R.requests[key] = (R.requests[key] || 0) + 1;
    if (!["data:", "blob:"].includes(u.protocol) && u.origin !== ORIGIN) R.foreign.push(r.url().slice(0, 150));
    if (/googleapis|gstatic/i.test(r.url())) R.google++;
  });
  page.on("response", (r) => {
    if (r.request().resourceType() === "font") {
      R.fontResponses.push({ url: r.url().replace(ORIGIN, ""), sameOrigin: r.url().startsWith(ORIGIN), status: r.status(), type: r.headers()["content-type"] });
    }
  });
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) R.cspConsole.push({ at: new URL(page.url()).pathname, text: t.slice(0, 200) });
    if (m.type() === "error") R.consoleErrors.push({ at: new URL(page.url()).pathname, text: t.slice(0, 200) });
  });
  page.on("pageerror", (e) => R.pageErrors.push({ at: page.url(), text: String(e).slice(0, 200) }));
  page.on("download", async (d) => { R.downloads.push({ name: d.suggestedFilename(), url: d.url().slice(0, 80) }); });

  async function probe(label) {
    R.fontProbe[label] = await page.evaluate(async () => {
      await document.fonts.ready;
      await document.fonts.load('400 16px "Inter"', "₹1").catch(() => {});
      await document.fonts.load('600 16px "IBM Plex Mono"', "₹1").catch(() => {});
      const c = document.createElement("canvas").getContext("2d");
      const w = (f) => { c.font = f; return Math.round(c.measureText("₹").width * 100) / 100; };
      const faces = [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family}|${f.weight}`);
      return {
        bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60),
        loadedFaces: [...new Set(faces)],
        interHasRupee: w('400 32px "Inter", serif') === w('400 32px "Inter", monospace'),
        plexHasRupee: w('600 32px "IBM Plex Mono", serif') === w('600 32px "IBM Plex Mono", sans-serif'),
        rupeeOnPage: document.body.innerText.includes("₹"),
        fontsCheck: { inter: document.fonts.check('400 14px "Inter"', "₹"), plex: document.fonts.check('600 14px "IBM Plex Mono"', "₹") },
      };
    });
  }
  const step = async (label, fn) => {
    try { await fn(); R.pages.push({ label, ok: true, path: new URL(page.url()).pathname }); }
    catch (e) { R.pages.push({ label, ok: false, path: new URL(page.url()).pathname, error: String(e).slice(0, 160) }); }
  };
  await step("login", async () => {
    await page.goto(BASE + "/login", { waitUntil: "networkidle" });
    await probe("login");
    await page.getByPlaceholder("Employee Code or Email").fill(persona);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
    await page.waitForLoadState("networkidle");
  });
  for (const s of steps) {
    if (s === "EXPORT") {
      await step("reports export (Download Excel)", async () => {
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }),
          page.getByRole("button", { name: /Download Excel/i }).first().click()]);
        R.downloads.push({ name: dl.suggestedFilename(), ok: (await dl.failure()) === null });
      });
    } else if (s === "REPORT_DIALOG") {
      await step("report-a-problem dialog", async () => {
        await page.getByRole("button", { name: "Report a problem" }).first().click();
        await page.getByRole("dialog").waitFor({ timeout: 5000 });
        await page.waitForTimeout(500);
        await probe("report-dialog");
        await page.keyboard.press("Escape");
      });
    } else {
      await step(s, async () => {
        await page.goto(BASE + s, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(700);
        await probe(s);
      });
    }
  }
  await ctx.close();
  result.personas[persona] = R;
}
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
for (const [p, R] of Object.entries(result.personas)) {
  const anyInter = Object.values(R.fontProbe).some((f) => f.loadedFaces.some((x) => x.startsWith("Inter")));
  const anyPlex = Object.values(R.fontProbe).some((f) => f.loadedFaces.some((x) => x.startsWith("IBM Plex Mono")));
  const rupee = Object.values(R.fontProbe).every((f) => f.interHasRupee && f.plexHasRupee);
  console.log(`${p}: pages=${R.pages.length} failed=${R.pages.filter((x) => !x.ok).length} foreign=${R.foreign.length} google=${R.google} ` +
    `cspViolations=${R.violations.length} cspConsole=${R.cspConsole.length} consoleErrors=${R.consoleErrors.length} pageErrors=${R.pageErrors.length} ` +
    `fontResponses=${R.fontResponses.length} (sameOrigin=${R.fontResponses.filter((f) => f.sameOrigin).length}) InterLoaded=${anyInter} PlexLoaded=${anyPlex} rupeeByBothFonts=${rupee} downloads=${JSON.stringify(R.downloads)} origins=${JSON.stringify(R.requests)}`);
  for (const x of R.pages.filter((y) => !y.ok)) console.log("   step failed:", x.label, x.error);
  for (const x of R.consoleErrors) console.log("   console:", x.at, x.text);
  for (const x of R.pageErrors) console.log("   pageerror:", x.at, x.text);
  for (const x of R.violations) console.log("   CSP:", JSON.stringify(x));
}
