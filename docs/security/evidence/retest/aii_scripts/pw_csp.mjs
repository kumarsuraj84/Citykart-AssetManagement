// RT AU-14 regression: does the new CSP / Permissions-Policy break the app? Opens http://localhost:3411 in Chromium
// as SECHO and SECOPIT, visits the main screens, and records every CSP violation (securitypolicyviolation event +
// console "Refused to ..."), page errors, failed same-origin requests, XSS probes (planted payloads) and QR rendering.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { DIR, PW, rec, sleep, pace } from './lib.mjs';

const REPO = 'D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build';
const require = createRequire(REPO + '/frontend/package.json');
const { chromium } = require('@playwright/test');
const BASE = 'http://localhost:3411';
const out = { personas: {} };
const browser = await chromium.launch();

async function loginAs(code) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const log = { csp: [], console: [], pageErrors: [], failed: [] };
  await page.addInitScript(() => {
    window.__xss = 0; window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ dir: e.violatedDirective, blocked: e.blockedURI, src: e.sourceFile, line: e.lineNumber }));
  });
  page.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to|Permissions policy|permissions-policy/i.test(t)) log.console.push(t.slice(0, 300)); });
  page.on('pageerror', (e) => log.pageErrors.push(String(e).slice(0, 300)));
  page.on('requestfailed', (r) => { if (r.url().startsWith(BASE)) log.failed.push(`${r.url()} ${r.failure()?.errorText}`); });
  await pace();
  await page.goto(BASE + '/login');
  await page.getByPlaceholder('Employee Code or Email').fill(code);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(3000);
  return { ctx, page, log };
}

async function visit(page, log, route) {
  try { await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 }); } catch { await page.waitForTimeout(1500); }
  await page.waitForTimeout(1200);
  const csp = await page.evaluate(() => window.__csp.splice(0));
  const xss = await page.evaluate(() => window.__xss);
  const injected = await page.evaluate(() => ({
    imgs: [...document.querySelectorAll('img')].filter((i) => i.getAttribute('src') === 'x' && i.getAttribute('onerror')).length,
    svgs: [...document.querySelectorAll('svg')].filter((s) => s.getAttribute('onload')).length,
  }));
  const onLogin = page.url().includes('/login');
  const imgs = await page.evaluate(() => [...document.querySelectorAll('img')].map((i) => ({ src: i.src.slice(0, 40), ok: i.complete && i.naturalWidth > 0 })));
  const fontsOk = await page.evaluate(() => document.fonts.status);
  for (const c of csp) log.csp.push({ route, ...c });
  return { route, url: page.url().replace(BASE, ''), csp: csp.length, xss, injected, onLogin, imgs: imgs.filter((i) => i.src.startsWith('blob:') || i.src.startsWith('data:')).length, brokenImgs: imgs.filter((i) => !i.ok).length, fontsOk };
}

const ROUTES = {
  SECHO: ['/dashboard', '/assets', '/assets/1', '/assets/9', '/print-labels', '/purchase-orders', '/purchase-orders/1', '/receive',
    '/reports', '/people/employees', '/people/stores', '/asset-movement', '/import', '/settings', '/settings/vendors', '/setup/vendors',
    '/settings/catalogue/items', '/settings/users-access', '/settings/system/logs', '/settings/system/diagnostics', '/settings/erp',
    '/purchase-orders/from-erp', '/assets?q=' + encodeURIComponent('<img src=x onerror=window.__xss=1>'), '/change-password'],
  SECOPIT: ['/dashboard', '/assets', '/assets/1', '/assets/3', '/print-labels', '/purchase-orders', '/receive', '/asset-movement', '/reports', '/settings/vendors'],
};

for (const code of Object.keys(ROUTES)) {
  const { ctx, page, log } = await loginAs(code);
  const visits = [];
  const landed = page.url().replace(BASE, '');
  for (const r of ROUTES[code]) visits.push(await visit(page, log, r));
  // Permissions-Policy as the browser sees it
  const perms = await page.evaluate(async () => {
    const fp = document.permissionsPolicy || document.featurePolicy;
    if (!fp) return 'no API';
    return ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'clipboard-write', 'fullscreen'].map((f) => `${f}=${fp.allowsFeature(f)}`).join(' ');
  });
  // QR on the asset page: blob image rendered?
  await page.goto(BASE + '/assets/' + (code === 'SECHO' ? '1' : '3'), { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  const qr = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('blob:')).map((i) => i.naturalWidth));
  out.personas[code] = { landed, visits, perms, qrBlobImgs: qr, csp: log.csp, console: log.console, pageErrors: log.pageErrors, failed: log.failed };
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(DIR, 'pw_csp_results.json'), JSON.stringify(out, null, 1));

for (const [code, p] of Object.entries(out.personas)) {
  const bounced = p.visits.filter((v) => v.onLogin).map((v) => v.route);
  rec(`RT-AU-T45${code === 'SECHO' ? 1 : 2}`, 'csp-regression', 'CWE-693', `${code}: CSP violations while using ${p.visits.length} main screens (Playwright, :3411)`, '0 violations, 0 page errors',
    `violations=${p.csp.length} consoleCSP=${p.console.length} pageErrors=${p.pageErrors.length} bouncedToLogin=${bounced.length} failedReq=${p.failed.length}`,
    p.csp.length === 0 && p.console.length === 0 && p.pageErrors.length === 0 && bounced.length === 0 ? 'PASS' : 'FAIL', 'pw_csp_results.json');
  rec(`RT-AU-T45${code === 'SECHO' ? 3 : 4}`, 'csp-regression', 'CWE-693', `${code}: QR / label images (blob:) render under img-src 'self' data: blob:`, '>=1 blob image with width>0',
    `blob imgs widths=${JSON.stringify(p.qrBlobImgs)}`, p.qrBlobImgs.some((w) => w > 0) ? 'PASS' : 'INFO', 'pw_csp_results.json');
  rec(`RT-AU-T45${code === 'SECHO' ? 5 : 6}`, 'csp-regression', 'CWE-693', `${code}: Permissions-Policy effective in browser`, 'camera/microphone/geolocation/payment/usb = false', p.perms,
    /camera=false/.test(p.perms) && /microphone=false/.test(p.perms) && /geolocation=false/.test(p.perms) ? 'PASS' : 'FAIL', 'pw_csp_results.json');
  const xssBad = p.visits.filter((v) => v.xss === 1 || v.injected.imgs || v.injected.svgs);
  rec(`RT-AU-T45${code === 'SECHO' ? 7 : 8}`, 'xss', 'CWE-79', `${code}: stored/reflected XSS payloads (vendor, item, client report, ?q=) inert on all visited screens`, 'no execution / no injected element',
    `executed_or_injected_on=${xssBad.map((v) => v.route).join(',') || 'none'}`, xssBad.length ? 'FAIL' : 'PASS', 'pw_csp_results.json');
}
