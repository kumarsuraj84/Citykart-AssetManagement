# CKAM security release package `ccae7b2`: build and inspection report

This package replaces `eed3de1` (see [PACKAGE_REPORT.md](PACKAGE_REPORT.md); that package was never deployed and is now marked
`SUPERSEDED`). It was built on 2026-10-17 at 04:59 UTC on the dev PC (10.0.0.47, Windows 11), from **committed
content only**, using the same process, rules, layout and exclusions as `eed3de1`.

Nothing was deployed, and no production host, database, NAS or ERP was contacted. The only network traffic went to
the npm registry (`npm ci`) and to the Python package index, from throw-away `python:3.13-slim` containers. No git
write command was run.

| | |
|---|---|
| Release commit | `ccae7b2281bc4ca71f4b6113f61dc86de392bc3e` (short `ccae7b2`), tree `ffd2de554fb2b97043ab3f376a0ec543ed5dcdf1`, branch `worktree-ckam-build`, committed 2026-10-17T10:28:34+05:30 |
| Package folder | `D:\ANKUR AI PROJECTS\Asset Management\release-packages\ckam-security-release-ccae7b2\`: 215 files, 4,307,510 bytes |
| Zip | `D:\ANKUR AI PROJECTS\Asset Management\release-packages\ckam-security-release-ccae7b2.zip`: **2,152,224 bytes**, **238 entries** (215 files and 23 directories) |
| Zip SHA-256 | **`b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`** |
| Content hash (§7) | **`e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b`** |
| Manifest | `release-packages\MANIFEST.sha256.txt`: 216 lines (the zip plus every file in the folder), SHA-256 `cea212577b8701f61af3795bfcc92ad137a2f3e8352a783f0da9adf843691a3b`. `sha256sum -c` passes. A copy is in `raw/MANIFEST_ccae7b2.sha256.txt` |
| Bundle | `frontend-dist/assets/index-Cp5JgQR-.js`, `frontend-dist/assets/index-Bj21ou3B.css` |
| Alembic | 43 revisions in one linear chain, root `62108649b9c8`, **single head `c6e8a0b2d4f6`** |
| Pins | `backend/constraints.txt`: **44 pins**, including `colorama==0.4.6` |

The old package was kept exactly as it was. `release-packages\` contains:

- the old folder `ckam-security-release-eed3de1\` and the old zip `ckam-security-release-eed3de1.zip`, both untouched
  (old content hash still `34a4138e…fec71`);
- `MANIFEST.eed3de1.sha256.txt`, a byte copy of the old manifest made before the new one replaced it (its
  `sha256sum -c` still passes);
- `SUPERSEDED.txt`, which says that the eed3de1 folder, zip and manifest must not be deployed, and why.

## 1. The release commit: what differs from fd34520 outside docs/

`git diff --name-only fd34520..ccae7b2 -- . ':!docs'` lists **exactly four files**:

```
backend/constraints.txt                 (+3 lines: a 2-line comment and colorama==0.4.6; 43 -> 44 pins)
ops/windows/README.md
ops/windows/deploy_ckam.ps1.template
ops/windows/verify_release.ps1
```

`git diff --stat` for these files: 465 insertions and 80 deletions. **`backend/app` and `frontend/` are unchanged** since
`fd34520`, as are every other backend file, `ops/db` and the other `ops/windows` scripts. Between `eed3de1` and
`ccae7b2`, the files changed outside docs/ are the same four. The commit also changed documents and evidence under
docs/, and none of those are packaged.

## 2. Commands run, in order

`<S>` stands for `…\scratchpad\rel2\`. `<R>` stands for `D:\ANKUR AI PROJECTS\Asset Management\release-packages`. The
scripts are in `scripts/` (unchanged from eed3de1: `chain.py`, `mkmtree.mjs`, `audit.mjs`, `winmarkers.py`) and in
`scripts/ccae7b2/` (new or updated: `build.sh`, `contenthash.sh`, `pkgdiff.mjs`, `pipcheck.sh`, `winwheels.sh`,
`manifest.sh`).

1. `git rev-parse HEAD` returned `ccae7b22…bc3e`. `git diff --name-only fd34520..ccae7b2 -- . ':!docs'` is shown in §1.
2. `git archive --format=tar -o <S>\export.tar ccae7b2` (one plain command).
3. `build.sh <export.tar> <clean dir> <release folder> <full sha> ccae7b2 RELEASE.json 1792213114` did the following:
   - extracted the archive into an empty folder (no `.git`, no `CKAM_DEMO_WALKTHROUGH.md`, no `demo-screens`; the only
     `.env*` was `.env.example`, which is not packaged);
   - ran `npm ci` (264 packages), `VITE_APP_VERSION=ccae7b2 npm run build` (vite 8.3.0, 2406 modules) and
     `npm run check:build`, which printed "check:build OK: 15 files …; no source maps, no sourceMappingURL, no Google
     Fonts host, no external resource …";
   - assembled the release folder with `cp`, then used `diff -r` / `cmp` against the export to confirm the packaged
     sources and dist are identical;
   - wrote `VERSION`, copied `RELEASE.json` and ran `touch -d @1792213114`, which sets every file to the commit time
     2026-10-17T04:58:34Z.
4. The whole of step 3 was run a second time, independently: a fresh extraction, a second `npm ci` and build, and a
   second assembly into scratch.
5. `node mkmtree.mjs <folder> pkg.mtree 1792213114` was run for both assemblies, and the two mtree specs are
   byte-identical. Then `C:\Windows\System32\tar.exe --format zip -c -f <R>\ckam-security-release-ccae7b2.zip -C <folder> @pkg.mtree`
   (bsdtar 3.8.4) built the zip. It was zipped once more from the same folder and once from the second assembly.
6. Windows PowerShell 5.1 checks (`raw/windows_ps51_checks_ccae7b2.txt`): `Expand-Archive`, the files the deploy
   script needs, reading `RELEASE.json` the way the deploy template does, and `Parser::ParseFile` of every `.ps1`
   file in the package.
7. `node audit.mjs <zip>` (`raw/zip_audit_ccae7b2.txt`).
8. In throw-away containers:
   - `python -I /tools/chain.py`, offline (`raw/alembic_chain_ccae7b2.txt`);
   - `sh /tools/pipcheck.sh` (`raw/compile_and_pip_install_ccae7b2.txt`);
   - `sh /tools/winwheels.sh` (`raw/windows_wheels_ccae7b2.txt`).
9. `contenthash.sh` was run on the folder, on the `Expand-Archive` extraction, on the second assembly and on the old
   eed3de1 folder. Then `pkgdiff.mjs` compared the old and new packages (§8).
10. `manifest.sh ckam-security-release-ccae7b2 eed3de1` wrote the new manifest and kept the old one, and
    `sha256sum -c` passes for both.
11. Clean-up: the scratch exports, both builds, the test extractions, the extra zips and the mtree files were deleted.
    Every container ran with `--rm`, and `docker ps -a --filter name=ckam-rel` lists nothing.

Tool versions are the same as for eed3de1: Node v24.14.0, npm 11.9.0, vite 8.3.0, bsdtar 3.8.4 / libarchive 3.8.4,
Windows PowerShell 5.1.26100.9168, Python 3.13.15 / pip 26.2.1 in `python:3.13-slim` (image `8d9d0b8bcf65`), and
Docker 29.8.0. uv 0.13.1 was used only inside a throw-away container, for the Windows resolution in §5.

## 3. Package contents (top two levels)

The layout is the same as eed3de1. `backend\` and `frontend-dist\` sit at the top of the zip, with no wrapping
folder.

```
ckam-security-release-ccae7b2\
  RELEASE.json
  backend\    VERSION (ccae7b2281bc4ca71f4b6113f61dc86de392bc3e), alembic.ini, constraints.txt (44 pins), pyproject.toml,
              app\ (185 files: 183 .py + alembic/README + script.py.mako; 43 migrations), scripts\create_owner.py (only script)
  frontend-dist\  index.html, favicon.svg, favicon.webp, icons.svg, logo.png,
                  assets\ index-Cp5JgQR-.js, index-Bj21ou3B.css, 8 self-hosted .woff2
  ops\  windows\ README.md, deploy_ckam.ps1.template, rollback_release.ps1.template, run_ckam_web.ps1.template, verify_release.ps1
        db\      ROLE_SPLIT_RUNBOOK.md, role_split.sql, role_split_verify.sql, check_least_privilege.sql (for the DBA)
