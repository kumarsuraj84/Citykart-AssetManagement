# CKAM production deployment record — release `0df67d3` (movement redesign: releases 1, 2 and 3)

| | |
|---|---|
| Date / window | 2026-11-11, 12:44–12:46 IST. CKAM was stopped about 12:44:50 and healthy again at 12:45:22: **about 45 seconds** of downtime (including both migrations) |
| Approval | The owner typed the exact sentence `DEPLOY CKAM RELEASE 0df67d3` in chat |
| Done by | Claude over SSH, small `.ps1` files run with `-File` (copies in `evidence/deploy_0df67d3/scripts/`). No secret was printed or typed by Claude |
| From → to | release `0b8c525` → `0df67d3` (`0df67d33784545884bc63651f0276407d06d47cf`, tree `0d87ed148631fcb435ae0d0ca3fc62eeeaca26cd`) |
| What changed for users | Move: *Give to Employee / Give to Store / Install at HO / Warehouse / Move to Stock Point* and "From" shown (release 1); assets can be held by the other company's places, *Owned by* / *Currently at*, and an admin-only owner company / cost centre correction (release 2); repair vendors as places, *Send for Repair* names the vendor, *Receive from Repair* always asks where each asset goes, new **Work › Repairs** screen (release 3). Decisions 13, 14 and 15 in `docs/ai/DECISIONS.md` |
| Database | `c6e8a0b2d4f6` → `d7f9b1c3e5a7` → `e8a0c2d4f6b8` (one transaction, 2 "Running upgrade" lines). Production head = code head |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, run once). Nothing else |

## Steps and results

| # | Step | Result |
|---|---|---|
| 1 | Package | Built from `git archive 0df67d3` (no `.git`, no demo files, only `.env.example`); `npm ci` + `VITE_APP_VERSION=0df67d3 npm run build` + `check:build` OK; **built twice independently, folders byte-identical**. Zip **2,167,958 bytes**, SHA-256 `d3eff54db5f3a2b80c2ec27386abfd3eb209b1dcf34193dc4842e5fa0b168879`, 220 files; audit 15/15 PASS; manifest `MANIFEST.0df67d3.sha256.txt` (SHA-256 `0e24f467…6136`, `sha256sum -c` passes). Against `0b8c525`: `ops/windows` and `constraints.txt` byte-identical, so no package changes |
| 2 | Backup | **`ckassetmanagement_20261111_124159.dump`** (1,794,303 bytes, 12:42 IST) on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP` of the DB server; `backup.log` says `OK`. (Still the only copy: not copied off the DB server) |
| 3 | Copy + verify | Zip size and SHA-256 **matched on the server**; expanded into the NEW folder `releases\0df67d3`; 220 files; **0 hash mismatches, 0 extra files** against the manifest |
| 4 | Cutover (script with automatic return to `0b8c525` if anything failed before the migration — not needed) | CKAM stopped, `pip install -c constraints.txt -e` exit 0 and `pip check` clean, `.env` switched (`FRONTEND_DIST_DIR`, `APP_VERSION`, no BOM), `alembic heads` = `e8a0c2d4f6b8`, `current` was `c6e8a0b2d4f6`, `alembic upgrade head` exit 0, current = head, started |
| 5 | Start | Healthy after the first check; launcher log names `0df67d3`, NAS mapping OK; stderr empty; startup event `version 0df67d3`, `migration.matches true`, `database_host 10.0.0.205`, JWT placeholder false |
| 6 | Verify | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS**; 11 file-read probes all 404; `/assets/1`, `/assets/new`, `/repairs` 200; unauthenticated `/api/repairs` and `/api/assets` 401; new bundle `index-CT4T5MWh.js` served |
| 7 | Clean-up | The pre-change copy of `.env` (live secrets) and my scripts were deleted from the server; `releases\0b8c525` and older folders were kept; the staging zip and hash list stay in `backup\staging-0df67d3\` |

## Not checked by Claude (needs a sign-in)

- The screens: the owner opens **Move** (new choice names and *From*), **Work › Repairs**, an asset's page (*Owned by*), and sends one test asset for repair to a vendor and receives it back (the app asks where it goes).
- The ERP copy: the last successful ERP sync is 2026-10-22 (the ERP database on 10.0.1.69 has refused connections since then; the ERP owner must fix it). Not caused by this release.

## Rollback

The schema is now `e8a0c2d4f6b8`. The previous release `0b8c525` does not know the new trigger rules or repair places: do **not** use it as a quick rollback. Roll forward (fix and redeploy); a database restore from `ckassetmanagement_20261111_124159.dump` only by owner decision. Never start `3b5e842` or older.
