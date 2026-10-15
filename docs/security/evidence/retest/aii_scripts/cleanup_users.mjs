// Deactivates (soft, is_active=false) the throw-away BRUTE11..BRUTE19 accounts created for this retest.
import fs from 'node:fs';
import path from 'node:path';
import { DIR, req, session } from './lib.mjs';

const users = JSON.parse(fs.readFileSync(path.join(DIR, 'users.json'), 'utf8'));
const ho = await session('SECHO');
for (const [code, u] of Object.entries(users)) {
  const r = await req('DELETE', `/api/asset-users/${u.id}`, { token: ho.access });
  console.log(code, u.id, r.status, r.status === 204 ? '' : r.raw.slice(0, 120));
}
