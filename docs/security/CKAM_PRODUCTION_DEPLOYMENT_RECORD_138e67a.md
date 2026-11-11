# CKAM production deployment record — release `138e67a` (switch a company on again; note when no company is on)

| | |
|---|---|
| Date / window | 2026-11-11, 13:44–13:46 IST. CKAM was stopped about 13:44:55 and healthy again at 13:45:19: **about 25 seconds** of downtime |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE 138e67a` in chat |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (copies in `evidence/deploy_138e67a/scripts/`). No secret was printed or typed by Claude |
| From → to | release `0df67d3` → `138e67a` (`138e67a062467de1ae2b19fcf38e8a528efa37bc`, tree `2e73f9f342dff781a3813b3529e2068845b595c4`). **No database change**: Alembic stayed at `e8a0c2d4f6b8`, `alembic upgrade head` ran and did nothing |
| What changed for users | Settings › Organisation › Companies: **Show switched-off companies** and **Switch on again** (head-office admin only, with a confirmation); a note on every screen for staff when no company is on. API: `GET /api/masters/companies/inactive`, `POST /api/masters/companies/{id}/reactivate`. Decision 17 in `docs/ai/DECISIONS.md` |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once). Nothing else |

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Package | Built from `git archive 138e67a`; `check:build` OK; **built twice independently, folders byte-identical**. Zip **2,169,326 bytes**, SHA-256 `136562d8bc0f27ee50ae1898a9b20e3356b3d9c5aa7149af30288afcaa68debb`, 220 files; audit 15/15 PASS; manifest `MANIFEST.138e67a.sha256.txt` (SHA-256 `6d176305…acc`, `sha256sum -c` passes). Against `0df67d3`: only `backend/app/masters/router.py` and the frontend bundle differ; migrations, `constraints.txt`, `ops/windows` and `ops/db` are byte-identical |
| 2 | Backup | **`ckassetmanagement_20261111_134258.dump`** (1,832,607 bytes, 13:42 IST) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`; `backup.log` says `OK` |
| 3 | Copy + verify | Zip size and SHA-256 **matched on the server**; expanded into the NEW folder `releases\138e67a`; 220 files; **0 hash mismatches, 0 extra files** |
| 4 | Cutover (automatic return to `0df67d3` if anything failed — not needed) | CKAM stopped, `pip install` exit 0 and `pip check` clean, `.env` switched (`FRONTEND_DIST_DIR`, `APP_VERSION`, no BOM; `PO_SOURCE_HOST` stayed `10.0.0.82`), `alembic heads` = `current` = `e8a0c2d4f6b8`, started |
| 5 | Start | Healthy; launcher log names `138e67a`, NAS mapping OK; stderr empty; startup event `version 138e67a`, `migration.matches true`, `database_host 10.0.0.205` |
| 6 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; `/assets/1`, `/assets/new`, `/repairs` 200; unauthenticated `/api/repairs`, `/api/assets`, `/api/masters/companies/inactive` and `POST …/reactivate` all 401; new bundle `index-DpEbQjME.js` served |
| 7 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted from the server; `releases\0df67d3` and older folders were kept; the staging zip and hash list stay in `backup\staging-138e67a\` |

## Not checked by Claude (needs a sign-in)

- The screens: Settings › Organisation › Companies shows the switched-off list and the Switch on again confirmation; the "No company is switched on" note appears only when every company is off.
- No ERP copy ran in the first minute after this restart (the previous one was 07:33 UTC). There is no `sync_failed`; the copy runs when the ERP posts newer data.

## Rollback

No schema change, so `0df67d3` can be started again: set `FRONTEND_DIST_DIR` / `APP_VERSION` back and run its `pip install -c … -e`. Never start `3b5e842` or older.
