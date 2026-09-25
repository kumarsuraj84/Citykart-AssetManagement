# CKAM — Durable Product Decisions

Newest first. These override older spec/plan text where they conflict.

## 2026-09-25 — Add Asset: mandatory procurement fields, Purchase Date auto-derived

Direct user request, tightening Add Asset's own create path (previously all
of these were optional except Description/Category):

1. **Category, Sub-Category, Description, Vendor, PO Number, PO Date,
   Invoice Number, Invoice Date, PI Number, PI Date are all now mandatory**
   on `POST /api/assets` (`AssetCreateIn`) and in the Add Asset form's own
   `canSave` gate. Category/Description were already mandatory; this adds
   Sub-Category/Vendor/PO/Invoice/PI to that set.
2. **Purchase Date is no longer a user-fillable field, on Add Asset or the
   Purchase Order delivery path** — it is always exactly Invoice Date.
   `AssetCreateIn` has no `purchase_date` field at all; the router derives
   `purchase_date = invoice_date` server-side
   (`app/assets/router.py::create_asset`), the same way
   `deliver_pending_assets` already derived it for the PO path from day
   one of that feature. The Add Asset form's own "Purchase Date" input was
   removed; Invoice Date's helper text now says so explicitly.
3. **Deliberately unchanged**: `AssetUpdateIn` (ordinary Asset 360 Edit
   mode — Purchase Date was never editable there either, via AM-07's
   correction-only policy), the AM-07 correction workflow itself
   (`AssetCorrectionIn` still edits Purchase Date directly when a genuine
   correction is needed — e.g. Invoice Date itself was wrong at entry
   time), and the Purchase Order / Pending Asset entry path's own fields
   (already had this exact Purchase-Date-equals-Invoice-Date rule from
   its original design).

## 2026-09-25 — Purchase Order / Pending Assets feature

Full design reasoning: `docs/specs/2026-09-25-po-pending-assets-design.md`.
Implementation plan: `docs/superpowers/plans/2026-09-25-po-pending-assets-implementation.md`.

1. **A second, optional entry path — Add Asset is completely unchanged.**
   PO-tracked procurement (raise a PO → add pending lines → deliver →
   real assets) exists alongside the existing single-step Add Asset
   form, not instead of it. Nothing about Add Asset's fields, validation,
   or behavior changed.
2. **Two new additive tables (`purchase_order`, `pending_asset`) — no
   change to `Asset`'s own schema.** A `PendingAsset` is not an asset: it
   never appears in the Asset Register, Dashboard, or any export until
   converted. Conversion reuses `app.assets.service.procure_assets`
   completely unchanged (`quantity=1` per line, since each `PendingAsset`
   already represents exactly one physical unit) — same numbering, same
   append-only `asset_event` ledger, no parallel logic.
3. **Quantity at PO-entry creates that many individual `PendingAsset`
   rows immediately**, not one grouped row — each unit needs its own
   serial number at delivery (confirmed by the "20 laptops, 10 mice, 5
   speakers under one PO" example that shaped this design), and this
   also makes partial delivery (only some of a quantity arriving first)
   representable without any special-casing.
4. **PO No/Date and Invoice No/Date/Amount are entered once and shared
   across every line in that batch** — Serial Number and Initial Holder
   are the only two fields that are genuinely per-unit, both filled at
   Delivery Done, never at PO-entry (the item doesn't physically exist
   yet). Cost Centre is a PO-header attribute, not a per-line one —
   corrected same day, after live UAT: it was originally captured
   per line in the "Add Line" form, but one PO is raised against one
   cost centre in practice, so it now lives on `PurchaseOrder` itself
   (`cost_center_id`, additive migration `8c5638e1b65e`) and every
   `PendingAsset` line inherits it automatically at line-creation time.
   `PendingAsset.cost_center_id` is unchanged as a column — it still
   carries the value through to `deliver_pending_assets`/
   `procure_assets` — only its source changed, from user input per line
   to inheritance from the parent PO.
5. **Delivery Done is scoped to one PO's own lines at a time** —
   deliberately not a cross-PO batch screen, since one invoice/PO-No/
   PO-Date block applies to the whole selection and mixing lines from
   different POs into one delivery action would misattribute that
   shared data.
6. **A `PENDING` line can be edited or cancelled at any time before
   delivery; once `DELIVERED` it is frozen** — the resulting real Asset
   then follows the existing Correction workflow like any other asset,
   never edited through this feature again. No hard deletes — a
   cancelled line is a terminal soft state, kept for PO history.
7. **The converted Asset's own `po_number`/`po_date` columns (already
   existing on `Asset`, previously populated only by Add Asset's own
   optional PO fields) are now also populated from the parent
   PurchaseOrder** — found and fixed during planning (the first draft's
   `deliver_pending_assets` signature omitted them); traceability back to
   the originating PO is otherwise only a one-directional link
   (`PendingAsset.delivered_asset_id`), not surfaced on Asset 360 itself
   (explicitly out of scope this stage).
8. **Role gate: ADMIN/IT_TEAM on every PO/PendingAsset endpoint**,
   matching Add Asset's own `require_role("ADMIN", "IT_TEAM")` exactly.
   This was an explicitly open question during design (deferred by the
   user) and was implemented with this default, documented here as the
   actual shipped behavior — trivial to narrow to ADMIN-only later if
   needed (a single `require_role(...)` argument).
9. **Dashboard "Purchase Orders" card, added same day after live UAT.**
   Originally scoped out ("no dashboard surface for pending POs in this
   stage" — superseded by this point). Shows a KPI-style pending
   count/value (all `PENDING` `PendingAsset` rows, company-scoped) plus a
   small capped list (`OPEN_PURCHASE_ORDERS_LIMIT = 5`) of open POs — any
   PO with at least one `PENDING` line, PO No/Date/Vendor/pending-line-
   count, newest `po_date` first — each row linking into
   `/purchase-orders/$id`. Gated to ADMIN/IT_TEAM only, matching the
   Purchase Orders module's own role gate exactly (`include_purchase_orders`
   in `dashboard_service.dashboard_data`): the Dashboard route itself is
   open to VIEWER too (`STAFF_ROLES`), but VIEWER never had access to
   `/api/purchase-orders`, so this card — and the two new `DashboardOut`
   fields behind it — must not leak PO data to VIEWER through the
   Dashboard endpoint as a side channel. A VIEWER's response carries the
   same `{"count": 0, "value": 0.0}`/`[]` shape as "nothing pending", not
   an omitted key, and the frontend hides the card entirely for any role
   outside `["ADMIN", "IT_TEAM"]` (mirrors `router.tsx`'s own
   `WRITE_ROLES`/`canWrite`).

## 2026-09-25 — Barcode field (Purchase Orders → Asset)

CityKart's own internal inventory barcode, distinct from the manufacturer
Serial Number. Requested directly by the user, with two explicit design
choices confirmed before implementation:

1. **Entered once per PO line, not per unit** — like Description/Category/
   Cost/Tax %, not like Serial Number/Initial Holder (which are per-unit,
   filled at Delivery Done because the physical unit doesn't exist yet at
   PO-entry time). A Quantity>1 line's every created row shares the
   identical barcode value entered on that one line.
