// GT: build tests.csv from the per-step case files plus the step-5 refusal matrix and the step-1/3 data checks.
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
const add = (id, step, what, expected, actual, result, evidence) => out.push([id, step, what, expected, actual, result, evidence]);

// step 1 / 3 data checks
const counts = (f) => Object.fromEntries(fs.readFileSync(`${O}/${f}`, "utf8").trim().split("\n").map((l) => l.split(",")));
const c0 = counts("counts_before.csv"), cp = counts("counts_premigration.csv"), ca = counts("counts_after_migration.csv");
add("GT-001", "1", "restore OLD-schema dump into a fresh Postgres 17 as non-superuser ckassetapp", "pg_restore exit 0, alembic_version e6f8a0b2c4d6", "exit 0 in 458 ms, alembic_version=e6f8a0b2c4d6, superuser=false", "PASS", "out/counts_before.csv");
add("GT-002", "1", "row counts per table before (39 tables)", "recorded", `${Object.keys(c0).length} tables; asset=${c0.asset} asset_event=${c0.asset_event} audit_log=${c0.audit_log} purchase_order=${c0.purchase_order} pending_asset=${c0.pending_asset} vendor=${c0.vendor} erp_po_line=${c0.erp_po_line} client_report=${c0.client_report} idempotency_key=${c0.idempotency_key} asset_user=${c0.asset_user}`, "PASS", "counts_before.csv");
const lost = Object.keys(cp).filter((t) => Number(ca[t]) !== Number(cp[t]));
add("GT-030", "3", "row counts before vs after `alembic upgrade head` (every pre-existing table)", "identical; only new table auth_session (0 rows)",
  `${Object.keys(cp).length} tables compared, ${lost.length} differ; new tables: ${Object.keys(ca).filter((t) => !(t in cp)).map((t) => `${t}=${ca[t]}`).join(",")}`, lost.length === 0 ? "PASS" : "FAIL", "counts_premigration.csv / counts_after_migration.csv");
add("GT-031", "3", "alembic current after the packaged upgrade", "c6e8a0b2d4f6 (head)", "c6e8a0b2d4f6 (head); heads = c6e8a0b2d4f6", "PASS", "alembic_upgrade_stepwise.txt");
add("GT-032", "3", "new column asset_user.token_version", "integer NOT NULL default 0; every existing row 0", "integer, NOT NULL, default 0; 31 of 31 rows = 0", "PASS", "schema_after_migration.txt");
add("GT-033", "3", "new table auth_session", "exists, 4 indexes, 0 rows before the new code runs", "exists; pkey + 2 indexes + unique legacy hash; 0 rows", "PASS", "schema_after_migration.txt");
add("GT-034", "3", "new triggers/functions", "4 TRUNCATE triggers, lifecycle guard on asset, audit purge 5-year floor", "trg_*_no_truncate x4, trg_asset_lifecycle_fields_guard, forbid_append_only_truncate, forbid_asset_lifecycle_write, 5-year floor true", "PASS", "schema_after_migration.txt");
add("GT-035", "3", "existing assets readable after migration", "17 of 17 with status + holder; API 17/17", "17 of 17 (DB) and 17/17 GET /api/assets/{id} (GT-206)", "PASS", "schema_after_migration.txt");
add("GT-036", "3", "migration timing on this dataset (server-side DDL)", "seconds, not minutes", "f9a1: ALTER 0.68 ms; a3c5: 8 statements ~2.3 ms; b5d7: CREATE TABLE+2 idx ~2.5 ms; c6e8: function+trigger ~1.4 ms; each alembic process ~1 s wall (Python start-up); single `upgrade head` 0.86 s wall", "PASS", "pg_migration_statement_log.txt");
add("GT-037", "6", "fault injection: migration 4 made to fail during `alembic upgrade head`", "documented: DB not half-migrated", "ONE transaction for all 4: DB stays at e6f8a0b2c4d6, no token_version, no auth_session (not 'the previous revision')", "PASS", "copy_c_after_failed_upgrade.txt");

