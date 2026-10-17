// GT step 2: the LIVE release 3b5e842 against the restored OLD-schema dataset (e6f8a0b2c4d6): receive + move work.
import { call, login, Cases, GATE } from "./lib.mjs";
const B = "http://127.0.0.1:4112";
const C = new Cases(GATE + "/out/cases_step2.csv");
const h = await call(B, "GET", "/api/health");
C.add("GT-020", "2", "old code health", "200 ok", `${h.status} ${h.text}`, h.status === 200);
const l = await login(B, "SECHO");
C.add("GT-021", "2", "old code sign-in SECHO", "200 + access token", `${l.status} token=${!!l.token}`, l.status === 200 && !!l.token);
const t = l.token;
const body = { received_into_asset_user_id: 3, invoice_number: "GT-OLD-INV-1", invoice_date: "2026-10-17", invoice_amount: 1000,
  lines: [{ line_no: 2, quantity: 1 }] };
const r = await call(B, "POST", "/api/purchase-orders/2/receive", { token: t, body });
C.add("GT-022", "2", "old code receive PO 2 line 2 (1 chair, no serial)", "200, 1 asset created", `${r.status} ${r.text.slice(0, 300)}`, r.status === 200 && r.json?.assets_created === 1);
const newId = r.json?.assets?.[0]?.asset_id;
const m1 = await call(B, "POST", "/api/assets/3/events", { token: t, body: { event_type: "MOVED", to_asset_user_id: 7, remarks: "GT baseline move to person" } });
C.add("GT-023", "2", "old code move asset 3 -> person SECEMPS1 (7)", "201 ALLOTTED", `${m1.status} ${m1.json?.status_after} ${m1.json?.label || m1.text.slice(0, 200)}`, m1.status === 201 && m1.json?.status_after === "ALLOTTED");
const m2 = await call(B, "POST", "/api/assets/3/events", { token: t, body: { event_type: "MOVED", to_asset_user_id: 3, remarks: "GT baseline move back" } });
C.add("GT-024", "2", "old code move asset 3 back to stock room 3", "201 IN_STOCK", `${m2.status} ${m2.json?.status_after} ${m2.json?.label || m2.text.slice(0, 200)}`, m2.status === 201 && m2.json?.status_after === "IN_STOCK");
console.log("new asset id from old receive:", newId);
C.save();
