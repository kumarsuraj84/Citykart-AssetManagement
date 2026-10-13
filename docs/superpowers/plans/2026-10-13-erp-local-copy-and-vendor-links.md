# ERP local copy and per-company vendor links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CKAM keeps its own nightly copy of the ERP's fixed-asset POs, vendors and items for both companies (read from `gold_ckpost`), serves every PO screen and the PO change check from that copy, and links one CKAM vendor to one ERP supplier code per company.

**Architecture:** A `WarehouseReader` reads `gold_ckpost.*` (read-only, same pattern as `PgErpSource`). `run_sync` upserts into new local tables (`erp_po_line`, `erp_vendor`, `erp_item`, `erp_sync_run`), tracking first/last seen and a content hash, never deleting. `LocalErpSource` implements the existing `ErpSource` protocol from those tables (receipts and invoices stay live), so the draft builder, picker, reminders and change check work unchanged. A lifespan loop runs the sync when the warehouse reports a newer load. `vendor_erp_link(vendor_id, company_id, erp_vendor_code)` replaces `vendor.erp_vendor_code`; every vendor lookup becomes (company, code).

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, asyncpg, pytest; React 19, TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-ckam-two-company-architecture-design.md` (changes 1 and 2; owner decisions in section 7).

## Global Constraints

- The ERP is read-only: connections use `default_transaction_read_only=on`; CKAM never writes to it. No secret is printed or logged.
- Source is the **gold_ckpost** schema (`po_line`, `vendor`, `article`, `site`), which holds **both** companies in one table with a `company` text column (`CKSPL`, `CKVPL`). `gold_ckam.po_line` is no longer read for POs. Its `po_line_key` has a different format from `gold_ckpost`, so a PO already watched keeps working (change check matches by item code, not line key).
- Every ERP code is the pair (company, code). Vendor codes and site codes repeat across companies; item codes and `po_code` do not, but vendor logic must never use a bare code.
- Schema changes only through Alembic (head now `b2c4e6a8d0f1`); never `create_all` at runtime. No hard deletes of business records: the local copy marks `is_present=false`, it does not delete.
- `lifecycle/service.py::apply_event` untouched. Authorization is enforced in the backend (`require_primary_owner`, `require_role(*WRITE_ROLES)`).
- Test before commit: backend `docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest -q` (rebuild `api` first: `docker compose up -d --build api`; run `alembic upgrade head` against both `ckam` and `ckam_test`); frontend `npx tsc -b && npx vitest run` in `frontend/`. Commit locally with Conventional Commits and the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer. **Do not push, do not deploy.**
- Production has no data yet, so migrations may reshape freely, but each must still upgrade and downgrade on a database that has rows.
- Plain-language messages for users; names of ERP tables stay out of UI text.

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/erp/mirror_models.py` (new) | `ErpSyncRun`, `ErpPoLineCopy`, `ErpVendorCopy`, `ErpItemCopy` tables |
| `backend/app/erp/warehouse.py` (new) | `WarehouseReader` protocol, `PgWarehouseReader`, row dataclasses, `derive_po_status` |
| `backend/app/erp/sync.py` (new) | `run_sync`, `sync_status`, advisory lock, freshness check, background loop |
| `backend/app/erp/local_source.py` (new) | `LocalErpSource` (implements `ErpSource` from the copy) |
| `backend/app/erp/source.py` | `open_pos` gets `company_code`; item fallback reads `gold_ckpost.article`; `get_erp_source` returns the local source |
| `backend/app/erp/vendors.py`, `service.py`, `router.py`, `schemas.py` | company-aware vendor links, picker across companies, sync endpoints |
| `backend/app/erp/changes.py` | `VENDOR_CHANGED` becomes an applicable change |
| `backend/app/masters/{models,schemas,router}.py` | `VendorErpLink`; `VendorOut.erp_links`; `erp_vendor_code` removed |
| `backend/app/alembic/versions/c3e5a7b9d1f2_erp_local_copy.py`, `d4f6b8c0e2a3_vendor_erp_link.py` (new) | migrations |
| `backend/app/main.py`, `core/config.py` | start/stop the sync loop; `erp_sync_enabled` |
| `frontend/src/features/vendors/*`, `features/erp/*` | company selector, links, sync status |

