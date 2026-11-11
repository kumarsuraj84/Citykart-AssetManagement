# CKAM production reset to an empty database — 2026-11-11

| | |
|---|---|
| When | 2026-11-11, 14:26–14:52 IST. CKAM was down from 14:26:50 to 14:52:02 (the owner ran step 2 on the database server in between) |
| Approval | The owner typed the exact sentence `DELETE ALL CKAM PRODUCTION DATA` in chat, after finishing testing on production |
| Release | `7ea352d` (unchanged); database version `e8a0c2d4f6b8` |
| What was deleted | The whole database `ckassetmanagement`: 3 companies, 298 places, 297 stores with their stock rooms and install points, 2 admin logins, 2 vendors, test data, the ERP copy, the audit trail and logs (before the reset it held no assets, POs, history or documents) |
| Safety copy | **`ckassetmanagement_20261111_142705.dump`** (1,834,249 bytes), taken after CKAM was stopped, on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; kept 30 days. An earlier one, `ckassetmanagement_20261111_141509.dump`, is also there |
| What was not touched | Other databases on the shared server, the ERP, the NAS, the release folders and `shared\.env` |

## Steps (kit: `ops/reset/`)

1. `reset_1_stop.ps1` on the app server: CKAM stopped (the documents folder is on the NAS and was not counted from this session; the database held 0 documents).
2. Backup (CKAM stopped, so it is the final state).
3. `reset_2_db_drop_create.ps1` on the DB server (10.0.0.205), run **by the owner**, who typed the confirmation and the PostgreSQL superuser password: the database was dropped and created again empty, same owner `ckassetapp`.
4. `reset_3_rebuild.ps1`: the database was empty (`TABLES 0`), all **45** migrations ran from zero, result `HEAD e8a0c2d4f6b8`, 40 tables, **1** head-office admin, 0 companies, 0 assets, 0 events. The new "Admin" one-time password was written to an admin-only file (Administrators and SYSTEM) and **never printed**.
5. `reset_4_start_verify.ps1`: CKAM healthy in 5 seconds, startup record `7ea352d` with `migration.matches true`, first ERP copy `sync_success` (17,643 PO lines, 190 vendors, 1,079 items), stderr empty, unauthenticated `/api/assets` 401.
6. Clean-up: my scripts were deleted from both servers.

## After the reset (the owner)

Read the one-time password in `…\backup\reset-20261111_145147\NEW-ADMIN-PASSWORD-READ-THEN-DELETE.txt` on the app server, sign in as **Admin**, choose a new password when asked, **delete that file**, then set up fresh (Settings › Organisation › Companies › Add from the ERP; Places; People & Places › Stores › Stores from ERP).

## Restore (only if ever needed)

See `ops/reset/RESET_PRODUCTION_RUNBOOK.md` ("You want the old data back").
