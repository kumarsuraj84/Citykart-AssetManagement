# CKAM production deployment record — release `0b8c525` (Pick from ERP: vendors you added first)

| | |
|---|---|
| Date / window | 2026-10-17, 14:55–14:57 IST. CKAM was stopped about 14:55:55 and healthy again at 14:56:20: **under one minute** of downtime |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE 0b8c525` in chat |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (copies in `evidence/deploy_0b8c525/scripts/`). No secret was printed or typed by Claude |
| From → to | release `ccae7b2` → `0b8c525` (`0b8c5251b86e2dc27665965576416b3fe7e4e12d`). **No database change**: Alembic stayed at `c6e8a0b2d4f6`, `alembic upgrade head` ran and did nothing |
| What changed for users | *Purchase Orders from the ERP* opens with only the POs of vendors already added; "Also show other suppliers' POs (N)" shows the rest. API: `GET /api/erp/pos?only_linked=true`, `counts.other_suppliers` (decision 12) |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once). Nothing else |

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Backup | **`ckassetmanagement_20261017_145542.dump`** (1,703,121 bytes, 14:55 IST) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP` of the DB server (the owner accepted that as the only copy). The first attempt failed: SSH to 10.0.0.205 was refused (`publickey`); the owner re-added the key with a script and access worked again, then the backup ran |
| 2 | Copy + verify | Zip 2,152,169 bytes, SHA-256 `11f2262e103e0219453e10cf46011a20ec573226a62de97c8fb9ab8527d2022c` **matched on the server**; expanded into the NEW folder `releases\0b8c525`; 215 files; `VERSION`, bundle name and `RELEASE.json` right; **all 215 per-file hashes equal `MANIFEST.0b8c525.sha256.txt`** |
| 3 | Cutover (script with automatic return to `ccae7b2` if anything failed — not needed) | CKAM stopped, `pip install -c constraints.txt -e` exit 0 and `pip check` clean (nothing new to download), `.env` switched (`FRONTEND_DIST_DIR`, `APP_VERSION`, no BOM), `alembic heads` = `current` = `c6e8a0b2d4f6`, started |
| 4 | Start | Healthy; one listener, both uvicorn flags; launcher log names `0b8c525`, NAS mapping OK; stderr empty; startup event `version 0b8c525`, `migration.matches true`, `database_host 10.0.0.205`, JWT checks true |
| 5 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; `/assets/<id>` and `/assets/new` 200; unauthenticated `/api/erp/pos` 401; new bundle `index-BJmT-4C3.js` served |
| 6 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted from the server; `releases\ccae7b2` and older folders were kept; the staging zip stays in `backup\staging-0b8c525\` |

## Not checked by Claude

- The screen itself (needs a sign-in): the owner opens *Purchase Orders from the ERP* and confirms it starts with the added vendors' POs and shows "Also show other suppliers' POs (N)".
- The last ERP copy before the restart was 14:27 IST; the next one runs on the schedule (or *Refresh now*).

## Rollback

No schema change, so `ccae7b2` can be started again: set `FRONTEND_DIST_DIR` / `APP_VERSION` back and run its `pip install -c … -e`. Never start `3b5e842` or older.
