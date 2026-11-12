# CKAM production deployment record — release `bdab644` (the Items list shows each Item's Brand and Warranty)

| | |
|---|---|
| Date / window | 2026-11-12, 12:05 IST. CKAM was stopped about 12:05:16 and healthy again by 12:05:48: **about 32 seconds** of downtime |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE bdab644` in chat |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (copies in `evidence/deploy_bdab644/scripts/`). No secret was printed or typed by Claude |
| From → to | release `2951388` → `bdab644` (`bdab644a2315201619e16a958624416e742cff4d`, tree `90542e993cd29438f7d3a5e9e67dd4b27d9830e0`). **No database change**: Alembic stayed at `a9c1e3b5d7f2`, `alembic upgrade head` ran and did nothing |
| What changed for users | Settings › Catalogue › Items has two new columns, **Brand** and **Warranty**, showing each Item's default brand and default warranty ("3 years"; "—" when none). Frontend only |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once). Nothing else |

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Package | Built from `git archive bdab644` (committed tree only); `npm ci`, `VITE_APP_VERSION=bdab644 npm run build`, `check:build` OK. Zip **2,180,120 bytes**, SHA-256 `52035d9191e6a8a787a99bd2cdf89af9df6f65821189a7e3dfab4540745fc993`, 224 files; manifest `MANIFEST.bdab644.sha256.txt` (SHA-256 `ada9d22c…55dd`, `sha256sum -c` passes). Against `2951388` only the frontend bundle (`index-CrA4RAh9.js`, `index.html`), `backend/VERSION` and `RELEASE.json` differ; the backend, migrations and `ops/` are byte-identical. Tests before the commit: frontend 1,334 passed. Built once |
| 2 | Backup | **`ckassetmanagement_20261112_120451.dump`** (4,588 KB) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; `backup.log` says `OK` |
| 3 | Copy + verify | Zip size and SHA-256 **matched on the server**; expanded into the NEW folder `releases\bdab644`; 224 files; **0 hash mismatches, 0 extra files** |
| 4 | Cutover (automatic return to `2951388` if anything failed — not needed) | CKAM stopped, `pip install` exit 0 and `pip check` clean, `.env` switched (no BOM; `PO_SOURCE_HOST` stayed `10.0.0.82`), `alembic heads` = `current` = `a9c1e3b5d7f2`, started |
| 5 | Start | Healthy; launcher log names `bdab644`, NAS mapping OK; stderr empty; startup event `version bdab644`, `migration.matches true`, `database_host 10.0.0.205` |
| 6 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; unauthenticated `/api/assets`, `/api/repairs`, `/api/erp/pi/ready`, `POST /api/erp/pi/apply`, `POST /api/erp/vendors/add-all`, `GET /api/erp/vendors/add-all/plan` and `POST /api/imports/assets/preview` all 401; new bundle `index-CrA4RAh9.js` served |
| 7 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted from both servers; `releases\2951388` and older folders were kept; the staging zip and hash lists stay in `backup\staging-bdab644\` |

## Not checked by Claude (needs a sign-in)

- The screen: Settings › Catalogue › Items shows the Brand and Warranty columns.

## Rollback

No schema change, so `2951388` can be started again: set `FRONTEND_DIST_DIR` / `APP_VERSION` back and run its `pip install -c … -e`. Never start `3b5e842` or older.
