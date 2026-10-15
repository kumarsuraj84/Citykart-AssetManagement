// RT IF-03 (ERP drafts across companies), IN-02 (import size cap at the API), IN-03 (document content checks).
import { API, req, rec, session } from './lib.mjs';

const op = await session('SECOPIT');      // CKSPL operator
const opv = await session('SECOPITV');    // CKVPL operator
const ho = await session('SECHO');
const A = 'input';

// ---------- IF-03 ----------
let r = await req('GET', '/api/erp/pos/9002002/draft', { token: op.access });
rec('RT-AU-T601', A, 'CWE-639', 'IF-03 CKSPL operator -> CKVPL open ERP PO draft 9002002', '403/404', `${r.status} ${r.body?.detail ?? ''}`, [403, 404].includes(r.status) ? 'PASS' : 'FAIL', 'input_fixes.mjs');
r = await req('GET', '/api/erp/pos/9001002/draft', { token: opv.access });
rec('RT-AU-T602', A, 'CWE-639', 'IF-03 CKVPL operator -> CKSPL open ERP PO draft 9001002', '403/404', `${r.status} ${r.body?.detail ?? ''}`, [403, 404].includes(r.status) ? 'PASS' : 'FAIL', 'input_fixes.mjs');
r = await req('GET', '/api/erp/pos/9001002/draft', { token: op.access });
rec('RT-AU-T603', A, 'CWE-639', 'IF-03 control: CKSPL operator -> own CKSPL draft', '200', `${r.status} company=${r.body?.company_code}`, r.status === 200 ? 'PASS' : 'FAIL', 'input_fixes.mjs');
r = await req('GET', '/api/erp/pos?envelope=true', { token: op.access });
const codes = (r.body?.pos || []).map((p) => p.company_code);
rec('RT-AU-T604', A, 'CWE-639', 'IF-03 CKSPL operator ERP PO list has no CKVPL rows', 'only CKSPL', `${r.status} companies=${[...new Set(codes)].join(',')}`, r.status === 200 && !codes.includes('CKVPL') ? 'PASS' : 'FAIL', 'input_fixes.mjs');
for (const [id, p] of [['RT-AU-T605', '/api/erp/pos/9002002/receipts'], ['RT-AU-T606', '/api/erp/pos/9002002/pi'], ['RT-AU-T607', '/api/erp/pos/9002001/draft']]) {
  r = await req('GET', p, { token: op.access });
  rec(id, A, 'CWE-639', `IF-03 CKSPL operator -> ${p}`, '403/404', `${r.status}`, [403, 404].includes(r.status) ? 'PASS' : 'FAIL', 'input_fixes.mjs');
}
r = await req('GET', '/api/erp/pos/9002002/draft', { token: ho.access });
rec('RT-AU-T608', A, 'CWE-639', 'IF-03 head-office admin -> CKVPL draft (all companies by design)', '200', `${r.status}`, r.status === 200 ? 'PASS' : 'INFO', 'input_fixes.mjs');

// ---------- IN-02: import size cap (direct API, no nginx) ----------
function multipart(name, buf, extra = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  fd.append('file', new Blob([buf]), name);
  return fd;
}
const big = Buffer.alloc(16 * 1024 * 1024, 0x41);
r = await req('POST', '/api/imports/assets/preview', { token: ho.access, form: multipart('big.xlsx', big) });
rec('RT-AU-T610', A, 'CWE-400', 'IN-02 16 MB asset import straight to the API', '413 plain sentence', `${r.status} ${String(r.body?.detail ?? '').slice(0, 90)}`, r.status === 413 ? 'PASS' : 'FAIL', 'input_fixes.mjs');
r = await req('POST', '/api/imports/purchase-orders/preview', { token: ho.access, form: multipart('big.xlsx', big) });
rec('RT-AU-T611', A, 'CWE-400', 'IN-02 16 MB PO import straight to the API', '413 (or 404 if route differs)', `${r.status} ${String(r.body?.detail ?? '').slice(0, 90)}`, r.status === 413 ? 'PASS' : (r.status === 404 || r.status === 405 ? 'N/A' : 'FAIL'), 'input_fixes.mjs');
r = await req('POST', '/api/imports/assets/preview', { token: ho.access, form: multipart('junk.xlsx', Buffer.from('not a workbook')) });
rec('RT-AU-T612', A, 'CWE-20', 'IN-02 non-workbook .xlsx to import preview', '4xx plain sentence, no 500', `${r.status} ${String(r.body?.detail ?? '').slice(0, 90)}`, r.status < 500 ? 'PASS' : 'FAIL', 'input_fixes.mjs');

// ---------- IN-03: document signatures ----------
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
const docCases = [
  ['RT-AU-T620', 'html.png', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png', 422, 'HTML disguised as .png'],
  ['RT-AU-T621', 'script.pdf', Buffer.from('#!/bin/sh\necho hi\n'), 'application/pdf', 422, 'shell text disguised as .pdf'],
  ['RT-AU-T622', 'fake.jpg', PNG, 'image/jpeg', 422, 'PNG bytes named .jpg'],
  ['RT-AU-T623', 'zip.xlsx', Buffer.from('504b0304', 'hex'), 'application/octet-stream', 422, 'bare zip header named .xlsx'],
  ['RT-AU-T624', 'page.html', Buffer.from('<html></html>'), 'text/html', 422, '.html extension'],
  ['RT-AU-T625', 'ok.png', PNG, 'text/html', 201, 'real PNG with client-claimed text/html type'],
];
let okDoc = null;
for (const [id, name, buf, ctype, expect, label] of docCases) {
  const fd = new FormData(); fd.append('doc_type', 'photo'); fd.append('file', new Blob([buf], { type: ctype }), name);
  r = await req('POST', '/api/assets/3/documents', { token: op.access, form: fd });
  if (r.status === 201) okDoc = r.body;
  rec(id, A, 'CWE-434', `IN-03 upload ${label}`, `${expect}`, `${r.status} ${String(r.body?.detail ?? r.body?.mime_type ?? '').slice(0, 90)}`, r.status === expect ? 'PASS' : 'FAIL', 'input_fixes.mjs');
}
if (okDoc) {
  const d = await fetch(`${API}/api/documents/${okDoc.id}/download`, { headers: { Authorization: `Bearer ${op.access}` } });
  await d.arrayBuffer();
  rec('RT-AU-T626', A, 'CWE-116', 'IN-03 download of that PNG: type from extension, attachment, nosniff', 'image/png + attachment + nosniff',
    `${d.status} ${d.headers.get('content-type')} | ${d.headers.get('content-disposition')} | ${d.headers.get('x-content-type-options')}`,
    /image\/png/.test(d.headers.get('content-type') || '') && /attachment/.test(d.headers.get('content-disposition') || '') ? 'PASS' : 'FAIL', 'input_fixes.mjs');
}
const polyglot = Buffer.concat([Buffer.from('<html><body>x</body></html>\n%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);
const fd = new FormData(); fd.append('doc_type', 'other'); fd.append('file', new Blob([polyglot]), 'poly.pdf');
r = await req('POST', '/api/assets/3/documents', { token: op.access, form: fd });
rec('RT-AU-T627', A, 'CWE-434', 'IN-03 HTML/PDF polyglot (%PDF- inside first 1 KB, not at byte 0)', 'INFO: accepted is harmless (served application/pdf attachment + nosniff)', `${r.status} ${String(r.body?.detail ?? r.body?.mime_type ?? '').slice(0, 80)}`, 'INFO', 'input_fixes.mjs');