---

### Task 1: Local copy tables and migration

**Files:**
- Create: `backend/app/erp/mirror_models.py`, `backend/app/alembic/versions/c3e5a7b9d1f2_erp_local_copy.py`
- Modify: `backend/app/alembic/env.py` or the models import list (wherever `app.purchase_orders.models` is imported for metadata; check with `grep -rn "purchase_orders.models" backend/app/alembic backend/tests/conftest.py backend/app/core`)
- Test: `backend/tests/erp/test_mirror_models.py`

**Interfaces:**
- Produces: `ErpSyncRun(id, started_at, finished_at, status['running'|'success'|'failed'], trigger['schedule'|'manual'|'startup'], source_stamp(datetime|None), message, po_lines_new, po_lines_changed, po_lines_gone, vendors, items)`; `ErpPoLineCopy` PK `(company_code, po_line_key)` with `po_code BigInteger, po_number, po_date, line_status, delivery_location, delivery_site_kind, supplier_code, supplier_name, icode, item_description, group_code, hsn, unit, ordqty, rate, tax_percent, line_netamt, rcqty, cnlqty, hdr_netamt, hdr_chgamt, erp_loaded_at, row_hash(String 64), first_seen_at, last_seen_at, is_present`; `ErpVendorCopy` PK `(company_code, vendor_code)` with `name, gstin, city, is_extinct, row_hash, first_seen_at, last_seen_at, is_present`; `ErpItemCopy` PK `icode` with `company_code, article_name, section, department, division, cat1..cat6, hsn, unit, row_hash, first_seen_at, last_seen_at, is_present`.
- Index: `ix_erp_po_line_po (po_code)`, `ix_erp_po_line_supplier (company_code, supplier_code)`.

- [ ] **Step 1: Write the failing test** (`test_mirror_models.py`): insert one `ErpPoLineCopy` and one `ErpVendorCopy` and `ErpItemCopy` with `SessionLocal`, commit, read back; assert a second `ErpPoLineCopy` with the same `(company_code, po_line_key)` raises `IntegrityError`, and the same `po_line_key` under the other company is accepted.
- [ ] **Step 2: Run it** (`pytest tests/erp/test_mirror_models.py -q`), expect ImportError.
- [ ] **Step 3: Implement** the models (Mapped columns as listed; `Numeric(14,3)` quantities, `Numeric(14,4)` rate, `Numeric(6,2)` tax, `Numeric(16,2)` amounts) and the migration (`down_revision='b2c4e6a8d0f1'`, create the four tables and indexes, drop in `downgrade`). Make sure the new module is imported where metadata is collected.
- [ ] **Step 4: Migrate both databases** (`alembic upgrade head` on `ckam` and `ckam_test` via `docker compose exec -T api`), run the test, expect pass.
- [ ] **Step 5: Commit** `feat(erp): tables for CKAM's own copy of the ERP data`.

### Task 2: Warehouse reader (gold_ckpost) and PO status rule

**Files:**
- Create: `backend/app/erp/warehouse.py`
- Test: `backend/tests/erp/test_warehouse_reader.py`

**Interfaces:**
- Produces dataclasses `WhPoLine`, `WhVendor`, `WhItem` (fields = the copy columns without bookkeeping; `po_line_key` is `str`; `supplier_code` is `str`), `class WarehouseReader(Protocol)` with `async def po_lines(self, since: date) -> list[WhPoLine]`, `async def vendors(self, codes: dict[str, set[str]]) -> list[WhVendor]` (company -> vendor codes), `async def items(self, icodes: set[str]) -> list[WhItem]`, `async def source_stamp(self) -> datetime | None`; `class PgWarehouseReader` (uses the same `_connect` pattern and `ErpUnavailable` messages as `PgErpSource`; `statement_timeout` 120 s); `def derive_po_status(line_statuses: list[str]) -> str` returning `CANCELLED` when every line is CANCELLED, `CLOSED` when every line is CLOSED or CANCELLED, else `OPEN`.
- Rules in `po_lines`: `from gold_ckpost.po_line where division = 'FIXED ASSETS' and not is_template and (po_date >= $1 or po_code in (select po_code from gold_ckpost.po_line where division='FIXED ASSETS' and line_status='OPEN'))`; `delivery_location` = `gold_ckpost.site.short_name` joined on `(company, site_code)` (falls back to `site_name`); `delivery_site_kind` = `site.site_kind`; `group_code` = `article_name`; `item_description` = `item_name` stripped; `po_line_key` as is (text).
- `source_stamp` reads `max(last_success_at)` from `meta.v_freshness where target = 'gold_ckpost.po_line'`.

