// Compare two content lists ("<sha256>  <path>") file by file. usage: node pkgdiff.mjs <old list> <new list>
import { readFileSync } from "node:fs";
const load = (f) => new Map(readFileSync(f, "utf8").trim().split("\n").map((l) => { const i = l.indexOf("  "); return [l.slice(i + 2), l.slice(0, i)]; }));
const a = load(process.argv[2]);
const b = load(process.argv[3]);
const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
let same = 0;
const rows = [];
for (const p of paths) {
  if (a.get(p) === b.get(p)) { same++; continue; }
  rows.push(`| ${!a.has(p) ? "added" : !b.has(p) ? "removed" : "changed"} | \`${p}\` | ${a.has(p) ? "`" + a.get(p) + "`" : "—"} | ${b.has(p) ? "`" + b.get(p) + "`" : "—"} |`);
}
console.log(`identical: ${same}; different: ${rows.length}; old files ${a.size}, new files ${b.size}`);
console.log("| change | file | SHA-256 in eed3de1 | SHA-256 in ccae7b2 |\n|---|---|---|---|");
console.log(rows.join("\n"));
