import { login, sleep } from './lib.mjs';
console.log('draining rate-limit window (62s)...');
await sleep(62000);
const N = 20;
const t0 = Date.now();
const results = await Promise.all(Array.from({ length: N }, (_, i) => login('BRUTE32', 'parallel-wrong-' + i).then(x => x.status).catch(() => 'ERR')));
const hist = {}; for (const s of results) hist[s] = (hist[s] || 0) + 1;
console.log('parallel', N, 'wrong logins in', Date.now() - t0, 'ms; histogram:', JSON.stringify(hist));
