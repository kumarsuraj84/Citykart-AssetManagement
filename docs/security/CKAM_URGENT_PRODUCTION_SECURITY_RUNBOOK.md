# CKAM Urgent Production Security Runbook (IF-01 release, secret rotation, compromise check)

| | |
|---|---|
| Date | 2026-10-16 (prepared during the security closure programme, WP-D1) |
| Status | **PREPARED, NOT DONE.** Nothing in this document has been run on any server. **PRODUCTION REMAINS NOT REMEDIATED** until the security release is pushed (owner approval), deployed (a separate, explicit owner request), and verified with the checks in Phase 7, and the secrets are rotated (Phases 8-11) |
| Production today | 10.0.1.98 runs release `3b5e842`, which still has IF-01 (anyone who can reach port 3211 can read any file on the server, including `shared\.env` and `shared\nas.pw`) |
| Applies to | App server **10.0.1.98** (`D:\Citykart_Applications\Citykart_AssetManagement_App`, task `CKAM-Web`, port 3211), database server **10.0.0.205** (PostgreSQL 18, database `ckassetmanagement`), NAS **10.0.0.25** (`\\10.0.0.25\ckapplications_data\CKASSETMANAGEMENT_DATA`), ERP warehouse 10.0.1.69 (password change only, by the ERP owner) |
| Never applies to | **10.0.1.12 (retired; must stay dead)**. Spinwheel and Citykart Desk folders, tasks, databases, roles, NAS folders and config on the shared servers |
| Sources | `CKAM_EXTERNAL_SECURITY_ACTIONS.md` (EXT-01, 02, 03, 38, 39, 41-43), `CKAM_SECURITY_REMEDIATION_REPORT.md` §5, `CKAM_SECURITY_CLOSURE_REGISTER.md`, `docs/ai/PRODUCTION_INFRASTRUCTURE.md`, `docs/ai/LOGGING_AND_DIAGNOSTICS.md`, `CKAM_SECURITY_BASELINE.md` §11 |
| Scripts | Secret-free reference scripts are being written under `ops/windows/` (launcher `ops/windows/run_ckam_web.ps1` and the release script; see that folder for exact names). This runbook says **what** must happen and **how to check it**; it does not repeat those scripts |

## In plain words

The live CKAM server has a hole (IF-01): a stranger can ask it for any file and get it, including the file that
holds the database password and the key that signs logins. The fix is ready on the development PC but is not on
the server. This runbook is the order to follow on the day of the fix:

