#!/usr/bin/env node
// Security AU-12 / FONTS permanent check of a production build (`npm run build`, then `npm run check:build`).
// Fails (exit 1) when the built folder:
//   * contains any source map file (*.map)                                   -- AU-12
//   * contains a `sourceMappingURL` directive in any file                    -- AU-12
//   * mentions fonts.googleapis.com / fonts.gstatic.com anywhere             -- FONTS (fonts are self-hosted)
//   * loads a script / stylesheet / font / picture from another site in index.html (absolute http(s):// or
//     protocol-relative //host URLs), or a stylesheet pulls a url()/@import from another site   -- AU-14 CSP 'self'
// Usage: node scripts/check-build-security.mjs [distDir]   (default: ./dist next to package.json)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEXT = /\.(?:html?|js|mjs|cjs|css|json|txt|svg|xml|webmanifest)$/i;
const GOOGLE = /fonts\.googleapis\.com|fonts\.gstatic\.com/i;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i; // http://, https://, //host

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Every URL that index.html makes the browser fetch: script src, link href, img/source/iframe src, srcset. */
function htmlResourceUrls(html) {
  const urls = [];
  const tag = /<(script|link|img|source|iframe|embed|object|audio|video)\b[^>]*>/gi;
  for (const m of html.matchAll(tag)) {
    for (const a of m[0].matchAll(/\b(src|href|data|srcset)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const value = a[3] ?? a[4] ?? a[5] ?? "";
      if (a[1].toLowerCase() === "srcset") urls.push(...value.split(",").map((s) => s.trim().split(/\s+/)[0]));
      else urls.push(value.trim());
    }
  }
  return urls.filter(Boolean);
}

export function checkBuild(distDir) {
  const problems = [];
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    return [`no build found: ${path.join(distDir, "index.html")} does not exist (run \`npm run build\` first)`];
  }
  const files = walk(distDir);
  for (const file of files) {
    const rel = path.relative(distDir, file).split(path.sep).join("/");
    if (/\.map$/i.test(file)) problems.push(`source map file in the build: ${rel}`);
    if (!TEXT.test(file)) continue;
    const text = fs.readFileSync(file, "utf-8");
    if (/[#@]\s*sourceMappingURL\s*=/.test(text)) problems.push(`sourceMappingURL directive in ${rel}`);
    if (GOOGLE.test(text)) problems.push(`Google Fonts host referenced in ${rel}`);
    if (/\.css$/i.test(file)) {
      for (const m of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
        if (EXTERNAL.test(m[2].trim())) problems.push(`stylesheet ${rel} loads an external url(): ${m[2].trim()}`);
      }
      for (const m of text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) {
        if (EXTERNAL.test(m[1])) problems.push(`stylesheet ${rel} @imports an external file: ${m[1]}`);
      }
    }
  }
  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
  for (const url of htmlResourceUrls(html)) {
    if (EXTERNAL.test(url)) problems.push(`index.html loads an external resource: ${url}`);
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(process.argv[2] || path.join(here, "..", "dist"));
  const problems = checkBuild(distDir);
  if (problems.length) {
    console.error(`check:build FAILED for ${distDir}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const count = walk(distDir).length;
  console.log(`check:build OK: ${count} files in ${distDir}; no source maps, no sourceMappingURL, no Google Fonts host, no external resource in index.html or the stylesheets.`);
}
