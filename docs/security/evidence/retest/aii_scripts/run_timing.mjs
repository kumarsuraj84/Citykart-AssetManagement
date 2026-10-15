// Runs timing.py inside the api container (passes BRUTE17's throw-away temp password as an argument; never printed).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DIR } from './lib.mjs';

const users = JSON.parse(fs.readFileSync(path.join(DIR, 'users.json'), 'utf8'));
const rounds = process.argv[2] || '36';
const r = spawnSync('docker', ['exec', '-w', '/app', 'ckam-sec-api-1', 'python', '/tmp/rt_timing.py', rounds, users.BRUTE17.temp],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
fs.writeFileSync(path.join(DIR, 'timing_out.json'), r.stdout || '');
console.log(r.status, (r.stderr || '').slice(-500));
try { console.log(JSON.stringify(JSON.parse(r.stdout).summary, null, 1)); } catch { console.log((r.stdout || '').slice(0, 1000)); }