1. Check the server is ready (precheck).
2. Push the code (only with the owner's approval).
3. Take a backup.
4. Update the database structure.
5. Put the new release in place.
6. Start it with the safe setting.
7. Prove the hole is closed.
8. Only **then** change every password and key the hole could have exposed (changing them earlier is wasted,
   because the open hole would leak the new ones too).
9. Look for signs that someone used the hole before it was closed.

Simple example: if a burglar has a copy of your house key because the back door was open, you first close the back
door, then change the locks. Changing the locks while the back door is still open does not help.

## Rules for everyone using this runbook

- **Secrets are never written down here, never pasted into chat, e-mail, tickets, screenshots or AI tools.** Where a
  secret is needed this document says `<TYPED-ON-SERVER>`. The owner types every database-superuser, NAS and ERP
  password on the server himself (`CLAUDE.md`).
- Every command below is **text to read and adapt**, not something any assistant has run. Run PowerShell as
  Administrator on the named server. The established pattern on these servers: put multi-line PowerShell in a
  `.ps1` file and run it with `powershell -NoProfile -ExecutionPolicy Bypass -File <file>.ps1`; in Windows
  PowerShell 5.1 use `$ErrorActionPreference = 'Continue'` around `pip`/`alembic` (their INFO lines go to stderr) and
  check `$LASTEXITCODE` after each native command.
- Scripts that print the content of `shared\.env` are forbidden. Only the **allow-listed non-secret keys** below may be
  printed: `ENVIRONMENT_NAME`, `APP_VERSION`, `FRONTEND_DIST_DIR`, `LOG_DIR`, `UPLOAD_DIR`, `BASE_URL`,
  `COOKIE_SECURE`, `TRUSTED_PROXIES`, `PO_SOURCE_HOST`, `PO_SOURCE_PORT`, `PO_SOURCE_DB`, `PO_SOURCE_USER`. Never
  print `DATABASE_URL`, `JWT_SECRET`, `PO_SOURCE_PASSWORD` or `nas.pw`.
- Touch only CKAM's own folder, task `CKAM-Web`, firewall rule `CKAM-Web`, database `ckassetmanagement`, CKAM's
  roles, backup task `CK_Backup_CKASSETMANAGEMENT` and NAS folder `CKASSETMANAGEMENT_DATA`.
- Keep evidence in an **admin-only evidence folder** chosen in Phase 1 (`<EVIDENCE-DIR>`), never inside a
  `releases\` folder, and copy it off the server at the end (EXT-41).

### Placeholders

| Placeholder | Meaning |
|---|---|
| `<ROOT>` | `D:\Citykart_Applications\Citykart_AssetManagement_App` on 10.0.1.98 |
| `<RELEASE-SHA>` | The approved security release commit (short sha). It must contain `3e134c1` (IF-01 fix) and the other security commits up to `a3e8fce`, plus the closure commits the lead lists in the change record |
| `<PREVIOUS-SHA>` | The release live before the deploy (today `3b5e842`; confirm in Phase 1) |
| `<EVIDENCE-DIR>` | Admin-only folder for this change, e.g. a new folder under `<ROOT>\backup\` with Administrators-only rights |
| `<PG-BIN>` | PostgreSQL 18 client folder on 10.0.0.205 (usually `C:\Program Files\PostgreSQL\18\bin`; confirm) |
| `<BACKUP-DIR>` | `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP` on 10.0.0.205 |
| `<TYPED-ON-SERVER>` | A secret the owner types at a prompt on the server. Never in a file in git, never in chat |

### Who does what

| Role | Who (fill in) | Does |
|---|---|---|
| APPROVER | CKAM owner / management | Approves the push, the deploy and the window; signs the change record (EXT-35) |
| IT | Operator with Administrator access to 10.0.1.98 | Phases 1, 3 (files), 4-8, 12; edits `shared\.env` |
| DBA | The owner on 10.0.0.205 (types the `postgres` password) | Phase 3 (database backup), Phase 9 |
| NAS-ADMIN | Whoever administers 10.0.0.25 (the owner types the NAS password) | Phase 10 |
| ERP-OWNER | Owner of the ERP warehouse on 10.0.1.69 | Phase 11 |
| SEC | Security reviewer (may be the owner) | Phase 13, incident record |
| DEV | Developer on the dev PC 10.0.0.47 | Phase 2 (push after approval), release package, closure migration list |

---

## Phase 1 - PRECHECK (before the window; no change to anything)

**Purpose (plain words):** make sure the new code will start on the first try, that a backup can be taken, and that
everyone who must approve has approved. The new code refuses to start in production with a weak login key, so this
check prevents a failed deploy that would leave the hole open longer.

**Prerequisites:** Administrator session on 10.0.1.98 and 10.0.0.205; a maintenance window agreed; the change record
started (EXT-35).

**Steps (IT unless noted):**

1. **Which release is live now.** Read the non-secret release switch and the launcher log; do not print other values:

   ```powershell
   $root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
   $allow = 'ENVIRONMENT_NAME','APP_VERSION','FRONTEND_DIST_DIR','LOG_DIR','UPLOAD_DIR','BASE_URL','COOKIE_SECURE','TRUSTED_PROXIES','PO_SOURCE_HOST','PO_SOURCE_PORT','PO_SOURCE_DB','PO_SOURCE_USER'
   Get-Content "$root\shared\.env" | ForEach-Object {
     if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
       if ($allow -contains $matches[1]) { '{0}={1}' -f $matches[1], $matches[2].Trim() }
       else { '{0}=<hidden, length {1}>' -f $matches[1], $matches[2].Trim().Length }
     }
   }
   Get-ChildItem "$root\logs" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, LastWriteTime
   Select-String -Path (Get-ChildItem "$root\logs" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName -Pattern 'serving release' | Select-Object -Last 1
   ```

   Expected: `ENVIRONMENT_NAME=production`, `APP_VERSION=3b5e842`, `FRONTEND_DIST_DIR=<ROOT>\releases\3b5e842\frontend-dist`,
   `LOG_DIR=<ROOT>\logs\app`. Write `<PREVIOUS-SHA>` into the change record.

2. **`ENVIRONMENT_NAME=production`** is shown by step 1. If it is missing or different, the app still treats any
   name outside `development, dev, test, testing, uat, security-test, local, ci` as production (N4), but set it to
   `production` exactly so logs and diagnostics are clear.

3. **`JWT_SECRET` strength without printing it.** The new code refuses to start if the stripped value is a known
   placeholder, shorter than 32 characters, or has fewer than 8 different characters:

   ```powershell
   $line = Get-Content "$root\shared\.env" | Where-Object { $_ -match '^\s*JWT_SECRET\s*=' }
   "JWT_SECRET lines found: $(@($line).Count)   (must be exactly 1)"
   $v = (@($line)[0] -replace '^\s*JWT_SECRET\s*=\s*', '').Trim().Trim('"').Trim("'").Trim()
   $set = New-Object 'System.Collections.Generic.HashSet[char]'
   foreach ($c in $v.ToCharArray()) { [void]$set.Add($c) }
   'length >= 32: {0}; distinct >= 8: {1}; placeholder: {2}' -f ($v.Length -ge 32), ($set.Count -ge 8), ($v -in @('dev_secret_change_me','change_me_too','change_me'))
   Remove-Variable v, line, set
   ```

   Expected: `True; True; False`. If not, the JWT secret must be replaced **during** the deploy (Phase 5 step 4)
   instead of only afterwards; note it in the change record.

4. **Disk space.** On 10.0.1.98 `Get-PSDrive D` (need at least the size of one release plus the venv packages,
   in practice a few hundred MB, and room for the log copy of step 7). On 10.0.0.205 `Get-PSDrive E` (room for one
   more dump; compare with the newest file in `<BACKUP-DIR>`).

5. **The backup task works (DBA, 10.0.0.205).** Read-only check of the last run:

   ```powershell
   Get-ScheduledTaskInfo -TaskName 'CK_Backup_CKASSETMANAGEMENT' | Select-Object LastRunTime, LastTaskResult, NextRunTime
   Get-Content 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP\backup.log' -Tail 10
   Get-ChildItem 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, Length, LastWriteTime
   ```

   Expected: `LastTaskResult 0`, a recent `OK` line, a non-empty dump from the last night.
   **Also record which database login that backup uses** (look only at the CKAM part of the task/script; the
   script `C:\ProgramData\CKBackup\backup-db.ps1` is shared with other apps, do not change it). If it connects as
   `ckassetapp`, Phase 9 must also update that stored credential, or the next night's backup fails.

6. **Shared accounts check (blocks Phases 10 and 11 if not answered).** Ask the NAS-ADMIN whether NAS user
   `ckappuser` is used **only** by CKAM, and the ERP-OWNER whether role `ckpost` is used only by CKAM. If either is
   shared with Spinwheel, Citykart Desk or anything else, its password change breaks those apps: do not rotate it in
   this window; follow EXT-43 (a CKAM-only NAS account) or agree a joint change with the ERP-OWNER.

7. **Preserve the logs before anything restarts (EXT-41).** The app's log files rotate by size (20 MB x 10) and the
   deploy restarts the process. Copy them now; they are the main evidence for Phase 13:

   ```powershell
   $ev = '<EVIDENCE-DIR>'
   New-Item -ItemType Directory -Force "$ev\logs-before-deploy" | Out-Null
   robocopy "$root\logs" "$ev\logs-before-deploy" /E /COPY:DAT /R:1 /W:1 /NP /LOG:"$ev\robocopy-logs.txt"
   Get-ChildItem "$ev\logs-before-deploy" -Recurse -File | Get-FileHash -Algorithm SHA256 | Export-Csv "$ev\logs-before-deploy.sha256.csv" -NoTypeInformation
   ```

   robocopy exit codes 0-7 are success. Make `<EVIDENCE-DIR>` Administrators-only first
   (`icacls "<EVIDENCE-DIR>" /inheritance:r /grant:r "Administrators:(OI)(CI)F"`; add `SYSTEM:(OI)(CI)F` only if
   your backup software needs it).

8. **Release contents (DEV, dev PC).** Confirm on the dev PC that `<RELEASE-SHA>` contains the fixes and list the
   migrations it brings:

   ```bash
   git merge-base --is-ancestor 3e134c1 <RELEASE-SHA> && echo "IF-01 fix included"
   git merge-base --is-ancestor a3e8fce <RELEASE-SHA> && echo "N2 Docker flag and comment fix included"
   ls backend/app/alembic/versions/   # compare with the list in Phase 4
   ```

   Also record whether the closure fixes **IF-01-WIN** (Windows path refusal) and **N6** (unknown `/api` -> JSON
   404) are in the release; Phase 7 runs some probes only if they are.

9. **Rehearsal (DEV).** Run `alembic upgrade head` from `3b5e842`'s schema to `<RELEASE-SHA>` on a scratch copy of a
   dev database (never production), as was done for the 2026-10-14 deploy.

10. **Approvals and window.** APPROVER confirms in writing: (a) push approval (Phase 2), (b) deploy approval for
    `<RELEASE-SHA>`, (c) the rotation of the four secrets right after it, (d) the window and the user notice
    ("CKAM will be unavailable for about 30 minutes; afterwards everyone signs in again").

**Verification:** every item above has a written yes/no in the change record; no secret value appears in it.

**Rollback:** nothing was changed (except the evidence copy), so nothing to roll back.

**Evidence to keep:** change record with the 10 answers; `allow-listed .env keys` output (non-secret only); backup
task info; `logs-before-deploy` copy with its SHA-256 list; release-content check output; rehearsal output.

**Stop here if:** the backup task fails, the shared-account answer is unknown for a secret you intend to rotate
(rotate the others), or the release does not contain `3e134c1`.

---

## Phase 2 - APPROVED GIT PUSH (push only)

**Purpose:** put the reviewed security commits on the company repository so the release is traceable.

**Prerequisites:** the owner has said the push phrase for **this** change ("commit and push to git and main").
That phrase means push only. It is **not** a deploy approval (`CLAUDE.md`).

**Steps (DEV, dev PC):** `git push origin <local branch>:claude/brave-euler-07879a` (the default branch; no branch
is called `main`), as the owner directed. Do not force-push.

**Verification:** `git ls-remote origin claude/brave-euler-07879a` shows `<RELEASE-SHA>` (or a descendant).

**Rollback:** none needed; a pushed commit does not change production. Never rewrite pushed history.

**Evidence:** push output (commit range), date, who approved.

---

## Phase 3 - BACKUP (database, files, release folder)

**Purpose:** a way back if anything goes wrong, and proof of the state before the change.

**Prerequisites:** Phase 1 complete; window started; users told.

**Steps:**

1. **Database (DBA, 10.0.0.205).** Run the backup task and wait for it:

   ```powershell
   Start-ScheduledTask -TaskName 'CK_Backup_CKASSETMANAGEMENT'
   do { Start-Sleep 10; $s = (Get-ScheduledTask -TaskName 'CK_Backup_CKASSETMANAGEMENT').State } while ($s -eq 'Running')
   Get-ScheduledTaskInfo -TaskName 'CK_Backup_CKASSETMANAGEMENT' | Select-Object LastRunTime, LastTaskResult
   Get-Content 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP\backup.log' -Tail 5
   $dump = Get-ChildItem 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
   $dump | Select-Object Name, Length, LastWriteTime
   Get-FileHash $dump.FullName -Algorithm SHA256
   ```

2. **Verify the dump is readable (DBA).** Read the whole archive without restoring it anywhere:

   ```powershell
   & '<PG-BIN>\pg_restore.exe' --list $dump.FullName | Select-Object -First 15
   & '<PG-BIN>\pg_restore.exe' -f NUL $dump.FullName ; "pg_restore exit code: $LASTEXITCODE"
   ```

   Expected: the list shows `ckassetmanagement` objects (`asset`, `audit_log`, `alembic_version` ...) and the exit
   code is 0. (`-f NUL` converts the full dump to SQL text and throws it away: it proves every block can be read.
   It does not touch any database.) If the dump is not in custom format, `pg_restore` says so; then check it with
   the method the backup script documents.

3. **Files (NAS-ADMIN or IT).** Make a point-in-time copy of `CKASSETMANAGEMENT_DATA`: a NAS snapshot if the NAS
   supports it, otherwise a `robocopy /E /COPY:DAT` to an admin-only location that is **not** the same folder. The
   deploy does not change documents, so this is a safety copy, not a migration step.

4. **Release folder and settings (IT, 10.0.1.98).** The old release folder `<ROOT>\releases\<PREVIOUS-SHA>` is left
   untouched (it is the code rollback). Copy the settings and launcher:

   ```powershell
   Copy-Item "$root\shared\.env" "<EVIDENCE-DIR>\env.pre-<RELEASE-SHA>"
   Copy-Item "$root\shared\run_ckam_web.ps1" "<EVIDENCE-DIR>\run_ckam_web.pre-<RELEASE-SHA>.ps1"
   Get-FileHash "$root\shared\run_ckam_web.ps1" -Algorithm SHA256
   ```

   The `.env` copy holds the **current (exposed) secrets**: keep it only until Phase 12 is verified, then delete it
   (Phase 12 step 5).

**Verification:** backup task result 0; `backup.log` OK; dump size similar to last night's; `pg_restore` exit 0;
file copy/snapshot exists; settings copies exist in `<EVIDENCE-DIR>`.

**Rollback:** not applicable (read-only for production data).

**Evidence:** dump name, size, SHA-256, `pg_restore --list` head, exit codes; snapshot id or copy log.

---

## Phase 4 - MIGRATION (`alembic upgrade head`, before any new code starts)

**Purpose:** add the database changes the new code needs. New code started on the old schema fails every sign-in
(it reads `asset_user.token_version`).

**Prerequisites:** Phase 3 verified. The release package (built and packaged on the dev PC as on 2026-10-14:
`backend\{app, alembic.ini, pyproject.toml, constraints.txt, scripts\create_owner.py, VERSION}` and
`frontend-dist\`) copied to `<ROOT>\releases\<RELEASE-SHA>\`. Copying files does **not** switch anything.

**Migrations this release must apply, in order (single head):**

| # | Revision | What | Source |
|---|---|---|---|
| 1 | `f9a1c3e5b7d2` | `asset_user.token_version` (sessions end on access change) | security programme |
| 2 | `a3c5e7f9b1d4` | TRUNCATE guards on the four append-only tables; 5-year floor for the audit purge | security programme |
| 3 | `<ADD CLOSURE MIGRATIONS HERE>` | e.g. WP-A2 refresh-token session record (AU-06), WP-B lifecycle-field guard (OBS-STATUS), optional N9. **DEV fills in the exact revision ids and order from `alembic history` of `<RELEASE-SHA>` before the window** | closure programme |

Expected final head: `<FINAL-HEAD>` (DEV fills in; today `a3c5e7f9b1d4` if no closure migration ships).

**Steps (IT, 10.0.1.98):**

1. Stop the service and make sure only CKAM's own listener is stopped (the server is shared):

   ```powershell
   Stop-ScheduledTask -TaskName 'CKAM-Web'
   $pids = (Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
   foreach ($p in $pids) {
     $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
     "PID $p : $($proc.ExecutablePath) : $($proc.CommandLine)"
   }
   ```

   Stop a PID (`Stop-Process -Id <pid> -Force`) **only** if its command line contains `app.main:app` and its
   executable is CKAM's venv or the Python 3.13 interpreter started from it. Never stop another app's process.
   Port 3211 is registered to CKAM in `D:\Citykart_Applications\PORTS.md`.

2. Install the new backend into the CKAM venv with the tested package versions (EXT-12):

   ```powershell
   $ErrorActionPreference = 'Continue'
   $rel = "$root\releases\<RELEASE-SHA>"
   & "$root\shared\venv\Scripts\python.exe" -m pip install -c "$rel\backend\constraints.txt" -e "$rel\backend" 2>&1 | ForEach-Object { "$_" } | Out-File "<EVIDENCE-DIR>\pip-install.txt"
   "pip exit code: $LASTEXITCODE"
   & "$root\shared\venv\Scripts\python.exe" -m pip freeze | Out-File "$rel\pip-freeze.txt"
   ```

   If the constrained install fails on Windows (a pinned version without a Windows wheel), install as on previous
   deploys (without `-c`), record it in the change record, and keep EXT-12 open. Do not let this block the IF-01 fix.

3. Run the migration with the `.env` values loaded into this one process (nothing is printed):

   ```powershell
   Get-Content "$root\shared\.env" | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object {
     $k, $v = $_ -split '=', 2
     [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), 'Process')
   }
   Set-Location "$rel\backend"
   & "$root\shared\venv\Scripts\python.exe" -m alembic current 2>&1 | ForEach-Object { "$_" } | Out-File "<EVIDENCE-DIR>\alembic-before.txt"
   & "$root\shared\venv\Scripts\python.exe" -m alembic upgrade head 2>&1 | ForEach-Object { "$_" } | Out-File "<EVIDENCE-DIR>\alembic-upgrade.txt"
   "alembic exit code: $LASTEXITCODE"
   & "$root\shared\venv\Scripts\python.exe" -m alembic current 2>&1 | ForEach-Object { "$_" } | Out-File "<EVIDENCE-DIR>\alembic-after.txt"
   ```

   It runs as today's app role `ckassetapp`, which owns the tables (needed: creating triggers requires ownership).
   `alembic upgrade head` seeds a bootstrap admin and prints a one-time password **only if no head-office admin
   exists**; production has admins, so none is expected. If one appears, it stays in the admin-only file; never
   copy it into chat or reports.

**Verification:** exit code 0; `alembic-after.txt` shows `<FINAL-HEAD> (head)`; `alembic-upgrade.txt` lists each
expected revision once and no `ERROR`.

**Rollback:** if a migration fails part-way, **do not start any code**. PostgreSQL runs each Alembic migration in a
transaction, so a failed revision leaves the database at the previous revision. Fix and retry, or stay down and
restore the Phase 3 dump into `ckassetmanagement` only on the owner's decision (destructive; DBA). Do not run
`alembic downgrade` against production data. The old release `3b5e842` is **not** a safe fallback (it has IF-01):
if you must fall back, keep the internet forward of 3211 closed (EXT-05) until the fixed release runs.

**Evidence:** `pip-install.txt`, `pip-freeze.txt`, `alembic-before/upgrade/after.txt` (checked for secrets).

---

## Phase 5 - DEPLOY THE SECURITY RELEASE (switch to the exact release folder)

**Purpose:** point CKAM at the new release, so the code that runs is exactly the approved commit.

**Prerequisites:** Phase 4 verified; `CKAM-Web` still stopped.

**Steps (IT):**

1. Confirm the release folder: `<ROOT>\releases\<RELEASE-SHA>\backend\VERSION` contains `<RELEASE-SHA>`, and
   `<ROOT>\releases\<RELEASE-SHA>\frontend-dist\index.html` exists.
2. Edit `shared\.env` (Notepad as Administrator, or the release script from `ops/windows/`): set
   `FRONTEND_DIST_DIR=<ROOT>\releases\<RELEASE-SHA>\frontend-dist` (**the single release switch**: the launcher runs
   the backend from the `backend` folder next to it), `APP_VERSION=<RELEASE-SHA>`, and keep
   `ENVIRONMENT_NAME=production`, `LOG_DIR=<ROOT>\logs\app`. Save as UTF-8 **without BOM** (or ANSI; all values are
   plain ASCII).
3. Check the file without printing secrets:

   ```powershell
   $b = [IO.File]::ReadAllBytes("$root\shared\.env")
   'BOM present: ' + ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)   # must be False
   ```

   and rerun the allow-listed print of Phase 1 step 1.
4. **Only if Phase 1 step 3 failed:** set a new `JWT_SECRET` now with the procedure of Phase 8 (the app would
   otherwise refuse to start). Phase 8 is then still done after Phase 7, so that the final key was never present
   while IF-01 was open.

**Verification:** allow-listed print shows the new `FRONTEND_DIST_DIR` and `APP_VERSION`; BOM False.

**Rollback:** set `FRONTEND_DIST_DIR` and `APP_VERSION` back to `<PREVIOUS-SHA>` and reinstall that backend
(`pip install -e <ROOT>\releases\<PREVIOUS-SHA>\backend`). The new migrations are additive, but `3b5e842` on the
new schema is **not tested** and reopens IF-01: only with the owner's decision and the internet forward closed.

**Evidence:** allow-listed `.env` output before/after; `VERSION` content.

---

## Phase 6 - START WITH `--no-proxy-headers` (EXT-38)

**Purpose:** start the new code, with uvicorn told **not** to believe `X-Forwarded-For` headers (otherwise any
local process on the shared server could fake its address in the audit trail and dodge the sign-in limit, N2).

**Prerequisites:** Phase 5 verified.

**Steps (IT):**

1. Update the launcher `shared\run_ckam_web.ps1` so the uvicorn command contains `--no-proxy-headers`. Compare it
   with the reviewed reference `ops/windows/run_ckam_web.ps1` (secret-free; reads `shared\.env` and `shared\nas.pw`
   at run time) and keep the server copy equal to it apart from documented server-specific paths (EXT-13). Keep
   `TRUSTED_PROXIES` empty (no reverse proxy yet). Save the new launcher's SHA-256.
2. Start: `Start-ScheduledTask -TaskName 'CKAM-Web'`; wait about 20 seconds.
3. Check the process command line:

   ```powershell
   Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*app.main:app*' } | Select-Object ProcessId, CommandLine
   ```

**Verification (expected):**

| Check | Expected |
|---|---|
| Process command line | contains `--no-proxy-headers` and `--port 3211`; exactly one CKAM listener |
| Newest launcher log in `<ROOT>\logs\` | `serving release: <RELEASE-SHA>`; the NAS mapping line succeeded (e.g. `NAS mapping attempt 1: The command completed successfully`) |
| No refusal | no `Refusing to start` line (that means the JWT secret check failed: go to Phase 8 procedure, then restart) |
| `curl.exe -s http://127.0.0.1:3211/api/health` | `{"status":"ok"}` |
| Forged address test: `curl.exe -s -H "X-Forwarded-For: 203.0.113.77" http://127.0.0.1:3211/api/health`, then `Select-String -Path "$root\logs\app\app.jsonl" -Pattern '203.0.113.77'` | **no** access line carries `"ip": "203.0.113.77"`; the line for that request shows `127.0.0.1` |

