# CKAM security release package `eed3de1` — build and inspection report

Built 2026-10-17 (UTC 03:38) on the dev PC (10.0.0.47, Windows 11) from **committed content only**. Nothing was
deployed and no server was contacted: no production host, database, NAS or ERP. The only network use was the npm
registry (`npm ci`) and the Python package index, reached from throw-away `python:3.13-slim` containers. No git write
command was run.

| | |
|---|---|
| Release commit | `eed3de17d92b79aee90269dd00bef74ccb26a836` (short `eed3de1`), tree `cd8a769e6eb8b364df0e489f01d821fda0f67856`, branch `worktree-ckam-build` |
| Same code as | `fd345202f127e9abe4d61390817e6064e926c2dd`. `git diff --name-only fd34520..eed3de1` lists 50 paths, **all under `docs/`** (0 outside) (docs/ai/CURRENT_STAGE.md, docs/security/…). backend/, frontend/ and ops/ are identical |
| Package folder | `D:\ANKUR AI PROJECTS\Asset Management\release-packages\ckam-security-release-eed3de1\` (215 files, 4,272,513 bytes) |
| Zip | `D:\ANKUR AI PROJECTS\Asset Management\release-packages\ckam-security-release-eed3de1.zip`, **2,141,099 bytes** |
| Zip SHA-256 | **`be3209af7784bdb837dcf36d25ec1d0158623c26c8822351f5a3256aa1e3d246`** |
| Content hash (see §7) | `34a4138e0917a9c12430095efca5467a0b93b9deb2d435f424bb6136893fec71` |
| Manifest | `release-packages\MANIFEST.sha256.txt` (216 lines: the zip and every file in the folder), SHA-256 `b4aef1a0d2a2ca04d126fa3ecb563d922f42761892fe5eedef6c0eae63602b25`; copy in `raw/MANIFEST.sha256.txt` |
| Alembic | 43 revisions, linear, one root `62108649b9c8`, **one head `c6e8a0b2d4f6`** |

## 1. Commands run, in order

Scratch folder = `C:\Users\User2\AppData\Local\Temp\claude\D--ANKUR-AI-PROJECTS-Asset-Management\33a6302e-4441-4084-94a5-472d20016684\scratchpad\rel\` (`<S>`); release folder = `<R>\ckam-security-release-eed3de1`, where `<R>` = `D:\ANKUR AI PROJECTS\Asset Management\release-packages`.

1. `git rev-parse HEAD` → `eed3de17…a836`; `git diff --name-only fd34520..eed3de1` → only `docs/` paths.
2. `git archive --format=tar -o <S>\export.tar eed3de1`, then `tar -x -f export.tar -C <S>\export`. Checked: no `.git`,
   no `docs/ai/CKAM_DEMO_WALKTHROUGH.md`, no `docs/ai/demo-screens/` (untracked, so not in the archive). The only
   `.env*` in the export is the committed `.env.example`, and it is not packaged.
3. Frontend, in `<S>\export\frontend`: `npm ci --no-audit --no-fund` (264 packages), then
   `VITE_APP_VERSION=eed3de1 npm run build` (`tsc -b && vite build`, vite 8.3.0, 2406 modules), then
   `npm run check:build`, which exits 0 with "check:build OK: 15 files …; no source maps, no sourceMappingURL, no Google
   Fonts host, no external resource in index.html or the stylesheets."
4. Assembly with `cp` from the export (layout in §3). Then `diff -r` / `cmp` of every packaged source against the
   export → identical. `backend\VERSION` = the 40-character sha plus a newline.
5. Migration chain: `docker run --rm --network none -v <release>\backend:/pkg:ro … python:3.13-slim python -I /tools/chain.py /pkg/app/alembic/versions`
   (`raw/alembic_chain.txt`).
6. Compile and install: `docker run --rm … python:3.13-slim sh /tools/pipcheck.sh` (`raw/compile_and_pip_install.txt`)
   and `… sh /tools/winwheels.sh` (`raw/windows_wheels.txt`).
7. Timestamps: `touch -d "2026-10-16 08:43:33Z"` on every file and folder (that is the commit time). Then
   `node mkmtree.mjs <release> pkg.mtree 1792140213`, then
   `C:\Windows\System32\tar.exe --format zip -c -f <R>\ckam-security-release-eed3de1.zip -C <release> @pkg.mtree`
   (bsdtar 3.8.4 / libarchive 3.8.4). §7 explains why the zip is built from an mtree spec.
8. `Expand-Archive` (Windows PowerShell 5.1.26100, the cmdlet `deploy_ckam.ps1` uses) into a scratch folder. All five
   files the deploy script requires were found, and `diff -r` against the release folder showed no difference.
9. `node audit.mjs <zip>` (`raw/zip_audit.txt`). It reads the zip's central directory itself and inflates every entry.
10. `manifest.sh`, which writes `MANIFEST.sha256.txt`, and `sha256sum -c MANIFEST.sha256.txt`, which passes.
11. Reproducibility: a second clean `npm ci` + build from a fresh extraction, a second independent assembly and a
    second zip (§7).
12. Clean-up: the scratch export, the second build, the test extraction and the extra zips were deleted. Every
    container ran with `--rm`; `docker ps -a --filter name=ckam-rel` lists nothing.

The scripts are in `scripts/` next to this report: `chain.py`, `pipcheck.sh`, `winwheels.sh`, `winmarkers.py`,
`mkmtree.mjs`, `audit.mjs`, `manifest.sh`.

## 2. Tool versions

| Tool | Version |
|---|---|
| Node / npm (frontend build) | v24.14.0 / 11.9.0 |
| vite / TypeScript | 8.3.0 / ~6.0.2 (from `package-lock.json`) |
| bsdtar (zip) | 3.8.4, libarchive 3.8.4 (`C:\Windows\System32\tar.exe`) |
| PowerShell (extraction test) | Windows PowerShell 5.1.26100.9168 |
| Python (checks) | 3.13.15 in `python:3.13-slim` (image `8d9d0b8bcf65`), pip 26.2.1 |
| Docker engine | 29.8.0 |

## 3. Package contents (top two levels)

```
ckam-security-release-eed3de1\
  RELEASE.json                 release sha short and full, tree, branch, build date UTC, node/npm, Alembic head + 4 security migrations, components
  backend\
    VERSION                    eed3de17d92b79aee90269dd00bef74ccb26a836
    alembic.ini
    constraints.txt            43 exact runtime pins (IF-11)
    pyproject.toml
    app\                       185 files: 183 .py + alembic/README + alembic/script.py.mako; 43 migrations
                               subpackages: alembic asset_users assets auth bundles core documents erp home imports items
                               lifecycle masters numbering observability purchase_orders reports
    scripts\create_owner.py    the only script
  frontend-dist\               15 files
    index.html, favicon.svg, favicon.webp, icons.svg, logo.png
    assets\                    index-C42ooaMX.js, index-Bj21ou3B.css, 8 self-hosted .woff2 fonts
  ops\
    windows\                   README.md, deploy_ckam.ps1.template, rollback_release.ps1.template,
                               run_ckam_web.ps1.template, verify_release.ps1
    db\                        ROLE_SPLIT_RUNBOOK.md, role_split.sql, role_split_verify.sql, check_least_privilege.sql
                               (for the DBA; not used by this deploy)