- [ ] **Step 1: Failing tests**: `derive_po_status` table (all cancelled; closed+cancelled; closed+open; empty list -> OPEN); `PgWarehouseReader.po_lines` with `_fetch` replaced by a fake that returns two rows (one per company) asserts the SQL mentions `gold_ckpost.po_line`, `FIXED ASSETS`, and the returned `WhPoLine`s have `company_code`, text `po_line_key`, stripped description, delivery location from the site short name; `source_stamp` returns the fake's value; an `ErpUnavailable` from `_fetch` propagates unchanged.
- [ ] **Step 2: Run, expect fail. Step 3: Implement. Step 4: Run, expect pass.**
- [ ] **Step 5: Live check (read-only, once)**: pipe a scratch script through `docker compose exec -T api python -` that builds `PgWarehouseReader`, calls `po_lines(date.today() - timedelta(days=548))`, and prints counts per company and the first 2 rows' keys only (no secrets). Expect CKSPL in the thousands and CKVPL about 850 lines. Record the numbers in the commit body.
- [ ] **Step 6: Commit** `feat(erp): read both companies' purchasing data from the warehouse gold layer`.

### Task 3: The sync

**Files:**
- Create: `backend/app/erp/sync.py`
- Test: `backend/tests/erp/test_sync.py`

**Interfaces:**
- Consumes: `WarehouseReader`, the Task 1 models.
- Produces: `async def run_sync(session_factory, reader, trigger: str) -> ErpSyncRun`; `async def latest_run(session) -> ErpSyncRun | None`; `async def needs_sync(session, reader) -> bool` (true when no successful run, or the reader's `source_stamp` is newer than the last success's `source_stamp`); `HISTORY_DAYS = 548`.
- Behaviour: take `pg_try_advisory_xact_lock(7731001)` (another sync running -> return the existing run marked `skipped` without writing); create a `running` row; read lines; for each key upsert: new -> insert with hash, `first_seen_at=last_seen_at=now`; existing and hash equal -> only `last_seen_at`, `is_present=true`; hash differs -> update fields, new hash, `last_seen_at`. Rows of the same company whose `po_code` is not returned AND `po_date >= since` are set `is_present=false` (a PO that aged out of the window is left alone). Vendors and items: only those referenced by synced lines (vendors by `(company, supplier_code)`, items by `icode`). On any exception: roll back the data, record a `failed` run with the message (user-readable), re-raise nothing (the loop must survive). Hash = sha256 over the ordered business fields as strings.

- [ ] **Step 1: Failing tests** with a `FakeReader`: (a) first run inserts all rows for two companies, counts match, `first_seen_at == last_seen_at`; (b) second identical run changes nothing (`po_lines_changed == 0`) but advances `last_seen_at`; (c) a changed `ordqty` updates the row and counts one change; (d) a PO missing from the next result and inside the window gets `is_present=false`, while one older than the window stays untouched; (e) a reader exception yields a `failed` run, leaves earlier data intact; (f) `needs_sync` is true before any run, false right after a success with the same stamp, true when the stamp moves.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Commit** `feat(erp): nightly copy of the ERP data into CKAM (run_sync)`.

### Task 4: `LocalErpSource`, and the protocol change for companies