**Rollback:** stop the task, restore the launcher copy from `<EVIDENCE-DIR>`, and see Phase 5 rollback.

**Evidence:** launcher SHA-256 before/after, process command line, the log lines above, forged-address result.

---

## Phase 7 - VERIFY IF-01 IS CLOSED (including Windows path forms)

**Purpose:** confirm, on the real Windows server, that the file-read hole is closed and that the other protections
are on. This is the only proof that counts for production. Every probe below must come back `404`; a `200` on any
of them means the hole is still open and the deploy has failed.

**Prerequisites:** Phase 6 verified. Run the set once from the server itself against `http://127.0.0.1:3211` and
once from a LAN PC against `http://10.0.1.98:3211`. Use `curl.exe` (in Windows PowerShell 5.1 the name `curl` is an
alias for a different command) with the `--path-as-is` option so curl sends the path unchanged, and discard the
body with `-o NUL` so that, if a probe ever did succeed, no file content is shown. Record only the **status code**
for each path.

**The verification list** (each is a defensive confirmation that the request is refused). The IF-01-WIN and
`C:...` / UNC / reserved-name forms are only meaningful once the closure fix IF-01-WIN is in the release (Phase 1
step 8); if it is not, mark those rows "not applicable to this release" and run the Windows-form probes only after a
later release that includes it.

