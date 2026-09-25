# AM-11 — Phase-1 Gap Review — Report

## 1. Executive summary

AM-11 answers one question: *is CKAM now good enough to run CityKart Asset
Management Phase 1*, from a business-operations perspective, not only a
technical one. Production deployment remains deferred — there is
currently no production server — so this stage resumed active
development against the existing DEV/UAT environment, with feature
freeze lifted specifically for justified Phase-1 gap closure (not
speculative feature growth).

The review built a full current-capability map, re-examined CKAM against
the legacy ThreadERP system as domain evidence (read-only, a genuinely
populated 12,862-asset production instance), walked through the app as
ADMIN, VIEWER, and HOLDER in a real browser against freshly-seeded,
clearly-tagged UAT data, and inspected the Asset Register, Dashboard,
Asset 360, and search implementation directly against their own source.

Two evidenced, narrow, MUST-HAVE gaps were found and fixed: the Asset
Register could not show who currently holds an asset or which company it
belongs to without opening every row individually — a direct conflict
with CKAM's own stated core guarantee — and asset search did not cover
the Description field. Both were fixed with small, low-risk, already-
proven patterns (a page-scoped batch label lookup, matching the pattern
`export_service.py` already uses; a one-line search-clause addition).
Four SHOULD-HAVE gaps and several Phase-2/not-required items were
documented in `PHASE1_GAP_REGISTER.md` without being implemented, per
this stage's own change-policy discipline.

The legacy ThreadERP comparison **confirmed, rather than challenged**,
CKAM's existing locked V1 scope decisions: ThreadERP's extensive AMC/
Insurance/Depreciation/Market-Valuation/Approval-Workflow/Asset-
Verification functionality is exactly the breadth CKAM's own governance
already, deliberately excludes for a physical-custody-lifecycle tracker,
not a finance/accounting ERP module.

**Final AM-11 verdict: PHASE-1 READY WITH MINOR ENHANCEMENTS.**

## 2. Change in project direction

Production deployment is **deferred** — there is currently no production
server. AM-10's evidence, documents, regression baselines, security
findings, and backup/restore evidence are all preserved and remain valid;
none of it is discarded. AM-10's own local release tag,
`ckam-v1.0.0-rc1`, is preserved unmoved (verified §5). Development has
resumed against the existing DEV/UAT environment for application review,
feature testing, business-process validation, enhancements, and bug
fixes — explicitly framed as **Phase-1 completion work**, not production
preparation. Feature freeze, previously in effect for AM-08 through
AM-10's release-readiness focus, is **lifted** specifically for justified
Phase-1 gap closure (evidenced by an existing requirement, legacy domain
evidence, a current workflow gap, direct feedback, or demonstrated
operational need) — not for speculative enterprise features.

## 3. Git preflight

- Absolute path: `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build`.
- Branch: `worktree-ckam-build`.
- HEAD at AM-11 start: `c2c8c039602c861bd3d41272b9a12fae2bbd969d` (AM-10
  report/governance commit).
- `git status` at AM-11 start: clean.
- `git tag --list`: `ckam-v1.0.0-rc1`, pointing at the same commit as HEAD
  at AM-11 start — confirmed unmoved (§5).
- No `pull`/`push`/`merge`/`rebase`/`reset`/`clean`/branch-switch/remote-
  config change was performed. No push occurred at any point in this
  stage.

## 4. Current HEAD

At the point this report was written (before the report/governance
commit): `9607193` (`feat(assets): AM-11 -- Asset Register shows current
Holder/Company, search covers Description`) — see §43/§44 for the exact
hash and the final HEAD after this report's own commit.

## 5. Existing rc1 tag verification

