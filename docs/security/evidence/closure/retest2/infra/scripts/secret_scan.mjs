// CL2-IF item 8: regex secret scan (no gitleaks / trufflehog image is present locally and pulling is not allowed).
// VALUES ARE NEVER PRINTED: each hit is reported as rule | place | classification | value length | sha256[0:8].
// Scanned: (1) working tree = tracked + untracked-not-ignored files, (2) every commit of `git log --all -p`
// (added lines), (3) the built frontend dist (copied out of the ckam-sec-web image), (4) `docker history --no-trunc`
// of every local CKAM image, (5) environment of running CKAM containers (KEY NAMES + classification only),
// (6) text files inside the ckam-sec api image (/app) via a throw-away container.
// usage: node secret_scan.mjs <repo> <dist-dir> <out-json>
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const [REPO, DIST, OUT] = process.argv.slice(2);
const RULES = {
  jwt: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g,
  private_key: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  db_url_with_password: /\b(?:postgres(?:ql)?(?:\+asyncpg|\+psycopg2?)?|mysql|mssql|redis|mongodb(?:\+srv)?):\/\/[^:\/\s'"@]+:([^@\s'"]+)@/g,
  secret_assignment: /\b(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|PWD)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"'`,;)]{6,})/g,
  aws_key: /\bAKIA[0-9A-Z]{16}\b/g,
  github_token: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  slack_token: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  google_api_key: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  llm_api_key: /\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}\b/g,
  cookie_refresh: /refresh_token=[A-Za-z0-9._-]{20,}/g,
  net_use_password: /net\s+use\s+\S+\s+(?!\/user)(\S{6,})\s+\/user/gi,
};
// Known public placeholders / throw-away test values (matching is case-insensitive substring).
const PLACEHOLDER = ["change_me", "changeme", "dev_secret", "ckam_dev_pw", "example", "placeholder", "<", "${", "%(", "xxx",
  "***", "redacted", "your_", "your-", "fake", "dummy", "secret_here", "password_here", "not-a-real", "notreal", "sample",
  "...", "$env:", "$(", "read-host", "getnetworkcredential", "securestring"];
const TESTVAL = ["sec_test_pw", "sec#test2026ok", "throwaway", "throw-away", "r2c_", "test", "uat_", "e2e", "wrong#pass",
  "granite#meadow", "password@2026", "welcome@2026", "admin@2026", "qwerty", "india@2026", "canary", "probe"];
function classify(value, where) {
  const v = (value || "").toLowerCase();
  if (!v) return "empty";
  if (PLACEHOLDER.some((p) => v.includes(p))) return "placeholder";
  if (TESTVAL.some((p) => v.includes(p))) return "test-or-throwaway";
  if (/(^|\/)(tests?|fixtures?|e2e)\//i.test(where) || /test_|\.test\.|spec\./i.test(where)) return "in-test-file";
  if (/^[a-z_]+$/i.test(value) && value.length < 25 && !/[0-9]/.test(value)) return "identifier-not-secret";
  return "REVIEW";
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
const hits = [];
function scanText(text, where, source) {
  for (const [rule, re] of Object.entries(RULES)) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const value = m[1] !== undefined ? m[1] : m[0];
      // secret_assignment: skip obvious code references (os.environ[...], settings.x, a variable name, a type)
      if (rule === "secret_assignment" && /^(os\.|settings\.|self\.|str\b|None\b|null\b|true\b|false\b|Field\(|getenv|process\.env|\$\{|\{\{|\(|\[|request\.|body\.|data\.|args\.|[a-z_]+\(|[a-z_]+\.[a-z_]+)/i.test(value)) continue;
      hits.push({ source, where, rule, class: classify(value, where), len: value.length, sha8: sha(value) });
    }
  }
}
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 30 });
// (1) working tree
const files = git(["ls-files", "-co", "--exclude-standard"]).split("\n").filter(Boolean);
let scannedFiles = 0;
for (const f of files) {
  const p = path.join(REPO, f);
  let buf;
  try { buf = fs.readFileSync(p); } catch { continue; }
  if (buf.length > 20 * 1024 * 1024 || buf.includes(0)) continue; // binary (png, xlsx, woff2) skipped
  scannedFiles++;
  scanText(buf.toString("utf8"), f, "worktree");
}
// (2) git history (added lines of every commit on every ref)
const commits = git(["rev-list", "--all"]).split("\n").filter(Boolean).length;
await new Promise((resolve) => {
  const p = spawn("git", ["log", "--all", "-p", "--no-color", "--no-ext-diff", "--format=COMMIT %h"], { cwd: REPO });
  let buf = "", commit = "", file = "";
  p.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.startsWith("COMMIT ")) commit = line.slice(7);
      else if (line.startsWith("+++ b/")) file = line.slice(6);
      else if (line.startsWith("+") && !line.startsWith("+++")) scanText(line.slice(1), `${commit}:${file}`, "history");
    }
  });
  p.on("close", resolve);
});
// (3) built frontend dist
let distFiles = 0;
for (const f of fs.readdirSync(DIST, { recursive: true })) {
  const p = path.join(DIST, String(f));
  if (!fs.statSync(p).isFile()) continue;
  const buf = fs.readFileSync(p);
  if (buf.includes(0)) continue;
  distFiles++;
  scanText(buf.toString("utf8"), "dist/" + f, "dist");
  if (/10\.0\.\d+\.\d+|citykart_newservers|\\\\10\./.test(buf.toString("utf8"))) hits.push({ source: "dist", where: "dist/" + f, rule: "internal_host_reference", class: "REVIEW", len: 0, sha8: "-" });
}
// (4) docker history of every local CKAM image
const images = execFileSync("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"], { encoding: "utf8" })
  .split("\n").filter((x) => /^ckam/.test(x));
