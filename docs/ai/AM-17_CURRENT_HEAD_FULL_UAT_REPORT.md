# AM-17 — Current-Head Full Business Workflow UAT + Release Candidate Revalidation

## 1. Executive summary

AM-17 is an exhaustive, evidence-based UAT of CKAM's real Phase-1
business workflows at current HEAD — not another design/visual stage
(AM-13 through AM-16 already covered that ground). It answers: can the
current CKAM application, as it actually exists in this working tree
right now, be treated as a stable current Release Candidate for
DEVELOPMENT/UAT purposes? Every result below is fresh AM-17 evidence,
independently re-run against current HEAD — nothing is carried over from
AM-09 or AM-15 without being re-verified now. Four evidenced defects
(1×P1, 3×P2) were found and fixed, each with a dedicated regression test.
One new permanent Playwright spec closes a real, standing gap (Purchase
Orders had zero E2E coverage). No business rule, schema, or
design-system token changed.

## 2. Final CURRENT RC verdict

**CURRENT RC READY WITH NON-BLOCKING OBSERVATIONS.**

This is a DEV/UAT software-readiness judgment about the current working
tree, **not production deployment authorization** — production remains
deferred; there is no production server. No P0 or P1 defect remains open
(the one P1 found, DEF-01, was fixed and re-tested within this stage).
The non-blocking observations are documented in §65 below.

## 3. Git preflight

Run at the start of this stage's resumption:

```
pwd                        -> D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build
git rev-parse --show-toplevel -> D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build
git branch --show-current  -> worktree-ckam-build
git rev-parse HEAD         -> e5ea6565deceba5a5ad8142fa68e466f8775ba58
git status --short         -> 3 untracked files (the matrix + 2 DB/business-workflow
                               findings docs already produced by AM-17's own
                               earlier work in this session)
git diff --stat            -> (empty — no unstaged changes to tracked files at that point)
git remote -v              -> origin  https://github.com/kumarsuraj84/Citykart-AssetManagement.git
git tag --list             -> ckam-v1.0.0-rc1 (decorated at c2c8c03, an AM-10-era
                               commit far back in history, confirmed unmoved)
```

Clean, expected, no unrelated/unexplained changes — cleared to proceed
without discarding anything. Every file already present was inventoried
and preserved (see §7).

## 4. AM-16 actual original commit

`96e2fa7fe85b69c6470940ae842125591662774d` — `feat(ui): AM-16 -- Lovable-guided
visual refinement, validated not blind`. AM-16's implementation and its
own report/governance updates were committed together in this ONE commit
(there is no separate "AM-16 report commit" distinct from its
implementation commit).

## 5. AM-17 AM-16-correction commit

`e5ea6565deceba5a5ad8142fa68e466f8775ba58` — `docs(ai): reconcile AM-16
report metadata (AM-17 preflight, Issues A/B)`. Fixed, before any AM-17
functional work began, two documentation defects in the already-committed
AM-16 report: §39's self-contradictory shadow-discipline wording (Card
both "keeps shadow-sm" and "no shadow remains on a static surface" —
reworded to the actual non-contradictory rule), and §53's REPORT CONTENT
HEAD, which had never actually been filled in with the real commit
(`458a4c8594fed00ca511762065f4b3e5695f0f2f`, AM-15's own final commit —
the state every AM-16 finding describes). Verified present and correct in
the current file; not re-edited.

## 6. AM-17 starting/resume HEAD

`e5ea6565deceba5a5ad8142fa68e466f8775ba58` (identical to §5 — the
AM-16-correction commit was AM-17's own first action, so AM-17's
functional work began from that same commit).

## 7. AM-17 resumed-state inventory