| # | Path requested (sent with `--path-as-is`) | Targets | Expected |
|---|---|---|---|
| 1 | `/assets/..%2f..%2f..%2f..%2fshared%2f.env` | the settings file | `404` |
| 2 | `/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw` | the NAS password file | `404` |
| 3 | `/assets/..%2f..%2f..%2f..%2fshared%2frun_ckam_web.ps1` | the launcher | `404` |
| 4 | `/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fshared%2f.env` | double-escaped dots | `404` |
| 5 | `/assets/..%5c..%5c..%5c..%5cshared%5c.env` | Windows back-slash form (`..%5c`) | `404` |
| 6 | `/assets/%2e%2e%5c%2e%2e%5cshared%5c.env` | mixed back-slash form (`%2e%2e%5c`) | `404` |
| 7 | `/assets/C:%2fWindows%2fwin.ini` | an absolute drive path | `404` |
| 8 | `/assets/%5c%5cserver%5cshare%5cx` | a UNC path (must not trigger any outbound lookup) | `404` |
| 9 | `/assets/CON` and `/assets/NUL` | reserved Windows device names | `404` |

A short loop that records the status codes (no body saved):

```powershell
$B = 'http://127.0.0.1:3211'
$paths = Get-Content '<EVIDENCE-DIR>\if01_paths.txt'   # one path from the table per line
$rows = foreach ($p in $paths) {
  $code = & curl.exe -s -o NUL -w '%{http_code}' --path-as-is "$B$p"
  [pscustomobject]@{ path = $p; status = $code }
}
$rows | Tee-Object -Variable r | Format-Table -Auto
$r | Export-Csv '<EVIDENCE-DIR>\if01_probe_results.csv' -NoTypeInformation
"Any non-404: " + (@($r | Where-Object { $_.status -ne '404' }).Count)
```

