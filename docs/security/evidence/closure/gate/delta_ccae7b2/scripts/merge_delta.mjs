// GD delta gate: build tests.csv (prefix GD-) from the per-step case files plus the static checks.
import fs from "node:fs";
import { GATE } from "./lib.mjs";
const O = `${GATE}/out`;
function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const out = [];
const add = (...r) => out.push(r);
add("GD-001", "1", "zip SHA-256 before extraction", "b975c38d…7e3, 2,152,224 bytes", "b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3, 2152224 bytes", "PASS", "GATE_DELTA.md §1");
add("GD-002", "1", "Expand-Archive (Windows PowerShell 5.1) yields the five files deploy_ckam.ps1.template checks", "backend\\app\\main.py, backend\\alembic.ini, backend\\pyproject.toml, backend\\constraints.txt, frontend-dist\\index.html", "all 5 present (the template's own list read from the packaged template); 215 files; VERSION = ccae7b22…bc3e", "PASS", "GATE_DELTA.md §1");
add("GD-003", "1", "delta vs the tested eed3de1 package (diff -r of the two extracted packages)", "backend/app identical; only constraints/ops/RELEASE/VERSION/bundle name differ", "differences: RELEASE.json, backend/VERSION, backend/constraints.txt (+colorama==0.4.6), frontend-dist/index.html + bundle name index-Cp5JgQR-.js (was index-C42ooaMX.js), ops/windows README/deploy template/verify_release; backend/app identical", "PASS", "GATE_DELTA.md §1");
add("GD-004", "1", "runtime image vs the 44 pins", "43 runtime pins equal; colorama is Windows-only", "43/43 equal; colorama==0.4.6 not installed on Linux (constraint only, nothing on Linux requires it)", "PASS", "raw/depcheck (GATE_DELTA.md §1)");
const counts = (f) => Object.fromEntries(fs.readFileSync(`${O}/${f}`, "utf8").trim().split("\n").map((l) => l.split(",")));
const a = counts("counts_before.csv"), b = counts("counts_after_migration.csv");
const diff = Object.keys(a).filter((t) => a[t] !== b[t]);
add("GD-010", "2", "restore seeded.dump (e6f8a0b2c4d6) as non-superuser ckassetapp", "exit 0", "exit 0 in 332 ms, alembic_version e6f8a0b2c4d6, superuser=false", "PASS", "raw/counts_before.csv");
add("GD-011", "2", "packaged `alembic upgrade head` (one run)", "exit 0, head c6e8a0b2d4f6", "exit 0; 715 ms wall (alembic process); the 4 migrations ran in one transaction, ALTER 0.649 ms, first DDL to COMMIT ~10 ms server time; current = c6e8a0b2d4f6 (head)", "PASS", "raw/alembic_upgrade.txt, raw/pg_migration_statement_log.txt");
add("GD-012", "2", "row counts before/after", "39 of 39 identical, + auth_session 0", `${Object.keys(a).length} tables, ${diff.length} differ; auth_session=${b.auth_session}`, diff.length === 0 && b.auth_session === "0" ? "PASS" : "FAIL", "raw/counts_*.csv");
add("GD-013", "2", "schema after migration", "token_version 0 on all rows; auth_session empty; 4 TRUNCATE triggers + lifecycle guard; assets readable", "31/31 token_version 0; auth_session 0 rows; triggers present; 16/16 assets with state", "PASS", "raw/schema_after_migration.txt");
add("GD-405", "3", "forged X-Forwarded-For in the access log", "0", "0 lines with 203.0.113.x; all 376 access lines ip=172.26.0.1 (real peer)", "PASS", "docker exec grep");
add("GD-406", "3", "app logs scanned for JWT secret / DB password / bearer tokens / canary bodies", "0/0/0/0", "2 files, 449 lines: 0/0/0/0", "PASS", "scripts/scan_logs.mjs");
add("GD-409", "3", "QR decode by re-encoding comparison", "qr.png = BASE_URL/assets/{id}; label.png qr/barcode = asset code", "qr.png = http://127.0.0.1:4111/assets/1; label qr and Code128 = CKSPL/ITFA-SPL/0001", "PASS", "raw/qrverify.txt");
add("GD-407", "4", "packaged verify_release.ps1 (Windows PowerShell 5.1) vs the instance, -ExpectedRelease ccae7b2 -ReleaseDir -IncludeUncProbe", "all PASS except the local-process check = SKIP", "41 checks: 40 PASS, 0 WARN, 0 FAIL, 1 SKIP ('uvicorn flags (local process)': listener is Docker's, not a CKAM uvicorn); exit 0; refresh-without-cookie and made-up sign-in both JSON 401", "PASS", "raw/verify_release_pkg_ccae7b2.txt/.csv");
add("GD-408", "4", "verify_release.ps1 -LocalProcessCheck Require against a fake listener", "optional", "NOT RUN: Windows PowerShell became unavailable on this PC during step 5 (GD-F01)", "NOT RUN", "GATE_DELTA.md §5");
add("GD-500", "5", "PowerShell 5.1 parser check of the 4 packaged ops/windows scripts", "0 errors; launcher has both uvicorn flags", "4 files, 0 parse errors; run_ckam_web uvicorn line has --no-proxy-headers and --no-server-header; 0 hard-coded secret-like assignments", "PASS", "raw/parse_check.txt");
add("GD-501", "5", "deploy -WhatIf with the package's own RELEASE.json (sha ccae7b2) / wrong -Sha eed3de1 / failure-after-migration branch", "pass / stop exit 2 / exit 3 with CKAM-Web stopped and the old release not restarted",
  "NOT COMPLETED: the first case (W01, -WhatIf -Sha ccae7b2) was killed at 10:45:38-39 IST by the endpoint-security product (Seqrite behaviour detection remediation), which also removed C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe and the running script files; no result was produced", "NOT RUN", "GATE_DELTA.md §5 (GD-F01)");
