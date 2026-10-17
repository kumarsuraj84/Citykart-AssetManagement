# CKAM Secret Rotation Checklists — after the `<RELEASE-SHA>` security release is verified

| | |
|---|---|
| Status | **PREPARED — OWNER APPROVAL PENDING.** No secret has been rotated. Every command is `NOT EXECUTED`. This document contains **no secret value**. Where one is needed it says `<TYPED-ON-SERVER>` |
| Date | 2026-10-17 **(updated 2026-10-17, security release)**: the release is now the placeholder `<RELEASE-SHA>` (the package is being rebuilt; the earlier candidate `eed3de1` is superseded). No rotation content changed |
| When | Step **I** of `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`, **only after step H (verification) has passed** and the APPROVER has signed "H passed". Rotating earlier is wasted effort: while IF-01 is open, the new value can be read the same way as the old one |
| Order | §1 JWT secret → §2 DB role password (`ckassetapp`) → §3 NAS account password (`ckappuser`) → §4 ERP role password (`ckpost` / the actual `PO_SOURCE_USER`) → step J (restart and verify everything) |
| Why these four | IF-01 could read `shared\.env` (`JWT_SECRET`, `DATABASE_URL` with the `ckassetapp` password, `PO_SOURCE_PASSWORD`) and `shared\nas.pw` on 10.0.1.98, from 2026-09-30 until the old code stopped (step F1) |
| Related | EXT-02 (rotation), EXT-43 (CKAM-only NAS account), EXT-23 (password manager), EXT-25 (ERP role), `CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` case 5 |

## 0. Rules for every rotation

- The **owner types every new value on the server**, or into the password manager (EXT-23). Never in chat, e-mail,
  a ticket, a screenshot, a git file or an AI tool. The change record says only "rotated at <time> by <name>".
- Generate values **on the server** (example in §1) or in the password manager. Every new value must differ from
  every old value and from every development value.
- **Prefer long values made of letters and digits only** (for example 64 hex characters). The CKAM launcher passes
  every `.env` value exactly as written: it does not strip quotes or trailing spaces. `DATABASE_URL` is a URL, so
  `@ : / ? # % [ ]` in a password would have to be percent-encoded. The NAS password is passed to `net use` on a
  command line. A letters-and-digits value avoids all three problems.
- `shared\.env` stays UTF-8 **without BOM**, with exactly one line per key. After each edit, rerun the BOM check and
  the allow-listed print (runbook F3/C1). Never print the file.
- **Rotate a secret only if its shared-account question is answered** (§5). An unanswered or "shared" answer means:
  do not rotate in this window, and record why.
- Do the four rotations in one window if you can. Restart CKAM after each one (or once after a group, as long as
  each validation test below still runs).
- The pre-change copy `<EVIDENCE-DIR>\env.pre-<RELEASE-SHA>` (runbook D5) and `shared\.env.pre-<RELEASE-SHA>` (if
  `deploy_ckam.ps1` was used) hold the **old, possibly copied** values. Use them only as a last-resort service
  restore. Delete them in step J5 once the new values are proven.

---

## 1. JWT signing secret (`JWT_SECRET`)

| Item | Detail |
|---|---|
| Why | Anyone with this key can create login tokens for **any** account, including the head-office admin, without a password and **without a LOGIN row** in the audit trail |
| Who changes it | IT on 10.0.1.98; the owner generates and types the value |
| Where it is stored | `<ROOT>\shared\.env`, key `JWT_SECRET` (one line). Nowhere else. Not used by any other system |
| Rules the app enforces at start (production) | after stripping: not a placeholder (`dev_secret_change_me`, `change_me_too`), **≥ 32 characters**, **≥ 8 different characters**; otherwise "Refusing to start" |
| Services to restart | `CKAM-Web` only |
| Expected side effects | **Everyone is signed out and signs in again.** Every access and refresh token from before is refused, because the signature no longer matches. Open browser tabs show the sign-in page on their next request. Nothing else changes (no data, no passwords) |

Steps (`NOT EXECUTED`):

1. Generate a value on the server, e.g. in the CKAM venv:
   `& "$root\shared\venv\Scripts\python.exe" -c "import secrets; print(secrets.token_hex(32))"` (64 hex characters).
   The owner reads it from the screen and types it into the file. Do not save it in any other file. Close the
   window afterwards.
