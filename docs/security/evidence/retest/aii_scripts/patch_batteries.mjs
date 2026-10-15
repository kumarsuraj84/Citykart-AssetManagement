// Copies the original INPUT batteries into rt_aii with (1) paced + cached logins through lib.mjs (rate limit now
// 20/min per address) and (2) output files in rt_aii. Test logic is unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { DIR } from './lib.mjs';

const SRC = 'D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/input';
const OLD_OUT = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/input/';
const LOGIN = "async function login(c){ const s = await (await import('./lib.mjs')).session(c); return s.access; }";
for (const f of ['api_battery.mjs', 'api_battery2.mjs', 'plant_xss.mjs']) {
  let t = fs.readFileSync(path.join(SRC, f), 'utf8');
  t = t.replace(/async function login\((?:code|c)\)\s*\{[\s\S]*?\n\}/, LOGIN);      // multi-line form
  t = t.replace(/async function login\(c\)\{[^\n]*\}/, LOGIN);                      // one-line form
  t = t.split(OLD_OUT).join(DIR + '/');
  fs.writeFileSync(path.join(DIR, 'rt_' + f), t);
  console.log(f, t.includes("import('./lib.mjs')") ? 'patched' : 'NOT PATCHED');
}