```

This matches the layout the documents expect (`ops/windows/README.md`, `deploy_ckam.ps1.template` step 1,
PRODUCTION_INFRASTRUCTURE.md step 2, runbook Phase 4): `backend\{app, alembic.ini, pyproject.toml, constraints.txt,
scripts\create_owner.py, VERSION}` and `frontend-dist\`, with **`backend\` and `frontend-dist\` at the top of the
zip**. There is no wrapping folder, because `deploy_ckam.ps1 -PackagePath` unpacks the zip directly into
`releases\<Sha>\`.

## 4. Frontend build checks

| Check | Result |
|---|---|
| `npm run check:build` | exit 0, OK (15 files) |
| `*.map` files in dist | 0 |
| `sourceMappingURL` anywhere in dist | 0 files |
| `fonts.googleapis` / `fonts.gstatic` / `googleapis.com` | 0 files |
| Self-hosted fonts | 8 `.woff2` present: Inter latin + latin-ext (variable weight), IBM Plex Mono latin + latin-ext at 400/500/600 |
| Served `index.html` | references the hashed bundles `/assets/index-C42ooaMX.js` (module script) and `/assets/index-Bj21ou3B.css` |
| Release id in bundle | `eed3de1` appears in `index-C42ooaMX.js` (what `verify_release.ps1 -ExpectedRelease eed3de1` looks for) |

Dist files with sizes in bytes: index-C42ooaMX.js 1,374,250 · logo.png 904,604 · index-Bj21ou3B.css 102,844 ·
inter-latin-ext-wght 85,068 · favicon.webp 66,594 · inter-latin-wght 48,256 · plex-mono-latin-600 15,620 ·
plex-mono-latin-500 14,888 · plex-mono-latin-400 14,708 · plex-mono-latin-ext-600 14,328 · plex-mono-latin-ext-500
13,432 · plex-mono-latin-ext-400 13,348 · favicon.svg 9,522 · icons.svg 5,031 · index.html 479.
Vite printed its usual "chunk larger than 500 kB" warning for the main bundle. This is known and not a defect.

## 5. Backend checks

* **Migration chain** (`raw/alembic_chain.txt`): 43 files and 43 revisions. One root and one head
  (`c6e8a0b2d4f6`), no merge revisions, no branch points, and the linear walk covers 43 of 43. The four security
  migrations are the last four, in this order:
  40 `f9a1c3e5b7d2` (down `e6f8a0b2c4d6`), 41 `a3c5e7f9b1d4`, 42 `b5d7f9a1c3e5`, 43 `c6e8a0b2d4f6`.
  This matches runbook Phase 4.
* **Compile**: `python -m compileall -q` on `app` and `scripts` (on a copy inside the container) prints `COMPILE_OK`.
* **Install resolution**: `pip install --dry-run -c constraints.txt -e backend` exits 0 and would install exactly the
  43 pinned versions plus `ckam-backend-0.1.0`.
* **The deploy command for real, in a throw-away venv in the container**: `python -m pip install -c
  backend/constraints.txt -e backend` exits 0. `pip freeze --exclude-editable` then equals the 43 pins exactly
  (nothing missing, nothing extra). `import app` resolves to the packaged folder, and `python -m alembic heads` run in
  the packaged `backend` prints `c6e8a0b2d4f6 (head)` without a database. The container was removed afterwards
  (`--rm`), so the install was not kept.
* **Windows wheels** (`raw/windows_wheels.txt`): `pip install --dry-run --no-deps --only-binary=:all: --platform
  win_amd64 --python-version 3.13` for the 42 pins other than uvloop exits 0. Every pinned version has a Windows
  CPython 3.13 wheel or a pure-Python wheel. uvloop is skipped because `uvicorn[standard]` only asks for it when
  `sys_platform != 'win32'`.

**Deploy-side install command** (unchanged from `deploy_ckam.ps1.template` step 6 and runbook Phase 4 step 2; checked
above on the same layout):

```powershell
& "$root\shared\venv\Scripts\python.exe" -m pip install -c "$root\releases\eed3de1\backend\constraints.txt" -e "$root\releases\eed3de1\backend"
```

`deploy_ckam.ps1 -Sha eed3de1 -PackagePath <copy of the zip> -BackupConfirmed|-BackupHook …` runs this command
itself, after it has expanded the zip into `releases\eed3de1\`.

## 6. Adversarial inspection of the zip (`raw/zip_audit.txt`)

Entries: **238** (215 files and 23 directory entries; the three top-level folders have no entry of their own because
the file paths imply them). Uncompressed total 4,272,513 bytes; compressed data 2,090,613 bytes. Every name uses
forward slashes. There are no absolute paths, no drive letters and no `..`. The top-level names are exactly
`RELEASE.json`, `backend`, `frontend-dist` and `ops`.

Largest 15 entries (bytes): frontend-dist/assets/index-C42ooaMX.js 1,374,250 · frontend-dist/logo.png 904,604 ·
frontend-dist/assets/index-Bj21ou3B.css 102,844 · inter-latin-ext-wght-normal .woff2 85,068 · frontend-dist/favicon.webp
66,594 · backend/app/erp/service.py 49,724 · backend/app/imports/asset_import_service.py 49,643 · inter-latin-wght-normal
.woff2 48,256 · backend/app/purchase_orders/service.py 47,985 · backend/app/masters/router.py 39,510 ·
backend/app/assets/router.py 37,946 · backend/app/asset_users/router.py 35,577 · backend/app/purchase_orders/router.py
32,857 · backend/app/erp/router.py 30,666 · backend/app/erp/changes.py 29,597.

### Exclusion proof: assertions on every entry name (all PASS, 0 violations)

| Must not contain | Result |
|---|---|
| `.env` / `.env*` (incl. `.env.example`) | PASS |
| `*.map` | PASS |
| `node_modules` | PASS |
| `.git`, `.gitignore`, `.gitattributes` | PASS |
| tests: `tests/`, `test/`, `e2e/`, `__tests__/`, `test_*`, `*_test.py`, `conftest.py`, `*.test.*`, `*.spec.*` | PASS |
| a `docs` folder (incl. docs/security evidence) | PASS |
| anything named `demo` | PASS |
| images outside `frontend-dist` (screenshots) | PASS |
| dumps or backups: `*.dump`, `*.sql.gz`, `*.bak`, `*.backup`, `backups/` | PASS |
| keys or certificates: `.pem`, `.key`, `.pfx`, `.p12`, `.crt`, `id_rsa`, `id_ed25519` | PASS |
| `__pycache__`, `*.pyc` | PASS |
| coverage or caches: `.coverage`, `htmlcov`, `.pytest_cache`, `.ruff_cache`, `.mypy_cache` | PASS |
| password files (`*.pw`, e.g. `nas.pw`) | PASS |
| Docker files (`Dockerfile`, `docker-compose*`, `.dockerignore`) | PASS |
| backend scripts other than `create_owner.py` (seed_admin, seed_uat_personas, build_e2e_import_fixture, `__init__`) | PASS |

The two `.md` files in the package (`ops/windows/README.md`, `ops/db/ROLE_SPLIT_RUNBOOK.md`) are the requested
operator runbooks that ship with the reference scripts. They do not come from `docs/`.

### Secret scan: every text entry (205 of 215; the other 10 are 8 woff2 files, the png and the webp)

Patterns: JWT-like `eyJ….…`; `BEGIN … PRIVATE KEY`; `password\s*[:=]\s*\S+`; `scheme://user:pass@`;
`DATABASE_URL=`; `PO_SOURCE_PASSWORD=`; `JWT_SECRET=`; NAS/ERP/ckpost/ckappuser/superuser password assignments;
`AKIA…` AWS keys; long quoted values assigned to secret/token/api_key.

