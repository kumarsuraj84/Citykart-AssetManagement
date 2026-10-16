// WP-D2: builds the SoA working draft from CKAM_ISO27001_CONTROL_MATRIX.csv (the master copy).
// Usage: node make_soa.mjs <csv> <out.md>
import { readFileSync, writeFileSync } from "node:fs";

const [csvPath, outPath] = process.argv.slice(2);
const text = readFileSync(csvPath, "utf8").replace(/^﻿/, "");

function parseCsv(s) {
  const rows = []; let row = []; let cell = ""; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const rows = parseCsv(text);
const head = rows.shift();
const idx = Object.fromEntries(head.map((h, i) => [h, i]));
const need = ["Control", "Title", "Applicable", "Technical Control", "Control Owner", "Gap", "Risk", "Status", "Existing Evidence"];
for (const n of need) if (!(n in idx)) throw new Error("missing column " + n);

// Which DRAFT document of this pack carries the process side of each control (numbers = files 01..14).
const POLICY = {
  "A.5.1": "01", "A.5.2": "01", "A.5.3": "02, 04", "A.5.4": "01, 14", "A.5.5": "05", "A.5.6": "06", "A.5.7": "06",
  "A.5.8": "04, 12", "A.5.9": "01, 12", "A.5.10": "01, 10", "A.5.11": "03", "A.5.12": "01", "A.5.13": "01",
  "A.5.14": "01", "A.5.15": "02", "A.5.16": "02, 03", "A.5.17": "02", "A.5.18": "02, 03, 11", "A.5.19": "09",
  "A.5.20": "09", "A.5.21": "06, 09", "A.5.22": "09", "A.5.23": "09", "A.5.24": "05", "A.5.25": "05", "A.5.26": "05",
  "A.5.27": "05", "A.5.28": "05", "A.5.29": "08", "A.5.30": "08", "A.5.31": "01, 12", "A.5.32": "06, 09",
  "A.5.33": "07", "A.5.34": "01", "A.5.35": "13", "A.5.36": "13", "A.5.37": "04, 07, 08",
  "A.6.1": "03", "A.6.2": "03", "A.6.3": "10", "A.6.4": "03", "A.6.5": "03", "A.6.6": "03", "A.6.7": "02", "A.6.8": "05, 10",
  "A.7.7": "10", "A.7.9": "01", "A.7.10": "07", "A.7.13": "08", "A.7.14": "01",
  "A.8.1": "01", "A.8.2": "02, 11", "A.8.3": "02", "A.8.4": "02, 04", "A.8.5": "02", "A.8.6": "08", "A.8.7": "06",
  "A.8.8": "06", "A.8.9": "04", "A.8.10": "01, 07", "A.8.11": "01", "A.8.12": "01", "A.8.13": "07", "A.8.14": "08",
  "A.8.15": "05", "A.8.16": "05", "A.8.17": "06", "A.8.18": "02", "A.8.19": "04, 06", "A.8.20": "01, 02",
  "A.8.21": "01, 02", "A.8.22": "01", "A.8.23": "—", "A.8.24": "01", "A.8.25": "04", "A.8.26": "04", "A.8.27": "04",
  "A.8.28": "04, 06", "A.8.29": "04, 06", "A.8.30": "04, 09", "A.8.31": "04", "A.8.32": "04", "A.8.33": "04",
  "A.8.34": "13",
};
const policyFor = (c) => POLICY[c] ?? (c.startsWith("A.7.") ? "08 (inherited)" : "—");

const clean = (v) => (v ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
const techTag = (v) => { const m = /^(TECH READY|TECH PARTIAL|TECH MISSING|TECH NOT EVIDENCED|NO TECH COMPONENT)/.exec(v || ""); return m ? m[1] : "—"; };
const appl = (v) => ({ YES: "Y", NO: "N", PARTIAL: "Y (partly)" }[v] ?? v);
function justification(r) {
  const a = r[idx.Applicable], risk = clean(r[idx.Risk]);
  if (a === "NO") { const e = clean(r[idx["Existing Evidence"]]); return /^Not applicable/i.test(e) ? e : "Not applicable: " + e; }
  const base = /^R-\d/.test(risk) ? "Treats " + risk : "Supporting control (no risk link in the matrix; it keeps security testing from harming production)";
  return a === "PARTIAL" ? "Partly applicable. " + base : base;
}

const counts = { app: {}, status: {}, theme: {} };
const lines = [];
for (const r of rows) {
  const c = r[idx.Control];
  counts.app[r[idx.Applicable]] = (counts.app[r[idx.Applicable]] || 0) + 1;
  counts.status[r[idx.Status]] = (counts.status[r[idx.Status]] || 0) + 1;
  lines.push(`| ${c} | ${clean(r[idx.Title])} | ${appl(r[idx.Applicable])} | ${justification(r)} | **${clean(r[idx.Status])}** · ${techTag(r[idx["Technical Control"]])} | ${clean(r[idx.Gap])} | ${policyFor(c)} | ${clean(r[idx["Control Owner"]])} |`);
}
if (rows.length !== 93) throw new Error("expected 93 controls, got " + rows.length);

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(" · ");

const out = `# 15 — Statement of Applicability: WORKING DRAFT

| | |
|---|---|
| Document | CKAM-ISMS-15, version 0.1 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Working draft only. This is **NOT the official Statement of Applicability** |
| Owner (proposed) | ISMS Lead (to be appointed, EXT-36) |
| Approver | Management |
| Review | After the risk assessment is approved (doc 12), then yearly and after every major change |
| Source | Generated on 2026-10-16 from \`docs/security/CKAM_ISO27001_CONTROL_MATRIX.csv\` (the master copy, written 2026-10-15 at HEAD \`d04779a\`) by a script; the rows were not typed by hand |

> **Not a certification document.** CKAM is not ISO/IEC 27001 certified. A Statement of Applicability (SoA) is an
> ISMS document that management approves **after** the risk assessment and risk treatment plan (ISO/IEC 27001:2022
> clause 6.1.3 d). Neither has been approved yet. Until then this table is a working draft to help write it.

## In plain words

ISO 27001 has a list of 93 controls (Annex A). For each one the SoA says: does it apply to CKAM, why, and how far
it is done. Think of it as a checklist that the auditor reads first. This draft copies the facts from the control
matrix and adds which document of this policy pack covers the "people and process" side.

## How to read the columns

* **Applicable:** Y = applies; Y (partly) = applies to part of CKAM only; N = does not apply (with the reason).
* **Justification:** the risk(s) from the register in \`CKAM_ISO27001_READINESS.md\` section 9 (R-01 … R-33) that the
  control treats. Doc 12 says how that register is owned and reviewed.
* **Implementation status** = overall readiness from the matrix (READY / PARTIAL / MISSING / NOT EVIDENCED / N/A) ·
  technical-component tag. **These statuses describe 2026-10-15.** The security closure programme (from 2026-10-16)
  may change some technical tags; the matrix CSV stays the master and this file must be regenerated from it.
* **Policy in this pack:** the DRAFT document number(s) in \`docs/security/policies/\`. A DRAFT policy is **not** an
  operating control: no status in this table was raised because a policy draft now exists.
* **Control owner:** proposed owner role from the matrix (no person is named; management assigns people).

## Totals (computed from the CSV)

* Controls: ${rows.length}
* Applicable (matrix values): ${fmt(counts.app)}
* Overall status: ${fmt(counts.status)}

## Annex A working table

| Control | Title | Applicable | Justification | Implementation status | Main gap | Policy in this pack | Control owner (proposed) |
|---|---|---|---|---|---|---|---|
${lines.join("\n")}

## What this does NOT yet prove

* It does not prove any control operates. 0 of the policies it points to are approved; none has produced a record.
* Applicability is the matrix author's proposal; management has not accepted it, and it rests on a risk register that
  has no approved owner (doc 12).
* Physical (A.7) and HR (A.6) controls are marked NOT EVIDENCED because they are CityKart-wide controls that were not
  seen, not because they are known to be missing.
* Nothing here reflects production changes: on 2026-10-16 production still runs release \`3b5e842\` with the CRITICAL
  IF-01 exposure (see \`CKAM_SECURITY_CLOSURE_REGISTER.md\`).

## To turn this into the real SoA

1. Management appoints the ISMS Lead and approves the scope (\`CKAM_ISO27001_READINESS.md\` section 2.1).
2. The risk register is approved with owners (doc 12); every "Treats R-xx" link is re-checked.
3. Each N or Y (partly) is confirmed in writing by management.
4. Implementation status is re-taken from the then-current matrix and the closure register.
5. The approved SoA gets a version number, date and signature; this working draft is kept as history.
`;
writeFileSync(outPath, out, "utf8");
console.log("rows", rows.length, JSON.stringify(counts));