2. Edit `shared\.env`: `JWT_SECRET=<TYPED-ON-SERVER>` (no quotes, no spaces). Keep exactly one `JWT_SECRET` line.
3. Run the strength check without printing the value (runbook C3). Expected: 1 line, no quotes, `True; True; False`.
4. Restart: `Stop-ScheduledTask -TaskName 'CKAM-Web'`; check that the CKAM listener is gone (runbook F1);
   `Start-ScheduledTask -TaskName 'CKAM-Web'`.

**Validation test:**
- the launcher/err log has no `Refusing to start`; `GET /api/health` is ok;
- the newest `app_started` event shows `jwt_signing_key_is_placeholder: false` and `jwt_signing_key_long_enough: true`;
- an access token issued **before** the restart (e.g. a browser tab left signed in, or a token the tester captured
  for this purpose) is now refused with `401` on an authenticated call such as `GET /api/auth/capabilities` or
  `GET /api/admin/diagnostics/health`;
- a **fresh** sign-in works, and the audit trail shows a new `LOGIN` row.

**Rollback approach:** if the app refuses to start, the new value is too weak or has a stray quote or space. Fix the
value and restart. Do **not** go back to the old value: it may have been copied, and restoring it would re-open a
silent admin backdoor. Only as a last resort for service, and with the owner's decision: restore it from the D5
copy and rotate again at once.

**Evidence to keep:** a rotation note (secret name, date/time, who; **no value**); the strength-check output
(`True; True; False`); the `401` result for the old token; the new `LOGIN` row id.

---

## 2. Database role password (`ckassetapp` on 10.0.0.205)

| Item | Detail |
|---|---|
| Why | `DATABASE_URL` in `shared\.env` holds this password. `pg_hba.conf` is documented to allow `ckassetapp` only from `10.0.1.98/32`, so a stolen copy is directly useful only from that server, or after another network change. It is rotated anyway |
| Shared? | **"Is `ckassetapp` used only by CKAM (and by CKAM's backup)?"** → `OWNER / INFRA CONFIRMATION REQUIRED` (DBA). If another app or job uses it, list them first: every one of them must be updated in the same window |
| Who changes it | DBA on 10.0.0.205 (the owner types the `postgres` superuser password and the new `ckassetapp` password); IT updates the app server |
| Where it is stored | (1) the role in PostgreSQL on 10.0.0.205; (2) `<ROOT>\shared\.env`, key `DATABASE_URL`, password part; (3) **if** the nightly backup `CK_Backup_CKASSETMANAGEMENT` connects as `ckassetapp` (runbook C6): **only the CKAM backup's own stored credential** (a `pgpass` entry or the task's parameter). **Never** change the shared script `C:\ProgramData\CKBackup\backup-db.ps1`; (4) anything else the DBA lists for the question above |
| Services to restart | `CKAM-Web`. The backup task needs no restart, but it must be test-run |
| Expected side effects | CKAM is down for the restart (seconds). Users stay signed in, because JWT tokens do not depend on the DB password. Database connections opened with the old password keep working until they close. That is why the restart matters |

Steps (`NOT EXECUTED`):

1. DBA, 10.0.0.205, as the `postgres` superuser in `psql` (password typed at the prompt). Change only CKAM's role:
   ```
   -- NOT EXECUTED
   \password ckassetapp
   ```
   `\password` sends the new password already hashed and never writes it to the SQL log. Do **not** use a plain
   `ALTER ROLE … PASSWORD '…'`, which can land in the server log.
2. IT, 10.0.1.98: edit `DATABASE_URL` in `shared\.env`. Change only the password part; the host (10.0.0.205), port,
   database (`ckassetmanagement`), role and the `postgresql+asyncpg://` prefix stay the same. If the value contains
   URL-special characters, percent-encode them (another reason to use letters and digits only).
3. Rerun runbook C4 (host check without the password). Expected: `host=10.0.0.205`, `database=ckassetmanagement`.
4. If the backup uses `ckassetapp`: the DBA updates **only** that credential.
5. Restart `CKAM-Web`.

**Validation test:**
- the app starts; `GET /api/admin/diagnostics/health` (head-office admin) shows `database.ok: true`, and the
  `app_started` event shows `database_host: 10.0.0.205`;
- a sign-in and a read (Asset list) work; the err log has no `password authentication failed`;
- run `CK_Backup_CKASSETMANAGEMENT` once (runbook D1) and confirm `LastTaskResult 0`, `backup.log` OK, and a new
  dump. Otherwise tonight's backup would fail silently;