| Pattern | Hits | Verdict |
|---|---|---|
| JWT-like `eyJ…` | 0 | — |
| `BEGIN … PRIVATE KEY` | 0 | — |
| `PO_SOURCE_PASSWORD=` | 0 | — |
| AWS key, long secret/token literal | 0 | — |
| URL with credentials | 5 | `backend/alembic.ini:89` `driver://user:pass@localhost/dbname` is Alembic's template placeholder, never used (env.py reads DATABASE_URL). `backend/app/alembic/env.py:17` and `backend/app/core/config.py:17` hold the **dev-only fallback** `ckam:ckam_dev_pw@localhost:5432/ckam`, which is the local Docker dev database (see the observations). `backend/app/observability/redact.py:39` (×2) is comment text in the log redactor (`scheme://user:password@host -> scheme://user:***@host`). |
| `JWT_SECRET=` | 1 | `backend/app/core/config.py:8` `DEFAULT_DEV_JWT_SECRET = "dev_secret_change_me"` is a placeholder. In production the app refuses to start with it (IF-04, `main.py` `_KNOWN_INSECURE_JWT_SECRETS`), and so does `deploy_ckam.ps1`'s pre-check. |
| `DATABASE_URL=` | 1 | `ops/db/ROLE_SPLIT_RUNBOOK.md:117` `…ckasset_migrator:<typed at run time>@10.0.0.205…` is a placeholder; the password is typed by the DBA. |
| `password = value` | 61 | All of these are code identifiers or doc text, not secrets: schema and model fields (`must_change_password`, `temp_password: str`, `has_password`), `temp_password = secrets.token_urlsafe(9)` (a random value generated at run time, in the RBAC migration, `asset_users/service.py` and `create_owner.py`), `password=settings.po_source_password` (read from the environment), redactor comments, psql variables in `ops/db/role_split.sql` (`PASSWORD :'migrator_password'`, given at run time), and form-field names and validation messages in the minified bundle. |
| NAS/ERP password words | 2 | `ops/windows/run_ckam_web.ps1.template:117,125`: `$nasPassword` is read from `shared\nas.pw` at run time and then cleared to `$null`. |