2. **Optional, and deliberately not unique** — the same barcode value may
   legitimately repeat across multiple assets (the user's own words: "can
   be same of multiple assets"). No DB uniqueness constraint, matching
   Serial Number's own existing (also non-unique) treatment.

Implementation: additive, nullable `barcode` column on both `asset` and
`pending_asset` (migration `6c882ef3b225`), `pending_asset.barcode` carried
through `deliver_pending_assets` into `procure_assets`'s payload exactly
like every other pending-line attribute. Also added to `AssetUpdateIn`
(editable via ordinary Asset 360 Edit mode, same as Serial Number) and
`AUDITED_SCALAR_FIELDS` (change-tracked like every other editable field).
Deliberately NOT added to `AssetCreateIn`/Add Asset's own UI — the request
was specific to the PO path; Add Asset stays unchanged, matching this
feature's own founding decision (point 1 above) that PO-tracked
procurement is additive, never a redesign of the existing path.

## 2026-09-25 — AM-12 scope locked (Dashboard Operational Control Enhancement, G03)

1. **Exception visibility uses one compact "Exceptions" card listing all
   five non-healthy statuses individually, not a lossy 3-way aggregate.**
   The authorization suggested a possible "Repair / Lost / Closed-Disposed"
   grouping, but the Asset Register's own Status filter is single-valued
   (one status per query, not a multi-select) — an aggregated "Closed"
   count covering DISPOSED+SOLD+SCRAPPED could not be click-through-
   filtered to in one step without first expanding the register's own
   filter model, which was out of this stage's scope. Showing all five
   individually keeps every count both fully meaningful and independently
   actionable, satisfying the authorization's own fallback instruction
   ("the user must still be able to understand the underlying counts").
2. **Every exception count links straight into a pre-filtered Asset
   Register** via a new, typed `?status=<STATUS>` route search param
   (`assetsIndexRoute.validateSearch` in `router.tsx`) — a genuine
   navigation target, not a decorative number, per the authorization's
   own "click-through" requirement.
3. **Recent Activity reuses the exact snapshot-correct labeling logic the
   Asset 360 History tab already has**, rather than building a second,
   parallel formatting path. `with_labels` (previously a private helper
   inside `app.lifecycle.router`) was relocated to `app.lifecycle.service`
   specifically so `app.reports.dashboard_service` could import and reuse
   it. This is a structural move, not a behavior change — verified via
   the full backend regression staying green throughout.
4. **The exception counts reuse the dashboard's own existing
   `status_counts` query** (a single already-executed `GROUP BY`), rather
   than issuing a second, redundant count query — the five exception
   statuses are simply read out of that same dict, defaulted to 0 for any
   status with zero matching assets so the metric is never silently
   hidden.
5. **Recent Activity is capped at 5 events, company-scoped identically to
   every other Dashboard widget**, and explicitly documented as
   deliberately NOT a second Movement Log — that report remains the
   authoritative, unbounded historical view.
6. **G04 (ADMIN's Dashboard mixing every company's data with no
   per-company breakdown) was deliberately left unresolved in AM-12.**
   This stage's own authorization explicitly forbade solving it, since the
   underlying business question (how many real companies will CKAM
   Phase-1 actually operate?) still has no answer.
7. **A live-browser observation of HOLDER's `/dashboard` access was
   investigated and ruled out as an application defect.** The backend
   correctly returns `403` (confirmed via a direct browser-console
   `fetch()` call); an isolated unit test driving the real `authFetch` →
   `api-client` → `useQuery` chain against a genuine `403` response
   correctly rendered `ErrorState`. The live-session anomaly (a stale,
   pre-rebuild JS bundle observed loading for `/login` moments before the
   correct bundle loaded for `/dashboard`, in a browser tab that had been
   reused across many rapid account-switches this session) did not
   reproduce in a fresh tab under the same conditions and is attributed to
   a browser-pane/session artifact, not the application. See
   `docs/ai/AM-12_DASHBOARD_OPERATIONAL_CONTROL_REPORT.md` for the full
   investigation.

## 2026-09-25 — AM-11 scope locked (Phase-1 Development Continuation + Business Gap Review)

1. **Production deployment is deferred; AM-10's evidence and its
   `ckam-v1.0.0-rc1` tag are preserved, not superseded.** There is
   currently no production server. AM-08 through AM-10's release-
   readiness focus and feature freeze are modified, not discarded — every
   AM-10 finding, document, and regression baseline remains valid
   evidence for whenever a production server is actually provided.
2. **Feature freeze is lifted specifically for evidenced Phase-1 gap
   closure, not general feature growth.** Every enhancement made under
   this relaxed freeze must be justified by an existing CityKart Phase-1
   requirement, legacy ThreadERP domain evidence, a current CKAM workflow
   gap, direct user feedback, or demonstrated operational need — never
   "a typical asset system might have this."
3. **The Asset Register must show who currently holds an asset and which
   company it belongs to without a click into every row.** This directly
   follows from CKAM's own stated core guarantee
   (`docs/ai/PRODUCT_CONTEXT.md`: "for any asset, at any time, you can
   answer where is it, who holds it") — a register that cannot answer
   that without navigation was judged a genuine MUST-HAVE gap, not a
   nice-to-have. Implemented via a page-scoped batch id→name lookup
   (only the distinct holder/company ids on the current page, never a
   whole-table fetch), the same architectural pattern
   `export_service.py` already used for exports, adapted to be lighter
   for a per-request/per-filter-keystroke endpoint.
4. **Asset search now covers Description, not just code-like
   identifiers.** A real operator is more likely to remember an asset's
   description than its generated Asset Code — found missing by direct
   comparison against the authorization's own search checklist, fixed
   with a one-line addition to the existing search clause.
5. **The legacy ThreadERP comparison confirms, rather than challenges,
   every one of CKAM's existing locked V1 scope exclusions.** ThreadERP
   is a full accounting-grade fixed-asset/depreciation ERP module (AMC,
   Insurance, Market Valuation, Depreciation, Retrospective Effect,
   Transfer To/From General Reserve, an approval workflow for both new-
   asset submission and custody movement, formal physical-asset
   verification). CKAM is deliberately narrower — a physical custody-
   lifecycle tracker — and this stage's read-only exploration of a real,
   populated 12,862-asset ThreadERP instance found no evidence that any
   of that excluded breadth is actually needed for CityKart's Phase-1
   operating model. This re-validates, not newly discovers, the original
   AM-01 scope decisions below.
6. **The Dashboard's lack of Repair/Lost/Disposed exception counts and a
   recent-activity feed is a real, evidenced SHOULD-HAVE gap — but was
   not implemented this stage.** Deliberately deferred to its own future
   mini-gate cycle (per the AM-11 authorization's own "do not create a
   giant enhancement batch" instruction) rather than bundled into the
   same commit as the Asset Register fix, since it touches a different
   screen and a different query surface.
7. **Three specific Phase-1 business decisions remain genuinely open and
   were not guessed at**: whether CityKart's real Asset/IT team needs
   cross-company account access (`holder_company_access`), whether Import
   should warn on a duplicate Serial Number within a company (a practical
   option proposed, not built), and whether ADMIN's Dashboard needs a
   per-company breakdown for real multi-company Phase-1 use. Each is
   recorded as USER DECISION REQUIRED in `docs/ai/PHASE1_GAP_REGISTER.md`.
8. **A new development/UAT test-data naming convention was established**
   (`docs/ai/DEVELOPMENT_GUARDRAILS.md`): company code
   `UAT-<stage>-<suffix>`, asset description prefix `"UAT - "`, holder
   emp_code prefix `UAT-<stage>-...` — additive to, not a replacement
   for, the existing E2E fixture's own `E2E-*`/`E2EB*` pattern. No
   historical UAT/E2E/RC data was renamed, cleaned, or deleted; the
   current DEV/UAT database's existing test data remains acceptable for
   development use, per this stage's own explicit instruction.

## 2026-09-25 — AM-10 scope locked (Production Go-Live Preparation)

1. **Verdict: GO-LIVE PREPARED WITH DECISIONS REQUIRED, not GO-LIVE
   PREPARED outright.** Every open item is a data/deployment decision or a
   server-specific configuration/cleanup step, never a software defect —
   see `docs/ai/AM-10_GO_LIVE_PREPARATION_REPORT.md` §46 for the exact
   list. AM-10 deliberately does not resolve these itself; they require
   either an explicit business answer (which database becomes production)
   or access to the real production server this session cannot have.
2. **The recommended production-data strategy is a fresh database, not
   promoting the current `ckam` database — recorded as a recommendation,
   not an executed decision.** The evidence is unusually clean: 98 of 99
   companies, 299 of 305 holders, and 158 of 159 assets in the live `ckam`
   database are confirmed test data by direct cross-reference to known
   fixture patterns (E2E company codes, `AM0xUAT`/`AM09SCALE`/`RC*`
   tags), and the one genuinely real company has zero genuine business
   assets and no usable supporting master data of its own (its Cost
   Centre, Vendor, and active Code Rules are all test-named). This
   decision is still left to the user, per the AM-10 authorization's own
   explicit instruction not to silently promote or silently clean the
   current database.
3. **An active ADMIN-role test account (`UATADMIN`) inside the real
   production company is classified a P1 go-live blocker, but was not
   deactivated automatically.** This is a data-hygiene finding, not an
   authorization defect — every server-side role/company/holder check
   remains correct and unweakened; the issue is that this particular
   account should not exist as active data in the real company at
   cutover. Per the AM-10 authorization's explicit instruction, fixing
   this requires either an explicit deactivation step (if the current
   database is promoted) or is made moot by choosing a fresh database
   instead (decision 2).
4. **AM09-05 (missing security headers) and AM09-06 (missing
   `Cache-Control`) were resolved with a narrow nginx-only change**
   (`frontend/nginx.conf`, commit `1f77c24`) — `X-Content-Type-Options`,
   `X-Frame-Options`, `Referrer-Policy` on every response, `Cache-Control:
   no-store` on `/api/` responses only. No HSTS — correctly, since this
   deployment remains plain-HTTP. A real nginx gotcha was found and fixed
   during verification: a `location` block's own `add_header` directives
   silently suppress inheritance of a parent `server` block's
   `add_header` directives, so the three general headers had to be
   explicitly repeated inside `location /api/`, not only declared once at
   the `server` level.
5. **A code-only rollback to the immediately-prior release commit is
   confirmed mechanically safe.** Rehearsed live: the prior release
   commit was checked out into a disposable git worktree, its backend
   image built fresh, and a throwaway container from that image run
   against a disposable database at the *current* schema head — health
   and login both succeeded cleanly. This is expected and unsurprising
   given neither AM-09 nor AM-10 introduced any database migration, but
   it is now evidenced, not merely assumed.
6. **`worktree-ckam-build` remains unpushed, with no upstream tracking
   branch, and the remote holds no CKAM release history at all.** A local,
   unpushed release tag (`ckam-v1.0.0-rc1`) was created at the final
   AM-10 commit as preparation for an eventual push, per the AM-10
   authorization's own explicit permission to do so when git is clean and
   the release commit is unambiguous — pushing itself remains entirely
   the user's decision.
7. **No AM-09 P2/P3 business-decision item, and no newly-found data/
   account hygiene item, is itself a release blocker for the
   *application*.** They are decisions and cleanup steps that must happen
   before *this specific deployment* proceeds, which is a narrower claim
   than "the software is not ready" — the software's own RELEASE READY
   verdict from AM-09 stands unchanged through AM-10's full regression
   re-run.

## 2026-09-24 — AM-09 scope locked (Release Candidate Full-System Audit)

1. **Verdict: RELEASE READY.** No P0 (blocker-class) defect was found
   anywhere in the audit — no data loss, authorization bypass,
   cross-company leak, broken restore, broken app-start, or broken
   migration. Four evidenced P1 defects were found and fixed (see below);
   all release gates (database, security, functional, backup/restore,
   deployment/config) pass. Full reasoning: `docs/ai/
   AM-09_RC_FULL_AUDIT_REPORT.md` §72.
2. **Excel export formula injection is a real, fixed security defect, not
   a false positive.** Every user-controlled free-text value in any of the
   three canonical exports (Description, Brand, Vendor name, a Custom
   Field's text value, a correction Reason, movement remarks) was written
   as a raw openpyxl cell value; a value beginning with `=` is
   auto-flagged by openpyxl as a live formula and would execute when the
   file is opened in Excel. Fixed with the standard mitigation (a leading
   apostrophe forcing literal-text interpretation) applied to every data
   cell, for all four classic trigger characters (`=`,`+`,`-`,`@`), across
   all three export functions — never touching header rows, which are
   fixed literals, not user input.
3. **A naive (timezone-less) `event_date` on a lifecycle event is valid
   input, not adversarial input, and must be treated as UTC rather than
   crash.** The real frontend always sends an offset-aware ISO string, so
   this defect could only be reached via a direct API call — still fixed,
   since the API contract itself never required an offset and a bare
   ISO-8601 date is a completely reasonable value for a direct integration
   to send.
4. **A duplicate unique value (a master's `code`, a Holder's
   company-scoped `emp_code`) is an ordinary data-entry mistake, not
   malformed input, and must return a controlled 422 — never a raw
   `IntegrityError`/500.** Fixed identically on both the generic
   `build_master_router` endpoints and the bespoke Holders router by
   catching `IntegrityError`, rolling back, and raising a specific 422
   message. No uniqueness *rule* changed — these constraints already
   existed at the database level; only the failure-handling changed.
5. **Numbering concurrency needed no code change.** A genuine 20-way
   parallel `POST /api/assets` reproduction (real asyncio concurrency
   against the real pooled database connection, not a simulation)
   confirmed the existing atomic `INSERT ... ON CONFLICT ... DO UPDATE ...
   RETURNING` UPSERT already serializes concurrent allocators correctly at
   the database level — zero duplicate Asset Codes, zero gaps in the
   allocated sequence.
6. **The disposable-database restore pattern (not the pre-existing
   destructive `ops/test_backup_restore.sh`) is the correct way to prove
   restore capability against a live, data-holding environment.** A fresh,
   uniquely-named database (`ckam_restore_test`) was created on the same
   Postgres instance, the real backup's SQL was piped into it directly,
   verified (row counts, Alembic revision, triggers, indexes all matched
   the pre-backup baseline exactly), then dropped — the live `ckam`
   database was never touched. This pattern, not the schema-dropping
   script, should be the template for any future restore drill against an
   environment holding real or valuable UAT data.
7. **CORS absence in `app/main.py` is confirmed correct-by-design, not an
   unverified gap.** `frontend/nginx.conf` proxies `/api/` to the backend
   on the exact same origin the SPA is served from — no cross-origin
   request is ever made by the browser in this architecture, so no CORS
   middleware is needed or should be added.
8. **`COOKIE_SECURE=false` and the absence of security response headers
   (HSTS, X-Frame-Options, etc.) are classified against this deployment's
   actual plain-HTTP, LAN-only architecture, not against a hypothetical
   Internet-facing one.** `COOKIE_SECURE=false` is correct as long as this
   deployment stays HTTP-only (flip it only once genuinely behind HTTPS —
   a `Secure` cookie is silently dropped over plain HTTP). The missing
   security headers (AM09-05) and missing `Cache-Control` (AM09-06) are
   real but low-severity for a LAN-only internal tool and were documented,
   not fixed, per the audit's own narrow-fix-only policy for P2/P3 items.
9. **Five documented-but-unfixed observations (AM09-05 through AM09-09)
   and the four carried-forward business decisions (`holder_company_
   access`, import duplicate detection, 5 unconstrained closed-value
   columns, no bulk correction) are explicitly not release blockers.**
   Their existence alone does not change the RELEASE READY verdict — see
   `docs/ai/RC_ISSUES.md` for the full register.

## 2026-09-24 — AM-08 scope locked (Known-Issue Remediation + RC Hardening)

1. **Add Asset's dependent master options follow each master's actual
   company scope, established from the schema, not from the observed UX
   alone.** `cost_center.company_id` exists (`CostCenter` is genuinely
   company-owned) — its list endpoint gained an optional, opt-in
   `company_id` filter, and Add Asset now passes its own company id.
   `asset_category`/`vendor` have no `company_id` column at all — they are
   genuinely global masters, and their unfiltered list behavior is correct
   and was left unchanged; the AM-07-era assumption that Category needed
   the same fix as Cost Centre did not hold up against the actual schema.
   The generic filter is a read-side narrowing an opted-in caller requests
   (Add Asset), never a new default restriction — every Setup screen's own
   unfiltered `GET /api/masters/<resource>` call is unchanged, and a
   `company_id` passed against a master with no such column is silently
   ignored rather than erroring.
2. **There is no Company selector inside Add Asset to react to** — company
   is fixed for the whole form from the logged-in holder's own
   `companyId` (`useAuthStore`), consistent with "no login company
   selector." The "clear dependent fields when Company changes" scenario
   from the original bug report does not arise in the current
   implementation; it would need to be designed if a future stage ever
   introduces a Company switcher inside Add Asset itself.
3. **`Holder.location_id` is a required (NOT NULL) foreign key — it was
   never actually optional.** Confirmed from the original migration
   (`nullable=False`) and `HolderIn.location_id: int` (no `| None`,
   no default) — `department_id` is the one genuinely optional relation.
   The correct fix for the "blank Location sends `location_id: 0`" defect
   was therefore to make the frontend honestly require it (Save disabled
   until Company/Emp Code/Name/Type/Location are all set, an asterisk
   matching every other required field in the app), not to make the
   backend accept a blank/null Location — that would have contradicted the
   schema's own guarantee.
4. **A malformed Holder write (a `0` sentinel or a nonexistent id for
   `company_id`/`location_id`/`department_id`) now fails with a controlled
   422, never a raw database error.** `_validate_holder_references`
   (`app/holders/router.py`) checks existence+active status for all three
   before the row ever reaches `HolderService.create`/`update`, mirroring
   the existing `_validate_holder_fields` (`holder_type`/`role`) pattern —
   validate before the service touches the session, per the guardrail
   against leaking DB errors in API responses. This is defensive hardening
   against any client, not only the one frontend form that triggered its
   discovery.
5. **A read-only relational field in a `MasterCrudScreen` Edit dialog
   renders its human-readable label via an optional `format` callback**
   (`FormField.format`, mirroring the existing list-column `Column.format`)
   — never the raw stored id. Applied to Subcategory's parent Category and
   Cost Centre's parent Company (the only two masters with an immutable
   relational field in their `formFields`); the underlying relationship and
   its immutability are unchanged, this is presentation only.
6. **CKAM V1 enters feature freeze after AM-08.** No further business
   feature work proceeds without new, explicit authorization — the next
   authorized stage is a Release Candidate audit (verification only), not
   a new feature stage.
7. **Unresolved business-decision items stay exactly as deferred**:
   `holder_company_access` (needs CityKart's answer on whether asset/IT
   staff are organizationally shared across companies), import-side
   duplicate detection (needs a business definition of "duplicate"), the 5
   unconstrained closed-value DB columns (deliberately left flexible for a
   future approval-workflow stage), and no bulk correction in V1. AM-08
   touched none of these.

## 2026-09-24 — AM-07 scope locked (Controlled Asset Classification + Purchase-Date Correction)

1. **`category_id`, `subcategory_id`, `purchase_date` are correctable, but
   only through a dedicated correction endpoint — never through
   `AssetUpdateIn`/`PUT /api/assets/{id}`.** A correction is not a normal
   edit: it requires a mandatory reason, is role-restricted to
   ADMIN/IT_TEAM (never VIEWER/HOLDER), and is recorded distinctly in the
   audit trail. `AssetUpdateIn` was never extended with these three fields;
   `trg_asset_no_identity_change` was never touched (it never protected
   these fields in the first place — see item 5).
2. **Asset Code is permanently immutable across a correction, by
   construction, not by a runtime check.** `app/assets/correction_service.py`
   never imports or calls anything from `app.numbering` — the numbering
   service (`build_code_tokens`/`generate_code`/`get_active_rule`) is only
   ever invoked at asset-creation time (`procure_assets`, `commit_import`).
   A correction request cannot regenerate `asset_code`, cannot consume a new
   `code_counter` value, and cannot reset numbering, because the code that
   would do those things is simply never reachable from the correction path.
3. **Correction endpoint: `POST /api/assets/{id}/corrections`**
   (`AssetCorrectionIn`: `category_id`, `subcategory_id`, `purchase_date` all
   optional, `reason` required). Uses the exact same `_get_scoped_asset`
   helper `update_asset` already uses, so scoping semantics (HOLDER pinned
   to own asset, others scoped by `scoped_company_ids`, fail-closed 404 for
   out-of-scope) are identical by construction, not by parallel
   implementation. Role-gated `require_role("ADMIN", "IT_TEAM")` — VIEWER
   and HOLDER receive 403 before scoping is even evaluated.
4. **Category/Subcategory relationship integrity rule**: a new category
   must exist and be active; a supplied subcategory must exist, be active,
   and belong to the *effective* (possibly newly-corrected) category. If the
   category changes and the asset's *current* subcategory (not explicitly
   re-supplied) no longer belongs to the new category, the request is
   rejected with an actionable message telling the caller to supply a valid
   `subcategory_id` for the new category or explicitly set it to `null` —
   the service never silently leaves an invalid category/subcategory pair.
5. **`trg_asset_no_identity_change` needed zero changes for AM-07.**
   Verified by three independent methods before writing a line of service
   code: (a) reading the original migration (`0003_assets_and_events.py`,
   `forbid_asset_identity_change()`), (b) grepping every later migration for
   any redefinition of the trigger function (none found), (c) querying
   `pg_proc.prosrc` on the live `ckam` database directly. The trigger only
   ever protected `asset_code`, `company_id`, `cost_center_id` — never
   `category_id`/`subcategory_id`/`purchase_date`. This is why the
   correction service can freely assign those three fields without any DB
   trigger change, narrower-than-expected surface, or risk of weakening
   identity protection globally.
6. **Purchase Date correction chronology rule**: `corrected_purchase_date`
   must not be in the future, and must not be later than the asset's
   earliest recorded `asset_event.event_date`. Derived directly from
   `apply_event`'s own two pre-existing, evidence-backed rules (reject a
   future event date; reject an event date before the last recorded event),
   applied in the historical direction rather than invented from scratch.
   Historical `asset_event` rows are never rewritten by a Purchase Date
   correction — only `asset.purchase_date` itself changes.
7. **Correction audit reuses `asset_field_change`, not a new table and not
   `asset_event`.** A controlled correction to asset master data is judged
   the same *kind* of fact `asset_field_change` already exists to record
   (a change to a field, not a lifecycle movement), so no third audit
   system was created and corrections are never written into `asset_event`
   (which stays lifecycle-only). One small additive migration
   (`f28b6a913dce`) adds a nullable `reason VARCHAR(500)` column to
   `asset_field_change` — the sole discriminator between a correction row
   (`reason IS NOT NULL`) and an ordinary Edit-mode row (`reason IS NULL`);
   no separate "row type" column was added. Corrections use a dedicated
   `CORRECTION_FIELDS`/`record_correction_changes` (in
   `app/assets/audit_service.py`), kept deliberately separate from the
   existing `AUDITED_SCALAR_FIELDS`/`record_field_changes` used by ordinary
   Edit-mode saves, so the two can never cross-contaminate.
8. **Correction audit snapshots are human-readable, not bare IDs.** A
   Category/Subcategory correction stores `"{code} - {name} (#{id})"` (new
   `_describe_category`/`_describe_subcategory` helpers, matching the
   existing `_describe_vendor` pattern) so a later master rename never makes
   old correction history unreadable. Purchase Date stores normalized ISO
   date strings. Every correction row shares one `request_id` (UUID) across
   however many fields actually changed in that request.
9. **Asset 360 gets a separate "Correct Classification" action, never a
   field added to ordinary Edit mode.** The button appears only next to
   Edit inside the same `canEdit` (ADMIN/IT_TEAM) conditional; backend
   authorization remains the actual enforcement (§ decision 3), the
   frontend omission is UX only. The dialog shows Asset Code read-only with
   "Asset Code will not change", prefills current Category/Sub-Category/
   Purchase Date, reacts Sub-Category's option list to the selected
   Category, shows an Impact Summary (old → new per changed field, plus
   "Asset Code: unchanged") before Confirm, and requires a non-blank Reason.
   Confirm Correction stays disabled until at least one field actually
   differs from the asset's current values and Reason is non-blank.
10. **No bulk correction in V1.** The correction endpoint and UI operate on
    exactly one asset per request; a bulk-correction UI is explicitly
    deferred to a future stage requiring its own authorization.
11. **Changes tab renders a correction distinctly from an ordinary edit**
    (a "Correction" pill vs. plain "Edit" text, keyed off `reason IS NOT
    NULL`) and shows the Reason column — the asset's lifecycle History tab
    is untouched by any correction (proven live: History event count and
    text were identical before and after two live corrections performed
    during this stage's browser UAT).

## 2026-09-24 — AM-06 scope locked (Import + Export/Reports + My Assets)

1. **Exact Import spreadsheet column contract** (`backend/app/imports/
   asset_import_service.py::TEMPLATE_COLUMNS`), human-readable business
   headers, looked up by name from the workbook's own header row (never
   positional, so column order in an uploaded file never matters):

   | Column | Backend field | Required | Lookup |
   |---|---|---|---|
   | Company Code | `company_id` | yes | `Company.code` |
   | Cost Centre Code | `cost_center_id` | yes | `CostCenter.code`, scoped to the row's own company |
   | Category Code | `category_id` | yes | `AssetCategory.code` |
   | Subcategory Code | `subcategory_id` | no (AM-06 change, see item 2) | `AssetSubcategory.code`, scoped to the row's own category |
   | Description | `description` | yes | — |
   | Legacy Asset Code | `legacy_asset_code` | no | — |
   | Purchase Date | `purchase_date` | yes | `YYYY-MM-DD` |
   | Vendor Code | `vendor_id` | no | `Vendor.code` |
   | PO Number / PO Date | `po_number` / `po_date` | no | `po_date` is `YYYY-MM-DD` |
   | Invoice Number / Invoice Date | `invoice_number` / `invoice_date` | no | same date format |
   | PI Number / PI Date | `pi_number` / `pi_date` | no | same date format |
   | Purchase Cost | `purchase_cost` | no (defaults 0) | number |
   | Tax % | `tax_percent` | no (defaults 0) | number |
   | Brand / Model / Serial Number | `brand` / `model` / `serial_number` | no | — |
   | Warranty Upto | `warranty_upto` | no | `YYYY-MM-DD` |
   | Initial Holder Code | `current_holder_id` (initial) | yes | `Holder.emp_code`, scoped to the row's own company |
   | Quantity | multi-create count | no (defaults 1) | whole number ≥ 1 |
   | `Custom:<field_key>` | `Asset.custom_fields[field_key]` | see item 4 | typed per the field's `field_type` |

   Missing any *required* column entirely (not just blank cells) is a
   single file-level error (`ImportTemplateError`), not per-row noise — the
   file is rejected before any row is even read.

2. **Subcategory is now optional on import**, matching Add Asset's own
   optional Sub-Category field — a deliberate behavior change from the
   pre-AM-06 import, which treated a blank subcategory as an "unknown
   subcategory_code" row error. Note this doesn't make a code-rule template
   that references `{subcategory.code}` magically work with a blank
   subcategory — that's an unrelated, pre-existing numbering-template
   concern (the same one Add Asset already has), not something AM-06
   changed.

3. **Custom Field import/export header convention: `Custom:<field_key>`**
   (`app.imports.asset_import_service.CUSTOM_FIELD_PREFIX`), keyed by the
   field's stable `field_key`, never its display `label` — a label rename
   must never break a saved spreadsheet. Chosen over the alternative
   (matching by label) specifically because no prior convention existed to
   preserve compatibility with, and `field_key` is already the codebase's
   established stable identifier for a Custom Field everywhere else
   (`Asset.custom_fields` itself is keyed by it). The same convention is
   used for export column headers, so an export can be edited and
   re-imported without semantic ambiguity.

4. **Company-scoped UDF import behavior reuses AM-05's exact applicability
   rule** (`applicable_custom_fields`/`validate_custom_field_values` from
   `app.assets.custom_field_values`), never a separate import-only rules
   engine. Per row: unknown/inactive/wrong-company `Custom:` column with a
   non-blank value is a row error; the same column left blank is silently
   ignored (not an error) if it's simply not applicable to that row's
   company; a Global or same-company required field with no value anywhere
   in the row is a row error; a required field belonging only to a
   *different* company is never counted, never required, never blocks that
   row.

5. **Asset register export = the current asset snapshot. Movement log
   export = `asset_event`. Field-change audit export (new) =
   `asset_field_change`. These are three separate canonical datasets and
   must never be flattened into one another** — reconfirms and extends the
   `asset_event`-vs-`asset_field_change` separation already locked in the
   AM-04 entry below. A future stage must not "simplify" this into one
   giant export.
6. **Import commit stays VALID-ROWS-ONLY per row, unchanged from
   pre-AM-06** (confirmed by reading the code, not assumed — a prior
   report's claim that duplicate-handling was already covered turned out
   not to match the actual code, see the AM-06 report §8/§17): each row
   commits inside its own `SAVEPOINT`, so one row's failure (no active
   code rule, an unresolvable token, a lifecycle rejection) never aborts
   sibling rows. The one exception, unchanged: a company-scope violation
   anywhere in the file refuses the *entire* file (403, nothing written) —
   an authorization boundary, not a data-quality one, so it stays
   all-or-nothing. **Extension for AM-06's new Quantity**: every unit of
   one row's Quantity shares that row's single savepoint — a mid-row
   failure discards every unit the row would have created, not a partial
   2-of-3, since the row (not the unit) is the atomic thing a user reviews
   and retries.
