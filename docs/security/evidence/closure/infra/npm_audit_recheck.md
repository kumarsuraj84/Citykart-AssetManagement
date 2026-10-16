# npm audit re-check after the FONTS change (WP-C, 2026-10-16)

`frontend/package-lock.json` changed in WP-C: two packages were added (exact versions, also pinned exactly in
`package.json`), nothing else in the lock file moved (`git diff --stat`: 20 insertions, 0 deletions).

| Package | Version | License | Dependencies | Integrity (lock file) |
|---|---|---|---|---|
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | none | `sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==` |
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 | none | `sha512-eTgnZjZEGk1QtD3ZstF+Vclo2HLAni8YMy34/DxllwZvyz1lR/1RF/xTiAquOBO7MvqBx8D2Ig2WCPMVfdZu7Q==` |

They ship only CSS and font files; only eight `.woff2` files of them end up in the build (see the FONTS section of
`WP-C_closure_evidence.md`).

## Results (run in `frontend/`)

| Command | Result | Raw |
|---|---|---|
| `npm audit --omit=dev` (what ships to users) | **found 0 vulnerabilities** (exit 0) | `raw/npm_audit_prod.json` |
| `npm audit` (incl. build / test tools) | **1 high**: `source-map-js` 1.0.0 – 1.2.1, GHSA-68fv-2mgg-jv7q (event-loop denial of service via indexed source-map section offsets); fix available via `npm audit fix` (exit 1) | `raw/npm_audit_all.json` |

`npm ls source-map-js`: `source-map-js@1.2.1` comes in only through build/test tools — `@tailwindcss/vite` →
`@tailwindcss/node`, `vite` → `postcss`, `jsdom` → `css-tree`. It is not in the production bundle (the build ships no
source maps at all, AU-12, and `npm run check:build` enforces that).

Status: unchanged from the earlier audit — this is observation **OBS-NPM-DEV** (ACCEPT / DEFER to the next routine
`npm update`). WP-C did not run `npm audit fix`, because that would change unrelated build packages outside this
package's scope; the font packages introduced no new advisory.
