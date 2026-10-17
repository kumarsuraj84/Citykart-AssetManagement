// GT step 4b: functional smoke of the PACKAGE (production mode, migrated DB) through the real API as SECHO
// (head-office admin / Primary Owner) and SECOPIT (CKSPL IT operator). Saves QR / label PNGs for decoding.
import fs from "node:fs";
import { call, login, Cases, GATE, redact } from "./lib.mjs";
const B = "http://127.0.0.1:4111";
const C = new Cases(`${GATE}/out/cases_step4b.csv`);
const raw = [];
const keep = (k, v) => raw.push(`${k}: ${redact(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 1500)}`);

const ho = await login(B, "SECHO");
C.add("GT-200", "4", "sign-in SECHO (Primary Owner)", "200 + token, is_primary_owner", `${ho.status} primary=${ho.json?.is_primary_owner} role=${ho.json?.role}`, ho.status === 200 && !!ho.token);
const op = await login(B, "SECOPIT");
C.add("GT-201", "4", "sign-in SECOPIT (operator, CKSPL IT)", "200 + token, role OPERATOR", `${op.status} role=${op.json?.role} company=${op.json?.company_id}`, op.status === 200 && !!op.token);
const T = ho.token, O = op.token;

// diagnostics + app_started
const d = await call(B, "GET", "/api/admin/diagnostics/health", { token: T });
keep("diagnostics", d.json);
const dj = d.json || {};
const flat = JSON.stringify(dj);
C.add("GT-202", "4", "GET /api/admin/diagnostics/health as SECHO", "200, version ccae7b2, environment production, migrations ok at c6e8a0b2d4f6",
  `${d.status} ${flat.slice(0, 400)}`, d.status === 200 && flat.includes("ccae7b2") && flat.includes("production") && flat.includes("c6e8a0b2d4f6") && /"ok":\s*true/.test(flat));
const s = await call(B, "GET", "/api/admin/logs/system?event=app_started", { token: T });
keep("system app_started", s.json);
const sflat = JSON.stringify(s.json);
C.add("GT-203", "4", "system_event app_started of the package", "a row with version ccae7b2 and environment production", `${s.status} ${sflat.slice(0, 400)}`,
  s.status === 200 && sflat.includes("ccae7b2") && sflat.includes("production"));
const dop = await call(B, "GET", "/api/admin/diagnostics/health", { token: O });
C.add("GT-204", "4", "diagnostics as operator SECOPIT", "403 (head-office admin only)", `${dop.status} ${dop.text.slice(0, 120)}`, dop.status === 403);

// asset list / search / Asset 360
const al = await call(B, "GET", "/api/assets?limit=100", { token: T });
const items = al.json?.items || [];
C.add("GT-205", "4", "asset list as SECHO", "200, all 16 assets", `${al.status} total=${al.json?.total} items=${items.length}`, al.status === 200 && items.length === 16);
let readable = 0;
for (const a of items) { const r = await call(B, "GET", `/api/assets/${a.id}`, { token: T }); if (r.status === 200 && r.json?.asset_code === a.asset_code) readable++; }
C.add("GT-206", "4", "every existing asset readable (Asset 360 API) after the migration", "16 of 16 GET /api/assets/{id} 200", `${readable} of ${items.length}`, readable === 16);
const q = await call(B, "GET", "/api/assets?q=ITFA-SPL&limit=50", { token: T });
C.add("GT-207", "4", "asset search q=ITFA-SPL", "200, the 4 CKSPL laptops", `${q.status} total=${q.json?.total}`, q.status === 200 && q.json?.total === 4);
const ol = await call(B, "GET", "/api/assets?limit=100", { token: O });
C.add("GT-208", "4", "asset list as operator SECOPIT (scope: CKSPL, IT)", "200, only CKSPL IT assets (4)", `${ol.status} total=${ol.json?.total} codes=${(ol.json?.items || []).map((a) => a.asset_code).join(",")}`,
  ol.status === 200 && (ol.json?.items || []).every((a) => a.asset_code.startsWith("CKSPL/ITFA")) && ol.json?.total === 4);
const a360 = await call(B, "GET", "/api/assets/1", { token: T });
const ev = await call(B, "GET", "/api/assets/1/events", { token: T });
const ch = await call(B, "GET", "/api/assets/1/changes", { token: T });
C.add("GT-209", "4", "Asset 360 of asset 1 (detail, history, changes)", "200/200/200", `${a360.status} ${a360.json?.asset_code} events=${ev.status}:${ev.json?.length} changes=${ch.status}`,
  a360.status === 200 && ev.status === 200 && ch.status === 200);
const xc = await call(B, "GET", "/api/assets/9", { token: O });
C.add("GT-210", "4", "operator SECOPIT opens a CKVPL asset (9)", "404 (company scope)", `${xc.status}`, xc.status === 404);