7. **No new import-side duplicate detection was added** (legacy code,
   serial number, PO/invoice/PI number can all repeat across rows/assets,
   exactly as before AM-06) — no business evidence any of these fields is
   meant to be unique; Asset Code remains the only system-enforced-unique
   identifier. Reconfirmed in `REVIEW_FINDINGS.md`.
8. **No database migration in AM-06** — confirmed unnecessary and not
   attempted: every field Import/Export now surface already existed on
   `Asset` (procurement, since AM-02) and `CustomField` (`company_id`,
   since AM-05).
9. **My Assets' business meaning is unchanged** — still literally
   `GET /api/assets` with a HOLDER's `holder_id` pinned server-side to
   their own id (any other role sees their normal `scoped_company_ids`-
   scoped register, exactly as before). AM-06 only changed the UI
   (shared-component migration, a Category column added then removed —
   see item 10) and fixed a hardcoded link color; no backend scoping logic
   changed.
10. **My Assets does not show a Category column.** One was added, then
    removed after this stage's own browser UAT caught it showing a raw
    numeric id for any asset whose category had since been deactivated
    (`/masters/categories` only returns active rows, and My Assets doesn't
    have Asset 360's live point-lookup-by-id available in a list view).
    Asset Register itself doesn't show a Category column either — dropping
    it keeps My Assets to data it can always render correctly, rather than
    a fragile client-side join for a field the authorization only called
    "likely," not required.
11. **`holder_company_access` remains unresolved and untouched** —
    reconfirmed, same as every prior stage; AM-06 was explicitly instructed
    not to start it.

Full evidence: `docs/ai/AM-06_IMPORT_REPORTS_MY_ASSETS_REPORT.md`.

## 2026-09-24 — AM-05 scope locked (Masters + Holders + company-scoped Custom Fields)

1. **`CustomField.company_id` (nullable FK to `company`): `NULL` = Global
   (applies to every company's assets), a real id = applies only to that
   company's assets.** Closes the operational risk AM-04 flagged (item 0 of
   the AM-04 entry below): a required field created for one company used to
   block asset creation in *every* company, because every Custom Field was
   implicitly global with no way to scope it narrower. Every pre-AM-05 row
   keeps its exact prior meaning unchanged (`NULL` = Global = "applies
   everywhere," which is what every existing field already meant) — the
   migration (`370399c6380e`) never rewrites an existing row's scope, it
   only adds the column. Deliberately simpler than category/subcategory-
   scoped UDFs, which were explicitly out of scope for this stage.
2. **Applicability rule**: for an asset belonging to company X, the
   applicable Custom Field definitions are every active field where
   `company_id IS NULL` (Global) plus every active field where
   `company_id = X`. A field scoped to a different company is, from that
   asset's point of view, indistinguishable from a field that doesn't exist
   at all — it can never render, never validate, never become required,
   never block creation, for an asset it wasn't scoped to
   (`app/assets/custom_field_values.py::applicable_custom_fields`, mirrored
   client-side in `AddAssetForm.tsx`/`AssetDetail.tsx`). Requiredness is
   therefore evaluated only across an asset's own applicable set, never the
   global set of every Custom Field that exists.
3. **`field_key` and `field_type` are immutable for the lifetime of a
   Custom Field, no exception.** Asset values are stored in
   `Asset.custom_fields` keyed by `field_key`, so changing it would orphan
   every existing value under the old key; changing `field_type` could
   invalidate values already stored under the old type's shape (e.g. a
   `dropdown`'s stored string no longer matching a new `checkbox`'s boolean
   expectation). Both are simply absent from `CustomFieldEditIn` — the same
   "undeclared field is silently ignored on PUT" convention `AssetUpdateIn`
   already established for `asset_code`/`company_id`.
4. **A Custom Field's scope (`company_id`) may only change while no asset
   yet holds a value for that `field_key`.** Once any asset has a value
   under a key, re-scoping the field could make that value invisible to the
   company that entered it (if moved away) or expose it to a company it was
   never meant for (if moved in) — both are silent, surprising data-
   visibility changes, so the backend rejects the PUT with a 422 naming the
   field key (`any_asset_has_value_for`) rather than allowing it quietly.
5. **Custom Field mutation authorization**: ADMIN may create/edit/
   deactivate a Custom Field at any scope, Global included. IT_TEAM may
   only create/edit/deactivate a field scoped to its own company — **never
   Global**, since a Global field affects every company IT_TEAM isn't
   authorized to touch. VIEWER/HOLDER may never mutate a Custom Field.
   Enforced server-side (`_check_scope_authorization` in the new
   `app/masters/custom_fields_router.py`) regardless of what the frontend
   shows; the frontend additionally hides row actions IT_TEAM isn't
   authorized for and constrains their Scope control to their own company,
   as UX, not as the actual boundary.
6. **Making an optional Custom Field required needs a stronger,
   scope-aware confirmation than an ordinary field edit** — a Global
   field's confirmation states it affects every company; a company-specific
   field's confirmation names that one company. Never a silent row
   checkbox toggle; both flow through the same deliberate Edit → Save →
   confirm → PUT sequence.
7. **Safe master-edit field policy (applies to Companies, Locations,
   Departments, Cost Centres, Categories, Subcategories, Vendors)**: each
   master's business code (`code`, or for Cost Centre/Subcategory also
   their company/category relationship) is immutable after creation —
   already referenced by assets or other masters, and never safely
   reassignable through a generic edit form. Display names, addresses, and
   vendor contact details (`contact_name`/`contact_phone`/`contact_email`,
   newly surfaced in the UI this stage — the fields already existed on the
   backend schema, unused) are freely editable. Enforced by a per-master
   `*EditIn` Pydantic schema (narrower than the create schema) passed to
   `build_master_router`'s new `schema_edit` parameter — an omitted field
   is silently ignored on PUT by any role, not just a scoped one; this is
   stronger than a per-role check, since it removes the capability from the
   endpoint entirely rather than gating it.