- optionally (DBA, read-only): `SELECT usename, client_addr, application_name, backend_start FROM pg_stat_activity
  WHERE datname = 'ckassetmanagement';` shows only connections from 10.0.1.98 (and the backup host) opened after
  the restart.

**Rollback approach:** the DBA can set the password again with `\password` (to a corrected **new** value, the
preferred choice). Re-setting the **old** value from the D5 copy is a last resort for service only, followed by an
immediate second rotation. **Service first, then re-rotate.**

**Evidence to keep:** a rotation note (role, date/time, who; no value); `database.ok: true` from diagnostics; the
successful post-rotation backup log line.

---

## 3. NAS account password (`ckappuser` on 10.0.0.25)

> ### `OWNER / INFRA CONFIRMATION REQUIRED` — **"Is `ckappuser` used only by CKAM?"**
> - **YES, CKAM only** → rotate it in this window as below.
> - **NO, also used by Spinwheel, Citykart Desk or anything else** → **do not change the shared password.** Changing
>   it would break the other apps' document access. Instead, **create a CKAM-dedicated NAS account during the
>   approved production security stage** (EXT-43). It gets rights only on `CKASSETMANAGEMENT_DATA` (modify), it goes
>   into `shared\nas.pw`, and the launcher's `-NasUser` changes to it (the launcher parameter, or the
>   `run_ckam_web.ps1` default after review). The old shared password then stays as it is, and its owners decide
>   separately whether to rotate it, because the copy in CKAM's `nas.pw` may have been read.
> - **UNKNOWN** → do not rotate. Record "NAS not rotated: shared status unknown" in the change record and the
>   incident record. This is an open risk.

| Item | Detail |
|---|---|
| Why | `shared\nas.pw` holds it. Whoever has it (and network reach to 10.0.0.25) can read and change every CKAM document, and the documents of any other app that uses the same account |
| Who changes it | NAS-ADMIN on 10.0.0.25 (the owner types the new value); IT on 10.0.1.98 updates the file |
| Where it is stored | (1) the NAS user account; (2) `<ROOT>\shared\nas.pw` (Administrators/SYSTEM only; the launcher reads it with `Trim()` at every start); (3) **possibly** a Windows stored credential (`cmdkey`) for `\\10.0.0.25` in the SYSTEM profile, if the live launcher uses that (runbook C9 tells); (4) any other app's config if the account is shared (see the box above) |
| Services to restart | `CKAM-Web` (the launcher maps the share at start). Remove the old mapping first so that the new password is actually used |
| Expected side effects | During the change, uploads and downloads may fail for a minute; the rest of CKAM works. Users stay signed in |

Steps (`NOT EXECUTED`):

1. NAS-ADMIN: change the password of `ckappuser` (or create the CKAM-only account, see the box) to
   `<TYPED-ON-SERVER>`.
2. IT: write the new value into `shared\nas.pw` (one line, no quotes). Keep the file's rights at
   Administrators/SYSTEM only: `icacls "$root\shared\nas.pw"`.
