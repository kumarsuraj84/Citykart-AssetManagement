import { API, sleep } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const PACE = 6800, TARGET = 35;

async function timedLogin(login_id, password) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_id, password }) });
    status = res.status; await res.text();
  } catch { status = 'ERR'; }
  return { ms: performance.now() - t0, status };
}

// categories: distinct login ids so per-login-id buckets don't overlap
const cats = {
  right_password: () => timedLogin('CL2TIM', creds.CL2TIM.temp),
  wrong_password: () => timedLogin('CL2OTHER', 'definitely-wrong-password'),
  unknown_user:  () => timedLogin('nosuchuser-' + Math.random().toString(36).slice(2, 10), 'x'),
  disabled_user: () => timedLogin('SECDIS', 'Sec#Test2026ok'),
  locked_user:   () => timedLogin('SECLOCK', 'Sec#Test2026ok'),
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

const out = {};
for (const [name, fn] of Object.entries(cats)) {
  const samples = []; let r429 = 0, tries = 0;
  while (samples.length < TARGET && tries < TARGET * 3) {
    tries++;
    const r = await fn();
    if (r.status === 429) { r429++; await sleep(PACE * 2); continue; }
    samples.push(r.ms);
    await sleep(PACE);
  }
  out[name] = { n: samples.length, median_ms: +median(samples).toFixed(1), p25_ms: +pct(samples, 25).toFixed(1), p75_ms: +pct(samples, 75).toFixed(1), min_ms: +Math.min(...samples).toFixed(1), max_ms: +Math.max(...samples).toFixed(1), rate_limited_skipped: r429 };
  console.log(name, JSON.stringify(out[name]));
}
const meds = Object.values(out).map(o => o.median_ms);
out._spread_ms = +(Math.max(...meds) - Math.min(...meds)).toFixed(1);
console.log('median spread across categories (ms):', out._spread_ms);
writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/a7_timing.json', JSON.stringify(out, null, 2));
console.log('TIMING DONE');
