// GT step 4c: the PACKAGE's frontend in a real browser (Playwright Chromium) on 127.0.0.1:4111.
// Sign-in state is kept PER TAB (sessionStorage `ckam-auth`, frontend/src/lib/auth-store.ts), so:
//  * "cold load" = a full document load (page.goto, no SPA navigation) in the signed-in tab;
//  * a NEW tab / a phone scanning a label = login screen with ?next=/assets/<id>, then Asset 360.
// Also: main screens, fonts (0 requests to Google hosts) and CSP violations (0).
// (First run used a new tab per screen and saw the login screen: see cases_step4c_firstrun_newtab.csv.)
import fs from "node:fs";
import { requireFE, Cases, GATE, PW, sleep } from "./lib.mjs";
const { chromium } = requireFE("@playwright/test");
const B = "http://127.0.0.1:4111";
const C = new Cases(`${GATE}/out/cases_step4c.csv`);
const SHOTS = `${GATE}/out/shots`;
fs.mkdirSync(SHOTS, { recursive: true });
const ids = JSON.parse(fs.readFileSync(`${GATE}/out/new_ids.json`, "utf8"));
const browser = await chromium.launch();
const external = [], csp = [], consoleErr = [], fontReq = [], apiFail = [];

async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  await ctx.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  ctx.on("request", (r) => {
    const u = new URL(r.url());
    if (u.hostname !== "127.0.0.1" && !["blob:", "data:"].includes(u.protocol)) external.push(r.url());
    if (/\.woff2?$/.test(u.pathname)) fontReq.push(u.pathname);
  });
  ctx.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) apiFail.push(`${r.status()} ${r.url()}`); });
  return ctx;
}
function watch(page, label) {
  page.on("console", (m) => { if (m.type() === "error") consoleErr.push(`${label}: ${m.text().slice(0, 200)}`); });
}
async function cspOf(page, label) {
  const v = await page.evaluate(() => window.__csp || []).catch(() => []);
  for (const x of v) csp.push(`${label}: ${x}`);
}
async function fillLogin(page, code) {
  await page.getByPlaceholder("Employee Code or Email").fill(code);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function hardLoad(page, path, label, expectText) {
  const resp = await page.goto(B + path, { waitUntil: "load" });
  const status = resp?.status(), ctype = resp?.headers()["content-type"];
  let found = false;
  if (expectText) found = await page.getByText(expectText, { exact: false }).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForLoadState("networkidle").catch(() => {});
  const body = await page.locator("body").innerText().catch(() => "");
  const jsonError = /^\s*\{"detail"/.test(body) || body.includes("request_id");
  const atLogin = new URL(page.url()).pathname.startsWith("/login");
  await page.screenshot({ path: `${SHOTS}/${label}.png` });
  await cspOf(page, label);
  return { status, ctype, found, jsonError, atLogin, body, url: page.url() };
}

// 1. head office sign-in (tab 1)
await sleep(3500);
const ctx = await newCtx();
const page = await ctx.newPage(); watch(page, "secho");
await page.goto(B + "/login");
await fillLogin(page, "SECHO");
C.add("GT-300", "4", "browser sign-in SECHO via the login page", "leaves /login, app loads", `url=${new URL(page.url()).pathname}`, !new URL(page.url()).pathname.startsWith("/login"));
await page.screenshot({ path: `${SHOTS}/home_secho.png` });

// 2. cold (full document) loads of the deep links in the signed-in tab
const a1 = await hardLoad(page, "/assets/1", "cold_assets_1", "CKSPL/ITFA-SPL/0001");
C.add("GT-301", "4", "COLD load /assets/1 (Asset 360 QR deep link) signed in as SECHO", "200 text/html shell, Asset 360 renders with the asset code, no JSON error",
  `${a1.status} ${a1.ctype} codeVisible=${a1.found} jsonError=${a1.jsonError} atLogin=${a1.atLogin}`, a1.status === 200 && a1.found && !a1.jsonError && !a1.atLogin);
const a2 = await hardLoad(page, `/assets/${ids.newLaptop}`, "cold_assets_newlaptop", "GTSERIAL0001");
C.add("GT-302", "4", `COLD load /assets/${ids.newLaptop} (asset received after the migration)`, "Asset 360 renders (serial visible)", `${a2.status} serialVisible=${a2.found} jsonError=${a2.jsonError}`, a2.status === 200 && a2.found && !a2.jsonError);
const an = await hardLoad(page, "/assets/new", "cold_assets_new", "");
C.add("GT-303", "4", "COLD load /assets/new", "200 shell, Add Assets screen renders (not login, no JSON error)", `${an.status} ${an.ctype} atLogin=${an.atLogin} jsonError=${an.jsonError} text="${an.body.slice(0, 140).replace(/\s+/g, " ")}"`,
  an.status === 200 && !an.atLogin && !an.jsonError && an.body.length > 50);
const qrUrl = "http://127.0.0.1:4111/assets/1"; // what qr.png of asset 1 encodes (qrverify.py)
const aq = await hardLoad(page, new URL(qrUrl).pathname, "cold_qr_url", "CKSPL/ITFA-SPL/0001");
C.add("GT-304", "4", `open the URL encoded in qr.png (${qrUrl}) directly`, "Asset 360 of asset 1", `${aq.status} codeVisible=${aq.found}`, aq.status === 200 && aq.found);
const a404 = await hardLoad(page, "/assets/99999", "cold_assets_missing", "");
C.add("GT-305", "4", "COLD load /assets/99999 (no such asset)", "app shell with a friendly message, not a raw JSON page", `${a404.status} jsonError=${a404.jsonError} text="${a404.body.slice(0, 160).replace(/\s+/g, " ")}"`, a404.status === 200 && !a404.jsonError && !a404.atLogin);

// 3. main screens (cold loads in the same tab)
const screens = [["/dashboard", ""], ["/assets", "CKSPL/ITFA-SPL/0001"], ["/purchase-orders", "SEC-SPL-PO-002"], ["/purchase-orders/2", "SEC-SPL-PO-002"], ["/receive", ""], ["/asset-movement", ""],
  ["/reports", ""], ["/print-labels", ""], ["/settings/system/logs", ""], ["/settings/system/diagnostics", "eed3de1"], ["/settings/vendors", "GT Gate Vendor"]];
let n = 310;
for (const [p, t] of screens) {
  const r = await hardLoad(page, p, "screen" + p.replace(/\//g, "_"), t || undefined);
  C.add(`GT-${n++}`, "4", `screen ${p} (cold load)`, "renders" + (t ? ` with "${t}"` : "") + ", not login, no JSON error", `${r.status} found=${t ? r.found : "n/a"} atLogin=${r.atLogin} jsonError=${r.jsonError}`,
    r.status === 200 && (!t || r.found) && !r.jsonError && !r.atLogin);
}
await page.goto(B + "/dashboard"); await page.waitForLoadState("networkidle");
const fontsOk = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight); });
const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
C.add("GT-330", "4", "self-hosted fonts load", "Inter loaded from /assets, body font Inter", `loaded=${JSON.stringify(fontsOk)} body=${bodyFont} fontFiles=${JSON.stringify([...new Set(fontReq)])}`, fontsOk.some((f) => /Inter/i.test(f)) && /Inter/i.test(bodyFont));

// 4. a NEW tab (phone scanning the label): login with ?next, then Asset 360
await sleep(3500);
const anon = await newCtx();
const ph = await anon.newPage(); watch(ph, "phone");
const q0 = await hardLoad(ph, "/assets/1", "qr_new_tab_login", "");
const nextOk = /\/login\?next=%2Fassets%2F1/.test(q0.url);
await fillLogin(ph, "SECHO");
const landed = await ph.getByText("CKSPL/ITFA-SPL/0001").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
await ph.screenshot({ path: `${SHOTS}/qr_new_tab_after_login.png` });
C.add("GT-306", "4", "QR link in a NEW tab / no session: /assets/1", "login screen with next=/assets/1, after sign-in Asset 360 of asset 1", `first=${new URL(q0.url).pathname + new URL(q0.url).search} jsonError=${q0.jsonError} afterLogin=${new URL(ph.url()).pathname} codeVisible=${landed}`,
  nextOk && !q0.jsonError && new URL(ph.url()).pathname === "/assets/1" && landed);
await cspOf(ph, "phone");
await anon.close();
await ctx.close();

// 5. operator persona in the browser
await sleep(3500);
const octx = await newCtx();
const op = await octx.newPage(); watch(op, "secopit");
await op.goto(B + "/login");
await fillLogin(op, "SECOPIT");
const o1 = await hardLoad(op, `/assets/${ids.newLaptop}`, "op_cold_assets_newlaptop", "GTSERIAL0001");
C.add("GT-331", "4", `operator SECOPIT: COLD load /assets/${ids.newLaptop}`, "Asset 360 renders", `${o1.status} found=${o1.found} atLogin=${o1.atLogin}`, o1.status === 200 && o1.found);
const o2 = await hardLoad(op, "/assets/9", "op_cold_assets_9_other_company", "");
C.add("GT-332", "4", "operator SECOPIT: COLD load /assets/9 (CKVPL asset)", "no asset data shown (scope), no JSON page", `${o2.status} showsCode=${o2.body.includes("CKVPL/ITFA-VPL/0001")} jsonError=${o2.jsonError} atLogin=${o2.atLogin}`,
  o2.status === 200 && !o2.body.includes("CKVPL/ITFA-VPL/0001") && !o2.jsonError && !o2.atLogin);
const o3 = await hardLoad(op, "/assets", "op_assets_list", "CKSPL/ITFA-SPL/0001");
C.add("GT-335", "4", "operator SECOPIT: asset register", "renders own-scope assets", `${o3.status} found=${o3.found} showsCKVPL=${o3.body.includes("CKVPL/")}`, o3.status === 200 && o3.found && !o3.body.includes("CKVPL/"));
await octx.close();
await browser.close();

const google = external.filter((u) => /googleapis|gstatic/i.test(u));
C.add("GT-333", "4", "requests to Google font hosts / any external host (all screens)", "0 / 0", `${google.length} / ${external.length}`, google.length === 0 && external.length === 0);
C.add("GT-334", "4", "CSP violations (all screens)", "0", `${csp.length} ${csp.slice(0, 5).join(" | ")}`, csp.length === 0);
C.add("GT-336", "4", "API 5xx answers seen by the browser (all screens)", "0", `${apiFail.length} ${apiFail.slice(0, 3).join(" | ")}`, apiFail.length === 0);
fs.writeFileSync(`${GATE}/out/step4c_browser_raw.txt`, [`external: ${JSON.stringify(external)}`, `csp: ${JSON.stringify(csp)}`, `api5xx: ${JSON.stringify(apiFail)}`, `console errors: ${JSON.stringify(consoleErr, null, 1)}`, `fonts: ${JSON.stringify([...new Set(fontReq)])}`].join("\n") + "\n");
console.log("console errors:", consoleErr.length, consoleErr.slice(0, 8));
C.save();