```

### RELEASE.json corrections (requested)

- **Release identity.** `release_commit` and `release_commit_short` were added. I also kept
  `release_sha` and `release_sha_short` with the same values. **The new `deploy_ckam.ps1.template` (lines 313-319) reads
  exactly those two names** to stop a deploy when the package is not the release asked for. With only the new names,
  that check would be skipped silently, because `$metaSha` would be empty. The PS 5.1 check confirms the result:
  `-Sha ccae7b2` passes and `-Sha eed3de1` would stop.
- **`code_identical_to_fd34520_except`** lists the four files from §1.
- **`migration_notes`** is now:
  - after `c6e8a0b2d4f6` the **OLD release `3b5e842` can still RECEIVE but CANNOT move, repair, mark lost or found,
    dispose, sell or scrap**: the lifecycle trigger refuses those, and the user sees a misleading HTTP 422; it also
    still has IF-01;
  - **a failed `alembic upgrade head` rolls back all four migrations** (one transaction), leaving the database at
    `e6f8a0b2c4d6`;
  - the new code on the un-migrated schema looks healthy, but nobody can sign in;
  - **roll forward first**, and restore from the pre-deploy dump only on the owner's decision.

  This wording follows `docs/security/CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` §2-3 (GT-F01, GT-F04, GT-F05). The eed3de1
  `RELEASE.json` only said "roll forward only after this", and that text is no longer used.
- **`zip_sha256`** says that the zip's hash is not stored inside the zip, because a file cannot contain its own hash,
  and that it is in `..\MANIFEST.sha256.txt`.
- **Other fields:** `constraints_pins: 44`, `alembic_head: c6e8a0b2d4f6` (which the deploy template now compares
  against), and the four security migrations with their down-revisions.

The file parses as JSON (node, and PowerShell 5.1 `ConvertFrom-Json`). A copy is in `raw/RELEASE_ccae7b2.json`.

## 4. Frontend build checks

| Check | Result |
|---|---|
| `npm run check:build` (both builds) | exit 0, OK, 15 files |
| `*.map` in dist / `sourceMappingURL` / Google font hosts | 0 / 0 / 0 |
| Self-hosted fonts | 8 `.woff2` (Inter latin + latin-ext variable; IBM Plex Mono latin + latin-ext 400/500/600) |
| Served `index.html` | `src="/assets/index-Cp5JgQR-.js"`, `href="/assets/index-Bj21ou3B.css"` (hashed bundles) |
| `VITE_APP_VERSION=ccae7b2` in the bundle | `ccae7b2` appears once in `index-Cp5JgQR-.js`, and `eed3de1` appears 0 times |

The JS bundle is 1,374,250 bytes. The other 14 dist files are byte-identical to eed3de1 (§8).

## 5. Backend checks

| Check | Result |
|---|---|
| Migration chain (`raw/alembic_chain_ccae7b2.txt`) | 43 files and 43 revisions, one root, **one head `c6e8a0b2d4f6`**, no merges, no branch points, linear walk 43/43. Security migrations come last, in order: `f9a1c3e5b7d2` (down `e6f8a0b2c4d6`), `a3c5e7f9b1d4`, `b5d7f9a1c3e5`, `c6e8a0b2d4f6` |
| `python -m compileall -q app scripts` | `COMPILE_OK` |
| `pip install --dry-run -c backend/constraints.txt -e backend` | exit 0. It would install the 43 pins that apply on Linux plus `ckam-backend-0.1.0` |
| Deploy command for real, in a throw-away venv (`pip install -c constraints.txt -e backend`) | exit 0. `pip freeze` = 43 packages, all at the pinned versions, and nothing unpinned. The only pin not installed is `colorama==0.4.6`, **as expected on Linux**: nothing requires it there, and a constraint never installs anything by itself. `alembic heads` from the packaged backend gives `c6e8a0b2d4f6 (head)`. `app_version()` reads `backend/VERSION` and reports `ccae7b2281bc4ca71f4b6113f61dc86de392bc3e` |
| Windows wheels for every pin (`raw/windows_wheels_ccae7b2.txt`) | `pip install --dry-run --no-deps --only-binary=:all: --platform win_amd64 --python-version 3.13` over 43 pins (all except uvloop) exits 0, **including `colorama-0.4.6`**. Every pin has a Windows CPython 3.13 wheel or a pure-Python wheel |
| Windows-only requirements of the pinned wheels | Only `qrcode 8.2` needs `colorama; sys_platform == "win32"`, and that is now pinned. The other Windows markers are extras that are not requested (asyncpg `gssauth`, pydantic `timezone`) or the uvloop exclusion |
| **Full Windows resolution** (`uv pip compile --python-platform x86_64-pc-windows-msvc --python-version 3.13 -c constraints.txt pyproject.toml`) | exit 0. 43 packages resolved for Windows, **every one pinned at its exact version (the "resolved but not pinned" list is empty)**. The only pin Windows does not use is `uvloop==0.22.1`. This closes eed3de1 observation 2 |

**Deploy-side install command** (as in `deploy_ckam.ps1.template` and runbook Phase 4):

```powershell
& "$root\shared\venv\Scripts\python.exe" -m pip install -c "$root\releases\ccae7b2\backend\constraints.txt" -e "$root\releases\ccae7b2\backend"
```

## 6. Adversarial inspection of the zip (`raw/zip_audit_ccae7b2.txt`)

There are 238 entries: 215 files and 23 directories. Uncompressed they total 4,307,510 bytes, and the compressed data
is 2,101,738 bytes. All entry names use forward slashes, and none is absolute, uses `..` or has a drive letter. The
top level contains exactly `RELEASE.json`, `backend`, `frontend-dist` and `ops`.

Largest 15 entries, in bytes:

| Entry | Bytes |
|---|---|
| index-Cp5JgQR-.js | 1,374,250 |
| logo.png | 904,604 |
| index-Bj21ou3B.css | 102,844 |
| inter-latin-ext .woff2 | 85,068 |
| favicon.webp | 66,594 |
| erp/service.py | 49,724 |
| imports/asset_import_service.py | 49,643 |
| inter-latin .woff2 | 48,256 |
| purchase_orders/service.py | 47,985 |
| masters/router.py | 39,510 |
| assets/router.py | 37,946 |
| asset_users/router.py | 35,577 |
| purchase_orders/router.py | 32,857 |
| **ops/windows/deploy_ckam.ps1.template** | 32,581 (new in the top 15: the template grew from 15,291 bytes) |
| erp/router.py | 30,666 |

**Exclusion proof: all 15 assertions PASS, 0 violations.** The zip contains none of the following: `.env*`, `*.map`,
`node_modules`, `.git*`, tests (`tests/`, `e2e/`, `test_*`, `conftest.py`, `*.spec.*` …), `docs`, `demo`, images
outside `frontend-dist`, `*.dump|*.sql.gz|*.bak|*.backup|backups/`, `.pem|.key|.pfx|.p12|.crt|id_rsa|id_ed25519`,
`__pycache__|*.pyc`, coverage or caches, `*.pw`, Docker files, or backend scripts other than `create_owner.py`.

**Secret scan of all 205 text entries** (the other 10 are fonts and images), using the same patterns as eed3de1:

| Pattern | Hits |
|---|---|
| JWT-like `eyJ…` | 0 |
| `BEGIN … PRIVATE KEY` | 0 |
| `PO_SOURCE_PASSWORD=` | 0 |
| AWS keys | 0 |
| long secret literals | 0 |
| URL with credentials | 5 |
| `JWT_SECRET=` | 1 |
| `DATABASE_URL=` | 1 |
| `password = value` | 61 |
| NAS/ERP password words | 2 |

Outside the minified bundle, the hit list (file, line and text) is **identical to the eed3de1 scan**. That includes
the four changed files: the new deploy template, `verify_release.ps1`, the README and `constraints.txt` add no hit.
The classification in [PACKAGE_REPORT.md §6](PACKAGE_REPORT.md) therefore still applies:

- Alembic's template URL `driver://user:pass@`;
- the dev-only fallback `ckam:ckam_dev_pw@localhost` in `config.py` / `alembic/env.py`;
- the `dev_secret_change_me` placeholder, which production refuses (IF-04);
- `<typed at run time>` in the DBA runbook;
- psql variables in `role_split.sql`;
- `$nasPassword`, which is read from `nas.pw` at run time;
- code identifiers, form-field names and redactor comments.

