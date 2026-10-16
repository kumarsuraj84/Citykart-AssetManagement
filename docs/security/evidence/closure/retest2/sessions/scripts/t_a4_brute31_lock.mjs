import { login, sleep } from './lib.mjs';
import { readFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const r = [];
for (let i = 1; i <= 5; i++) { const x = await login('BRUTE31', 'wrong-pw-' + i); r.push(['wrong#'+i, x.status, x.json&&x.json.detail]); await sleep(600); }
// 6th attempt with the CORRECT password -> must be 423 (a lock is a lock)
const correct = await login('BRUTE31', creds.BRUTE31.temp); r.push(['correct#6', correct.status, correct.json&&correct.json.detail]);
console.log(JSON.stringify(r, null, 0));
