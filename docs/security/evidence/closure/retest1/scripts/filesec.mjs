// CL1 Item 6: file/document security on the LIVE stack. Upload spoof/polyglot/oversize files (as SECHO) and
// test download authorization across personas. Created docs are tagged CL1- and their ids recorded for cleanup.
import fs from 'node:fs';
const API = 'http://127.0.0.1:8200';
const DIR = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/cl1';
const PW = 'Sec#Test2026ok';
const SECHO = fs.readFileSync(`${DIR}/secho.tok`, 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const created = [];
const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };

async function login(id) {
  await sleep(7000);
  let r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_id: id, password: PW }) });
  if (r.status === 429) { await sleep(31000); r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_id: id, password: PW }) }); }
  const b = await r.json(); return b.access_token;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-1.4\n');
function cat(...parts) { return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))); }

async function upload(token, assetId, filename, contentBuf, docType = 'invoice') {
  const fd = new FormData();
  fd.append('doc_type', docType);
  fd.append('file', new Blob([contentBuf], { type: 'application/octet-stream' }), filename);
  const r = await fetch(`${API}/api/assets/${assetId}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  let b = null; try { b = await r.json(); } catch {}
  if (r.status === 201 && b?.id) created.push(b.id);
  return { status: r.status, id: b?.id, detail: (b?.detail || (b?.errors && JSON.stringify(b.errors)) || '').toString().slice(0, 90) };
}

async function download(token, docId) {
  const r = await fetch(`${API}/api/documents/${docId}/download`, { headers: { Authorization: `Bearer ${token}` } });
  await r.arrayBuffer();
  return { status: r.status, ct: r.headers.get('content-type'), cd: r.headers.get('content-disposition'), nosniff: r.headers.get('x-content-type-options') };
}

async function main() {
  const SECOPIT = await login('SECOPIT');
  const SECOPNIT = await login('SECOPNIT');
  const SECSELF = await login('SECSELF');
  const SECOTHER = await login('SECOTHER');
  log({ step: 'logins', SECOPIT: !!SECOPIT, SECOPNIT: !!SECOPNIT, SECSELF: !!SECSELF, SECOTHER: !!SECOTHER });

  // ---- upload attacks to asset 1 (CKSPL IT) as SECHO ----
  log({ case: 'ext-spoof-html', ...(await upload(SECHO, 1, 'CL1_evil.html', cat('<script>alert(1)</script>'))) });
  log({ case: 'ext-spoof-exe', ...(await upload(SECHO, 1, 'CL1_payload.exe', cat('MZ\x90\x00'))) });
  log({ case: 'double-ext-pdf.exe', ...(await upload(SECHO, 1, 'CL1_invoice.pdf.exe', cat(PDF, 'x'))) });
  log({ case: 'mime-spoof-pdf+html(accepted?)', ...(await upload(SECHO, 1, 'CL1_spoof.pdf', cat(PDF, '<html><script>alert(1)</script></html>'))) });
  log({ case: 'mime-spoof-png+script(accepted?)', ...(await upload(SECHO, 1, 'CL1_spoof.png', cat(PNG, '<script>alert(1)</script>'))) });
  log({ case: 'polyglot-gif-pdf-named.pdf', ...(await upload(SECHO, 1, 'CL1_poly.pdf', cat('GIF89a', PDF, 'junk'))) });
  log({ case: 'png-named-but-not-png', ...(await upload(SECHO, 1, 'CL1_fake.png', cat('not-a-png-at-all'))) });
  log({ case: 'double-ext-exe.pdf(real pdf)', ...(await upload(SECHO, 1, 'CL1_invoice.exe.pdf', cat(PDF, 'body'))) });
  log({ case: 'reserved-win-CON.pdf', ...(await upload(SECHO, 1, 'CON.pdf', cat(PDF, 'body'))) });
  log({ case: 'traversal-in-filename.pdf', ...(await upload(SECHO, 1, '../../../../etc/passwd.pdf', cat(PDF, 'body'))) });
  log({ case: 'empty-pdf', ...(await upload(SECHO, 1, 'CL1_empty.pdf', Buffer.alloc(0))) });
  log({ case: 'legit-real-pdf', ...(await upload(SECHO, 1, 'CL1_real.pdf', cat(PDF, 'hello world\n%%EOF'))) });
  // oversize document ~11 MB
  log({ case: 'oversize-doc-11MB', ...(await upload(SECHO, 1, 'CL1_big.pdf', cat(PDF, Buffer.alloc(11 * 1024 * 1024, 0x61)))) });

  // oversize import ~15.5 MB (over the 15 MB reader cap, under the 16 MB body cap)
  {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.alloc(Math.floor(15.5 * 1024 * 1024), 0x61)], { type: 'application/octet-stream' }), 'CL1_big.xlsx');
    const r = await fetch(`${API}/api/imports/assets/preview`, { method: 'POST', headers: { Authorization: `Bearer ${SECHO}` }, body: fd });
    let b = null; try { b = await r.json(); } catch {}
    log({ case: 'oversize-import-15.5MB', status: r.status, detail: (b?.detail || '').toString().slice(0, 90) });
  }

  // ---- download authorization matrix (fixture docs: 1 on asset1 CKSPL, 2 on asset9 CKVPL) ----
  log({ case: 'dl SECSELF->doc1(own asset)', who: 'SECSELF', ...(await download(SECSELF, 1)) });
  log({ case: 'dl SECSELF->doc2(CKVPL)', who: 'SECSELF', ...(await download(SECSELF, 2)) });
  log({ case: 'dl SECOTHER(CKVPL)->doc1(CKSPL)', who: 'SECOTHER', ...(await download(SECOTHER, 1)) });
  log({ case: 'dl SECOPNIT(NonIT)->doc1(IT asset)', who: 'SECOPNIT', ...(await download(SECOPNIT, 1)) });
  log({ case: 'dl SECOPIT(IT)->doc1(IT asset)', who: 'SECOPIT', ...(await download(SECOPIT, 1)) });
  log({ case: 'dl SECHO->doc1', who: 'SECHO', ...(await download(SECHO, 1)) });
  // download one of the accepted spoofs (served safely?)
  const spoof = created[0];
  if (spoof) log({ case: 'dl accepted-spoof (served as?)', docId: spoof, ...(await download(SECHO, spoof)) });

  fs.writeFileSync(`${DIR}/files/filesec_results.json`, JSON.stringify(out, null, 2));
  fs.writeFileSync(`${DIR}/files/created_doc_ids.json`, JSON.stringify(created, null, 2));
  console.log('CREATED DOC IDS:', JSON.stringify(created));
}
await main();
