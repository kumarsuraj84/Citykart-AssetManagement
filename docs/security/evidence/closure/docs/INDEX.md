# WP-D1 — Production security & infrastructure documents (index)

| | |
|---|---|
| Written | 2026-10-16, security closure programme, work package WP-D1 (Senior Security/Infrastructure Technical Writer) |
| Scope | **Documents only.** No code, git, docker, server, database or network change was made. Every production/infrastructure item in these documents is **PREPARED, NOT DONE** |
| Honest status | **PRODUCTION REMAINS NOT REMEDIATED.** Production (10.0.1.98) still runs release `3b5e842`, which contains IF-01. Nothing is pushed, deployed, or rotated by this work |

## Documents produced (all under `docs/security/`)

| File | What it is |
|---|---|
| `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` | The exact ordered procedure for the IF-01 release: 14 numbered phases (precheck → approved push → backup → migration → deploy → start `--no-proxy-headers` → verify IF-01 closed incl. Windows path forms → rotate JWT → DB → NAS → ERP → restart/verify → compromise assessment → HTTPS pointer), with purpose, prerequisites, steps as TEXT with `<TYPED-ON-SERVER>` placeholders, who does it, verification with expected results, rollback and evidence per phase; plus a one-page printable checklist and a DO-NOT list |
| `CKAM_HTTPS_IMPLEMENTATION_PLAN.md` | HTTPS on 10.0.1.98: reverse-proxy options (Caddy recommended; IIS+ARR, nginx, Traefik), certificate options, DNS, port/firewall handling, HTTP→HTTPS redirect, `COOKIE_SECURE`/`BASE_URL`/`TRUSTED_PROXIES` changes, staged HSTS, proxy trust & client-IP/rate-limit consequence, body-size (~17 MB) and timeouts, no-duplicate security headers (who sets CSP), logging, rollback, test plan, effort/downtime, owner decision list. **DO NOT INSTALL ANYTHING** |
| `CKAM_SERVICE_ACCOUNT_PLAN.md` | Move `CKAM-Web` from SYSTEM to a dedicated low-privilege Windows identity (local `svc_ckam` or gMSA): exact rights (release/venv read-execute, logs modify, secret files read, NAS reach, DB/ERP network, "Log on as a batch job"), explicit NO access to Spinwheel/Citykart Desk, `icacls`/Task Scheduler/firewall commands as TEXT, NAS-credential handling, test plan, rollback, sequencing vs secret rotation and the DB role split |
| `CKAM_BACKUP_RESTORE_PLAN.md` | Off-server encrypted DB backups (tool + encryption + key custody), NAS document backup, immutable/offline copy, daily/weekly/monthly retention, quarterly restore drill with an evidence template, ransomware considerations, RPO/RTO proposals, backup monitoring, ownership matrix, sequencing |
| `CKAM_EXTERNAL_SECURITY_ACTIONS.md` (updated in place) | Kept all existing EXT-01..EXT-40; added **EXT-41** (preserve/off-server logs for the compromise check), **EXT-42** (signed change record for the IF-01 deploy), **EXT-43** (CKAM-only NAS account if `ckappuser` is shared). Added a per-item **prerequisite / rollback / audit-evidence** matrix with the classification bucket for every EXT. Added an explicit "all OPEN EXTERNAL" status note and updated the order-that-matters paragraph. No item marked complete |

## Assumptions and facts that could not be verified from the repository

These are the points where the documents state an assumption, a "confirm on the server" step, or a fact the repo
could not settle. They are flagged in the documents themselves; collected here for the reviewer.

1. **Live production release is `3b5e842`.** Taken from `docs/ai/PRODUCTION_INFRASTRUCTURE.md` and memory; not
   verified against the server (local-only brief). The runbook's Phase 1 step 1 re-reads it on the server.
2. **The exact closure migrations** (WP-A2 refresh-token record, WP-B lifecycle guard, optional N9) are not yet in
   the committed code at the HEAD read (`627ed73`; migrations present: `f9a1c3e5b7d2`, `a3c5e7f9b1d4` as the head).
   The runbook Phase 4 leaves a marked `<ADD CLOSURE MIGRATIONS HERE>` list and `<FINAL-HEAD>` for the lead/DEV to
   fill from `alembic history` of the release actually deployed.
3. **The closure fixes IF-01-WIN (Windows path refusal) and N6 (unknown `/api` → JSON 404) may not be in the
   deployed release.** At HEAD read, `backend/app/main.py::_serve_frontend_asset` resolves then checks containment
   (works on Linux, retested) but the lexical pre-check for Windows forms is a WP-A1 item not yet committed; the
   unknown-`/api` path still returns the SPA shell. The runbook makes the Windows-form probes and the N6 check
   conditional on those fixes being present (Phase 1 step 8 / Phase 7), and says to run the UNC probe only after
   IF-01-WIN is deployed.
