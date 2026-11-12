# CKAM production reset to an empty database — 2026-11-12

| | |
|---|---|
| When | 2026-11-12, 09:01–09:03 IST (CKAM down from about 09:01 to 09:03:31) |
| Approval | The owner typed the exact sentence `DELETE ALL CKAM PRODUCTION DATA` in chat, to set main up again from scratch on the fixed release |
| Release | `89d377b` (deployed earlier the same morning, see `CKAM_PRODUCTION_DEPLOYMENT_RECORD_89d377b.md`); database version `e8a0c2d4f6b8` |
| What was deleted | The whole database `ckassetmanagement`: everything the owner had set up again since the 2026-11-11 reset, including one asset of a set Item added by mistake, the audit trail and logs |
| Safety copy | **`ckassetmanagement_20261112_090136.dump`** (1,643,616 bytes), taken after CKAM was stopped, on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; kept 30 days. Also there: `…_085816.dump` (before the deploy), `…_030001.dump` (nightly) |
| What was not touched | Other databases on the shared server, the ERP, the NAS, the release folders and `shared\.env` |

## Steps (kit: `ops/reset/`)

1. `reset_1_stop.ps1` on the app server: CKAM stopped (the documents folder is on the NAS and could not be counted from the SSH session).
2. Backup (CKAM stopped, so it is the final state).
3. `reset_2_db_drop_create.ps1` on the DB server (10.0.0.205), run **by the owner**, who typed the confirmation and the PostgreSQL superuser password: database dropped and created again empty, same owner `ckassetapp`.
4. `reset_3_rebuild.ps1`: the database was empty (`TABLES 0`), all **45** migrations ran, result `HEAD e8a0c2d4f6b8`, 40 tables, **1** head-office admin, 0 companies, 0 assets, 0 events. The new "Admin" one-time password went to an admin-only file and was **never printed**: `…\backup\reset-20261112_090319\NEW-ADMIN-PASSWORD-READ-THEN-DELETE.txt`.
5. `reset_4_start_verify.ps1`: CKAM healthy in 5 seconds, startup record `89d377b` with `migration.matches true`, first ERP copy `sync_success` (17,635 PO lines, 190 vendors, 1,079 items), stderr empty, unauthenticated `/api/assets` 401.
6. Clean-up: my scripts were deleted from both servers.

## After the reset (the owner)

Read the one-time password in the file above on the app server, sign in as **Admin**, choose a new password, **delete that file**, then set up fresh. The password file from the previous reset (`reset-20261111_145147`) no longer matches anything and should be deleted if still there.
