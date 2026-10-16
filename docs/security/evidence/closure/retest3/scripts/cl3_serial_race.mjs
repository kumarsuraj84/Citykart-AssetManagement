// CL3-SE-N03: same-serial race on the LIVE ckam-sec API (single add path, serial Item 1 / CKSPL).
// Bounded (<=20 per burst) on OUR OWN local test stack. Expect exactly ONE asset per serial; losers get the
// plain serial-specific 422 (not a bare 409/500, no SQL text). Also case/whitespace variants ABC-1 / abc-1 / etc.
import fs from 'node:fs';
const API = 'http://127.0.0.1:8200';
const DIR = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/cl3';
const TOK = fs.readFileSync(`${DIR}/secho.tok`, 'utf8').trim();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK}` };
const S = Date.now().toString().slice(-6);
const out = [];
const createdIds = [];

function body(serial) {
  return { company_id: 1, cost_center_id: 1, item_id: 1, vendor_id: 1, initial_asset_user_id: 3,
    serial_number: serial, description: `CL3 serial race ${S}`, invoice_date: '2026-02-01' };
}
async function create(serial) {
  const r = await fetch(`${API}/api/assets`, { method: 'POST', headers: H, body: JSON.stringify(body(serial)) });
  let b = null; try { b = await r.json(); } catch {}
  const id = Array.isArray(b) ? b[0]?.id : b?.id;
  return { status: r.status, id, detail: (b?.detail || '').toString().slice(0, 140) };
}
const dist = (rs) => rs.reduce((d, x) => ((d[x.status] = (d[x.status] || 0) + 1), d), {});

async function burst(serials, label) {
  const rs = await Promise.all(serials.map((s) => create(s)));
  rs.forEach((x) => { if (x.status === 201 && x.id) createdIds.push(x.id); });
  const bad = rs.filter((x) => x.status !== 201 && x.status !== 422);
  const dupSamples = [...new Set(rs.filter((x) => x.status === 422).map((x) => x.detail))];
  const row = { label, n: serials.length, dist: dist(rs), created201: rs.filter((x) => x.status === 201).length,
    loser422: rs.filter((x) => x.status === 422).length, bare409or5xx: bad.map((x) => x.status), dupSamples };
  out.push(row); console.log(JSON.stringify(row));
}

async function main() {
  // validate the body once
  const v = await create(`CL3-VALIDATE-${S}`);
  if (v.status === 201 && v.id) createdIds.push(v.id);
  console.log(JSON.stringify({ label: 'validate-single', status: v.status, id: v.id, detail: v.detail }));
  // 1. 20 parallel, identical serial
  await burst(Array.from({ length: 20 }, () => `CL3-RACE1-${S}`), 'identical-serial-20');
  // 2. case/whitespace variants of ONE serial in parallel (ux index is lower(trim))
  const base = `CL3-ABC-1-${S}`;
  const variants = [base, base.toLowerCase(), base.toUpperCase(), `${base} `, ` ${base}`, ` ${base.toLowerCase()} `, `${base}`];
  await burst(variants, 'case-ws-variants');
  // 3. another identical burst of 20 to re-confirm under a fresh serial
  await burst(Array.from({ length: 20 }, () => `CL3-RACE2-${S}`), 'identical-serial-20b');

  fs.writeFileSync(`${DIR}/serial_race_results.json`, JSON.stringify(out, null, 2));
  fs.writeFileSync(`${DIR}/serial_created_ids.json`, JSON.stringify(createdIds, null, 2));
  console.log('CREATED assets:', createdIds.length, 'STAMP', S);
}
await main();
