// GT step 4d: sign-in rate limiting of the PACKAGE (20/min per address, 10/min per login id) without touching any
// persona: only login ids that do not exist are used, so no account gets a failed-login count or a lock.
import { call, Cases, GATE, sleep, PW } from "./lib.mjs";
const B = "http://127.0.0.1:4111";
const C = new Cases(`${GATE}/out/cases_step4d.csv`);
const post = (id, headers = {}) => call(B, "POST", "/api/auth/login", { body: { login_id: id, password: "wrong-" + id }, headers });
console.log("waiting 65 s for a clean window"); await sleep(65000);
const st = [];
for (let i = 1; i <= 20; i++) st.push((await post(`gt-nobody-${i}-${Date.now()}`, { "X-Forwarded-For": `203.0.113.${i}` })).status);
const r21 = await post(`gt-nobody-21-${Date.now()}`, { "X-Forwarded-For": "198.51.100.77" });
C.add("GT-400", "4", "20 sign-ins from one address (unknown ids, each with a different forged X-Forwarded-For)", "all 401 (allowed, wrong credentials)", st.join(","), st.every((s) => s === 401));
C.add("GT-401", "4", "21st sign-in from the same address within 60 s (forged X-Forwarded-For again)", "429, forged header does not dodge the limit (--no-proxy-headers)", `${r21.status} retry-after=${r21.headers.get("retry-after")} ${r21.text.slice(0, 160)}`, r21.status === 429);
const real = await call(B, "POST", "/api/auth/login", { body: { login_id: "SECHO", password: PW } });
C.add("GT-402", "4", "a real persona during the address block", "429 too (per-address limit), not a lock-out", `${real.status}`, real.status === 429);
console.log("waiting 65 s"); await sleep(65000);
const one = `gt-nobody-same-${Date.now()}`;
const st2 = [];
for (let i = 1; i <= 11; i++) st2.push((await post(one)).status);
C.add("GT-403", "4", "11 sign-ins for ONE login id within 60 s", "1-10: 401, 11th: 429", st2.join(","), st2.slice(0, 10).every((s) => s === 401) && st2[10] === 429);
console.log("waiting 65 s"); await sleep(65000);
const ok = await call(B, "POST", "/api/auth/login", { body: { login_id: "SECHO", password: PW } });
C.add("GT-404", "4", "SECHO signs in after the window passed", "200 (persona not locked by the rate-limit test)", `${ok.status} token=${!!ok.json?.access_token}`, ok.status === 200);
C.save();
