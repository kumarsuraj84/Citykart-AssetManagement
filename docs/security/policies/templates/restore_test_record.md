# Restore Test Record (CKAM) — blank form

> DRAFT — MANAGEMENT APPROVAL REQUIRED (form for doc 07). Restore only into a **throw-away** database on a
> non-production server; never over `ckassetmanagement`. Never write a password or key here.

## A. Details

| | |
|---|---|
| Restore test id | RT-YYYY-Qn |
| Date | |
| Performed by | |
| Witness | |
| Backup used (file name, date, size) | |
| Taken from (database server copy / off-server copy / offline copy) | |
| Decryption key retrieved from the password manager by (name; never the key) | |
| Target server and throw-away database name | |

## B. Timing

| Step | Start | End | Minutes |
|---|---|---|---|
| Fetch the copy | | | |
| Decrypt | | | |
| Restore (`pg_restore`) | | | |
| Checks | | | |
| **Total (measured recovery time)** | | | |

## C. Checks

| Check | Expected (from production or the dump date) | Found | OK? |
|---|---|---|---|
| Alembic version (`alembic_version`) | | | |
| Rows in `asset` | | | |
| Rows in `asset_event` | | | |
| Rows in `audit_log` | | | |
| Rows in `asset_user` | | | |
| Append-only triggers present | | | |
| Three documents opened from the NAS backup copy (asset codes) | | | |

## D. Result

| | |
|---|---|
| Result | Pass / Fail |
| Recovery time vs agreed RTO (doc 08) | |
| Problems found | |
| Actions (owner, due date) | |
| Throw-away database dropped (date / time) | |
| Accepted by CKAM System Owner (name, date) | |