**Files:**
- Create: `backend/app/erp/local_source.py`
- Modify: `backend/app/erp/source.py` (protocol `open_pos(self, supplier_codes: list[str], company_code: str | None = None)`; `PgErpSource.open_pos` accepts and applies `company_code`; `FALLBACK_ITEM` reads `gold_ckpost.article`; `get_erp_source()` returns a module-level `LocalErpSource(live=_source)`), `backend/tests/erp/test_erp_api.py` (FakeErp.open_pos gains the parameter)
- Test: `backend/tests/erp/test_local_source.py`

**Interfaces:**
- `LocalErpSource(live: ErpSource, session_factory=SessionLocal)`; methods read short sessions. `open_pos`, `po`, `pos_with_lines`, `vendors` (with `company_code` optional argument added to the Protocol and to `FakeErp.vendors`), `items`, `bought_articles`, `article_codes` come from the copy; `receipts`, `invoices` delegate to `live`. Before the first successful sync (no `ErpSyncRun` with status success) every method delegates to `live`, so a fresh install still works. `ErpPo.loaded_at` = max `erp_loaded_at`; `ErpPo.status` = `derive_po_status` of its present lines; absent (`is_present=false`) lines are excluded; a PO whose lines are all absent is "not found" (the change check then says the ERP no longer has it). `ErpPoLine.po_line_key` becomes `str` in the dataclass.
- `ErpPo.line_count` for headers counts present lines; `header_net/charges` from the line's `hdr_*`.

- [ ] **Step 1: Failing tests**: seed the copy through `run_sync` with `FakeReader` (two companies, two POs each, one cancelled PO, one absent line) and assert: `open_pos(['4431'], 'CKSPL')` returns only that company's OPEN POs; same supplier code on the other company is not returned; `po()` returns lines with received/cancelled quantities and status; a fully cancelled PO has status `CANCELLED`; `vendors('CKVPL')` returns only that company's; `bought_articles('CKSPL')` and `article_codes` aggregate from the copy; before any sync every call delegates (use a recording fake `live`).
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.** Then run the whole `tests/erp` folder: the existing FakeErp-based tests must still pass (update only the `open_pos`/`vendors` signatures).
- [ ] **Step 5: Commit** `feat(erp): serve POs, vendors and items from CKAM's own copy`.

### Task 5: Sync runner, endpoints, settings

**Files:**
- Modify: `backend/app/core/config.py` (`erp_sync_enabled: bool = True`, `erp_sync_check_minutes: int = 30`), `backend/app/main.py` (lifespan starts/stops the loop when `is_configured()` and `erp_sync_enabled`), `backend/app/erp/sync.py` (`async def sync_loop(stop: asyncio.Event)`), `backend/app/erp/router.py`, `backend/app/erp/schemas.py`
- Test: `backend/tests/erp/test_sync_api.py`

**Interfaces:**
- `GET /api/erp/sync` (`require_role(*WRITE_ROLES)`) -> `{configured, last: {status, finished_at, source_stamp, message, counts} | null}`.
- `POST /api/erp/sync` (`require_primary_owner()`) -> runs `run_sync(..., 'manual')` using `get_warehouse_reader` (a FastAPI dependency overridable in tests) and returns the run; 503 with the user message when the ERP is not configured.
- Loop: on start run `needs_sync` -> `run_sync('startup')`; then every `erp_sync_check_minutes` check `needs_sync` -> `run_sync('schedule')`; exceptions are logged (no secrets) and never stop the loop; `stop` event ends it.

- [ ] **Step 1: Failing tests**: status endpoint before and after a run; POST as Primary Owner runs and returns counts; POST as OPERATOR is 403; POST when not configured is 503; `sync_loop` with a fake reader runs once at start and stops when the event is set (use a short interval).
- [ ] **Step 2-4: Fail, implement, pass.** **Step 5: Commit** `feat(erp): sync status, refresh now, and the background check`.

### Task 6: Vendor links per company (backend)