// PO list / detail
const pl = await call(B, "GET", "/api/purchase-orders", { token: T });
const pd = await call(B, "GET", "/api/purchase-orders/2", { token: T });
const lg = await call(B, "GET", "/api/purchase-orders/2/line-groups", { token: T });
C.add("GT-211", "4", "PO list and PO 2 detail + line groups", "200, 8 POs", `${pl.status} n=${pl.json?.length} detail=${pd.status} ${pd.json?.po_number} lines=${lg.status}:${lg.json?.length}`,
  pl.status === 200 && pl.json?.length === 8 && pd.status === 200 && lg.status === 200);

// Receive: 1 unit with a serial (operator, CKSPL laptop) and 1 unit without (head office, CKVPL chair)
const r1 = await call(B, "POST", "/api/purchase-orders/2/receive", { token: O, body: { received_into_asset_user_id: 3, invoice_number: "GT-NEW-INV-1",
  invoice_date: "2026-10-17", invoice_amount: 71980, lines: [{ line_no: 1, quantity: 1, serial_numbers: ["GTSERIAL0001"] }] } });
keep("receive serial", r1.json || r1.text);
C.add("GT-212", "4", "Receive PO 2 line 1: 1 laptop WITH serial, as operator SECOPIT", "200, 1 asset, serial GTSERIAL0001", `${r1.status} ${r1.text.slice(0, 260)}`,
  r1.status === 200 && r1.json?.assets_created === 1 && r1.json?.assets?.[0]?.serial_number === "GTSERIAL0001");
const r2 = await call(B, "POST", "/api/purchase-orders/6/receive", { token: T, body: { received_into_asset_user_id: 8, invoice_number: "GT-NEW-INV-2",
  invoice_date: "2026-10-17", invoice_amount: 5000, lines: [{ line_no: 2, quantity: 1 }] } });
keep("receive no serial", r2.json || r2.text);
C.add("GT-213", "4", "Receive PO 6 line 2: 1 chair WITHOUT serial, as SECHO", "200, 1 asset", `${r2.status} ${r2.text.slice(0, 260)}`, r2.status === 200 && r2.json?.assets_created === 1);
const newLaptop = r1.json?.assets?.[0]?.asset_id, newChair = r2.json?.assets?.[0]?.asset_id;

// Move to a person and back (operator) and the new chair (head office)
const m1 = await call(B, "POST", `/api/assets/${newLaptop}/events`, { token: O, body: { event_type: "MOVED", to_asset_user_id: 7, remarks: "GT move to person" } });
const m2 = await call(B, "POST", `/api/assets/${newLaptop}/events`, { token: O, body: { event_type: "MOVED", to_asset_user_id: 3, remarks: "GT move back" } });
C.add("GT-214", "4", `Move new laptop ${newLaptop} to person SECEMPS1 and back, as SECOPIT`, "201 ALLOTTED, 201 IN_STOCK", `${m1.status} ${m1.json?.status_after} / ${m2.status} ${m2.json?.status_after} ${m1.json ? "" : m1.text.slice(0, 150)}`,
  m1.status === 201 && m1.json?.status_after === "ALLOTTED" && m2.status === 201 && m2.json?.status_after === "IN_STOCK");
const m3 = await call(B, "POST", "/api/assets/3/events", { token: T, body: { event_type: "MOVED", to_asset_user_id: 7, remarks: "GT move existing asset to person" } });
const m4 = await call(B, "POST", "/api/assets/3/events", { token: T, body: { event_type: "MOVED", to_asset_user_id: 3, remarks: "GT move back" } });
C.add("GT-215", "4", "Move EXISTING (pre-migration) asset 3 to a person and back, as SECHO", "201 ALLOTTED, 201 IN_STOCK", `${m3.status} ${m3.json?.status_after} / ${m4.status} ${m4.json?.status_after}`,
  m3.status === 201 && m3.json?.status_after === "ALLOTTED" && m4.status === 201 && m4.json?.status_after === "IN_STOCK");
const m5 = await call(B, "POST", `/api/assets/${newChair}/events`, { token: T, body: { event_type: "MOVED", to_asset_user_id: 12, remarks: "GT chair to CKVPL person" } });
C.add("GT-216", "4", `Move new chair ${newChair} to CKVPL person SECEMPV1, as SECHO`, "201 ALLOTTED", `${m5.status} ${m5.json?.status_after}`, m5.status === 201 && m5.json?.status_after === "ALLOTTED");
const bad = await call(B, "POST", "/api/assets/9/events", { token: O, body: { event_type: "MOVED", to_asset_user_id: 7 } });
C.add("GT-217", "4", "operator moves a CKVPL asset (9)", "404 (company scope), nothing written", `${bad.status} ${bad.text.slice(0, 100)}`, bad.status === 404);