4. **`ckappuser` (NAS) and `ckpost` (ERP) may be shared** with Spinwheel / Citykart Desk. The repo does not say.
   EXT-43 and the runbook Phase 1 step 6 require confirming this before rotating those passwords; if shared, do not
   rotate — create a CKAM-only account instead.
5. **Whether the nightly backup task logs in as `ckassetapp`** is not in the repo. The runbook Phase 1 step 5 and
   Phase 9 require checking it, because the DB password rotation would otherwise break the next backup. The shared
   backup script `C:\ProgramData\CKBackup\backup-db.ps1` must not be edited (shared with other apps).
6. **The public name `ckam.citykartstores.com`** is confirmed in `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (line 19)
   and `CKAM_THREAT_MODEL.md` (line 49) with DNS A → `182.72.84.10` and router forward 3211 → 10.0.1.98. Whether a
   `*.citykartstores.com` wildcard certificate already exists, and whether DNS-API access is available for
   auto-renewal, are **unknown** — raised as owner decisions in the HTTPS plan §16.
7. **Whether 10.0.1.98 is domain-joined** (so a gMSA is possible) is unknown; the service-account plan gives both
   the local-user and gMSA paths and recommends gMSA only if domain-joined with AD support.
8. **Whether port 443 (and 80) are free on the shared 10.0.1.98** is unknown; the HTTPS plan says to check
   `D:\Citykart_Applications\PORTS.md` first (that file is named in the infrastructure docs but not in this repo).
9. **The production launcher `shared\run_ckam_web.ps1` is on the server only**, not in git (IF-15/EXT-13). The
   runbook and service-account plan reference the secret-free reference launcher being written under
   `ops/windows/` by another engineer; at the time of writing `ops/windows/` did not yet exist in the worktree
   (only `ops/backup.sh`, `ops/restore.sh`, `ops/test_backup_restore.sh`, `ops/init-test-db.sql`). The runbook
   tells IT to reconcile the server copy with the repo copy.
10. **The least-privilege DB role SQL** used by EXT-07 is the DESIGN-ONLY version in
    `CKAM_SECURITY_REMEDIATION_REPORT.md` §7; the brief's "backend engineer's design document" was not found as a
    separate file (OBS-EXT07-STALE notes this). The runbook/plan point to §7 and to the WP-B tested version when it
    lands.
11. **No real secret values** appear in any document; where a secret is needed the text uses `<TYPED-ON-SERVER>` or
    the allow-listed-non-secret-keys print. Not verified by a tool scan; written to that rule throughout.

## Contradictions noticed between existing docs

1. **IF-01 status.** The older `CKAM_EXTERNAL_SECURITY_ACTIONS.md` header and the VAPT totals counted IF-01 under
   "FIXED" (code fixed); the `CKAM_SECURITY_CLOSURE_REGISTER.md` corrects this to **OPEN — EXTERNAL** because the
   live server is still exposed. The new documents follow the closure register (production not remediated).
2. **Deploy runbook stack.** `docs/ai/CKAM_RELEASE_RUNBOOK.md`, the `CKAM_PRODUCTION_SERVER_CHECKLIST.md` and the
   `CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md` still describe the **Docker/compose** model (nginx `web`, `db`, `api`,
   `backup` services, `ops/*.sh`, `WEB_PORT`/`BACKUP_DIR`), which is the **dev/UAT** stack — not the real Windows
   single-port production (one uvicorn process, scheduled task `CKAM-Web`, `releases\<sha>`, `shared\.env`,
   `FRONTEND_DIST_DIR`) described in `docs/ai/PRODUCTION_INFRASTRUCTURE.md`. This is IF-15 / OBS-DOCS; a Windows
   runbook rewrite is WP-D's job. The new documents use the real Windows model.
3. **EXT-07 "SQL to be supplied".** EXT-07's body said the role SQL "will be supplied … (file name to be
   confirmed)", but it already exists in `CKAM_SECURITY_REMEDIATION_REPORT.md` §7 (OBS-EXT07-STALE). The new
   per-item matrix points EXT-07 at §7.
4. **N2 (`--no-proxy-headers`).** The remediation report §8 says the Dockerfile kept uvicorn's defaults, but
   `backend/Dockerfile` (commit `a3e8fce`, after that report) now has `--no-proxy-headers` in its CMD (verified).
   The closure register already records this; the new documents treat the Docker side as fixed and the production
   launcher as the open part (EXT-38).
