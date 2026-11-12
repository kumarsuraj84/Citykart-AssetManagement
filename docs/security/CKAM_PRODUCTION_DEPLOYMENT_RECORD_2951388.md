# CKAM production deployment record — release `2951388` (PI ready in ERP, full ERP history, old-data import check, Add all suppliers)

| | |
|---|---|
| Date / window | 2026-11-12, 11:04–11:05 IST. CKAM was stopped about 11:04:25 and healthy again by 11:04:57: **about 32 seconds** of downtime (stop, pip install, **one migration**, start) |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE 2951388` in chat |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (copies in `evidence/deploy_2951388/scripts/`; the cutover now expects and checks one migration). No secret was printed or typed by Claude |
| From → to | release `201ef76` → `2951388` (`2951388b0d9d58ddce8ac237c8b2b9819aec29b8`, tree `1ea264962893decd35e9c728d70f12ff00cd5166`). **One additive migration**: `e8a0c2d4f6b8` → `a9c1e3b5d7f2` creates the table `erp_pi` and its index; no existing table or row changes. It had been rehearsed on the dev and test databases. It carries commits `ddeb7db` (PI ready in ERP) and `2951388` (old-data tagging) |
| What changed for users | **PI ready in ERP:** the ERP's Fixed Assets purchase invoices are copied; a received invoice is matched by the vendor's bill number (company and vendor checked); the PO list's PI column says "PI ready in ERP", a card opens a worklist to add the PIs, and Record PI › Fetch from ERP works for any PO. **Full ERP history:** POs back to 2016, all PIs, every supplier that ever had a PO or PI. **Old-data import:** Bulk Import › Add New Assets checks each row's PO and bill number with the ERP and fills the blank PO date, vendor, PI and invoice date on commit. **Add all suppliers** in Settings › Vendors › Add from ERP. The refresh result also says how many suppliers, items and PIs were new. Decisions 20-22 in `docs/ai/DECISIONS.md` |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once; CKAM's own database `ckassetmanagement`: the one migration). Nothing else |

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Package | Built from `git archive 2951388` (committed tree only); `npm ci`, `VITE_APP_VERSION=2951388 npm run build`, `check:build` OK. Zip **2,180,213 bytes**, SHA-256 `1206a12853715ca9d79c679094ef79e00d1bcb37da6de5bf3b0f44a995e8062c`, 224 files; manifest `MANIFEST.2951388.sha256.txt` (SHA-256 `a60df3d2…4481`, `sha256sum -c` passes). Against `201ef76` the differing files are the new migration, 11 backend modules (`app/erp/*`, `app/imports/*`, `app/purchase_orders/*`), the frontend bundle, `VERSION` and `RELEASE.json`. `constraints.txt` and `ops/` are byte-identical. Tests before the commit: backend 2,633 passed (6 skipped), frontend 1,333 passed. Built once |
| 2 | Backup | **`ckassetmanagement_20261112_110400.dump`** (1,655,759 bytes) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; `backup.log` says `OK` |
| 3 | Copy + verify | Zip size and SHA-256 **matched on the server**; expanded into the NEW folder `releases\2951388`; 224 files; **0 hash mismatches, 0 extra files** |
| 4 | Cutover (automatic return to `201ef76` if anything failed — not needed) | CKAM stopped, `pip install` exit 0 and `pip check` clean, `.env` switched (no BOM; `PO_SOURCE_HOST` stayed `10.0.0.82`), `alembic heads` = `a9c1e3b5d7f2`, `current` was `e8a0c2d4f6b8`, **`alembic upgrade head` ran exactly one upgrade (exit 0)**, `current` = `a9c1e3b5d7f2`, started |
| 5 | Start | Healthy; launcher log names `2951388`, NAS mapping OK; stderr empty; startup event `version 2951388`, `migration.matches true`, `database_host 10.0.0.205` |
| 6 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; unauthenticated `/api/assets`, `/api/erp/pi/ready`, `POST /api/erp/pi/apply`, `POST /api/erp/vendors/add-all`, `GET /api/erp/vendors/add-all/plan` and `POST /api/imports/assets/preview` all 401; new bundle `index-GHxHEG1L.js` served |
| 7 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted from both servers; `releases\201ef76` and older folders were kept; the staging zip and hash lists stay in `backup\staging-2951388\` |

## Not done / needs a person

- **The ERP copy has not run on the new code yet** (its last run was 09:46 IST, before this deploy), so the PI table is empty and the older history is not in CKAM. Click **Refresh now** under Settings › ERP Data Sync (Primary Owner "Admin"): it copies the full history (about 20 seconds on the real ERP) and the PIs. Until then "PI ready in ERP" shows nothing and the import check says the ERP data has not been copied. Not checked by Claude: it needs a sign-in.
- Then, for the old-data import: Settings › Vendors › Add from ERP › **Add all suppliers** (once per company), then Bulk Import › Add New Assets with the ERP check ticked.

## Rollback

The migration only adds a table, so `201ef76` can be started again (set `FRONTEND_DIST_DIR` / `APP_VERSION` back and run its `pip install -c … -e`); it ignores `erp_pi` and its startup record will show a migration mismatch warning. Never start `3b5e842` or older.