`git tag --list` confirmed `ckam-v1.0.0-rc1` still exists and
`git log -1 --format=%H ckam-v1.0.0-rc1` confirmed it still points at
`c2c8c039602c861bd3d41272b9a12fae2bbd969d` — the exact AM-10 report
commit, unchanged and unmoved. AM-11's own development commits sit
**after** this tag, on the same branch, exactly as intended: `rc1` remains
the frozen AM-10 readiness checkpoint; AM-11 is post-RC development.

## 6. Regression baseline

Independently re-run before any AM-11 change:

- Backend: 305/305 passing.
- Frontend: 148/148 passing (25 files), `npx tsc -b` clean.
- E2E: 5/5 passing.
- `docker compose exec api alembic current`: `f28b6a913dce (head)`.

All figures matched the expected AM-10 baseline exactly.

## 7. Current CKAM business capability map

| Business Capability | Current CKAM | Fully Ready? | Partial? | Missing? | Evidence | Operational Risk | Phase-1 Required? | Recommendation |
|---|---|---|---|---|---|---|---|---|
| Single asset creation | Full sectioned Add Asset form, all procurement/PI/vendor/tax/warranty/custom fields, server-generated Asset Code | ✅ Fully Ready | | | AM-04 through AM-06 reports; re-confirmed live this stage | Low | Yes | None |
| Quantity/batch creation | Sequential codes, one savepoint per row, shared procurement data | ✅ Fully Ready | | | AM-02/06 reports, existing test suite | Low | Yes | None |
| Custody: IT Stock/Employee/Store/Installed | 4 holder types, correctly modeled, role-gated writes | ✅ Fully Ready | | | AM-01/05 reports; re-confirmed live | Low | Yes | None |
| Holder creation/deactivation | Full CRUD + Deactivate, required-field enforcement, role-security tested | ✅ Fully Ready | | | AM-05/08 reports | Low | Yes | None |
| Lifecycle (Procure→Stock→Assign→Return→Reassign, Repair, Lost/Found, Dispose/Sold/Scrapped) | Full state machine, append-only ledger, all states reachable via UI actions | ✅ Fully Ready | | | AM-01/AM-09 §17-18; re-exercised live this stage (a real MOVED event) | Low | Yes | None |
| Correction (classification/purchase-date) | Dedicated workflow, mandatory reason, audit trail, chronology invariant | ✅ Fully Ready | | | AM-07 report | Low | Yes | None |
| Import (template/preview/commit/Quantity/procurement/UDF) | Full V1 field support, VALID-ROWS-ONLY, 30+ backend tests | ✅ Fully Ready | | | AM-06 report, AM-09 §26/§49 scale test | Low | Yes | None |
| Reports (Asset Register/Movement Log/Field Change Audit) | 3 canonical exports, company/holder-scoped, formula-injection-safe (AM-09) | ✅ Fully Ready | | | AM-06/09 reports | Low | Yes | None |
| Masters (Company/Location/Department/Cost Centre/Category/Subcategory/Vendor/Custom Fields/Code Rule) | Full CRUD + Edit + Deactivate on every master, company/Global scoping on Custom Fields | ✅ Fully Ready | | | AM-05 report | Low | Yes | None |
| Security (ADMIN/IT_TEAM/VIEWER/HOLDER) | Full role matrix tested via direct API calls (AM-09), company/holder isolation proven | ✅ Fully Ready | | | AM-09 §11-13 | Low | Yes | None |
| Documents (asset attachments) | Upload/list/download, extension allowlist, bounded-read size cap, path-traversal-proof storage | ✅ Fully Ready | | | AM-09 §56 | Low | Yes | None |
| Asset Register — findability | Search, Status/Category/Holder/Company filters, pagination | | 🟡 Partial (before this stage) | Holder/Company columns; description search | Live walkthrough this stage | Medium (daily friction) | Yes | **Fixed this stage** (G01/G02) |
| Dashboard — operational control | 2 KPI cards, Stock-by-Location, Warranty-Expiring-Soon, Allotted-Over-180-Days | | 🟡 Partial | Repair/Lost/Disposed exception counts, recent-activity feed | Live walkthrough this stage | Low-Medium | Should have | Documented (G03), not implemented |
| Asset 360 | Overview/Procurement/Custody/Custom Fields/History/Changes/Documents, QR + Print Label | ✅ Fully Ready | | | AM-04 report; re-confirmed live this stage | Low | Yes | None |
| Search — findability | Code/legacy code/serial/PO/invoice/PI, now + description | ✅ Fully Ready (after this stage's fix) | | | Code read + live verification this stage | Low | Yes | **Fixed this stage** (G02) |

## 8. ThreadERP domain comparison

Logged into the legacy ThreadERP instance (`http://10.0.0.27`, a real,
populated production system — 12,862 total assets, ₹27.1M+ in asset
value) strictly **read-only**: no record was created, edited, or deleted.
Explored: Dashboard, the full Masters catalogue (Book, Period, Location,
Department, Asset User, Custodian, Asset Cost Center, Head Block, Asset
Block, Head Category, Asset Category, Asset Sub Category, Asset Category
Nature, Asset Group, Asset Document Type, Warranty Type, UDF Master,
Barcode/QRcode Profile), the full Transaction menu (Add New Asset, Fixed
Asset Register, Asset WIP, Asset Disposal, Asset Adjustment, Asset AMC,
Asset Insurance, Asset Market Valuation, Asset Verification, Verified
Assets, Asset Shift, Asset Split, Transfer To/From General Reserve,
Delete Non-Transactional Asset, Retrospective Effect, Asset Workflow
[Submission Of Asset, Pending Approval], Asset Movement [Record New
Movement, Pending For Approval, All Records]), the full Reports catalogue
(Non-Statutory: ~25 reports including Asset Acquisition, Disposal,
Adjustment, Shift Details, WIP History, Asset Split, Cost Breakup, Print
Asset Card, Asset Ledger, Asset Verification, Insurance/AMC/Warranty
expiry + not-covered reports, Asset UDF Report, Asset Barcode/QR Card,
Assetinfo-QR; Statutory: Fixed Asset Register, Fixed Asset Register
[Groupwise]), and the Add New Asset form's full field set across its
Asset Details tab (Item Nature, Ownership Type, Record Type, Asset Type,
Inward Type, Parent Asset, Block, Category, Sub Category, Department,
Custodian, Asset Group, Asset Cost Center, 3-level Location, Asset Code,
Asset Description, Physical No, Purchase Date, Cost, Cenvat/CGST/SGST/
IGST, Use Date, Estimated Life, Expiry Date, Asset User, Measurement
Unit, Quantity, Quantity Wise Depreciation, Remarks — plus 5 more tabs:
Asset Cost, Asset Rates, Other Details, Voucher, Asset Images).

**Key finding: ThreadERP is a full accounting-grade fixed-asset/
depreciation ERP module. CKAM is deliberately narrower — a physical
custody-lifecycle tracker.** This comparison **confirms** CKAM's own
already-locked V1 scope decisions (`docs/ai/DECISIONS.md`: no approval
workflow, no AMC/insurance, no depreciation/accounting, no physical
verification) rather than surfacing a reason to widen them — see the full
legacy-concept table in `PHASE1_GAP_REGISTER.md` (G08-G13) for the
detailed row-by-row comparison. Two genuinely useful, narrow observations
did come out of this comparison and were investigated further: warranty-
expiry visibility (already covered — CKAM's Dashboard has a "Warranty
Expiring Soon" widget, found live, see §15) and the Asset Register's own
findability gaps (fixed this stage, §7/§12/§16).

## 9. Phase-1 workflow review

The full operating cycle named in the authorization — Setup → Procurement/
Entry → Stock/Custody → Allocation → Transfer/Return/Reassignment →
Repair/Lost/Found → Disposal/Sold/Scrapped → Asset Detail/History → Bulk
Import → Reporting → User/Master Administration — was walked end-to-end
across AM-01 through AM-09's own extensive prior UAT (each transition
individually verified with real, live-browser evidence in its own stage)
and re-confirmed live this stage: a real UAT asset was created, procured
into stock, and moved (`MOVED` event) into an employee's custody, with
Asset 360 correctly reflecting "Held by UAT AM11 Employee Holder
(employee) · Head Office" immediately afterward. Every named stage of the
cycle has a working, role-gated, tested implementation. No stage of the
cycle is missing end-to-end — the gaps found this stage (§7, §12) are
about *visibility/findability within* the cycle (the register not showing
custody, search not covering description), not about a missing capability
in the cycle itself.

## 10. ADMIN walkthrough

Logged in live as a fresh UAT ADMIN account. Dashboard: 2 KPI cards (IN
STOCK/ALLOTTED), Stock-by-Location, Warranty-Expiring-Soon, Allotted-
Over-180-Days — all rendered correctly with real data, though mixing
every company's location names together with no per-company grouping
(§13, G04). Navigation: a clear, labeled sidebar (Dashboard, My Assets,
Asset Register, Add Asset, Import, Reports, then Masters/Administration
grouped separately) — unambiguous, no hidden or unlabeled icons (unlike
ThreadERP's own icon-only collapsed default state, which required
expanding to become legible — CKAM's sidebar is legible by default).
Asset Register: found the Holder/Company visibility gap here (§7, fixed).
Asset 360: excellent clarity — "Held by X (type) · Location" stated in
plain language directly under the header, action buttons (Move/Transfer,
Send for Repair, Report Lost) clearly labeled, QR + Print Label
immediately visible. Overall: ADMIN's daily workflow is clear and
business-friendly, with the one register-visibility gap now fixed.

## 11. IT_TEAM walkthrough

Not re-walked fresh in the browser this stage — IT_TEAM's capability
boundary (masters + asset writes, reports; not holders/users or code
rule) was already exhaustively verified via direct API calls across the
AM-08/AM-09 role-matrix sweeps (15 capabilities × 4 roles, zero
over-permission found), and IT_TEAM shares the identical Asset Register/
Asset 360/Dashboard UI surface ADMIN uses (role-gated by button
visibility, not by a separate screen) — the register/search fixes this
stage benefit IT_TEAM identically, with no IT_TEAM-specific UI to
separately inspect.

## 12. VIEWER walkthrough

Logged in live as a fresh UAT VIEWER account. Dashboard correctly scoped
to the VIEWER's own company only (confirmed: KPI counts and Stock-by-
Location matched exactly the 3 UAT assets in that one company, no other
company's data visible). Navigation drawer correctly shows Dashboard/My
Assets/Asset Register/Reports — no write-capable screens (Add Asset,
Import, Masters, Holders) appear at all, not merely disabled, which is
the correct, honest pattern (`DEVELOPMENT_GUARDRAILS.md`: "every visible
action either works, is disabled with a clear reason, or isn't shown").
One minor observation: "My Assets" appears in VIEWER's nav even though a
VIEWER-role account is never itself a holder of anything and this screen
will always be empty for that role — a small navigation-clarity nit, not
a functional defect (the screen behaves correctly, just never has
content for this role). Not classified as a gap requiring action — see
`PHASE1_GAP_REGISTER.md` for why this was judged too minor to warrant its
own row.

## 13. HOLDER walkthrough

Logged in live as a fresh UAT HOLDER account. Lands directly on "My
Assets" (not Dashboard, correctly 403'd for this role) — a clean, minimal
table (Code/Description/Status) showing exactly the one asset in this
holder's custody. The asset code is a real link into a read-only Asset
360 view: confirmed no Edit/Correct Classification/Move/Send for Repair/
Report Lost buttons render at all for this role (not merely disabled),
matching the authorization matrix exactly — but QR + Print Label remain
visible, which is correct and useful (a holder can print or show their
own asset's label without needing write access). Overall: HOLDER's
experience is intentionally minimal and correctly scoped — no friction
found.

## 14. Asset Register review

**Columns (before this stage):** Code, Description, Status only — no
Holder, no Company, no Location. **Search (before this stage):** Asset
Code, legacy code, Serial Number, PO Number, Invoice Number, PI Number —
no Description. **Filters:** Status, Category, Holder, Company — all
already present and working correctly. **Pagination:** server-side,
50/page, correct total-count display — unchanged, already good.

Both findable gaps (§7 G01/G02) were fixed this stage: two new columns
(Holder, Company), populated via a page-scoped batch lookup (only the
distinct ids on the current page — never a full-table fetch, keeping the
existing N+1-avoidance discipline the endpoint already had for its
20,000-asset target); and Description added to the search clause.
**Location was deliberately not added as a register column** — a holder's
own location is already visible one click away on Asset 360, and adding
it to the list response would mean a third batch lookup (via Holder→
Location) for a field with materially lower daily-use value than
Holder/Company themselves; not evidenced as needed this stage.

## 15. Dashboard review

Answers, from the authorization's own checklist: **how many assets** —
partially (IN STOCK + ALLOTTED counts, not a single "total" card like
ThreadERP's); **where are they** — yes (Stock by Location); **how many
assigned** — yes (ALLOTTED count); **how many in stock** — yes (IN STOCK
count); **repair** — **no**; **lost** — **no**; **disposed** — **no**;
**exceptions** — partially (Allotted-Over-180-Days is a real exception
widget); **recent activity** — **no**. Also already answers, correctly
and usefully, two things the checklist didn't explicitly ask for but
matter operationally: **warranty expiring soon** (a real, working widget
— directly answers the legacy-ThreadERP-evidenced "Expiry Report -
Warranty" need, already satisfied, not a gap) and **assets held too long
without movement** (Allotted-Over-180-Days). The missing Repair/Lost/
Disposed/recent-activity visibility is recorded as G03 (SHOULD HAVE, not
implemented this stage — see `PHASE1_GAP_REGISTER.md` for the reasoning).

## 16. Add Asset review

Not re-walked fresh in the browser this stage — extensively, repeatedly
verified across AM-04 through AM-09 (full sectioned form, every
procurement/PI/vendor/tax/warranty/custom field reachable, required-UDF
enforcement, company-scoped Cost Centre dropdown fixed in AM-08). No new
finding this stage. The one adjacent observation — ThreadERP's Add New
Asset form has an "Add Image" field CKAM lacks as a first-class field —
is recorded as G06 (CAN WAIT; a workaround already exists via the
Documents tab).

## 17. Asset 360 review

Confirmed live, twice this stage (as ADMIN and as HOLDER): location
clarity (stated in plain language under the header — "Held by X (type) ·
Location"), holder clarity (same), warranty visibility (present as a
field on the Procurement tab, plus now surfaced proactively on the
Dashboard), cost visibility (Procurement tab), and full status-history
clarity (History tab, distinct from the Changes/correction-audit tab).
"Last movement" and "asset age" are not separately, explicitly surfaced
as their own labeled fields, but both are directly derivable from the
existing History tab (the most recent event *is* the last movement; the
Purchase Date *is* the basis for age) — not classified as a gap, since
the information already exists and is one tab-click away, not absent.

## 18. Lifecycle review

Re-exercised live this stage (a real `MOVED` event on a freshly-created
UAT asset, `IN_STOCK → ALLOTTED`, correctly recorded with `from_holder_id`/
`to_holder_id`/a human-readable `label` field — "Allotted to UAT AM11
Employee Holder" — generated server-side). No new finding — matches the
extensive, already-passing AM-01/AM-07/AM-09 lifecycle evidence exactly.

## 19. Import review

Not re-walked fresh in the browser this stage — AM-06's own extensive
coverage (30+ backend tests covering every documented case: valid row,
invalid Cost Centre/Holder/Category/Subcategory, unknown Vendor, unknown/
wrong-company/missing-required/invalid-type UDF, bad date/number,
Quantity > 1, mixed valid/invalid rows) plus AM-09's own 100-row scale
sanity test (§49 of that report) remain current and unchanged — no
backend/frontend import code was touched this stage.

## 20. Reports review

Not re-walked fresh in the browser this stage — all three canonical
exports (Asset Register, Movement Log, Field Change Audit) remain
unchanged and were already re-verified clean in AM-09 (including the
formula-injection fix). §15 above covers the one new finding this stage
made about report/dashboard coverage generally (the Dashboard's own
Warranty-Expiring-Soon widget already covers the one ThreadERP-evidenced
reporting need investigated this stage).

## 21. Masters review

Not re-walked fresh in the browser this stage — AM-05's own extensive
coverage (Edit added to every master, company/Global Custom Field
scoping, Holder Deactivate, Code Rule ordering tests) remains current. No
backend/frontend masters code was touched this stage.

## 22. Holders review

Not re-walked fresh in the browser this stage — AM-05/AM-08's own
coverage (Deactivate, role-change warning, required-field enforcement,
defensive reference validation) remains current. No holders code was
touched this stage.

## 23. Search/findability review

**Before this stage:** Asset Code, legacy code, Serial Number, PO/
Invoice/PI Number — all working correctly; Description — **missing**
(§7 G02, fixed). Holder/Store/Location lookup: the register's own Holder
filter dropdown already exists and works (unchanged); a location-specific
filter does not exist as its own dimension, but Holder scoping combined
with each holder's own Location (visible on Asset 360) was judged
sufficient for Phase-1 — not classified as a gap without further
evidence of a real need to filter the register by Location directly
rather than by Holder.

## 24. QR DEV validation

Verified live, in the DEV environment only, per the authorization's
explicit instruction **not** to change `BASE_URL` for production: QR
generation works (a real QR image renders on Asset 360 for a freshly-
created UAT asset, served as a blob from `GET /api/assets/{id}/qr.png`);
"Print Label" button present and functional; the underlying code format
and target route (`${BASE_URL}/assets/{id}`) is unchanged from AM-09's
own verification and matches the documented contract exactly. **Physical
LAN QR scanning/production testing is explicitly DEFERRED TO PRODUCTION
CUTOVER** — this requires a real `BASE_URL` and a real phone on the real
LAN, neither of which exist yet (no production server). No `BASE_URL`
change was made.

## 25. Phase-1 gap register summary

See `docs/ai/PHASE1_GAP_REGISTER.md` (a separate, downloadable file) for
the full register. Summary: 2 MUST HAVE (both fixed this stage), 4 SHOULD
HAVE (documented only), 3 PHASE 2 items, 3 NOT REQUIRED items (re-
confirmed, not newly discovered).

## 26. MUST HAVE gaps

G01 (Asset Register Holder/Company visibility) and G02 (search coverage
of Description) — both fixed this stage, commit `9607193`. See
`PHASE1_GAP_REGISTER.md` for full detail. Zero MUST HAVE gaps remain
open.

## 27. SHOULD HAVE gaps

G03 (Dashboard exception/recent-activity visibility), G04 (ADMIN
dashboard per-company breakdown, contingent on business input), G05
(dedicated location/holder reports — judged already adequately covered
by existing filter+export), G06 (dedicated asset-photo field — judged
adequately covered by the existing Documents tab). None implemented this
stage; all documented in `PHASE1_GAP_REGISTER.md` with reasoning.

## 28. Phase-2/deferred gaps

G08 (two-tier Asset User/Custodian split), G09 (multi-level Location,
parent/child assets), G10 (Asset WIP pre-commissioning state) — all real
ThreadERP concepts, none evidenced as needed for CKAM's actual Phase-1
operating model. See `PHASE1_GAP_REGISTER.md`.

## 29. Enhancements actually implemented in AM-11

Two, both in commit `9607193`:

1. Asset Register gained Holder and Company columns, populated via a new,
   page-scoped batch id→name lookup (`_page_label_maps` in
   `backend/app/assets/router.py`) — never a per-row join, never a
   whole-table fetch.
2. Asset search (`backend/app/assets/search_service.py`) now also
   matches against `Asset.description`.

A necessary side-fix: `AssetDetailOut`'s own construction
(`_to_detail_out`) collided with the new `AssetOut.current_holder_name`/
`company_name` fields (a `TypeError: got multiple values for keyword
argument`) — fixed by excluding those two fields from the base dump and
having the detail endpoint's own, already-richer lookup explicitly
provide them (plus a new `Company` lookup that endpoint didn't previously
need to make on its own).

## 30. Bugs fixed

One, found only because of the enhancement above (not a pre-existing,
independently-reachable defect — the `TypeError` could only occur once
`AssetOut` gained the two new fields this stage introduced): the
`AssetDetailOut` keyword-argument collision described in §29. Fixed in
the same commit as the enhancement that surfaced it.

## 31. Database migrations, if any

**None.** Both changes are additive to Pydantic response schemas
(`AssetOut` gaining two nullable fields with no database-column
equivalent — they are computed/joined at request time, not stored) and a
query-clause change (`search_service.py`). No `Asset` or `Company` or
`Holder` table structure changed. Confirmed: `docker compose exec api
alembic current` remains `f28b6a913dce (head)` throughout this stage.

## 32. Exact files changed

- `backend/app/assets/schemas.py` — `AssetOut` gains
  `current_holder_name`/`company_name`; `AssetDetailOut`'s docstring
  updated to reflect the new relationship between the two schemas.
- `backend/app/assets/router.py` — new `_page_label_maps` helper;
  `list_assets` now populates the two new fields; `_to_detail_out` fixed
  to avoid the keyword collision and to additionally look up `Company`.
- `backend/app/assets/search_service.py` — `Asset.description.ilike(...)`
  added to the search clause.
- `backend/tests/assets/test_search.py` — two new tests
  (`test_am11_search_by_description_substring`,
  `test_am11_list_resolves_holder_and_company_names`).
- `frontend/src/features/assets/AssetRegister.tsx` — `AssetRow` interface
  gains the two new fields; two new table columns (Holder, Company);
  search placeholder text updated to mention Description.
- `frontend/src/features/assets/AssetRegister.test.tsx` — one new test
  (`shows the current holder and company the backend resolved for each
  row (AM-11)`).
- `docs/ai/DEVELOPMENT_GUARDRAILS.md` — new "Development/UAT test-data
  convention (AM-11)" section (§40 below).

## 33. Backend tests

307/307 passing (was 305/305 at the start of this stage — +2 new AM-11
tests). Full suite re-run after the `_to_detail_out` fix (which the
initial container rebuild surfaced as a genuine regression, not a false
start — see §41).

## 34. Frontend tests

149/149 passing, 25 files (was 148/148 — +1 new AM-11 test). `npx tsc -b`
clean.

## 35. TypeScript

Clean, both before and after the AM-11 changes.

## 36. E2E

5/5 passing, re-run against the rebuilt `web` container after the
frontend change.

## 37. Production build

Clean — 2257 modules, zero errors. Bundle: 738.10 kB / 222.47 kB gzip
(a negligible ~0.15 kB increase from the two new columns/fields; still
the same AM09-07 P3 advisory, unchanged classification).

## 38. Browser UAT

Performed live throughout this stage: ADMIN, VIEWER, and HOLDER role
walkthroughs (§10/§12/§13) against a freshly-seeded, clearly-tagged UAT
company (`UAT-AM11-UX`, per the new naming convention this stage itself
established, §40); a live `MOVED` lifecycle event; and a direct, live
verification of both AM-11 fixes after rebuilding the `web` container —
the Holder/Company columns render correctly with real resolved names
(e.g. "UAT AM11 Employee Holder" / "UAT AM11 UX Walkthrough Co"), and a
description search for "latitude" correctly found "UAT - Dell Latitude
Laptop" where it previously found nothing.

## 39. Security regression

No security-relevant code was touched this stage beyond the register/
search change itself, which was designed with scoping in mind from the
start: `_page_label_maps` only resolves names for holder/company ids that
already appear in `items` — the very same, already-correctly-scoped
result `search_assets` returned (company scoping, HOLDER `holder_id`
pinning, and every other AM-09-verified authorization boundary are
completely unchanged upstream of this new helper, so no new leak path
exists). Confirmed via the new `test_am11_list_resolves_holder_and_
company_names` test and via the full 307/307 backend re-run, which
includes every AM-09 security/scoping regression test (company isolation,
HOLDER isolation, role-matrix tests) unchanged and still passing. Company
scoping, HOLDER scoping, the ADMIN/IT_TEAM/VIEWER/HOLDER role boundaries,
append-only `asset_event`/`asset_field_change`, the identity trigger,
Excel formula sanitization, and controlled DB-integrity error handling
were all re-confirmed intact by this same full regression pass — none
required a dedicated new test, since none of their own code paths were
touched.

## 40. New development test-data convention

Documented in `docs/ai/DEVELOPMENT_GUARDRAILS.md` (see §32 above for the
exact diff): company code `UAT-<stage>-<suffix>`, asset description
prefix `"UAT - "`, holder emp_code prefix `UAT-<stage>-...`. Applied
immediately to this stage's own seed data (`UAT-AM11-UX` company,
`UAT-AM11-ADM`/`-ITT`/`-VWR`/`-STK`/`-EMP` holders, assets prefixed
`"UAT - "`) as the first real example of the convention in use. No
existing historical UAT/E2E/RC data was touched, renamed, or deleted.

## 41. Remaining Phase-1 decisions needing user input

1. **`holder_company_access`** — still genuinely depends on whether
   CityKart's real Asset/IT team is organizationally shared across
   companies. No new evidence this stage.
2. **Import duplicate detection** — a practical option was proposed
   (optional, non-blocking preview-time warning on a repeated Serial
   Number within the same company) but needs CityKart's own confirmation
   that Serial Number specifically is meant to be unique before it is
   built.
3. **Whether ADMIN's dashboard needs a per-company breakdown** (G04) —
   depends on how many real companies CityKart operates in Phase-1.
4. Everything already carried forward from AM-06 through AM-10
   (5 unconstrained closed-value DB columns, no bulk correction workflow)
   remains unresolved and unchanged — re-assessed this stage (§9 of the
   authorization, items C/D/E) and confirmed still NOT REQUIRED for
   Phase-1 without new evidence.

## 42. Recommended next development stage

Given the verdict (§46) is PHASE-1 READY WITH MINOR ENHANCEMENTS, the
recommended next stage is either: (a) a short, narrowly-scoped follow-up
implementing G03 (Dashboard exception/recent-activity visibility) once
the business questions in §41 are answered, since it is the most
concretely evidenced remaining SHOULD-HAVE gap; or (b) if the user
considers the current gap set acceptable for real Phase-1 use as-is,
proceeding directly toward eventual production readiness once a
production server is provided (a distinct, separately-authorized future
stage — not started here). No stage should begin without the user's
explicit direction, per this stage's own stop condition.

## 43. REPORT CONTENT HEAD

`9607193` (the last commit before this report/governance commit —
`feat(assets): AM-11 -- Asset Register shows current Holder/Company,
search covers Description`).

## 44. REPORT COMMIT

TO BE FILLED IN CHAT AFTER COMMIT.
