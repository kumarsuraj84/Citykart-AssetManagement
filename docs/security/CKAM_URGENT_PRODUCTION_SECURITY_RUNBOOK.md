# CKAM Urgent Production Security Runbook — release `ccae7b2` (IF-01 fix, QR deep-link fix, secret rotation, compromise check)

| | |
|---|---|
| Status | **PREPARED — OWNER APPROVAL PENDING.** Nothing in this document has been run on any server. Every command is marked `NOT EXECUTED`. **PRODUCTION REMAINS NOT REMEDIATED** until steps A–H have passed on 10.0.1.98. Even then, anyone who copied a secret through IF-01 can still use it until step I has been done |
| Revision | **Final values filled in 2026-10-17 (security release)**: the package was rebuilt from commit `ccae7b2` (fixed Windows reference scripts, `colorama` pinned in `backend/constraints.txt`, corrected `RELEASE.json`); all release identifiers in this runbook are the real ones. Earlier candidate `eed3de1` is SUPERSEDED — never deploy it |
| Production today | 10.0.1.98 runs release `3b5e842`; its database `ckassetmanagement` is at Alembic revision `e6f8a0b2c4d6`. `3b5e842` has **IF-01**: anyone who can reach port 3211 can read any file on the server, including `shared\.env` and `shared\nas.pw`. It also has the QR / Asset 360 deep-link bug **CL2-IF-04**: a scanned `/assets/<id>` link gives an error. This includes labels printed from Print Labels in the **default "Barcode + QR"** format, whose QR is the same `BASE_URL` deep link (GT-F02) |
| Release to deploy | `ccae7b2` (full 40-character sha: `ccae7b2281bc4ca71f4b6113f61dc86de392bc3e`), branch `worktree-ckam-build`. Expected contents: the code of `fd34520` (all security fixes) **plus** the fixed `ops/windows/` reference scripts and `backend/constraints.txt` with `colorama` pinned. `git diff --name-only fd34520..ccae7b2 -- . ':!docs'` lists exactly four files: `backend/constraints.txt` (43 → 44 pins, `colorama==0.4.6`), `ops/windows/README.md`, `ops/windows/deploy_ckam.ps1.template`, `ops/windows/verify_release.ps1` (`PACKAGE_REPORT_ccae7b2.md` §1). **Not pushed. A deploy does not need a push** |
| Package | Zip `release-packages\ckam-security-release-ccae7b2.zip` on the dev PC: **2,152,224 bytes**, **238 entries**, **SHA-256 `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`**, content hash `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b` (215 files). Build and inspection: **`docs/security/evidence/closure/release/PACKAGE_REPORT_ccae7b2.md`** (`PACKAGE_REPORT.md` describes the superseded `eed3de1` build) |
| Native Windows evidence for this package (updated 2026-10-17, security release) | On the dev PC (Windows 11), the `ccae7b2` package was unpacked and installed with the exact documented command `pip install -c backend\constraints.txt -e backend` (Python 3.13.1: 43 packages, all at their pins, `colorama` 0.4.6 included; succeeded). It was started with production settings and both flags (`--no-proxy-headers --no-server-header`). Results: the 32-payload Windows attack list gave **0 leaks, 0 server errors, one identical refusal**; `/assets/<id>` and `/assets/new` opened the app page; `/docs`, `/redoc`, `/openapi.json` gave JSON 404; there was no `Server` header; a browser cold load of `/assets/1` went to sign-in and then to the asset page; the packaged `verify_release.ps1` gave **41/41 PASS**, including `-LocalProcessCheck Require`. Evidence: `docs/security/evidence/closure/windows/native_windows_release_ccae7b2.txt`, `native_windows_qr_ccae7b2.txt`, `native_windows_verify_release_ccae7b2.csv`. **Limits:** portable (embeddable) Python, not a venv; test database on Docker (PostgreSQL 17), not PostgreSQL 18; no Task Scheduler, no `CKAM-Web` task, no NAS mapping, no real launcher run, not 10.0.1.98. It proves the install command, the Windows path handling and the verify script on Windows. It does **not** prove the server, the task, the venv redirector or the NAS. **Nothing has been run on production** |
| Database change | Four migrations, in this order: `f9a1c3e5b7d2` → `a3c5e7f9b1d4` → `b5d7f9a1c3e5` → `c6e8a0b2d4f6` (single head). They take the database from `e6f8a0b2c4d6` to **`c6e8a0b2d4f6`** |
| Applies to | App server **10.0.1.98** (`D:\Citykart_Applications\Citykart_AssetManagement_App`, task `CKAM-Web`, port 3211). Database server **10.0.0.205** (PostgreSQL 18, database `ckassetmanagement`). NAS **10.0.0.25** (`\\10.0.0.25\ckapplications_data\CKASSETMANAGEMENT_DATA`). ERP warehouse 10.0.1.69 (password change only, done by the ERP owner) |
| Never applies to | **10.0.1.12 (retired; must stay dead).** Also never: Spinwheel or Citykart Desk folders, tasks, databases, roles, NAS folders or config on the shared servers |
| Companion documents | `CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` (what to do when a step fails) · `CKAM_SECRET_ROTATION_CHECKLISTS.md` (step I) · `CKAM_COMPROMISE_ASSESSMENT_PLAN.md` (steps B and K) · `CKAM_EMERGENCY_CHANGE_RECORD_DRAFT.md` (steps A and L) · `CKAM_GITHUB_PUBLIC_REPO_OPTIONS.md` (step N) · `CKAM_PRODUCTION_SECURITY_GO_NO_GO.md` (the gate before step C) · `CKAM_EXTERNAL_SECURITY_ACTIONS.md` (EXT-01…50) · `CKAM_HTTPS_IMPLEMENTATION_PLAN.md`, `CKAM_SERVICE_ACCOUNT_PLAN.md`, `CKAM_BACKUP_RESTORE_PLAN.md` (step M) · `docs/ai/PRODUCTION_INFRASTRUCTURE.md`, `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| Reference scripts (shipped in the package under `ops\windows\`) | `run_ckam_web.ps1.template` (launcher with `--no-proxy-headers --no-server-header`), `deploy_ckam.ps1.template` (steps E–H as one script; **fixed in `ccae7b2`**: once `alembic upgrade head` has started, a failure never restarts the old release. Exit codes 0/1/2/3; read "Using `deploy_ckam.ps1`"), `verify_release.ps1` (read-only checks; **new in `ccae7b2`**: `-LocalProcessCheck Require` checks both uvicorn flags on the server; JSON-401 checks), `rollback_release.ps1.template` (switches the release folder only; never the database). **None of them has been run on a server (EXT-13).** They were checked by the PowerShell parser, by a fake-world dry run of 28 cases (`docs/security/evidence/closure/release/windows_scripts_fix/README.md`) and, for `verify_release.ps1`, natively on Windows (row above) |

---

## THE ORDER — do not change it

| Step | What | Gate before the next step |
|---|---|---|
| **A** | Start the change record and the incident record | Owner's written deploy approval for `ccae7b2`, the window and the later rotation are recorded |
| **B** | **Preserve the production logs off-server**, before anything is changed | Hash list of the copied logs exists off the server |
| **C** | **Precheck** (read-only): `ENVIRONMENT_NAME`, JWT strength (value never printed), `DATABASE_URL` present, disk, exact live release `3b5e842`, backup capability, **zip SHA-256 on the server = `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`**, launcher review, migration head `e6f8a0b2c4d6`, shared-account answers | Every precheck answered; any STOP item → stop |
| **D** | **Back up** the production database and prove the dump is readable; NAS and settings copies | Dump readable (`pg_restore` exit 0) |
| **E** | **Copy** the new release into `releases\ccae7b2\` and **verify the checksum after the copy** | Zip hash and content check match |
| **F** | Stop CKAM only, install, switch the settings, **run the four migrations BEFORE any new code starts** | `alembic current` = `c6e8a0b2d4f6 (head)` |
| **G** | **Start** the new release with `--no-proxy-headers --no-server-header` | One CKAM listener; launcher log names `ccae7b2`; no "Refusing to start" |
| **H** | **Verify**: health, startup event, Alembic head, static security, IF-01 Windows probes, API docs unavailable, unknown API = JSON 404, security headers once, QR direct link `/assets/<id>`, sign-in, Asset list, PO, Receive, Move | **Every H check passes. Otherwise no rotation; follow the rollback strategy** |
| **I** | **Only now rotate** the secrets: JWT secret → DB password (`ckassetapp`) → NAS password → ERP password | Each rotation validated |
| **J** | Restart and verify every connection; delete the old secret copies | H re-run passes |
| **K** | Compromise assessment (read-only) | Decision written: no evidence / suspicious / compromised |
| **L** | Complete the change record and the incident record | Records signed |
| **M** | Plan HTTPS and network hardening (separate changes) | Dates agreed |
| **N** | **AFTER VERIFICATION:** consider the git push (options A/B/C in `CKAM_GITHUB_PUBLIC_REPO_OPTIONS.md`) | Owner's push phrase for this change |

```
A record → B logs off-server → C precheck → D backup → E copy + checksum → F migrate (old code stopped)
  → G start new code (both flags) → H verify ──fail──> CKAM_PRODUCTION_ROLLBACK_STRATEGY.md (roll forward first)
                                     └─pass──> I rotate → J re-verify → K compromise check → L records → M hardening plan
                                                                                       └──> N (AFTER VERIFICATION) push decision