for (const f of fs.readdirSync(O).filter((f) => /^cases_.*\.csv$/.test(f)).sort()) {
  for (const r of parseCsv(fs.readFileSync(`${O}/${f}`, "utf8")).slice(1).filter((r) => r.length >= 6)) {
    const step = r[1] === "4" ? "3" : r[1];      // the eed3de1 scripts call this step 4; in the delta brief it is step 3
    out.push([r[0], step, r[2], r[3], r[4], r[5], r[6] || f.replace(/^cases_/, "")]);
  }
}
const s5 = parseCsv(fs.readFileSync(`${O}/step5_refusals.csv`, "utf8")).slice(1).filter((r) => r.length >= 7);
s5.forEach((r, i) => {
  const [env, sec, started, code, r32, r8, printed] = r;
  const good = sec.startsWith("good") || env.startsWith("development");
  const pass = good ? started === "yes" : started === "no" && code !== "0" && r32 === "True" && r8 === "True" && printed === "False";
  add(`GD-6${String(i).padStart(2, "0")}`, "6", `start-up: ENVIRONMENT_NAME=${env} x JWT_SECRET=${sec}`, good ? "starts" : "refuses (non-zero exit), names the 32 and 8 rules, never prints the secret",
    good ? `started=${started}` : `started=${started} exit=${code} names32=${r32} names8=${r8} secretPrinted=${printed}`, pass ? "PASS" : "FAIL", "raw/step5_refusals.csv");
});
out.sort((x, y) => (Number(x[1]) - Number(y[1])) || x[0].localeCompare(y[0]));
fs.writeFileSync(`${O}/tests.csv`, ["id,step,what,expected,actual,result,evidence", ...out.map((r) => r.map(esc).join(","))].join("\n") + "\n");
const tally = {};
for (const r of out) tally[r[5]] = (tally[r[5]] || 0) + 1;
console.log(`tests.csv: ${out.length} cases`, JSON.stringify(tally));
for (const r of out.filter((r) => r[5] !== "PASS")) console.log(r[5], r[0], r[2]);
