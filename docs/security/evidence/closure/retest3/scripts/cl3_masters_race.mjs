// CL3-SE-N01: category / sub-category one-active-name rule under concurrency, against the LIVE ckam-sec API.
// Bounded (<=20 per burst) on OUR OWN local test stack. Expect exactly ONE active row per (name, work-area) and
// per (name, category); losers 422 with the plain message; same name in the OTHER work area / another category
// allowed; rename onto an existing name refused. As SECHO (head-office) and SECFANIT (NON_IT-limited Full Admin).
// Cleans up (soft-deactivate) everything it creates.
import fs from 'node:fs';
const API = 'http://127.0.0.1:8200';
const DIR = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/cl3';
const SECHO = fs.readFileSync(`${DIR}/secho.tok`, 'utf8').trim();
const SECFANIT = fs.readFileSync(`${DIR}/secfanit.tok`, 'utf8').trim();
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const out = [];
const created = { categories: [], subcategories: [] };

async function post(kind, body, tok) {
  const r = await fetch(`${API}/api/masters/${kind}`, { method: 'POST', headers: H(tok), body: JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, id: b?.id, detail: (b?.detail || '').toString().slice(0, 100) };
}
async function put(kind, id, body, tok) {
  const r = await fetch(`${API}/api/masters/${kind}/${id}`, { method: 'PUT', headers: H(tok), body: JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, detail: (b?.detail || '').toString().slice(0, 100) };
}
const dist = (rs) => rs.reduce((d, x) => ((d[x.status] = (d[x.status] || 0) + 1), d), {});

async function burst(kind, bodies, label, tok) {
  const rs = await Promise.all(bodies.map((b) => post(kind, b, tok)));
  rs.forEach((x) => { if (x.status === 201 && x.id) created[kind].push(x.id); });
  const row = { label, kind, n: bodies.length, dist: dist(rs), created201: rs.filter((x) => x.status === 201).length,
    dup422: rs.filter((x) => x.status === 422).length, err5xx: rs.filter((x) => x.status >= 500).length,
    sampleDup: (rs.find((x) => x.status === 422) || {}).detail || '' };
  out.push(row); console.log(JSON.stringify(row));
  return rs;
}

async function main() {
  const S = Date.now().toString().slice(-6);
  // 1. SECHO: 20 parallel creates of ONE category name in work area IT
  await burst('categories', Array.from({ length: 20 }, () => ({ name: `CL3 Cat A ${S}`, asset_domain: 'IT' })),
    'secho-cat-IT-identical-20', SECHO);
  // 2. SECHO: case/space variants of ONE name in parallel (IT)
  const variants = [`CL3 Cat B ${S}`, `CL3 CAT B ${S}`, `cl3 cat b ${S}`, `CL3 Cat B ${S} `, ` CL3 Cat B ${S}`, `CL3  Cat B ${S}`];
  await burst('categories', variants.map((v) => ({ name: v, asset_domain: 'IT' })), 'secho-cat-IT-case-ws-variants', SECHO);
  // 3. SAME name as (1) in the OTHER work area NON_IT -> allowed (one row)
  await burst('categories', Array.from({ length: 5 }, () => ({ name: `CL3 Cat A ${S}`, asset_domain: 'NON_IT' })),
    'secho-cat-NONIT-sameName-otherArea', SECHO);
  // 4. SECFANIT (NON_IT-limited admin): 20 parallel creates of ONE NON_IT category name
  await burst('categories', Array.from({ length: 20 }, () => ({ name: `CL3 Cat C ${S}`, asset_domain: 'NON_IT' })),
    'secfanit-cat-NONIT-identical-20', SECFANIT);
  // 4b. SECFANIT tries an IT category (outside its work area) -> expect 403, no row
  await burst('categories', [{ name: `CL3 Cat D ${S}`, asset_domain: 'IT' }], 'secfanit-cat-IT-forbidden', SECFANIT);

  // 5. Sub-categories: make a parent IT category, then 20 parallel of ONE subcat name under it
  const parent = await post('categories', { name: `CL3 SubParent ${S}`, asset_domain: 'IT' }, SECHO);
  if (parent.status === 201) created.categories.push(parent.id);
  await burst('subcategories', Array.from({ length: 20 }, () => ({ name: `CL3 Sub A ${S}`, category_id: parent.id })),
    'secho-subcat-identical-20', SECHO);
  // 5b. SAME subcat name under a DIFFERENT category -> allowed
  const parent2 = await post('categories', { name: `CL3 SubParent2 ${S}`, asset_domain: 'IT' }, SECHO);
  if (parent2.status === 201) created.categories.push(parent2.id);
  await burst('subcategories', [{ name: `CL3 Sub A ${S}`, category_id: parent2.id }], 'secho-subcat-sameName-otherCategory', SECHO);

  // 6. rename/move onto an existing name refused: take the single active 'CL3 Cat A' (IT) and try to rename
  //    a fresh IT category onto its name.
  const other = await post('categories', { name: `CL3 Cat E ${S}`, asset_domain: 'IT' }, SECHO);
  if (other.status === 201) created.categories.push(other.id);
  const rn = await put('categories', other.id, { name: `CL3 Cat A ${S}` }, SECHO); // onto the existing IT name
  out.push({ label: 'secho-rename-onto-existing-name', put_status: rn.status, detail: rn.detail });
  console.log(JSON.stringify({ label: 'secho-rename-onto-existing-name', put_status: rn.status, detail: rn.detail }));
  // 6b. rename onto a name that only exists in the OTHER area -> allowed
  const rn2 = await put('categories', other.id, { name: `CL3 Cat C ${S}` }, SECHO); // C only exists as NON_IT
  out.push({ label: 'secho-rename-onto-othername-otherarea-allowed', put_status: rn2.status, detail: rn2.detail });
  console.log(JSON.stringify({ label: 'secho-rename-onto-othername-otherarea-allowed', put_status: rn2.status, detail: rn2.detail }));

  fs.writeFileSync(`${DIR}/masters_race_results.json`, JSON.stringify(out, null, 2));
  fs.writeFileSync(`${DIR}/masters_created_ids.json`, JSON.stringify(created, null, 2));
  console.log('CREATED categories:', created.categories.length, 'subcategories:', created.subcategories.length);
  console.log('NAME_STAMP', S);
}
await main();
