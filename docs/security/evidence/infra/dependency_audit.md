# CKAM dependency and supply-chain audit (area INFRA, 2026-10-15)

Nothing was changed: no `npm audit fix`, no `npm install`, no lock-file edit, no change to `pyproject.toml`.

## How it was run

| Ecosystem | Command | Raw output |
|---|---|---|
| npm, production deps | `npm audit --json --omit=dev` in `frontend/` | `raw/npm_audit_prod.json` |
| npm, all deps | `npm audit --json` in `frontend/` | `raw/npm_audit_all.json` |
| Python, exact versions in the api image | `pip freeze --exclude-editable` in a throw-away copy of the `ckam-sec-api` image | `raw/pip_freeze_image.txt` |
| Python advisories | `pip-audit -r req.txt --no-deps --disable-pip -f json` in a second throw-away copy (removed afterwards) | `raw/pip_audit.json` |

The production server (10.0.1.98) was not inspected. It runs `pip install -e` of the same `pyproject.toml` into `shared\venv` at deploy time. With no lock file, its resolved versions can differ from the image's. See finding IF-11.

## Results

### npm (`frontend/package-lock.json`, lockfileVersion 3, 327 packages)

| Scope | Critical | High | Moderate | Low |
|---|---|---|---|---|
| Production (`--omit=dev`, 141 packages) | 0 | 0 | 0 | 0 |
| All, including dev (185 dev packages) | 0 | 1 | 0 | 0 |

The one high is in a dev-only package:

| Package | Version | Advisory | Runtime or dev | Pulled in by | Reachable from CKAM? | Fix | Assessment |
|---|---|---|---|---|---|---|---|
| `source-map-js` | 1.2.1 | GHSA-68fv-2mgg-jv7q: event-loop DoS from crafted indexed source-map section offsets | **dev / build only**. Not in the built bundle (no `.map` files ship either; verified in the web container) | `vite@8.3.0` → `postcss@8.5.28`; `@tailwindcss/vite` → `@tailwindcss/node`; `jsdom` → `css-tree` | No. It only parses source maps during `vite build` on the developer's machine. CKAM never feeds it untrusted maps. | `fixAvailable: true`, a patch-level bump inside the existing ranges | INFO/LOW. Pick it up with the next routine `npm update`. No compensating control needed. |

### Python (exact versions in the api image, 57 packages)

pip-audit found 3 advisory records across 2 packages. Neither package is called directly by CKAM.

| Package | Version | Advisory | Runtime or dev | Reachable from CKAM? | Fix | Assessment |
|---|---|