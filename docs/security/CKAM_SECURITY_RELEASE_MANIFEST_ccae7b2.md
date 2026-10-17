# CKAM Security Release Manifest — `ccae7b2`

**Status: PREPARED — OWNER APPROVAL PENDING. NOT DEPLOYED. NOT PUSHED. PRODUCTION REMAINS NOT REMEDIATED (live release `3b5e842`).**

| Item | Value |
|---|---|
| Release commit | `ccae7b2` — full `ccae7b2281bc4ca71f4b6113f61dc86de392bc3e` |
| Branch (dev PC worktree) | `worktree-ckam-build` (remote default branch name `claude/brave-euler-07879a`; nothing pushed) |
| Build date | 2026-10-17 (package built and rebuilt the same day from the committed tree only) |
| Code relation | Backend and frontend source identical to `fd34520` (the security-programme final commit). Differences after `fd34520` outside `docs/`: `backend/constraints.txt` (+`colorama==0.4.6`, 44 pins), `ops/windows/README.md`, `ops/windows/deploy_ckam.ps1.template`, `ops/windows/verify_release.ps1` |
| Superseded candidate | `eed3de1` (zip `be3209af…`, 2,141,099 bytes): **do not deploy** (`release-packages\SUPERSEDED.txt`) |
| Alembic head | `c6e8a0b2d4f6` (single linear head, 43 revisions) |
| Migrations to run (in order, before the new code starts) | `f9a1c3e5b7d2` (asset_user.token_version) → `a3c5e7f9b1d4` (TRUNCATE guards, 5-year audit purge floor) → `b5d7f9a1c3e5` (auth_session) → `c6e8a0b2d4f6` (asset lifecycle-field guard). Production database today: `e6f8a0b2c4d6` |
| Migration cost (rehearsal on a restored copy of the live schema) | about 10 ms database time, 0.7–0.9 s whole command; no row rewritten; all 39 table row counts unchanged; a failed `upgrade head` rolls back all four together |

## Package

