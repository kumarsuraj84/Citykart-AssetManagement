// RETEST2 ACCESS upload-spoofing + oversize + download-header battery (IN-02/IN-03 re-attack).
import { tok, req, API } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const secho = await tok('SECHO');
const out = [];
const rec = (id, desc, status, verdict, note) => { out.push({ id, desc, status, verdict, note }); console.log(verdict, id, status, '-', desc, note?('| '+note):''); };

// create CL2 target asset
let r = await req('POST','/api/assets',{ token: secho, body: { company_id:1, cost_center_id:1, item_id:1, category_id:1, subcategory_id:1, description:'CL2 upload target', vendor_id:1, initial_asset_user_id:3, serial_pending:true } });
const aid = (Array.isArray(r.body)&&r.body[0])?r.body[0].id:(r.body&&r.body.id);
rec('CL2-AC-UP-make','create upload target asset', r.status, aid?'PASS':'FAIL','id '+aid);

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PNG = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(100,1)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

async function up(filename, buf, ctype, docType='invoice') {
  const fd = new FormData();
  fd.append('doc_type', docType);
  fd.append('file', new Blob([buf], { type: ctype }), filename);
  const res = await fetch(`${API}/api/assets/${aid}/documents`, { method:'POST', headers:{ Authorization:`Bearer ${secho}` }, body: fd });
  let j=null; const txt=await res.text(); try{j=JSON.parse(txt);}catch{}
  return { status: res.status, body: j, raw: txt.slice(0,120) };
}

if (aid) {
  let x;
  x = await up('evil.pdf', HTML, 'application/pdf');        rec('CL2-AC-UP-html-as-pdf','HTML body with .pdf name', x.status, x.status===422?'PASS':'FAIL', x.raw);
  x = await up('evil.html', HTML, 'text/html');             rec('CL2-AC-UP-html-ext','.html extension', x.status, x.status===422?'PASS':'FAIL', x.raw);
  x = await up('evil.svg', HTML, 'image/svg+xml');          rec('CL2-AC-UP-svg','.svg extension', x.status, x.status===422?'PASS':'FAIL', x.raw);
  x = await up('evil.pdf.html', HTML, 'application/pdf');   rec('CL2-AC-UP-double-ext','double ext .pdf.html', x.status, x.status===422?'PASS':'FAIL', x.raw);
  x = await up('empty.pdf', Buffer.alloc(0), 'application/pdf'); rec('CL2-AC-UP-empty','empty file', x.status, x.status===422?'PASS':'FAIL', x.raw);
  x = await up('big.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11*1024*1024,0x20)]), 'application/pdf'); rec('CL2-AC-UP-oversize-doc','11 MB doc', x.status, [413,422].includes(x.status)?'PASS':'FAIL', x.raw);
  x = await up('good.pdf', PDF, 'application/pdf');          rec('CL2-AC-UP-real-pdf','valid PDF', x.status, x.status===201?'PASS':'FAIL', '');
  const goodDocId = x.body && x.body.id;
  x = await up('good.png', PNG, 'image/png');               rec('CL2-AC-UP-real-png','valid PNG', x.status, x.status===201?'PASS':'FAIL', '');
  x = await up('../../../../etc/passwd.pdf', PDF, 'application/pdf'); rec('CL2-AC-UP-traversal-name','traversal in filename (valid PDF)', x.status, x.status===201?'PASS':'FAIL', 'stored_path='+((x.body&&x.body.stored_path)||'').replace(/.*[\\/]/,''));
  x = await up('CON.pdf', PDF, 'application/pdf');           rec('CL2-AC-UP-reserved-name','reserved device name CON.pdf (valid PDF)', x.status, x.status===201?'PASS':'FAIL', '');
  const poly = Buffer.concat([Buffer.from('%PDF-1.4\n<html><script>alert(1)</script>')]); // PDF-prefixed polyglot
  x = await up('poly.pdf', poly, 'application/pdf');         rec('CL2-AC-UP-polyglot','PDF-prefixed HTML polyglot (stored, served safe)', x.status, x.status===201?'OBS':'PASS', 'signature-prefix check accepts; served attachment+nosniff');

  // download header check on the real PDF
  if (goodDocId) {
    const res = await fetch(`${API}/api/documents/${goodDocId}/download`, { headers:{ Authorization:`Bearer ${secho}` } });
    const cd = res.headers.get('content-disposition')||''; const ct = res.headers.get('content-type')||''; const nosniff = res.headers.get('x-content-type-options')||'';
    const ok = /attachment/i.test(cd) && /application\/pdf/i.test(ct) && /nosniff/i.test(nosniff);
    rec('CL2-AC-UP-download-headers','download: attachment + application/pdf + nosniff', res.status, ok?'PASS':'CHECK', `cd=${cd}; ct=${ct}; nosniff=${nosniff}`);
  }
}

// oversize import (15 MB limit) -> 413
{
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.alloc(16*1024*1024, 0x20)], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'big.xlsx');
  const res = await fetch(`${API}/api/imports/assets/preview?mode=add`, { method:'POST', headers:{ Authorization:`Bearer ${secho}` }, body: fd });
  rec('CL2-AC-UP-oversize-import','16 MB import', res.status, [413,422].includes(res.status)?'PASS':'FAIL', (await res.text()).slice(0,100));
}

// cleanup
if (aid) { const d = await req('DELETE',`/api/assets/${aid}`,{ token: secho }); rec('CL2-AC-UP-cleanup','soft-delete target', d.status, '', ''); }

writeFileSync(new URL('../raw/upload.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('\nTOTAL', out.length, 'FAIL:', out.filter(x=>x.verdict==='FAIL').length);
