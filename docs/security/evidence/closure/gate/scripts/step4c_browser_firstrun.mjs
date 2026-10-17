// GT step 4c: the PACKAGE's frontend in a real browser (Playwright Chromium) on 127.0.0.1:4111:
// sign-in through the login page, COLD loads of /assets/<id> (the QR deep link) and /assets/new, main screens,
// fonts (0 requests to Google hosts) and CSP violations (0).
import fs from "node:fs";
import { requireFE, Cases, GATE, PW, sleep } from "./lib.mjs";
const { chromium } = requireFE("@playwright/test");
const B = "http://127.0.0.1:4111";
const C = new Cases(`${GATE}/out/cases_step4c.csv`);
const SHOTS = `${GATE}/out/shots`;
fs.mkdirSync(SHOTS, { recursive: true });
const ids = JSON.parse(fs.readFileSync(`${GATE}/out/new_ids.json`, "utf8"));
const browser = await chromium.launch();
const external = [], csp = [], consoleErr = [], fontReq = [];

async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  await ctx.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  ctx.on("request", (r) => {
    const u = new URL(r.url());
    if (!["127.0.0.1"].includes(u.hostname) && !u.protocol.startsWith("blob") && !u.protocol.startsWith("data")) external.push(r.url());
    if (/\.woff2?$/.test(u.pathname)) fontReq.push(u.pathname);
  });
  return ctx;
}
function watch(page, label) {
  page.on("console", (m) => { if (m.type() === "error") consoleErr.push(`${label}: ${m.text().slice(0, 200)}`); });
}
async function cspOf(page, label) {
  const v = await page.evaluate(() => window.__csp || []).catch(() => []);
  for (const x of v) csp.push(`${label}: ${x}`);
}
async function signIn(ctx, code) {
  const page = await ctx.newPage(); watch(page, "login-" + code);
  await page.goto(B + "/login");
  await page.getByPlaceholder("Employee Code or Email").fill(code);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await cspOf(page, "login-" + code);
  return page;
}
async function coldOpen(ctx, path, label, expectText) {
  const page = await ctx.newPage(); watch(page, label);
  const resp = await page.goto(B + path, { waitUntil: "load" });
  const status = resp?.status();
  const ctype = resp?.headers()["content-type"];
  let found = false;
  if (expectText) found = await page.getByText(expectText, { exact: false }).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForLoadState("networkidle").catch(() => {});
  const body = await page.locator("body").innerText().catch(() => "");
  const jsonError = /^\s*\{"detail"/.test(body) || body.includes("request_id");
  await page.screenshot({ path: `${SHOTS}/${label}.png` });
  await cspOf(page, label);
  return { page, status, ctype, found, jsonError, body };
}

// 1. head office sign-in
await sleep(3500);
const ctx = await newCtx();
const home = await signIn(ctx, "SECHO");
C.add("GT-300", "4", "browser sign-in SECHO via the login page", "leaves /login, app loads", `url=${new URL(home.url()).pathname}`, !new URL(home.url()).pathname.startsWith("/login"));
await home.screenshot({ path: `${SHOTS}/home_secho.png` });

// 2. cold deep links (new tab; the refresh cookie is the only session carrier, like a phone opening a label link)
const a1 = await coldOpen(ctx, "/assets/1", "cold_assets_1", "CKSPL/ITFA-SPL/0001");
C.add("GT-301", "4", "COLD load /assets/1 (Asset 360 QR deep link) signed in as SECHO", "200 text/html shell, Asset 360 renders with the asset code, no JSON error",
  `${a1.status} ${a1.ctype} codeVisible=${a1.found} jsonError=${a1.jsonError}`, a1.status === 200 && a1.found && !a1.jsonError);
const a2 = await coldOpen(ctx, `/assets/${ids.newLaptop}`, "cold_assets_newlaptop", "GTSERIAL0001");
C.add("GT-302", "4", `COLD load /assets/${ids.newLaptop} (asset received after the migration)`, "Asset 360 renders (serial visible)", `${a2.status} serialVisible=${a2.found} jsonError=${a2.jsonError}`, a2.status === 200 && a2.found && !a2.jsonError);
const an = await coldOpen(ctx, "/assets/new", "cold_assets_new", "");
const anOk = !an.jsonError && an.body.length > 50;
C.add("GT-303", "4", "COLD load /assets/new", "200 shell, Add Assets screen renders, no JSON error", `${an.status} ${an.ctype} jsonError=${an.jsonError} text="${an.body.slice(0, 120).replace(/\s+/g, " ")}"`, an.status === 200 && anOk);
const qrUrl = "http://127.0.0.1:4111/assets/1"; // what qr.png of asset 1 encodes (qrverify.py)
const aq = await coldOpen(ctx, new URL(qrUrl).pathname, "cold_qr_url", "CKSPL/ITFA-SPL/0001");
C.add("GT-304", "4", `open the URL encoded in qr.png (${qrUrl}) directly`, "Asset 360 of asset 1", `${aq.status} codeVisible=${aq.found}`, aq.status === 200 && aq.found);
const a404 = await coldOpen(ctx, "/assets/99999", "cold_assets_missing", "");
C.add("GT-305", "4", "COLD load /assets/99999 (no such asset)", "app shell with a friendly not-found message, not a raw JSON page", `${a404.status} jsonError=${a404.jsonError} text="${a404.body.slice(0, 160).replace(/\s+/g, " ")}"`, a404.status === 200 && !a404.jsonError);

// 3. signed-out cold load of the QR link: the login screen, not an error
const anon = await newCtx();
const ql = await coldOpen(anon, "/assets/1", "cold_qr_signed_out", "");
const atLogin = new URL(ql.page.url()).pathname.startsWith("/login") || /sign in/i.test(ql.body);
C.add("GT-306", "4", "COLD load /assets/1 with NO session (a phone scanning a label)", "login screen (then the asset), no JSON error", `${ql.status} url=${new URL(ql.page.url()).pathname + new URL(ql.page.url()).search} login=${atLogin} jsonError=${ql.jsonError}`, ql.status === 200 && atLogin && !ql.jsonError);
await anon.close();

// 4. main screens
const screens = [["/dashboard", "Dashboard"], ["/assets", "CKSPL/"], ["/purchase-orders", "SEC-SPL-PO-002"], ["/purchase-orders/2", "SEC-SPL-PO-002"], ["/receive", ""], ["/asset-movement", ""],
  ["/reports", ""], ["/print-labels", ""], ["/settings/system/logs", ""], ["/settings/system/diagnostics", "eed3de1"], ["/settings/vendors", "GT Gate Vendor"]];
let n = 310;
for (const [p, t] of screens) {
  const label = "screen" + p.replace(/\//g, "_");
  const r = await coldOpen(ctx, p, label, t || undefined);
  C.add(`GT-${n++}`, "4", `screen ${p} (cold load)`, "renders" + (t ? ` with "${t}"` : "") + ", no JSON error", `${r.status} found=${t ? r.found : "n/a"} jsonError=${r.jsonError}`, r.status === 200 && (!t || r.found) && !r.jsonError);
  await r.page.close();
}
// fonts actually applied
const fp = await ctx.newPage();
await fp.goto(B + "/dashboard"); await fp.waitForLoadState("networkidle");
const fontsOk = await fp.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight); });
const bodyFont = await fp.evaluate(() => getComputedStyle(document.body).fontFamily);
C.add("GT-330", "4", "self-hosted fonts load", "Inter loaded from /assets, body font Inter", `loaded=${JSON.stringify(fontsOk)} body=${bodyFont} fontRequests=${[...new Set(fontReq)].length}`, fontsOk.some((f) => /Inter/i.test(f)) && /Inter/i.test(bodyFont));
await ctx.close();

