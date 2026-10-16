// Builds the markdown result table (and a combined CSV) from raw/main_summary.json, raw/main_summary_repeat.json,
// raw/rl_summary.json and the sample CSVs.  node make_table.mjs > raw/table.md
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAW = join(dirname(fileURLToPath(import.meta.url)), "raw");
const main = JSON.parse(readFileSync(join(RAW, "main_summary.json"), "utf8"));
const rep = JSON.parse(readFileSync(join(RAW, "main_summary_repeat.json"), "utf8"));
const rl = JSON.parse(readFileSync(join(RAW, "rl_summary.json"), "utf8"));
const repBy = Object.fromEntries(rep.summary.map((r) => [r.key, r]));
const INVALID_REPEAT = new Set(["vendor_create", "item_create"]);   // repeat reused the first run's names -> 422
const bytes = {};
for (const line of readFileSync(join(RAW, "main_samples.csv"), "utf8").trim().split("\n").slice(1)) {
  const [, op, stack, , , , b] = line.split(",");
  bytes[`${op}_${stack}`] = +b;
}
const f = (x) => (Math.round(x * 10) / 10).toFixed(1);
const lines = [];
lines.push("| # | Operation | n | Old median | Old p95 | New median | New p95 | Δ median (ms) | Ratio median | Ratio p95 | Verdict | Repeat run ratio (median) |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
const csv = ["op,label,n,old_median,old_p95,new_median,new_p95,delta_median_ms,ratio_median,ratio_p95,verdict_median,verdict_p95,repeat_ratio_median,repeat_old_median,repeat_new_median"];
let k = 0;
const all = [...main.summary];
all.splice(1, 0, { ...rl, n: rl.old.n, delta_median_ms: rl.new.median - rl.old.median, verdict_p95: (rl.new.p95 - rl.old.p95) <= Math.max(rl.old.p95 * 0.25, 50) ? "OK" : "SLOWER" });
for (const r of all) {
  k += 1;
  const rp = repBy[r.key];
  const repTxt = !rp ? "–" : INVALID_REPEAT.has(r.key) ? "n/a (name clash)" : `${rp.ratio_median.toFixed(2)} (${f(rp.old.median)} → ${f(rp.new.median)})`;
  const by = bytes[`${r.key}_old`] !== undefined && (r.key.startsWith("static") || r.key.startsWith("uv_")) ? ` [${bytes[`${r.key}_old`]} B / ${bytes[`${r.key}_new`]} B]` : "";
  let verdict = r.verdict === "OK" ? "OK" : "**SLOWER**";
  if (r.key === "login_unknown") verdict = "By design (AU-01)";
  lines.push(`| ${k} | ${r.label}${by} | ${r.n} | ${f(r.old.median)} | ${f(r.old.p95)} | ${f(r.new.median)} | ${f(r.new.p95)} | ${r.delta_median_ms >= 0 ? "+" : ""}${f(r.delta_median_ms)} | ${r.ratio_median.toFixed(2)} | ${r.ratio_p95.toFixed(2)} | ${verdict} | ${repTxt} |`);
  csv.push([r.key, `"${r.label}"`, r.n, f(r.old.median), f(r.old.p95), f(r.new.median), f(r.new.p95), f(r.delta_median_ms), r.ratio_median.toFixed(3), r.ratio_p95.toFixed(3), r.verdict, r.verdict_p95,
    rp && !INVALID_REPEAT.has(r.key) ? rp.ratio_median.toFixed(3) : "", rp && !INVALID_REPEAT.has(r.key) ? f(rp.old.median) : "", rp && !INVALID_REPEAT.has(r.key) ? f(rp.new.median) : ""].join(","));
}
writeFileSync(join(RAW, "summary_table.csv"), csv.join("\n") + "\n");
console.log(lines.join("\n"));
