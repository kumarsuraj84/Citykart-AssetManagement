import fs from 'node:fs';
const API = 'http://127.0.0.1:8200';
const DIR = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/cl1';
const TOK = fs.readFileSync(`${DIR}/secho.tok`, 'utf8').trim();
const created = JSON.parse(fs.readFileSync(`${DIR}/race/created_ids.json`, 'utf8'));
for (const { kind, id } of created) {
  const r = await fetch(`${API}/api/masters/${kind}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOK}` } });
  console.log(`DELETE ${kind}/${id} -> ${r.status}`);
}