The 18 hits in the bundle are form-field names and validation messages, with the same count as before.

**Verdict: no real secret, key, token or production password is in the package.**

## 7. Reproducibility

| Build | Zip SHA-256 |
|---|---|
| zip of the release folder | `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` |
| second zip of the same folder | `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` |
| zip of the **independent second assembly** (fresh extraction, second `npm ci` + build) | `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` |

- **Byte-identical.** The two mtree specs are byte-identical, and `diff -r` finds no difference between the second
  assembly and the folder.
- **Content hash** `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b`. It is the SHA-256 of
  "`<sha256>␠␠<relative path>`\n" for all 215 files, sorted in C order, and the input is in
  `raw/content_hash_input_ccae7b2.txt`. It is the same for the folder, the `Expand-Archive` extraction and the second
  assembly.
- **Why it is reproducible.** Timestamps are set to the commit time, and the zip is built from a sorted mtree spec
  (fixed time, uid/gid 0, fixed modes). A plain `tar -a` or `Compress-Archive` zip records the directories' access
  times, so two of those zips differ (eed3de1 report §7).
- **The build date is part of the input.** `RELEASE.json` carries the build date `2026-10-17T04:59:40Z`. A rebuild
  that writes a new date changes `RELEASE.json`, and with it the zip hash and the content hash. Every other file is
  unchanged.

