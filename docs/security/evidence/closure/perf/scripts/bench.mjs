// CKAM old-vs-new performance comparison (disposable local stacks ckam-pf-old / ckam-pf-new ONLY).
// Plain HTTP timing loop with Node's built-in fetch (undici, keep-alive), against 127.0.0.1 ports of our own test
// stacks. Every timed sample = request sent -> full response body read. Samples ALTERNATE between the two stacks
// (and which one goes first alternates too), after per-stack warm-up, so drift of the machine hits both equally.
//
//   node bench.mjs main     all operations (writes raw/main_samples.csv + raw/main_summary.json)
//   node bench.mjs rl       sign-in with the new stack's rate limiting ON (paced 7 s; run after recreating new api)
//   node bench.mjs stmts    SQL statements per bulk Move of 50 (pg_stat_statements, track=all)
//   node bench.mjs trigger  bulk Move of 50 on the NEW stack with the lifecycle guard trigger enabled vs disabled
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
mkdirSync(RAW, { recursive: true });
const PW = "Perf#Test2026ok";
const STACKS = {
  old: { web: "http://127.0.0.1:3811", api: "http://127.0.0.1:8800", db: "ckam-pf-old-db-1", seed: JSON.parse(readFileSync(join(RAW, "seed_old.json"), "utf8")) },
  new: { web: "http://127.0.0.1:3911", api: "http://127.0.0.1:8900", db: "ckam-pf-new-db-1", seed: JSON.parse(readFileSync(join(RAW, "seed_new.json"), "utf8")) },
};
const NAMES = ["old", "new"];
const now = () => performance.now();

async function rawFetch(url, opts = {}) {
  const t = now();
  const res = await fetch(url, opts);
  const buf = await res.arrayBuffer();
  return { ms: now() - t, status: res.status, bytes: buf.byteLength, res, buf };
}

