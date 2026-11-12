# CKAM production deployment record — release `201ef76` (the ERP copy keeps every supplier that has ever been on a Fixed Assets PO)

| | |
|---|---|
| Date / window | 2026-11-12, 09:41–09:43 IST. CKAM was stopped about 09:41:57 and healthy again by 09:42:25: **about 30 seconds** of downtime |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE 201ef76` in chat (two earlier tries without the commit id were not acted on) |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (same scripts as the `89d377b` deploy with the release names changed; `evidence/deploy_89d377b/scripts/`). No secret was printed or typed by Claude |
| From → to | release `89d377b` → `201ef76` (`201ef76e83a535a31ef70be97da440550fa19658`, tree `9dbb1a79ea6f29d50d7f519f71dd93f34dce8e3f`). **No database change**: Alembic stayed at `e8a0c2d4f6b8`, `alembic upgrade head` ran and did nothing |
| What changed for users | Settings › Vendors › **Add from ERP** now offers every supplier that has ever been on a Fixed Assets PO, not only those on POs of the last 18 months (DEV IT SERV PRIVATE LIMITED: CKSPL 12445, CKVPL 679, last PO 2024, was missing). On the real ERP the vendor copy grows from 194 to 492. POs are unchanged (18 months plus every open PO). Decision 20 in `docs/ai/DECISIONS.md` |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once). Nothing else |

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Package | Built from `git archive 201ef76` (committed tree only); `npm ci`, `VITE_APP_VERSION=201ef76 npm run build`, `check:build` OK. Zip **2,162,763 bytes**, SHA-256 `638712893df4d20bc28c9f8abedfca460315280a2f1e625c4f47ef1309dda1ee`, 221 files; manifest `MANIFEST.201ef76.sha256.txt` (SHA-256 `3f3b57af…732f`, `sha256sum -c` passes). Against `89d377b` only these files differ: `backend/app/erp/sync.py`, `backend/app/erp/warehouse.py`, the frontend bundle (`index-DGFFWB7F.js`, `index.html`; the bundle holds the version id), `backend/VERSION`, `RELEASE.json`. Built once |
| 2 | Backup | **`ckassetmanagement_20261112_094132.dump`** (1,619,729 bytes) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; `backup.log` says `OK` |
| 3 | Copy + verify | Zip size and SHA-256 **matched on the server**; expanded into the NEW folder `releases\201ef76`; 221 files; **0 hash mismatches, 0 extra files** |
| 4 | Cutover (automatic return to `89d377b` if anything failed — not needed) | CKAM stopped, `pip install` exit 0 and `pip check` clean, `.env` switched (no BOM; `PO_SOURCE_HOST` stayed `10.0.0.82`), `alembic heads` = `current` = `e8a0c2d4f6b8`, started |
| 5 | Start | Healthy; launcher log names `201ef76`, NAS mapping OK; stderr empty; startup event `version 201ef76`, `migration.matches true`, `database_host 10.0.0.205` |
| 6 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; unauthenticated `/api/assets`, `POST /api/assets/batch`, `/api/repairs`, `/api/erp/companies` all 401; new bundle `index-DGFFWB7F.js` served |
| 7 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted from both servers; `releases\89d377b` and older were kept; the staging zip and hash lists stay in `backup\staging-201ef76\` |

## Not done / needs a person

- **The new vendors are not in the copy yet.** The automatic copy only runs when the ERP warehouse has loaded newer data (or after 24 hours without one); the last copy (09:41, manual, 190 vendors) was just before this deploy. The next warehouse load, or **Refresh now** (Settings › ERP Data Sync, Primary Owner "Admin" only), copies the ERP again and adds the ~300 older vendors. Not checked by Claude: it needs a sign-in.
- Tests before the commit: backend 2,621 passed, 6 skipped (ERP tests 337 passed, including the new one).

## Rollback

No schema change, so `89d377b` can be started again: set `FRONTEND_DIST_DIR` / `APP_VERSION` back and run its `pip install -c … -e`. Never start `3b5e842` or older.
