import { req, API } from './lib.mjs';
import net from 'node:net';
import { writeFileSync } from 'node:fs';
const out = { cases: [] };
const rec = (id, desc, pass, detail) => { out.cases.push({ id, desc, pass, detail }); console.log(pass?'PASS':'FAIL', id, desc, '|', JSON.stringify(detail)); };

function rawRequest(headerLines, bodyChunks, { chunked = false } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect(8200, '127.0.0.1');
    let buf = '';
    sock.setTimeout(8000, () => { sock.destroy(); resolve({ status: 'TIMEOUT', raw: buf }); });
    sock.on('data', (d) => { buf += d.toString('latin1'); });
    sock.on('close', () => { const m = /^HTTP\/1\.\d (\d+)/.exec(buf); resolve({ status: m ? +m[1] : 'NONE', raw: buf.slice(0, 200) }); });
    sock.on('error', () => { const m = /^HTTP\/1\.\d (\d+)/.exec(buf); resolve({ status: m ? +m[1] : 'ERR', raw: buf.slice(0, 200) }); });
    sock.on('connect', async () => {
      try {
        sock.write(headerLines.join('\r\n') + '\r\n\r\n');
        for (const c of bodyChunks) { sock.write(c); await new Promise(r => setTimeout(r, 10)); }
        if (chunked) sock.write('0\r\n\r\n');
      } catch {}
    });
  });
}

// 1. login body over 64 KB (declared Content-Length) -> 413
const big = JSON.stringify({ login_id: 'x'.repeat(100 * 1024), password: 'y' });
const r1 = await req(API, 'POST', '/api/auth/login', { raw: big, headers: { 'Content-Type': 'application/json' } }).catch(e => ({ status: 'ERR' }));
rec('CL2-SE-T40', 'login body >64KB -> 413', r1.status === 413, { status: r1.status, detail: r1.json && r1.json.detail });

// 2. login body just under 64 KB -> NOT 413
const small = JSON.stringify({ login_id: 'x'.repeat(60 * 1024), password: 'y' });
const r2 = await req(API, 'POST', '/api/auth/login', { raw: small, headers: { 'Content-Type': 'application/json' } }).catch(e => ({ status: 'ERR' }));
rec('CL2-SE-T41', 'login body ~60KB -> NOT 413 (reaches login logic)', r2.status !== 413 && r2.status !== 'ERR', { status: r2.status });

// 3. non-auth JSON declared >5 MB -> 413 (refused on declared length, before reading body / before auth)
const r3 = await rawRequest(
  ['POST /api/purchase-orders HTTP/1.1','Host: 127.0.0.1:8200','Content-Type: application/json','Content-Length: 6291456','Connection: close'],
  ['{"x":"'] );
rec('CL2-SE-T42', 'JSON declared >5MB (no token) -> 413 before read', r3.status === 413, { status: r3.status });

// 4. multipart declared >16 MB -> 413
const r4 = await rawRequest(
  ['POST /api/documents HTTP/1.1','Host: 127.0.0.1:8200','Content-Type: multipart/form-data; boundary=xyz','Content-Length: 17825792','Connection: close'],
  ['--xyz'] );
rec('CL2-SE-T43', 'multipart declared >16MB -> 413 before read', r4.status === 413, { status: r4.status });

// 5. bad (non-numeric) Content-Length -> 413
const r5 = await rawRequest(
  ['POST /api/auth/login HTTP/1.1','Host: 127.0.0.1:8200','Content-Type: application/json','Content-Length: notanumber','Connection: close'],
  ['{"login_id":"a","password":"b"}']);
rec('CL2-SE-T44', 'bad Content-Length -> 413', r5.status === 413, { status: r5.status });

// 6. chunked login body over 64 KB (no Content-Length) -> counted + stopped -> 413
const chunk = 'd'.repeat(16 * 1024);
const chunks = [];
for (let i = 0; i < 6; i++) chunks.push(chunk.length.toString(16) + '\r\n' + chunk + '\r\n'); // ~96 KB
const r6 = await rawRequest(
  ['POST /api/auth/login HTTP/1.1','Host: 127.0.0.1:8200','Content-Type: application/json','Transfer-Encoding: chunked','Connection: close'],
  chunks, { chunked: true });
rec('CL2-SE-T45', 'chunked login body >64KB -> 413', r6.status === 413, { status: r6.status, line: r6.raw.split('\r\n')[0] });

writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/a6_size.json', JSON.stringify(out,null,2));
console.log('\nSUMMARY', out.cases.filter(c=>c.pass).length, '/', out.cases.length);
