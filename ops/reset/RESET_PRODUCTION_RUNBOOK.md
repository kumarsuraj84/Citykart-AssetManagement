# Reset CKAM production to an empty, fresh start

For when the owner has finished testing on production and wants to start the real data from zero. About 10 minutes, with CKAM
down for most of it. **It deletes every CKAM record** (setup, assets, POs, history, audit trail, logins) and cannot be undone
except from the backup taken just before. It never touches other apps on the shared servers, the ERP, the NAS files, the
release folders or the settings file (`shared\.env`).

**Only run it after the owner types, in chat, the exact sentence `DELETE ALL CKAM PRODUCTION DATA`.** Claude runs steps 1, 3 and 4;
the owner runs step 2 (it needs the PostgreSQL superuser password, which only the owner types, on the database server).

## Before (the owner, once, while testing)

1. **Export what you want to keep**: Settings screens have *Export to Excel* (companies, places, cost centres, vendors, groups, Items).
   Stores, places and companies also come back in a click from the ERP (Settings › Organisation › Add from the ERP; People & Places › Stores ›
   Stores from ERP).
2. **Write down** anything you want to remember from the audit trail or the logs; they are deleted too.
3. Optional dry run of step 2 (changes nothing): `.\reset_2_db_drop_create.ps1 -DryRun` on the database server.

## The four steps

| # | Where / who | What | Expected end of its output |
|---|---|---|---|
| 0 | Claude | Run CKAM's backup task on 10.0.0.205 and read `backup.log` | `OK  ckassetmanagement_<time>.dump` |
| 1 | App server 10.0.1.98, Claude: `reset_1_stop.ps1` | Stops CKAM (only its own process); counts the documents on the NAS (kept) | `listeners on 3211: 0`, `CKAM is STOPPED` |
| 2 | **DB server 10.0.0.205, the owner**, elevated PowerShell: `reset_2_db_drop_create.ps1` | Checks the backup is under 60 minutes old; asks you to type `WIPE ckassetmanagement`; asks the superuser password; ends the app's connections, drops the database, creates it again empty with the same owner | `DONE. The database is empty.` |
| 3 | App server, Claude: `reset_3_rebuild.ps1` | Refuses unless the database is empty; runs every migration; checks the result; writes the new head-office admin's **one-time password** into an admin-only file (never printed) | `REBUILD_OK` and the file's path |
| 4 | App server, Claude: `reset_4_start_verify.ps1` | Starts CKAM, checks health, the database version and the first ERP copy | `CKAM is running on the empty database` |

Then the owner: read the password file on the server, sign in as **Admin**, choose a new password when asked, **delete the password
file**, and set up fresh (Settings › Set up CKAM, or Organisation › Add from the ERP).

Everyone is signed out by the reset. The first head-office admin is the only login; create the others (Full Admin, operators, viewers) in
People & Places.

## If something goes wrong

* **Step 2 stops before changing anything** (old backup, other users connected, wrong owner): fix what it says and run it again.
* **Step 3 says the migrations failed:** CKAM stays stopped; tell Claude (the details are in the admin-only file's folder).
* **You want the old data back** (only possible from the backup): with CKAM stopped, on the database server run step 2 again (it recreates the empty
  database), then, as the superuser,
  `pg_restore -h localhost -U postgres -d ckassetmanagement --no-owner --role=ckassetapp "E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP\<the dump>"`
  and start CKAM (step 4 without step 3). Backups are kept for 30 days; the one taken in step 0 is the one to use.

## What this kit checks for you

The reset has been rehearsed on a scratch database in the dev stack: all migrations run from zero, ending with the live version's database
version, 40 tables, exactly one head-office admin and nothing else. Step 3's refusal while CKAM runs was tested on the live server.
`create_owner.py` is **not** used: it would recreate the old "CKS" company and Ankur Pahwa's login, which a fresh start does not want.