**Files:**
- Create: `backend/app/alembic/versions/d4f6b8c0e2a3_vendor_erp_link.py`
- Modify: `backend/app/masters/models.py` (`VendorErpLink`; remove `Vendor.erp_vendor_code`), `masters/schemas.py` (`VendorOut.erp_links: list[VendorErpLinkOut]` = `{company_id, company_code, erp_vendor_code}`; drop `erp_vendor_code`), `masters/router.py` (vendor list/get fill `erp_links`), `erp/vendors.py`, `erp/service.py`, `erp/router.py`, `erp/schemas.py`
- Test: `backend/tests/erp/test_vendor_links.py`, update `backend/tests/erp/test_erp_api.py`

**Interfaces:**
- Table `vendor_erp_link(id, vendor_id FK vendor, company_id FK company, erp_vendor_code String(50), created_by, created_at)`, unique `(company_id, erp_vendor_code)`, index on `vendor_id`. Migration copies each `vendor.erp_vendor_code` into a link for the company whose `coalesce(erp_company_code, code)` is `CKSPL` (the only company that had ERP data), then drops the column (downgrade re-adds it and copies back the CKSPL link). If no such company exists the values are dropped with a `RAISE NOTICE`-style log line in the migration docstring.
- `linked_vendors(session, company_id) -> dict[str, Vendor]` (ERP code -> active vendor for that company).
- `list_erp_vendors(session, source, company_id)`: each ERP supplier of that company with `linked_vendor_id/name`, and a suggestion: first an active CKAM vendor with the same GSTIN (any company link), then the same normalised name or code; `suggestion_reason: 'gstin'|'name'`. Unlinked + no suggestion -> none.
- `import_vendor(session, actor, source, company_id, erp_code)`: if an active vendor with the same GSTIN exists raise `ValueError("<name> is already a vendor here (same GSTIN). Link it instead.")`; else create the vendor (code = ERP code, or `<COMPANY>-<code>` when taken) plus its link.
- `link_vendor(..., vendor_id, company_id, erp_code)` adds a link (a vendor may have many links, also several in one company); error if (company, code) already linked to another vendor. `unlink_vendor(session, actor, vendor_id, company_id, erp_code)` removes one link.
- Endpoints: `GET /api/erp/vendors?company_id=`, `POST /api/erp/vendors/import` body `{company_id, erp_vendor_code}`, `POST /api/erp/vendors/{id}/link` body `{company_id, erp_vendor_code}`, `DELETE /api/erp/vendors/{id}/link?company_id=&erp_vendor_code=`; all Primary Owner; `company_id` must be a real active company with an ERP code.
- `list_available_pos`: for every company the actor may see, `linked_vendors(company)` then `source.open_pos(codes, company.erp_code)`; each result carries its `company_id`. `build_draft` looks up the vendor with `(matched company, po.supplier_code)`.

- [ ] **Step 1: Failing tests**: migration helper test is covered by running the migration on a database with a vendor row (manual command in Step 4); unit tests: same ERP code in two companies resolves to two different vendors; one vendor linked to both companies is returned for POs of either; GSTIN suggestion ranks above name; import with an existing GSTIN refuses; a duplicate (company, code) link is refused; unlink removes only that link; the picker returns POs of both companies; a PO whose supplier code exists only in the other company gets the "vendor not linked" warning; `VendorOut` shows `erp_links`.
- [ ] **Step 2: Fail. Step 3: Implement (migration first; apply it to `ckam` and `ckam_test`). Step 4: Pass the full backend suite.**
- [ ] **Step 5: Commit** `feat(erp): one vendor, one ERP supplier code per company`.

### Task 7: Vendor change from the ERP is an applicable change

**Files:**
- Modify: `backend/app/erp/changes.py`
- Test: `backend/tests/erp/test_po_changes.py` (extend)

**Interfaces:**
- `compute_changes` emits `{"id": "VENDOR_CHANGED", "kind": "VENDOR_CHANGED", "item_code": None, "was_vendor": po.erp_supplier_code, "now_code": erp.supplier_code, "now_name": erp.supplier_name, "linked_vendor_id": <id|None>, "linked_vendor_name": <name|None>}` instead of the plain "different vendor" info text. The linked vendor is found with `(po.company_id, erp.supplier_code)`, so `compute_changes` gets a `vendors_by_code: dict[str, Vendor]` argument (callers pass `linked_vendors(session, po.company_id)`).
- Apply: needs a linked vendor, else `ValueError("The new vendor is not linked to a CKAM vendor yet. Link it in Setup > Vendors, then apply.")`; sets `po.vendor_id`, stamps the header; delivered assets keep their vendor; the change is logged as `APPLY_VENDOR_CHANGED`. Keep: stamps the header, logs `KEEP_VENDOR_CHANGED`.