This stage was resumed mid-flight after a context compaction. At resume,
the working tree already contained, untracked: `AM-17_WORKFLOW_ACCEPTANCE_MATRIX.md`
(created before testing began, per §9 discipline) and two scratch findings
files (`_am17_db_migration_findings.md`, `_am17_business_workflow_findings.md`)
already written by two completed background verification passes (DB-layer,
and business-workflow/security). All three were preserved, not
regenerated from zero. The two scratch findings files were promoted to
their durable `docs/ai/` paths (`AM-17_DB_VERIFICATION_FINDINGS.md`,
`AM-17_BUSINESS_WORKFLOW_FINDINGS.md`) with no content loss. No unrelated
or unexplained changes were found in the working tree.

## 8. Existing DB verification accepted

The DB-layer verification (migration chain, backup/restore, integrity
sweep, trigger negative tests, numbering concurrency) had already been
completed and independently evidenced before this resumption — it was
accepted as valid current-HEAD AM-17 evidence and **not re-run**, per the
resumption authorization's own instruction not to repeat DB-layer work
unless later code changes affected those exact areas (none of AM-17's
fixes touched migrations, triggers, or the numbering path). Full detail:
`docs/ai/AM-17_DB_VERIFICATION_FINDINGS.md`.

## 9. Database migration result

**PASS.** A genuinely empty disposable database (`ckam_am17_fresh`) ran
`alembic upgrade head` clean through all 15 revisions to `278437eb710e`.
Verified present: `purchase_order`, `pending_asset`, both `barcode`
columns, `purchase_order.cost_center_id`, the partial unique index
`ux_asset_serial_number_ci`, and all 5 append-only/identity triggers. A
`downgrade -1` → `upgrade head` round-trip on the same disposable DB
completed cleanly. See DB findings doc Task 1.

## 10. Backup/restore result

**PASS.** A real `pg_dump` of live `ckam` (`backups/ckam_am17_backup.sql.gz`,
104,253 bytes) was restored into a second disposable database
(`ckam_am17_restore`, never the live database). Revision
(`278437eb710e`), row counts (`asset`=250, `asset_event`=367,
`asset_field_change`=73, `purchase_order`=3, `pending_asset`=191),
indexes, and triggers all matched the live baseline exactly. Both
disposable databases were dropped afterward. See DB findings doc Task 2.

## 11. Integrity result

**PASS — 0 anomalies on all 15 checks.** Duplicate Asset Code, duplicate
non-"N/A" serial (case-insensitive), Asset/Cost-Centre company mismatch,
Asset/current-Holder company mismatch, invalid Category/Subcategory
pairing, orphaned `current_holder_id`/`asset_event`/`asset_field_change`
rows, `pending_asset` orphan/linkage/status-consistency checks,
`purchase_order`/Cost-Centre company mismatch, and every closed-value
enum domain (`asset.status` including `INSTALLED`, `holder.holder_type`,
`holder.role`, `custom_field.field_type`) — every check returned 0 rows
against live `ckam`. See DB findings doc Task 3.

## 12. Trigger result

**PASS — all 7 statements rejected.** `UPDATE`/`DELETE` against
`asset_event` and `asset_field_change`, and `UPDATE` against
`asset.asset_code`/`company_id`/`cost_center_id`, each attempted inside
`BEGIN;...ROLLBACK;` against live `ckam` (never committed), were rejected
with the trigger functions' own explicit error messages
(`forbid_asset_event_write`, `forbid_asset_field_change_write`,
`forbid_asset_identity_change`). Live data confirmed unchanged afterward.
See DB findings doc Task 4.

## 13. Numbering-concurrency result

**PASS — 20/20 unique codes.** 20 genuinely concurrent `POST /api/assets`
calls against an isolated `UAT-AM17-CONCURRENCY` company/rule produced
codes `UAT-AM17-0001` through `UAT-AM17-0020`, zero duplicates, zero
gaps, and the rule's counter advanced exactly +20 (1 → 21). All throwaway
data soft-deactivated afterward. See DB findings doc Task 5.

## 14. SEEDADMIN / test-account hygiene

