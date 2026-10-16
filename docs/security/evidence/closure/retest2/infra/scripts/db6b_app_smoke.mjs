// CL2-IF item 6(b): the real API running as the RUNTIME role r2c_app against the throw-away database ckam_r2c_rs
// (throw-away container of the ckam-sec api image on 127.0.0.1:8702; its own process, so its own sign-in limiter).
// usage: node db6b_app_smoke.mjs <base> <label>
// One good sign-in (SECHO), one failed sign-in with an unknown id (must create a SECURITY audit row), one ledger
// write (CORRECTION event on asset 3: asset_event + LIFECYCLE audit row in one transaction), one ordinary read.
const [base, label] = process.argv.slice(2);
const out = { label };
const j = (r) => r.json().catch(() => null);
let r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login_id: "SECHO", password: "Sec#Test2026ok" }) });
out.login_ok = r.status;
const tok = (await j(r))?.access_token;
r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login_id: "r2c-unknown-" + label, password: "Wrong#Pass-r2c-1" }) });
out.login_failed = r.status; out.login_failed_request_id = r.headers.get("x-request-id");
r = await fetch(base + "/api/assets/3/events", { method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
  body: JSON.stringify({ event_type: "CORRECTION", remarks: "cl2-if runtime-role probe " + label }) });
out.ledger_write = r.status; out.ledger_write_request_id = r.headers.get("x-request-id");
const body = await j(r); out.ledger_write_body = body && (body.id ? { id: body.id, event_type: body.event_type } : body);
r = await fetch(base + "/api/assets?limit=5", { headers: { Authorization: "Bearer " + tok } });
out.read_assets = r.status;
console.log(JSON.stringify(out, null, 1));
