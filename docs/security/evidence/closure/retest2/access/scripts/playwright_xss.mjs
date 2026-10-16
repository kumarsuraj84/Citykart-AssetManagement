// RETEST2 ACCESS stored-XSS render test. Seed XSS payloads into vendor/item/employee NAMES and an asset
// description via the API (as SECHO), then render the real web UI (http://localhost:3411) as SECHO and check
// no payload executes: a successful injection would set window.__xss_cl2. React escapes by default; we PROVE it.
import { createRequire } from 'node:module';
import { req, tok, getCache } from './lib.mjs';
const require = createRequire('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/frontend/package.json');
const { chromium } = require('@playwright/test');
const WEB = 'http://localhost:3411';

const PAYLOADS = {
  img: 'CL2XSS<img src=x onerror=window.__xss_cl2=1>',
  svg: 'CL2XSS"><svg onload=window.__xss_cl2=2>',
  script: 'CL2XSS<script>window.__xss_cl2=3</script>',
  desc: 'CL2XSS<img src=x onerror=window.__xss_cl2=4>',
};
const secho = await tok('SECHO');
const created = {};

// seed vendor + item + employee + asset
let r = await req('POST','/api/masters/vendors',{ token: secho, body: { name: PAYLOADS.img, company_id: 1 } });
created.vendor = r.status===201 ? r.body.id : null; console.error('vendor', r.status, created.vendor);
r = await req('POST','/api/items',{ token: secho, body: { name: PAYLOADS.svg, category_id: 1, subcategory_id: 1, has_serial: true } });
created.item = r.status===201 ? (r.body.id||r.body.item_id) : null; console.error('item', r.status, created.item, r.status>=300?r.raw.slice(0,120):'');
r = await req('POST','/api/people/employees',{ token: secho, body: { name: PAYLOADS.script, company_id: 1, code: 'CL2XSSEMP', location_id: 1 } });
created.emp = r.status===201 ? r.body.id : null; console.error('emp', r.status, created.emp, r.status>=300?r.raw.slice(0,120):'');
r = await req('POST','/api/assets',{ token: secho, body: { company_id:1, cost_center_id:1, item_id:1, category_id:1, subcategory_id:1, description: PAYLOADS.desc, vendor_id: created.vendor||1, initial_asset_user_id:3, serial_pending:true } });
created.asset = (Array.isArray(r.body)&&r.body[0])?r.body[0].id:(r.body&&r.body.id)||null; console.error('asset', r.status, created.asset, r.status>=300?r.raw.slice(0,120):'');

const browser = await chromium.launch();
const state = { state: { accessToken: secho, role: 'ADMIN', companyId: null, isPrimaryOwner: true, mustChangePassword: false, assetUserId: 2 }, version: 0 };
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addInitScript((s) => { sessionStorage.setItem('ckam-auth', JSON.stringify(s)); }, state);
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(String(e).slice(0,120)));

const results = [];
async function visit(label, path, needle) {
  await page.goto(WEB + path, { waitUntil: 'networkidle' }).catch(()=>{});
  await page.waitForTimeout(1500);
  const xss = await page.evaluate(() => window.__xss_cl2 ?? null);
  const hasText = needle ? await page.evaluate(n => document.body.innerText.includes(n), 'CL2XSS') : false;
  // is the raw payload present as live HTML (img/svg/script element with our marker)?
  const liveEl = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].some(i => (i.getAttribute('src')==='x'));
    const svgload = [...document.querySelectorAll('svg')].some(s => s.hasAttribute('onload'));
    return { badImg: imgs, badSvg: svgload };
  });
  results.push({ label, path, xss_fired: xss, marker_text_visible: hasText, liveEl });
  console.log(label, 'xss=', xss, 'markerVisible=', hasText, 'liveEl=', JSON.stringify(liveEl));
}

await visit('vendors', '/settings/vendors', true);
await visit('items', '/settings/catalogue/items', true);
await visit('employees', '/people/employees', true);
await visit('assets', '/assets?q=CL2XSS', true);
if (created.asset) await visit('asset-detail', `/assets/${created.asset}`, true);

const anyXss = results.some(x => x.xss_fired != null) || await page.evaluate(() => window.__xss_cl2 ?? null);
console.log('\nSUMMARY window.__xss_cl2 ever set:', anyXss, '| pageerrors:', consoleErrors.length);
require('fs').writeFileSync(new URL('../raw/playwright_xss.json', import.meta.url), JSON.stringify({ results, anyXss, created, pageErrors: consoleErrors }, null, 1));

await browser.close();
// cleanup
if (created.asset) await req('DELETE',`/api/assets/${created.asset}`,{ token: secho });
if (created.emp) await req('DELETE',`/api/asset-users/${created.emp}`,{ token: secho });
if (created.vendor) await req('DELETE',`/api/masters/vendors/${created.vendor}`,{ token: secho });
if (created.item) await req('DELETE',`/api/items/${created.item}`,{ token: secho });
console.log('cleanup done');
