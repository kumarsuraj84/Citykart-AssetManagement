import { login, sleep } from './lib.mjs';
const r = [];
for (let i = 1; i <= 3; i++) { const x = await login('BRUTE31', 'stranger-guess-' + i); r.push(['stranger#'+i, x.status, x.json&&x.json.detail]); await sleep(600); }
console.log(JSON.stringify(r));