// 5. operator persona in the browser
await sleep(3500);
const octx = await newCtx();
await signIn(octx, "SECOPIT");
const o1 = await coldOpen(octx, `/assets/${ids.newLaptop}`, "op_cold_assets_newlaptop", "GTSERIAL0001");
C.add("GT-331", "4", `operator SECOPIT: COLD load /assets/${ids.newLaptop}`, "Asset 360 renders", `${o1.status} found=${o1.found}`, o1.status === 200 && o1.found);
const o2 = await coldOpen(octx, "/assets/9", "op_cold_assets_9_other_company", "");
C.add("GT-332", "4", "operator SECOPIT: COLD load /assets/9 (CKVPL asset)", "no asset data shown (scope), no JSON page", `${o2.status} showsCode=${o2.body.includes("CKVPL/ITFA-VPL/0001")} jsonError=${o2.jsonError}`, o2.status === 200 && !o2.body.includes("CKVPL/ITFA-VPL/0001") && !o2.jsonError);
await octx.close();
await browser.close();

const google = external.filter((u) => /googleapis|gstatic/i.test(u));
C.add("GT-333", "4", "requests to Google font hosts (all screens)", "0", `${google.length}; other external hosts=${external.length}`, google.length === 0 && external.length === 0);
C.add("GT-334", "4", "CSP violations (all screens)", "0", `${csp.length} ${csp.slice(0, 5).join(" | ")}`, csp.length === 0);
fs.writeFileSync(`${GATE}/out/step4c_browser_raw.txt`, [`external: ${JSON.stringify(external)}`, `csp: ${JSON.stringify(csp)}`, `console errors: ${JSON.stringify(consoleErr, null, 1)}`, `fonts: ${JSON.stringify([...new Set(fontReq)])}`].join("\n") + "\n");
console.log("console errors:", consoleErr.length, consoleErr.slice(0, 8));
C.save();
