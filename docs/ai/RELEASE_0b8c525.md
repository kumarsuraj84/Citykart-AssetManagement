# Release `0b8c525` — Pick from ERP starts with the vendors you added (PREPARED, NOT DEPLOYED)

| | |
|---|---|
| Status | **DEPLOYED to production 2026-10-17 14:56 IST** (owner approval `DEPLOY CKAM RELEASE 0b8c525`); record: `docs/security/CKAM_PRODUCTION_DEPLOYMENT_RECORD_0b8c525.md`. Written before the deploy: "built and checked on the dev PC, not copied to any server" |
| What it changes | `GET /api/erp/pos` gets an optional `only_linked` (default off) and `counts.other_suppliers`; the *Purchase Orders from the ERP* screen starts with only the POs of vendors already added, plus the button "Also show other suppliers' POs (N)". Decision 12 in `DECISIONS.md` |
| Database change | **None.** Alembic head stays `c6e8a0b2d4f6`; `alembic upgrade head` is a no-op. The 44 pinned packages are unchanged |
| Commit | `0b8c5251b86e2dc27665965576416b3fe7e4e12d` (tree `2ba35e3cff254fdaa2b28555de73499aeca8d467`), pushed to `claude/brave-euler-07879a` |
| Package | `D:\ANKUR AI PROJECTS\Asset Management\release-packages\ckam-release-0b8c525.zip`, **2,152,169 bytes**, SHA-256 **`11f2262e103e0219453e10cf46011a20ec573226a62de97c8fb9ab8527d2022c`**, 215 files (238 zip entries). Folder `ckam-release-0b8c525\` beside it; manifest `MANIFEST.0b8c525.sha256.txt` (SHA-256 `6c27622e…6a95`; `sha256sum -c` passes) |
| Approval phrase | The owner types exactly: **`DEPLOY CKAM RELEASE 0b8c525`** (the push phrase is not a deploy approval) |

## What was checked

- Tests on the committed code: backend 2,538 passed / 6 skipped (the skips need files copied into the container by hand), frontend 1,260 passed, `tsc -b` clean. The browser test `erp-unmatched-vendor.spec.ts` was updated and **not run**.
- Built from `git archive 0b8c525` (no `.git`, no demo files, only `.env.example`), `npm ci` + `VITE_APP_VERSION=0b8c525 npm run build` + `npm run check:build` OK (15 files, no source maps, no Google font host). Built **twice independently**: the two folders are byte-identical and the two zips have the same SHA-256 (reproducible).
- Zip audit (`audit.mjs`): 15/15 exclusion checks PASS (no `.env`, `.map`, tests, keys, dumps, caches, docker files); the secret scan shows only the same variable names and documented dev defaults as for `ccae7b2`.
- **Difference from the live `ccae7b2`, file by file (SHA-256):** only `RELEASE.json`, `backend/VERSION`, `backend/app/erp/router.py`, `frontend-dist/index.html` and the script bundle (`index-Cp5JgQR-.js` → `index-BJmT-4C3.js`). Migrations, `constraints.txt`, `ops/windows/*` and the stylesheet are identical.
- Not done for this small release: Windows PowerShell parse of the package scripts (they are byte-identical to those already run on the server), the Docker pip-install check (the pins are unchanged).

## How it would be deployed (about 2 minutes of downtime)

Same flow as the `ccae7b2` deploy, minus the migrations (record: `docs/security/CKAM_PRODUCTION_DEPLOYMENT_RECORD_ccae7b2.md`, scripts: `docs/security/evidence/deploy_ccae7b2/scripts/`):

1. Run CKAM's backup task on 10.0.0.205 and read `backup.log`.
2. Copy the zip to `<ROOT>\backup\staging-0b8c525\`; check size and SHA-256 above; expand into the **new** folder `<ROOT>\releases\0b8c525` (never over an old one); compare all 215 file hashes with the manifest.
3. Stop `CKAM-Web` (only its python process); `pip install -c backend\constraints.txt -e backend` (nothing new to download); set `FRONTEND_DIST_DIR` and `APP_VERSION=0b8c525` in `shared\.env` (UTF-8, no BOM); `alembic current` must already equal `c6e8a0b2d4f6`.
4. Start `CKAM-Web`; check one listener, both flags, the launcher log names `0b8c525`.
5. `verify_release.ps1 -ExpectedRelease 0b8c525 -LocalProcessCheck Require` must be all PASS; the owner opens *Purchase Orders from the ERP* and sees only the vendors' POs, with the button.

**Rollback:** there is no schema change, so the previous release `ccae7b2` can be started again by setting `FRONTEND_DIST_DIR` / `APP_VERSION` back and running its `pip install -e` (it understands the same schema). Never start `3b5e842` or older (IF-01, and it cannot move assets).

## Not part of this release

Company setup on production is data, not code: the only company ("Citykart Stores", ERP code CKSPL) was deactivated on 2026-10-10 and the app cannot reactivate a company. The owner is creating the companies in Setup. Showing a message when no company is active, and a way to switch a company back on, are separate changes.
