# CKAM: External Security Actions

| | |
|---|---|
| Date | 2026-10-15 (remediation + retest), extended 2026-10-16 by the security closure programme (added EXT-41/42/43, per-item prerequisite/rollback/evidence matrix, runbook/HTTPS/service-account/backup plan pointers), and **updated 2026-10-16 by WP-M2b** from the lead's final fact sheet (status column; code sides of EXT-11/12/13/25/38 recorded; EXT-44 … EXT-50 added). **No item is complete**; production still runs `3b5e842` |
| Purpose | Every security action that **cannot be completed by changing CKAM code on the dev PC**: server, network, database administration, supplier, people and management actions |
| Code state | Final local HEAD `fd34520`: 22 **local** security commits (`3e134c1` … `fd34520`) on top of `4ba4e94`, 22 commits ahead of origin `c66378d`. No code-fixable Critical/High/Medium item remains open locally. **Nothing is pushed, nothing is deployed, production was never touched**: production still runs `3b5e842` with IF-01 and the QR deep-link bug (CL2-IF-04). Alembic head in code `c6e8a0b2d4f6` (four new migrations) |
| Honesty rule | **Nothing is complete until it is deployed (or done on the real system) and verified there.** "CODE DONE" below means only that the repository side exists and was tested locally |
| Related | `CKAM_ISO27001_READINESS.md` (finding summary section 6, risk register section 9), `CKAM_SOC2_READINESS.md`, `CKAM_THREAT_MODEL.md`; and from the separate writer `CKAM_VAPT_REPORT.md`, `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md` |

How to read this list:

- **Owner** is one of IT, Infra, Management, HR, Vendor, Security, Audit, Dev (a developer task that still needs
  a server or a decision).
- **Timing:** `URGENT` (now, within days), `30 days`, `90 days`, `12 months`.
- **Done when** is the check that proves the action is complete. Keep that proof; it becomes audit evidence.
- No action here needs any password written down in this repository. **The owner types every superuser,
  database, NAS and ERP password on the servers himself** (`CLAUDE.md`).
- Deploying to production always needs the owner's explicit request (`CLAUDE.md`). This list says *what* must
  happen; it is not that request.

## Summary

Status words (2026-10-16): **OPEN EXTERNAL** = needs work outside the repository; **CODE DONE — OPEN EXTERNAL** = the
repository side exists and was tested locally, the real-system side is still to do; **OPEN DECISION** = the owner
decides first (SD-xx in `CKAM_SECURITY_DECISIONS_REQUIRED.md`); "draft" = a DRAFT document exists in
`docs/security/policies/` (DRAFT — MANAGEMENT APPROVAL REQUIRED; not evidence).