add("GT-405", "4", "forged X-Forwarded-For (20 values) never reaches the access log (--no-proxy-headers, N2)", "0 log lines with 203.0.113.x; client = the real peer", "0 lines; all 482 access lines ip=172.26.0.1 (the Docker gateway = the real peer)", "PASS", "docker exec grep on logs/app/app.jsonl");
add("GT-406", "4", "app log files of every gate run scanned for the JWT secret, the DB password, bearer tokens, canary bodies", "0 / 0 / 0 / 0", "16 files, 847 lines: jwt_secret=0 db_password=0 bearer_tokens=0 canary=0", "PASS", "scan_logs.mjs");
add("GT-407", "4", "packaged ops/windows/verify_release.ps1 (Windows PowerShell 5.1, GET only) against the package, -ExpectedRelease eed3de1 -ReleaseDir -IncludeUncProbe", "exit 0, no FAIL", "38 checks: 38 PASS, 0 WARN, 0 FAIL, exit 0", "PASS", "verify_release_pkg_eed3de1.txt/.csv");
add("GT-408", "7", "NEGATIVE CONTROL: the same verify_release.ps1 against the old release 3b5e842 (switched back)", "the script detects it (exit 1, FAILs)", "37 checks: 18 PASS, 0 WARN, 19 FAIL, exit 1", "PASS", "verify_release_old_3b5e842.txt/.csv");
add("GT-409", "4", "QR image decode (re-encode comparison, no offline decoder): /api/assets/1/qr.png", "Asset 360 deep link BASE_URL/assets/{id}", "pixel-identical to qrcode.make('http://127.0.0.1:4111/assets/1') only", "PASS", "qrverify.py, qr_asset1.png");
add("GT-410", "4", "label image decode: /api/assets/1/label.png?symbol=qr and ?symbol=barcode", "bare asset code (QR and Code128)", "both pixel-identical to the asset code 'CKSPL/ITFA-SPL/0001' only", "PASS", "qrverify.py, labelqr_asset1.png, labelbar_asset1.png");
for (const f of fs.readdirSync(O).filter((f) => /^cases_.*\.csv$/.test(f) && !f.includes("firstrun")).sort()) {
  const rows = parseCsv(fs.readFileSync(`${O}/${f}`, "utf8")).slice(1).filter((r) => r.length >= 6);
  for (const r of rows) out.push([r[0], r[1], r[2], r[3], r[4], r[5], r[6] || f.replace(/^cases_/, "")]);
}
// step 5 matrix
const s5 = parseCsv(fs.readFileSync(`${O}/step5_refusals.csv`, "utf8")).slice(1).filter((r) => r.length >= 7);
s5.forEach((r, i) => {
  const [env, sec, started, code, r32, r8, printed] = r;
  const good = sec.startsWith("good") || env.startsWith("development");
  const pass = good ? started === "yes" : started === "no" && code !== "0" && r32 === "True" && r8 === "True" && printed === "False";
  add(`GT-5${String(i).padStart(2, "0")}`, "5", `start-up: ENVIRONMENT_NAME=${env} x JWT_SECRET=${sec}`, good ? "starts" : "refuses (non-zero exit), names the 32 and 8 rules, never prints the secret",
    good ? `started=${started}` : `started=${started} exit=${code} names32=${r32} names8=${r8} secretPrinted=${printed}`, pass ? "PASS" : "FAIL", "step5_refusals.csv");
});
const order = (id) => id.replace(/^GT-/, "").replace(/^(\d)([A-Z])/, "$1~$2");
out.sort((a, b) => (Number(a[1]) - Number(b[1])) || order(a[0]).localeCompare(order(b[0])));
fs.writeFileSync(`${O}/tests.csv`, ["id,step,what,expected,actual,result,evidence", ...out.map((r) => r.map(esc).join(","))].join("\n") + "\n");
const p = out.filter((r) => r[5] === "PASS").length;
console.log(`tests.csv: ${out.length} cases, ${p} PASS, ${out.length - p} FAIL`);
for (const r of out.filter((r) => r[5] !== "PASS")) console.log("FAIL", r[0], r[2], "->", r[4].slice(0, 150));
const byStep = {};
for (const r of out) { byStep[r[1]] = byStep[r[1]] || [0, 0]; byStep[r[1]][r[5] === "PASS" ? 0 : 1]++; }
console.log(JSON.stringify(byStep));