8. **Master/Custom Field/Holder deactivation stays soft, confirmed, and
   named.** No hard deletes anywhere in this stage. Every Deactivate action
   in the UI now opens a confirmation naming the specific record before
   calling the existing (unchanged) soft-deactivate endpoints — a UI
   addition, not a new backend capability.
9. **Holder.role stays ADMIN-only to change, end to end** — reconfirmed,
   not reopened: `PUT /api/holders/{id}` already required ADMIN only
   (unchanged this stage); this stage adds explicit backend test coverage
   proving IT_TEAM cannot update, deactivate, or reset the password of any
   holder, plus a frontend-only role-change warning (current role shown,
   an inline warning when the selected role differs from it) so a role
   change is never silent even though the backend was already correct.
10. **Master Change History**: `asset_field_change` remains asset-only —
    not extended to masters. The existing `created_by`/`updated_by`/
    `created_at`/`updated_at` `AuditMixin` standard is sufficient for
    masters; a generic enterprise audit framework was explicitly out of
    scope for this stage.
11. **`holder_company_access` remains untouched** — reconfirmed, same as
    every prior stage; not wired, not removed, not in scope.
12. **No backend change beyond what AM-05 explicitly authorized** — one new
    column + its migration (`370399c6380e`, additive/nullable/reversible),
    the Custom Fields bespoke router, the per-master `*EditIn` schemas, and
    the applicability-filtering change to `validate_custom_field_values`.
    No change to `asset_event`, `asset_field_change`, the lifecycle state
    machine, numbering's counter/atomicity, or category/subcategory/
    purchase_date's non-editable status (reconfirmed, not reopened).