| ID | Action | Owner | Timing | Status 2026-10-16 |
|---|---|---|---|---|
| EXT-01 | Deploy the release with all 21 security commits (HEAD `fd34520` or later; IF-01 fix first among them) to production | Management + IT | **URGENT** | OPEN EXTERNAL (code ready, runbook prepared; decision SD-01) |
| EXT-02 | Rotate JWT secret, `ckassetapp` DB password, NAS password, ERP password after EXT-01 | IT + Infra | **URGENT** | OPEN EXTERNAL (runbook phases 8-11 prepared) |
| EXT-03 | Check whether IF-01 was used against production (compromise assessment) | Security + IT | **URGENT** | OPEN EXTERNAL (runbook phase 13 prepared) |
| EXT-04 | HTTPS for production | Infra | 30 days | OPEN EXTERNAL (plan prepared; decision SD-05) |
| EXT-05 | Stop the internet port-forward of 3211 or restrict it (VPN) | Infra + Management | **URGENT** (decision) / 30 days | OPEN DECISION (SD-04) |
| EXT-06 | Run CKAM as a low-privilege service account instead of SYSTEM | Infra | 30 days | OPEN EXTERNAL (plan prepared) |
| EXT-07 | Separate low-privilege runtime DB role from the owner role | Infra (DBA) + Dev | 30 days | CODE DONE — OPEN EXTERNAL (`ops/db/` scripts + runbook + local proof; decision SD-11) |
| EXT-08 | Off-server encrypted backups, NAS file backup, quarterly restore test | Infra | 30 days | OPEN EXTERNAL (plan prepared; policy draft) |
| EXT-09 | OS / runtime / database / NAS patching | Infra | 30 days, then monthly | OPEN EXTERNAL |
| EXT-10 | Lock down dev PC `.env` and `backups\`; encrypt disk; purge old dumps | IT + Dev | **URGENT** | OPEN EXTERNAL (ACL plan prepared; nothing changed on the PC) |
| EXT-11 | Self-host the Google Fonts | Dev | 90 days | CODE DONE — OPEN until deployed (`79dbae7`, `b401e9f`) |
| EXT-12 | Reproducible (locked) Python installs in production deploys | Dev + IT | 30 days | CODE DONE — OPEN EXTERNAL (`constraints.txt`; reference deploy script uses it) |
| EXT-13 | Put the production launcher and release script in git; Windows runbook | Dev + IT | 30 days | REFERENCE DONE — OPEN EXTERNAL (`ops/windows/` templates; live launcher still not in git) |
| EXT-14 | External VAPT by an independent firm | Management + Audit | 90 days (after EXT-01..08) | OPEN (decision SD-10) |
| EXT-15 | ISO 27001 certification body engagement | Management | 12 months | OPEN (decision SD-16) |
| EXT-16 | SOC 2 auditor (CPA firm) selection | Management | 12 months | OPEN (decision SD-16) |
| EXT-17 | Policy set | Management + Security | 90 days | OPEN (15 drafts written, 0 approved; SD-16) |
| EXT-18 | Quarterly access review | Management (CKAM owner) | 30 days, then quarterly | OPEN (draft procedure + form) |
| EXT-19 | MFA decision (head-office admin and Full Admin first) | Management + Dev | 90 days | OPEN DECISION (SD-03) |
| EXT-20 | Incident response plan | Security + Management | 30 days | OPEN (draft plan + form) |
| EXT-21 | Log retention and off-server log shipping | Infra + Dev | 90 days | OPEN (decision SD-15) |
| EXT-22 | Monitoring and alerting; weekly security-log review | IT + Management | 30 days | OPEN EXTERNAL |
| EXT-23 | Password manager for server secrets, with break-glass | IT + Management | 30 days | OPEN EXTERNAL |
| EXT-24 | Segregation from shared servers (Spinwheel, Citykart Desk) | Infra + Management | 12 months | OPEN EXTERNAL |
| EXT-25 | ERP read-only DB role with TLS | Vendor (ERP warehouse owner) + Infra | 90 days | CODE DONE — OPEN EXTERNAL (`PO_SOURCE_SSLMODE`, default `prefer`; ERP owner must confirm) |
| EXT-26 | Decision D6: limit Full Admin to chosen companies | Management | 30 days | OPEN DECISION (SD-02) |
| EXT-27 | Apply PostgreSQL slow-query / lock logging on 10.0.0.205 | Infra (DBA) | 90 days | OPEN EXTERNAL |
| EXT-28 | Company-owned repository with MFA and branch protection; CI | Management + Dev | 90 days | OPEN |
| EXT-29 | BCP / DR plan, RTO/RPO, reboot test, server-room check | Management + Infra | 90 days | OPEN (draft plan) |
| EXT-30 | Rule for shared store logins | Management + HR | 90 days | OPEN DECISION (SD-07) |
| EXT-31 | Legal review: personal data, incident reporting, record keeping | Management (Legal) | 90 days | OPEN (decision SD-09) |
| EXT-32 | Awareness training; screening/NDA confirmation | HR + Security | 90 days, then yearly | OPEN (draft plan) |
| EXT-33 | Joiner / mover / leaver process | HR + IT | 30 days | OPEN (draft procedure + form) |
| EXT-34 | Supplier review | Management + IT | 90 days, then yearly | OPEN (draft) |
| EXT-35 | Change record per release; emergency change rule | Dev + Management | 30 days | OPEN (draft procedure + form) |
| EXT-36 | ISMS roles, risk-register ownership, internal audit, management review | Management + Audit | 90 days / 12 months | OPEN (drafts; SD-16) |
| EXT-37 | Antimalware / EDR on servers and NAS | Infra | 30 days | OPEN EXTERNAL |
| EXT-38 | Start production uvicorn with `--no-proxy-headers` (N2) and `--no-server-header` | IT | **URGENT** (with EXT-01) | CODE DONE — OPEN EXTERNAL (every repository launch path and the reference launcher; production launcher not changed) |
| EXT-39 | Pre-deploy checks for the new release: JWT secret strength, `ENVIRONMENT_NAME=production`, `alembic upgrade head` (four migrations) before start, constraints | IT + Dev | **URGENT** (with EXT-01) | OPEN EXTERNAL (runbook phase 1 prepared) |
| EXT-40 | Watch the sign-in rate limit for users behind one NAT address | IT + Dev | 30 days after deploy | OPEN (after deploy; SD-08) |
| EXT-41 | Preserve and copy production logs off-server before the deploy, for the compromise assessment | IT + Security | **URGENT** (with EXT-01/EXT-03) | OPEN EXTERNAL |
| EXT-42 | Keep a signed change record and emergency-change note for the IF-01 deploy | Dev + Management | **URGENT** (with EXT-01) | OPEN (draft form) |
| EXT-43 | Give CKAM its own NAS account if `ckappuser` is shared, before rotating the NAS password | Infra + NAS admin | **URGENT** (decision) / 30 days | OPEN DECISION |
| EXT-44 | Deploy the QR / Asset 360 deep-link fix (CL2-IF-04) — a production functional bug today | Management + IT | **URGENT** (same deploy as EXT-01) | CODE DONE — OPEN EXTERNAL (`ca94574`) |
| EXT-45 | Run the **updated** `ops/db` role-split scripts (sequence privilege USAGE/SELECT only, `RESET ALL`) — never an older copy | Infra (DBA) + Dev | 30 days (part of EXT-07) | CODE DONE — OPEN EXTERNAL |
| EXT-46 | Re-run `ops/db/check_least_privilege.sql` after every deploy and keep the output | IT / DBA + Dev | Every deploy (from the first deploy after EXT-07) | OPEN (script ready) |
| EXT-47 | Replace `python-jose` with PyJWT (follow-up to IF-12) | Dev | 90 days | OPEN (development task; normal release) |
| EXT-48 | Alert on the audit-write failure line (`log_write_failed`) and on REFRESH_REUSE bursts | IT + Dev | 30 days after deploy (with EXT-22) | OPEN (code produces the line; no alert) |
| EXT-49 | Set a per-office NAT policy for the sign-in limit (20/min per address) | Management + IT | 30 days after deploy | OPEN DECISION (SD-08) |
| EXT-50 | Decide an absolute session lifetime | Management + Dev | 90 days | OPEN DECISION (SD-14) |

> **Status: nothing in this list is complete.** Items marked CODE DONE / REFERENCE DONE have only their repository
> side finished; they become complete only when deployed (or done on the real system) **and verified there**.
> Each item's **Timing** column is also its classification bucket (`URGENT` / `30 days` / `90 days` / `12 months`).
> Section "Prerequisite, rollback and audit evidence per item" after EXT-50 gives those three fields for every EXT
> at a glance; the per-item sections give the full action, why, risk and verification.

Urgent order (unchanged): **EXT-39 (prechecks) → EXT-01 (deploy with the four migrations; carries EXT-44) →
EXT-38 (start with `--no-proxy-headers --no-server-header`) → verify IF-01 closed and the QR deep link opens →
EXT-02 (rotate secrets, EXT-43 settled first)**, preceded by EXT-41 (preserve logs) and followed by EXT-03
(compromise assessment), all recorded under EXT-42. Rationale: changing secrets while the hole is still
open is wasted effort, because the new secrets could be read the same way, so rotate only after the fixed release
is verified. The full numbered procedure is in `docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`.
**EXT-05 decision as soon as possible** (closing or narrowing the internet forward reduces the danger while EXT-01
is prepared). HTTPS (EXT-04), the service account (EXT-06), the DB role split (EXT-07) and backups (EXT-08) follow
in their own windows — see `CKAM_HTTPS_IMPLEMENTATION_PLAN.md`, `CKAM_SERVICE_ACCOUNT_PLAN.md` and
`CKAM_BACKUP_RESTORE_PLAN.md`.

---

## EXT-01 Deploy the IF-01 fix to production — URGENT

| | |
|---|---|
| What | After the owner approves the push and, separately, the deploy: deploy a release at `fd34520` or later, which contains all 21 security commits (`3e134c1` … `fd34520`; the IF-01 fix incl. the Windows path forms, the QR deep-link fix EXT-44, refresh-token reuse detection, the lifecycle DB guard and everything else; all retested locally), following `docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` phases 1-7 (precheck, approved push, backup, `alembic upgrade head` with the four migrations `f9a1c3e5b7d2`, `a3c5e7f9b1d4`, `b5d7f9a1c3e5`, `c6e8a0b2d4f6` **before** the new code starts, deploy the release folder + `FRONTEND_DIST_DIR`, start with the EXT-38 flags, verify) **plus the pre-deploy checks in EXT-39**. *(Original 2026-10-15 text: release at `d04779a` with 8 commits; superseded.)* |
| Why (plain words) | The live server (release `3b5e842`) hands out any file on the server to anyone who asks in a special way, including the file with the database password and the key that signs logins. The fix, and all other fixes of 2026-10-15, exist on the dev PC only |
| Risk if ignored | Full takeover of CKAM: an attacker can forge a head-office-admin login, read or change all data in `ckassetmanagement`, read NAS documents, and use the ERP password. The server is reachable from the internet (R-02, R-03, R-18) |
| Owner | Management (approve) + IT (deploy) |
| Timing | **URGENT** |
| Done when | On production: `GET /assets/..%2f..%2f..%2fshared%2f.env`-style probes **and the Windows forms** (`..%5c`, `%2e%2e%5c`, `C:%2fWindows%2fwin.ini`, `%5c%5cserver%5cshare`) return plain 404 (never 200); unknown `/api/...` paths and `/docs`, `/redoc`, `/openapi.json` return JSON 404; security headers appear exactly once incl. `Content-Security-Policy` without Google hosts; no `Server` header; `/assets/<id>` (QR deep link) opens the app page (EXT-44); sign-in, receive and move smoke tests pass; `alembic current` = `c6e8a0b2d4f6`; `system_event` `app_started` shows the new version and `production`; `ops/db/check_least_privilege.sql` output kept once EXT-07 is done (EXT-46); a change record exists (EXT-42) |
| Status 2026-10-16 | OPEN EXTERNAL. Code ready and retested locally (backend 2541 passed / 1 skipped, frontend 1257, security journeys 14/14, two closure retests); nothing pushed or deployed |

## EXT-02 Rotate production secrets after EXT-01 — URGENT

| | |
|---|---|
| What | After EXT-01 is verified: (1) new random `JWT_SECRET` (at least 32 characters with at least 8 different characters, e.g. 64 random hex characters; the new code refuses to start otherwise) in `shared\.env` — every user signs in again, nothing else breaks; (2) new password for DB role `ckassetapp` (the owner runs `ALTER ROLE` as superuser on 10.0.0.205 and updates `DATABASE_URL` in `shared\.env`); (3) new password for NAS user `ckappuser` (on the NAS) and in `shared\nas.pw`; (4) new password for ERP role `ckpost`, coordinated with the ERP warehouse owner, then `PO_SOURCE_PASSWORD` in `shared\.env`. Restart `CKAM-Web`. Delete or lock down old copies such as `shared\.env.pre-3b5e842` (they hold the old secrets). Confirm the new production values are not the same as any dev value |
| Why | Since 2026-09-30 every release had IF-01. Anyone who used it could have copied these secrets. Changing them makes stolen copies useless |
| Risk if ignored | A copied JWT secret lets someone sign in as anyone, forever, without a password and without a LOGIN row in the audit trail |
| Owner | IT + Infra (the owner types the passwords) |
| Timing | **URGENT**, immediately after EXT-01 |
| Done when | Old access tokens are rejected (401); the app starts without the placeholder-secret refusal; `/api/admin/diagnostics/health` OK; NAS mapping line in the launcher log succeeded; ERP `sync_success` after restart; a dated rotation note (who, when, which secrets; never the values) is kept |

## EXT-03 Compromise assessment for IF-01 — URGENT

| | |
|---|---|
| What | Look for signs that IF-01 was used: (1) `logs\app\app.jsonl` access lines (exist since 2026-10-14) with paths under `/assets/` containing `..`, `%2e`, `%2f`, `%5c` or a leading `/`; (2) older launcher logs in `logs\` for the same patterns, if they contain request lines; (3) `audit_log`: actions by head-office admin or Full Admin accounts from unknown IP addresses, or actions with no LOGIN row from the same address (a forged token does not create a LOGIN row); (4) PostgreSQL log on 10.0.0.205 for `ckassetapp` connection attempts from other hosts (pg_hba blocks them, but attempts show intent); (5) NAS access log for `ckappuser` from unexpected hosts; (6) router/firewall logs for unusual volumes on 3211. Record the result as an incident (EXT-20) |
| Why | Fixing a hole does not tell you whether someone already came through it |
| Risk if ignored | A past intrusion goes unnoticed; data changes or copies stay unexplained |
| Owner | Security + IT |
| Timing | **URGENT** (in parallel with EXT-01) |
| Done when | A written incident record: period checked, sources checked, findings, decision (no evidence of use / evidence of use and next steps) |

## EXT-04 HTTPS for production — 30 days

| | |
|---|---|
| What | Serve CKAM only over HTTPS. **Recommended design:** a reverse proxy on 10.0.1.98 terminates TLS and forwards to uvicorn bound to `127.0.0.1` only. **Proxy options:** Caddy for Windows (simple, can renew certificates itself), nginx for Windows, or IIS with URL Rewrite/ARR if IIS is already the standard on that server. Check `D:\Citykart_Applications\PORTS.md` first because the server is shared and 443 may already be used. **Certificate options:** (a) the existing `*.citykartstores.com` wildcard if CityKart has one; (b) Let's Encrypt: because the public port is 3211, the domain proof must be a DNS-01 TXT record (automatic only with DNS API access, otherwise manual every 90 days, which is risky); (c) a paid 1-year certificate. A public-CA certificate needs nothing installed on users' devices; a self-signed or internal-CA one would. **Settings after the switch:** `COOKIE_SECURE=true`, `BASE_URL=https://ckam.citykartstores.com:3211` (or `:443`), `TRUSTED_PROXIES=127.0.0.1` so the real client IP from `X-Forwarded-For` is recorded. **Redirect:** if a plain-HTTP listener remains (e.g. port 80), it only answers with a redirect to HTTPS. **HSTS:** only after HTTPS has been stable for some weeks, start with a short `max-age` (minutes), then raise it to one year; do not use `preload` at first. **LAN users:** use the DNS name, not `http://10.0.1.98:3211` (by IP the browser shows a name warning); internal DNS may need a record. **Renewal:** automatic or calendared with an alert; protect the private key file (Administrators + the CKAM service account only) |
| Why | Today passwords and session cookies travel in clear text over the internet; anyone on the path can read them (IF-02, AU-13) |
| Risk if ignored | Stolen passwords and sessions; SOC 2 CC6 and ISO A.8.24 cannot be met |
| Owner | Infra |
| Timing | 30 days |
| Done when | An HTTPS scan (e.g. a TLS checker) shows a valid certificate and TLS 1.2+ only; `http://` requests are refused or redirected; refresh cookie carries `Secure`; the audit trail shows real client IPs; renewal date is in the calendar |