// ------------------------------------------------------------------ auth (untimed helper)
async function login(name) {
  const s = STACKS[name];
  const r = await fetch(`${s.web}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login_id: "PERFHO", password: PW }) });
  if (r.status !== 200) throw new Error(`${name} login ${r.status} ${await r.text()}`);
  const j = await r.json();
  s.token = j.access_token;
  s.tokenAt = Date.now();
  s.cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("refresh_token=")) || null;
}
async function auth(name) {
  const s = STACKS[name];
  if (!s.token || Date.now() - s.tokenAt > 8 * 60 * 1000) await login(name);
  return { Authorization: `Bearer ${s.token}` };
}
async function api(name, method, path, body) {
  const s = STACKS[name];
  const headers = { ...(await auth(name)) };
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${s.web}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${name} ${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ------------------------------------------------------------------ statistics
function pct(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { n: s.length, median: pct(s, 50), p95: pct(s, 95), mean, min: s[0], max: s[s.length - 1] };
}
const r1 = (x) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ per-stack runtime data (untimed)
async function prepare() {
  for (const name of NAMES) {
    const s = STACKS[name];
    const room = s.seed.stock_room_id;
    let ids = [];
    for (let off = 0; ; off += 200) {
      const page = await api(name, "GET", `/api/assets?limit=200&offset=${off}&asset_user_id=${room}`);
      ids.push(...page.items.map((a) => a.id));
      if (page.items.length < 200) break;
    }
    s.stockIds = ids.sort((a, b) => a - b);
    const held = await api(name, "GET", `/api/assets?limit=5&asset_user_id=${s.seed.employee_ids[0]}`);
    s.asset360 = held.items[0].id;
    s.poDetail = s.seed.bulk_pos[0];
    const html = await (await fetch(`${s.web}/`)).text();
    s.jsBundle = html.match(/\/assets\/(index-[^"]+\.js)/)[1];
    s.cursor = 0;
  }
  const a = STACKS.old, b = STACKS.new;
  console.log(`stock-room assets: old ${a.stockIds.length} new ${b.stockIds.length}; asset360 ${a.asset360}/${b.asset360}; js ${a.jsBundle}/${b.jsBundle}`);
}
function takeIds(name, n) {
  const s = STACKS[name];
  const out = s.stockIds.slice(s.cursor, s.cursor + n);
  if (out.length < n) throw new Error(`${name}: out of stock-room assets`);
  s.cursor += n;
  return out;
}

// ------------------------------------------------------------------ operations
// Each op: { key, label, warm, n, expect:[statuses], run(name, i) -> {ms,status,bytes} }
const J = (o) => JSON.stringify(o);
const jsonPost = (url, headers, body, method = "POST") => rawFetch(url, { method, headers: { ...headers, "content-type": "application/json" }, body: J(body) });
const counters = { vendor: 0, item: 0, recv: {} };
const serialSeq = { old: 0, new: 0 };

function receiveOp(key, label, warm, n) {
  return {
    key, label, warm, n, expect: [200],
    async run(name, i, phase) {
      const s = STACKS[name];
      s.recvUsed = s.recvUsed || {};
      const k = (s.recvUsed[key] = (s.recvUsed[key] || 0) + 1) - 1;
      const po = s.seed.receive_pos[key][k];
      if (!po) throw new Error(`${name}: no receive PO left for ${key}`);
      const isLaptop = po.serial;
      const unit = isLaptop ? 50000 : 1000;
      const line = { line_no: po.line_no, quantity: po.qty };
      if (isLaptop) line.serial_numbers = Array.from({ length: po.qty }, (_, j) => `PFR${key}${String(po.n).padStart(3, "0")}${String(j + 1).padStart(3, "0")}`);
      const body = { received_into_asset_user_id: s.seed.stock_room_id, invoice_number: `INV-${key}-${po.n}`, invoice_date: "2026-10-06",
        invoice_amount: Math.round(po.qty * unit * 1.18 * 100) / 100, lines: [line] };
      return jsonPost(`${s.web}/api/purchase-orders/${po.id}/receive`, await auth(name), body);
    },
  };
}
function batchOp(key, label, qty, warm, n) {
  return {
    key, label, warm, n, expect: [201],
    async run(name) {
      const s = STACKS[name];
      return jsonPost(`${s.web}/api/assets/batch`, await auth(name), {
        item_id: s.seed.chair_id, quantity: qty, received_into_asset_user_id: s.seed.stock_room_id, cost_center_id: s.seed.cost_center_id,
        company_id: s.seed.company_id, vendor_id: s.seed.vendor_ids[0], serial_mode: "NO_SERIAL", purchase_cost: 4400, tax_percent: 18 });
    },
  };
}
const get = (key, label, path, warm = 3, n = 20, base = "web", authed = true) => ({
  key, label, warm, n, expect: [200],
  async run(name) {
    const s = STACKS[name];
    return rawFetch(`${s[base]}${typeof path === "function" ? path(s) : path}`, { headers: authed ? await auth(name) : {} });
  },
});
const parallel = (key, label, paths, warm = 3, n = 20) => ({
  key, label, warm, n, expect: [200],
  async run(name) {
    const s = STACKS[name];
    const h = await auth(name);
    const t = now();
    const rs = await Promise.all(paths(s).map((p) => rawFetch(`${s.web}${p}`, { headers: h })));
    const bad = rs.find((r) => r.status !== 200);
    return { ms: now() - t, status: bad ? bad.status : 200, bytes: rs.reduce((a, r) => a + r.bytes, 0) };
  },
});

const BIG = +(process.env.BIG || 8);     // samples for the big operations (>= 5 required)
const OPS = [
  { key: "login", label: "Sign-in (correct password)", warm: 3, n: 20, expect: [200],
    run: (name) => jsonPost(`${STACKS[name].web}/api/auth/login`, {}, { login_id: "PERFHO", password: PW }) },
  { key: "login_unknown", label: "Refused sign-in, unknown login id (AU-01 dummy hash)", warm: 3, n: 20, expect: [401],
    run: (name, i) => jsonPost(`${STACKS[name].web}/api/auth/login`, {}, { login_id: `NOSUCHUSER${i}`, password: "Wrong#Pass2026" }) },
  { key: "refresh", label: "Token refresh (rotating cookie)", warm: 3, n: 20, expect: [200],
    async run(name) {
      const s = STACKS[name];
      if (!s.cookie) await login(name);
      const r = await rawFetch(`${s.web}/api/auth/refresh`, { method: "POST", headers: { cookie: s.cookie } });
      const next = (r.res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("refresh_token="));
      if (next) s.cookie = next;
      return r;
    } },
  get("search_q", "Asset search, universal term 'laptop' (page 1)", "/api/assets?q=laptop&limit=50&offset=0"),
  get("search_serial", "Asset search, partial serial 'PFL0077'", "/api/assets?q=PFL0077&limit=50&offset=0"),
  get("list_filtered_p1", "Asset list filtered IN_STOCK + NON_IT, page 1", "/api/assets?status=IN_STOCK&domain=NON_IT&limit=50&offset=0"),
  get("list_deep", "Asset list IN_STOCK, deep page (offset 1500)", "/api/assets?status=IN_STOCK&limit=50&offset=1500"),
  parallel("asset360", "Asset 360 (detail + events + documents + changes, parallel)", (s) => [`/api/assets/${s.asset360}`, `/api/assets/${s.asset360}/events`, `/api/assets/${s.asset360}/documents`, `/api/assets/${s.asset360}/changes`]),
  get("po_list", "PO list (first 200)", "/api/purchase-orders?limit=200&offset=0"),
  parallel("po_detail", "PO detail (header + line groups + units, parallel)", (s) => [`/api/purchase-orders/${s.poDetail}`, `/api/purchase-orders/${s.poDetail}/line-groups`, `/api/purchase-orders/${s.poDetail}/lines`]),
  get("erp_pos", "ERP copy PO list /api/erp/pos?envelope=true (local copy, 40 POs, no ERP link)", "/api/erp/pos?envelope=true"),
  get("reports_preview", "Reports: asset preview (50 rows)", "/api/reports/assets/preview?limit=50&offset=0"),
  get("audit_logs", "Logs: audit trail query (50 rows)", "/api/admin/logs/audit?limit=50&offset=0"),
  { key: "vendor_create", label: "Vendor create", warm: 3, n: 20, expect: [201, 200],
    async run(name, i, phase) { const s = STACKS[name]; return jsonPost(`${s.web}/api/masters/vendors`, await auth(name), { name: `PERF Bench Vendor ${phase}-${i}` }); } },
  { key: "item_create", label: "Item create", warm: 3, n: 20, expect: [201, 200],
    async run(name, i, phase) { const s = STACKS[name]; return jsonPost(`${s.web}/api/items`, await auth(name), {
      name: `PERF Bench Item ${phase}-${i}`, category_id: s.seed.categories.NON_IT[0], subcategory_id: s.seed.categories.NON_IT[1], serial_required: false }); } },
  { key: "move_1", label: "Move 1 asset (stock room -> employee)", warm: 3, n: 15, expect: [201, 200],
    async run(name, i) { const s = STACKS[name]; const [id] = takeIds(name, 1);
      return jsonPost(`${s.web}/api/assets/${id}/events`, await auth(name), { event_type: "MOVED", to_asset_user_id: s.seed.employee_ids[10 + (i % 10)], remarks: "perf move" }); } },
  { key: "bulk_move_50", label: "Bulk Move of 50 assets", warm: 1, n: BIG, expect: [200],
    async run(name, i) { const s = STACKS[name]; const ids = takeIds(name, 50);
      return jsonPost(`${s.web}/api/assets/bulk-move`, await auth(name), { asset_ids: ids, to_asset_user_id: s.seed.employee_ids[20 + (i % 20)] }); } },
  receiveOp("r1", "Receive 1 unit (no-serial item)", 3, 15),
  receiveOp("r10", "Receive 10 units (no-serial item)", 3, 15),
  receiveOp("r50", "Receive 50 units (no-serial item)", 1, BIG),
  receiveOp("r100", "Receive 100 units (no-serial item)", 1, BIG),
  receiveOp("rs10", "Receive 10 serial units", 3, 15),
  batchOp("batch_20", "Batch Add Assets x20", 20, 2, 15),
  batchOp("batch_200", "Batch Add Assets x200", 200, 1, BIG),
  get("static_index", "Static index.html through nginx", "/", 3, 30, "web", false),
  get("static_js", "Static main JS bundle through nginx (each stack's own build)", (s) => `/assets/${s.jsBundle}`, 3, 30, "web", false),
  get("uv_static_js", "uvicorn /assets/<same JS file> (IF-01 lexical + resolve check; same dist in both)", (s) => `/assets/index-DflwEmrO.js`, 3, 30, "api", false),
  { key: "uv_static_404", label: "uvicorn /assets/<missing file> (404 path)", warm: 3, n: 30, expect: [404],
    run: (name) => rawFetch(`${STACKS[name].api}/assets/no-such-file-abc.js`) },
  { key: "body_4mb", label: "4 MB JSON body to the API directly (Vendor create, name too long -> 422)", warm: 2, n: 15, expect: [422],
    async run(name) { const s = STACKS[name]; return jsonPost(`${s.api}/api/masters/vendors`, await auth(name), { name: "x".repeat(4 * 1024 * 1024 - 200) }); } },
  { key: "body_small", label: "Small JSON body to the API directly (same 422 route, 1 KB name)", warm: 2, n: 15, expect: [422],
    async run(name) { const s = STACKS[name]; return jsonPost(`${s.api}/api/masters/vendors`, await auth(name), { name: "x".repeat(1024) }); } },
];

function verdict(o, n) {
  const allowed = Math.max(o * 0.25, 50);
  return n - o <= allowed ? "OK" : "SLOWER";
}

async function runOps(ops, tag) {
  const rows = [];
  const summary = [];
  for (const op of ops) {
    process.stdout.write(`${op.key} ... `);
    const times = { old: [], new: [] };
    const errs = [];
    for (let w = 0; w < op.warm; w++) {
      for (const name of NAMES) {
        const r = await op.run(name, w, "w");
        if (!op.expect.includes(r.status)) errs.push(`${name} warm ${r.status} ${Buffer.from(r.buf || []).toString().slice(0, 200)}`);
      }
    }
    for (let i = 0; i < op.n; i++) {
      const order = i % 2 === 0 ? ["old", "new"] : ["new", "old"];
      for (const name of order) {
        const r = await op.run(name, i, "s");
        const ok = op.expect.includes(r.status);
        if (!ok) errs.push(`${name} #${i} ${r.status} ${Buffer.from(r.buf || []).toString().slice(0, 200)}`);
        times[name].push(r.ms);
        rows.push([tag, op.key, name, i, r.ms.toFixed(2), r.status, r.bytes, ok ? 1 : 0].join(","));
      }
    }
    const so = stats(times.old), sn = stats(times.new);
    const row = { key: op.key, label: op.label, n: op.n, old: so, new: sn,
      ratio_median: sn.median / so.median, ratio_p95: sn.p95 / so.p95,
      delta_median_ms: sn.median - so.median, verdict: verdict(so.median, sn.median), verdict_p95: verdict(so.p95, sn.p95), errors: errs };
    summary.push(row);
    console.log(`old ${r1(so.median)}/${r1(so.p95)}  new ${r1(sn.median)}/${r1(sn.p95)}  x${(row.ratio_median).toFixed(2)} ${row.verdict}${errs.length ? "  ERRORS " + errs.length + ": " + errs[0] : ""}`);
  }
  return { rows, summary };
}