## 8. What changed since eed3de1 (file by file, by SHA-256)

`pkgdiff.mjs` over the two content lists found **207 files identical and 9 different** (215 files in each package):

| change | file | SHA-256 in eed3de1 | SHA-256 in ccae7b2 |
|---|---|---|---|
| changed | `RELEASE.json` | `bea0a79250afbc83e093bfedd936d08661e2a90c227e2d3bac2fb6c9858a3207` | `7c33ec9be918b57705db7936239eb986f87a071e0732c13afa19007480fd6f73` |
| changed | `backend/VERSION` | `a428e906aeeb2864f1bb82a324f9683588b8945393529504127018f84c79a36b` | `ee3d2c993ed183d229b13e7852ce686a8383172d54c2a2b39d39f3616a8d28f9` |
| changed | `backend/constraints.txt` | `13f7075a90a06601016334ef5de8bd06b6d6330ddf3f5ce834a4ab50bfbbe85f` | `2e96217b2cea1309c238148d9c12d93c8bc2671409b96ab9a2d4ab2a638ee109` |
| removed | `frontend-dist/assets/index-C42ooaMX.js` | `b2b101f1d3d3b46e8ccf7913a65d43ebcff6b867d5de1e82918f4184cbd79179` | — |
| added | `frontend-dist/assets/index-Cp5JgQR-.js` | — | `64785f86307f4eaa8765a190d7bb1dc473980dd5b6d187599c1b805e184d8755` |
| changed | `frontend-dist/index.html` | `4e5a01ac9c5871ffdd902de62b22fb629530deddf7417a9c90c1048e89f96dee` | `f86b33873dc6dc171f5492282ecd5d586ea13c49293bf70fbf3df05f637216f9` |
| changed | `ops/windows/README.md` | `30e54b0597834e0c81a30e2dd6a7bd7e2caeef51b2406e247756883e3937c82e` | `0b02f44734a363408f1f4280bd660335fd88753e600d0e2bd707f617f5637e7d` |
| changed | `ops/windows/deploy_ckam.ps1.template` | `f0c63ed64d2a069fa57ae244e58bd55a12905faec2441a82fbcad3c07af480a8` | `68182e074949d09b31c2011eb5ee84ddc6f6ae9ae56403834a6598a96c2dcb11` |
| changed | `ops/windows/verify_release.ps1` | `4c4e13398dbd843c7ba024030fbca56643902de1f9ee79aaa50d0f2b162d5bf6` | `b2bb0749f0c7b76e826e649199493e23f1ae4c9f68c3d1e8d177740853e88dd5` |