## EXT-05 Stop or restrict the internet port-forward of 3211 — URGENT decision, 30 days to complete

| | |
|---|---|
| What | Decide who really needs CKAM from outside the CityKart network. If nobody: remove the router forward TCP 3211 → 10.0.1.98:3211. If stores or staff outside need it: prefer the corporate VPN; otherwise keep it only behind HTTPS (EXT-04), with the login rate limit (AU-03) deployed, and if possible an IP allow-list of store public IPs. Consider keeping head-office-admin use LAN/VPN-only |
| Why | The forward lets anyone on the internet reach the login page and every weakness of the server |
| Risk if ignored | Internet scanning finds CKAM; IF-01-type flaws and password guessing are exposed to the whole world (R-18) |
| Owner | Infra + Management (decision) |
| Timing | Decision **URGENT**; change within 30 days |
| Done when | From an outside network, `http://ckam.citykartstores.com:3211/` does not connect (forward closed) or connects only through VPN / allow-listed IPs; router configuration export kept |

## EXT-06 Low-privilege Windows service account instead of SYSTEM — 30 days

| | |
|---|---|
| What | Create a dedicated account (e.g. `svc_ckam`, local or domain) that is not an administrator, cannot log on interactively, and has: read/execute on `releases\` and `shared\venv`, modify on `logs\`, read on `shared\.env` and `shared\nas.pw` (and nothing else of other apps), and the "Log on as a batch job" right. Change the `CKAM-Web` scheduled task to run as this account. Remove SYSTEM/Everyone read on the secret files except Administrators and `svc_ckam` |
| Why | CKAM currently runs with the highest Windows privilege on a server shared with Spinwheel and Citykart Desk (IF-07). Any CKAM flaw becomes full control of the server and the other apps |
| Risk if ignored | One bug = whole server, all apps, all their secrets (R-07, R-06) |
| Owner | Infra |
| Timing | 30 days |
| Done when | Task Scheduler shows `CKAM-Web` running as the new account; the app starts, NAS mapping succeeds, uploads work; `icacls` output for `shared\` kept as evidence; a reboot test passes (EXT-29) |

## EXT-07 Separate low-privilege runtime database role — 30 days

| | |
|---|---|
| What | Split the database account into (a) an **owner/migration role** that owns the schema and is used only during deploys for `alembic upgrade head`, and (b) a **runtime role** used by the running app, which can read and write business tables, can only INSERT and SELECT on the audit tables (`audit_log`, `asset_event`, `asset_field_change`, `master_audit`), cannot TRUNCATE, cannot ALTER or DROP anything, cannot disable triggers and cannot run the audit purge function. **Update 2026-10-16:** the design and scripts now exist and were proven on a disposable database: `ops/db/role_split.sql`, `ops/db/role_split_verify.sql`, `ops/db/check_least_privilege.sql`, `ops/db/ROLE_SPLIT_RUNBOOK.md` (owner / migrator / runtime; Alembic runs as the migrator via `ALEMBIC_SET_ROLE`; runtime role 7/7 needed actions work, 40/40 forbidden actions refused; verify 45/45; 34 least-privilege checks; `docs/security/evidence/closure/db/WPB_RESULTS.md`). Use only the **current** scripts (sequence privilege USAGE/SELECT only and `RESET ALL`: EXT-45). The owner runs them as superuser on 10.0.0.205; this document does not repeat the SQL |
| Status 2026-10-16 | CODE DONE — OPEN EXTERNAL. Nothing changed on 10.0.0.205; decision SD-11 (window, role names) |
| Why | Today the production app connects as `ckassetapp`, which runs Alembic and therefore owns the tables. A table owner can switch off or drop the append-only triggers and wipe the audit trail (IF-05, IF-06; `db_03` section C). The code fix (TRUNCATE guards and a 5-year audit purge floor, migration `a3c5e7f9b1d4`, status MITIGATED) narrows this but cannot stop an owner or superuser |
| Risk if ignored | An attacker with the runtime password, or a bug, can rewrite history that auditors rely on (R-12) |
| Owner | Infra (DBA) + Dev |
| Timing | 30 days (after EXT-02) |
| Done when | `pg_roles` / table-owner query on 10.0.0.205 shows the runtime role is not the owner and has no TRUNCATE; the `db_03` style tests (in a rolled-back transaction) show TRUNCATE, DISABLE TRIGGER and DROP refused for the runtime role |

## EXT-08 Off-server encrypted backups, NAS file backup, restore test — 30 days

| | |
|---|---|
| What | (1) Copy each nightly dump from `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP` to a second location **not on 10.0.0.205**, encrypted (e.g. AES-256 archive, or a backup tool with encryption), with the key kept in the password manager (EXT-23). (2) Keep at least one copy **offline or immutable** (cannot be deleted by a compromised server account) against ransomware. (3) Back up the NAS folder `CKASSETMANAGEMENT_DATA` (documents) on the same schedule. (4) Every quarter restore the latest dump into a throw-away database on a non-production server, compare row counts and the Alembic version, open a few documents, and write down the time it took (this is the measured RTO). Never restore over `ckassetmanagement` for a test |
| Why | Today all backups sit on the same server as the database, unencrypted, and have never been restored in production (IF-08). A disk failure, a ransomware attack or a mistake on 10.0.0.205 loses both the data and the backups |
| Risk if ignored | Permanent loss of the asset register and documents (R-13, R-14) |
| Owner | Infra |
| Timing | 30 days |
| Done when | Off-server copy log shows daily success; one offline/immutable copy exists; NAS folder backup log exists; a dated restore-drill report with row counts and duration |

## EXT-09 Patching of OS, runtime, database and NAS — 30 days, then monthly

| | |
|---|---|
| What | Monthly patch window for Windows on 10.0.1.98 and 10.0.0.205, Python 3.13 (`C:\Program Files\Python313`), PostgreSQL 18 minor releases, and NAS firmware. Check vendor advisories (subscribe, A.5.6). Patch status is NOT EVIDENCED today |
| Why | Old software has known holes that attackers use first |
| Risk if ignored | Compromise through a known, already-fixed vulnerability (R-17) |
| Owner | Infra |
| Timing | Baseline within 30 days, then monthly |
| Done when | Monthly patch report per server (installed updates, pending updates, reboot date) |

## EXT-10 Dev PC: `.env`, `backups\`, disk — URGENT (local action)

| | |
|---|---|
| What | On 10.0.0.47: restrict the repository's `.env` and `backups\` folder (it holds about 30 daily dev dumps and a first-login note) to the developer account and Administrators only; enable disk encryption (BitLocker); delete dev dumps older than needed; remember the dev database holds a copy of **real** ERP data (vendors, POs) |
| Why | IF-09: other local accounts or malware on the dev PC can read dev secrets and dumps |
| Risk if ignored | Leak of real vendor/PO data and dev credentials (R-25) |
| Owner | IT + Dev |
| Timing | **URGENT** |
| Done when | `icacls` output shows only the developer and Administrators; BitLocker status "on"; dump count reduced |
| Status 2026-10-16 | OPEN EXTERNAL. A step-by-step ACL plan exists (`docs/security/evidence/closure/infra/IF-09_ACL_PLAN.md`); **nothing was changed on the PC** |

## EXT-11 Self-host the Google Fonts — 90 days

| | |
|---|---|
| What | Download the Inter and IBM Plex Mono font files once, add them to the frontend build, remove the `fonts.googleapis.com` / `fonts.gstatic.com` links from `frontend/index.html` (a small frontend code change, then a normal release) |
| Why | Every page load sends the user's IP address to Google and depends on an outside site; the new Content-Security-Policy (AU-14) has to allow Google's font hosts until this is done |
| Risk if ignored | Minor privacy issue; page looks different if Google is unreachable (R-29) |
| Owner | Dev |
| Timing | 90 days |
| Done when | Browser network tab shows no request to Google; fonts still render |
| Status 2026-10-16 | CODE DONE — OPEN until deployed. Inter and IBM Plex Mono (latin, latin-ext) are self-hosted (`frontend/src/fonts.css`, `79dbae7`); backend CSP without Google hosts (`b401e9f`); `npm run check:build` fails on any Google host; retest 2 Playwright run showed 0 Google requests (`evidence/closure/retest2/infra/raw/fonts_csp_playwright_summary.txt`). Production `3b5e842` still loads Google Fonts until EXT-01 |

## EXT-12 Reproducible Python installs in production — 30 days

| | |
|---|---|
| What | `backend/constraints.txt` now exists (IF-11 FIXED in code, commit `ae706bb`). Use it in every production deploy (`pip install -c constraints.txt -e ...`), keep `pip freeze` of each release next to it, and run `pip-audit` on that list before deploy |
| Why | Without a lock, production may install different package versions from the tested ones |
| Risk if ignored | Untested or vulnerable versions in production (R-15) |
| Owner | Dev + IT |
| Timing | 30 days |
| Done when | Each `releases\<sha>\` has a `pip freeze` file identical to the tested set |
| Status 2026-10-16 | CODE DONE — OPEN EXTERNAL. `backend/constraints.txt` exists and the reference `ops/windows/deploy_ckam.ps1.template` installs with `-c constraints.txt`; pip-audit on the pinned set re-run (`evidence/closure/backend/dependency_recheck.md`): python-jose / ecdsa have no fixed version, not reachable, ACCEPTED (PyJWT follow-up EXT-47). Never used on 10.0.1.98 yet |

## EXT-13 Production launcher and release script in git; Windows runbook — 30 days

| | |
|---|---|
| What | Add `run_ckam_web.ps1` and the release script (secrets removed, read from `shared\.env` as today) to the repository; rewrite `docs/ai/CKAM_RELEASE_RUNBOOK.md` for the real Windows single-port production (it still describes Docker, IF-15) |
| Why | The steps that touch production are not reviewed or versioned |
| Risk if ignored | A wrong deploy or an untraceable change (R-23) |
| Owner | Dev + IT |
| Timing | 30 days |
| Done when | Scripts in git; runbook matches what the operator actually does |
| Status 2026-10-16 | REFERENCE DONE — OPEN EXTERNAL. `ops/windows/` holds secret-free templates (`run_ckam_web.ps1.template` with `--no-proxy-headers --no-server-header`, `deploy_ckam.ps1.template`, `rollback_release.ps1.template`, `verify_release.ps1`, README), checked with the PowerShell parser and `-WhatIf` dry runs (`evidence/closure/infra/raw/windows/`). The **live** launcher on 10.0.1.98 is still not in git and has not been compared with the reference; IT must confirm |

## EXT-14 External VAPT by an independent firm — 90 days

| | |
|---|---|
| What | Engage an independent security testing firm (for example a CERT-In empanelled auditor) for an authenticated web-application and infrastructure test, after EXT-01 to EXT-08, with a written scope and an approved test plan; production tests only with the owner's written approval |
| Why | The 2026-10-15 VAPT was done by the people who build CKAM; ISO A.5.35 and SOC 2 CC4/CC7 expect independent testing |
| Risk if ignored | Blind spots of the builders stay hidden |
| Owner | Management + Audit |
| Timing | 90 days |
| Done when | Signed report; findings tracked to closure |

## EXT-15 ISO 27001 certification body engagement — 12 months

| | |
|---|---|
| What | Only after the ISMS has operated (policies approved, risk treatment running, at least one internal audit and one management review, EXT-36), choose an **accredited** certification body and plan Stage 1 (documents) and Stage 2 (implementation) audits |
| Why | Certification can only come from an accredited, independent body; this repository's documents are readiness material only |
| Owner | Management |
| Timing | 12 months |
| Done when | Signed engagement; Stage 1 date booked |

## EXT-16 SOC 2 auditor selection — 12 months

| | |
|---|---|
| What | If customers or partners ask for SOC 2: select a licensed CPA firm; agree scope (Security + Confidentiality + Processing Integrity recommended), Type I first, then a Type II observation period (commonly 6-12 months) |
| Why | A SOC 2 report can only be issued by an independent CPA firm |
| Owner | Management |
| Timing | 12 months |
| Done when | Engagement letter with scope and observation-period dates |

## EXT-17 Policy set — 90 days

| | |
|---|---|
| What | Short, approved policies: information security (top level); access control (incl. least privilege, D6, store logins); passwords and MFA; acceptable use; data classification and handling (incl. exports); cryptography and key management (JWT secret, certificates, backup keys, rotation); backup and restore; change management (incl. emergency changes); secure development (incl. the baseline and AI-assisted development: no production data or secrets in prompts, human review of every change); vulnerability and patch management; logging and monitoring; incident response; supplier security; business continuity; data retention and privacy |
| Why | ISO A.5.1 and SOC 2 CC1/CC5 start from written, approved rules |
| Owner | Management + Security |
| Timing | 90 days |
| Done when | Signed and dated policies; staff acknowledgement records |
| Status 2026-10-16 | OPEN. 15 documents and 6 blank record forms were written in `docs/security/policies/` — all **DRAFT — MANAGEMENT APPROVAL REQUIRED**, 0 approved, 0 operating (decision SD-16). A draft is not evidence |

## EXT-18 Quarterly access review — 30 days, then quarterly

| | |
|---|---|
| What | The head-office admin exports the user list (`GET /api/asset-users/export`), checks for each login: still employed, right access level, right companies, right work area, head-office admin flag only where intended, store logins still needed; fixes and signs. Include server and database accounts (who can log on to 10.0.1.98 / 10.0.0.205, who knows the superuser password) |
| Why | Access drifts over time; reviews catch leftovers and mistakes (R-04, R-16) |
| Owner | Management (CKAM owner) |
| Timing | First review within 30 days, then quarterly |
| Done when | Signed review sheet per quarter; matching `ACCESS_CHANGED` / deactivation rows in the audit trail |

## EXT-19 MFA decision — 90 days

| | |
|---|---|
| What | Decide whether to add a second factor (e.g. authenticator-app TOTP) for head-office admin and Full Admin first, then others. Until MFA exists, keep admin use on the LAN/VPN (EXT-05) |
| Why | A stolen password is today enough to act as an admin |
| Owner | Management (decision) + Dev (build) |
| Timing | Decision within 90 days |
| Done when | Written decision; if yes, MFA enforced for the chosen roles and tested |

## EXT-20 Incident response plan — 30 days

| | |
|---|---|
| What | A short plan: who leads, severity levels, first steps for CKAM (switch off the port-forward, stop `CKAM-Web`, preserve logs with `GET /api/admin/logs/export`, rotate secrets per EXT-02), who talks to management and users, when and how to report to CERT-In (confirm the required window with legal counsel, EXT-31), how to restore, and a post-incident review. Test it once a year with a table-top exercise; use IF-01 as the first real case (EXT-03) |
| Why | Without a plan, people improvise under pressure and evidence is lost |
| Owner | Security + Management |
| Timing | 30 days |
| Done when | Approved plan; IF-01 incident record; first exercise record |

## EXT-21 Log retention and off-server log shipping — 90 days

| | |
|---|---|
| What | Decide retention: `audit_log` is kept forever by design (check this against privacy, EXT-31); set `LOG_RETENTION_DAYS` long enough for audit needs (above 365 days if SOC 2 Type II is planned); copy `audit.jsonl` / `error.jsonl` / `app.jsonl` (or monthly exports from `GET /api/admin/logs/export`) to storage that the CKAM server account cannot delete; keep a hash of each export |
| Why | Logs on the same server can be lost or altered together with the server |
| Owner | Infra + Dev |
| Timing | 90 days |
| Done when | Retention written in policy; off-server log store with monthly files and hashes |

## EXT-22 Monitoring, alerting and log review — 30 days

| | |
|---|---|
| What | Alerts (e-mail or chat) for: `CKAM-Web` down (external check of `/api/health`), many `LOGIN_FAILED` / `LOCKED` rows, 5xx spikes in `error_log`, ERP `sync_failed` or no `sync_success` for a day, backup task failure, disk space. Weekly 15-minute review by the head-office admin of SECURITY rows (`GET /api/admin/logs/audit?category=security`) and grouped errors, with a one-line note kept |
| Why | Today problems are only seen when a user complains (R-27) |
| Owner | IT + Management |
| Timing | 30 days |
| Done when | Alert test messages received; weekly review notes exist |
| Note 2026-10-16 | After the deploy the code also produces `RATE_LIMITED`, `REFRESH_REUSE` and `REFRESH_DUPLICATE` security rows and a `log_write_failed` error line when an audit row cannot be written; alerting on those is EXT-48 |

## EXT-23 Password manager for server secrets — 30 days

| | |
|---|---|
| What | Store the JWT secret, DB passwords (incl. `postgres` superuser), NAS password, ERP password, backup encryption key and certificate key passphrase in a company password manager with access for two named people and a sealed break-glass procedure |
| Why | Today these exist only in server files and in one person's memory (R-24) |
| Owner | IT + Management |
| Timing | 30 days |
| Done when | Vault entries exist (names only listed as evidence, never values); two people can retrieve them |

## EXT-24 Segregation from shared servers — 12 months

| | |
|---|---|
| What | Reduce what Spinwheel and Citykart Desk can do to CKAM: separate service accounts per app (EXT-06), separate database roles (already), consider a separate VM for CKAM or at least separate Windows file permissions per app folder; review who administers the shared servers |
| Why | A weakness in another app on 10.0.1.98 / 10.0.0.205 / the NAS can reach CKAM (R-06) |
| Owner | Infra + Management |
| Timing | 12 months |
| Done when | Written separation design; per-app accounts; (optional) dedicated VM |

## EXT-25 ERP read-only DB role with TLS — 90 days

| | |
|---|---|
| What | With the ERP warehouse owner on 10.0.1.69: confirm role `ckpost` has **SELECT only** on the views CKAM reads (no INSERT/UPDATE/DELETE/TRUNCATE, no ownership); set `default_transaction_read_only = on` **on the role itself** (`ALTER ROLE ... SET`), not only per connection as CKAM does today; require TLS for this role (`hostssl` in `pg_hba.conf`); then switch CKAM to `PO_SOURCE_SSLMODE=require` or `verify-full` with `PO_SOURCE_SSLROOTCERT` (the CKAM-side option now exists, IF-16 code side, `7b039fb`; default `prefer` = today's behaviour, TLS not mandatory) |
| Status 2026-10-16 | CODE DONE — OPEN EXTERNAL. Tested only with stand-ins (`backend/tests/erp/test_erp_tls_settings.py`); the real ERP was never contacted; the ERP owner must confirm TLS support and the SELECT-only grant |
| Why | Today read-only is guaranteed by CKAM's own connection setting; the ERP password and data travel unencrypted on the LAN |
| Owner | Vendor (ERP warehouse owner) + Infra |
| Timing | 90 days |
| Done when | `\du` / grant listing shows SELECT only; role setting shows read-only; `pg_stat_ssl` shows TLS for CKAM's connection |

## EXT-26 Decision D6: limit Full Admin to chosen companies — 30 days

| | |
|---|---|
| What | Owner decides whether an ordinary Full Admin should work only in chosen companies (CKSPL / CKVPL) instead of every company (open since 2026-10-14, `docs/ai/DECISIONS.md`) |
| Why | Least privilege: a Full Admin of one company can today act in the other |
| Owner | Management |
| Timing | 30 days |
| Done when | Decision recorded in `docs/ai/DECISIONS.md`; if "limit", built, tested with cross-company tests, deployed |

## EXT-27 PostgreSQL logging on 10.0.0.205 — 90 days

| | |
|---|---|
| What | Apply the slow-query, lock-wait and checkpoint settings listed in `docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 7 (can be limited to CKAM's database for `log_min_duration_statement`); consider `log_connections` for the CKAM role only if volume allows |
| Why | Database-side evidence for performance and security investigations |
| Owner | Infra (DBA; superuser step typed by the owner) |
| Timing | 90 days |
| Done when | `GET /api/admin/diagnostics/db` shows `slow_statement_logging_on` true |

## EXT-28 Company-owned repository, MFA, branch protection, CI — 90 days

| | |
|---|---|
| What | The `origin` remote is a GitHub repository under a personal account. Move it to a CityKart-owned organisation, keep it private, require MFA for every member, protect the default branch (`claude/brave-euler-07879a`), and add CI that runs the backend and frontend tests and the dependency audit on every push (IF-17). Consider signed commits |
| Why | The company must control its source code even if a person leaves; CI gives durable test evidence |
| Owner | Management + Dev |
| Timing | 90 days |
| Done when | Repository settings screenshot (owner, visibility, MFA, branch rules); CI run history |

## EXT-29 BCP / DR plan, reboot test, server-room check — 90 days

| | |
|---|---|
| What | Agree RTO/RPO with the business; write the recovery steps (restore DB per EXT-08, restore NAS documents, redeploy last release, rotate secrets if compromise); do the open reboot test of 10.0.1.98 (`CKAM-Web` returns, NAS mapping works); record the accepted risk of having no standby server (A.8.14); confirm physical protection of the server room and NAS (A.7) |
| Why | Nobody knows today how long CKAM could be down or how much data could be lost |
| Owner | Management + Infra |
| Timing | 90 days |
| Done when | Approved plan; reboot test record; server-room checklist |

## EXT-30 Rule for shared store logins — 90 days

| | |
|---|---|
| What | Each store has one login (`sm.<code>@citykartstores.com`). Decide: only the store manager uses it, or named logins for store staff; no password sharing; password changed when the manager changes |
| Why | With a shared login, nobody can tell which person did an action (R-30) |
| Owner | Management + HR |
| Timing | 90 days |
| Done when | Written rule; acknowledged by store managers |

## EXT-31 Legal review — 90 days

| | |
|---|---|
| What | Legal counsel confirms: obligations under India's Digital Personal Data Protection Act 2023 for staff and vendor-contact data (notice, purpose, retention, requests); cyber-incident reporting to CERT-In (time window and what counts); retention rules for fixed-asset, purchase and invoice records; whether `audit_log` kept forever is acceptable for personal data |
| Why | The right technical retention depends on legal requirements |
| Owner | Management (Legal) |
| Timing | 90 days |
| Done when | Written legal register and retention decision |

## EXT-32 Awareness training; screening and NDAs — 90 days, then yearly

| | |
|---|---|
| What | Short yearly session for CKAM users (passwords, store logins, phishing, using Report a problem for anything suspicious); deeper session for admins; HR confirms screening and NDAs for staff with privileged access |
| Owner | HR + Security |
| Timing | 90 days, then yearly |
| Done when | Attendance list; HR confirmation |

## EXT-33 Joiner / mover / leaver process — 30 days

| | |
|---|---|
| What | HR notifies IT on joining, transfer and leaving; IT creates, changes or switches off the CKAM login the same day; before final settlement, assets held by the leaver (CKAM shows them) are returned |
| Owner | HR + IT |
| Timing | 30 days |
| Done when | Process note; sample of leavers matched to CKAM deactivation rows |

## EXT-34 Supplier review — 90 days, then yearly

| | |
|---|---|
| What | List and rate suppliers that touch CKAM: ERP warehouse team (data source), NAS vendor/support, GitHub (code), the AI coding assistant provider used in development (what data is shared), Google Fonts (until EXT-11), Python and npm package ecosystems, any external tester or auditor. Check terms, security commitments and contacts |
| Owner | Management + IT |
| Timing | 90 days, then yearly |
| Done when | Supplier register with rating and review date |

## EXT-35 Change record per release; emergency changes — 30 days

| | |
|---|---|
| What | Use the minimum change-record fields in `CKAM_SOC2_READINESS.md` section 8 for every production release (request id, approver, test evidence, rollback plan, deployment result); define the emergency path (e.g. IF-01: owner approves by message, record completed within one working day, reviewed afterwards) |
| Owner | Dev + Management |
| Timing | 30 days |
| Done when | A change record exists for the next release, including the IF-01 deploy |

## EXT-36 ISMS roles, risk ownership, internal audit, management review — 90 days / 12 months

| | |
|---|---|
| What | Appoint an ISMS lead; approve the scope (`CKAM_ISO27001_READINESS.md` section 2.1) and the risk method; assign an owner to every risk in the register; plan a yearly internal audit by someone independent of CKAM development; hold a yearly management review with minutes |
| Owner | Management + Audit |
| Timing | Roles and risk ownership 90 days; first internal audit and management review within 12 months |
| Done when | Appointment letter; approved register; audit report; review minutes |

## EXT-37 Antimalware / EDR on servers and NAS — 30 days

| | |
|---|---|
| What | Confirm or install antimalware/EDR on 10.0.1.98 and 10.0.0.205 with exclusions only where needed (PostgreSQL data folder per vendor guidance); enable NAS antivirus/snapshot features if available |
| Owner | Infra |
| Timing | 30 days |
| Done when | Console screenshot showing both servers protected and up to date |

## EXT-38 Start production uvicorn with `--no-proxy-headers` — URGENT (with EXT-01)

| | |
|---|---|
| What | Add `--no-proxy-headers` to the uvicorn command in the production launcher `shared\run_ckam_web.ps1` (and in the copy that goes into git, EXT-13). If a reverse proxy is added later (EXT-04), set CKAM's own `TRUSTED_PROXIES` to that proxy's address instead of re-enabling uvicorn's header handling |
| Why (plain words) | By default uvicorn believes the `X-Forwarded-For` header when the request comes from 127.0.0.1. On a shared server another local process could use this to pretend to be any address, which would put a false address in the audit trail and could sidestep the per-address sign-in limit (N2) |
| Risk if ignored | Wrong IP addresses in investigations; weaker rate limiting (R-32) |
| Owner | IT |
| Timing | **URGENT**, in the same deploy as EXT-01 |
| Done when | Launcher command line shows `--no-proxy-headers --no-server-header`; a test request from the server with a forged `X-Forwarded-For` is logged with `127.0.0.1`, not the forged address; responses carry no `Server` header |
| Status 2026-10-16 | CODE DONE — OPEN EXTERNAL. Every repository launch path (Docker dev/UAT, reference Windows launcher) uses both flags; `backend/tests/core/test_n2_forwarded_for.py`; in the dev stack nginx overwrites `X-Forwarded-For` and the API trusts only nginx (N3). The production launcher `shared\run_ckam_web.ps1` is unchanged until the deploy |

## EXT-39 Pre-deploy checks for the security release — URGENT (with EXT-01)

| | |
|---|---|
| What | Before starting the new code on 10.0.1.98: (1) confirm `shared\.env` has `ENVIRONMENT_NAME=production` set **explicitly** (an unset value now also counts as production and fails closed, CL1-N4-01; any name outside `development, dev, test, testing, uat, security-test, local, ci` counts as production); (2) confirm the **current** `JWT_SECRET` is at least 32 characters with at least 8 different characters (check the length and variety without printing the value); if not, generate the new secret now (EXT-02 step 1); (3) run `alembic upgrade head` **before** starting the new code: four migrations, `f9a1c3e5b7d2` (asset_user.token_version), `a3c5e7f9b1d4` (TRUNCATE guards + 5-year audit purge floor), `b5d7f9a1c3e5` (auth_session for refresh-token reuse detection), `c6e8a0b2d4f6` (DB guard on asset.status / holder / status_since); head `c6e8a0b2d4f6`; new code on the old schema fails; (4) install with `backend/constraints.txt` (EXT-12); (5) check the uvicorn flags (EXT-38); (6) note the new settings and their defaults (`RATE_LIMIT_*`, `REFRESH_REUSE_GRACE_SECONDS=10`, `PO_SOURCE_SSLMODE`, ERP timeouts, `TRUSTED_PROXIES` empty) |
| Why (plain words) | The new code deliberately refuses to start in production with a weak secret, and needs the two new database changes. Without these checks the deploy fails and the old, vulnerable release stays live longer |
| Risk if ignored | Failed deploy and downtime; IF-01 stays exposed |
| Owner | IT + Dev |
| Timing | **URGENT**, part of EXT-01 |
| Done when | Change record shows the six checks ticked; `alembic current` = `c6e8a0b2d4f6`; launcher log shows a normal start with `production` |

## EXT-40 Sign-in rate limit and shared NAT addresses — 30 days after deploy

| | |
|---|---|
| What | The new sign-in limit is 20 attempts per minute per client address (`RATE_LIMIT_LOGIN_PER_IP`), plus a per-login-id limit. Many staff behind one NAT address (a store, the head office internet line seen from outside) share that address. After deploy, watch `RATE_LIMITED` security rows and 429 answers for a few weeks (EXT-22) and raise the per-address value only if real users are refused at busy times (e.g. morning shift start) |
| Why (plain words) | The limit stops password guessing, but a busy office behind one address could hit it |
| Risk if ignored | Legitimate users refused for up to a minute (R-33); or, if raised too far, weaker protection |
| Owner | IT + Dev |
| Timing | Review 30 days after deploy |
| Done when | A note with the observed 429 counts and the decision (keep / change the value) |
| Note 2026-10-16 | The standing per-office rule (which offices share an address, what value applies) is EXT-49 / decision SD-08 |

## EXT-41 Preserve and copy production logs off-server for the compromise assessment — URGENT

| | |
|---|---|
| What | Before the IF-01 deploy restarts the process (`CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` Phase 1 step 7): copy `<ROOT>\logs\` (and any older launcher logs) to an admin-only evidence folder, hash each file (SHA-256), and copy the hashed set **off** 10.0.1.98. The app log files rotate by size (20 MB x 10) and a restart plus normal traffic will eventually overwrite the window that matters for EXT-03. Keep audit/log exports from `GET /api/admin/logs/export` the same way |
| Why (plain words) | The logs are the main evidence for whether IF-01 was used before the fix (EXT-03). A restart and ongoing traffic can push the relevant lines out of the rotation |
| Risk if ignored | The one chance to see use of the hole is lost; a past intrusion can never be confirmed or ruled out |
| Owner | IT + Security |
| Timing | **URGENT**, immediately before EXT-01 and feeding EXT-03 |
| Done when | A hashed copy of the pre-deploy logs exists off 10.0.1.98; its SHA-256 list is kept; EXT-03 cites it |

## EXT-42 Signed change record and emergency-change note for the IF-01 deploy — URGENT

| | |
|---|---|
| What | Complete the minimum change-record fields (`CKAM_SOC2_READINESS.md` section 8, EXT-35) for the IF-01 release: request id, approver, the Phase 1 pre-deploy answers, test/verification evidence (Phase 7 probe results), rollback plan, and the deployment result. Because IF-01 is treated as an emergency change, the owner may approve by message and the record is completed within one working day and reviewed afterwards |
| Why (plain words) | A security deploy that changes production must be traceable: who approved it, what was checked, how to undo it |
| Risk if ignored | An untraceable production change; a SOC 2 / ISO change-management gap on the most important release |
| Owner | Dev + Management |
| Timing | **URGENT**, part of EXT-01 |
| Done when | A signed change record exists for the IF-01 deploy, with the Phase 7 evidence attached, kept off-server |

## EXT-43 CKAM-only NAS account before rotating the NAS password — URGENT decision, 30 days to complete

| | |
|---|---|
| What | Before rotating the NAS password (EXT-02 / runbook Phase 10): confirm with the NAS admin whether NAS user `ckappuser` is used **only** by CKAM. If it is shared with Spinwheel or Citykart Desk, do **not** change its password (that would break those apps). Instead create a **CKAM-only** NAS account with modify rights on `CKASSETMANAGEMENT_DATA` only, point `shared\nas.pw` (and the launcher mapping) at it, verify uploads/downloads, and only then retire CKAM's use of the shared account. The same check applies to the ERP role `ckpost` before EXT-02's ERP step |
| Why (plain words) | Rotating a password that other apps also use would lock those apps out; and a shared file account means a CKAM compromise reaches the other apps' files |
| Risk if ignored | Either a broken sibling app (if the shared password is changed) or a NAS credential that cannot be safely rotated (if it is not) |
| Owner | Infra + NAS admin |
| Timing | Decision **URGENT** (blocks runbook Phase 10); CKAM-only account within 30 days |
| Done when | Written confirmation whether `ckappuser`/`ckpost` are CKAM-only; if shared, a CKAM-only NAS account exists and CKAM uploads/downloads work through it; `icacls`/NAS rights evidence kept |

## EXT-44 Deploy the QR / Asset 360 deep-link fix (CL2-IF-04) — URGENT (same deploy as EXT-01)

| | |
|---|---|
| What | Nothing extra to build: the fix is in `ca94574` and ships with the EXT-01 release. In single-port mode (production) `/assets/<id>` — the Asset 360 page that a printed QR label opens — and `/assets/new` must serve the app page, not a JSON 404. Add the check to the runbook's phase 7 verification and to the change record (EXT-42) |
| Why (plain words) | Release `3b5e842` has this bug **today**: staff who scan a printed asset label most likely get an error page instead of the asset. It is a functional bug, not a security hole, but it blocks physical verification with the labels |
| Risk if ignored | Labels are useless for verification; staff stop trusting them (R-39) |
| Owner | Management (approve) + IT (deploy) |
| Timing | **URGENT**, part of EXT-01 |
| Done when | On production after the deploy: `/assets/<a real asset id>` and `/assets/new` return 200 with the app page; a phone scan of one printed label opens the asset after sign-in; the IF-01 probes (EXT-01) still return 404 |
| Status 2026-10-16 | CODE DONE — OPEN EXTERNAL. Tested in `backend/tests/test_static_frontend_spa_assets.py`, the retest-2 single-port check (`evidence/closure/retest2/infra/raw/singleport_deeplinks.txt`) and the final native Windows run (`/assets/1234` → 200, `evidence/closure/windows/native_windows_final_release_fafa225.txt`) |

## EXT-45 Run the updated `ops/db` role-split scripts — 30 days (part of EXT-07)

| | |
|---|---|
| What | When EXT-07 is carried out, use **only the current versions** of `ops/db/role_split.sql`, `role_split_verify.sql` and `check_least_privilege.sql` from the deployed release (at `fd34520` or later). They contain two closure fixes: (1) the runtime role gets **USAGE, SELECT only** on sequences (CL2-IF-01: an earlier version granted UPDATE, which let `setval` break the audit/ledger id sequences); (2) `ALTER ROLE … RESET ALL` (also per database) so the runtime role cannot keep a self-set `default_transaction_read_only` or other setting (CL2-IF-02). Follow `ops/db/ROLE_SPLIT_RUNBOOK.md`; the owner types every password on the server |
| Why (plain words) | An older copy of the script would leave a quiet way to break new record numbers for the audit trail and the asset ledger |
| Risk if ignored | Write failures or broken id sequences after the split (R-37) |
| Owner | Infra (DBA) + Dev |
| Timing | With EXT-07 |
| Done when | `role_split_verify.sql` passes all checks (45 in the local proof); `check_least_privilege.sql` shows no sequence UPDATE and no role-level settings for the runtime role; normal sign-in, receive and move work |
| Status 2026-10-16 | CODE DONE — OPEN EXTERNAL (scripts proven on a disposable DB; retest 2 tried about 70 break-out attempts as the runtime role, all refused) |

## EXT-46 Re-run `check_least_privilege.sql` after every deploy — every deploy

| | |
|---|---|
| What | After each production deploy (and after any manual grant or migration), run `ops/db/check_least_privilege.sql` (34 read-only checks) and attach the output to the change record. Until EXT-07 is done, the output is expected to show the known findings (runtime role = owner) and is kept as a baseline |
| Why (plain words) | Grants drift: a migration or a helpful manual fix can quietly give the app's account more power than it needs |
| Risk if ignored | Least privilege erodes unnoticed (R-35, R-37) |
| Owner | IT / DBA + Dev |
| Timing | Every deploy, starting with the first deploy after EXT-07 (baseline run at EXT-01) |
| Done when | Each change record carries the check output with 0 unexpected rows |
| Status 2026-10-16 | OPEN (script ready and covered by `backend/tests/security/test_least_privilege_role_split.py`) |

## EXT-47 Replace `python-jose` with PyJWT — 90 days

| | |
|---|---|
| What | Development task in a normal release: replace `python-jose` (and with it `ecdsa`) by PyJWT, keep HS256 pinned and the `type` claim check, update `backend/constraints.txt`, run the full test suite and the JWT tamper tests |
| Why (plain words) | `python-jose` (HS256 forgery advisory) and `ecdsa` (timing advisory) have **no fixed versions**. They are not reachable in CKAM today (HS256 pinned, no asymmetric keys), so they are ACCEPTED (IF-12), but an unmaintained token library is a standing risk |
| Risk if ignored | A future advisory in an unmaintained library with no fix (R-15) |
| Owner | Dev |
| Timing | 90 days |
| Done when | `pip-audit` on the constraints list shows no python-jose / ecdsa entries; JWT tests green; released |
| Status 2026-10-16 | OPEN (not started) |

## EXT-48 Alert on audit-write failures and refresh-token reuse — 30 days after deploy

| | |
|---|---|
| What | Part of EXT-22: alert when the error log contains kind `log_write_failed` (written at the first failure to store an audit/log row and then at most once a minute with a running count) or the matching `system_event`; alert on bursts of `REFRESH_REUSE` / `REFRESH_DUPLICATE` security rows. Small follow-up: show the audit-failure count on the Logs > Diagnostics screen (the function exists) |
| Why (plain words) | If the audit trail silently stops recording, every later investigation has a hole; a reused sign-in cookie is a strong sign of theft |
| Risk if ignored | Missing audit rows or stolen sessions noticed late or never (R-40, R-34) |
| Owner | IT + Dev |
| Timing | 30 days after deploy |
| Done when | A test failure produces an alert message; a forced reuse in a test environment produces an alert; note kept |
| Status 2026-10-16 | OPEN (the code produces the line and rows after deploy; no alerting exists) |

## EXT-49 Per-office NAT policy for the sign-in limit — 30 days after deploy

| | |
|---|---|
| What | Owner decision SD-08: list the offices and stores whose users share one public or NAT address, decide whether the default 20 sign-ins per minute per address (`RATE_LIMIT_LOGIN_PER_IP`) stays, and record the value and the review date. The per-login-id limit (10/min) stays regardless. Use the EXT-40 observations |
| Why (plain words) | At shift start many staff behind one address could be refused for up to a minute; raising the value too far weakens protection for everyone |
| Risk if ignored | Users refused at busy times, or an ad-hoc change that weakens the limit (R-33) |
| Owner | Management + IT |
| Timing | 30 days after deploy |
| Done when | Written per-office rule with the chosen value; the setting on the server matches it |
| Status 2026-10-16 | OPEN DECISION (SD-08; recommendation: keep 20/min and watch) |

## EXT-50 Decide an absolute session lifetime — 90 days

| | |
|---|---|
| What | Owner decision SD-14: today a session can be renewed for as long as it keeps being used (8-hour refresh window, rotated on each renewal); there is no absolute maximum. Options include an absolute daily limit, shorter for admins. If decided, it is a small code change in a normal release |
| Why (plain words) | A session on a shared store PC could stay signed in for days if the browser stays open |
| Risk if ignored | Long-lived sessions on shared devices (R-38) |
| Owner | Management (decision) + Dev (build) |
| Timing | 90 days |
| Done when | Decision recorded; if "limit", built, tested and deployed |
| Status 2026-10-16 | OPEN DECISION (SD-14; recommendation B) |

---

## Prerequisite, rollback and audit evidence per item

Every item above is **OPEN EXTERNAL** (nothing complete). This table adds, for each EXT, the three fields not
already broken out in its section: **prerequisite** (what must be true first), **rollback** (how to undo it, or
"n/a" where there is nothing to undo), and **audit evidence** (what proof to keep — this is also what each section's
"Done when" check produces). The **classification** equals the item's Timing.

| ID | Class | Prerequisite | Rollback | Audit evidence to keep |
|---|---|---|---|---|
| EXT-01 | URGENT | EXT-39 checks pass; EXT-42 record started; owner deploy request; backup (EXT-08 interim: the nightly dump) | Set `FRONTEND_DIST_DIR`/editable install back to the previous release; DB restore only if the schema was changed and truly needed | Phase 7 probe results (all 404), `alembic current`=head, `app_started` event, change record |
| EXT-02 | URGENT | EXT-01 verified (rotating earlier is wasted); EXT-43 decision for NAS/ERP | Restore the prior secret from the sealed `.env` copy, then re-rotate (service first) | Dated rotation note (which secret, when, who — never values); old tokens 401; ERP sync OK; NAS mapping OK |
| EXT-03 | URGENT | EXT-41 logs preserved | n/a (investigation) | Written incident record: period, sources, findings, decision; log exports with hashes |
| EXT-04 | 30 days | Owner HTTPS decisions (`CKAM_HTTPS_IMPLEMENTATION_PLAN.md` §16); 443 free in `PORTS.md`; certificate | Revert `COOKIE_SECURE=false`, `BASE_URL` to http, re-bind/forward 3211, stop proxy, restart | TLS scan (valid cert, TLS 1.2+); redirect check; `Secure` cookie; real client IPs in audit |
| EXT-05 | URGENT (decision) / 30 days | Owner decision on who needs CKAM from outside | Re-add the router forward from its saved export | Router config export (before/after); outside-network reachability test result |
| EXT-06 | 30 days | After EXT-01/EXT-02; NAS credential handling settled (EXT-43); venv/log/secret rights planned (`CKAM_SERVICE_ACCOUNT_PLAN.md`) | Re-point `CKAM-Web` to SYSTEM from the saved principal; re-grant any over-removed read | Task principal = `svc_ckam`/gMSA; `icacls` of `shared\`; reboot test; uploads/NAS OK |
| EXT-07 | 30 days | After EXT-02; maintenance window; backup; owner types superuser + role passwords; use the current `ops/db/` scripts and runbook (EXT-45), not the earlier SQL sketch in the remediation report | `ALTER ROLE ckassetapp LOGIN`; revert `DATABASE_URL`; the design is additive and reversible before `ckassetapp NOLOGIN` | `pg_roles`/owner query shows runtime role not owner, no TRUNCATE; `db_03`-style refusals; normal flows OK |
| EXT-08 | 30 days | Off-server target + decryption key in password manager (EXT-23); non-production restore host | n/a (adds copies; a bad config is corrected, not rolled back) | Off-server copy log; immutable/offline copy exists; NAS backup log; quarterly restore-drill report (`CKAM_BACKUP_RESTORE_PLAN.md` §7) |
| EXT-09 | 30 days then monthly | Patch window agreed; vendor advisories subscribed | Standard OS/patch rollback (restore point / uninstall update) | Monthly patch report per server (installed, pending, reboot date) |
| EXT-10 | URGENT | Dev-PC local admin; do not lock out the Docker service | Re-grant removed ACLs if a needed account was cut; BitLocker stays on | `icacls .env`/`backups` show only developer + Administrators; BitLocker on; dump count reduced |
| EXT-11 | 90 days | Code side done (`79dbae7`, `b401e9f`); remaining prerequisite: the EXT-01 deploy | Revert the frontend commit; CSP re-allows Google hosts | Playwright run shows no Google request; CSP test without Google hosts; 0 CSP violations |
| EXT-12 | 30 days | `backend/constraints.txt` present (done, `ae706bb`); `pip-audit` clean on the pinned set | Deploy without `-c` if a pin has no Windows wheel (note it, keep EXT-12 open) | `pip freeze` per release equals the tested set; `pip-audit` result |
| EXT-13 | 30 days | Reference scripts in `ops/windows/` (WP-C); IT confirms the live launcher | n/a (documents/scripts) | Scripts in git with no secrets and `--no-proxy-headers`; IT confirms server copy equals repo copy |
| EXT-14 | 90 days | After EXT-01..08; written scope; owner's written approval for any production test | n/a | Signed independent report; findings tracked to closure |
| EXT-15 | 12 months | ISMS operated (EXT-36): policies, risk treatment, one internal audit + one management review | n/a | Signed engagement with an accredited body; Stage 1 date |
| EXT-16 | 12 months | Customer/partner demand; scope agreed | n/a | Engagement letter with scope and observation-period dates |
| EXT-17 | 90 days | ISMS lead appointed (EXT-36) | n/a | Signed, dated policies; staff acknowledgements |
| EXT-18 | 30 days then quarterly | Head-office admin access; user export (`GET /api/asset-users/export`) | n/a (review; fixes are normal access changes, themselves audited) | Signed review sheet per quarter; matching `ACCESS_CHANGED`/deactivation audit rows |
| EXT-19 | 90 days (decision) | Owner decision; until then admin use on LAN/VPN (EXT-05) | If MFA is built and causes lockouts, a recovery/break-glass path must exist before enforcing | Written decision; if yes, MFA enforced for the chosen roles and tested |
| EXT-20 | 30 days | — | n/a | Approved IR plan; IF-01 incident record (EXT-03); first table-top exercise record |
| EXT-21 | 90 days | Off-server log store; retention decided (with EXT-31) | n/a | Retention in policy; off-server monthly log files with hashes |
| EXT-22 | 30 days | Alert channel (email/chat); health endpoint reachable | n/a | Alert test messages received; weekly review notes |
| EXT-23 | 30 days | Company password manager; two named custodians | n/a | Vault entries exist (names only, never values); two people can retrieve; break-glass sealed |
| EXT-24 | 12 months | Per-app service accounts (EXT-06); review of shared-server admins | Standard infra rollback per change | Written separation design; per-app accounts; (optional) dedicated VM |
| EXT-25 | 90 days | ERP warehouse owner on 10.0.1.69; CKAM code TLS settings (IF-16, WP-A1) | Revert `PO_SOURCE_SSLMODE` to today's default (fails safe to "ERP unavailable") | `\du`/grants show SELECT only; role read-only; `pg_stat_ssl` shows TLS for CKAM |
| EXT-26 | 30 days | Owner decision recorded in `docs/ai/DECISIONS.md` | If "limit" built, revert the code change and redeploy | Decision in `DECISIONS.md`; if limited: cross-company tests pass, deployed |
| EXT-27 | 90 days | DBA; superuser step typed by the owner on 10.0.0.205 | `ALTER SYSTEM RESET ...; SELECT pg_reload_conf();` (no restart) | `GET /api/admin/diagnostics/db` shows `slow_statement_logging_on` true |
| EXT-28 | 90 days | CityKart-owned GitHub org; members have MFA | Branch protection can be relaxed; move is one-way in practice | Repo settings (owner, visibility, MFA, branch rules); CI run history |
| EXT-29 | 90 days | RTO/RPO agreed; a window for the reboot test (shared server) | n/a (planning + a test) | Approved BCP/DR plan; reboot-test record; server-room checklist |
| EXT-30 | 90 days | Owner/HR decision on store-login model | n/a | Written rule; store managers' acknowledgements |
| EXT-31 | 90 days | Legal counsel engaged | n/a | Written legal register and retention decision |
| EXT-32 | 90 days then yearly | Training material; HR records | n/a | Attendance list; HR screening/NDA confirmation |
| EXT-33 | 30 days | HR-to-IT notification flow | n/a | Process note; sample of leavers matched to CKAM deactivation rows |
| EXT-34 | 90 days then yearly | Supplier list | n/a | Supplier register with rating and review date |
| EXT-35 | 30 days | Change-record template (`CKAM_SOC2_READINESS.md` §8) | n/a | A change record per release, including the IF-01 deploy (EXT-42) |
| EXT-36 | 90 days / 12 months | Management commitment | n/a | Appointment letter; approved risk register; internal-audit report; review minutes |
| EXT-37 | 30 days | EDR/AV licences; PostgreSQL data-folder exclusion guidance | Standard AV policy rollback | Console screenshot showing both servers protected and current |
| EXT-38 | URGENT (with EXT-01) | Launcher editable on 10.0.1.98; reference launcher in `ops/windows/` | Restore the saved launcher copy; restart | Launcher command shows `--no-proxy-headers`; forged `X-Forwarded-For` logged as `127.0.0.1` |
| EXT-39 | URGENT (with EXT-01) | Access to `shared\.env` (read only, non-secret keys); rehearsal DB | n/a (checks only) | Change record shows the five checks ticked; `alembic current`=head; normal `production` start |
| EXT-40 | 30 days after deploy | Deploy done; `RATE_LIMITED` rows observable | Raise/lower `RATE_LIMIT_LOGIN_PER_IP` and restart | A note with observed 429 counts and the keep/change decision |
| EXT-41 | URGENT | Access to `<ROOT>\logs\`; an off-server evidence target | n/a | Hashed off-server copy of pre-deploy logs; SHA-256 list |
| EXT-42 | URGENT | Change-record template; owner approval (may be by message for the emergency) | n/a | Signed change record for the IF-01 deploy with Phase 7 evidence |
| EXT-43 | URGENT (decision) / 30 days | NAS admin / ERP owner confirm whether `ckappuser`/`ckpost` are shared | If a CKAM-only account causes an upload failure, fix the mapping; the shared account is untouched | Written shared/not-shared confirmation; if new account: `icacls`/NAS rights, upload/download test |
| EXT-44 | URGENT (with EXT-01) | Same as EXT-01 | Same as EXT-01 (previous release folder) | `/assets/<id>` and `/assets/new` 200 on production; one real label scan; recorded in EXT-42 |
| EXT-45 | 30 days (with EXT-07) | EXT-07 prerequisites; scripts taken from the deployed release, not an older copy | `ops/db/ROLE_SPLIT_RUNBOOK.md` rollback (additive design; `ckassetapp` can be restored before NOLOGIN) | `role_split_verify.sql` and `check_least_privilege.sql` output; smoke results |
| EXT-46 | Every deploy | Script in the deployed release; DBA access (read-only queries) | n/a (read-only check) | Check output attached to each change record |
| EXT-47 | 90 days | Normal development cycle; full test suite | Revert the commit | `pip-audit` without python-jose / ecdsa; JWT tests green; release record |
| EXT-48 | 30 days after deploy | EXT-22 alert channel; deploy done | Disable the alert rule | Alert test messages; note of the test |
| EXT-49 | 30 days after deploy | EXT-40 observations; owner decision SD-08 | Set `RATE_LIMIT_LOGIN_PER_IP` back and restart | Written per-office rule; setting matches |
| EXT-50 | 90 days | Owner decision SD-14 | If built: revert the code change | Decision record; if built: tests and release record |
