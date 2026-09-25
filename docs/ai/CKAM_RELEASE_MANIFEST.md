# CKAM — Release Manifest

Prepared during AM-10 (Production Go-Live Preparation).

**Release candidate:** CKAM V1

**Actual final source commit:** `1f77c2452c0cf853031676a2f7e7ba70786b3702`
(`fix(web): AM-10 -- narrow nginx hardening headers (AM09-05, AM09-06)`) —
the last commit that changes application source/config. Governance and
go-live-preparation documentation commits follow this one; none of them
change application behavior.

**Alembic head:** `f28b6a913dce` (unchanged since AM-07; AM-08, AM-09, and
AM-10 each added zero migrations — confirmed independently this session
against both `ckam` and `ckam_test`, and against a genuinely fresh
disposable database migrated from zero, see the AM-10 report §28).

**Backend tests:** 305/305 passing (unchanged from the AM-09 baseline;
re-run independently at the start of AM-10 before any change, and no
backend source was touched during AM-10).

**Frontend tests:** 148/148 passing, 25 files (unchanged from the AM-09
baseline; re-run independently at the start of AM-10; no frontend
TypeScript/React source was touched during AM-10 — only
`frontend/nginx.conf`, a runtime web-server config file the Vitest/tsc
suites do not exercise).

**TypeScript:** clean (`npx tsc -b`, re-run at the start of AM-10).

**E2E:** 5/5 passing — re-run once at the start of AM-10 (before the
nginx change) and once more after rebuilding the `web` container with the
new nginx config, both times clean.

**Production frontend build:** clean (`npm run build`, `tsc -b && vite
build`), 2257 modules, zero errors. Bundle unchanged from AM-09
(737.95 kB / 222.43 kB gzip) — the nginx change does not touch the Vite
build output, only how nginx serves it.

**Known P0:** NONE.

**Known P1:** NONE.

**Known P2:**
- AM09-09 — no active notification for a failed nightly backup beyond the
  log file (`/var/log/ckam-backup.log` inside the `backup` container); an
  operator must check it manually. Documented with a named-ownership
  requirement in `CKAM_GO_LIVE_CHECKLIST.md` and the Operations Ownership
  Matrix (`AM-10_GO_LIVE_PREPARATION_REPORT.md` §40).
- ~~AM09-05 — missing security response headers~~ **RESOLVED in AM-10**
  (commit `1f77c24`) — see `RC_ISSUES.md` for the updated row; kept here
  only as a note that this was P2, not silently dropped from the count.

**Known P3:**
- AM09-07 — frontend JS bundle (222 kB gzipped) above Vite's 500 kB raw
  chunk-size advisory; acceptable for a LAN-deployed internal tool, no
  code-splitting need evidenced.
- AM09-08 — external Google Fonts CDN dependency; the CSS font stack
  (`"Inter", system-ui, sans-serif`) degrades gracefully to the OS default
  font if the CDN is unreachable, so the app remains fully functional.
- ~~AM09-06 — no `Cache-Control` on authenticated API responses~~
  **RESOLVED in AM-10** (commit `1f77c24`).

**Required production environment configuration:** see
`CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md` for the full table. Summary:
`POSTGRES_PASSWORD` and `BASE_URL`/`BACKUP_DIR` must all be set to real
production values before go-live (currently dev-only placeholders in this
session's own `.env`); `JWT_SECRET`/`COOKIE_SECURE`/`WEB_PORT`/`DB_PORT`/
`API_PORT` are already in an acceptable state for this environment but
still need independent values set on the actual production server.

**Data strategy:** DECISION REQUIRED, with a strong evidence-based
recommendation of **FRESH PRODUCTION DATABASE** — see
`AM-10_GO_LIVE_PREPARATION_REPORT.md` §8-13 for the full inventory and
reasoning (in short: 98 of 99 companies, 299 of 305 holders, and 158 of
159 assets in the current `ckam` database are confirmed E2E/UAT/RC test
data by direct evidence; the one company that is genuinely real —
Citykart Stores — has zero genuine business assets and only test-tagged
supporting masters, e.g. its one Vendor record is literally named "AM04
Test Vendor Co").

**Local release tag:** see the AM-10 report §26/§38 for whether one was
created and its exact name/commit — recorded there, not duplicated here,
so this manifest never needs updating if the tag decision changes.

**Deployment authorization:** NOT YET GRANTED. AM-10 is preparation and
rehearsal only. No production deployment, push, or database promotion
occurred during AM-10 — see `AM-10_GO_LIVE_PREPARATION_REPORT.md` for the
full evidence trail and `CKAM_GO_LIVE_CHECKLIST.md` for what remains
before that authorization should be requested.
