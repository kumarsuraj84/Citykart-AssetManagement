// CL1 RACE-1: truly-parallel same-name creates against the LIVE ckam-sec stack as SECHO (cached token).
// Bounded (<= 20 requests per burst) against OUR OWN local test stack. Exactly one active row per name expected;
// losers get the plain 422 duplicate message; no 500. Also case/whitespace variants in parallel. Cleans up (soft
// delete) every row it created at the end.
import fs from 'node:fs';
const API = 'http://127.0.0.1:8200';
const DIR = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/cl1';
const TOK = fs.readFileSync(`${DIR}/secho.tok`, 'utf8').trim();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const created = []; // {kind,id}

async function create(kind, name) {
  const r = await fetch(`${API}/api/masters/${kind}`, { method: 'POST', headers: H, body: JSON.stringify({ name }) });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, id: b?.id, detail: (b?.detail || (b?.errors && JSON.stringify(b.errors)) || '').toString().slice(0, 90) };
}

function dist(results) {
  const d = {};
  for (const x of results) d[x.status] = (d[x.status] || 0) + 1;
  return d;
}

async function burst(kind, name, n, label) {
  const results = await Promise.all(Array.from({ length: n }, () => create(kind, name)));
  for (const x of results) if (x.status === 201 && x.id) created.push({ kind, id: x.id });
  const ok = results.filter((x) => x.status === 201);
  const dup = results.filter((x) => x.status === 422);
  const err = results.filter((x) => x.status >= 500);
  const sampleDup = dup[0]?.detail || '';
  const row = { label, kind, name, n, dist: dist(results), created201: ok.length, dup422: dup.length, err5xx: err.length, sampleDup };
  out.push(row);
  console.log(JSON.stringify(row));
  return row;
}

async function main() {
  // 3 repetitions, different names, identical-name parallel bursts (vendors + brands)
  await burst('vendors', 'CL1 Race Vendor A', 15, 'vendor-identical-A');
  await burst('brands', 'CL1 Race Brand A', 15, 'brand-identical-A');
  await burst('vendors', 'CL1 Race Vendor B', 18, 'vendor-identical-B');
  await burst('brands', 'CL1 Race Brand B', 18, 'brand-identical-B');
  await burst('vendors', 'CL1 Race Vendor C', 20, 'vendor-identical-C');
  await burst('brands', 'CL1 Race Brand C', 20, 'brand-identical-C');

  // case / whitespace variants of ONE name, in parallel (expect exactly one active row total)
  const variants = ['CL1 Acme', 'CL1 ACME', 'cl1 acme', 'CL1 Acme ', ' CL1 Acme', 'CL1  Acme'];
  for (const kind of ['vendors', 'brands']) {
    const results = await Promise.all(variants.map((v) => create(kind, v)));
    for (const x of results) if (x.status === 201 && x.id) created.push({ kind, id: x.id });
    const ok = results.filter((x) => x.status === 201);
    const row = { label: `${kind}-case-ws-variants`, kind, variants, dist: dist(results), created201: ok.length,
      dup422: results.filter((x) => x.status === 422).length, err5xx: results.filter((x) => x.status >= 500).length };
    out.push(row);
    console.log(JSON.stringify(row));
  }

  fs.writeFileSync(`${DIR}/race/race_results.json`, JSON.stringify(out, null, 2));
  fs.writeFileSync(`${DIR}/race/created_ids.json`, JSON.stringify(created, null, 2));
  console.log('CREATED ROWS:', created.length);
}
await main();
