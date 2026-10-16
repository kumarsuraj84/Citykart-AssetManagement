# 07 — CKAM Backup and Restore Policy

| | |
|---|---|
| Document | CKAM-ISMS-07, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Most rules below are targets; see §7 |
| Owner (proposed) | IT / Infra (backups, copies, restore drills); CKAM System Owner (accepts the drill result) |
| Approver | Management |
| Review | Yearly; after every failed backup or restore drill |
| Maps to | ISO A.5.33, A.5.37, A.7.10, A.8.10, A.8.13; SOC 2 A1.2, A1.3, CC7.5; EXT-08 |

## 1. What exists today (facts)

| Item | Today |
|---|---|
| Database dump | Task `CK_Backup_CKASSETMANAGEMENT` on 10.0.0.205, daily 03:00, shared script `C:\ProgramData\CKBackup\backup-db.ps1`, output `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`, 30 days kept, `backup.log` beside it |
| Copy off the database server | **None** (IF-08) |
| Encryption | **None** |
| NAS documents (`CKASSETMANAGEMENT_DATA`) | Backup **NOT EVIDENCED** |
| Restore test in production | **Never** (a dev restore drill into a throw-away database was done in AM-09) |
| Before each deploy | A dump is taken and its name kept (e.g. `ckassetmanagement_20261014_141205.dump`) |

## 2. What must be backed up

| Data | Why | How often | Keep |
|---|---|---|---|
| Database `ckassetmanagement` | The asset register, history, audit trail | Daily, and before every deploy | 30 daily + 12 monthly (proposal) |
| NAS folder `CKASSETMANAGEMENT_DATA` | Uploaded invoices and documents | Daily | Same as the database |
| `shared\.env`, `shared\nas.pw` | Needed to start CKAM | On every change | **Not** in the backup folder: values live in the password manager (EXT-23) |
| Release folders `releases\<sha>\` | Can be rebuilt from git | — | Last 5 kept on the server for rollback |
| Launcher and release script | Needed to rebuild the server | On every change | In git once EXT-13 is done |

## 3. Rules

1. **3-2-1:** at least three copies, on two kinds of storage, one **off the database server**; plus one copy that
   a compromised server account cannot delete (offline or immutable) against ransomware.
2. **Encrypt** every copy that leaves 10.0.0.205 (AES-256 archive or a backup tool with encryption); the key is in
   the password manager with two named people. A backup without its key is lost.
3. **Watch it:** the daily result in `backup.log` and the off-server copy log are checked every working day, or an
   alert is sent on failure (EXT-22).
4. **Restore drill every quarter:** restore the latest dump into a **throw-away** database on a non-production
   server (never over `ckassetmanagement`, never on the shared production cluster without a new name), check the
   Alembic version and row counts of key tables (`asset`, `asset_event`, `audit_log`, `asset_user`), open three
   documents from the NAS copy, and write the time it took. That time is the measured recovery time for doc 08.
5. **Before every deploy** take and name a dump (doc 04 step 9).
6. **Old copies** are deleted by the retention schedule; disks that held dumps are wiped before reuse or disposal.
7. **Dev PC:** the dev `backups\` folder holds dumps with a copy of real ERP data; it is limited to the developer and
   Administrators, the disk is encrypted, and old dumps are removed (IF-09, EXT-10).

## 4. Roles

IT runs the backups, copies and drills; the CKAM System Owner reads and accepts each drill record; the ISMS Lead
checks that four drills happened each year.

## 5. Evidence this policy would produce

`backup.log`, off-server copy log, NAS backup log, quarterly restore records
(`templates/restore_test_record.md`), key-holder list (names only).

## 6. Related decisions

Retention of `audit_log` (SD-09) and of system logs (SD-15) does not change the backup rules; a restored database
contains every audit row that existed at dump time.

## 7. What this does NOT yet prove

* No off-server, encrypted or immutable copy exists; NAS document backup is not evidenced.
* No production restore has ever been tested, so the recovery time is unknown.
* The 30-daily + 12-monthly retention is a proposal; today 30 days are kept.
