import { createRequire } from "node:module";
import fs from "node:fs";
const REPO = "D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build";
const require = createRequire(REPO + "/frontend/package.json");
const { chromium } = require("@playwright/test");
const BASE = "http://localhost:3411";
const PW = "Sec#Test2026ok";
const out = [];
function rec(id, cas, actual, result, ev=""){out.push({id,area:"INPUT",cwe:"79",case:cas,expected:"payload inert (no window.__xss, no injected element)",actual,result,evidence_ref:ev});console.log(`${result.padEnd(4)} ${id} ${cas} => ${actual}`);}

const browser = await chromium.launch();
async function loginAs(code){
  const ctx = await browser.newContext({viewport:{width:1366,height:900}});
  const page = await ctx.newPage();
  await page.addInitScript(()=>{window.__xss=0;});
  await page.goto(BASE+"/login");
  await page.getByPlaceholder("Employee Code or Email").fill(code);
  await page.getByLabel("Password",{exact:true}).fill(PW);
  await page.getByRole("button",{name:/sign in/i}).click();
  await page.waitForTimeout(2500);
  return {ctx,page};
}
async function probe(page, id, cas, url){
  try { await page.goto(BASE+url, {waitUntil:"networkidle", timeout:20000}); } catch { await page.waitForTimeout(1500); }
  await page.waitForTimeout(1500);
  const xss = await page.evaluate(()=>window.__xss);
  // did a real <img onerror> or <svg onload> element from our payload get into the DOM?
  const injected = await page.evaluate(()=>{
    const imgs=[...document.querySelectorAll('img')].filter(i=>i.getAttribute('src')==='x' && i.getAttribute('onerror'));
    const svgs=[...document.querySelectorAll('svg')].filter(s=>s.getAttribute('onload'));
    return {imgs:imgs.length, svgs:svgs.length};
  });
  // is the payload present as escaped text somewhere (good)?
  const asText = await page.evaluate(()=> document.body.innerText.includes('onerror=window.__xss') || document.body.innerText.includes('IN-XSS'));
  const bad = xss===1 || injected.imgs>0 || injected.svgs>0;
  rec(id, cas, `__xss=${xss} injectedImg=${injected.imgs} injectedSvg=${injected.svgs} textPresent=${asText}`, bad?"FAIL":"PASS");
}

const {page} = await loginAs("SECHO");
// confirm logged in
await page.waitForTimeout(500);
rec("IN-T090","login SECHO reached app", page.url(), page.url().includes("/login")?"INFO":"INFO");
await probe(page,"IN-T091","stored XSS vendor name in Vendors master","/settings/vendors");
await probe(page,"IN-T092","stored XSS vendor name in Setup Vendors","/setup/vendors");
await probe(page,"IN-T093","stored XSS item name in Items catalogue","/settings/catalogue/items");
await probe(page,"IN-T094","stored XSS client-report (admin Logs, attacker=SECSELF)","/settings/system/logs");
await probe(page,"IN-T095","reflected XSS asset search q param","/assets?q="+encodeURIComponent("<img src=x onerror=window.__xss=1>"));
await probe(page,"IN-T096","stored XSS vendor in asset register vendor filter","/assets");

fs.writeFileSync("C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/input/xss_results.json", JSON.stringify(out,null,2));
await browser.close();
console.log("\ndone "+out.length);