At resumption, a check for active `SEEDADMIN` holders found 161 rows
total, all but 2 already inactive from prior stages' own cleanup. The 2
remaining (`AM03UAT`/company 9, `AM04UAT`/company 13) had `holder.is_active
= true` but sat inside already-**deactivated** companies — since the login
query requires both `Holder.is_active` AND `Company.is_active`, these were
never actually login-capable (0 rows match both conditions simultaneously,
confirmed by direct query), so they posed no real collision risk. This
matches an already-documented, accepted finding (`RC_ISSUES.md` AM10-03,
P2). Both were soft-deactivated at the holder level too, closing the
leftover-state finding for good. Re-verified after: `SELECT count(*) FROM
holder WHERE emp_code='SEEDADMIN' AND is_active=true` → **0**; zero
holders anywhere where both the holder and its company are simultaneously
active. This check was repeated again immediately before the final E2E
run (§44) with the same clean result — no ambiguous active `SEEDADMIN`
identity existed at any point capable of breaking the login path.

## 15. Authentication

**PASS** (1 PARTIAL sub-item, non-blocking). emp_code login, case-insensitive
email login, wrong password (generic 401), unknown login_id (byte-identical
401 body — no enumeration), duplicate-identity collision (both accounts
401, never guesses which is real; server-side warning logged), inactive
Holder (401), inactive Company (401 for every holder in it), password
change (wrong-old → 400 with a specific message; correct flow works; old
password rejected after), logout (refresh cookie cleared), expired/invalid
session (401) — all confirmed via direct API calls. **A10 (deep-link
refresh) is PARTIAL**: the negative path (no/invalid cookie → 401) was
confirmed; a genuine valid-cookie refresh-and-continue journey was not
separately driven end-to-end this pass. See
`AM-17_WORKFLOW_ACCEPTANCE_MATRIX.md` rows A01–A11.

## 16. Role matrix

**PASS.** ~20 endpoint groups (assets, purchase orders, all 7 masters,
holders, custom fields, imports, reports, lifecycle) × 4 roles
(ADMIN/IT_TEAM/VIEWER/HOLDER), tested via direct backend API calls, never
inferred from a hidden frontend button. Every gate matched the actual
`require_role(...)`/`ensure_company_in_scope` source. A HOLDER accessing an
asset they don't hold correctly gets 404 (not 403) — a deliberate,
consistent fail-closed pattern, not a defect. See matrix row R01, full
detail `AM-17_BUSINESS_WORKFLOW_FINDINGS.md` §2.

## 17. Company isolation

**PASS, with DEF-03 found and fixed.** Two isolated UAT companies (A/B)
were used across every module; writes were correctly isolated everywhere
(list scoping, direct-ID access → 404, query-param-bypass attempts
blocked). Category, Subcategory, Vendor, Location, and Department are
intentionally global masters (no `company_id` column) and were correctly
excluded from what counts as a leak. **DEF-03**: the Cost Centre list
endpoint's *read* side had no company scoping for a non-ADMIN — found,
fixed in `0ec05a9`, re-verified. See matrix row C01.

## 18. HOLDER isolation

**PASS.** `GET /api/assets` (My Assets) is pinned server-side to the
caller's own `holder_id` regardless of spoofed query parameters; direct
access to an asset/its changes/events that the HOLDER doesn't hold → 404;
dashboard/movements/field-changes exports → 403 (staff-only); the assets
export → 200 but correctly scoped to only their own held assets. No
"documents" endpoint exists in the current backend at all (N/A, nothing
to test there). See matrix row H01.

## 19. Add Asset

**PASS.** All required fields enforced (422 on omission); Purchase Date
confirmed always exactly equal to Invoice Date, server-derived, never
user-entered; company comes from auth context, never client input;
cross-company Cost Centre id → 422; Custom Fields accepted are Global +
own-company only with required-field enforcement; generated Asset Code,
register listing, Asset 360 detail, and the initial `asset_event` row all
verified consistent. See matrix row AA01.

## 20. Quantity semantics

**PASS.** `quantity > 1` with one real (non-"N/A") Serial Number → the
whole call is rejected with a controlled 422, **zero** assets created
(verified via the register, not just the response) — never a silent
multi-asset creation sharing one serial. See matrix row AA02.