**New governance convention, effective this stage — "no self-reference" for
a report's Final Git State (see also the note at the top of
`AM-05_MASTERS_HOLDERS_REPORT.md`):** a committed stage report must never
try to record its own eventual commit hash inside itself — a report commit
necessarily happens *after* the content is written, so any hash recorded in
that content describing "the final commit" is either a guess or already
stale the moment it's written, which is exactly the self-reference loop
AM-03 and AM-04's reports both fell into (each "fixing" the hash created a
new commit, which changed the true final hash again). From AM-05 onward, a
committed report instead records **"REPORT CONTENT HEAD: `<hash>`"** — the
real commit immediately before the report/governance commit, which is
knowable and true at the moment the content is written — plus the literal
line **"REPORT COMMIT: TO BE FILLED IN CHAT AFTER COMMIT"**. The actual
report-commit hash and the actual final `HEAD` are read via `git log` after
committing and stated **only in the chat response that delivers the
report**, never chased back into the file with a further correction commit.

Full evidence: `docs/ai/AM-05_MASTERS_HOLDERS_REPORT.md`.

## 2026-09-24 — AM-04 scope locked (Add Asset + Asset 360 + procurement/UDF UI + edit audit)

0. **Operational risk worth flagging: Custom Fields are global across every
   company** (confirmed in AM-02, unchanged here) **and `is_required` now
   actually blocks asset creation everywhere it applies (new in AM-04).**
   An ADMIN in any one company marking a Custom Field required immediately
   affects every company's Add Asset flow, not just their own — discovered
   concretely during this stage's own browser UAT (a required field created
   to exercise the UI blocked the E2E suite's unrelated fixture company
   until deactivated again). This was already true architecturally since
   Custom Fields were made global, but had no practical consequence until
   `is_required` had real teeth. Not a bug — a genuine characteristic of the
   current single-global-Custom-Field-set design worth keeping in mind
   before anyone adds a required field in the live app; per-company or
   per-category-scoped Custom Fields were never in scope for any stage so
   far and would be a real, separate design decision if ever needed.