**Verdict: no real secret, key, token or production password is in the package.**

Other content noted during the scan:
* `backend/scripts/create_owner.py` hard-codes the first owner's name, work email and employee code. This is by design
  (see its docstring) and it was already shipped in earlier releases.
* Internal IP addresses appear only in the ops documents and templates: 10.0.0.205 (DB server), 10.0.0.25 (NAS, the
  launcher's default share), 10.0.1.98 (app server). 10.0.1.12 appears only in warnings that it is retired and
  must stay off. `RELEASE.json` names the build PC 10.0.0.47.

## 7. Reproducibility

* **Frontend**: a second, fully separate build (a fresh extraction of the same `export.tar`, `npm ci`,
  `VITE_APP_VERSION=eed3de1 npm run build`, `check:build` OK) produced the **same 15 file names and the same SHA-256
  for every file** as the first build. The vite output is deterministic for the same lockfile, Node and `VITE_APP_VERSION`.
* **The zip is byte-identical when rebuilt from the same folder, and when rebuilt from an independent second
  assembly**. That assembly used the same export, the second frontend build and the same `RELEASE.json`, and gave
  zip SHA-256 `be3209af…d246` both times. This needs two steps, and both are now part of the process:
  1. The timestamps are normalised to the commit time, 2026-10-16T08:43:33Z (epoch 1792140213).
  2. The zip is built from a sorted mtree spec (`mkmtree.mjs`) with fixed time, uid/gid 0 and fixed modes.
  The first attempt zipped the folder directly (`tar -a -c -f … RELEASE.json backend frontend-dist ops`), and two
  runs differed in 28 bytes. bsdtar's zip writer stores an extended-timestamp field that includes each directory's
  **access time**, and reading the folder changes that time. A plain `tar -a` or `Compress-Archive` zip of this
  folder is therefore **not** byte-identical between runs, although its contents are. bsdtar on this host has no
  `-s`, which is why the mtree names carry no `./` prefix and the top-level folders have no entry of their own.
* **`RELEASE.json`** contains the build date (`2026-10-17T03:38:14Z`). A rebuild on another day with a new date gives a
  different `RELEASE.json` hash, and so a different zip hash and content hash. Everything else is unchanged.
* **Content hash**: `34a4138e0917a9c12430095efca5467a0b93b9deb2d435f424bb6136893fec71`. This is the SHA-256 of the
  text "`<sha256>␠␠<path relative to the release folder>`\n" for all 215 files, sorted by path in C (byte) order. The
  input is in `raw/content_hash_input.txt`. The same value was computed for the release folder, for the `Expand-Archive`
  extraction of the zip, and for the second independent assembly. It does not depend on timestamps or on the zip tool.

## 8. Unusual points and observations (nothing here blocks the release)

1. **The package location is inside the main checkout's working directory.** `D:\ANKUR AI PROJECTS\Asset Management`
   is itself a git working tree (it has its own `.git`), and `release-packages/` is not in its `.gitignore`. A
   `git status` in the main checkout (not this worktree) would show `release-packages/` as untracked. It must never
   be added there. Adding `release-packages/` to that `.gitignore` is the owner's choice; this engineer did not touch it.
2. **Windows installs `colorama` without a pin.** On win32, `qrcode 8.2` declares `colorama` as a requirement, and
   `constraints.txt` (taken from the Linux dev container) has no pin for it. The production install therefore takes the
   newest `colorama` from the index. This is a small gap against IF-11 on Windows only: colorama is a console-colour
   helper and is not on any request path. Adding `colorama==<tested version>` to `constraints.txt` would close it
   (a code change, not made here). No other Windows-only runtime requirement exists: the remaining markers are extras
   that are not requested, such as asyncpg `gssauth` and pydantic `timezone`.
3. **Build tool unpinned.** `pyproject.toml` has no `[build-system]` table, so `pip install -e` builds the project
   with the newest `setuptools`, fetched into pip's isolated build environment. The server therefore needs to reach
   the package index, or a local wheel folder, during the install. That was already true, and the README says so.
4. **Dev fallback credentials in code.** `config.py` and `alembic/env.py` fall back to
   `postgresql+…://ckam:ckam_dev_pw@localhost:5432/ckam` when `DATABASE_URL` is missing. It is a dev-only value
   (the Docker dev database, also in CLAUDE.md), not a production credential. `deploy_ckam.ps1` stops if
   `DATABASE_URL` is missing from `shared\.env`, but the app itself does not refuse the dev URL in production the way it
   refuses the dev JWT secret. This is a possible later hardening item and is not changed here.
5. The editable install points the venv at `releases\eed3de1\backend`. **Keep that folder** for as long as this
   release runs, and keep the previous release folder until the rollback window has passed.
6. `backend\VERSION` holds the full sha. The deploy script also sets `APP_VERSION=eed3de1` in `shared\.env`, and that
   value takes precedence in `app_version()`. Runbook Phase 5 step 1 only needs VERSION to contain the release sha,
   and it does.