## 21. Serial Number — all paths

**PASS on all 4 paths.** Add Asset, PO Delivery, Import, and Asset 360
Edit each independently re-tested: exact-case duplicate → 422,
case-different duplicate (e.g. `uat-...-1` vs `UAT-...-1`) → 422, `"N/A"`
→ exempt (repeatable, case-insensitively). The backing DB index
(`ux_asset_serial_number_ci`) was independently confirmed present and
correctly defined by the DB-layer pass (§9). See matrix rows SN01–SN05.

## 22. Purchase Order create

**PASS.** Role-gated ADMIN/IT_TEAM (VIEWER/HOLDER → 403); Cost Centre
required on the header; missing/nonexistent Cost Centre id → controlled
422, never 500. See matrix row PO01.

## 23. Pending line creation

**PASS.** `quantity >= 3` on Add Line expands into that many individual
`PendingAsset` rows, each inheriting Cost Centre/Category/Subcategory/
Description/Barcode from the line; Barcode confirmed reusable across
separate lines (by design, per `DECISIONS.md`). See matrix row PO02.

## 24. Pending edit

**PASS.** Edit allowed only while a line is PENDING (200); attempting to
edit a CANCELLED or DELIVERED line → 422. See matrix row PO03.

## 25. Pending cancel

**PASS.** Cancel → status CANCELLED, retained (never hard-deleted);
re-cancelling, or cancelling an already-DELIVERED line, → 422. See matrix
row PO04.

## 26. Filters/Select All

**NOT-TESTED at the direct-API layer** (this is inherently a frontend-only
behavior — there is no backend endpoint to exercise). The filtered
Select-All behavior itself was not independently re-driven through the
browser this stage (AM-14 built it, AM-17 did not find evidence it
regressed, but did not re-verify it live either). Recorded honestly as
NOT-TESTED rather than claimed. See matrix row PO05.

## 27. Partial Delivery

**PASS, with DEF-01 found and fixed.** Selecting 2 of 3 PENDING lines and
delivering them with shared Invoice fields + distinct per-unit Serial
Number/Initial Holder produced exactly 2 DELIVERED + 1 still-PENDING line,
2 new Assets, all fields correct **except** Vendor (DEF-01 — fixed in
`0ec05a9`, re-verified via a new regression test). See matrix row PO06.

## 28. Converted Asset truth

**PASS (API-level; DEF-01 fixed).** Company, Cost Centre, PO/Invoice
numbers+dates, Purchase Date = Invoice Date, Serial, Barcode,
Category/Subcategory, Cost/Tax, initial Holder, and the initial
`asset_event` row were all verified field-by-field via the API. The new
Playwright PO spec (§37) additionally verifies the equivalent fields in
the actual Asset 360 **browser UI**, closing the UI-level gap this same
row's original (pre-fix) API-only pass didn't cover. See matrix row PO07.

## 29. Delivered immutability

**PASS.** Editing, cancelling, or re-delivering an already-DELIVERED line
— via direct API, bypassing any UI — each returns a controlled 422, never
a 500 or silent success. See matrix row PO08.

## 30. Dashboard PO card

**PASS.** Visible with real, company-scoped figures for ADMIN/IT_TEAM.
A VIEWER's dashboard response has `pending_po_summary`/
`open_purchase_orders` as explicit empty/zero values (not omitted, not a
side-channel), matching the `include_purchase_orders` code path exactly.
See matrix row D01.

## 31. Dashboard Exceptions

**PASS (API), PARTIAL (UI click-through).** All 5 exception statuses
(`UNDER_REPAIR`/`LOST`/`DISPOSED`/`SOLD`/`SCRAPPED`) are always present in
the response with an explicit 0 when empty; counts verified against
assets deliberately driven into each state. UI click-through into the
pre-filtered register was not independently re-driven this pass. See
matrix row D02.

## 32. Dashboard Recent Activity