1. **Required-UDF enforcement rule.** On asset **create**, every active
   `CustomField.is_required=true` must have a valid value — enforced
   unconditionally, server-side (`procure_assets` always calls
   `validate_custom_field_values(..., enforce_required=True)`), never
   relying on frontend validation alone. On **edit**
   (`PUT /api/assets/{id}`), required-completeness is enforced **only when
   the edit itself includes `custom_fields`** — an existing asset that
   predates a newly-added required field must never be blocked from an
   unrelated edit (e.g. fixing a serial number) just because it has no value
   for that field yet. Since `AssetUpdateIn` is a full-replace PUT (see item
   2 below), Asset 360's Edit mode always submits the complete current
   `custom_fields` set, so every edit made through that UI does enforce
   completeness — which is the correct, intended behavior for a UI that
   shows and lets the user fix that value right there.
2. **`AssetUpdateIn`/`PUT /api/assets/{id}` is a full-replace PUT, not a
   merge-patch** — this predates AM-04 (AM-02's own schema docstring
   already said so) but is worth restating because it is a real, easy-to-miss
   gotcha: a field omitted from the request body is replaced with its schema
   default (usually `null`), not left untouched. Discovered concretely
   during AM-04's own backend test-writing (a test that PUT only
   `description`+`brand` silently wiped `purchase_cost`/`tax_percent` to
   null). **Any caller of this endpoint — UI or script — must prefill and
   resubmit the complete editable-field set**, never a partial diff. Asset
   360's Edit mode does this by construction (it always prefills every
   editable field from the current `GET` response before allowing Save).
