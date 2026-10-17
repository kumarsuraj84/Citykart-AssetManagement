// GT step 6: give a migrated copy some NEW-code-only data before a downgrade: auth_session rows (sign-ins) and a
// raised token_version (sign-out with the refresh cookie ends every session of SECHO). usage: node seed_sessions.mjs <port>
import { call, login } from "./lib.mjs";
const B = `http://127.0.0.1:${process.argv[2]}`;
const a = await login(B, "SECHO");
const cookie = (a.headers.get("set-cookie") || "").split(";")[0];
const out = await call(B, "POST", "/api/auth/logout", { token: a.token, headers: { Cookie: cookie } });
const b = await login(B, "SECOPIT");
const c = await login(B, "SECHO");
console.log(`SECHO sign-in ${a.status} (cookie ${cookie ? "set" : "missing"}); logout ${out.status}; SECOPIT sign-in ${b.status}; SECHO sign-in again ${c.status}`);
