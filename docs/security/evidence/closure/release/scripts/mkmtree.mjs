// Write a deterministic mtree spec for the release folder: sorted paths, fixed time (commit time), uid/gid 0,
// fixed modes. bsdtar then builds the zip from this spec, so no atime/ctime/owner of the build PC leaks in and
// a rebuild of the same folder is byte-identical.
// usage: node mkmtree.mjs <releaseFolder> <out.mtree> <epochSeconds>
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [root, out, epoch] = process.argv.slice(2);
const entries = [];
function walk(rel) {
  const abs = path.join(root, rel);
  for (const d of readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) { entries.push({ r, dir: true }); walk(r); }
    else if (d.isFile()) entries.push({ r, dir: false });
    else throw new Error(`unexpected entry type: ${r}`);
  }
}
walk("");
entries.sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));
const esc = (s) => s.replace(/[^A-Za-z0-9._\-\/+]/g, (c) => "\\" + c.charCodeAt(0).toString(8).padStart(3, "0"));
// Entry names without a "./" prefix (bsdtar here has no -s to strip it). In mtree a name WITHOUT a slash is
// "relative" (a directory without a slash would be descended into), so top-level directories are not listed
// as entries (they are implied by the files' paths); every other line contains a slash = a full path.
const lines = ["#mtree"];
for (const e of entries) {
  const p = esc(e.r);
  if (e.dir && !e.r.includes("/")) continue;
  lines.push(e.dir
    ? `${p} type=dir mode=0755 uid=0 gid=0 time=${epoch}.0`
    : `${p} type=file mode=0644 uid=0 gid=0 time=${epoch}.0 contents=${p}`);
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(`entries: ${entries.length} (dirs ${entries.filter((e) => e.dir).length}, files ${entries.filter((e) => !e.dir).length})`);