3. **Field-change audit is a new, separate, append-only table
   (`asset_field_change`), never folded into `asset_event`.** A lifecycle
   move ("asset moved to Store X") and a descriptive-data edit ("PO Number
   changed from A to B") are different kinds of facts; conflating them would
   make the lifecycle ledger noisier and the field audit harder to reason
   about. One row per genuinely-changed field per edit (not one row per edit
   with a diff blob), written in the same transaction as the edit itself
   (both commit together or neither does), enforced append-only at the
   database level via the same trigger pattern `asset_event` already uses.
   For `vendor_id` specifically, the audit snapshots the vendor's name
   alongside its ID (`"Acme Traders (#7)"`) so a later vendor rename doesn't
   make old history unreadable — the same reasoning AM-01 already applied to
   `asset_event`'s holder names.
4. **Asset 360's Edit mode can only ever touch the AM-02-approved editable
   descriptive/procurement subset.** Identity fields (`asset_code`/
   `company_id`/`cost_center_id`), lifecycle fields (`status`/
   `current_holder_id`/`status_since`), and `category_id`/`subcategory_id`/
   `purchase_date` are not rendered as form controls anywhere in Edit mode —
   not merely disabled — reconfirming the Asset Field Policy Matrix from
   AM-02, not reopening it.
5. **`category_id`/`subcategory_id`/`purchase_date` remain non-editable
   after creation, reconfirmed.** They're displayed in Asset 360 but never
   get an edit control. Same reasoning as AM-02: category/subcategory can
   influence Asset Code semantics, and `purchase_date` feeds numbering
   tokens and the event-ordering invariant. A future stage may define a
   controlled correction workflow; AM-04 does not solve it silently.
6. **Add Asset's section structure**: Organization (Company/Cost Centre) →
   Asset Classification (Category/Sub-Category/Description) → Purchase/
   Procurement (Vendor/PO/Invoice/**PI Number**/Purchase Date) → Asset
   Details (Brand/Model/Serial/Warranty/Legacy Code) → Commercial (Cost/Tax,
   with a preview computed using the same rounding as the backend) →
   Initial Custody (Goes Into/Quantity) → Custom Fields (dynamic, active
   definitions only, `sort_order` respected). Restrained grouping via
   section headings + spacing, not a card per section.
7. **Asset 360's information architecture**: `PageHeader` (Code/
   Description/Status/current Holder+type+location) + lifecycle action
   buttons (unchanged, still `actionRules.ts`-driven) up top, then tabs:
   Overview, Procurement, Custody, Custom Fields, History (lifecycle
   Timeline, unchanged), **Changes** (new — the field-change audit, kept
   visually and structurally separate from History), Documents (unchanged).
8. **A custom field's retained value survives its definition being
   deactivated, and is never silently hidden.** Asset 360's Custom Fields
   tab shows every key in `Asset.custom_fields`; if no active `CustomField`
   definition matches it anymore, it's shown labeled `"<key> (retired
   field)"` rather than dropped, since inactive definitions aren't currently
   exposed by any API this stage was authorized to change.
9. **`AssetDetailOut` (single-asset GET/PUT response only) adds
   human-readable labels** (vendor/category/subcategory/cost-centre/holder/
   location/department names) via a handful of point lookups by primary
   key — additive, never affecting `AssetOut`/the list endpoint, so the
   register doesn't pay for joins it doesn't display.
10. **No backend change beyond what AM-04 explicitly authorized** — one new
    table + its migration (`a409768dc2cf`), the required-UDF check, the
    audit-writing code, and the `AssetDetailOut` label enrichment. No change
    to `asset_event`, the lifecycle state machine, numbering, the Holder
    model, or `holder_company_access`.
11. **The app shell's `SidebarInset` (`components/ui/sidebar.tsx`) now has
    `min-w-0`.** Found via AM-04's mandatory 768px browser check: a flex
    child's default min-width is its content's intrinsic width, so once a
    page's content (Asset 360's PageHeader actions row: status badge + QR
    image + 2 buttons) was wide enough, the whole page silently overflowed
    its viewport at exactly 768px (where the sidebar is docked, not yet a
    drawer, per the existing `md` breakpoint behavior) instead of wrapping.
    Fixed at the shared shell level since this is a general flexbox
    footgun, not something specific to Asset 360 — re-verified Dashboard,
    Asset Register, and Add Asset at the same width show no regression.
    **Don't remove `min-w-0` from `SidebarInset` without re-testing every
    screen at 768px.**

Full evidence: `docs/ai/AM-04_ASSET_ENTRY_360_REPORT.md`.

## 2026-09-24 — AM-03 scope locked (UI foundation + Dashboard + Asset Register)

1. **Shared UI components own presentation/interaction, never business
   logic.** `DataTable` doesn't fetch data, sort, or filter — the page does,
   exactly as Asset Register already did before AM-03. `PageHeader` doesn't
   know about roles or lifecycle. This boundary is deliberate and should
   hold for every future screen migrated onto these primitives.
