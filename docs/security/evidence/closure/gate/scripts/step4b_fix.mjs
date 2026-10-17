// GT-219 re-run with the corrected expectation (operator create 201 by decision, edit 403). Patches cases_step4b.csv.
import fs from "node:fs";
import { call, login, GATE } from "./lib.mjs";
const B = "http://127.0.0.1:4111";
const ho = await login(B, "SECHO");
const op = await login(B, "SECOPIT");
const vn = `GT Gate Vendor fix ${Date.now()}`;
const v = await call(B, "POST", "/api/masters/vendors", { token: ho.token, body: { name: vn } });
const vop = await call(B, "POST", "/api/masters/vendors", { token: op.token, body: { name: vn + " op" } });
const vope = await call(B, "PUT", `/api/masters/vendors/${v.json?.id}`, { token: op.token, body: { name: vn + " renamed" } });
const vhoe = await call(B, "PUT", `/api/masters/vendors/${v.json?.id}`, { token: ho.token, body: { name: vn + " renamed" } });
const pass = v.status === 201 && vop.status === 201 && vope.status === 403 && vhoe.status === 200;
const actual = `HO create ${v.status}; operator create ${vop.status}; operator edit ${vope.status} ${vope.json?.detail || ""}; HO edit ${vhoe.status}`;
console.log(pass ? "PASS" : "FAIL", actual);
const f = `${GATE}/out/cases_step4b.csv`;
const rows = fs.readFileSync(f, "utf8").split("\n").filter((l) => l && !l.startsWith('"GT-219"'));
const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
rows.splice(20, 0, ["GT-219", "4", "vendor rights: operator SECOPIT create (in-flow) and edit; SECHO edit", "operator create 201 (DECISIONS 2026-10-14 (3)), operator edit 403, head-office edit 200",
  actual, pass ? "PASS" : "FAIL", "re-run after tester error: first run expected operator create 403"].map(esc).join(","));
fs.writeFileSync(f, rows.join("\n") + "\n");
