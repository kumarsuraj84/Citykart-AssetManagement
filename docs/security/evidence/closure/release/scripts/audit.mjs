// Adversarial inspection of the release zip. Reads the zip's central directory itself (no unzip tool), then
// checks entry names against the exclusion rules and scans the text content of every entry (inflated with
// node's zlib) for secret-like strings. usage: node audit.mjs <zip>
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const zip = readFileSync(process.argv[2]);
// end of central directory
let eocd = -1;
for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
  if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) throw new Error("no EOCD");
const total = zip.readUInt16LE(eocd + 10);
let off = zip.readUInt32LE(eocd + 16);
const entries = [];
for (let n = 0; n < total; n++) {
  if (zip.readUInt32LE(off) !== 0x02014b50) throw new Error("bad central header at " + off);
  const method = zip.readUInt16LE(off + 10);
  const csize = zip.readUInt32LE(off + 20);
  const usize = zip.readUInt32LE(off + 24);
  const nlen = zip.readUInt16LE(off + 28);
  const xlen = zip.readUInt16LE(off + 30);
  const clen = zip.readUInt16LE(off + 32);
  const lho = zip.readUInt32LE(off + 42);
  const name = zip.subarray(off + 46, off + 46 + nlen).toString("utf8");
  entries.push({ name, method, csize, usize, lho });
  off += 46 + nlen + xlen + clen;
}
function content(e) {
  const nlen = zip.readUInt16LE(e.lho + 26);
  const xlen = zip.readUInt16LE(e.lho + 28);
  const start = e.lho + 30 + nlen + xlen;
  const raw = zip.subarray(start, start + e.csize);
  return e.method === 0 ? raw : inflateRawSync(raw);
}
const files = entries.filter((e) => !e.name.endsWith("/"));
const dirs = entries.filter((e) => e.name.endsWith("/"));
console.log(`entries: ${entries.length} (files ${files.length}, directories ${dirs.length})`);
console.log(`total uncompressed: ${files.reduce((s, e) => s + e.usize, 0)} bytes; compressed data: ${files.reduce((s, e) => s + e.csize, 0)} bytes`);
console.log(`backslash in any entry name: ${entries.some((e) => e.name.includes("\\"))}; absolute or '..' names: ${entries.some((e) => e.name.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(e.name) || /^[A-Za-z]:/.test(e.name))}`);
console.log(`top-level names: ${[...new Set(entries.map((e) => e.name.split("/")[0]))].join(", ")}`);
console.log("\nlargest 15 files:");
for (const e of [...files].sort((a, b) => b.usize - a.usize).slice(0, 15)) console.log(`  ${String(e.usize).padStart(9)}  ${e.name}`);

console.log("\nexclusion assertions (entry names):");
const rules = [
  [".env (any .env*)", /(^|\/)\.env/i],
  ["*.map", /\.map$/i],
  ["node_modules", /(^|\/)node_modules(\/|$)/i],
  [".git", /(^|\/)\.git(\/|$|ignore|attributes)/i],
  ["tests / test files", /(^|\/)(tests?|e2e|__tests__)(\/|$)|(^|\/)(test_[^/]*|[^/]*_test\.py|conftest\.py|[^/]*\.(test|spec)\.[a-z]+)$/i],
  ["docs folder", /(^|\/)docs(\/|$)/i],
  ["demo", /demo/i],
  ["screenshots/images outside frontend-dist", /^(?!frontend-dist\/).*\.(png|jpe?g|gif|webp|bmp)$/i],
  ["dumps/backups (*.dump|*.sql.gz|*.bak|*.backup|backups/)", /\.(dump|sql\.gz|bak|backup)$|(^|\/)backups?(\/|$)/i],
  ["keys/certs (.pem|.key|id_rsa|.pfx|.p12|.crt)", /\.(pem|key|pfx|p12|crt)$|id_rsa|id_ed25519/i],
  ["python caches (__pycache__|*.pyc)", /__pycache__|\.pyc$/i],
  ["coverage/caches (.coverage|htmlcov|.pytest_cache|.ruff_cache|.mypy_cache)", /\.coverage|htmlcov|pytest_cache|ruff_cache|mypy_cache/i],
  ["password files (nas.pw|*.pw)", /\.pw$/i],
  ["docker files", /(^|\/)(Dockerfile|docker-compose[^/]*|\.dockerignore)$/i],
  ["other backend scripts than create_owner.py", /^backend\/scripts\/(?!create_owner\.py$)[^/]+$/],
];
let violations = 0;
for (const [label, re] of rules) {
  const hits = entries.filter((e) => re.test(e.name)).map((e) => e.name);
  violations += hits.length;
  console.log(`  ${hits.length === 0 ? "PASS" : "FAIL"}  no ${label}${hits.length ? ": " + hits.join(", ") : ""}`);
}
console.log(`  exclusion violations: ${violations}`);

console.log("\nsecret scan (text entries):");
const textExt = /\.(py|ini|toml|txt|json|md|sql|ps1|template|html|css|js|svg|mako|cfg|yml|yaml)$|(^|\/)(VERSION|README)$/i;
const scans = [
  ["JWT-like eyJ...", /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["PRIVATE KEY block", /BEGIN [A-Z ]*PRIVATE KEY/g],
  ["password = value", /password\s*[:=]\s*\S+/gi],
  ["URL with credentials (scheme://user:pass@)", /[a-z][a-z0-9+.-]*:\/\/[^\s:\/@'"]+:[^\s@\/'"]+@/gi],
  ["DATABASE_URL=", /DATABASE_URL\s*=\s*\S+/g],
  ["PO_SOURCE_PASSWORD=", /PO_SOURCE_PASSWORD\s*=\s*\S*/g],
  ["JWT_SECRET=", /JWT_SECRET\s*=\s*\S+/g],
  ["NAS/ERP password words", /(nas|erp|ckpost|ckappuser|superuser)[^\n]{0,30}(password|passwd|pwd)\s*[:=]\s*\S+/gi],
  ["AWS-style key", /AKIA[0-9A-Z]{16}/g],
  ["long hex/base64 secret assignment", /(secret|token|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+\/_=-]{24,}['"]/gi],
];
let textFiles = 0;
const minified = /^frontend-dist\/assets\/.*\.(js|css)$/;
for (const e of files) {
  if (!textExt.test(e.name)) continue;
  textFiles++;
  const body = content(e).toString("utf8");
  const lines = body.split(/\r?\n/);
  for (const [label, re] of scans) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const s = Math.max(0, m.index - 30);
        let snippet = line.slice(s, m.index + m[0].length + 30);
        if (minified.test(e.name)) snippet = snippet.slice(0, 120);
        console.log(`  HIT [${label}] ${e.name}:${i + 1}: ${JSON.stringify(snippet.trim())}`);
      }
    });
  }
}
console.log(`scanned text entries: ${textFiles}`);
