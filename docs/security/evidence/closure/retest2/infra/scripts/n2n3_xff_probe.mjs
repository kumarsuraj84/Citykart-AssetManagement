// CL2-IF item 4 (N2 / N3): forged client-address headers.
// usage: node n2n3_xff_probe.mjs <nginx-base> <api-base> <label> [burst]
// Part A (always): 3 sign-in attempts through nginx and 3 straight to the API, each with an UNKNOWN login id (no
//   persona is touched) and forged X-Forwarded-For / X-Real-IP / Forwarded headers. Paced 3.5 s apart (shared IP,
//   sign-in limit 20/min). Prints the X-Request-ID of every answer so the audit_log rows can be looked up.
// Part B ("burst", ONLY on the private throw-away stack ckam-r2c where nobody else signs in): 21 failed sign-ins
//   through nginx and 21 straight to the API, every one with a DIFFERENT forged X-Forwarded-For and a different
//   unknown login id. If the forged header were believed each attempt would get a fresh bucket and never hit 429;
//   correct behaviour is 429 on the 21st (limit 20/min per address).
const [nginx, api, label, burst] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = Math.random().toString(36).slice(2, 8);
async function attempt(base, loginId, headers) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ login_id: loginId, password: "Wrong#Pass-r2c-1" }),
  });
  return { status: r.status, request_id: r.headers.get("x-request-id"), retry_after: r.headers.get("retry-after") };
}
const out = { label, nginx, api, partA: [], partB: {} };
const forged = [
  { name: "XFF single", h: { "X-Forwarded-For": "1.2.3.4" } },
  { name: "XFF list + X-Real-IP", h: { "X-Forwarded-For": "1.2.3.4, 5.6.7.8", "X-Real-IP": "9.9.9.9" } },
  { name: "Forwarded + XFF = trusted proxy address", h: { Forwarded: "for=1.2.3.4", "X-Forwarded-For": "172.31.212.10" } },
];
for (const [where, base] of [["via-nginx", nginx], ["direct-api", api]]) {
  for (const f of forged) {
    const loginId = `r2c-xff-${rnd}-${where}-${out.partA.length}`;
    const res = await attempt(base, loginId, f.h);
    out.partA.push({ where, case: f.name, login_id: loginId, sent: f.h, ...res });
    await sleep(3500);
  }
}
if (burst === "burst") {
  for (const [where, base] of [["via-nginx", nginx], ["direct-api", api]]) {
    const res = [];
    for (let i = 1; i <= 21; i++) {
      const r = await attempt(base, `r2c-burst-${rnd}-${where}-${i}`, { "X-Forwarded-For": `203.0.113.${i}`, "X-Real-IP": `198.51.100.${i}` });
      res.push(`${i}:${r.status}`);
    }
    out.partB[where] = res.join(" ");
    await sleep(61000); // let the minute window pass before the next part
  }
}
console.log(JSON.stringify(out, null, 1));