Expected: every `status` is `404`; the "Any non-404" count is `0`. Put the nine paths (exactly as written in the
table) into `<EVIDENCE-DIR>\if01_paths.txt` beforehand.

**Other protections to confirm in the same session:**

| Check | Command (status only) | Expected |
|---|---|---|
| Unknown `/api` path returns JSON 404, not the SPA shell (N6; needs the closure fix) | `curl.exe -s -o NUL -w '%{http_code}' "$B/api/does-not-exist"` and `curl.exe -s "$B/api/does-not-exist"` | `404`; body is a JSON envelope with a `request_id`, not HTML. If the closure fix is not in the release, this returns the SPA shell with `200`; note it and track N6 |
| API docs closed in production (IF-14) | `curl.exe -s -o NUL -w '%{http_code}' "$B/openapi.json"` (also `/docs`, `/redoc`) | `404` |
| Security headers present exactly once | `curl.exe -s -D - -o NUL "$B/api/health"` | one `Content-Security-Policy`, one `X-Content-Type-Options: nosniff`, one `X-Frame-Options`, one `Referrer-Policy`, one `Permissions-Policy`; `Cache-Control: no-store` on the `/api/` response. No header appears twice |
| Release id in diagnostics | sign in as a head-office admin in a browser, open `GET /api/admin/diagnostics/health` | `version` = `<RELEASE-SHA>`, `environment` = `production`, `migrations.ok` = true (head `<FINAL-HEAD>`) |
| `app_started` event | the newest `system_event` in `logs\app\app.jsonl` (or `GET /api/admin/logs/system?event=app_started`) | shows `<RELEASE-SHA>` and `environment=production` |

**Functional smoke test (prove normal use still works):** sign in with a real head-office-admin account; the
dashboard loads with real numbers; the Asset Register opens and a search returns rows; open one asset's detail
(Overview / History / Changes tabs render). Then one **receive** and one **move** on a test asset (or, if production
has no business data yet, create one asset, receive it, move it): both succeed and each writes one `asset_event`
and one `audit_log` row (`GET /api/admin/logs/audit?category=LIFECYCLE`). This confirms the append-only ledger and
the new migrations did not break the write path.

**Verification:** `if01_probe_results.csv` is all `404`; LAN run also all `404`; headers appear once; diagnostics
show `<RELEASE-SHA>` + `production`; the receive/move smoke test wrote its ledger and audit rows.

**Rollback:** if any probe returns `200`, or sign-in fails, the deploy has failed. Stop `CKAM-Web` immediately, keep
the internet forward of 3211 closed (EXT-05), and follow the Phase 5 / Phase 4 rollback. Do not proceed to secret
rotation.

**Evidence:** `if01_probe_results.csv` (server and LAN), header dump, diagnostics JSON (with version), the
`app_started` event line, the smoke-test audit rows' ids.

