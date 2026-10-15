// RETEST IN-03 (document content check + server-derived type on download) and IN-02 (oversize import -> 413).
// Target asset 17 = "RT probe chair" (CKSPL, created by probe_setup.mjs as SECHO). One 16 MB import attempt only.
import { writeFileSync } from 'node:fs';
import { API, tok, req } from './lib.mjs';
const T = await tok('SECHO');
const ASSET = 17;
const results = [], log = [];
let n = 800;
const nid = () => `RT-AC-T${String(n++).padStart(3, '0')}`;
function rec(cwe, cas, expected, actual, pass, ev = '') {
  results.push({ id: nid(), cwe, case: cas, expected, actual, result: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL', ev });
  log.push(`${pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL'} | ${cas} | ${actual}`);
  if (pass === false) console.log('FAIL', cas, actual);
}
async function upload(name, bytes, claimedType, docType = 'invoice') {
  const fd = new FormData();
  fd.append('doc_type', docType);
  fd.append('file', new Blob([bytes], { type: claimedType }), name);
  const r = await fetch(`${API}/api/assets/${ASSET}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${T}` }, body: fd });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, body: j, raw: txt.slice(0, 250) };
}
const html = Buffer.from('<html><body><script>alert(document.domain)</script></body></html>');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');
const polyglot = Buffer.concat([Buffer.from('%PDF-1.4\n'), html]);
const fakeZip = Buffer.concat([Buffer.from('PK\x03\x04', 'binary'), Buffer.alloc(200, 0x41)]);

const BAD = [
  ['invoice.pdf', html, 'application/pdf', 'HTML+script named .pdf'],
  ['photo.png', html, 'image/png', 'HTML+script named .png'],
  ['photo.jpg', Buffer.from('GIF89a<script>alert(1)</script>'), 'image/jpeg', 'GIF/script named .jpg'],
  ['sheet.xlsx', fakeZip, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK header but not an xlsx'],
  ['letter.docx', pdf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'PDF bytes named .docx'],
  ['page.html', html, 'text/html', 'disallowed extension .html'],
  ['image.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/svg+xml', 'disallowed extension .svg'],
];
for (const [name, bytes, ct, what] of BAD) {
  const r = await upload(name, bytes, ct);
  rec('CWE-434', `IN-03 upload ${what} (${name})`, '422 plain message, nothing stored', `${r.status} ${JSON.stringify(r.body?.detail)?.slice(0, 120)}`, r.status === 422);
}
const docs = [];
for (const [name, bytes, ct, what] of [['rt-invoice.pdf', pdf, 'text/html', 'valid PDF, browser CLAIMS text/html'], ['rt-photo.png', png, 'text/html', 'valid PNG, browser CLAIMS text/html']]) {
  const r = await upload(name, bytes, ct, name.endsWith('.png') ? 'photo' : 'invoice');
  rec('CWE-434', `IN-03 upload ${what}`, '201, stored mime = server type', `${r.status} mime_type=${r.body?.mime_type}`, r.status === 201 && /^(application\/pdf|image\/png)$/.test(r.body?.mime_type || ''));
  if (r.body?.id) docs.push([r.body.id, name.endsWith('.png') ? 'image/png' : 'application/pdf']);
}
{ // signature-only check: a PDF header followed by HTML is accepted, but it can only ever be served as a PDF download
  const r = await upload('rt-polyglot.pdf', polyglot, 'text/html');
  rec('CWE-434', 'IN-03 polyglot: "%PDF-" header followed by HTML/script', 'INFO: accepted (signature check) but must download as application/pdf attachment',
    `${r.status} mime_type=${r.body?.mime_type}`, null);
  if (r.body?.id) docs.push([r.body.id, 'application/pdf']);
}
for (const [id, want] of [...docs, [1, 'application/pdf'], [2, 'application/pdf']]) {
  const r = await fetch(`${API}/api/documents/${id}/download`, { headers: { Authorization: `Bearer ${T}` } });
  const ct = r.headers.get('content-type'), cd = r.headers.get('content-disposition'), xo = r.headers.get('x-content-type-options');
  await r.arrayBuffer();
  log.push(`download doc ${id}: ${r.status} content-type=${ct} content-disposition=${cd} nosniff=${xo}`);
  rec('CWE-434', `IN-03 download doc ${id} headers`, `200, ${want}, attachment, nosniff`, `${r.status} ct=${ct} cd=${(cd || '').slice(0, 60)} xcto=${xo}`,
    r.status === 200 && (ct || '').startsWith(want) && /^attachment/i.test(cd || '') && xo === 'nosniff');
}
// Old-style rows: what the DB says vs what is served (doc 1/2 were uploaded by the seeder before the fix)
// ---- IN-02: one 16 MB import preview straight at the API (production has no nginx in front)
{
  const big = Buffer.alloc(16 * 1024 * 1024, 0x41);
  const fd = new FormData();
  fd.append('file', new Blob([big], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'rt-oversize.xlsx');
  const t0 = Date.now();
  const r = await fetch(`${API}/api/imports/assets/preview?mode=add`, { method: 'POST', headers: { Authorization: `Bearer ${T}` }, body: fd });
  const txt = await r.text();
  log.push(`IN-02 16 MB preview: ${r.status} in ${Date.now() - t0} ms: ${txt.slice(0, 200)}`);
  let j = null; try { j = JSON.parse(txt); } catch {}
  rec('CWE-400', 'IN-02 16 MB file to POST /api/imports/assets/preview (API port, one attempt)', '413 with a plain sentence',
    `${r.status} detail=${JSON.stringify(j?.detail)}`, r.status === 413 && typeof j?.detail === 'string' && !/Traceback|openpyxl/i.test(txt));
}
writeFileSync(new URL('./uploads.json', import.meta.url), JSON.stringify(results, null, 1));
writeFileSync(new URL('./uploads_transcript.txt', import.meta.url), log.join('\n'));
console.log('total', results.length, 'FAIL', results.filter(r => r.result === 'FAIL').length);
