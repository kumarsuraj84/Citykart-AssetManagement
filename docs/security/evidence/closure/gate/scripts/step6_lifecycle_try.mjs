// GT step 6/7: try the write paths that touch an asset's lifecycle fields as SECHO against 127.0.0.1:<port>, and record
// the exact answer the user would get.
// usage: node step6_lifecycle_try.mjs <port> <label> <expect: ok|refused> <casePrefix> <step> [moveAssetId] [saleAssetId]
import fs from "node:fs";
import { call, login, Cases, GATE, redact } from "./lib.mjs";
const [port, label, expect, prefix, step, mvArg, saleArg] = process.argv.slice(2);
const MV = Number(mvArg || 5), SALE = Number(saleArg || 7);
const B = `http://127.0.0.1:${port}`;
const C = new Cases(`${GATE}/out/cases_${label}.csv`);
const raw = [];
const ok = expect === "ok";
let k = 0;
const id = () => `${prefix}${String(k++).padStart(2, "0")}`;
const h = await call(B, "GET", "/api/health");
const l = await login(B, "SECHO");
C.add(id(), step, `[${label}] health + sign-in SECHO`, "200 / 200", `${h.status} / ${l.status} ${l.json ? "" : l.text.slice(0, 200)}`, h.status === 200 && l.status === 200);
const t = l.token;

// Receive 1 unit of the first PO line still waiting (PO 6, 4, 8, 2)
let PO = 6, ri = null, line = null;
for (const p of [6, 4, 8, 2]) {
  const x = await call(B, "GET", `/api/purchase-orders/${p}/receive-info`, { token: t });
  const w = (x.json?.lines || []).find((y) => y.waiting > 0);
  if (w) { PO = p; ri = x.json; line = w; break; }
}
const serial = line?.serial_mode === "HAS_SERIAL" ? [`GTS${label.replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}${Date.now() % 100000}`] : undefined;
const body = { received_into_asset_user_id: ri?.received_into_asset_user_id, invoice_number: `GT-${label}-INV`, invoice_date: "2026-10-17", invoice_amount: 100,
  lines: [{ line_no: line?.line_no ?? 1, quantity: 1, ...(serial ? { serial_numbers: serial } : {}) }] };
const before = (await call(B, "GET", "/api/assets?limit=1", { token: t })).json?.total;
const r = await call(B, "POST", `/api/purchase-orders/${PO}/receive`, { token: t, body });
raw.push(`RECEIVE PO ${PO} line ${body.lines[0].line_no} (${line?.serial_mode}): ${r.status} ${redact(r.text)}`);
const after = (await call(B, "GET", "/api/assets?limit=1", { token: t })).json?.total;
C.add(id(), step, `[${label}] Receive PO ${PO} line ${body.lines[0].line_no} (1 unit, ${line?.serial_mode}) as SECHO`, ok ? "200, 1 asset" : "refused, nothing half-written",
  `${r.status} ${r.text.slice(0, 260)} | assets before/after ${before}/${after}`,
  ok ? r.status === 200 && after === before + 1 : r.status >= 400 && after === before);

// Move to a person (and back when it worked)
const evBefore = (await call(B, "GET", `/api/assets/${MV}/events`, { token: t })).json?.length;
const stBefore = (await call(B, "GET", `/api/assets/${MV}`, { token: t })).json?.status;
const m = await call(B, "POST", `/api/assets/${MV}/events`, { token: t, body: { event_type: "MOVED", to_asset_user_id: 7, remarks: `GT ${label} move` } });
raw.push(`MOVE asset ${MV} -> person 7: ${m.status} ${redact(m.text)}`);
const am = (await call(B, "GET", `/api/assets/${MV}`, { token: t })).json;
const evAfter = (await call(B, "GET", `/api/assets/${MV}/events`, { token: t })).json?.length;
C.add(id(), step, `[${label}] Move asset ${MV} (${stBefore}) to person SECEMPS1`, ok ? "201 ALLOTTED" : "refused; asset unchanged, no event row",
  `${m.status} ${m.text.slice(0, 260)} | status now=${am?.status} events ${evBefore}->${evAfter}`,
  ok ? m.status === 201 && am?.status === "ALLOTTED" : m.status >= 400 && am?.status === stBefore && evAfter === evBefore);
if (ok && m.status === 201) {
  const back = await call(B, "POST", `/api/assets/${MV}/events`, { token: t, body: { event_type: "MOVED", to_asset_user_id: am?.company_id === 2 ? 8 : 3, remarks: `GT ${label} back` } });
  raw.push(`MOVE asset ${MV} back to stock room: ${back.status} ${back.json?.status_after}`);
}

// Sale
const s = await call(B, "POST", `/api/assets/${SALE}/events`, { token: t, body: { event_type: "SOLD", remarks: `GT ${label} sale`, reference_no: "GT-SALE" } });
raw.push(`SOLD asset ${SALE}: ${s.status} ${redact(s.text)}`);
const as = (await call(B, "GET", `/api/assets/${SALE}`, { token: t })).json;
C.add(id(), step, `[${label}] Sale (SOLD) of asset ${SALE} (in stock)`, ok ? "201 SOLD" : "refused; asset still IN_STOCK",
  `${s.status} ${s.text.slice(0, 260)} | status now=${as?.status}`, ok ? s.status === 201 && as?.status === "SOLD" : s.status >= 400 && as?.status === "IN_STOCK");
const ed = await call(B, "GET", "/api/assets/8", { token: t });
C.add(id(), step, `[${label}] read of an asset still works`, "200", `${ed.status} ${ed.json?.asset_code}`, ed.status === 200);
fs.writeFileSync(`${GATE}/out/${label}_raw.txt`, raw.join("\n") + "\n");
C.save();