for (const img of images) {
  const h = execFileSync("docker", ["history", "--no-trunc", "--format", "{{.CreatedBy}}", img], { encoding: "utf8", maxBuffer: 1 << 26 });
  scanText(h, img, "docker-history");
}
// (5) environment of running CKAM containers: key names + classification of the value only
const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).split("\n").filter((x) => /^ckam-/.test(x));
const envKeys = {};
for (const c of containers) {
  const env = JSON.parse(execFileSync("docker", ["inspect", c, "--format", "{{json .Config.Env}}"], { encoding: "utf8" }));
  envKeys[c] = env.map((kv) => {
    const k = kv.slice(0, kv.indexOf("=")); const v = kv.slice(kv.indexOf("=") + 1);
    const sensitive = /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|PGPASS/i.test(k) && !/GPG_KEY/.test(k);
    if (!sensitive) return k;
    let pw = v; const m = /:\/\/[^:]+:([^@]+)@/.exec(v); if (m) pw = m[1];
    return `${k}[${v ? classify(pw, c) : "empty"}]`;
  });
}
// (6) files inside the api image that look like secrets (via throw-away container, python is in the image)
const inImage = execFileSync("docker", ["run", "--rm", "--network", "none", "--entrypoint", "python", "ckam-sec-api", "-c",
  "import os,re\nhits=[]\nfor root in ('/app','/tmp','/root','/home','/data','/etc'):\n for d,_,fs in os.walk(root):\n  if d.startswith(('/etc/ssl','/usr/share/ca-certificates')): continue  # public CA certificates, not secrets\n  for f in fs:\n   if re.search(r'(^\\.env|\\.pem$|\\.key$|^id_rsa|\\.p12$|\\.pfx$|pgpass|\\.dump$|credentials)',f): hits.append(os.path.join(d,f))\nprint('\\n'.join(hits) or 'none')"],
  { encoding: "utf8" });
// (6b) the nginx web image (no python there): find secret-looking file names outside the public CA bundle
const inWeb = execFileSync("docker", ["run", "--rm", "--network", "none", "--entrypoint", "find", "ckam-sec-web", "/", "-xdev",
  "(", "-name", ".env*", "-o", "-name", "*.key", "-o", "-name", "id_rsa*", "-o", "-name", "*.p12", "-o", "-name", "*.pfx",
  "-o", "-name", "*.dump", "-o", "-name", "*.map", "-o", "-name", "*pgpass*", ")", "-not", "-path", "/proc/*"], { encoding: "utf8" });
// (7) the git-ignored .env of this worktree (IF-09): never committed? key names + classification only
const envCommits = git(["log", "--all", "--oneline", "--", ".env"]).trim();
let dotenv = [];
try {
  dotenv = fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => {
    const k = l.slice(0, l.indexOf("=")); const v = l.slice(l.indexOf("=") + 1).trim();
    return /PASSWORD|SECRET|TOKEN|KEY/.test(k) ? `${k}[${v ? classify(v, ".env") : "empty"}]` : k;
  });
} catch { dotenv = ["(no .env)"]; }
fs.writeFileSync(OUT, JSON.stringify({ scanned: { worktreeFiles: scannedFiles, commits, distFiles, images, containers }, hits, envKeys,
  secretLikeFilesInApiImage: inImage.trim().split("\n"), secretLikeFilesInWebImage: inWeb.trim().split("\n").filter(Boolean),
  dotenvEverCommitted: envCommits || "never", dotenvKeys: dotenv }, null, 1));
console.log("web image secret-like files:", inWeb.trim().replace(/\n/g, ", ") || "none");
console.log(".env ever committed:", envCommits || "never", "| .env keys:", dotenv.join(" "));
for (const [c, keys] of Object.entries(envKeys)) console.log("env", c, keys.filter((k) => k.includes("[")).join(" "));
const byClass = {};
for (const h of hits) { const k = `${h.source}|${h.rule}|${h.class}`; byClass[k] = (byClass[k] || 0) + 1; }
console.log(JSON.stringify({ scanned: { worktreeFiles: scannedFiles, commits, distFiles, images: images.length, containers: containers.length } }));
for (const [k, n] of Object.entries(byClass).sort()) console.log(n.toString().padStart(5), k);
console.log("REVIEW hits:");
for (const h of hits.filter((x) => x.class === "REVIEW")) console.log("  ", h.source, h.rule, h.where, "len=" + h.len, "sha8=" + h.sha8);
console.log("secret-like files in the api image:", inImage.trim().replace(/\n/g, ", "));
