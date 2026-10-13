# CKAM Simplification — Stage S0 report (security and data-integrity fixes, backend only)

| | |
|---|---|
| Starting HEAD | `6607757` (docs(audit): product simplification audit …) |
| Scope | Plan §3 S0.1–S0.10 + the same-family extras in the brief; audit Appendix B-1 … B-15 |
| Frontend | not touched (another agent owns `frontend/`) |
| Database | **no schema change, no Alembic migration, no data rewritten** |
| Commit | none (the controller commits) |
| Tests | backend **689 → 748 passed**, 0 failed (`docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q`) |

## 1. What changed, by item

| # | Defect (audit) | Fix | Status |
|---|---|---|---|
| S0.1 | B-1 an ordinary ADMIN could reset the password of / edit / deactivate / change company access of a Primary Owner | `PUT`, `DELETE`, `POST …/reset-password`, `POST …/company-access` on a Primary-Owner target now need a Primary-Owner caller: 403 "Only a head-office admin can change a head-office admin account." Grant/revoke stay Primary-Owner-only; last-owner protection kept; a Primary Owner may change their own record and another owner's | done |
| S0.2 | B-2 unbounded quantity (15 GB), quantity ≤ 0 → 201 with no lines, unbounded bulk id lists | quantity 1–1000 on PO lines (schema + service guard for every internal caller: bundles, ERP create, ERP "add units", Excel PO import), bundle lines (already ≤1000, now also checked in the service), ERP draft lines, Excel asset/PO import rows; `asset_ids` on `/assets/bulk-move` and `/assets/bulk-action` ≤ 1000 (duplicates de-duplicated); delivery `lines` 1–1000; company-access ids ≤ 1000; bundle parts ≤ 50; ERP draft lines ≤ 500 | done |
| S0.3 | B-3/B-4 IT / Non-IT work area not enforced on POs, delivery, Add Asset, ERP create, PI, exports | see §4 for the exact rule. `allowed_asset_domains` now limits an ordinary ADMIN set to IT or NON_IT; enforced on PO list/get/lines, line add/edit/cancel, bundle lines, deliver, delete PO, record-PI, ERP PI apply and ERP PO views (`_scoped_erp_po`), Add Asset, ERP create, check-serials (code masked), movement-log and field-change exports (also skip soft-deleted assets); cross-area corrections need a both-area admin | done |
| S0.4 | B-5 destination applied on events that have none; CORRECTION moved custody and `status_since` | `apply_event` (still the only writer) **refuses** (422) a destination on SENT_FOR_REPAIR, LOST, DISPOSED, SOLD, SCRAPPED, CORRECTION; CORRECTION never changes holder or `status_since`; `status_since` moves only when status **or holder** really changes; MOVED / RECEIVED_FROM_REPAIR / FOUND (and PROCURED/IMPORTED) without a destination → "Choose where the asset is going."; an inactive destination is refused | done |
| S0.5 | B-6 blank/negative/absurd values | blank serial (create, delivery), blank invoice no, invoice amount < 0, blank description (asset, PO line, bundle, ERP line), blank PO number, duplicate PO number per company (trimmed, case-insensitive, active POs), negative cost/invoice amount, tax outside 0–100, warranty outside 0–100, amounts > 9,999,999,999, invoice date before PO date (delivery; also Add Asset when both dates are given), PO/invoice dates in the future, correction purchase date before 01-01-1990, column-size max lengths on asset, PO, PO line, delivery, PI, asset-user, master, code-rule, lifecycle, bundle and ERP-draft bodies, NUL characters refused (`InModel` base) and answered by the handlers anywhere else (e.g. search `q`); `PUT /assets/{id}` can no longer clear a serial | done |
| S0.6 | B-7 deactivated records accepted for new work; delivery onto a deleted PO | new choices of an inactive cost centre, category, sub-category, Item, vendor, brand, company, asset user (received-into, destination, PO delivery location) are refused in plain words; a deleted PO takes no new line, line edit/cancel, delivery or PI (422 "This purchase order has been deleted, so nothing new can be recorded on it."); new master rows refuse an inactive parent (company / category); editing a record that keeps its existing inactive choice is still allowed; reads of history are unchanged | done |
| S0.7 | B-8, B-11, B-12, B-13 bare 500s and technical messages | app-level handlers (`app/core/errors.py`) for `RequestValidationError`, `LifecycleError`, `IntegrityError` (FK → 422 naming the field, unique → 409), `DataError`, any `StatementError` (DB down → 503); deliver route catches `LifecycleError`; every Excel import (4 asset/PO/movement endpoints, 8 master imports, asset-user import) answers 422 "That file is not a valid Excel file." for empty/garbage files; B-13 messages rewritten (see §2) | done |
| S0.8 | B-9 ERP create trusted the client | `create_from_draft` re-reads the ERP PO through the same `ErpSource` the screens use (CKAM's ERP copy, `LocalErpSource`): ERP PO must exist and belong to the chosen company; PO number **and date** taken from the ERP (client values ignored); vendor = the vendor linked to the ERP supplier in that company (a different `vendor_id` is refused, an unlinked supplier is refused); every line's item code must be on that ERP PO; units per item code ≤ the ERP's open units (ordered − cancelled); cost must be between half and double the ERP rate; Item, description, barcode, brand, model, tax, warranty and fewer units stay editable; IntegrityError no longer says "already created" for a bad vendor id | done |
| S0.9 | B-10 unvalidated code rule, any ADMIN could replace it | **owner decision applied: POST/PUT `/api/code-rules` are Primary-Owner only** (403 for an ordinary ADMIN; reads stay open). Rule validated on save: only supported tokens `{company.code} {location.code} {cost_center.code} {category.code} {subcategory.code} {yyyy} {yy} {mm}`, no stray braces, no tokens in the ending, non-blank beginning, start 0–999,999,999, digits 0–20, lengths 300/100, company must exist. Additive `example` field on every rule in responses; new `POST /api/code-rules/preview` (any logged-in user, saves nothing) | done |
| S0.10 | B-14, B-15 formats, case-sensitive codes, LIKE wildcards | email format (asset user, vendor contact) and GSTIN 15-character pattern (stored upper case) checked when new or changed; master codes (and department names) unique ignoring case and surrounding spaces **for new records** within their scope (company / category / global); asset-user codes the same per company (on create and on a changed code); codes trimmed on save; `%`, `_`, `\` in the register / asset-export search match themselves; search `q` ≤ 200 characters | done |
| extra | B-2 quantity 0 → 201 with no lines | covered by S0.2 | done |
| extra | B-7 deactivating a holder ignores what they hold | refused while they hold assets (disposed, sold, scrapped and lost assets do not count): "Ravi Kumar still holds 3 assets. Move them to someone else or back to a stock room first, then deactivate." | done |
| extra | B-15 0-byte documents, 100,000-character passwords, empty delivery | empty upload → 422 "The file is empty."; passwords ≤ 128 characters on login and change-password; delivery needs ≥ 1 line; the same unit twice in one delivery is refused | done |

Asset-code uniqueness races were left as they are (as instructed).

## 2. API changes (every changed contract)

Response shapes are unchanged except the additive fields named here. New validation can reject input that used to be accepted.

**Error format (all endpoints)**
* Request-validation 422: `detail` is now **one string** (one plain sentence per problem, joined by a space) instead of FastAPI's array of objects, plus an additive `errors: [string]` with the same sentences. Examples: "PO number is required.", "Description is too long (max 500 characters).", "Line 3: Quantity must be at least 1.", "You can choose at most 1,000 assets at a time."
* New handler answers: 409 "A record with this code already exists." (unique), 422 "The vendor you chose does not exist." (foreign key), 422 "One of the texts is too long (max 200 characters)." / "One of the numbers is too large." / "Text cannot contain hidden control characters. …", 503 "The database could not be reached. Try again in a moment."
* `require_primary_owner` message: "Only the head-office admin can do this." (was "Only the Primary Owner may perform this action").

**Asset users** — 403 "Only a head-office admin can change a head-office admin account." on PUT/DELETE/reset-password/company-access of a Primary Owner by a non-owner; 422 on deactivation while holding assets; 422 for a bad email, a case-insensitive duplicate code ("A person or place with the code X already exists in this company."), a blank code/name, an unknown/inactive company in company-access; new plain messages for type/role/work-area/company/location/department problems; last-owner messages now "The last remaining head-office admin cannot be deactivated/removed."

**Purchase orders** — list/get/lines filtered by work area (§4); line add/edit/cancel, bundle lines, deliver, delete answer 403 for another work area; deliver 422 for: blank invoice number, negative amount, future invoice date, invoice before PO date, empty `lines`, duplicate units, blank serial, inactive received-into; create 422 for blank/duplicate PO number, future PO date, inactive or missing cost centre/vendor/delivery location/company; line 422 for quantity outside 1–1000, negative cost, tax outside 0–100, warranty outside 0–100, blank description, inactive/missing category/sub-category/brand/Item; any write on a deleted PO → 422; `check-serials` masks the asset code of a conflicting asset outside the caller's companies/work area ("an asset outside your companies or work area"); record-PI touches only the caller's work-area assets of that invoice; delete of a delivered PO by a non-owner: "Only the head-office admin can delete a purchase order that already has delivered items."

**Assets** — `POST /assets` 403 for the other work area; 422 for the S0.5 values and inactive masters (§1); `PUT /assets/{id}`: a body **without** `serial_number` now keeps the serial (it used to clear it); an explicit blank/null serial on an asset that has one → 422 "The serial number cannot be removed. Type N/A if the asset has none."; amount/tax/warranty/date/vendor/brand checks apply only to values the edit changes; `POST /assets/{id}/corrections` 403 when it moves the asset between IT and Non-IT (domain or a Category of the other area) unless the caller is the head-office admin or an admin not limited to one area; correction purchase date before 01-01-1990 → 422; bulk-move/bulk-action ≤ 1000 ids; search `q` escapes wildcards, ≤ 200 characters.

**Lifecycle** (`POST /assets/{id}/events`, bulk) — destination on a no-destination event → 422 "This action does not send the asset anywhere, so do not choose a destination."; missing destination → "Choose where the asset is going."; inactive destination → "X is no longer active, so assets cannot be sent there."; illegal moves read "This asset is reported lost, so it cannot be moved." / "This asset has been disposed of, so nothing more can be recorded for it."; a same-day date earlier than the last event (midnight today) is recorded at the last event's time instead of being refused; an earlier day → "The date cannot be before the asset's last recorded movement (dd-mm-yyyy)."

**Code rules** — POST/PUT Primary Owner only; 422 on invalid rules; additive `example` on GET/POST/PUT; new `POST /api/code-rules/preview` → `{"example": "FA/CKSPL/IT/0001"}`.

**ERP** — `POST /api/erp/pos/create`: `erp_po_code` is now required in practice ("Choose the ERP purchase order this is created from."); `po_number`/`po_date` are still accepted but replaced by the ERP's; new 422s for unknown ERP PO, wrong company, unlinked or different vendor, codes not on the PO, too many units, rate outside ½–2× the ERP rate; 403 for an Item of the other work area; 503 when the ERP copy cannot be read. ERP PI apply and ERP PO change/PI views follow the PO work-area visibility.

**Masters** — 422 for blank code/name, too-long fields, bad GSTIN/contact email (new or changed values only), case-insensitive duplicate code (new records), inactive parent; category domain message "Choose who handles this category: IT or Non-IT."

**Imports** — every Excel endpoint: "That file is not a valid Excel file." for empty/garbage files; Quantity and Warranty Years ≤ 1000 / ≤ 100 per row.

**Documents / auth** — empty upload 422; passwords > 128 characters 422.

**Messages replaced (B-13)** — "unknown asset user type 'None'", "event 'X' is not allowed from status 'Y'", "X is a terminal state", "only ADMIN may …", "target asset user not found", "item 62 not found" (now "The Item X is no longer active; choose another." or "The Item you chose does not exist."), "category 12 not found", "cost center 5 not found", "initial asset user 7 not found", "pending asset 218 is not PENDING (already DELIVERED)", "token 'subcategory.code' resolved to an empty value" (now "The asset code format needs the sub-category code, but this asset has none …"), "unknown token '{x}' in code rule template", "no active code rule configured … (Setup > Code Rule)", "asset_domain must be one of ('IT','NON_IT')", "asset_user_type/role/… must be one of (…)", "primary_asset_domain/allowed_asset_domains require login_enabled", "this asset user is not login-enabled", "a code already exists for this company", "this purchase order was already created here" for a bad vendor id.

## 3. DB changes

None. No migration, no `create_all`, no data conversion, no historic row rewritten. Append-only ledgers (`asset_event`, `asset_field_change`) untouched in shape; `apply_event` remains the only writer of `status` / `current_asset_user_id` / `status_since`.

## 4. Security changes and decisions taken where the brief was open

1. **ADMIN work-area semantics.** `allowed_asset_domains()` returns `None` (unrestricted) for the Primary Owner, for SELF_SERVICE (custody-scoped) and for an ADMIN whose `allowed_asset_domains` is NULL or "BOTH" — so every existing ADMIN keeps working unchanged. An ADMIN explicitly set to "IT" or "NON_IT" is now limited exactly like an OPERATOR/VIEWER, in every place that already used this function (register, Asset 360, dashboard, exports) and every S0.3 place. Company scope for ADMIN is unchanged (decision D6 still open).
2. **Work area of a PO line** = `pending_asset.asset_domain` (the Category's at line creation), else the line's Category's current one (lines always have a Category; the Category comes from the Item).
3. **Mixed-area POs (exact rule).** A user limited to one area: sees a PO when it has at least one line (any status) in their area **or has no lines yet** (a fresh header must stay reachable so lines can be added); sees only their own area's lines; may add, edit, cancel and deliver only lines of their own area (changing a line's Category to the other area is refused); records PI only on their own area's assets of an invoice (the other area's assets are left for someone who handles them; nothing is refused if at least one of theirs matches); may delete a PO only when every line is in their area (deleting cancels all lines). A mixed PO is therefore worked by both teams, each on its own lines. A both-area user / head-office admin sees and does everything.
4. **check-serials** still reports a conflict anywhere (serials are unique everywhere, and the delivery would fail anyway) but hides the asset code outside the caller's companies/work area.
5. **Cross-area corrections** (changing `asset_domain`, or giving an asset a Category whose area differs from the asset's) need the head-office admin or an ADMIN not limited to one area; an OPERATOR keeps same-area Category corrections.
6. **Destinations on no-destination events are refused** (not silently ignored), so a caller learns the destination had no effect. The frontend already sends `null` for those actions.
7. **`status_since`** moves when the status **or the holder** changes (a transfer from one person to another is a real custody change and keeps "since" meaningful); never on a correction note; not on an event that changes neither.
8. **"Cancelled PO"**: CKAM has no separate cancelled state; "deleted" (`is_active=false`) is what blocks new lines/delivery/PI. A PO the ERP cancelled and the user *applied* has its pending units cancelled already; when the user chose *Keep*, it stays usable (its `erp_status` alone does not block).
9. **Inactive masters during PO delivery**: delivery is the receipt of lines that were valid when ordered, so a cost centre/category/vendor deactivated *after* ordering does not block delivery; the received-into holder (a new choice) must be active. Add Asset refuses every inactive master.
10. **Edits never reject stored data**: on `PUT /assets/{id}`, vendor/GSTIN/email edits, amount/tax/warranty/date/vendor/brand/description/GSTIN/email checks run only for values the request changes; a record that keeps an existing inactive choice is not refused.
11. **ERP rate tolerance**: half to double the ERP rate per item code (the defect was 0.0001 against 20,000). Quantity: total per item code ≤ ERP ordered − cancelled (received is not subtracted; delivery tracks that).
12. **Code rules**: Primary-Owner-only, per the owner's approved brief (controller correction).
13. Invoice-before-PO-date is also refused on Add Asset when both dates are given (same bad-data rule as delivery).

## 5. Tests

| | count |
|---|---|
| Backend before (HEAD 6607757) | 689 passed |
| Backend after | **748 passed, 0 failed** |
| New regression tests | 59 in 9 files + shared world `tests/core/s0_world.py` |

New files: `tests/asset_users/test_s0_account_protection.py` (8), `tests/purchase_orders/test_s0_po_integrity.py` (9), `tests/core/test_s0_work_area.py` (8), `tests/lifecycle/test_s0_destination_integrity.py` (6), `tests/assets/test_s0_asset_validation.py` (6), `tests/core/test_s0_friendly_errors.py` (8), `tests/erp/test_s0_erp_create_revalidation.py` (6), `tests/numbering/test_s0_code_rule_validation.py` (3), `tests/masters/test_s0_master_formats.py` (5).

Red-before-green evidence: the new tests were also run against an image built from HEAD `6607757` (tests copied in, run against `ckam_test`): **46 failed, 4 passed** (the 4 are deliberate controls — an owner changing an owner, the last-owner guard, an ordinary admin managing ordinary accounts, a correction note on a disposed asset). Not runnable on HEAD: the 8 friendly-error tests (they import the new `app.core.errors`) and the quantity test (on HEAD it would try to allocate 10^12 rows — the B-2 defect itself).

Existing tests changed (intended behaviour/wording changes only): code-rule fixtures now use a Primary Owner (`numbering/test_router.py`, `test_single_active_rule.py`); ERP-create tests now name a real ERP PO whose lines match (`erp/test_erp_api.py`, `erp/test_erp_followup.py`, `items/test_two_companies.py`); a second PO in one test gets its own number (`assets/test_serial_pending.py`); message substrings updated in `test_am07_asset_correction.py`, `test_am20_bulk_action.py`, `test_create_asset_tokens_and_scope.py`, `core/test_closed_value_integrity.py`, `imports/test_import_tokens_and_scope.py`, `numbering/test_get_active_rule_ordering.py`, `numbering/test_service.py`, `purchase_orders/test_delivery.py`.

## 6. Files changed

New: `backend/app/core/validation.py` (limits, `InModel`, text/email/GSTIN/date helpers, LIKE escape), `backend/app/core/errors.py` (handlers, sentence builder), `backend/app/core/excel.py` (safe workbook open).
Changed: `app/main.py`; `app/core/deps.py`; `app/lifecycle/{state_machine,service,schemas}.py`; `app/asset_users/{router,schemas,service}.py`; `app/purchase_orders/{router,schemas,service}.py`; `app/assets/{router,schemas,service,correction_service,search_service}.py`; `app/bundles/{schemas,service}.py`; `app/erp/{service,router,schemas,invoices}.py`; `app/numbering/{router,schemas,service}.py`; `app/masters/{router,schemas,bulk_import_export}.py`; `app/imports/{asset_import_service,po_import_service,movement_import_service}.py`; `app/items/{lookup,service,schemas}.py`; `app/reports/router.py`; `app/documents/router.py`; `app/auth/schemas.py`; tests listed in §5.

## 7. Frontend contract follow-ups for the controller

1. **Validation errors now readable**: `detail` is a string for 422 validation errors (was an array the api-client could not show → "Request failed: 422"). No change needed; optionally show `errors[]` as a list.
2. **Code Rule screen**: save is head-office-admin only — hide/disable Save for an ordinary ADMIN; show the new `example` (and call `POST /api/code-rules/preview` while typing).
3. **Asset Users screen**: hide Edit / Deactivate / Reset password / Company access on a head-office-admin row for an ordinary ADMIN (server answers 403); show the "still holds N assets" message on deactivate.
4. **ERP PO review (PoDraftCard)**: the PO number (and date) are now taken from the ERP — make them read-only; the vendor is the linked one; quantity cannot exceed the ERP's open quantity; rate must stay within ½–2× the ERP rate.
5. **PO detail for one-area users**: lines of the other area are not returned; a mixed PO shows only the user's lines (counts/totals computed client-side will reflect that).
6. **Delivery dialog**: the check-serials conflict may now read "an asset outside your companies or work area" instead of a code.
7. **Asset 360 Edit**: sending `serial_number: null` for an asset that has a serial is refused — send the current value or N/A (leaving the field out keeps it).
8. **Work-area field**: an ADMIN can now be limited by `allowed_asset_domains` ("IT"/"NON_IT"); the Add/Edit user form should expose it for ADMIN too (still requires login enabled).

## 8. Open observations (not fixed in S0)

* ERP `GET /erp/reminders` and `GET /erp/changes/summary`, and `POST /erp/purchase-orders/{id}/changes/apply` on a mixed PO, are company-scoped but not filtered by work area beyond PO visibility; "apply" can cancel/add units of the other area on a mixed PO.
* The dashboard's PO block counts POs company-wide (not by work area).
* An ADMIN limited to one area can still edit asset users and give others "BOTH" (RBAC of account management was out of scope; D6 still open).
* `check_serial_number_unique`'s delivery/Add Asset error still names the conflicting asset code even outside the caller's scope (pre-existing; only the advisory endpoint was masked).
* ERP create does not refuse an ERP PO that is no longer OPEN (the picker only offers OPEN ones; the draft warns).
* A bundle part line's description is "<description> - <part>"; via ERP create a 500-character description plus a part name can exceed the column — now a 422 sentence from the DataError handler rather than a 500, but the draft UI could trim.
* Excel imports look masters up by exact code and do not refuse inactive masters (S0.6 applied to API paths; imports are head-office-only).
* `fastapi`/Starlette deprecation warning for `HTTP_422_UNPROCESSABLE_ENTITY` across the codebase (cosmetic).