- [ ] **Step 1: Failing tests**: change appears when the ERP supplier differs; apply with a linked vendor changes `po.vendor_id`, leaves a delivered asset's vendor alone, and the change disappears; apply without a link is refused with the message; keep leaves the vendor and the change disappears; the existing HEADER tests still pass (vendor text no longer in HEADER).
- [ ] **Step 2-4: Fail, implement, pass the whole suite.** **Step 5: Commit** `feat(erp): a vendor changed in the ERP can be applied to the PO`.

### Task 8: Frontend

**Files:**
- Modify: `frontend/src/features/vendors/ErpVendorsDialog.tsx` (+ test), `frontend/src/routes/setup/vendors.tsx`, `frontend/src/features/erp/ErpChanges.tsx` (+ test), the PO picker / list files that show `company_code`, `frontend/src/features/purchase-orders/PurchaseOrdersList.tsx` (sync "as of" line), shared API types
- Create: `frontend/src/features/erp/ErpSyncStatus.tsx` (+ test)

**Interfaces:**
- `ErpVendorsDialog` gets a company selector (companies that have an ERP code; default the first), lists that company's ERP suppliers with the linked vendor or the suggestion ("same GSTIN" / "same name"), actions Add / Link / Unlink call the new endpoints with `company_id`.
- The Vendors table shows each vendor's links as chips (`CKSPL 2470 · CKVPL 61`).
- `ErpChanges` renders `VENDOR_CHANGED` with "Move this PO to <vendor>" (disabled with the message when not linked) and "Keep".
- `ErpSyncStatus`: "ERP data as of <time>" + Primary Owner "Refresh now" button, shown on the PO list and in the pick-from-ERP dialog.

- [ ] **Step 1: Failing component tests** for each of the four changes (selector switches the list; link chips render; VENDOR_CHANGED actions; sync status text and the owner-only button).
- [ ] **Step 2-4: Fail, implement, pass `npx tsc -b && npx vitest run`.** **Step 5: Commit** `feat(web): company-aware ERP vendors, vendor-change handling, ERP data freshness`.

### Task 9: Real-data check, docs, full run

- [ ] **Step 1:** `docker compose up -d --build api web`, migrate `ckam`; call `POST /api/erp/sync` as the dev Primary Owner (login through the API with the dev account; do not print tokens) and confirm counts per company; open the pick-from-ERP dialog for CKSPL and CKVPL in the browser pane and screenshot-check one draft per company.
- [ ] **Step 2:** Update `docs/ai/ERP_INTEGRATION.md` (sync, gold_ckpost, vendor links), `docs/ai/DECISIONS.md` (new entry), `docs/ai/CURRENT_STAGE.md`, `docs/ai/PRODUCTION_INFRASTRUCTURE.md` note that the prod env needs nothing new (same `PO_SOURCE_*` settings), and the memory files `project_erp_po_integration.md`.
- [ ] **Step 3:** Full backend and frontend suites green; commit `docs: ERP local copy and vendor links`. Report the numbers. Do not push; do not deploy.

## Self-review

- Spec coverage (changes 1 and 2): local copy + nightly sync (T1-5), CKVPL through the same reader (T2-4), PO change check reads the copy (T4), vendor links, GSTIN suggestion, migration (T6), vendor change applicable (T7), "as of" display (T5, T8). Not in this plan, on purpose: "edited here" conflict display (needs its own design), store creation, cross-company allotment, invoices, packet panel (later steps).
- Placeholder scan: none; every interface is named.
- Type consistency: `po_line_key` is text everywhere after T4; `open_pos(codes, company_code)` and `vendors(company_code)` change in T4 and are used in T6; `linked_vendors(session, company_id)` defined in T6 and used in T7.