How each difference arises:

- **`constraints.txt`, the README, `deploy_ckam.ps1.template` and `verify_release.ps1`** are the four commit changes
  listed in §1.
- **`VERSION` and `RELEASE.json`** follow from the new release identity.
- **The JS bundle** has a new hash and so a new file name. Once the embedded release id is swapped
  (`eed3de1` → `ccae7b2`), the old and new bundle texts are **identical**. Only the release id differs, and no
  frontend code changed.
- **`index.html`** differs only because it references the new bundle name.
- **The other 207 files are byte-identical**: all of `backend/app` including the 43 migrations, `alembic.ini`,
  `pyproject.toml`, `create_owner.py`, the CSS, fonts and images, `ops/db`, `run_ckam_web.ps1.template` and
  `rollback_release.ps1.template`.

## 9. Windows PowerShell 5.1 checks (`raw/windows_ps51_checks_ccae7b2.txt`)

**`Expand-Archive` test.** `Expand-Archive -LiteralPath <new zip> -DestinationPath <empty folder>` succeeds and yields
215 files. These entries are all present: `backend\app` (with `main.py`), `backend\constraints.txt`, `backend\VERSION`
(= the full ccae7b2 sha), `frontend-dist\index.html`, `RELEASE.json`, and also `backend\alembic.ini` and
`backend\pyproject.toml`. Those cover the five files the template's completeness check needs (`backend\app\main.py`,
`alembic.ini`, `pyproject.toml`, `constraints.txt`, `frontend-dist\index.html`) plus the `RELEASE.json` it reads.
`diff -r` of the extraction against the folder finds no difference.