> **Gate:** do not start Phases 8-11 until Phase 7 passes. Until then **PRODUCTION REMAINS NOT REMEDIATED**.

---

## Phase 8 - ROTATE THE JWT SECRET (everyone is signed out)

**Purpose:** replace the key that signs logins. If anyone copied it through IF-01, a copy lets them sign in as
anyone, forever, with no password and no LOGIN row in the audit trail. Replacing it makes any copy useless.

**Why after the fix, never before:** while IF-01 was open, the new key could be read the same way as the old one.
Rotating before Phase 7 passes is wasted effort.

**Effect users see:** every signed-in person is signed out and signs in again. Nothing else breaks.

**Prerequisites:** Phase 7 passed.

**Steps (IT; the owner types the value):**

1. Generate a strong value **on the server**, at least 32 characters with at least 8 different characters (the app
   refuses anything weaker). For example, in the CKAM venv:
   `& "$root\shared\venv\Scripts\python.exe" -c "import secrets; print(secrets.token_hex(32))"` (64 hex characters).
   The owner may generate it any way he likes; it must not equal any dev value and must not be written into git,
   chat or a ticket.
2. Set `JWT_SECRET=<TYPED-ON-SERVER>` in `shared\.env` (one `JWT_SECRET` line only; UTF-8 without BOM). Verify with
   the Phase 1 step 3 strength check (expected `True; True; False`) without printing the value.
3. Restart: `Stop-ScheduledTask -TaskName 'CKAM-Web'`; `Start-ScheduledTask -TaskName 'CKAM-Web'`.

**Verification:** the launcher log shows a normal start (no `Refusing to start`); `GET /api/health` ok; an access
token issued **before** the restart is now rejected with `401` (a browser session from before is signed out on its
next request); a fresh sign-in works.

**Rollback:** if the app refuses to start, the new value is too weak (fix it) or has a stray quote/space. The
previous value is in `<EVIDENCE-DIR>\env.pre-<RELEASE-SHA>`; restoring it re-exposes a possibly-copied key, so only
as a last resort to restore service, and rotate again at once.

**Evidence:** a dated rotation note (which secret, when, who; never the value); the `401`-on-old-token result.

---

## Phase 9 - ROTATE THE DATABASE PASSWORD (`ckassetapp`)

**Purpose:** replace the password of the database login the app uses, in case IF-01 exposed it through
`shared\.env`.

**Prerequisites:** Phase 8 done. The owner is on 10.0.0.205 and will type the `postgres` superuser password and the
new `ckassetapp` password. Phase 1 step 5 told you whether the nightly backup task also logs in as `ckassetapp`.

**Steps:**

1. **DBA, 10.0.0.205:** as the `postgres` superuser, change only CKAM's role (touch no Spinwheel/Citykart Desk
   role):

   ```
   -- run in psql connected to the server as postgres; type the password at the prompt
   \password ckassetapp
   ```

   (`\password` sends the new password as a hash and never writes it to the SQL log. Avoid a plain
   `ALTER ROLE ... PASSWORD '...'`, which can land in the server log.)
2. **IT, 10.0.1.98:** update `DATABASE_URL` in `shared\.env` to use the new password (owner types it). Keep the
   same host, port, database and role. UTF-8 without BOM.