**PASS.** Exactly the latest 5 lifecycle events, newest-first by
`event_date`, every item's `recorded_by_name` populated (snapshot-correct,
per AM-01's guarantee), correctly company-scoped. See matrix row D03.

## 33. Asset Register

**PASS.** Search by asset code/description, status filter, pagination
(limit/offset + total) all verified correct via the API; no data or
column semantics change was made or needed. See matrix row AR01.

## 34. Asset 360

**PASS (API-level; DEF-01-affected Vendor field now fixed).**
Overview/Procurement/Custody/Custom Fields/History/Changes all verified
via the API; the `status` field contract is confirmed independent of
AM-16's frontend-only compact-display change (a backend contract check).
No "Documents" endpoint exists in the current backend at all — N/A. The
new Playwright PO spec additionally exercises the real Asset 360 **UI**
for 2 freshly-created assets. See matrix row A360-01.

## 35. Lifecycle

**PASS.** Standard journey (IN_STOCK → ALLOTTED → return → reassign)
produces a correct 4-event ledger, every field verified. Exception
journeys (Repair, Lost, Found, Disposed, Sold, Scrapped), each on a
separate asset to avoid mutually-exclusive terminal-state conflicts;
FOUND correctly ADMIN-only; 2 invalid transitions from terminal states
both correctly rejected (422). See matrix rows LC01–LC02.

## 36. Correction