```

## In plain words

The live CKAM server has a hole (IF-01). A stranger can ask it for any file and get it. That includes the file that
holds the database password and the key that signs logins. The fix is packaged on the development PC as release
`ccae7b2`. It is not on the server yet. On the day of the fix:

1. Open the paperwork (A) and **copy the server's logs to a safe place first** (B). They are the only evidence of
   whether someone already used the hole, and a restart can make them rotate away.
2. Check that everything is ready (C), take a backup (D), copy the new release and prove it is the exact approved
   file (E).
3. Update the database while the old program is stopped (F), then start the new program (G).
4. Prove the hole is closed and that normal work (sign-in, assets, POs, receive, move, QR scan) still works (H).
5. **Only then** change every password and key the hole could have exposed (I, J). Changing them earlier is wasted
   effort, because the open hole would leak the new ones too.
6. Look for signs that someone used the hole before it was closed (K). Finish the records (L) and plan HTTPS (M).
7. Only after all of that, decide how to push the code to the public GitHub repository (N).

Example: a burglar may have a copy of your house key because the back door was open. First you close the back
door, then you change the locks. Changing the locks while the back door is still open does not help.

## Rules for everyone using this runbook

- **Secrets are never written down here** and never pasted into chat, e-mail, tickets, screenshots or AI tools.
  Where a secret is needed this document says `<TYPED-ON-SERVER>`. The owner types every database-superuser, NAS and
  ERP password on the server himself (`CLAUDE.md`).
- Every command is **text to read and adapt**. No assistant has run it. Every block is marked `NOT EXECUTED`. Run
  PowerShell as Administrator on the named server. The pattern that works on these servers: put multi-line
  PowerShell in a `.ps1` file and run it with `powershell -NoProfile -ExecutionPolicy Bypass -File <file>.ps1`. In
  Windows PowerShell 5.1, use `$ErrorActionPreference = 'Continue'` around `pip`/`alembic` (their INFO lines go to
  stderr) and check `$LASTEXITCODE` after every native command.
- **Never print `shared\.env`.** You may print only the **allow-listed non-secret keys**: `ENVIRONMENT_NAME`,
  `APP_VERSION`, `FRONTEND_DIST_DIR`, `LOG_DIR`, `UPLOAD_DIR`, `BASE_URL`, `COOKIE_SECURE`, `TRUSTED_PROXIES`,
  `PO_SOURCE_HOST`, `PO_SOURCE_PORT`, `PO_SOURCE_DB`, `PO_SOURCE_USER`. Never print `DATABASE_URL`, `JWT_SECRET`,
  `PO_SOURCE_PASSWORD` or `nas.pw`.
- Touch only CKAM's own objects: its folder, task `CKAM-Web`, firewall rule `CKAM-Web`, database
  `ckassetmanagement`, CKAM's roles, backup task `CK_Backup_CKASSETMANAGEMENT` and NAS folder
  `CKASSETMANAGEMENT_DATA`.
- Keep evidence in an **admin-only evidence folder** (`<EVIDENCE-DIR>`). It must never be inside a `releases\`
  folder. Copy it off the server (`<OFFSERVER-EVIDENCE>`) at B and again at L (EXT-41). The logs contain staff
  names and IP addresses (personal data), so store the off-server copy encrypted or access-restricted.

### Placeholders and fixed values

| Name | Value / meaning |
|---|---|
| `<ROOT>` | `D:\Citykart_Applications\Citykart_AssetManagement_App` on 10.0.1.98 |
| Release | `ccae7b2` (folder `<ROOT>\releases\ccae7b2`) |
| Previous release | `3b5e842` (folder `<ROOT>\releases\3b5e842`; confirm in C1) |
| Database revision before / after | `e6f8a0b2c4d6` / `c6e8a0b2d4f6` |
| Zip SHA-256 / size / entries | `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` / 2,152,224 bytes / 238 |
| Content hash / files | `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b` / 215 |
| Served bundle names of `ccae7b2` | `/assets/index-Cp5JgQR-.js`, `/assets/index-Bj21ou3B.css` (`PACKAGE_REPORT_ccae7b2.md`; the JS name changes with every build because the bundle contains the release id). In `Select-String` patterns the dot is escaped: `index-Cp5JgQR-\.js` |
| Superseded candidate (do **not** approve or deploy) | `eed3de1`, zip SHA-256 `be3209af…d246`, 2,141,099 bytes. Kept only as the subject of the gate rehearsal evidence |
| `<STAGING-DIR>` | Admin-only folder on 10.0.1.98 for the incoming zip, **not** inside `releases\` (e.g. a new folder under `<ROOT>\backup\`) |
| `<EVIDENCE-DIR>` | Admin-only evidence folder for this change on 10.0.1.98 (e.g. `<ROOT>\backup\CHG-<id>-evidence`) |
| `<OFFSERVER-EVIDENCE>` | The owner's chosen off-server location (an encrypted drive or an admin-only share that is **not** the CKAM NAS folder) |
| `<PG-BIN>` | PostgreSQL 18 client folder on 10.0.0.205 (usually `C:\Program Files\PostgreSQL\18\bin`; confirm) |
| `<BACKUP-DIR>` | `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP` on 10.0.0.205 |
| `<ASSET-ID>` | The id of a real asset for the QR test (the owner picks it) |
| `<TYPED-ON-SERVER>` | A secret the owner types at a prompt on the server. Never in a file in git, never in chat |

### Who does what

| Role | Who (fill in) | Steps |
|---|---|---|
| APPROVER | CKAM owner / management | A (approvals), H gate decision, I go-ahead, L sign-off, N push decision |
| IT | Operator with Administrator access to 10.0.1.98 | B, C (app server), E, F, G, H, J; edits `shared\.env` |
| DBA | The owner on 10.0.0.205 (types the `postgres` password) | C (DB items), D, I (DB password) |
| NAS-ADMIN | Whoever runs 10.0.0.25 (the owner types the NAS password) | B (NAS log), D (NAS copy), I (NAS) |
| ERP-OWNER | Owner of the ERP warehouse on 10.0.1.69 | I (ERP), K (ERP-side log if available) |
| SEC | Security reviewer (may be the owner) | B, K, L (incident record) |
| DEV | Developer on the dev PC 10.0.0.47 | C13 (release contents), E (hand over the zip and its hash), N (push, only after the owner's phrase) |

### Observations from the package build that change how you deploy

1. **`colorama` is pinned (updated 2026-10-17, security release).** On Windows, `qrcode 8.2` pulls in `colorama`.
   The superseded `eed3de1` package had no pin for it. `ccae7b2`'s `backend\constraints.txt` has **44 pins,
   including `colorama==0.4.6`** (`PACKAGE_REPORT_ccae7b2.md`). On Windows the install gives **43 packages**: all 44
   pins except `uvloop`, which is never installed on Windows (native Windows run: 43 packages at their pins). In F2,
   check that `pip freeze` shows `colorama==0.4.6` and record it in the change record. A different `colorama` means
   the package is not `ccae7b2`: stop and ask DEV.
2. **The install needs the Python package index** (or a local wheel folder). `pyproject.toml` has no
   `[build-system]` table, so `pip install -e` fetches the newest `setuptools` into an isolated build environment.
   Any pinned package not already in the venv is downloaded too. Precheck C11 confirms that 10.0.1.98 can reach the
   index. If it cannot, stop and ask the owner. A wheel folder prepared on the dev PC would be a new, untested
   procedure.
3. **The app falls back to a development `DATABASE_URL` if the variable is missing.** Both `app/core/config.py` and
   `app/alembic/env.py` fall back to `…ckam:ckam_dev_pw@localhost:5432/ckam`. The app does **not** refuse this in
   production. Precheck C4 must therefore **stop** if `DATABASE_URL` is missing or empty. Step H2 confirms that the
   started app reports `database_host = 10.0.0.205`.
4. **Keep `releases\ccae7b2\backend` on the server** for as long as this release runs. The editable install
   (`pip install -e`) points the venv at that folder. **Keep `releases\3b5e842`** too, and every older folder,
   until the rollback window has passed. Never delete a release folder during this change.
5. `backend\VERSION` holds the full sha. `APP_VERSION=ccae7b2` in `shared\.env` takes precedence, so
   diagnostics show `ccae7b2`.
6. **API docs are off in production (GT-F06).** `/docs`, `/redoc` and `/openapi.json` answer a small **JSON 404**
   (`{"detail":"Not Found","request_id":…}`), not Swagger/ReDoc, not OpenAPI and not the app page (`app/main.py`,
   `_serve_frontend_shell`; confirmed by the gate rehearsal, step 4a). The old post-deploy check "`/openapi.json`
   lists the new routes" can no longer be used. Step H gives the replacement checks: `/api/health`, the
   `app_started` startup event, diagnostics health (signed in as a head-office admin) showing the version,
   environment `production` and migrations ok, the bundle name in `index.html`, the launcher log, and the QR direct
   link `/assets/<id>`.
7. **All four migrations run in ONE transaction (GT-F04)** (`app/alembic/env.py` opens a single
   `begin_transaction()`; `transaction_per_migration` is not set). If any of them fails, PostgreSQL rolls back
   **all four**, and the database stays at **`e6f8a0b2c4d6`**: nothing of migrations 1–3 is kept. This was
   fault-injected and confirmed in the gate rehearsal (step 6). (The earlier text said that a failure leaves the
   database "at the previous revision". That was wrong.) Consequence: after a failed `alembic upgrade head`, **do
   not start the new code** (it cannot sign anyone in on `e6f8a0b2c4d6`, see 9).
8. **After `c6e8a0b2d4f6` the OLD code (`3b5e842`) can still RECEIVE, but it cannot MOVE, repair, lose/find,
   dispose, SELL or SCRAP (GT-F01, measured in the gate rehearsal step 6).** The new trigger fires only on an
   **update** of `asset.status`, `current_asset_user_id` or `status_since` that does not carry the marker, and only
   the new code sets that marker. A receive **inserts** new asset rows already in their final state, so the trigger
   never fires and receives keep working. Every status or holder change (single or bulk) is refused. **What the user
   sees is misleading:** HTTP 422 "Some of the values could not be saved. Check them and try again." The real
   reason is only in the server log (`error.jsonl`, `DBAPIError`: "asset status, holder and status date can only
   change through a recorded asset movement (asset_event)"). Nothing is half-written. **So a code-only rollback is
   unsafe** (and it reopens IF-01). **Roll forward first** (`CKAM_PRODUCTION_ROLLBACK_STRATEGY.md`).
9. **The new code on an UN-migrated database looks healthy (GT-F05).** In the gate rehearsal, the security release's
   application code (rehearsed as `eed3de1`) started on `e6f8a0b2c4d6` answered `/api/health` 200 and served the app page, and a bare
   `verify_release.ps1` run (old version) passed, but **every sign-in failed** with the same misleading 422
   ("Some of the values could not be saved…"; server log: `column asset_user.token_version does not exist`). Three
   things catch it: the `alembic current` = `alembic heads` check (F4, and `deploy_ckam.ps1` step 8b), the startup
   log (`system_event` `migration / head_mismatch` WARNING, H2) and a real sign-in (H13). `ccae7b2`'s
   `verify_release.ps1` also sends a made-up sign-in and expects a JSON 401, which would *probably* fail on an
   un-migrated database. That was **not tested** on an un-migrated database, so do not rely on it. **Never accept
   health + verify script alone as proof** that the deploy worked.

### Using `deploy_ckam.ps1` (optional) — read this first

`ops\windows\deploy_ckam.ps1.template` does E (expand), its own pre-checks, the backup confirmation, the `.env` copy,
F (stop, `pip install -c`, switch, migrate), G (start) and part of H (`verify_release.ps1`), **in the order of this
runbook**. It does **not** replace B, C, D, the launcher update in G, the functional checks in H, or anything
after H.

> **Failure handling of the FIXED template (updated 2026-10-17, security release; `ccae7b2`).** The template is
> **fixed**. It has been checked only by the PowerShell parser and a fake-world **dry run** (28 cases, all as expected,
> `docs/security/evidence/closure/release/windows_scripts_fix/README.md`). **It has never run on a server.** The
> operator must still **read it before use** (its header "FAILURE HANDLING" and the functions `Invoke-EarlyRestore`
> and `Invoke-StayDown`) and write in the change record that they did. What it does:
> - **Steps 1–3 (release folder, pre-checks, backup) fail → exit 2.** It stops before anything is touched. The
>   pre-checks are: `RELEASE.json` release id = `-Sha` and its `alembic_head` taken as the target; `ENVIRONMENT_NAME`;
>   `JWT_SECRET` rules; **`DATABASE_URL` present exactly once, not empty, not quoted, not the development default or
>   this machine**; `FRONTEND_DIST_DIR`; a backup (`-BackupConfirmed` or `-BackupHook`).
> - **Branch A, a failure BEFORE `alembic upgrade head` starts (steps 4–8a: save settings, stop, pip, switch, read
>   the heads) → exit 1.** The schema is untouched, so the script itself restores `shared\.env.pre-ccae7b2` and
>   **restarts the previous release `3b5e842`**: production is back as it was this morning, **IF-01 still open**.
>   Re-plan at once (rollback strategy case 1-A). Exception: if the database is already at the new head, it stays
>   down as in branch B.
> - **Branch B, a failure FROM the moment `alembic upgrade head` starts (upgrade, head check, start, health,
>   `verify_release.ps1`) → exit 3.** The script **never** restarts the old release, **never** downgrades and
>   **never** restores. `CKAM-Web` stays **STOPPED**. It prints a banner with the database revision and writes a
>   `STATE: branch=B; ckam_web=stopped; …; switched_back=no; downgraded=no; restored=no; exit=3` line to the deploy
>   log. The owner decides (rollback strategy cases 2–4). On the new schema `3b5e842` could still receive but not
>   move/sell/scrap (GT-F01), and it would reopen IF-01, which is why the script no longer starts it.
> - **Exit 0** = deployed, `alembic current` = head, started, health ok, and `verify_release.ps1 -LocalProcessCheck
>   Require` passed (`STATE: branch=none; ckam_web=running`).
>
> The operator watches the script the whole time. If `3b5e842` is running after F4 for any reason, **stop
> `CKAM-Web` at once** (F1 commands) and follow `CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` case 3/4.

To use the script: copy `releases\ccae7b2\ops\windows\deploy_ckam.ps1.template` and `verify_release.ps1` into
one admin-only folder. Drop the `.template` suffix (the script calls `verify_release.ps1` from its own folder). Read
it first (see above). Run it first with `-WhatIf` (it prints the planned steps, each with its failure branch), then
for real. Example (`NOT EXECUTED`):
`.\deploy_ckam.ps1 -Sha ccae7b2 -PackagePath <STAGING-DIR>\ckam-security-release-ccae7b2.zip -BackupConfirmed -WhatIf`
Record the exit code and the `STATE:` line in the change record.

---

## Step A — Start the change record and the incident record

**Purpose:** every later step writes its result somewhere that is signed. Production is not touched in this step.

**Who:** APPROVER + DEV (+ SEC for the incident record).

1. Copy `docs/security/CKAM_EMERGENCY_CHANGE_RECORD_DRAFT.md` and give it a change id (`CHG-2026-NNN`). Keep the
   filled copy **outside** the repository (it will hold times, names and evidence references).
2. Open an incident record from `docs/security/policies/templates/incident_record.md` (`INC-2026-NNN`, title
   "IF-01 file-read exposure on production since 2026-09-30"). Step K completes it.
3. Get the owner's **written** answers. Today none of them exists:
   - deploy approval for release **`ccae7b2`** (package SHA-256 `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`, `2152224` bytes) in a named
     window. An approval that names `eed3de1` / `be3209af…` is **not valid** for the rebuilt package;
   - approval to rotate the four secrets **after** step H passes;
   - the answers to the shared-account questions (C10);
   - the user notice ("CKAM will be unavailable for about `TO BE FILLED BY LEAD` minutes; the gate rehearsal
     measured only the database part (0.86 s for all four migrations); the stop, the Windows `pip install`, the start
     and the H checks were not timed on Windows; the scripted 2026-10-14 deploy took about 30 s of downtime, the H
     checks add more; the owner's maximum downtime is an open question in the go/no-go list;
     after the security change everyone must sign in again");
   - optionally, an interim decision about port 3211. **This runbook does not authorise closing or restricting
     port 3211.** That is the owner's separate decision (SD-04 / EXT-05).
4. Classify the change: **Emergency, security-relevant, risk High** (CRITICAL IF-01 still live in production).

**Evidence:** change id, incident id, the approval messages (words used, channel, time).

**Stop if:** there is no written deploy approval for `ccae7b2`. The push phrase "commit and push to git and main"
is **not** a deploy approval (`CLAUDE.md`).

---

## Step B — PRESERVE PRODUCTION LOGS OFF-SERVER (before changing anything)

**Purpose:** the app logs rotate by size (20 MB × 10 per file) and the deploy restarts the process. The PostgreSQL
log may keep only 7 days if it was set up as in `LOGGING_AND_DIAGNOSTICS.md` §7. The router and NAS logs rotate too.
These logs are the only evidence for step K. Full list and reasons: `CKAM_COMPROMISE_ASSESSMENT_PLAN.md` §2.

**Who:** IT on 10.0.1.98; DBA on 10.0.0.205; NAS-ADMIN; Infra (router). SEC receives the copies.

1. **Create the admin-only evidence folder** (`NOT EXECUTED`):

   ```powershell
   # NOT EXECUTED
   $root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
   $ev = '<EVIDENCE-DIR>'
   New-Item -ItemType Directory -Force $ev | Out-Null
   icacls $ev /inheritance:r /grant:r "Administrators:(OI)(CI)F"
   ```

2. **Copy CKAM's logs** (app JSON logs in `logs\app\`, launcher and uvicorn stdout/stderr logs in `logs\`, earlier
   deploy logs) with a hash list (`NOT EXECUTED`):

   ```powershell
   # NOT EXECUTED
   New-Item -ItemType Directory -Force "$ev\logs-before-deploy" | Out-Null
   robocopy "$root\logs" "$ev\logs-before-deploy" /E /COPY:DAT /R:1 /W:1 /NP /LOG:"$ev\robocopy-logs.txt"
   "robocopy exit code: $LASTEXITCODE  (0-7 = success)"
   Get-ChildItem "$ev\logs-before-deploy" -Recurse -File | Get-FileHash -Algorithm SHA256 |
     Export-Csv "$ev\logs-before-deploy.sha256.csv" -NoTypeInformation
   ```

3. **Windows event logs and task history on 10.0.1.98** (`NOT EXECUTED`):

   ```powershell
   # NOT EXECUTED
   foreach ($log in 'Security','System','Application','Microsoft-Windows-TaskScheduler/Operational') {
     $name = ($log -replace '[/ ]','_')
     wevtutil epl $log "$ev\eventlog_$name.evtx"
     "wevtutil $log exit code: $LASTEXITCODE"
   }
   Export-ScheduledTask -TaskName 'CKAM-Web' | Out-File "$ev\task_CKAM-Web.xml" -Encoding utf8
   Get-ScheduledTaskInfo -TaskName 'CKAM-Web' | Format-List * | Out-File "$ev\task_CKAM-Web_info.txt"
   ```

   (The task XML holds the principal, triggers and action. A SYSTEM task stores no password. Check the file before
   it leaves the server.)
4. **Ask the DBA, NAS-ADMIN and Infra to preserve their logs now.** The commands are in
   `CKAM_COMPROMISE_ASSESSMENT_PLAN.md` §2: PostgreSQL log folder on 10.0.0.205 (`D:\POSTGRESQL DB\log` or
   wherever `log_directory` points), the NAS connection/access log export, and the router/firewall/NAT log for TCP
   3211 since 2026-09-30.
5. **Copy everything off the server** to `<OFFSERVER-EVIDENCE>` and re-check the hashes there.

**Verification:** the hash list exists in `<EVIDENCE-DIR>` and at `<OFFSERVER-EVIDENCE>`, and the counts match.
Write in the incident record which sources could **not** be preserved (for example "router keeps 24 h only").

**Rollback:** not applicable (copies only).

**Evidence:** `logs-before-deploy.sha256.csv`, `robocopy-logs.txt`, the `.evtx` files, the task XML, and the DB/NAS/router
export names with their hashes.

---

## Step C — PRECHECK (read-only; nothing is changed)

**Purpose:** the new code must start on the first try, a backup must be possible, and the file you install must be
exactly the approved package. In production the new code **refuses to start** with a weak `JWT_SECRET`, and it
silently uses a development database address if `DATABASE_URL` is missing. These checks prevent a failed deploy
that would leave the hole open longer.

**Who:** IT (app server), DBA (database), DEV (release contents).

**C1 — Live release is exactly `3b5e842`.** Print only the allow-listed keys (`NOT EXECUTED`):

```powershell
# NOT EXECUTED
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$allow = 'ENVIRONMENT_NAME','APP_VERSION','FRONTEND_DIST_DIR','LOG_DIR','UPLOAD_DIR','BASE_URL','COOKIE_SECURE','TRUSTED_PROXIES','PO_SOURCE_HOST','PO_SOURCE_PORT','PO_SOURCE_DB','PO_SOURCE_USER'
Get-Content "$root\shared\.env" | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
    if ($allow -contains $matches[1]) { '{0}={1}' -f $matches[1], $matches[2].Trim() }
    else { '{0}=<hidden, length {1}>' -f $matches[1], $matches[2].Trim().Length }
  }
}
$ll = Get-ChildItem "$root\logs" -Filter '*.launcher.log' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $ll) { $ll = Get-ChildItem "$root\logs" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
Select-String -Path $ll.FullName -Pattern 'serving release' | Select-Object -Last 1
```

Expected: `ENVIRONMENT_NAME=production`, `APP_VERSION=3b5e842`,
`FRONTEND_DIST_DIR=<ROOT>\releases\3b5e842\frontend-dist`, `LOG_DIR=<ROOT>\logs\app`, `TRUSTED_PROXIES` empty or
absent, `COOKIE_SECURE=false`, and the launcher log says `serving release: …3b5e842`. If the live release is
anything other than `3b5e842`, **STOP**: this runbook and the migration list assume `3b5e842` / `e6f8a0b2c4d6`.

**C2 — `ENVIRONMENT_NAME=production`** (shown by C1). If it is missing, the new code still treats the server as
production (fail-closed default, CL1-N4-01). Set it to exactly `production` in F3 anyway, so that logs and diagnostics
are clear. `deploy_ckam.ps1` stops if it is not `production`.

**C3 — `JWT_SECRET` strength, without printing it** (`NOT EXECUTED`). The app refuses a value that, after
stripping, is a known placeholder, is shorter than 32 characters, or has fewer than 8 different characters:

```powershell
# NOT EXECUTED
$line = Get-Content "$root\shared\.env" | Where-Object { $_ -match '^\s*JWT_SECRET\s*=' }
"JWT_SECRET lines found: $(@($line).Count)   (must be exactly 1)"
$v = (@($line)[0] -replace '^\s*JWT_SECRET\s*=\s*', '').Trim()
$q = ($v.Length -gt 0) -and (($v[0] -eq [char]34) -or ($v[0] -eq [char]39))
"value starts with a quote: $q   (should be False: the launcher passes quotes through literally)"
$set = New-Object 'System.Collections.Generic.HashSet[char]'
foreach ($c in $v.ToCharArray()) { [void]$set.Add($c) }
'length >= 32: {0}; distinct >= 8: {1}; placeholder: {2}' -f ($v.Length -ge 32), ($set.Count -ge 8), ($v -in @('dev_secret_change_me','change_me_too','change_me','changeme','secret'))
Remove-Variable v, line, set, q
```

Expected: exactly 1 line, no quotes, and `True; True; False`. If the result differs, a new `JWT_SECRET` must be set
**during** F3, or the new code will not start. Write that in the change record. Step I still rotates it afterwards.

**C4 — `DATABASE_URL` is present and points at 10.0.0.205** (password never printed) (`NOT EXECUTED`):

```powershell
# NOT EXECUTED
$d = @(Get-Content "$root\shared\.env" | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' })
"DATABASE_URL lines: $($d.Count)   (must be exactly 1)"
$u = ($d[0] -replace '^\s*DATABASE_URL\s*=\s*', '').Trim()
"non-empty: $($u.Length -gt 0)"
if ($u -match '@([^:/@]+)(:(\d+))?/([^?]+)') { "host=$($matches[1]) port=$($matches[3]) database=$($matches[4])" } else { 'host part not recognised' }
"uses the asyncpg driver: $($u.StartsWith('postgresql+asyncpg://'))"
Remove-Variable u, d
```

Expected: 1 line, non-empty, `host=10.0.0.205`, `database=ckassetmanagement`, asyncpg `True`. **STOP if
`DATABASE_URL` is missing or empty.** The app would fall back to the development address `localhost:5432/ckam`. The
password must never appear in the output: the regex above prints only the part after `@`.

**C5 — Disk space.** On 10.0.1.98: `Get-PSDrive D` (`NOT EXECUTED`). You need room for the release (≈ 4.3 MB
unpacked, 2.1 MB zip), the new venv packages (a few hundred MB at most), and the log copy. On 10.0.0.205:
`Get-PSDrive E` (`NOT EXECUTED`). You need room for one more dump; compare with the newest file in `<BACKUP-DIR>`.

**C6 — Backup capability (DBA, 10.0.0.205)** (`NOT EXECUTED`):

```powershell
# NOT EXECUTED
Get-ScheduledTaskInfo -TaskName 'CK_Backup_CKASSETMANAGEMENT' | Select-Object LastRunTime, LastTaskResult, NextRunTime
Get-Content 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP\backup.log' -Tail 10
Get-ChildItem 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, Length, LastWriteTime
Test-Path '<PG-BIN>\pg_restore.exe'
```

Expected: `LastTaskResult 0`, a recent `OK` line, a non-empty dump from last night, and `pg_restore.exe` present.
Also record **which database login the backup uses**. Look only at the CKAM part of the task/script: the script
`C:\ProgramData\CKBackup\backup-db.ps1` is shared with other apps, so do not change it. If the backup connects as
`ckassetapp`, step I (DB password) must also update that stored credential.

**C7 — Migration head is `e6f8a0b2c4d6` (DBA, read-only)** (`NOT EXECUTED`):

```
-- NOT EXECUTED — psql on 10.0.0.205, connected to ckassetmanagement (password typed at the prompt)
SET default_transaction_read_only = on;
SELECT version_num FROM alembic_version;          -- expected: e6f8a0b2c4d6 (exactly one row)
SELECT count(*) FROM asset;                       -- data volume, for the migration-time estimate
SELECT count(*) FROM audit_log;
```

**STOP** if the revision is not `e6f8a0b2c4d6`.

**C8 — Release zip SHA-256 verified ON THE SERVER.** DEV hands IT the zip
`ckam-security-release-ccae7b2.zip` and the expected hash through a channel separate from the file. IT copies the
zip into `<STAGING-DIR>` (step E1 describes the copy; it may be done now, because copying a file to staging changes
nothing in CKAM). Then (`NOT EXECUTED`):

```powershell
# NOT EXECUTED
$zip = '<STAGING-DIR>\ckam-security-release-ccae7b2.zip'
(Get-Item $zip).Length                                         # expected 2152224
(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()  # expected b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3
```

**STOP** if either value differs. Do not "re-download until it matches" without asking DEV why it differed.

**C9 — Launcher review (EXT-13 / EXT-38)** (`NOT EXECUTED`):

```powershell
# NOT EXECUTED
Get-FileHash "$root\shared\run_ckam_web.ps1" -Algorithm SHA256
Copy-Item "$root\shared\run_ckam_web.ps1" "$ev\run_ckam_web.live-before.ps1"
Select-String -Path "$root\shared\run_ckam_web.ps1" -Pattern 'uvicorn' | ForEach-Object { $_.Line.Trim() }
'has --no-proxy-headers: '  + [bool](Select-String -Path "$root\shared\run_ckam_web.ps1" -Pattern '--no-proxy-headers' -SimpleMatch -Quiet)
'has --no-server-header: '  + [bool](Select-String -Path "$root\shared\run_ckam_web.ps1" -Pattern '--no-server-header' -SimpleMatch -Quiet)
'has --proxy-headers (bad): ' + [bool](Select-String -Path "$root\shared\run_ckam_web.ps1" -Pattern ' --proxy-headers' -SimpleMatch -Quiet)
'mentions --workers (bad: multiplies the rate limits): ' + [bool](Select-String -Path "$root\shared\run_ckam_web.ps1" -Pattern '--workers' -SimpleMatch -Quiet)
```

Compare the live launcher with `releases\ccae7b2\ops\windows\run_ckam_web.ps1.template` (after E) using
`Compare-Object (Get-Content A) (Get-Content B)`. Write down every difference that is not a documented server path.
If the live launcher contains a hard-coded secret, write only "yes" in the change record (never the value), and plan
to replace that launcher with the template in G1. **Do not send the live launcher off the server until someone has
checked it contains no secret.** Expected today: both flags missing (EXT-38 open).

**C10 — Shared-account questions (block the matching rotation in step I if unanswered).**

- **"Is `ckappuser` used only by CKAM?"** → `OWNER / INFRA CONFIRMATION REQUIRED` (NAS-ADMIN).
- **"Is the ERP role (`PO_SOURCE_USER`, documented as `ckpost`) used only by CKAM?"** →
  `OWNER / INFRA CONFIRMATION REQUIRED` (ERP-OWNER). Also: does the dev PC's `.env` use the same ERP login? (IF-09).
- **"Is the DB role `ckassetapp` used only by CKAM, and by the backup?"** → `OWNER / INFRA CONFIRMATION REQUIRED`
  (DBA).

If an account is shared, its password change would break the other app. Then do not rotate it in this window:
follow `CKAM_SECRET_ROTATION_CHECKLISTS.md` §5 (EXT-43: a CKAM-only account in the approved production security
stage).

**C11 — Package index reachable from 10.0.1.98 and the venv is Python 3.13** (`NOT EXECUTED`):

```powershell
# NOT EXECUTED
& "$root\shared\venv\Scripts\python.exe" -V                    # expected Python 3.13.x
Test-NetConnection pypi.org -Port 443 | Select-Object ComputerName, TcpTestSucceeded
Test-NetConnection files.pythonhosted.org -Port 443 | Select-Object ComputerName, TcpTestSucceeded
& "$root\shared\venv\Scripts\python.exe" -m pip --version
```

If the index cannot be reached, **STOP** and ask the owner (package-build observation 2).

**C12 — No interfering schedule.** The window must not overlap the nightly backup (03:00 on 10.0.0.205). `pg_dump`
holds locks that make `CREATE TRIGGER` in F4 wait. The window must not overlap Spinwheel or Citykart Desk
maintenance either.

**C13 — Release contents (DEV, dev PC, read-only git)** (`NOT EXECUTED`):

```bash
# NOT EXECUTED
git rev-parse ccae7b2                                   # ccae7b2281bc4ca71f4b6113f61dc86de392bc3e
git diff --name-only fd34520 ccae7b2 -- . ':!docs'      # expected exactly: backend/constraints.txt, ops/windows/README.md, ops/windows/deploy_ckam.ps1.template, ops/windows/verify_release.ps1
for c in 3e134c1 7b039fb 69c3a51 734fd19 ca94574 fafa225; do git merge-base --is-ancestor $c ccae7b2 && echo "$c included"; done
```

Also record:
- **GATE rehearsal evidence** (`docs/security/evidence/closure/gate/GATE_REHEARSAL.md`, updated 2026-10-17): done on
  the **superseded** `eed3de1` package, Linux container, never on Windows. 283 cases, 280 PASS, 3 FAIL (all three
  were documentation claims: GT-F01, GT-F02); no release-code defect. Migration `e6f8a0b2c4d6 → c6e8a0b2d4f6` on a
  restored copy as the owning role: one `upgrade head` 0.86 s wall, no row rewritten, 39 of 39 tables' row counts
  unchanged. IF-01: 47 probes, 0 leaks. Whether these results carry over to `ccae7b2` (the application code
  is unchanged, `PACKAGE_REPORT_ccae7b2.md` §1; only the ops scripts and `constraints.txt` change): `TO BE FILLED
  BY LEAD` (delta rehearsal).
- **Native Windows run of the `ccae7b2` package** (updated 2026-10-17, security release): installed with
  `pip install -c backend\constraints.txt -e backend` (Python 3.13.1, 43 packages at their pins, succeeded). Then
  started with production settings and both flags. The 32-payload Windows list gave 0 leaks and one identical
  refusal. `/assets/<id>` and `/assets/new` opened the app. A cold browser load of `/assets/1` went to sign-in and
  then to the asset. Packaged `verify_release.ps1`: 41/41 PASS incl. `-LocalProcessCheck Require`. Evidence:
  `docs/security/evidence/closure/windows/native_windows_release_ccae7b2.txt`, `native_windows_qr_ccae7b2.txt`,
  `native_windows_verify_release_ccae7b2.csv`. Limits: portable (embeddable) Python, not a venv; test database on
  Docker, not PostgreSQL 18; no Task Scheduler, no NAS; the dev PC, not 10.0.1.98.
- **The lead's regression run on `ccae7b2`**: backend pytest, vitest, tsc, Playwright and security journeys.
  `TO BE FILLED BY LEAD`. The last recorded run is on `fd34520`: 2541 passed / 1 skipped, vitest 1257, security
  journeys 14/14 (`CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` §B.5).

**C14 — Approvals and notice** (from A) are written. The go/no-go table
(`CKAM_PRODUCTION_SECURITY_GO_NO_GO.md`) is signed READY by the lead.

**Verification:** every C item has a written answer in the change record. No secret value appears there.

**Rollback:** nothing was changed (apart from the evidence copies and the staged zip), so there is nothing to roll back.

**STOP if:** the live release is not `3b5e842`; the DB revision is not `e6f8a0b2c4d6`; `DATABASE_URL` is missing;
the backup task fails; the zip hash or size differs; the package index is unreachable; the GATE rehearsal is not
READY. An unanswered shared-account question does **not** stop the deploy. It only stops the rotation of that one
secret.

---

## Step D — BACKUP the production database (and prove it is readable)

**Purpose:** a way back if a step fails, and proof of the state before the change.

**Who:** DBA (10.0.0.205), NAS-ADMIN or IT (files), IT (settings).

1. **Database dump (DBA)** (`NOT EXECUTED`):

   ```powershell
   # NOT EXECUTED
   Start-ScheduledTask -TaskName 'CK_Backup_CKASSETMANAGEMENT'
   do { Start-Sleep 10; $s = (Get-ScheduledTask -TaskName 'CK_Backup_CKASSETMANAGEMENT').State } while ($s -eq 'Running')
   Get-ScheduledTaskInfo -TaskName 'CK_Backup_CKASSETMANAGEMENT' | Select-Object LastRunTime, LastTaskResult
   Get-Content 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP\backup.log' -Tail 5
   $dump = Get-ChildItem 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
   $dump | Select-Object Name, Length, LastWriteTime
   Get-FileHash $dump.FullName -Algorithm SHA256
   ```

2. **Prove the dump is readable (DBA)** without restoring it anywhere (`NOT EXECUTED`):

   ```powershell
   # NOT EXECUTED
   & '<PG-BIN>\pg_restore.exe' --list $dump.FullName | Select-Object -First 15
   & '<PG-BIN>\pg_restore.exe' --list $dump.FullName | Select-String 'alembic_version|audit_log|asset_event'
   & '<PG-BIN>\pg_restore.exe' -f NUL $dump.FullName ; "pg_restore exit code: $LASTEXITCODE"
   ```

   Expected: the list shows `ckassetmanagement` objects (`asset`, `audit_log`, `asset_event`, `alembic_version` …),
   and the exit code is 0. `-f NUL` converts the whole dump to SQL text and throws it away. That proves every block
   can be read, and it touches no database. If the dump is not in custom format, `pg_restore` says so. Then use the
   method the backup script documents.
3. **Keep a second copy of this dump** in an admin-only place that is not the backup folder (the 30-day rotation
   must not remove it during the rollback window). Write its name and SHA-256 in the change record. This dump is
   the input to rollback option 2 (`CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` §5).
4. **Files (NAS-ADMIN or IT).** Make a point-in-time copy of `CKASSETMANAGEMENT_DATA`: a NAS snapshot if the NAS
   supports it, otherwise `robocopy /E /COPY:DAT` to an admin-only location that is **not** the same folder. The
   deploy does not change documents, so this is a safety copy.
5. **Settings and launcher (IT, 10.0.1.98)** (`NOT EXECUTED`):

   ```powershell
   # NOT EXECUTED
   Copy-Item "$root\shared\.env" "$ev\env.pre-ccae7b2"
   Get-FileHash "$root\shared\.env" -Algorithm SHA256 | Out-File "$ev\env.pre-ccae7b2.sha256.txt"
   ```

   This copy holds the **current (exposed) secrets**. Keep it only until J has verified the new ones, then delete it
   (J5). The launcher copy was taken in C9.

**Verification:** backup task result 0; `backup.log` OK; dump size similar to last night's; `pg_restore` exit 0;
second dump copy exists; NAS snapshot/copy exists; settings copy exists.

**Rollback:** not applicable (read-only for production data).

**STOP if:** the dump cannot be read. Do not continue without a readable backup.

**Evidence:** dump name, size, SHA-256, `pg_restore --list` head, exit codes; snapshot id or copy log.

---

## Step E — COPY the new release (and verify the checksum after the copy)

**Purpose:** the code that will run must be exactly the approved package, byte for byte.

**Who:** DEV (hands over), IT (copies and checks).

1. **Transfer** (only after A's deploy approval). The established method is `scp` from the dev PC with the key
   `~/.ssh/citykart_newservers`, into `<STAGING-DIR>` (`NOT EXECUTED`; `MSYS_NO_PATHCONV=1` is needed in Git
   Bash):
   `MSYS_NO_PATHCONV=1 scp -i ~/.ssh/citykart_newservers "/d/ANKUR AI PROJECTS/Asset Management/release-packages/ckam-security-release-ccae7b2.zip" <admin-user>@10.0.1.98:"<STAGING-DIR>/"`
2. **Verify the copy:** rerun C8 against the file that is now in `<STAGING-DIR>`. The expected SHA-256 is
   `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` and the size is `2152224` bytes. **STOP if
   it differs.**
3. **Expand into the release folder.** Never overwrite an existing folder (`NOT EXECUTED`):

   ```powershell
   # NOT EXECUTED
   $rel = "$root\releases\ccae7b2"
   if (Test-Path $rel) { 'STOP: releases\ccae7b2 already exists - find out why before continuing' } else {
     New-Item -ItemType Directory -Path $rel | Out-Null
     Expand-Archive -LiteralPath '<STAGING-DIR>\ckam-security-release-ccae7b2.zip' -DestinationPath $rel
   }
   Get-Content "$rel\backend\VERSION"                   # ccae7b2281bc4ca71f4b6113f61dc86de392bc3e
   Test-Path "$rel\frontend-dist\index.html"            # True
   Test-Path "$rel\backend\constraints.txt"             # True
   (Get-ChildItem $rel -Recurse -File).Count            # 215
   Select-String -Path "$rel\frontend-dist\index.html" -Pattern 'index-Cp5JgQR-\.js' -Quiet   # True
   (Get-Content "$rel\RELEASE.json" -Raw | ConvertFrom-Json) | Select-Object release_sha_short, alembic_head, constraints_pins   # ccae7b2, c6e8a0b2d4f6, 44
   ```

4. **Content check BEFORE the install.** `pip install -e` later adds build metadata to the backend folder, and
   Python adds `__pycache__`, so this check is only valid now. The content hash is the SHA-256 of the lines
   "`<lower-case sha256>␠␠<path with forward slashes>`\n" for all `215` files, sorted by path in byte (ordinal) order
   (`PACKAGE_REPORT_ccae7b2.md` §7) (`NOT EXECUTED`; this PowerShell form has not been tried):

   ```powershell
   # NOT EXECUTED
   $items = @(Get-ChildItem -LiteralPath $rel -Recurse -File | ForEach-Object {
     [pscustomobject]@{ P = $_.FullName.Substring($rel.Length + 1).Replace('\','/'); F = $_.FullName } })
   $keys = [string[]]($items | ForEach-Object { $_.P }); $arr = [object[]]$items
   [Array]::Sort($keys, $arr, [StringComparer]::Ordinal)
   $text = (($arr | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_.F -Algorithm SHA256).Hash.ToLowerInvariant(), $_.P }) -join "`n") + "`n"
   $sha = [Security.Cryptography.SHA256]::Create()
   'content hash: ' + (-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }))
   "files: $($arr.Count)"
   ```

   Expected: `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b` and `215`. If the snippet gives a
   different value but the zip hash (E2) matched, do not guess. Compare file by file against
   `MANIFEST.sha256.txt`, which DEV hands over with the zip. Its paths start with
   `ckam-security-release-ccae7b2/`. A matching zip hash is the primary proof.
5. **Leave `releases\3b5e842` and every older release folder untouched.**

**Verification:** zip SHA-256 and size match on the server; the expanded folder has `215` files, the right `VERSION`
and bundle name, and the content hash (or the manifest comparison) matches.

**Rollback:** delete nothing. If E fails, leave `releases\ccae7b2` as it is for investigation. Nothing in CKAM has
switched yet; the old release is still running.

**Evidence:** both hash outputs (dev PC and server), the file count, the content-hash output.

---

## Step F — STOP CKAM, INSTALL, SWITCH, and RUN THE FOUR MIGRATIONS BEFORE THE NEW CODE STARTS

**Purpose:** the new code needs the new schema. If it starts on the old schema, every sign-in fails (it reads
`asset_user.token_version` and writes `auth_session`). The migrations must therefore run while **no** CKAM code is
running.

**Who:** IT (10.0.1.98). DBA on standby.

**F0 — Final log top-up.** Rerun B2 (robocopy into a second folder `logs-at-stop`, with its own hash list). This
catches the lines written since B.

**F1 — Stop CKAM only** (`NOT EXECUTED`). The server is shared:

```powershell
# NOT EXECUTED
Stop-ScheduledTask -TaskName 'CKAM-Web'
Start-Sleep 3
$pids = (Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
foreach ($p in $pids) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
  "PID $p : $($proc.ExecutablePath) : $($proc.CommandLine)"
}
```

Stop a PID (`Stop-Process -Id <pid> -Force`) **only** if its executable is under `<ROOT>\shared\venv\` and its
command line contains `app.main:app`. Never stop another app's process. Port 3211 is registered to CKAM in
`D:\Citykart_Applications\PORTS.md`. Afterwards, `Get-NetTCPConnection -LocalPort 3211 -State Listen` must
return nothing. **From this moment CKAM is down. IF-01 is not reachable while it is down.**

**F2 — Install the backend with the tested versions** (EXT-12) (`NOT EXECUTED`):

```powershell
# NOT EXECUTED
$ErrorActionPreference = 'Continue'
$rel = "$root\releases\ccae7b2"
& "$root\shared\venv\Scripts\python.exe" -m pip install --disable-pip-version-check -c "$rel\backend\constraints.txt" -e "$rel\backend" 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\pip-install.txt"
"pip exit code: $LASTEXITCODE"
& "$root\shared\venv\Scripts\python.exe" -m pip check 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\pip-check.txt"
& "$root\shared\venv\Scripts\python.exe" -m pip freeze 2>&1 | ForEach-Object { "$_" } | Out-File "$rel\pip-freeze.txt"
Select-String -Path "$rel\pip-freeze.txt" -Pattern '^colorama==' | ForEach-Object { "colorama installed (must equal the pin in constraints.txt): $($_.Line)" }
Select-String -Path "$rel\backend\constraints.txt" -Pattern '^colorama==' | ForEach-Object { "colorama pin: $($_.Line)" }
```

Expected *(updated 2026-10-17, security release)*: pip exit code 0. `pip freeze` shows **43 packages, every one
at its pin** in `constraints.txt` (44 pins; `uvloop` is never installed on Windows), including `colorama==0.4.6`,
plus the editable `ckam-backend`. This exact command succeeded natively on Windows with the `ccae7b2` package
(Python 3.13.1, portable Python rather than a venv, `native_windows_release_ccae7b2.txt`), and the Windows-wheel
dry run covers every pin (`PACKAGE_REPORT_ccae7b2.md`). It has **not** been run in the production venv. Any other
unpinned package in `pip freeze` is a finding to write down. If the constrained install fails, **do not start any
code**. Write down the error. The database is still unchanged at this point, so
`CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` case 1 applies (abort, restart `3b5e842` after reinstalling its backend, or
stay down, per the owner). If `deploy_ckam.ps1` is used, it does this case itself: branch A, exit 1, previous
release restarted. The earlier fallback "install without `-c`" is allowed
only with the owner's explicit OK, recorded in the change record, with EXT-12 kept open.

**F3 — Switch the settings to `ccae7b2`** (Notepad as Administrator, or `deploy_ckam.ps1` step 7):
- `FRONTEND_DIST_DIR=<ROOT>\releases\ccae7b2\frontend-dist`. This is **the single release switch**: the launcher
  runs the backend from the `backend` folder next to it.
- `APP_VERSION=ccae7b2`.
- keep `ENVIRONMENT_NAME=production`, `LOG_DIR=<ROOT>\logs\app`, `TRUSTED_PROXIES` empty, `COOKIE_SECURE=false`,
  `BASE_URL` unchanged.
- **only if C3 failed:** set `JWT_SECRET=<TYPED-ON-SERVER>`, a new strong value (procedure in
  `CKAM_SECRET_ROTATION_CHECKLISTS.md` §1). It is rotated again in I.
- Save as UTF-8 **without BOM**. Then check (`NOT EXECUTED`):

  ```powershell
  # NOT EXECUTED
  $b = [IO.File]::ReadAllBytes("$root\shared\.env")
  'BOM present: ' + ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)   # must be False
  ```

  Then rerun the allow-listed print of C1. It must show the new `FRONTEND_DIST_DIR` and `APP_VERSION=ccae7b2`.
  Rerun C3 and C4: they must still pass.

**F4 — Migrate (old code stopped, new code not started)** (`NOT EXECUTED`). The `.env` values are loaded into this
one process only, and nothing secret is printed:

```powershell
# NOT EXECUTED
Get-Content "$root\shared\.env" | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($k.Trim(), $v, 'Process')     # same as the launcher: value passed as written
}
if (-not $env:DATABASE_URL) { throw 'STOP: DATABASE_URL is not set - alembic would use the development fallback' }
Set-Location "$rel\backend"
& "$root\shared\venv\Scripts\python.exe" -m alembic heads   2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-heads.txt"     # c6e8a0b2d4f6 (head)
& "$root\shared\venv\Scripts\python.exe" -m alembic current 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-before.txt"    # e6f8a0b2c4d6
& "$root\shared\venv\Scripts\python.exe" -m alembic upgrade head 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-upgrade.txt"
"alembic exit code: $LASTEXITCODE"
& "$root\shared\venv\Scripts\python.exe" -m alembic current 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-after.txt"     # c6e8a0b2d4f6 (head)
```

Notes:
- The migrations run as today's app role `ckassetapp`, which owns the tables. That ownership is needed, because
  creating triggers requires it.
- The four migrations, in order:

  | # | Revision | What | Effect on the old code `3b5e842` |
  |---|---|---|---|
  | 1 | `f9a1c3e5b7d2` | `asset_user.token_version` (NOT NULL, default 0) | ignored (additive) |
  | 2 | `a3c5e7f9b1d4` | BEFORE TRUNCATE triggers on `asset_event`, `asset_field_change`, `master_audit`, `audit_log`; 5-year floor for the audit purge | ignored (the old code never truncates) |
  | 3 | `b5d7f9a1c3e5` | `auth_session` table (refresh-token reuse detection); the new code writes a row at every sign-in, so this MUST exist before the new code starts | ignored (additive) |
  | 4 | `c6e8a0b2d4f6` | trigger refusing **updates** of `asset.status`, `current_asset_user_id`, `status_since` outside the ledger writer | **breaks it partly (GT-F01):** receives still work (new rows are inserted in their final state); every move, repair, lost/found, dispose, sale and scrap is refused with a misleading 422 "Some of the values could not be saved…" |

- **All four run in one transaction (GT-F04).** A failure in any of them rolls back all four, and the database stays
  at `e6f8a0b2c4d6`: nothing of 1–3 is kept.
- `alembic upgrade head` seeds a bootstrap admin and prints a one-time password **only if no head-office admin
  exists**. Production has admins, so none is expected. If one appears, it stays in the admin-only file. Never copy
  it into chat or reports.
- Expected duration: gate rehearsal (Linux, PostgreSQL 17, the 22-persona fixture): one `alembic upgrade head`
  **0.86 s wall**, a few milliseconds of DDL; no row rewritten; row counts of all 39 existing tables unchanged. All
  four are metadata changes, so the time does not grow with the table sizes. The realistic risk on production is a
  **lock wait** (each statement waits for any open transaction on the same table): CKAM is stopped (F1) and the
  window avoids the 03:00 backup (C12). If `upgrade head` has not finished within about a minute, it is waiting for
  a lock: the DBA looks at `pg_stat_activity` / `pg_locks` for `ckassetmanagement` (read-only) before anything else.
  Production timing on PostgreSQL 18: `TO BE FILLED BY LEAD` (record it in the change record).

**Verification:** exit code 0; `alembic-before.txt` shows `e6f8a0b2c4d6`; `alembic-after.txt` shows
`c6e8a0b2d4f6 (head)`; `alembic-upgrade.txt` lists the four revisions once each and no `ERROR`; check that the files
contain no secret before they leave the server. **`alembic current` must equal `alembic heads`** before step G
(GT-F05): this is the only check before the start that proves the schema is ready; `/api/health` does not.

**If F4 fails:** **do not start any code.** The database is unchanged (`e6f8a0b2c4d6`; all four migrations rolled
back together, GT-F04). Confirm it with `alembic current` (or the DBA's `SELECT version_num FROM alembic_version;`).
Starting `ccae7b2` now would look healthy but sign nobody in (GT-F05). Follow
`CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` case 1 (the safe abort). Do not run `alembic downgrade`, and do not restore a
dump.

**Evidence:** `pip-install.txt`, `pip-check.txt`, `pip-freeze.txt` (with the colorama line), `alembic-heads`/
`before`/`upgrade`/`after.txt`, the BOM check, the allow-listed `.env` output before and after.

---

## Step G — START the new release with `--no-proxy-headers --no-server-header`

**Purpose:** start the new code. uvicorn must **not** believe `X-Forwarded-For` (N2: otherwise any local process on
the shared server could fake its address in the audit trail and dodge the sign-in limit). It must also not announce
itself in a `Server` header (CL2-IF-OBS-05).

**Who:** IT.

**G1 — Launcher.** The live `shared\run_ckam_web.ps1` must start
`python -m uvicorn app.main:app --host 0.0.0.0 --port 3211 --no-proxy-headers --no-server-header`, from the release's
`backend` folder, with the venv. Recommended: replace it with the reviewed template
`releases\ccae7b2\ops\windows\run_ckam_web.ps1.template` (renamed to `run_ckam_web.ps1`). Keep only the documented
server-specific parameter values that C9 found. The template reads `shared\.env` and `shared\nas.pw` at run time and
contains no secret. Never add `--workers` (the in-process rate limits would multiply) and never add
`--proxy-headers`. Keep `TRUSTED_PROXIES` empty. Record the new launcher's SHA-256 (`NOT EXECUTED`):
`Get-FileHash "$root\shared\run_ckam_web.ps1" -Algorithm SHA256`.
Before the real start, a dry run (`NOT EXECUTED`): `powershell -NoProfile -ExecutionPolicy Bypass -File "$root\shared\run_ckam_web.ps1" -WhatIf`.
It maps nothing and starts nothing. It shows the uvicorn line.

**G2 — Start** (`NOT EXECUTED`): `Start-ScheduledTask -TaskName 'CKAM-Web'`. Wait about 20 seconds.

**G3 — Check the process flags and the launcher log** (`NOT EXECUTED`) *(updated 2026-10-17, security release)*.

**Primary flags check:** `ccae7b2`'s `verify_release.ps1` with **`-LocalProcessCheck Require`**, run **on 10.0.1.98,
elevated** (so that it can read the command line of the task's process). It FAILS unless exactly one uvicorn
process listens on the port and its command line has **both** `--no-proxy-headers` and `--no-server-header`. In
`Require` mode it never SKIPs. It is part of H4 (and `deploy_ckam.ps1` runs it the same way):

```powershell
# NOT EXECUTED — 10.0.1.98, elevated
powershell -NoProfile -ExecutionPolicy Bypass -File "$rel\ops\windows\verify_release.ps1" -BaseUrl http://127.0.0.1:3211 -ExpectedRelease ccae7b2 -ReleaseDir $rel -LauncherLogDir "$root\logs" -LocalProcessCheck Require -OutCsv "$ev\verify_g3.csv"
"verify exit code: $LASTEXITCODE   (0 = no FAIL, 1 = at least one FAIL, 2 = address not reachable)"
```

**Manual fallback** (if the script cannot be used, or to look at the details), plus the launcher and stderr logs:

```powershell
# NOT EXECUTED
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*app.main:app*' } | Select-Object ProcessId, ExecutablePath, CommandLine
@(Get-NetTCPConnection -LocalPort 3211 -State Listen).Count                       # 1
$ll = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.launcher.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-Content $ll.FullName | Select-String 'serving release|release id|NAS mapping attempt|starting:|WARNING'
$err = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.err.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Select-String -Path $err.FullName -Pattern 'Refusing to start|Traceback|Error' | Select-Object -First 5
```

| Check | Expected |
|---|---|
| Process flags | `verify_release.ps1 -LocalProcessCheck Require`: the process-check row PASS (exit 0). Fallback: the command line contains `--no-proxy-headers`, `--no-server-header`, `--port 3211`; executable under `shared\venv`; exactly **one** CKAM listener |
| Launcher log | `serving release: <ROOT>\releases\ccae7b2`; `environment: production; release id: ccae7b2`; a NAS mapping line that succeeded (e.g. `NAS mapping attempt 1: The command completed successfully`) |
| stderr log | **no** `Refusing to start` (that means the JWT check failed: fix the secret per F3, restart); no traceback |

**If G fails** (the app does not start): `CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` case 2 (migrations done, app not
started). **Do not start `3b5e842`** as a reflex.

**Evidence:** launcher SHA-256 before (C9) and after, the process command line, the log lines above.

---

## Step H — VERIFY (the only proof that counts for production)

**Purpose:** confirm on the real Windows server that the new code is running, that IF-01 is closed (including the
Windows path forms), that the other protections are on, and that normal work still functions. Run the HTTP checks
**once from the server** against `http://127.0.0.1:3211` and **once from a LAN PC** against
`http://10.0.1.98:3211`. Use `curl.exe` (in Windows PowerShell 5.1, `curl` is an alias for a different command) with
`--path-as-is`. Discard bodies with `-o NUL` so that no file content is ever shown. Record status codes only.

**Who:** IT + SEC. APPROVER signs the gate.

**The replacement for `/openapi.json` (updated 2026-10-17, security release).** In production the API
documentation is off and answers a JSON 404 (GT-F06). To prove the new code is running **on the migrated
database**, use H1, H2, H3, H10, H11, H12 and H13 together:
- `/api/health` ok (H1);
- diagnostics health signed in as a **head-office admin**: `version` `ccae7b2`, `environment` `production`,
  `migrations.ok` true (H13, with H2 and H3);
- the bundle name `index-Cp5JgQR-.js` in the served `index.html` (H11);
- the launcher log line `serving release: …\releases\ccae7b2` (H12);
- the QR direct link `/assets/<ASSET-ID>` answering 200 with the app page (H10).

> **GT-F05 — health alone is not proof.** If F4 had been skipped or had failed, the new code would still answer
> `/api/health` 200, serve the app page and pass a bare `verify_release.ps1`, but **every sign-in would fail** with
> the misleading 422 "Some of the values could not be saved. Check them and try again." Only `alembic current` =
> `alembic heads` (F4), the startup log (H2: no `migration / head_mismatch` WARNING) and a real sign-in (H13) catch
> it. **H2, H3 and H13 are mandatory**; a green H1 + H4 without them is a FAIL of the gate.
>
> **GT-F01 — receive alone is not proof either.** The old code `3b5e842` can still receive on the migrated schema.
> Only a **move** (H17) proves that the new code's ledger writes pass the `c6e8a0b2d4f6` trigger.

| # | Check | How (`NOT EXECUTED`) | Expected |
|---|---|---|---|
| H1 | Health | `curl.exe -s http://127.0.0.1:3211/api/health` | `{"status":"ok"}` |
| H2 | Startup event | newest `"app_started"` line in `<ROOT>\logs\app\app.jsonl`: `Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'app_started' \| Select-Object -Last 1` (or, signed in, `GET /api/admin/logs/system?event=app_started`) | `version` `ccae7b2`, `environment` `production`, `migration.matches` true (`code_head` = `db_head` = `c6e8a0b2d4f6`), `config.database_host` **`10.0.0.205`**, `config.database_name` `ckassetmanagement`, `jwt_signing_key_is_placeholder` false, `jwt_signing_key_long_enough` true. **No** `migration / head_mismatch` and no `config / log_dir_unwritable` event after it |
| H3 | Alembic head | `alembic-after.txt` from F4, and H13's diagnostics `migrations.ok` | `c6e8a0b2d4f6 (head)`; `ok: true` |
| H4 | Static security (scripted) | `powershell -NoProfile -ExecutionPolicy Bypass -File "$rel\ops\windows\verify_release.ps1" -BaseUrl http://127.0.0.1:3211 -ExpectedRelease ccae7b2 -ReleaseDir $rel -LauncherLogDir "$root\logs" -IncludeUncProbe -LocalProcessCheck Require -OutCsv "$ev\verify_server.csv"` (on the server, **elevated**); from the LAN PC the same with `-BaseUrl http://10.0.1.98:3211 -IncludeUncProbe -LocalProcessCheck Skip -OutCsv verify_lan.csv` (no `-ReleaseDir`/`-LauncherLogDir`; the process check only works on the server itself) | exit code 0 (verify script: 0 = no FAIL, 1 = a FAIL, 2 = not reachable), **0 FAIL**. Every traversal row is `PASS 404`; a `WARN` on a traversal row is **not acceptable in production** (it means 200 with the shell); `Server header` PASS; the **local process check** PASS on the server (both uvicorn flags, one listener); `POST /api/auth/refresh` without a cookie and a made-up sign-in both a **JSON 401** with no cookie (the made-up sign-in leaves one ordinary "sign-in failed" security row and uses one try of the sign-in rate limit; a 429 is a WARN). Reference: native Windows run of the package 41/41 PASS (`native_windows_verify_release_ccae7b2.csv`, dev PC, not the server). **The script has no explicit migration check (GT-F05): its exit 0 never replaces H2/H3/H13** |
| H5 | IF-01 Windows probes (manual list) | the loop below, from the server and from the LAN | every status `404`, "Any non-404" = 0 |
| H6 | API docs unavailable | `curl.exe -s -o NUL -w '%{http_code}' $B/openapi.json` (also `/docs`, `/redoc`); `curl.exe -s $B/openapi.json` | `404`; body is the small JSON error envelope (`{"detail":"Not Found","request_id":…}`), **not** Swagger/ReDoc/OpenAPI and **not** the app page (GT-F06). `verify_release.ps1` also accepts the app page here, but the security release answers JSON 404 (gate rehearsal step 4a); a 200 means the wrong code is running → case 4 |
| H7 | Unknown API path | `curl.exe -s -o NUL -w '%{http_code}' $B/api/does-not-exist`; `curl.exe -s -D - $B/api/does-not-exist` | `404`, `Content-Type: application/json`, body with `detail` and `request_id`, not HTML |
| H8 | Security headers exactly once | `curl.exe -s -D - -o NUL $B/api/health` and `curl.exe -s -D - -o NUL $B/` | each of `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` appears **once**; `Cache-Control: no-store` on `/api/`, `no-cache` on `/`; an `X-Request-ID` header; **no** `server: uvicorn` |
| H9 | Forged address ignored | `curl.exe -s -H "X-Forwarded-For: 203.0.113.77" $B/api/health`, then `Select-String -Path "$root\logs\app\app.jsonl" -Pattern '203.0.113.77'` | **no** access line carries `"ip": "203.0.113.77"`; the line for that request shows `127.0.0.1` |
| H10 | QR direct link (CL2-IF-04, EXT-44) | `curl.exe -s -o NUL -w '%{http_code}' $B/assets/<ASSET-ID>` and `$B/assets/new`; then **scan one real QR** from an Asset 360 page with a phone on the LAN, **and one label printed from Print Labels in the default "Barcode + QR" format** (its QR is the same `BASE_URL/assets/<id>` deep link, GT-F02) | `200` (app shell, `Cache-Control: no-cache`); the phone opens the asset page after sign-in, for both |
| H11 | Bundle in `index.html` | `curl.exe -s $B/ \| Select-String 'index-Cp5JgQR-\.js'` | found (the `ccae7b2` bundle; `verify_release.ps1` also checks that the bundle contains `ccae7b2`) |
| H12 | Launcher log | G3 | `serving release: …\releases\ccae7b2`, NAS mapping succeeded |
| H13 | Sign-in + diagnostics | sign in in a browser as a **head-office admin**; open `GET /api/admin/diagnostics/health` | sign-in works; `version` `ccae7b2`, `environment` `production`, `database.ok` true, `log_dir.ok` true, `migrations.ok` true, `erp_sync` as expected (see H18) |
| H14 | Asset list | open the Asset Register; search | rows appear; one asset's detail opens (Overview / History / Changes tabs) |
| H15 | Purchase orders | open the PO list and one PO | list and PO lines show |
| H16 | Receive | receive **one** unit on a PO line the owner chose for the test (production has no hard delete, so the asset stays; pick a real pending receipt) | succeeds; one `asset_event` row and one `audit_log` row (`RECEIVE`) |
| H17 | Move | move that asset (or an owner-chosen asset) to another holder and, if wanted, back | succeeds; `asset_event` + `audit_log` `LIFECYCLE`/`MOVE` rows. **This proves the `c6e8a0b2d4f6` trigger accepts the new code's ledger writes** (a receive does not prove it: the old code can receive too, GT-F01). A 422 "Some of the values could not be saved…" here means: look at `error.jsonl` for the trigger message → rollback strategy case 3 |
| H18 | ERP copy (if `PO_SOURCE_*` is set) | `GET /api/admin/logs/system?component=erp_sync` | a `sync_success` after the start (if it blips, re-check after a minute: 10.0.1.98 → 10.0.1.69:5432 blipped once in a past deploy) |
| H19 | Documents (NAS) | upload one small test document to the test asset, download it | both work |

**H5 — the manual probe list.** Put these paths, exactly as written, one per line, into
`<EVIDENCE-DIR>\if01_paths.txt`. Each is a defensive check that the request is refused:

| # | Path (sent with `--path-as-is`) | Targets |
|---|---|---|
| 1 | `/assets/..%2f..%2f..%2f..%2fshared%2f.env` | the settings file |
| 2 | `/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw` | the NAS password file |
| 3 | `/assets/..%2f..%2f..%2f..%2fshared%2frun_ckam_web.ps1` | the launcher |
| 4 | `/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fshared%2f.env` | encoded dots |
| 5 | `/assets/%252e%252e%252f%252e%252e%252fshared%252f.env` | double-encoded |
| 6 | `/assets/..%5c..%5c..%5c..%5cshared%5c.env` | Windows back-slash form |
| 7 | `/assets/%2e%2e%5c%2e%2e%5cshared%5c.env` | mixed back-slash form |
| 8 | `/assets/C:%2fWindows%2fwin.ini` | an absolute drive path |
| 9 | `/assets/C:%5cWindows%5cwin.ini` | drive path with back-slash |
| 10 | `/assets/%5c%5cserver%5cshare%5cx` | a UNC path (must not cause any outbound lookup; `ccae7b2` refuses it before any filesystem call) |
| 11 | `/assets/CON` | reserved device name |
| 12 | `/assets/NUL` | reserved device name |
| 13 | `/assets/index.html::$DATA` | alternate data stream |

```powershell
# NOT EXECUTED
$B = 'http://127.0.0.1:3211'      # from the LAN PC: http://10.0.1.98:3211
$paths = Get-Content '<EVIDENCE-DIR>\if01_paths.txt'
$rows = foreach ($p in $paths) {
  $code = & curl.exe -s -o NUL -w '%{http_code}' --path-as-is "$B$p"
  [pscustomobject]@{ path = $p; status = $code }
}
$rows | Tee-Object -Variable r | Format-Table -Auto
$r | Export-Csv '<EVIDENCE-DIR>\if01_probe_results_server.csv' -NoTypeInformation
"Any non-404: " + (@($r | Where-Object { $_.status -ne '404' }).Count)
```

Expected: every `status` is `404` (from the server **and** from the LAN). `/assets/CON` and `/assets/NUL` match the
"app page" name pattern, but they are refused earlier by the reserved-name rule (`app/core/static_safety.py`), so
they must be `404`, not `200`.

**Verification (the H gate):** H1–H19 all as expected; both probe CSVs all `404`; `verify_release.ps1` exit 0 from
both places; the APPROVER signs "H passed" with the time in the change record.

> **Gate:** do not start step I until every H check passes. Until then **PRODUCTION REMAINS NOT REMEDIATED.**
> If any check fails, follow `CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` (case 3: functional smoke fails; case 4: an
> IF-01 probe or a security check fails). There is **no automatic downgrade and no automatic restore**. After the
> migrations nothing restarts `3b5e842`: the fixed `deploy_ckam.ps1` exits 3 with `CKAM-Web` stopped (see "Using
> `deploy_ckam.ps1`").

**Evidence:** `verify_server.csv`, `verify_lan.csv`, both probe CSVs, header dumps, the `app_started` line, the
diagnostics JSON (version, migrations), the ids of the receive/move `asset_event` and `audit_log` rows, the QR scan
note (who, which asset, time), and the upload/download result.

---

## Step I — ROTATE the secrets (only after H has passed)

**Purpose:** the hole may have exposed `shared\.env` (JWT secret, DB password, ERP password) and `shared\nas.pw`.
New values make any copy useless. They are only safe now, because the hole is closed.

**Order and procedure:** `CKAM_SECRET_ROTATION_CHECKLISTS.md`:
1. **JWT secret** (everyone is signed out and signs in again) — §1
2. **DB password of `ckassetapp`** (and the backup's stored credential if it uses that role) — §2
3. **NAS password** (only if C10 confirmed `ckappuser` is CKAM-only; otherwise EXT-43: a CKAM-dedicated NAS account
   in the approved production security stage) — §3
4. **ERP password** (ERP-OWNER; only if the role is CKAM-only or a joint change was agreed) — §4

Each rotation has its own validation test. A secret whose shared-account question is unanswered is **not** rotated
in this window. Write "not rotated: shared / unanswered" in the change record and the incident record.

---

## Step J — RESTART and VERIFY every connection; clean up old secret copies

**Who:** IT (+ DBA for the backup run).

1. Final restart of `CKAM-Web`, if one has not happened since the last rotation (F1 stop commands, then
   `Start-ScheduledTask`) (`NOT EXECUTED`).
2. Rerun H1, H2 (a new `app_started` with `ccae7b2`), H4 (`verify_release.ps1`, server + LAN), H5, H9 and H13.
3. Connections: database (`diagnostics/health` `database.ok`); NAS (the launcher log mapping line, plus an
   upload/download); ERP (`sync_success`); a sign-in with a **fresh** session. A token from before the JWT rotation
   is refused with `401`.
4. Run the backup task once more (D1) and confirm it still succeeds with the current DB credential.
5. **Delete the old secret copies** now that the new secrets are proven: `<EVIDENCE-DIR>\env.pre-ccae7b2`,
   `<ROOT>\shared\.env.pre-ccae7b2` (written by `deploy_ckam.ps1` if it was used), any `shared\.env.pre-*`
   (including `.env.pre-3b5e842` from the 2026-10-14 deploy), and any `.env.pre-rollback-*`. Check (`NOT EXECUTED`):
   `Get-ChildItem "$root\shared" -Force -Filter '.env.pre-*'` returns nothing. **Do not** delete the database
   dumps, the log copies or any release folder. They hold no live secret, and they are evidence and the rollback
   path.

**Verification:** every check of item 2 and item 3 passes; no `.env.pre-*` remains.

**Evidence:** the second verify CSVs, the backup log line, the directory listing showing no `.env.pre-*`.

---

## Step K — COMPROMISE ASSESSMENT (read-only)

**Purpose:** fixing the hole does not tell you whether someone already came through it. The period to check runs
from 2026-09-30 (IF-01 first shipped) to the time of F1 (the old code stopped).

**Procedure:** `CKAM_COMPROMISE_ASSESSMENT_PLAN.md`. It covers the log searches, the `audit_log` SQL, the DB, NAS,
Windows and router checks, the decision rules (no evidence / suspicious / compromised) and the incident-record
fields. The work is done on the copies preserved in B and F0, never on the live files.

Honest limit, to be written in the incident record: **CKAM access logs exist only since 2026-10-14**, so use of IF-01
before that date can be neither confirmed nor ruled out from CKAM's own logs. Write "no evidence of use (within
the limits of the available logs)", never "not used".

---

## Step L — COMPLETE the change record and the incident record

1. Change record: fill sections D–G with the results of C–J (times, evidence names, hashes). Outcome "Deployed OK"
   or "Rolled forward / aborted (why)". Downtime minutes. Every secret as "rotated / not rotated (reason)", never a
   value.
2. Incident record: sections B–H from K (period, sources checked, sources missing, findings, decision, containment,
   notifications, including whether Legal must consider a CERT-In report, EXT-31).
3. Copy `<EVIDENCE-DIR>` off the server to `<OFFSERVER-EVIDENCE>` with its hash list (EXT-41).
4. APPROVER signs both records (EXT-42).

---

## Step M — PLAN HTTPS and network hardening (separate changes; not part of this window)

- **HTTPS** (IF-02, EXT-04): `docs/security/CKAM_HTTPS_IMPLEMENTATION_PLAN.md`. Until HTTPS is actually live, keep
  `COOKIE_SECURE=false` and `BASE_URL=http://…`. Turning `COOKIE_SECURE=true` over plain HTTP silently signs
  everyone out. **Printed labels (GT-F02):** every label printed in the default "Barcode + QR" format, and every
  Asset 360 QR, carries the current `BASE_URL` (`http://ckam.citykartstores.com:3211/assets/<id>`). After an
  address change those labels keep pointing at the old address, so the HTTPS plan must keep the old address
  redirecting to the new one (or plan a re-label).
- **Internet exposure of port 3211** (EXT-05 / SD-04): the owner decides whether to close or restrict the router
  forward. **Not authorised by this runbook.**
- **Service account instead of SYSTEM** (IF-07, EXT-06): `CKAM_SERVICE_ACCOUNT_PLAN.md`, in its own window.
- **DB role split** (EXT-07 + EXT-45) with the scripts shipped in this release (`ops\db\`).
- **Off-server encrypted backups + restore drill** (EXT-08): `CKAM_BACKUP_RESTORE_PLAN.md`.
- Alerts on `log_write_failed` and REFRESH_REUSE bursts (EXT-48); watch `RATE_LIMITED` rows behind office NAT
  (EXT-40/49); remove the legacy refresh-token path one release later (handover 9(a) step 16).

Write the agreed dates in the change record.

---

## Step N — AFTER VERIFICATION: consider the git push

> **AFTER VERIFICATION.** This used to be "Phase 2 — approved git push", the second step. It is now the **last**
> step. The GitHub repository `kumarsuraj84/Citykart-AssetManagement` is **PUBLIC** (verified 2026-10-16). The
> local commits contain working attack details for IF-01. The deploy does not need a push.

**Prerequisites:** H passed; I done (or the not-rotated secrets recorded); K at least started, with the evidence
preserved; the owner chose an option in `CKAM_GITHUB_PUBLIC_REPO_OPTIONS.md` (A recommended: deploy → verify →
rotate → compromise check → push); the owner said the push phrase **for this change** ("commit and push to git and
main" = push only, to `origin`, default branch `claude/brave-euler-07879a`; no branch is literally called `main`).

**Steps (DEV, dev PC)** (`NOT EXECUTED`): `git push origin worktree-ckam-build:claude/brave-euler-07879a`, or as the
chosen option says. **Never force-push. Never rewrite history.** Never add the untracked
`docs/ai/CKAM_DEMO_WALKTHROUGH.md` / `docs/ai/demo-screens/` (they contain a demo password).

**Verification:** `git ls-remote origin claude/brave-euler-07879a` shows `ccae7b2` or a descendant.

**Rollback:** none. A pushed commit does not change production. Pushed history is never rewritten.

---

## Rollback in one paragraph (full text: `CKAM_PRODUCTION_ROLLBACK_STRATEGY.md`)

**Roll forward first.** Before F4 succeeds, aborting is safe: the database is unchanged (a failed upgrade rolls back
all four migrations, GT-F04), and `3b5e842` can be restarted (with IF-01 still open, exactly as before the window).
After F4 succeeds, the old code `3b5e842` **can still receive, but cannot move, repair, sell or scrap** (trigger
`trg_asset_lifecycle_fields_guard`; users see a misleading 422 "Some of the values could not be saved…", GT-F01),
and it reopens IF-01. So the preferred response to a failure after F4 is: stop `CKAM-Web`, keep CKAM down, find the
cause, fix it, and start `ccae7b2` again (or a corrected release). Going back is only one of two **owner
decisions**: (1) a migration downgrade of **only** the trigger migration (`alembic downgrade -1` from
`releases\ccae7b2\backend`, rehearsed: 0.89 s, nothing of value lost), never all four; or (2) restoring the D
dump, which **loses everything written after the backup**. Neither is ever done automatically. The fixed deploy
template restarts the old release only **before** the migrations (branch A, exit 1). From `alembic upgrade head` on
it leaves `CKAM-Web` stopped (branch B, exit 3). It has only been dry-run, so read it first.
`ops\windows\rollback_release.ps1` switches only the release folder and never touches the database. Do not run it
after F4 without the owner's decision.

---

## One-page printable CHECKLIST

No secret values on this sheet. Tick each line; write "n/a" with a reason where an item is skipped.

```
CKAM URGENT SECURITY DEPLOY — ccae7b2      Change id: CHG-2026-____   Incident id: INC-2026-____
Date: __________  Window: __________   Approver: __________  IT: __________  DBA(owner): __________  SEC: __________
Release ccae7b2 (zip SHA-256 b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3, 2152224 bytes)   Previous 3b5e842   DB e6f8a0b2c4d6 -> c6e8a0b2d4f6
(NOT eed3de1 / be3209af… — superseded)

A RECORDS    [ ] change record opened  [ ] incident record opened  [ ] written deploy approval for ccae7b2 + window
             [ ] rotation-after-verification approved   [ ] user notice sent
B LOGS       [ ] logs\ + logs\app copied, SHA-256 list  [ ] event logs + task XML  [ ] DB/NAS/router logs requested
             [ ] copied off-server, hashes re-checked
C PRECHECK   [ ] live = 3b5e842   [ ] ENVIRONMENT_NAME=production   [ ] JWT True;True;False (not printed)
             [ ] DATABASE_URL present, host 10.0.0.205   [ ] disk OK (app + DB)   [ ] backup task OK, login noted
             [ ] alembic_version = e6f8a0b2c4d6   [ ] zip SHA-256 + size on server OK   [ ] launcher reviewed + hashed
             [ ] shared accounts: ckappuser __ ckpost __ ckassetapp __   [ ] package index reachable, Python 3.13
             [ ] not overlapping 03:00 backup   [ ] ccae7b2 contents OK   [ ] GATE rehearsal READY  [ ] go/no-go signed
D BACKUP     [ ] dump taken + SHA-256   [ ] pg_restore --list + -f NUL exit 0   [ ] 2nd dump copy kept
             [ ] NAS snapshot/copy   [ ] .env copy in evidence
E COPY       [ ] zip hash re-checked after copy   [ ] expanded to releases\ccae7b2 (215 files)   [ ] content hash / manifest OK
F MIGRATE    [ ] final log top-up   [ ] CKAM listener stopped (CKAM only)   [ ] pip install -c constraints exit 0
             [ ] colorama = pinned version   [ ] .env -> ccae7b2, no BOM, C3/C4 re-pass
             [ ] alembic before e6f8a0b2c4d6 -> after c6e8a0b2d4f6 (head), exit 0   [ ] current == heads (GT-F05)
             [ ] fixed deploy template read (branch A exit 1 / branch B exit 3); exit code + STATE line recorded
G START      [ ] launcher has --no-proxy-headers --no-server-header (hash recorded)   [ ] one listener
             [ ] verify_release.ps1 -LocalProcessCheck Require: process check PASS (elevated, on the server)
             [ ] serving release ccae7b2, NAS map OK, no "Refusing to start"
H VERIFY     [ ] health  [ ] app_started ccae7b2/production/db host 10.0.0.205  [ ] head c6e8a0b2d4f6
             [ ] verify_release.ps1 0 FAIL (server + LAN)  [ ] 13 probes 404 (server + LAN)  [ ] docs 404 JSON
             [ ] unknown /api JSON 404  [ ] headers once, no Server: uvicorn  [ ] forged XFF -> 127.0.0.1
             [ ] /assets/<id> + /assets/new 200 + real QR scan (Asset 360 + default "Barcode + QR" label)  [ ] bundle index-Cp5JgQR-.js
             [ ] sign-in + diagnostics: version, production, migrations ok (GT-F05: health alone is NOT enough)
             [ ] Asset list  [ ] PO  [ ] Receive (ledger + audit)  [ ] Move (ledger + audit; the real trigger test)  [ ] ERP sync  [ ] upload/download
                    >>> GATE: approver signs "H passed" — no rotation before this <<<
I ROTATE     [ ] JWT (old token 401, fresh sign-in OK)  [ ] ckassetapp (app + backup OK)
             [ ] NAS (or n/a: shared -> EXT-43)  [ ] ERP (or n/a: shared)
J RE-VERIFY  [ ] restart  [ ] H1/H2/H4/H5/H9/H13 again  [ ] backup run OK  [ ] all .env.pre-* deleted (dumps/logs/releases kept)
K COMPROMISE [ ] log hunt  [ ] audit_log review  [ ] DB/NAS/Windows/router checks  [ ] decision + gaps written
L RECORDS    [ ] change record complete  [ ] incident record complete  [ ] evidence off-server  [ ] signed
M HARDENING  [ ] HTTPS / 3211 exposure / service account / role split / backups dates agreed
N PUSH (AFTER VERIFICATION)  [ ] option chosen (A/B/C)  [ ] owner push phrase for this change  [ ] no force-push
```

---

## DO NOT

- **Do not rotate any secret before step H has passed.** While IF-01 is open, a new secret can be read the same way.
- **Do not push before the deploy is verified** (step N), unless the owner explicitly chose option B or C in
  `CKAM_GITHUB_PUBLIC_REPO_OPTIONS.md`. The repository is public.
- **Do not start any new code before F4 succeeds**, and do not start `3b5e842` after F4 succeeds without the
  owner's rollback decision. On the new schema it can still receive but cannot move, repair, sell or scrap (users
  get a misleading 422, GT-F01), and it reopens IF-01.
- **Do not use the deploy template without reading it.** The `ccae7b2` template is fixed: after the migrations
  start it never restarts `3b5e842` (exit 3, `CKAM-Web` stopped). Before the migrations it does restore and restart
  the previous release itself (exit 1). It has only been dry-run, never run on a server.
  Watch the script; stop `CKAM-Web` if `3b5e842` starts after a successful migration.
- **Do not accept `/api/health` + `verify_release.ps1` alone as proof of a good deploy** (GT-F05): also
  `alembic current` = heads, no `head_mismatch` at start, and a real sign-in.
- **Do not run `alembic downgrade` and do not restore a dump automatically or on your own initiative.** Both are owner
  decisions (`CKAM_PRODUCTION_ROLLBACK_STRATEGY.md`).
- **Do not delete any release folder** (`releases\ccae7b2` is linked by the editable install; `releases\3b5e842`
  and the older ones are the rollback path), the database dumps, or the log copies.
- **Do not deploy if `DATABASE_URL` is missing.** The app would silently use the development address.
- **Do not touch 10.0.1.12** (retired). Never start, enable or deploy anything there.
- **Do not touch other apps on the shared servers.** Do not change `ckappuser`, `ckpost` or `ckassetapp` if they
  are shared (EXT-43 / a joint change instead).
- **Do not paste any secret into chat, e-mail, a ticket, a screenshot or an AI tool.** Do not print `shared\.env`.
- **Do not set `COOKIE_SECURE=true` or change `BASE_URL` to https** until HTTPS is actually live.
- **Do not close, open or restrict port 3211 or the router forward** as part of this runbook. That is the owner's
  separate decision.
- **Do not kill a process on port 3211 unless it is CKAM's** (`app.main:app` under `shared\venv`).
- **Do not add `--workers` or `--proxy-headers`** to the uvicorn line.

---

**Reminder:** every step here is **PREPARED — OWNER APPROVAL PENDING**, and every command is `NOT EXECUTED`.
Until this runbook has actually been executed on the servers, with the owner's explicit deploy request, and every H
check has passed, **PRODUCTION REMAINS NOT REMEDIATED.**