function psql(db, sql) {
  return execFileSync("docker", ["exec", db, "psql", "-U", "ckam", "-d", "ckam", "-tAc", sql], { encoding: "utf8" }).trim();
}

const mode = process.argv[2] || "main";
const only = process.argv[3] ? process.argv[3].split(",") : null;
const header = "run,op,stack,sample,ms,status,bytes,ok";

if (mode === "main") {
  await prepare();
  const ops = only ? OPS.filter((o) => only.includes(o.key)) : OPS;
  const started = new Date().toISOString();
  const { rows, summary } = await runOps(ops, process.env.TAG || "main");
  const suffix = process.env.TAG ? `_${process.env.TAG}` : only ? `_${only.join("_")}` : "";
  writeFileSync(join(RAW, `main_samples${suffix}.csv`), [header, ...rows].join("\n") + "\n");
  writeFileSync(join(RAW, `main_summary${suffix}.json`), JSON.stringify({ started, finished: new Date().toISOString(), summary }, null, 1));
} else if (mode === "rl") {
  // One user signing in at a normal pace (7 s apart: under 10/min per login id and 20/min per address). The new
  // stack runs with RATE_LIMIT_ENABLED=true at this point; old has no limiter at all.
  const op = OPS.find((o) => o.key === "login");
  const rows = [];
  const times = { old: [], new: [] };
  const statuses = { old: {}, new: {} };
  for (const name of NAMES) await op.run(name, 0, "w");
  await new Promise((r) => setTimeout(r, 7000));
  for (let i = 0; i < 15; i++) {
    const order = i % 2 === 0 ? ["old", "new"] : ["new", "old"];
    for (const name of order) {
      const r = await op.run(name, i, "s");
      times[name].push(r.ms);
      statuses[name][r.status] = (statuses[name][r.status] || 0) + 1;
      rows.push(["rl", "login_rl_on", name, i, r.ms.toFixed(2), r.status, r.bytes, r.status === 200 ? 1 : 0].join(","));
    }
    await new Promise((r) => setTimeout(r, 7000));
  }
  const so = stats(times.old), sn = stats(times.new);
  const out = { key: "login_rl_on", label: "Sign-in, one user every 7 s, new stack WITH rate limiting on", old: so, new: sn, statuses,
    ratio_median: sn.median / so.median, ratio_p95: sn.p95 / so.p95, verdict: verdict(so.median, sn.median) };
  console.log(JSON.stringify(out, null, 1));
  writeFileSync(join(RAW, "rl_samples.csv"), [header, ...rows].join("\n") + "\n");
  writeFileSync(join(RAW, "rl_summary.json"), JSON.stringify(out, null, 1));
} else if (mode === "stmts") {
  // SQL statements executed by ONE bulk Move of 50 (and one single Move), counted by pg_stat_statements with
  // track=all (statements inside trigger functions included; `toplevel` false = run inside a function).
  await prepare();
  const result = {};
  for (const name of NAMES) {
    const s = STACKS[name];
    psql(s.db, "ALTER SYSTEM SET pg_stat_statements.track = 'all'");
    psql(s.db, "SELECT pg_reload_conf()");
  }
  await new Promise((r) => setTimeout(r, 1500));
  const q = `SELECT coalesce(sum(calls),0)||'|'||coalesce(sum(calls) FILTER (WHERE toplevel),0)||'|'||coalesce(sum(calls) FILTER (WHERE NOT toplevel),0)||'|'||coalesce(sum(rows),0)||'|'||round(coalesce(sum(total_exec_time),0)::numeric,2) FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid WHERE d.datname = 'ckam' AND s.query NOT ILIKE '%pg_stat_statements%'`;
  const detailQ = `SELECT string_agg(calls||' x '||left(regexp_replace(query, '\\s+', ' ', 'g'), 110)||CASE WHEN toplevel THEN '' ELSE '  [nested]' END, E'\\n' ORDER BY calls DESC, query) FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid WHERE d.datname = 'ckam' AND s.query NOT ILIKE '%pg_stat_statements%'`;
  for (const [what, fn] of [
    ["bulk_move_50", async (name) => jsonPost(`${STACKS[name].web}/api/assets/bulk-move`, await auth(name), { asset_ids: takeIds(name, 50), to_asset_user_id: STACKS[name].seed.employee_ids[45] })],
    ["move_1", async (name) => jsonPost(`${STACKS[name].web}/api/assets/${takeIds(name, 1)[0]}/events`, await auth(name), { event_type: "MOVED", to_asset_user_id: STACKS[name].seed.employee_ids[46], remarks: "perf stmt count" })],
  ]) {
    for (const name of NAMES) {
      const s = STACKS[name];
      await auth(name);
      psql(s.db, "SELECT pg_stat_statements_reset()");
      const r = await fn(name);
      await new Promise((res) => setTimeout(res, 300));
      const [total, top, nested, rowsN, execMs] = psql(s.db, q).split("|");
      const detail = psql(s.db, detailQ);
      result[`${what}_${name}`] = { status: r.status, ms: r1(r.ms), statements_total: +total, toplevel: +top, nested: +nested, rows: +rowsN, db_exec_ms: +execMs, detail };
      console.log(`${what} ${name}: status ${r.status}, ${total} statements (${top} top-level, ${nested} nested), db exec ${execMs} ms`);
    }
  }
  for (const name of NAMES) {
    psql(STACKS[name].db, "ALTER SYSTEM SET pg_stat_statements.track = 'top'");
    psql(STACKS[name].db, "SELECT pg_reload_conf()");
  }
  writeFileSync(join(RAW, "statements_per_request.json"), JSON.stringify(result, null, 1));
} else if (mode === "trigger") {
  // Same NEW stack, bulk Move of 50, the OBS-STATUS guard trigger enabled vs disabled (ALTER TABLE on the disposable
  // database only), alternating, 10 samples each. Isolates what the row trigger itself costs.
  await prepare();
  const s = STACKS.new;
  const times = { enabled: [], disabled: [] };
  const rows = [];
  const set = (on) => psql(s.db, `ALTER TABLE asset ${on ? "ENABLE" : "DISABLE"} TRIGGER trg_asset_lifecycle_fields_guard`);
  const one = async (i) => jsonPost(`${s.web}/api/assets/bulk-move`, await auth("new"), { asset_ids: takeIds("new", 50), to_asset_user_id: s.seed.employee_ids[30 + (i % 20)] });
  await one(0);
  for (let i = 0; i < 10; i++) {
    for (const on of i % 2 === 0 ? [true, false] : [false, true]) {
      set(on);
      const r = await one(i);
      times[on ? "enabled" : "disabled"].push(r.ms);
      rows.push(["trigger", on ? "bulk_move_50_trigger_on" : "bulk_move_50_trigger_off", "new", i, r.ms.toFixed(2), r.status, r.bytes, r.status === 200 ? 1 : 0].join(","));
    }
  }
  set(true);
  const out = { enabled: stats(times.enabled), disabled: stats(times.disabled), trigger_state_after: psql(s.db, "SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_asset_lifecycle_fields_guard'") };
  console.log(JSON.stringify(out, null, 1));
  writeFileSync(join(RAW, "trigger_samples.csv"), [header, ...rows].join("\n") + "\n");
  writeFileSync(join(RAW, "trigger_summary.json"), JSON.stringify(out, null, 1));
}