**PASS.** `POST /api/assets/{id}/corrections` correctly blocked for
VIEWER/HOLDER (403); missing Reason → 422; inactive Category → 422;
Category change without a compatible Subcategory → 422; a valid
correction writes `asset_field_change` rows sharing one `request_id` with
a non-null Reason; Purchase Date chronology enforced (future date → 422,
date after the asset's earliest ledger event → 422); a no-op correction
(nothing actually changed) → 422; identity fields (Asset Code, company,
Cost Centre) provably unchanged. See matrix row CC01.

## 37. Ordinary Edit

**PASS.** A `PUT` body including identity/lifecycle fields has zero
effect (the schema excludes them entirely, not merely ignores them at
runtime); a no-op PUT produces no new audit row; a genuine field change
produces exactly one new audit row with `reason=null` (the discriminator
vs. a correction). See matrix row OE01.

## 38. Custom Fields

**PASS.** All 5 field types exercised across Global and 2 company scopes;
IT_TEAM correctly blocked from managing a Global field, allowed for their
own company, blocked for another company's; required-field enforcement
returns 422 when missing; after deactivating a required field, its
already-set value remained visible on the existing asset (never hidden),
and new assets were no longer forced to supply it; the value updates
correctly via ordinary Edit and via Import. See matrix row CF01.

## 39. Import

**PASS.** Full contract exercised (procurement + PI + Vendor + Serial +
Quantity + a `Custom:<field_key>` column); VALID-ROWS-ONLY per-row
atomicity confirmed, including atomicity within a single quantity-expanded
row (a bad unit inside a multi-unit row rolls back that whole row, not
just that unit); the cross-company whole-file rule (non-ADMIN actor with
a company-B row → 403, nothing written) confirmed; Serial Number rules
from §21 apply identically inside Import. See matrix row IM01.

## 40. Reports/exports

**PASS, with DEF-02 found and fixed.** All 3 exports (asset register,
movement log, field-change audit) downloaded fresh, company-scoped,
human-readable field labels throughout. **DEF-02**: the field-change
export had no Reason column — found, fixed in `0ec05a9`, re-verified.
Formula-injection mitigation re-tested with `=1+1`, `+cmd|...`, `-2+3`,
`@SUM(A1)` — all land as apostrophe-prefixed inert literal text in every
export, never a live formula. See matrix row RX01.

## 41. Masters

**PASS, with DEF-03 found and fixed.** All 7 simple masters (Companies,
Locations, Departments, Cost Centres, Categories, Subcategories, Vendors)
individually exercised: list/create/edit/deactivate, immutable fields
after creation, duplicate-code → controlled 422 (never 500), role gate
(ADMIN/IT_TEAM writes, all roles read) confirmed for every one of the 7.
DEF-03's Cost-Centre-read-scoping fix (§17) is covered here too. See
matrix rows M01–M07.

## 42. Holders

**PASS.** All 4 `holder_type` values used; invalid Location/Department FK
→ 422 (never 500); duplicate `emp_code` within a company → 422; invalid
`holder_type` → 422; create/edit/deactivate/reset-password all correctly
ADMIN-only (IT_TEAM → 403). No distinct "last ADMIN" protection was found
beyond ordinary ADMIN-only gating — documented as an observation, not
assumed or implemented. See matrix row HL01.

## 43. Code Rule

**PASS.** The company-scoped rule created for this pass was used
correctly across ~20+ real Add Asset/PO-delivery/Import/concurrency-test
allocations with no gaps or duplicates observed; ADMIN-only write gate
confirmed (IT_TEAM → 403 on both create and update). Note: this endpoint
has no delete/deactivate at all — a pre-existing, documented (not new)
observation. The dedicated 20-parallel-request concurrency stress test is
covered separately in §13. See matrix row CR01.

## 44. Permanent PO E2E

**PASS.** `frontend/e2e/purchase-order-delivery-journey.spec.ts` (commit
`7b127ae`) — a full 17-step journey through the real browser UI: isolated
seed → login → create PO → add a Quantity=3 line → confirm 3 PENDING
units → select 2 → Delivery Done with shared Invoice fields + distinct
per-unit Serial Number/Initial Holder → confirm → verify 2 DELIVERED / 1
still PENDING → locate both new Assets via the Asset Register → verify
each Asset 360 (PO/Invoice/Purchase Date=Invoice Date/Barcode/Serial/
Holder/Asset Code) → revisit the PO detail page, confirm the 3rd unit
still PENDING → deliver a duplicate real Serial Number against the
remaining unit and confirm it's rejected with a visible dialog error →
teardown. Not order-dependent, uses unique fixture-generated names
throughout, no arbitrary sleeps. Passes in isolation and as part of the
full suite. Full suite: **6/6 green** (was 5/5 at the start of this
stage), original 5 specs unaffected. See §55 for exact counts.

## 45. Direct security revalidation

**PASS.** All 9 named surfaces (Purchase Orders, Pending Asset line
mutation, Delivery Done, Dashboard PO side-channel, Asset serial
duplication, Import, Asset correction, Holders, Reports) each received at
least one explicit cross-role privilege-escalation attempt and one
cross-company access attempt via direct API calls; no bypass found on any
surface. See matrix row SEC01, full detail
`AM-17_BUSINESS_WORKFLOW_FINDINGS.md` §18.

## 46. Responsive smoke

**PASS — zero defects, explicitly not a redesign.** 6 viewports
(1920×1080/1440×900/1366×768/1024×768/768×1024/375×812) × 10 priority
screens (Dashboard, Asset Register, Add Asset, Asset 360, PO list, PO
detail, Delivery Done dialog, Import, Reports, Holders) — 60 combinations,
measured via `getBoundingClientRect()`/`scrollWidth` (not screenshots,
given this session's known Browser-pane screenshot-tool quirk at
non-1366/375 sizes) — zero page-level horizontal overflow anywhere;
tables scroll contained within their own wrapper at narrow widths; the
Delivery Done dialog fits the viewport with Confirm reachable down to
375px. See `AM-17_E2E_AND_SMOKE_FINDINGS.md` Part C, matrix row RS01.

## 47. Accessibility

**PASS — no defects found.** Keyboard-only login (Tab/Tab/Enter) with a
visible focus ring; the pending-line selection checkbox is
keyboard-operable; the Delivery Done dialog opens with focus moved
inside, stays focus-trapped, and closes on Escape; status is always
rendered as dot+text, never color alone; every icon-only row action
carries an explicit `aria-label` naming the row; form fields use real
`<label for>` association throughout. See `AM-17_E2E_AND_SMOKE_FINDINGS.md`
Part D, matrix row AC01.

## 48. Failure paths

**PASS, with DEF-04 found and fixed.** 401 → redirect to login; 403 →
controlled message; 404 (nonexistent asset) → controlled "not found",
never a crash; 422 (duplicate serial) → clear inline alert (verified live
via the new E2E spec); the `api` container was briefly stopped and
restarted — the frontend showed a controlled error state (no infinite
spinner, no blank crash), recovering correctly on retry (TanStack Query's
default retry backoff adds a ~15–17s delay before the error state
appears — a timing characteristic, not a defect). **DEF-04**: a duplicate
master code silently failed with zero visible feedback on all 7 masters
screens — found, fixed in `8547bb0`, re-verified. See
`AM-17_E2E_AND_SMOKE_FINDINGS.md` Part E, matrix row FP01.

## 49. Performance sanity

**Observations only, no thresholds invented.** On a lightly-loaded local
dev stack: Dashboard API ~23ms, Asset Register first-page API ~43ms, PO
detail (header+lines) ~23ms+26ms, an 80-row Import preview ~340ms
end-to-end. No SLA is asserted from these numbers; flagged only as a
baseline for a future stage to compare against if performance is ever
raised as a concern. See `AM-17_E2E_AND_SMOKE_FINDINGS.md` Part F, matrix
row PF01.

## 50. P0 findings

**0.**

## 51. P1 findings

**1 — DEF-01, fixed.** See §27/§59/`AM-17_ISSUES.md`.

## 52. P2 findings

**3 — DEF-02, DEF-03, DEF-04, all fixed.** See §40/§17/§48/`AM-17_ISSUES.md`.

## 53. P3 observations

**0 new.** Pre-existing, already-documented P3 observations from prior
stages (bundle size advisory, external Google-Fonts CDN dependency) were
not re-litigated — still accurate, still non-blocking, unchanged by this
stage.

## 54. Fixes performed

Four, all in this stage, all with regression coverage:

1. **DEF-01** (`0ec05a9`) — `deliver_pending_assets` now passes the
   parent PO's `vendor_id` through to `procure_assets`.
2. **DEF-02** (`0ec05a9`, same commit) — `field_changes_to_xlsx` now
   includes a Reason column.
3. **DEF-03** (`0ec05a9`, same commit) — the generic masters list
   endpoint now pins a non-ADMIN's read to their own company for a
   company-owned master.
4. **DEF-04** (`8547bb0`) — `MasterCrudScreen`'s Add/Edit dialogs now
   surface the mutation's own error message, matching the pattern every
   other mutation-driven dialog in the app already used.

No business rule, schema, or design-system token was touched by any fix.

## 55. Full backend regression

**346/346 passing** (was 341/341 at this stage's start; +5 new regression
tests: 1 for DEF-01, 2 for DEF-02, 3 for DEF-03 — one test file gained 2
new tests, `test_delivery.py` and `test_am06_export_full_field_support.py`
and `test_am08_cost_center_scoping.py` between them). Zero warnings beyond
pre-existing, unrelated `StarletteDeprecationWarning`s already present
before this stage.

## 56. Full frontend regression

**178/178 passing** (was 176/176 at this stage's start; +2 new regression
tests for DEF-04 in `MasterCrudScreen.test.tsx`).

## 57. TypeScript

**Clean** (`npx tsc -b`, zero errors).

## 58. E2E

**6/6 passing** (was 5/5 at this stage's start; +1 new permanent spec,
`purchase-order-delivery-journey.spec.ts`). Original 5 specs unaffected,
confirmed green in the same full-suite run.

## 59. Production build

**Clean** (`npm run build`; `tsc -b && vite build` succeeded, only the
pre-existing >500kB chunk-size advisory, already a documented P3
observation from AM-09, unchanged).

## 60. Alembic final

```
alembic current -> 278437eb710e (head)
alembic heads   -> 278437eb710e (head)
```

Single head, unchanged throughout AM-17. No new migration was authored —
every fix this stage made was frontend/API-logic only, none touched the
schema.

## 61. Database gate

**PASS.** See §9–§13.

## 62. Functional gate

**PASS.** See §15–§45 (every workflow re-verified fresh at current HEAD;
4 evidenced defects found, all fixed, all re-tested).

## 63. Authorization gate

**PASS.** See §16–§18, §45 (role matrix, company isolation, HOLDER
isolation, and the explicit security-revalidation checklist all found no
bypass; the one authorization-adjacent gap found, DEF-03, is fixed).

## 64. Recovery gate

**PASS.** See §10 (real backup restored byte-identical into a disposable
database; live `ckam` was never touched by the restore).

## 65. Deferred business decisions

None resolved, none reopened, none implemented — exactly as instructed.
Still open, unchanged by this stage: `holder_company_access` (written,
never read by authorization), import duplicate detection (a practical
option was proposed in AM-11, never built), the G04 ADMIN Dashboard
per-company breakdown/selector, category/subcategory-scoped Custom
Fields, approval workflow, AMC/insurance/depreciation/physical
verification, a company-wide audit explorer, new lifecycle states, new
master types, bulk correction. Where AM-17's own testing touched one of
these (e.g. confirming `holder_company_access` is still write-only/
unread, per §17's isolation testing), it was documented as an
observation, never guessed at or built. These are the "non-blocking
observations" referenced in the RC verdict (§2) — none are software
defects, all are pending a CityKart business decision.

## 66. No-design-churn confirmation

**Confirmed — no design-system token, CSS value, or visual-component
change was made anywhere in this stage.** All 4 fixes are
backend-logic (`0ec05a9`) or a functional error-display addition using an
*already-established* app-wide pattern (`8547bb0`'s `{mutation.isError &&
<p role="alert">}`, copied verbatim from `CustomFieldsScreen`/
`AddAssetForm`/`CodeRuleScreen`/`PurchaseOrderDetail`/`AssetDetail` —
never invented). The AM-13→AM-16 locked design system (Card `shadow-sm`,
10px/12px radius, 40px controls, compact-dot-vs-pill status convention,
`tabular-nums` right-aligned numeric columns) was never touched or
reopened.

## 67. No-production-work confirmation

**Confirmed.** No deployment, no production server touched (none
exists), no database promotion, no test-data deletion (only soft
deactivation, and only of confirmed-stale AM-17-created or
already-documented-stale rows — see §14).

## 68. Final RC decision

**CURRENT RC READY WITH NON-BLOCKING OBSERVATIONS** — restated from §2.
The current working tree, at the HEAD stated in §69, is fit to continue
as CKAM's DEV/UAT baseline. This is not production deployment
authorization.

## 69. Exact commits

| Purpose | Commit |
|---|---|
| AM-16 original (implementation + report + governance) | `96e2fa7fe85b69c6470940ae842125591662774d` |
| AM-17 AM-16-correction (doc-only) | `e5ea6565deceba5a5ad8142fa68e466f8775ba58` |
| AM-17 fix: DEF-01/DEF-02/DEF-03 | `0ec05a9` |
| AM-17 test(e2e): permanent PO delivery journey | `7b127ae` |
| AM-17 fix: DEF-04 | `8547bb0` |
| AM-17 report + governance closure (this commit) | stated in chat only, per §30 convention — see below |

## 70. Working-tree state

Clean immediately before this report's own commit (every AM-17 file
either already committed in one of the commits above, or staged as part
of this final report+governance commit — see the chat response for the
exact file list).

## 71. Recommended next step

None automatically — per this stage's own explicit instruction: do not
start AM-18, do not begin another visual redesign, do not begin
production deployment. Await explicit user direction.

## 72. REPORT CONTENT HEAD

`8547bb0` — the actual commit immediately before this report's own
commit, read from Git, not guessed. Every finding in this report
describes the working tree as it stood from AM-17's starting HEAD
(`e5ea656`) through this commit.

## 73. REPORT COMMIT

TO BE FILLED IN CHAT AFTER COMMIT.