3. If the backup task connects as `ckassetapp` (Phase 1 step 5), update **only** the CKAM backup's stored
   credential (a `.pgpass` entry or the task's own parameter; not the shared script). If it uses a different login,
   leave it.
4. Restart `CKAM-Web`.

**Verification:** the app starts; `GET /api/admin/diagnostics/health` shows the database connected; a sign-in and a
read work; run the backup task once (Phase 3 step 1) and confirm it still succeeds with the new credential; the
launcher log shows no database-auth error.

**Rollback:** the old `DATABASE_URL` is in `<EVIDENCE-DIR>\env.pre-<RELEASE-SHA>`; and the owner can re-set the old
password with `\password`. Service first, then re-rotate.

**Evidence:** dated rotation note; diagnostics "connected" true; a successful post-rotation backup log line.

---

## Phase 10 - ROTATE THE NAS PASSWORD (`ckappuser`)

**Purpose:** replace the NAS password (uploads/downloads of documents), in case `shared\nas.pw` was exposed.

**Prerequisites:** Phase 1 step 6 confirmed `ckappuser` is **CKAM-only**. If it is shared, **do not** change it
here: follow EXT-43 (give CKAM its own NAS account) and skip this phase, noting it in the change record.

**Steps:**

1. **NAS-ADMIN, 10.0.0.25:** change the password of NAS user `ckappuser` (owner types the new value).
2. **IT, 10.0.1.98:** update `shared\nas.pw` with the new value (Administrators/SYSTEM only; owner types it). If the
   server also stores the credential with `cmdkey`, update that entry for `\\10.0.0.25` too, then remove any stale
   mapping (`net use \\10.0.0.25\ckapplications_data /delete` before the next run) so the launcher re-maps with the
   new password.
3. Restart `CKAM-Web` so the launcher logs in to the NAS again.

**Verification:** the launcher log shows the NAS mapping line succeeded on the next start; upload one small test
document through CKAM and download it again; both work. (Delete the test document afterwards through the app only.)

**Rollback:** the NAS-ADMIN can restore the old password and `shared\nas.pw` from `<EVIDENCE-DIR>`; the old
`nas.pw` is in the `.env`/secret copy only if you copied it in Phase 3 (if not, the NAS-ADMIN resets it). Service
first, then re-rotate.

**Evidence:** dated rotation note; the successful NAS mapping log line; the upload/download test result.

---

## Phase 11 - ROTATE THE ERP PASSWORD (`ckpost`)

**Purpose:** replace the read-only ERP warehouse password, in case `PO_SOURCE_PASSWORD` was exposed. CKAM only
reads the ERP; this does not change ERP data.

**Prerequisites:** Phase 1 step 6 confirmed `ckpost` (or the actual `PO_SOURCE_USER`) is CKAM-only or the ERP-OWNER
agreed to a joint change. **Coordinate with the ERP-OWNER** on 10.0.1.69 — this login belongs to the ERP system.

**Steps:**

1. **ERP-OWNER, 10.0.1.69:** change the password of the ERP read-only role CKAM uses (owner/ERP-OWNER types it).
2. **IT, 10.0.1.98:** update `PO_SOURCE_PASSWORD` in `shared\.env` (owner types it). Restart `CKAM-Web`.

**Verification:** after restart, the ERP copy runs: a `system_event` `sync_success` appears (or
`GET /api/admin/diagnostics/health` shows a recent ERP copy). The ERP screens show data, not "not set up". (Note:
the ERP link briefly blipped during a past deploy when 10.0.1.98 could not reach 10.0.1.69:5432 for a minute, then
recovered — re-check after a minute before assuming a fault.)

**Rollback:** the ERP-OWNER restores the old password; the old `PO_SOURCE_PASSWORD` is in
`<EVIDENCE-DIR>\env.pre-<RELEASE-SHA>`. Until fixed, the ERP screens say "not set up" and nothing else is affected
(it fails safe).

**Evidence:** dated rotation note; the `sync_success` event after rotation.

---

## Phase 12 - RESTART / VERIFY (whole-system check) and clean up old secret copies

**Purpose:** confirm the whole system is healthy after all four rotations, and remove the files that still hold the
old (possibly-copied) secrets.

**Prerequisites:** Phases 8-11 done (or the skipped ones noted).

**Steps (IT):**

1. Final restart of `CKAM-Web` (if not already restarted after Phase 11).
2. Re-run the Phase 7 verification list (all `404`), the header check, and the receive/move smoke test.
3. Sign-in, a report download, an upload, and the dashboard all work.
4. `GET /api/admin/diagnostics/health`: log dir writable, migrations match, recent ERP copy, database latency normal.
5. **Delete the old secret copies now that the new ones are proven:** `<EVIDENCE-DIR>\env.pre-<RELEASE-SHA>`, the
   on-server `shared\.env.pre-<PREVIOUS-SHA>` / `shared\.env.pre-3b5e842` if present, and any other `.env.pre-*`.
   Verify with `Get-ChildItem "$root\shared\.env.pre-*"` returning nothing. Do **not** delete the Phase 3 database
   dump or the `logs-before-deploy` copy — those are evidence with no live secret.

**Verification:** all Phase 7 checks pass again; diagnostics healthy; no `.env.pre-*` file remains.

**Rollback:** not applicable (verification only); if a check fails, treat it as a new incident.

**Evidence:** the re-run probe CSV; diagnostics JSON; a note that old secret copies were deleted (with the
directory listing showing none remain).

---

## Phase 13 - COMPROMISE ASSESSMENT (was IF-01 used before the fix?) — EXT-03

**Purpose:** fixing a hole does not tell you whether someone already came through it. Look for evidence that IF-01
was used against production between 2026-09-30 (when the hole first shipped) and the Phase 6 start time.

**Prerequisites:** the `logs-before-deploy` copy from Phase 1 step 7; access to `audit_log` (head-office admin), the
PostgreSQL log on 10.0.0.205, the NAS access log, and the router/firewall logs.

**What to look at (SEC):**

1. **Access lines in `app.jsonl` (these exist only since 2026-10-14).** In the `logs-before-deploy` copy, look for
   access lines whose `route` or `path` is under `/assets/` and whose `path` contains any of `..`, `%2e`, `%2f`,
   `%5c`, a leading `/`, a drive letter like `C:`, a UNC `\\`, an unusually long name, or a `200` status on an
   `/assets/` path that is not a normal hashed `name-hash.js` / `.css` file:

   ```powershell
   $f = Get-ChildItem '<EVIDENCE-DIR>\logs-before-deploy' -Recurse -Filter 'app*.jsonl'
   Select-String -Path $f.FullName -Pattern '"kind":\s*"access"' |
     Where-Object { $_.Line -match '/assets/' -and $_.Line -match '(\.\.|%2e|%2f|%5c|C:|\\\\\\\\)' } |
     ForEach-Object { $_.Line } | Tee-Object '<EVIDENCE-DIR>\if01_hunt_access.txt'
   ```

   A matching line with status `200` under `/assets/` that is not a hashed bundle is a strong sign the hole was
   used. The audit trail redacts secrets, so even a successful read does not print the secret here, only the request.
2. **Older launcher logs in `logs\`** (before 2026-10-14) for the same `/assets/..` patterns, if those logs contain
   request lines at all (they may not — note that as a gap).
3. **`audit_log` for forged-token use.** A stolen JWT secret lets someone act **without a LOGIN row**. Query (via
   `GET /api/admin/logs/audit`, or SQL on 10.0.0.205):
   - SECURITY actions (`ACCESS_CHANGED`, `PASSWORD_RESET`, `PRIMARY_OWNER_GRANTED`) by head-office-admin or
     Full-Admin accounts from **unfamiliar IP addresses**;
   - DATA/LIFECYCLE actions by an admin whose address never has a matching `LOGIN` row from the same address in the
     same period (a forged token creates no LOGIN row);
   - actions at odd hours (nights/holidays) that no one recognises.
4. **Unexpected new administrators or access grants.** List current head-office admins and recently granted
   Primary-Owner / company-access changes; confirm every one with the owner.
5. **Failed-login spikes / lock-outs.** Many `LOGIN_FAILED` / `LOCKED` rows from one address suggest guessing
   (separate from IF-01, but worth noting).
6. **`audit_log` gaps.** The table is append-only (TRUNCATE/UPDATE/DELETE blocked), so a gap in the `id` sequence or
   a missing expected row is itself suspicious; note any.
7. **PostgreSQL log on 10.0.0.205** for `ckassetapp` connection **attempts from hosts other than 10.0.1.98**
   (`pg_hba` blocks them, but attempts show intent).
8. **NAS access log** for `ckappuser` logins from unexpected hosts.
9. **Router / firewall log** for unusual volumes or sources hitting port 3211 from the internet.
10. **Windows event logs** on 10.0.1.98 (and 10.0.0.205) for unexpected logons or new local accounts in the period.

**If logs are missing or do not cover the whole period** (very likely before 2026-10-14): write that down plainly —
"no access-log evidence exists before 2026-10-14, so use of IF-01 before that date can be neither confirmed nor
ruled out." Do not record "no evidence of use" as "not used."

**If compromise is suspected (any strong sign above):** treat **all** server secrets as burned (the JWT secret,
DB, NAS and ERP passwords — already rotated in Phases 8-11, which is good); additionally review the full user list
and force a password reset for the affected accounts using the head-office-admin **Issue passwords** flow
(`POST /api/asset-users/issue-passwords`) or per-account **Reset Password**, so each gets a one-time password to
change at next sign-in (temporary passwords print once in the API answer only; relay them out of band, never in
chat); notify management at once; open a formal incident (EXT-20) and keep every log export; confirm with legal
counsel whether a CERT-In report is required (EXT-31).

**Verification / deliverable:** a written incident record (this is the first use of EXT-20): the period checked,
each source checked, what was found, and a clear decision — "no evidence of use (within the limits of the available
logs)" or "evidence of use; next steps X, Y, Z."

**Evidence:** `if01_hunt_access.txt`; the audit/log exports (`GET /api/admin/logs/export?kind=audit...`); the
incident record. Keep exports with a SHA-256 and copy them off-server (EXT-41).

---

## Phase 14 - HTTPS / INTERNET-FORWARD PLAN (pointer)

**Purpose:** the server is plain HTTP and reachable from the internet (IF-02, EXT-04/EXT-05). That is a separate,
scheduled piece of work, not part of the urgent fix, but it must not be forgotten.

**Action:** follow `docs/security/CKAM_HTTPS_IMPLEMENTATION_PLAN.md` (HTTPS on 10.0.1.98) and the EXT-05 decision
on the internet port-forward in `CKAM_EXTERNAL_SECURITY_ACTIONS.md`. As an **urgent interim** measure, if nobody
outside the office needs CKAM during the window, ask Infra to close the router forward of TCP 3211 until HTTPS is
in place; this removes internet exposure while the rest is arranged.

**This runbook does not perform HTTPS.** Leave `COOKIE_SECURE=false` and `BASE_URL=http://...` until HTTPS is
actually live (turning `COOKIE_SECURE=true` over plain HTTP silently signs everyone out).

---

## One-page printable CHECKLIST

Fill in `<RELEASE-SHA>`, `<PREVIOUS-SHA>`, `<FINAL-HEAD>`, names, and the window before printing. Tick each line;
write "n/a" with a reason where a phase is skipped. No secret values on this sheet.

```
CKAM URGENT SECURITY DEPLOY — CHECKLIST            Date: __________  Window: __________
Approver: __________   IT: __________   DBA(owner): __________   SEC: __________
Release: <RELEASE-SHA> ______  Previous: <PREVIOUS-SHA> ______  Final migration head: <FINAL-HEAD> ______

PRECHECK (Phase 1)
[ ] Live release recorded (<PREVIOUS-SHA>)              [ ] ENVIRONMENT_NAME=production
[ ] JWT_SECRET strength True;True;False (not printed)   [ ] Disk space OK (app + DB)
[ ] Backup task LastResult 0, backup.log OK             [ ] Shared-account answers (NAS? ERP?) recorded
[ ] Logs copied to evidence + SHA-256 (before deploy)   [ ] Release contains 3e134c1 (+ a3e8fce)
[ ] Closure migrations listed                           [ ] Migration rehearsal on scratch DB OK
[ ] Approvals: push / deploy / rotation / window written

PUSH (Phase 2)      [ ] Owner said the push phrase    [ ] origin shows <RELEASE-SHA>
BACKUP (Phase 3)    [ ] DB dump taken + SHA-256        [ ] pg_restore --list + -f NUL exit 0
                    [ ] NAS snapshot/copy             [ ] .env + launcher copied to evidence
MIGRATION (Phase 4) [ ] CKAM listener stopped (CKAM only)  [ ] pip install -c constraints OK
                    [ ] alembic upgrade head exit 0   [ ] alembic current = <FINAL-HEAD> (head)
DEPLOY (Phase 5)    [ ] FRONTEND_DIST_DIR -> <RELEASE-SHA>  [ ] APP_VERSION=<RELEASE-SHA>  [ ] no BOM
START (Phase 6)     [ ] uvicorn cmd has --no-proxy-headers  [ ] serving release + NAS map OK
                    [ ] /api/health ok               [ ] forged X-Forwarded-For logged as 127.0.0.1
VERIFY IF-01 (Phase 7)
[ ] All 9 traversal probes = 404 (server)   [ ] All = 404 (LAN)   [ ] unknown /api -> JSON 404
[ ] /openapi.json,/docs,/redoc = 404        [ ] security headers once each
[ ] diagnostics version=<RELEASE-SHA>, env=production   [ ] app_started event shows release
[ ] receive + move smoke test wrote ledger + audit rows
        >>> GATE: do not rotate until every Phase 7 box is ticked <<<
ROTATE (do only after Phase 7)
[ ] Phase 8 JWT  — old token now 401, fresh sign-in works
[ ] Phase 9 DB (ckassetapp) — app connected, backup still works
[ ] Phase 10 NAS (ckappuser) — mapping OK, upload+download OK   (or n/a: shared, EXT-43)
[ ] Phase 11 ERP (ckpost) — sync_success after restart          (or n/a: shared)
VERIFY/CLEANUP (Phase 12)
[ ] Phase 7 checks pass again   [ ] diagnostics healthy   [ ] all .env.pre-* deleted (dump/logs kept)
COMPROMISE (Phase 13)
[ ] Access-log hunt done   [ ] audit_log forged-token review   [ ] user list reviewed
[ ] Incident record written (no-evidence / evidence+next-steps)   [ ] gaps in logs noted honestly
HTTPS (Phase 14)    [ ] HTTPS plan referenced   [ ] internet-forward (EXT-05) decision noted
Evidence copied off-server (EXT-41): __________    Change record (EXT-35) signed: __________
```

---

## DO NOT

- **Do not rotate any secret before Phase 7 passes.** While IF-01 is open the new secret can be read the same way.
- **Do not touch 10.0.1.12** (retired). Never start, enable or deploy anything there; running both systems splits
  the data.
- **Do not touch other apps on the shared servers.** On 10.0.1.98, 10.0.0.205 and the NAS, change only CKAM's own
  folder, task `CKAM-Web`, firewall rule, database `ckassetmanagement`, CKAM's roles, backup task and NAS folder.
  Do not change `ckappuser` or `ckpost` if they are shared (EXT-43 / joint change instead).
- **Do not paste any secret into chat, e-mail, a ticket, a screenshot or an AI tool.** Use `<TYPED-ON-SERVER>`; the
  owner types values on the server.
- **Do not print `shared\.env`.** Only the allow-listed non-secret keys may be echoed.
- **Do not set `COOKIE_SECURE=true` or change `BASE_URL` to https** until HTTPS is actually live (Phase 14).
- **Do not run `alembic downgrade` against production**, and do not treat the old release `3b5e842` as a safe
  fallback (it has IF-01): if you must fall back, keep the internet forward closed first.
- **Do not delete the Phase 3 database dump or the before-deploy log copy** — they are evidence. Delete only the
  `.env.pre-*` secret copies, and only after Phase 12 verifies the new secrets.
- **Do not kill a process on port 3211 unless its command line is CKAM's** (`app.main:app` under CKAM's venv).

---

**Reminder:** every step here is PREPARED, NOT DONE. Until this runbook has actually been executed on the servers
with the owner's explicit deploy request and all of Phase 7 has passed, **PRODUCTION REMAINS NOT REMEDIATED.**
