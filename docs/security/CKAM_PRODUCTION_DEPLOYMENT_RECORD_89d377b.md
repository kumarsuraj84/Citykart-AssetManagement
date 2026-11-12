# CKAM production deployment record — release `89d377b` (Add Assets splits a set Item into its parts)

| | |
|---|---|
| Date / window | 2026-11-12, about 08:58–09:00 IST. CKAM was stopped about 08:59:00 and healthy again by 08:59:35: **about 35 seconds** of downtime (stop, pip install, start) |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE 89d377b` in chat |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (copies in `evidence/deploy_89d377b/scripts/`). No secret was printed or typed by Claude |
| From → to | release `7ea352d` → `89d377b` (`89d377bd05bb9b298afe8f35f4b6c449cb6dacac`, tree `3eae4b9c6b7607e27f7fc4d75f813ed3ce4b6289`). **No database change**: Alembic stayed at `e8a0c2d4f6b8`, `alembic upgrade head` ran and did nothing |
| What changed for users | Add Assets with a set Item (for example a Mouse + Keyboard combo or a Desktop) now creates one asset per part, as a PO already did. Quantity counts sets (2 sets = 4 assets). Each part follows its own Item's serial rule (serial boxes only for parts whose Item says serial). A typed cost is the price of one set, split over the parts by share %. Brand, Model, old asset code and per-asset values are not offered for a set. API: `POST /api/assets/batch` takes `part_serials`; the Item list returns `set_parts`. Decision 19 in `docs/ai/DECISIONS.md` |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once). Nothing else |

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Package | Built from `git archive 89d377b` (committed tree only); `npm ci`, `VITE_APP_VERSION=89d377b npm run build`, `check:build` OK. Zip **2,162,395 bytes**, SHA-256 `5819b24beb27103e8ed924d1f972159e63946f81d51851b36a55f4a999bcf1ad`, 221 files; manifest `MANIFEST.89d377b.sha256.txt` (SHA-256 `1192f282…1646`, `sha256sum -c` passes). Against `7ea352d` only these files differ: `backend/app/assets/batch.py`, `assets/schemas.py`, `items/schemas.py`, `items/service.py`, `masters/serial_rule.py`, the frontend bundle (`index-Dk03o4os.js`, `index.html`), `backend/VERSION`, `RELEASE.json`. Migrations, `constraints.txt`, `ops/` are byte-identical. Built once (the previous release's second independent build was not repeated) |
| 2 | Backup | **`ckassetmanagement_20261112_085816.dump`** (1,643,280 bytes) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; `backup.log` says `OK` |
| 3 | Copy + verify | Zip size and SHA-256 **matched on the server**; expanded into the NEW folder `releases\89d377b`; 221 files; **0 hash mismatches, 0 extra files** |
| 4 | Cutover (automatic return to `7ea352d` if anything failed — not needed) | CKAM stopped, `pip install` exit 0 and `pip check` clean, `.env` switched (`FRONTEND_DIST_DIR`, `APP_VERSION`, no BOM; `PO_SOURCE_HOST` stayed `10.0.0.82`), `alembic heads` = `current` = `e8a0c2d4f6b8`, started |
| 5 | Start | Healthy; launcher log names `89d377b`, NAS mapping OK; stderr empty; startup event `version 89d377b`, `migration.matches true`, `database_host 10.0.0.205` |
| 6 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; unauthenticated `/api/assets`, `POST /api/assets/batch`, `/api/repairs`, `/api/erp/companies` all 401; new bundle `index-Dk03o4os.js` served |
| 7 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted from both servers; `releases\7ea352d` and older folders were kept; the staging zip and hash lists stay in `backup\staging-89d377b\` |

## Not checked by Claude (needs a sign-in)

- The screen: Assets › Add with a set Item (for example the Mouse + Keyboard combo should show "Comes as a set of 2 parts", quantity help "1 set = 2 assets", and create 2 assets). Tested in code only: backend 2,620 and frontend 1,314 tests passed before the commit.

## Rollback

No schema change, so `7ea352d` can be started again: set `FRONTEND_DIST_DIR` / `APP_VERSION` back and run its `pip install -c … -e`. Never start `3b5e842` or older.
