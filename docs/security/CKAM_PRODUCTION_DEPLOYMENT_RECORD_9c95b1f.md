# CKAM production deployment record — release `9c95b1f` (closed ERP POs, ERP Barcode check, brands by work area, "Where do they go")

| | |
|---|---|
| Date / window | 2026-11-12, 16:58 IST. CKAM was stopped about 16:58:30 and serving again by 16:59:04 (the new startup record is stamped 16:59:02): **about 35 seconds** of downtime |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE 9c95b1f` in chat |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (copies in `evidence/deploy_9c95b1f/scripts/`). No secret was printed or typed by Claude |
| From → to | release `bdab644` → `9c95b1f` (`9c95b1fd67029953a00f3ff3d7a432e38d87a73e`, tree `0b92a5f03d4b4164c0c81fd345cc79c7c15f533e`). **ONE additive database change**: Alembic `a9c1e3b5d7f2` → `b3d5f7a9c1e4` (adds `brand.work_areas`, filled from where each brand is already used) |
| What changed for users | See "What is in it". Not seen on screen by Claude (needs a sign-in) |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once; the migration ran against CKAM's own database `ckassetmanagement`). Nothing else |

## What is in it

* **Pick from ERP** can show POs the ERP has already **closed** (switch "Also show closed POs", off by default; window by PO date; marked; warns when assets already carry the PO number). DECISIONS (23).
* **Asset 360** says a part was bought as part of a set ("Part of set") and that its ERP code is the set's.
* The **Barcode** field is called **ERP Barcode** on every screen. DECISIONS (24).
* **Brands say which work areas they are used for** (IT / Non-IT / both); pickers list only the brands for the work area; Settings › Catalogue › Brands has "Used for" and "Set used for". DECISIONS (25).
* **Add Assets asks "Where do they go"**: a Store (With Store), a head-office / warehouse site (Installed) or a Stock Room (In Stock); a store's own STK-/INS- rooms are not listed. DECISIONS (26).
* **An ERP Barcode typed by hand must be right for the Item** (an ERP code linked to it) **or `LOCAL`**; live message on Add Assets, required per line on a manual PO. POs picked from the ERP and the Excel imports are not checked. DECISIONS (27).

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Package | Built from `git archive 9c95b1f` (committed tree only); `npm ci`, `VITE_APP_VERSION=9c95b1f npm run build`, `check:build` OK (15 files, no source maps). Zip **2,193,192 bytes**, SHA-256 `a200dbabe7004e89ee0b6b09d149fa3385a45634cd36fdc9ff6d1ff8234fe7c4`, 227 files; manifest `MANIFEST.9c95b1f.sha256.txt` (SHA-256 `f11f5a27…90bb`, `sha256sum -c` passes). Tests before the commits: backend 2,654 passed with 5 old tests then fixed (their files re-run: 52 passed), frontend 1,354 passed |
| 2 | Backup | **`ckassetmanagement_20261112_165758.dump`** (4,617 KB) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; `backup.log` says `OK` |
| 3 | Copy + verify | Zip size and SHA-256 **matched on the server**; expanded into the NEW folder `releases\9c95b1f`; 227 files; **0 hash mismatches, 0 extra files**; CKAM kept serving |
| 4 | Cutover (automatic return to `bdab644` if anything failed — not needed) | CKAM stopped, `pip install` exit 0 and `pip check` clean, `.env` switched (no BOM; `PO_SOURCE_HOST` stayed `10.0.0.82`), `alembic current` = `a9c1e3b5d7f2`, `alembic upgrade head` ran **one** migration (`b3d5f7a9c1e4`), started |
| 5 | Start | Healthy; launcher log names `9c95b1f`, NAS mapping OK; stderr empty; startup event `version 9c95b1f`, `migration.matches true`, `database_host 10.0.0.205` |
| 6 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; unauthenticated `/api/assets`, `/api/repairs`, `/api/erp/pi/ready`, `POST /api/erp/pi/apply`, `POST /api/erp/vendors/add-all`, `GET …/add-all/plan`, `POST /api/imports/assets/preview`, `GET /api/items/erp-code-check`, `POST /api/masters/brands/work-areas`, `GET /api/people?kind=stores` all 401; new bundle `index-D1eiexF1.js` served |
| 7 | What the brand migration did (read-only) | Head `b3d5f7a9c1e4`. **38 brands**, **46 Items with a default brand** (both unchanged). **21 brands IT** (AHUJA, AI BOX, APC, BOSH, BROTHER, CP PLUS, DLINK, EPSON, GODEX, HIKVISION, HONEYWELL, HP, LOCAL, MICROSOFT, NETGEAR, NEWLAND, PRAMA, RUGTEK, SYNOLOGY, TOSHIBA, UNMUKTI); **17 brands both** because no Item uses them yet (ACER, ASSEMBLED, ASUS, BEETAL, BENQ, CANNON, CIPHERLAB, DELL, DYNAMIC, IBM, LENOVO, NVIDIA, TENDA, TPLINK, TVS, VELOQO, WD); none Non-IT only. **Items whose default brand does not fit their work area: 0** |
| 8 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted; `releases\bdab644` and older folders were kept; the staging zip and hash lists stay in `backup\staging-9c95b1f\` |

## Not checked by Claude (needs a sign-in)

* The screens: Brands "Used for", the brand pickers, Add Assets "Where do they go" and the ERP Barcode message, the manual PO form's required ERP Barcode, Pick from ERP "Also show closed POs", Asset 360 "Part of set".

## Owner's next steps

* Settings › Catalogue › Brands: tick the 17 brands used by no Item yet that are IT and use "Set used for" (the owner decides ASSEMBLED, DYNAMIC, BEETAL, TVS).
* A code made in the ERP today is "not an ERP code" in CKAM until the nightly copy or Refresh now (head-office admin).

## Rollback

The column has a default, so the previous release `bdab644` runs against the new schema: set `FRONTEND_DIST_DIR` / `APP_VERSION` back and run its `pip install -c … -e`; the column may stay. Never start `3b5e842` or older.
