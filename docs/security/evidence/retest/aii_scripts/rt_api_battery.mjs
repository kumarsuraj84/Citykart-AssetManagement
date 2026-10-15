// INPUT-area live API battery against ckam-sec. Read-only probes + authz checks.
const API = "http://127.0.0.1:8200";
const WEB = "http://localhost:3411";
const PW = "Sec#Test2026ok";
const results = [];
function rec(id, cwe, cas, expected, actual, result, ev="") {
  results.push({id, area:"INPUT", cwe, case:cas, expected, actual, result, evidence_ref:ev});
  console.log(`${result.padEnd(4)} ${id}  ${cas}  => ${actual}`);
}
async function login(c){ const s = await (await import('./lib.mjs')).session(c); return s.access; }
function hdr(t){return {Authorization:`Bearer ${t}`};}
async function timed(url, opts){const t0=Date.now(); const r=await fetch(url,opts); const body=await r.text(); return {status:r.status, ms:Date.now()-t0, body, len:body.length, headers:r.headers};}

const tok = {};
for (const c of ["SECHO","SECOTHER","SECSELF","SECVIEW","SECOPIT"]) tok[c]=await login(c);
console.log("tokens ok\n");

// ---------- SQLi: universal asset search q param ----------
const sqlQ = [
  ["IN-T001","89","q quote","'"],
  ["IN-T002","89","q boolean OR","' OR '1'='1"],
  ["IN-T003","89","q comment","test'--"],
  ["IN-T004","89","q stacked pg_sleep","x'; select pg_sleep(3)--"],
  ["IN-T005","89","q union","' UNION SELECT NULL--"],
  ["IN-T006","89","q wildcard pct","%"],
  ["IN-T007","89","q wildcard underscore","_"],
  ["IN-T008","89","q backslash","\\"],
];
// baseline count for a benign unique term
const base = await timed(`${API}/api/assets?q=${encodeURIComponent("SECSPLLAP0001")}&limit=100`, {headers:hdr(tok.SECHO)});
let baseTotal = base.status===200 ? (JSON.parse(base.body).total ?? JSON.parse(base.body).items?.length) : null;
rec("IN-T000","89","baseline exact search returns 1","1 row","total="+baseTotal, baseTotal===1?"INFO":"INFO");
for (const [id,cwe,cas,p] of sqlQ) {
  const r = await timed(`${API}/api/assets?q=${encodeURIComponent(p)}&limit=200`, {headers:hdr(tok.SECHO)});
  let total = null; try{total=JSON.parse(r.body).total;}catch{}
  const slept = r.ms > 2500;
  const ok = r.status!==500 && !slept;
  rec(id, cwe, cas, "no 500, no timed sleep, literal match", `status=${r.status} ms=${r.ms} total=${total}`, ok?"PASS":"FAIL");
}

// ---------- sort_by injection / whitelist ----------
const sorts = [
  ["IN-T010","89","sort_by stacked","id;select pg_sleep(3)"],
  ["IN-T011","89","sort_by raw sql","(select 1)"],
  ["IN-T012","639","sort_by non-whitelisted col deleted_at","deleted_at"],
  ["IN-T013","89","sort_dir injection","asc; drop table asset"],
];
for (const [id,cwe,cas,p] of sorts) {
  const r = await timed(`${API}/api/assets?sort_by=${encodeURIComponent(p)}&limit=10`, {headers:hdr(tok.SECHO)});
  const ok = r.status!==500 && r.ms<2500;
  rec(id, cwe, cas, "ignored/validated, no 500, no sleep", `status=${r.status} ms=${r.ms}`, ok?"PASS":"FAIL");
}

// ---------- numeric-context + paging bounds ----------
const nums = [
  ["IN-T020","89","category_id OR injection","category_id=1 OR 1=1"],
  ["IN-T021","89","category_id quote","category_id='"],
  ["IN-T022","20","limit negative","limit=-1"],
  ["IN-T023","20","limit huge","limit=999999"],
  ["IN-T024","89","status injection","status=IN_STOCK' OR '1'='1"],
  ["IN-T025","89","company_id injection","company_id=1;select pg_sleep(3)"],
];
for (const [id,cwe,cas,qs] of nums) {
  const r = await timed(`${API}/api/assets?${qs.split('=').map(encodeURIComponent).join('=')}&limit=10`, {headers:hdr(tok.SECHO)});
  const ok = r.status!==500 && r.ms<2500;
  rec(id, cwe, cas, "422/400 or empty, no 500, no sleep", `status=${r.status} ms=${r.ms}`, ok?"PASS":"FAIL");
}