2. **`DataTable`'s row-click and its selection/action columns are not made
   keyboard-operable via `role="button"`/`tabIndex`/`onKeyDown` on the
   `<tr>`.** A real, independently focusable `<Link>`/`<a>` in one column
   provides keyboard access; the row's own `onClick` is a mouse-only
   convenience. Nesting a synthetic interactive role on `<tr>` around a real
   `<a>` would be invalid ARIA (a widget shouldn't contain another widget),
   so this was a deliberate simplification, not an oversight.
3. **Asset Register's row click now uses the SPA router
   (`useNavigate`/`Link`) instead of `window.location.href`.** This is a
   genuine (if invisible) behavior change, explicitly authorized for AM-03:
   confirmed via network log that a row click no longer re-requests
   `index.html`/the JS bundle, and that the selection checkbox still does
   not trigger navigation.
4. **`StatusBadge`'s tone mapping is presentation-only** and never reads
   from or writes to `Asset.status` — IN_STOCK=info, ALLOTTED/INSTALLED=
   success, UNDER_REPAIR=warning, DISPOSED/SOLD/SCRAPPED=neutral, LOST=
   destructive. The status name is always shown as text, never conveyed by
   color alone. An unrecognized status still renders (neutral tone), it's
   never hidden or thrown on.
5. **`FormField` and part of `AsyncButton` are foundation-only in AM-03** —
   built for the data-entry stage that follows, not wired into any existing
   form. Only Asset Register's bulk-move Confirm button actually uses
   `AsyncButton` in this stage.
6. **No backend, schema, migration, or authorization change in AM-03** — a
   hard constraint, not just a preference; the entire stage is frontend
   presentation only. Backend test count stayed at 184/184 throughout.
7. **Only Dashboard and Asset Register are migrated onto the new
   components in AM-03.** Every other screen (Asset Detail, Add Asset,
   Holders, Import, Reports, My Assets, the 8 master screens) is unchanged
   and still needs its own migration in a future stage — not a silent
   scope expansion, an explicit boundary (AM-03 §9-§11/§19).

Full evidence: `docs/ai/AM-03_UI_FOUNDATION_REPORT.md`.

## 2026-09-24 — AM-02 scope locked (asset data model + procurement + custom fields)

1. **PI Number is CityKart's internal/reference number for a payment made to
   a vendor** — explicitly not Proforma Invoice, no evidence anywhere in the
   codebase or legacy data suggested that reading. Locked; do not
   reinterpret without new evidence.
2. **Procurement fields were already complete in the data model** — the real
   AM-02 gap was that `AssetOut` didn't return them, and no edit endpoint
   existed. Both fixed. No new procurement columns were needed or added.
3. **Custom Fields (UDF) reuse the existing `CustomField` table and
   `Asset.custom_fields` JSON column** — no new normalized value table. The
   JSON approach already satisfies duplicate-prevention (by construction)
   and safe history (definitions are soft-delete only). Supported types:
   `text`, `number`, `date`, `dropdown`, `checkbox`. `is_required` exists on
   the definition but is **not** enforced yet — deliberately deferred, since
   nothing writes custom field values through any UI yet.
4. **`holder.holder_type`, `holder.role`, `custom_field.field_type` are now
   closed-value at both the API (422) and database (CHECK constraint)
   levels.** `asset.status`/`asset_event.event_type`/`asset_event.status_after`
   deliberately do **not** get a CHECK constraint — they're the surface most
   likely to gain a new legal value if a future stage adds an approval
   workflow.
5. **`category_id`, `subcategory_id`, `purchase_date` are not yet editable**
   after asset creation — they feed code-generation tokens and lifecycle
   date invariants; exposing them safely is a future decision, not made now.
6. **No UI redesign in AM-02** — the frontend was not touched. The Add Asset
   form, Asset Detail, and Register all still render only the original field
   subset; wiring the newly-exposed fields into any screen is future work.
7. **`holder_company_access` stays untouched** — reconfirmed, no behavior
   change, same as AM-01.

Full evidence: `docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md`.

## 2026-09-24 — V1 scope locked (AM-01 authorization)

These decisions came directly from the user's review of the Product & Domain
Architecture Assessment and are now locked for V1. Do not re-open them in a
future session without an explicit new instruction — the assessment's own
"business confirmation required" list has been answered by this entry.

1. **No approval workflow in V1.** ADMIN/IT_TEAM may execute permitted
   lifecycle transitions directly; every transaction stays fully auditable
   via the existing append-only ledger. The architecture must not be built
   in a way that blocks adding optional approval later, but no approval
   engine work happens now. The lifecycle state machine itself is not
   altered to make room for this.
2. **Single current-holder/custody concept.** No split between "accountable
   custodian" and "physical user" in V1 — the existing `Holder`/
   `current_holder_id` model stays as one concept, provided its holder types
   (`EMPLOYEE`/`STORE`/`INSTALLED`/`IT_STOCK`) genuinely represent CityKart's
   real custody scenarios (confirmed true — see `AM-01_DATA_INTEGRITY_REPORT.md` §3.1/§8).
3. **AMC/Insurance are future capabilities, not V1.** Keep the existing basic
   warranty fields (`warranty_upto`) as-is; no contract-management module now.
4. **Depreciation/accounting are out of scope.** CKAM is an operational
   asset-management system, not a statutory fixed-asset accounting engine.
   ThreadERP's multi-book depreciation architecture is explicitly not to be
   copied.
5. **Physical verification is a future capability.** Not built now, but the
   QR/barcode architecture must remain suitable for it later (no design
   decision should foreclose this).
6. **Lost/Damaged tracking stays lifecycle-only in V1**: state, reason,
   remarks, and audit/history. No employee cost-recovery, insurance
   accounting, or write-off accounting workflows yet.
7. **Custom Fields are REQUIRED — do not remove the master.** The real
   problem is that it exists with zero consumers (confirmed in the AM-00
   assessment). Wiring it into Add Asset / Asset Detail / import-export is a
   future stage's work, not done in AM-01.
8. **Procurement traceability is a core requirement**, including: Company,
   Cost Centre, Vendor, PO Number, Invoice Number, Invoice Date, **PI
   Number** (the internal reference for a payment made to a vendor — must
   never be dropped from the data model or Asset 360), Purchase Date,
   Purchase Cost, Serial Number, Brand, Model, Description, Category,
   Subcategory, Warranty Upto, Asset Code. Not all fields need to be
   mandatory; exact requiredness is defined later.
9. **Auto-generated Asset Code stays mandatory.** The existing race-safe
   numbering architecture (`code_counter`'s atomic UPSERT) is preserved
   as-is unless a concrete defect is found — none was.
10. **CKAM supports at least two CityKart companies.** An asset's Cost Centre
    must belong to its own company — **confirmed already enforced** at both
    asset creation (`procure_assets`) and bulk import (`commit_import`), and
    structurally locked post-creation by the `trg_asset_no_identity_change`
    DB trigger. Now test-covered on both paths (AM-01).
11. **No login company selector** — already implemented (see the 2026-09-24
    login-identity-resolution entry below); reconfirmed as the correct,
    locked behavior, not reopened.
12. **Core V1 lifecycle stays the existing simple one:** Procured/Registered
    → IT Stock/Available → Assigned to User/Location → Returned to IT Stock
    → Reassigned, plus the existing controlled cases (Repair, Lost/Found,
    Disposed/Sold/Scrapped). Full chronological history must never be lost
    — reinforced by AM-01's historical-snapshot fix, which stops a holder
    rename from retroactively changing how that history displays.

## 2026-09-24 — Login has no company selector; identity resolution is fail-closed

**Decision:** The login screen asks only for User ID (Emp Code or email) and
Password. No Company dropdown.

**Why:** Requiring a company selector on every login was pure friction for a
single-company deployment, and added a step users had no way to get wrong
(there's exactly one real answer). The company-selector-based design was a
holdover from initial multi-tenant caution, not a real requirement.

**How it's actually resolved (this matters — it's not a naive fix):**
`emp_code` and `email` are only unique **per company**
(`UniqueConstraint(company_id, emp_code)` and the partial unique index from
migration `0005_holder_email_unique.py`), so `login_id` alone does not
uniquely identify a holder in the general case — it's possible, though
unlikely, for the same id to exist in two different companies.

The backend (`app/auth/router.py::login`) queries across every **active**
company for a holder matching `login_id`, and:
- exactly one match → proceed normally
- zero matches → 401 "Invalid credentials"
- **more than one match → 401 "Invalid credentials" (the same message as
  zero matches — no information leak) plus a server-side warning log**, so
  an admin can rename one of the colliding accounts. It never guesses, and
  it never silently picks the first row.

This is deliberately conservative: an account-takeover risk (silently
picking the wrong company's same-named account) is worse than a rare,
loud-in-the-logs "please disambiguate this" failure.

Company authorization/scoping after login is unaffected — the JWT still
carries the resolved `company_id`, and every downstream endpoint scopes by
it exactly as before.

**No migration was needed or applied** beyond the pre-existing
`0005_holder_email_unique.py` (already in place from an earlier stage) —
this stage only changed the login query, not the schema.

## 2026-09-24 — CKAM has its own visual identity

**Decision:** Deep navy primary + the existing brand teal as a secondary
accent, light canvas, no dark chrome (see `DESIGN_SYSTEM.md`). Other CityKart
applications (e.g. Citykart Desk) are used only as structural/UX references
— their exact colors, branding, and components are never copied.

**Why:** The user explicitly asked for CKAM's own identity, distinct from
sibling apps, after finding an earlier teal-only palette visually weak.

## 2026-09-24 — Sidebar shell replaces the flat top nav

**Decision:** Left sidebar (collapsible, grouped, icon-labeled) + light top
header, replacing the original single-row top nav + Setup dropdown.

**Why:** The flat nav didn't scale to CKAM's real number of screens (19),
and the Setup dropdown buried 10 of them behind a menu. Explicitly requested
by the user after seeing a reference app's sidebar pattern.

**Constraint that shaped this:** the header must stay **light**, not dark —
the logo is a transparent PNG with dark content and no light backing plate,
so a dark header makes it unreadable. This was discovered and fixed live
(see commit `feat(shell): replace the top nav with a collapsible CKAM
sidebar` and the follow-up header-color fix folded into it).

## Existing lifecycle/custody logic is preserved

**Decision:** The append-only event ledger, the lifecycle state machine, and
all existing scoping/authorization rules from the original 26-task SDD build
remain the source of truth. UI work does not get to quietly change them.

**Why:** Stated explicitly as a hard constraint for this stage of work; also
consistent with the original build's own design principles.