3. If a `cmdkey` entry exists for `\\10.0.0.25`, update it in the same profile the task runs as. Remove the stale
   session before the restart:
   `net use \\10.0.0.25\ckapplications_data /delete` (only CKAM's mapping on 10.0.1.98).
4. Restart `CKAM-Web`.

**Validation test:**
- the newest launcher log shows a NAS mapping line that succeeded (e.g. `NAS mapping attempt 1: The command
  completed successfully`);
- upload one small test document to the owner-chosen test asset through CKAM, then download it again; both work;
- `GET /api/admin/logs/audit?action=DOCUMENT_UPLOADED` shows the upload row.

**Rollback approach:** if mapping fails, check `nas.pw` (stray characters), the `cmdkey` entry and the old mapping.
Re-setting the old password is a last resort for service (owner decision), followed by an immediate second
rotation. With a new CKAM-only account, the fallback is the old mapping. The shared account is never touched.

**Evidence to keep:** a rotation note (account name, date/time, who; no value); the mapping log line; the
upload/download result; for a new account, its NAS rights (`icacls`-style listing from the NAS) and the written
shared/not-shared confirmation (EXT-43).

---

## 4. ERP role password (`ckpost`, the value of `PO_SOURCE_USER`, on 10.0.1.69)

> ### `OWNER / INFRA CONFIRMATION REQUIRED` — **"Is the ERP role (`ckpost`) used only by CKAM?"**
> - **YES** → the ERP-OWNER rotates it as below.
> - **NO** (other reports, other apps, or **the development PC's `.env`** use the same login, IF-09) → agree a
>   **joint change** with the ERP-OWNER: every user of that login is updated in the same window. Or the ERP-OWNER
>   creates a CKAM-only read-only role (EXT-25: read-only, SELECT-only, ideally with TLS) and CKAM switches to it.
> - **UNKNOWN** → do not rotate; record it as an open risk.

| Item | Detail |
|---|---|
| Why | `PO_SOURCE_PASSWORD` in `shared\.env`. CKAM only **reads** the ERP warehouse (read-only transaction), but the role's real rights on 10.0.1.69 are not evidenced (IF-16 / EXT-25) |
| Was it exposed? | Production's ERP copy ran on 2026-10-14 (18,385 PO lines), so the password was set by then. Whether it was set earlier, between 2026-09-30 and 2026-10-14, is `OWNER / INFRA CONFIRMATION REQUIRED`. Treat it as exposed |
| Who changes it | ERP-OWNER on 10.0.1.69 (they type it); IT updates CKAM (the owner types it) |
| Where it is stored | (1) the role on the ERP warehouse; (2) `<ROOT>\shared\.env`, key `PO_SOURCE_PASSWORD`; (3) any other user of the same login (box above), including possibly the dev PC's `.env` |
| Services to restart | `CKAM-Web` (the ERP copy runs at start and every 30 minutes) |
| Expected side effects | Until both sides match, the ERP copy fails and the ERP screens show "not set up" or stale data. Everything else works (it fails safe). No user is signed out |

Steps (`NOT EXECUTED`):

1. ERP-OWNER: change the role's password to `<TYPED-ON-SERVER>`.
2. IT: set `PO_SOURCE_PASSWORD=<TYPED-ON-SERVER>` in `shared\.env` (one line, no quotes). Restart `CKAM-Web`.

**Validation test:**
- after the restart, `GET /api/admin/logs/system?component=erp_sync` shows a new `sync_success` (re-check after a
  minute if the first attempt fails: there was a one-minute network blip once in a past deploy);
- diagnostics health `erp_sync.ok: true`; the `app_started` event shows `erp_login_complete: true`;
- the ERP screens (ERP Articles, PO import) show data.

**Rollback approach:** the ERP-OWNER sets the password again (preferably to a corrected new value). The old value is
in the D5 copy only as a last resort. Until it is fixed, only the ERP screens are affected.

**Evidence to keep:** a rotation note (role, date/time, who on each side; no value); the `sync_success` event after
the rotation; the written shared/not-shared confirmation.

---

## 5. Shared-account questions (answer before step I; also in the go/no-go list)

| Account | Question | Answer | If NO / UNKNOWN |
|---|---|---|---|
| NAS `ckappuser` | **"Is `ckappuser` used only by CKAM?"** | `OWNER / INFRA CONFIRMATION REQUIRED` | Do not change the shared password. Create a **CKAM-dedicated NAS account during the approved production security stage** (EXT-43), and leave the shared account to its owners |
| ERP `ckpost` (`PO_SOURCE_USER`) | "Is the ERP role used only by CKAM (including: not by the dev PC)?" | `OWNER / INFRA CONFIRMATION REQUIRED` | Joint change with the ERP-OWNER, or a CKAM-only read-only role (EXT-25) |
| DB `ckassetapp` | "Is `ckassetapp` used only by CKAM and CKAM's backup? Which credential does the backup use?" | `OWNER / INFRA CONFIRMATION REQUIRED` | Update every listed user in the same window. The later role split (EXT-07/EXT-45) gives CKAM separate owner/migrator/runtime roles anyway |

## 6. After the four rotations (step J)

- One final restart; rerun the runbook H1, H2, H4, H5, H9 and H13 checks.
- Delete the old secret copies (`<EVIDENCE-DIR>\env.pre-<RELEASE-SHA>`, `shared\.env.pre-*`) (runbook J5).
- Store the new values in the password manager with two named custodians (EXT-23), if one exists. Write down only
  **that** they are stored, never the values.
- Rotation notes go into the change record (section E/F) and the incident record (section F "Secrets rotated —
  names only").