**Parser test.** `[System.Management.Automation.Language.Parser]::ParseFile` was run on the copies **inside the zip**:

| File | Parse errors | Tokens |
|---|---|---|
| `deploy_ckam.ps1.template` | **0** | 2858 |
| `verify_release.ps1` | 0 | 2635 |
| `rollback_release.ps1.template` | 0 | 820 |
| `run_ckam_web.ps1.template` | 0 | 692 |

**RELEASE.json test.** It was read with `ConvertFrom-Json`, as the template does, and gives
`release_sha_short = ccae7b2`, `alembic_head = c6e8a0b2d4f6`, which is a valid 12-hex revision id.

## 10. Unusual points

1. **RELEASE.json field names had to be kept for compatibility** (§3). The template reads `release_sha_short` and
   `release_sha`, so I kept both names next to the requested `release_commit` and `release_commit_short`, with a note
   in the file. Had they been renamed, the template's "is this the right package" check would be skipped silently.
2. **Where the old package's markers went.** Because the old and new manifest share the name `MANIFEST.sha256.txt`,
   the old one was **copied** to `MANIFEST.eed3de1.sha256.txt` before the new one was written. `SUPERSEDED.txt` sits in
   `release-packages\`, next to both packages, rather than inside the old folder, so the old folder's contents and
   content hash stay unchanged.
3. **eed3de1 observation 2 is closed.** colorama is pinned, and the full Windows resolution uses only pinned versions.
   Observations 1, 3, 4 and 5 of the eed3de1 report still apply:
   - `release-packages\` is inside the main checkout's working tree and not in its `.gitignore`;
   - `setuptools` is the build backend and is fetched from the index at install time;
   - the dev fallback `DATABASE_URL` is in code;
   - keep `releases\ccae7b2\backend` for as long as the release runs, because the editable install links to it.
4. **`deploy_ckam.ps1.template` has doubled in size**, from 15,291 to 32,581 bytes. This report only checked that it
   parses, that its package and RELEASE.json checks fit this package, and that it contains no secret. Its behaviour
   is covered by the separate rehearsal evidence (`windows_scripts_fix/`, `gate/`), not by this packaging task.
