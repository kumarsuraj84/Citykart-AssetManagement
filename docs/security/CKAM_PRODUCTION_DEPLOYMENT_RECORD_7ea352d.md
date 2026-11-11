# CKAM production deployment record — release `7ea352d` (Add from the ERP: companies, head offices and warehouses; Category in the asset summary)

| | |
|---|---|
| Date / window | 2026-11-11, 14:16–14:17 IST. CKAM was stopped about 14:16:40 and healthy again at 14:17:02: **about 25 seconds** of downtime |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE 7ea352d` in chat |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (copies in `evidence/deploy_7ea352d/scripts/`). No secret was printed or typed by Claude |
| From → to | release `138e67a` → `7ea352d` (`7ea352d9ce834da6845387181b810912dd75acaf`, tree `c6b160a09c29db1002ef7d492bdf9b535d2535de`). **No database change**: Alembic stayed at `e8a0c2d4f6b8`, `alembic upgrade head` ran and did nothing |
| What changed for users | Settings › Organisation › Companies and Places each have **Add from the ERP** (head-office admin): companies with the ERP's code and name (and their cost centre), head offices and warehouses as Place + Install Point + Stock Point. An asset's summary shows Category and Sub-category with **Correct Classification** beside them. API: `GET /api/erp/companies`, `POST /api/erp/companies/create`, `GET /api/erp/places`, `POST /api/erp/places/create`. Decision 18 in `docs/ai/DECISIONS.md` |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once). Nothing else |

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Package | Built from `git archive 7ea352d`; `check:build` OK; **built twice independently, folders byte-identical**. Zip **2,177,252 bytes**, SHA-256 `86d583dd21b7cdb87780496f512f37e886593dad08a80d050a50623146a57a66`, 221 files; audit 15/15 PASS; manifest `MANIFEST.7ea352d.sha256.txt` (SHA-256 `237e6937…9e62`, `sha256sum -c` passes). Against `138e67a`: only the `backend/app/erp` files (one new) and the frontend bundle differ; migrations, `constraints.txt`, `ops/windows` and `ops/db` are byte-identical |
| 2 | Backup | **`ckassetmanagement_20261111_141509.dump`** (1,833,040 bytes, 14:15 IST) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; `backup.log` says `OK` |
| 3 | Copy + verify | Zip size and SHA-256 **matched on the server**; expanded into the NEW folder `releases\7ea352d`; 221 files; **0 hash mismatches, 0 extra files** |
| 4 | Cutover (automatic return to `138e67a` if anything failed — not needed) | CKAM stopped, `pip install` exit 0 and `pip check` clean, `.env` switched (`FRONTEND_DIST_DIR`, `APP_VERSION`, no BOM; `PO_SOURCE_HOST` stayed `10.0.0.82`), `alembic heads` = `current` = `e8a0c2d4f6b8`, started |
| 5 | Start | Healthy; launcher log names `7ea352d`, NAS mapping OK; stderr empty; startup event `version 7ea352d`, `migration.matches true`, `database_host 10.0.0.205` |
| 6 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; unauthenticated `/api/erp/companies`, `POST /api/erp/places/create`, `/api/masters/companies/inactive`, `/api/repairs`, `/api/assets` all 401; new bundle `index-CtSeL-hf.js` served |
| 7 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted from the server; `releases\138e67a` and older folders were kept; the staging zip and hash list stay in `backup\staging-7ea352d\` |

## Not checked by Claude (needs a sign-in)

- The screens: Settings › Organisation › Companies › Add from the ERP (CKSPL and CKVPL show as already here; CKVPL's ERP name "Citykart Retail" differs from CKAM's "Citykart Ventures"), Places › Add from the ERP (head offices and warehouses grouped), and an asset's summary showing Category and Sub-category.
- The company list reads the ERP's company master live (`silver.dim_company`); if that read is refused it falls back to the company codes in the copy and the owner types the names.

## Rollback

No schema change, so `138e67a` can be started again: set `FRONTEND_DIST_DIR` / `APP_VERSION` back and run its `pip install -c … -e`. Never start `3b5e842` or older.
