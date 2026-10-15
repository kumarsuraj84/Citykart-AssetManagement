// IF-T ERP company isolation probe on the ckam-sec stack (local only, read-only GETs).
// CKSPL operator SECOPIT asks for CKVPL ERP PO drafts / lists; CKVPL operator SECOPITV as control.
const API = "http://127.0.0.1:8200";
const PW = "Sec#Test2026ok";
async function login(id) {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login_id: id, password: PW }) });
  return (await r.json()).access_token;
}
function summarize(body) {
  if (!body || typeof body !== "object") return String(body).slice(0, 200);
  const s = JSON.stringify(body);
  return s.length > 600 ? s.slice(0, 600) + "..." : s;
}
const cases = [
  ["SECOPIT", "/api/erp/pos/9002002/draft", "CKSPL operator -> CKVPL open ERP PO draft (expect 403/404)"],
  ["SECOPIT", "/api/erp/pos/9001002/draft", "CKSPL operator -> own CKSPL ERP PO draft (control, expect 200)"],
  ["SECOPITV", "/api/erp/pos/9001002/draft", "CKVPL operator -> CKSPL open ERP PO draft (expect 403/404)"],
  ["SECOPIT", "/api/erp/pos?envelope=true", "CKSPL operator ERP PO list: must not list CKVPL POs"],
  ["SECOPIT", "/api/erp/pos/9002002/receipts", "CKSPL operator -> CKVPL receipts"],
  ["SECOPIT", "/api/erp/pos/9002002/pi", "CKSPL operator -> CKVPL PI"],
];
const tokens = {};
for (const [who, path, label] of cases) {
  tokens[who] ??= await login(who);
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${tokens[who]}` } });
  let body; try { body = await r.json(); } catch { body = "<non-json>"; }
  console.log(`\n### ${label}\n${who} GET ${path} -> ${r.status}\n${summarize(body)}`);
}