// Vendor create
const vn = `GT Gate Vendor ${Date.now()}`;
const v = await call(B, "POST", "/api/masters/vendors", { token: T, body: { name: vn, contact_name: "Gate Test" } });
C.add("GT-218", "4", "vendor create as SECHO", "201 with a generated code", `${v.status} ${v.json?.code} ${v.json?.name || v.text.slice(0, 120)}`, v.status === 201 && v.json?.name === vn);
// DECISIONS 2026-10-14 (3): an operator MAY add a vendor in the flow; changing one stays head-office-only.
// (The first run of this script expected 403 for the create -- a tester error, corrected; see GATE_REHEARSAL.md.)
const vop = await call(B, "POST", "/api/masters/vendors", { token: O, body: { name: vn + " op" } });
const vope = await call(B, "PUT", `/api/masters/vendors/${v.json?.id}`, { token: O, body: { name: vn + " renamed" } });
C.add("GT-219", "4", "operator SECOPIT: vendor create (in-flow) and vendor edit", "create 201 (DECISIONS 2026-10-14 (3)); edit 403 (head office only)",
  `create ${vop.status} edit ${vope.status} ${vope.text.slice(0, 100)}`, vop.status === 201 && vope.status === 403);

// Reports preview, dashboard
const rp = await call(B, "GET", "/api/reports/assets/preview?limit=50", { token: T });
const mv = await call(B, "GET", "/api/reports/movements/preview?from_date=2026-01-01&to_date=2026-12-31", { token: T });
const db = await call(B, "GET", "/api/reports/dashboard", { token: T });
C.add("GT-220", "4", "Reports: assets preview, movements preview, dashboard", "200/200/200", `${rp.status} rows=${rp.json?.total ?? rp.json?.rows?.length} / ${mv.status} ${mv.text.slice(0, 80)} / ${db.status}`,
  rp.status === 200 && mv.status === 200 && db.status === 200);

// Admin logs: the receive / move rows are there
const au = await call(B, "GET", "/api/admin/logs/audit?category=LIFECYCLE&limit=50", { token: T });
const auflat = JSON.stringify(au.json || {});
keep("audit lifecycle", au.json);
const ap = await call(B, "GET", "/api/admin/logs/audit?limit=50&q=GT-NEW-INV", { token: T });
keep("audit receive", ap.json);
C.add("GT-221", "4", "Admin logs: audit LIFECYCLE rows for the moves, PO RECEIVE rows", "200, rows present", `lifecycle=${au.status} hasMoves=${/MOVE|moved|Allotted/i.test(auflat)} receive=${ap.status} hasReceive=${JSON.stringify(ap.json || {}).includes("GT-NEW-INV")}`,
  au.status === 200 && /MOVE|moved|Allotted/i.test(auflat) && ap.status === 200 && JSON.stringify(ap.json || {}).includes("GT-NEW-INV"));
const er = await call(B, "GET", "/api/admin/logs/errors?limit=20", { token: T });
const sy = await call(B, "GET", "/api/admin/logs/system?limit=20", { token: T });
keep("errors", er.json);
C.add("GT-222", "4", "Admin logs: errors + system lists", "200/200", `${er.status} errors=${JSON.stringify(er.json || {}).slice(0, 200)} / ${sy.status}`, er.status === 200 && sy.status === 200);

// QR / label images (decoded in the container by re-encoding, see qrverify.py)
for (const [name, path] of [["qr_asset1", "/api/assets/1/qr.png"], ["labelqr_asset1", "/api/assets/1/label.png?symbol=qr"], ["labelbar_asset1", "/api/assets/1/label.png?symbol=barcode"]]) {
  const r = await fetch(B + path, { headers: { Authorization: "Bearer " + T } });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(`${GATE}/out/${name}.png`, buf);
  C.add(`GT-22${name === "qr_asset1" ? 3 : name === "labelqr_asset1" ? 4 : 5}`, "4", `GET ${path}`, "200 image/png", `${r.status} ${r.headers.get("content-type")} ${buf.length} bytes`, r.status === 200 && r.headers.get("content-type") === "image/png");
}
const qx = await call(B, "GET", "/api/assets/9/qr.png", { token: O });
C.add("GT-226", "4", "QR of a CKVPL asset as CKSPL operator", "404 (scope, QR is no backdoor)", `${qx.status}`, qx.status === 404);
fs.writeFileSync(`${GATE}/out/step4b_raw.txt`, raw.join("\n\n") + "\n");
fs.writeFileSync(`${GATE}/out/new_ids.json`, JSON.stringify({ newLaptop, newChair }));
C.save();