// ---------- other search endpoints: vendors, items, people, pick, logs ----------
const others = [
  ["IN-T030","89","vendors list q boolean",`${API}/api/masters/vendors?q=`+encodeURIComponent("' OR '1'='1"),"SECHO"],
  ["IN-T031","89","vendors list q sleep",`${API}/api/masters/vendors?q=`+encodeURIComponent("x';select pg_sleep(3)--"),"SECHO"],
  ["IN-T032","89","items q boolean",`${API}/api/items?q=`+encodeURIComponent("' OR '1'='1"),"SECHO"],
  ["IN-T033","89","items q sleep",`${API}/api/items?q=`+encodeURIComponent("x';select pg_sleep(3)--"),"SECHO"],
  ["IN-T034","89","assets/pick q injection",`${API}/api/assets/pick?q=`+encodeURIComponent("' OR '1'='1"),"SECOPIT"],
  ["IN-T035","89","purchase-orders q injection",`${API}/api/purchase-orders?q=`+encodeURIComponent("x';select pg_sleep(3)--"),"SECHO"],
  ["IN-T036","89","admin logs audit q sleep",`${API}/api/admin/logs/audit?q=`+encodeURIComponent("x';select pg_sleep(3)--"),"SECHO"],
  ["IN-T037","89","admin logs errors level inj",`${API}/api/admin/logs/errors?level=`+encodeURIComponent("ERROR';select pg_sleep(3)--"),"SECHO"],
  ["IN-T038","89","admin logs audit from inj",`${API}/api/admin/logs/audit?from=`+encodeURIComponent("2026-01-01';select pg_sleep(3)--"),"SECHO"],
  ["IN-T039","89","admin logs group by",`${API}/api/admin/logs/errors?group=true&q=`+encodeURIComponent("' OR 1=1--"),"SECHO"],
];
for (const [id,cwe,cas,url,who] of others) {
  const r = await timed(url, {headers:hdr(tok[who])});
  const ok = r.status!==500 && r.ms<2500;
  rec(id,cwe,cas,"no 500, no sleep", `status=${r.status} ms=${r.ms}`, ok?"PASS":"FAIL", r.status>=500?r.body.slice(0,200):"");
}

// ---------- document download authz (cross-company) ----------
// doc 1 is on asset 1 (CKSPL). SECOTHER is CKVPL operator -> must NOT get it.
{
  const r = await timed(`${API}/api/documents/1/download`, {headers:hdr(tok.SECOTHER)});
  rec("IN-T050","639/285","CKVPL operator downloads CKSPL doc 1","404 (out of scope)", `status=${r.status}`, r.status===404?"PASS":"FAIL", r.status===200?"LEAK":"");
}
// SECSELF holds asset 1 -> may read its own doc 1
{
  const r = await timed(`${API}/api/documents/1/download`, {headers:hdr(tok.SECSELF)});
  rec("IN-T051","285","SELF_SERVICE holder downloads own doc 1","200 + attachment/nosniff", `status=${r.status} cd=${r.headers.get('content-disposition')} xcto=${r.headers.get('x-content-type-options')}`, r.status===200?"INFO":"INFO");
}
// doc 2 is on asset 9 (CKVPL) -> SECSELF (CKSPL self) must NOT get it
{
  const r = await timed(`${API}/api/documents/2/download`, {headers:hdr(tok.SECSELF)});
  rec("IN-T052","639","CKSPL self downloads CKVPL doc 2","404", `status=${r.status}`, r.status===404?"PASS":"FAIL");
}

// ---------- static asset path traversal on API ----------
for (const [id,p] of [["IN-T060","../../../../etc/passwd"],["IN-T061","..%2f..%2f..%2fetc%2fpasswd"],["IN-T062","....//....//etc/passwd"]]) {
  const r = await timed(`${API}/assets/${p}`, {});
  const leaked = /root:.*:0:0:/.test(r.body);
  rec(id,"22",`static /assets traversal ${p}`,"404/no file content", `status=${r.status} leaked=${leaked}`, leaked?"FAIL":"PASS", leaked?r.body.slice(0,120):"");
}

// ---------- sensitive-data exposure ----------
// password hash / secrets in list responses
async function checkLeak(id, url, who, cas) {
  const r = await timed(url, {headers:hdr(tok[who])});
  const bad = /password_hash|hashed_password|refresh_token|jwt_secret|"secret"|po_source_password/i.test(r.body);
  rec(id,"200/213",cas, "no password_hash/secret fields", `status=${r.status} leak=${bad}`, r.status>=200&&r.status<300 ? (bad?"FAIL":"PASS") : "INFO", bad?r.body.slice(0,200):"");
  return r;
}
await checkLeak("IN-T070",`${API}/api/people/employees?limit=50`,"SECHO","employees list secret leak (admin)");
await checkLeak("IN-T071",`${API}/api/auth/capabilities`,"SECSELF","capabilities secret leak (self)");
await checkLeak("IN-T072",`${API}/api/assets/1`,"SECSELF","asset detail secret leak");
// self-service reading other people's list?
{
  const r = await timed(`${API}/api/people/employees?limit=50`, {headers:hdr(tok.SECSELF)});
  rec("IN-T073","285","SELF_SERVICE lists all employees","403 (not allowed)", `status=${r.status}`, r.status===403?"PASS":(r.status<300?"FAIL":"INFO"));
}

const fs = await import('node:fs');
fs.writeFileSync("C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/rt_aii/battery_results.json", JSON.stringify(results,null,2));
console.log("\nwrote "+results.length+" rows");