| Item | Value |
|---|---|
| Zip | `D:\ANKUR AI PROJECTS\Asset Management\release-packages\ckam-security-release-ccae7b2.zip` (outside the git working tree on purpose) |
| Size | 2,152,224 bytes |
| SHA-256 | `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` |
| Content hash (sorted file hashes) | `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b` |
| Contents | 215 files: `RELEASE.json`; `backend\app\` (production code only), `backend\alembic.ini`, `backend\pyproject.toml`, `backend\constraints.txt`, `backend\VERSION`, `backend\scripts\create_owner.py`; `frontend-dist\` (production build, 8 self-hosted fonts, bundles `index-Cp5JgQR-.js`, `index-Bj21ou3B.css`); `ops\windows\` (reference scripts + README); `ops\db\` (role-split SQL and runbook for the DBA, not part of this deploy) |
| Excluded (verified, 15 checks, 0 violations) | `.git`, `.env*`, `node_modules`, tests, `docs` (incl. all security evidence), screenshots, the untracked demo walkthrough and demo screens, source maps, dumps/backups, keys, caches, coverage, Docker files, other scripts |
| Secrets in the package | none (205 text files scanned; hits are placeholders, code field names or documentation text) |
| Reproducibility | a second assembly and a rebuild after the antivirus removed the zip (2026-10-17) are byte-identical to this hash |
| Integrity file | `release-packages\MANIFEST.sha256.txt` (zip + every file; `sha256sum -c` passes). Copy: `docs/security/evidence/closure/release/raw/MANIFEST_ccae7b2.sha256.txt`. Send the zip and its SHA-256 by different routes; re-verify on the server before use |
| Install command on the server | `pip install -c <release>\backend\constraints.txt -e <release>\backend` — needs the Python package index (see runbook F2); proven on real Windows with 43 pinned packages |

## Test and verification results (committed code; actual figures)

| Check | Result |
|---|---|
| Backend `pytest -q` (dev container, `ckam_test`) | **2541 passed, 1 skipped** |
| Frontend `npx tsc -b` | clean |
| Frontend `npx vitest run` | **1257 passed (92 files)** |
| Production build, `check:build` | OK; 0 `.map`, no `sourceMappingURL`, no Google font host |
| Permanent Playwright (UAT stack) | **11 passed, 1 skipped** (ERP-link journey; ERP off on the stack) |
| Security Playwright (security stack) | **14/14** |
| Alembic fresh DB → head; existing dev/UAT/security DBs → head | PASS (single head `c6e8a0b2d4f6`) |
| Local IF-01 on current code | Linux production-layout container: 47 paths → 0 leaks, identical 404s; legitimate assets 200 |
| Native Windows, final package | exact install command OK; 32 attack paths → 0 leaks; `/assets/<id>`, `/assets/new` open the app; browser cold load of an asset link works; packaged `verify_release.ps1` **41/41 PASS** incl. both uvicorn flags (`docs/security/evidence/closure/windows/`) |
| QR formats | Asset 360 QR = `${BASE_URL}/assets/{id}`; Print Labels "QR Code"/"Barcode" = asset code only; default "Barcode + QR" = both (carries the plain-HTTP link) |
| Production start-up refusal | 72 weak combinations (environment name × JWT secret) all refuse to start, message names both rules and never prints the secret |
| Rehearsal of the deployment on a restored copy of the live schema | 283 cases (`eed3de1`, 3 documentation errors found and fixed) + delta on the `ccae7b2` zip: 231 cases, 229 passed, 0 failed, 2 not run (deploy-template dry run and Require-mode fake listener, interrupted by the antivirus incident GD-F01; both passed earlier the same day on the identical file) |

## Known external actions (not done; see `CKAM_EXTERNAL_SECURITY_ACTIONS.md`)

URGENT: deploy this release (EXT-01) after the pre-checks (EXT-39), then rotate the JWT secret, the `ckassetapp` password, the NAS password and the ERP password (EXT-02), start with `--no-proxy-headers --no-server-header` (EXT-38), preserve logs first (EXT-41), compromise check, signed change record (EXT-42). 30–90 days: HTTPS, service account instead of SYSTEM, off-server encrypted backups, DB role split, live launcher into git (EXT-13). Decisions: `CKAM_SECURITY_DECISIONS_REQUIRED.md`.

## Rollback warning

After migration `c6e8a0b2d4f6` the old release `3b5e842` can still **receive** assets but **cannot move, repair, sell or scrap** (a database trigger refuses; the user sees a misleading "values could not be saved" message), and `3b5e842` re-opens IF-01. **Roll forward** is the plan. The deploy template never restarts the old release or downgrades once the migration has started (exit 3, CKAM-Web left stopped). Options (owner decision): `alembic downgrade -1`, full downgrade, or restore the pre-deploy dump. See `CKAM_PRODUCTION_ROLLBACK_STRATEGY.md`.

## Production verification checklist (runbook step H, all `NOT EXECUTED`)

1. `/api/health` 200 and `alembic current` = `c6e8a0b2d4f6` (a new release on an un-migrated database still answers health but nobody can sign in).
2. Newest `app_started` event and diagnostics health show version `ccae7b2`, environment `production`, migrations ok.
3. Served `index.html` references `index-Cp5JgQR-.js`; the bundle contains `ccae7b2`.
4. `/docs`, `/redoc`, `/openapi.json` → JSON 404; unknown `/api/...` → JSON 404.
5. Security headers each exactly once; no `Server` header; CSP without Google hosts.
6. The traversal list incl. Windows forms (`..%5c`, `%2e%2e%5c`, `C:%2fWindows%2fwin.ini`, `%5c%5cserver%5cshare`, mixed, double-encoded) → identical plain 404, 0 leaks. Do not run the UNC form against a release that lacks the fix.
7. QR direct link `/assets/<id>` opens the app (cold load, sign-in, asset page).
8. Packaged `verify_release.ps1 -LocalProcessCheck Require` on the server: 0 FAIL.
9. Sign-in works; asset list; PO; Receive (1 unit); Move (to a person and back).
10. Only then: rotate secrets, restart, verify connections, compromise assessment, close the change record.

Sources: `PACKAGE_REPORT_ccae7b2.md`, `GATE_REHEARSAL.md`, `GATE_DELTA.md`, `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`, `CKAM_PRODUCTION_SECURITY_GO_NO_GO.md`.
