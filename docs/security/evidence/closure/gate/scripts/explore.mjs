import { call, login } from "./lib.mjs";
const B = process.argv[2] || "http://127.0.0.1:4112";
const l = await login(B, "SECHO");
console.log("login", l.status, Object.keys(l.json || {}));
const t = l.token;
const pos = await call(B, "GET", "/api/purchase-orders", { token: t });
console.log("POs", pos.status, (pos.json || []).map((p) => `${p.id}:${p.company_id}:${p.po_number}:${p.status}:wait${p.waiting_units}:act${p.is_active}`).join(" | "));
for (const id of [2, 6]) {
  const ri = await call(B, "GET", `/api/purchase-orders/${id}/receive-info`, { token: t });
  console.log("receive-info", id, ri.status, JSON.stringify(ri.json).slice(0, 900));
}
const as = await call(B, "GET", "/api/assets?limit=50", { token: t });
const list = Array.isArray(as.json) ? as.json : as.json?.items || [];
console.log("assets", as.status, list.length, list.slice(0, 16).map((a) => `${a.id}:${a.asset_code}:${a.status}:${a.current_asset_user_id}`).join(" | "));
const au = await call(B, "GET", "/api/asset-users?limit=100", { token: t });
const aul = Array.isArray(au.json) ? au.json : au.json?.items || [];
console.log("asset-users", au.status, aul.length, aul.slice(0, 40).map((u) => `${u.id}:${u.code || u.name}:${u.type}:${u.company_id}`).join(" | "));
