# CKAM — Release Candidate Issue Register

Every issue found during a Release Candidate audit (AM-09 onward) is recorded
here, regardless of whether it was fixed. A fixed issue stays in the table
for historical traceability — never delete a row, only update its Fix
Status/Commit/Retest columns.

Priority definitions:

- **P0 — BLOCKER**: data loss, auth bypass, cross-company leak, restore
  impossible, app cannot start, migration broken.
- **P1 — MUST FIX BEFORE RELEASE**: 500 on normal workflow, corrupted
  export/import, critical business flow broken, unsafe default
  credential/secret exposure.
- **P2 — SHOULD FIX SOON**: significant UX/operational weakness but a
  workaround exists.
- **P3 — DEFERRED**: cosmetic/minor/non-V1 enhancement.

## AM-09 (2026-09-24) — Release Candidate Full-System Audit

| ID | Priority | Area | Issue | Evidence | Fix Status | Commit | Retest | Release Blocking |
|---|---|---|---|---|---|---|---|---|
| AM09-01 | P1 | Reports/Export (security) | Every export (Asset Register, Field Change Audit, Movement Log) wrote user-controlled free-text values as raw openpyxl cell values; a value starting with `=` (e.g. in a Description, Brand, Vendor name, Custom Field value, correction Reason, or movement remarks — any of which can originate from Import, an externally-supplied spreadsheet) is auto-flagged as a live formula by openpyxl and executes when the report is opened in Excel. | Confirmed directly: `Workbook().active.append(["=cmd|calc!A1"])` → `cell.data_type == "f"`. Reproduced live via the real API (create an asset with `description="=cmd|'/c calc'!A0"`, export, inspect the raw cell). | Fixed | `4cf98df` | 3 new backend tests, all passing (`test_am09_formula_injection.py`) | Yes — fixed before final verdict |
| AM09-02 | P1 | Lifecycle (robustness) | A caller-supplied `event_date` with no timezone offset (a bare `"2025-06-01"`, valid ISO-8601, not adversarial input) crashed `apply_event`'s `event_date > now` comparison with an unhandled `TypeError` — a raw 500. The real frontend always sends `.toISOString()` (offset-aware) so this never reached the app through its own UI, but a direct API caller supplying a bare date deserves correct handling. | Reproduced live via `POST /api/assets/{id}/events` with `event_date: "2025-06-01"`; confirmed the exact `TypeError: can't compare offset-naive and offset-aware datetimes` in the server traceback. | Fixed | `4cf98df` | 1 new backend regression test, passing (`test_router.py::test_naive_event_date_is_treated_as_utc_not_a_500`) | Yes — fixed before final verdict |
| AM09-03 | P1 | Masters (robustness) | Creating (or updating) any master via the generic `build_master_router` endpoints with a `code` that collides with an existing one (plain unique or company/category-scoped) raised an unhandled `asyncpg.UniqueViolationError` → raw 500, instead of a clean 422. A completely ordinary data-entry mistake (two admins independently picking the same category code), not malformed input. | Reproduced live: `POST /api/masters/categories` twice with the same `code` → second call returned `500` with an empty body; server log showed `sqlalchemy.exc.IntegrityError ... UniqueViolationError: duplicate key value violates unique constraint "asset_category_code_key"`. | Fixed | `4cf98df` | 2 new backend tests, passing (`test_am09_duplicate_code_handling.py`) | Yes — fixed before final verdict |
| AM09-04 | P1 | Holders (robustness) | The same defect as AM09-03, on the bespoke Holders router: creating (or updating) a Holder with an `emp_code` already used in the same company raised an unhandled 500 instead of a controlled 422. | Reproduced live: `POST /api/holders` twice with the same `emp_code`/`company_id` → second call `500`, empty body. | Fixed | `4cf98df` | 1 new backend test, passing (`test_am09_duplicate_emp_code_within_a_company_is_a_controlled_422_not_500`) | Yes — fixed before final verdict |
| AM09-05 | P2 | Deployment / web delivery | `web` (nginx) and `api` (uvicorn) responses carry no `X-Content-Type-Options`, `X-Frame-Options`/frame-ancestors, or `Referrer-Policy` headers; the `Server` header reveals the exact nginx/uvicorn identity (minor fingerprinting). Not evidenced as exploitable in the current LAN-only, HTTP-only deployment model (no third-party page can realistically iframe or MIME-sniff-attack an internal LAN app without already being on the LAN), and adding them is a broad, non-narrow change the AM-09 fix policy (§56/§57) does not authorize automatically. | `curl -D -` against both `/` (web) and `/api/health` (api) shows no security headers beyond nginx/uvicorn defaults. | Documented only | — | — | No |
| AM09-06 | P3 | Deployment / web delivery | No `Cache-Control: no-store` on authenticated API JSON responses — a shared/corporate proxy or browser disk cache could in principle retain a response containing holder emails/phones longer than ideal. Low practical risk for this deployment model (direct browser-to-server on a LAN, no shared forward proxy in the documented architecture). | Same `curl -D -` check as AM09-05. | Documented only | — | — | No |
| AM09-07 | P3 | Frontend build | The production JS bundle (`index-*.js`) is 737.95 kB (222.43 kB gzipped), above Vite's 500 kB chunk-size advisory. Acceptable for a LAN-deployed internal tool (no code-splitting need evidenced), but noted for a future stage if load time on a slow client ever becomes a real complaint. | `npm run build` output: `(!) Some chunks are larger than 500 kB after minification`. | Documented only | — | — | No |
| AM09-08 | P3 | Frontend build / deployment | The app loads Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com`) from an external CDN — a LAN server with no internet egress will fall back to the browser's default font (a visual-only degradation, no functional impact). | `dist/index.html` `<link href="https://fonts.googleapis.com/...">`. | Documented only | — | — | No |
| AM09-09 | P2 | Backup / operations | The nightly backup cron logs success/failure to `/var/log/ckam-backup.log` inside the `backup` container, but nothing actively alerts an operator if a night's backup fails — it must be checked manually (or via an external monitor an operator sets up, out of this app's scope). Per the AM-09 authorization's own instruction, documented in the runbook rather than building alerting infrastructure. | `ops/backup.sh`'s `set -eu -o pipefail` correctly makes a real failure exit non-zero and log to that file, but no notification mechanism exists beyond the file itself. | Documented only (see `CKAM_RELEASE_RUNBOOK.md`, "Backup failure / operational procedure") | — | — | No |

## Carried forward from AM-06/07/08 (unresolved business decisions — not release blockers)

These remain open by deliberate choice, not oversight, and AM-09 did not
resolve them (per the authorization's explicit instruction that their mere
existence is not a release blocker):

- **`holder_company_access`** — written to, never read by authorization.
  Needs a CityKart business answer (is the asset/IT team organizationally
  shared across companies?), not a technical fix.
- **No import-side duplicate detection** — needs a business definition of
  "duplicate" (legacy code? serial number? PO/invoice/PI number?) before any
  rule can be written.
- **5 closed-value DB columns remain unconstrained** (`asset.status`,
  `asset_event.event_type`, `asset_event.status_after`,
  `asset_document.doc_type`) — deliberately left flexible for a future
  approval-workflow stage. AM-09's database integrity audit confirmed every
  current live value is within the recognized set.
- **No bulk correction workflow** — by design, V1 scope.

See `docs/ai/REVIEW_FINDINGS.md` for the full, currently-authoritative list.
