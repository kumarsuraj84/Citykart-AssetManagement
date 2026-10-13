# CKAM — Simplification Implementation Plan (for review; nothing here is implemented)

Evidence and numbers: `CKAM_COMPLEXITY_AND_FRICTION_AUDIT.md`. Target model: `CKAM_SIMPLIFIED_OPERATING_MODEL.md`.
Navigation: `CKAM_SIMPLIFIED_INFORMATION_ARCHITECTURE.md`. Flows: `CKAM_CURRENT_VS_SIMPLIFIED_JOURNEYS.md`.
Every stage below follows the project rules: tests before commit, Alembic for any schema change, commit locally, **push only when told, deploy only when asked**.

## 1. Recommendation (explicit answers)

| Question | Answer |
|---|---|
| Does the architecture need to change? | **LEVEL 3 (= "Option C" of the earlier brief): major frontend / information-architecture redesign plus a few targeted orchestration endpoints, backend and data model retained.** Not a rebuild |
| Database rebuild | **No.** No schema change is required for S0–S6. One *optional* additive column (`pending_asset.line_no`) would make PO line grouping exact; a client-side grouping key already exists and works without it |
| Backend rebuild | **No.** The ledger, state machine, serial rules, scope checks and ERP copy are sound and stay |
| Orchestration APIs | **Yes, four:** receive a PO (line quantities), import an ERP PO (resolve-and-report), resolve ERP mappings in one call, create a person/place by plain type |
| Major frontend redesign | **Yes** — navigation, PO page, receipt, Add assets, People & Places, mapping inbox, Home |
| Why not Level 1 (cleanup only) | the top three P0 issues are workflow and permission problems, not styling |
| Why not Level 4 | every measured problem is solvable above the data model; the one structural gap (units not grouped under a line) is solvable client-side |

Root-cause split of the 25 ranked audit issues (primary cause): UI / information architecture / workflow 21 · master-data design or RBAC 3 · ERP integration 1 · **data model 0**. API orchestration is a contributing cause in 4 of them (PO units, delivery failure model, existing-asset Item link, late errors).

## 2. Principles for sequencing

1. **Fix security and integrity defects first** (S0) — found by the API sweep; independent of the redesign and small.
2. Then **what stops people working** (P0): PO page by line, operators unable to create small masters, ERP mapping as exceptions.
3. Cheap, high-visibility wording and navigation changes early so the redesign is felt immediately.
4. Every stage ships behind unchanged APIs wherever possible, so each stage can be reviewed and UAT'd alone.

## 3. Stages

Change classes: **FE** frontend only · **API-C** API-compatible change (same contract, new validation/field) · **ORCH** new orchestration endpoint (old endpoints stay) · **DB** migration · **BRK** breaking.
Effort: S ≤ 2 days · M ≤ 1 week · L ≤ 2 weeks · XL > 2 weeks (one developer + the existing test suites).

### S0 — Security and integrity defects (before any redesign) — P0/P1

| # | Change | Class | Effort |
|---|---|---|---|
| S0.1 | Only a Primary Owner may reset-password / edit / deactivate a Primary-Owner account (audit App. B-1; confirmed in source) | API-C | S |
| S0.2 | Upper bound on `quantity` (e.g. 1,000, as bundle/ERP lines already have), reject ≤ 0; cap bulk id lists (B-2) | API-C | S |
| S0.3 | Enforce work area (IT/Non-IT) on PO reads/writes, delivery, asset creation, ERP create, PI recording and the two export endpoints (B-3, B-4) | API-C | M |
| S0.4 | `apply_event`: ignore/refuse a destination on events that have none; CORRECTION cannot change custody; keep `status_since` (B-5) | API-C | S |
| S0.5 | Request validation: no blank serial/invoice/description/PO number, no negative amounts/warranty/tax outside 0–100, date sanity; blank serial can no longer create a "neither pending nor N/A" asset (B-6) | API-C | M |
| S0.6 | Refuse deactivated cost centre/category/Item/vendor/holder and deleted POs for new work (B-7) | API-C | M |
| S0.7 | Catch `LifecycleError` on deliver (500 → 422 with the existing message); `DataError`/`IntegrityError` handler returning friendly 422 instead of bare 500; validate Excel files (B-8, B-11, B-12, B-15) | API-C | S |
| S0.8 | ERP create re-reads the ERP copy for PO number/lines/rate; correct message for a bad vendor id (B-9) | API-C | M |
| S0.9 | Validate asset-code rule on save (tokens, start ≥ 0, pad ≥ 0); decide who may change it (B-10) | API-C | S |
| S0.10 | Messages: business sentences without ids/enums (B-13); LIKE escaping; email/GSTIN format; case-insensitive code uniqueness *for new records* (B-14, B-15) | API-C | M |
| S0.11 | Owner decision D6: should an ordinary ADMIN be limited to chosen companies? (B-16) | decision | – |

All S0 items are unit-testable, change no schema, and are independent of S1+. Each fix gets a regression test.

### S1 — Navigation, wording and quick wins (information architecture, no behaviour change) — P1

| # | Change | Class | Effort |
|---|---|---|---|
| S1.1 | New sidebar (Home, Work, People & Places, Reports, Settings) and per-role menus; Settings group collapsed | FE | M |
| S1.2 | Route guards for `/setup/*`, `/import`, People & Places ("ask the head-office admin") | FE | S |
| S1.3 | One vocabulary (Holder, Stock room, Work area, In stock/With a person…, Cost centre, Settings); remove "All asset_users", "Setup >" ×12, "restore" promise, `PO_SOURCE_*`, spell out PI | FE | S |
| S1.4 | Dropdown labels with context (Item: group; holder: name · place · company; cost centre: code) | FE | S |
| S1.5 | Fix: Move/Dispatch sort key, My Assets caption (becomes "Mine" filter), Dashboard row links, plain selects → searchable | FE | S |
| S1.6 | Home: task tiles + "needs attention" queues using existing endpoints (dashboard, serial pending, ERP changes, reminders) | FE | M |
| S1.7 | Merge Companies/Locations/Departments/Cost centres into Settings › Organisation tabs; Categories+Sub-Categories into "Asset groups"; Brands under Catalogue; Import/Custom fields/Code rule under Advanced | FE | M |

### S2 — PO page by line, selection that scales — P0

| # | Change | Class | Effort |
|---|---|---|---|
| S2.1 | PO detail shows **lines** (ordered · received · waiting) grouped by the existing group key (description, barcode, item, brand, model, cost); line Edit/Cancel act on the group; units remain behind a "units" expander | FE | M |
| S2.2 | Per-line select and "select all of this line"; PO page no longer 6,000 px; Delete PO confirm + clearer wording | FE | S |
| S2.3 | PO list: status, progress, company; header buttons de-emphasised (Delete not red-primary) | FE | S |
| S2.4 | *(optional)* `pending_asset.line_no` so grouping is exact when two lines look identical | DB (additive, nullable) | S |
| S2.5 | "PO created: 3 lines, 104 units waiting" instead of "104 lines added" | FE | S |

### S3 — Mapping and in-flow creation — P0/P1

| # | Change | Class | Effort |
|---|---|---|---|
| S3.1 | **Decision D1:** allow Admin and Operator to create *small masters in the flow* (vendor, brand, Item, stock room, cost centre); edit/deactivate and heavy masters stay owner-only. Wire the existing dead `operator_can_manage_masters` setting, or add a narrower in-flow permission | API-C (RBAC) | M |
| S3.2 | Show "+ New …" to every user the server allows; vendor/brand/stock-room dialogs with 2 fields (Code generated); Item dialog with one "type of asset" pick and plain serial mode | FE | M |
| S3.3 | PO review: matched lines collapsed, only exceptions open; remember-by-group default; "Not an asset" for Admin/Operator (stored as not-tracked rule) | FE + API-C | M |
| S3.4 | Vendor mapping: suggest/group by PAN (GSTIN chars 3–12) and name stem; "link all N registrations" in one action; picker lists POs of unmatched vendors with "match vendor" | API-C + FE | M |
| S3.5 | **ERP inbox** (head-office admin): new items (with suggestion), new vendors, new stores; replaces the 850-code list as the daily surface; Items' "ERP codes" tab kept | ORCH (`GET /erp/inbox`, `POST /erp/inbox/resolve` batch) + FE | L |
| S3.6 | "Link existing assets to Items" tool (L18: no API today) with suggestions by description/ERP code | API-C (new endpoint) + FE | M |
| S3.7 | Items: absorb Bundles ("comes as a set"); Category+Sub-Category as one "type of asset" pick (Sub-Category optional in the UI, kept in the model) | FE | M |
| S3.8 | Item defaults (brand, warranty, serial mode) applied in **every** path (manual PO line, Add Asset, delivery) | API-C | S |

### S4 — Receive — P0/P1

| # | Change | Class | Effort |
|---|---|---|---|
| S4.1 | **Receive** queue + receipt screen: received-into, invoice once, **quantity per line**, serial box only where the Item's serial mode needs it, "why is it disabled" text, Ctrl+Enter, result panel with print-labels and failed units | FE | L |
| S4.2 | `POST /purchase-orders/{id}/receive`: line quantities + call-level defaults (place, invoice); picks pending units itself; returns created assets and per-unit failures (partial success option); old `/deliver` stays for compatibility | ORCH | M |
| S4.3 | Delivery batching: one set of lookups per call instead of ~10 queries per unit (100 units ≈ 1,000 queries today); a required custom field no longer silently blocks delivery (prompt at receipt instead) | API-C | M |
| S4.4 | Serial rule single source = Item (3 modes in plain words); delivery, Add assets and Serial pending read it; bulk serial entry for "later" | FE + API-C | M |
| S4.5 | PI and ERP-change panels collapse to one card each on the PO; Record/Fetch PI in one dialog | FE | S |

### S5 — Assets, people and movement — P1/P2

| # | Change | Class | Effort |
|---|---|---|---|
| S5.1 | **Add assets** with quantity, essentials-first layout, Item-derived description/brand/warranty/serial mode, generated barcode, optional purchase details | FE + ORCH (`POST /assets/batch`) | M |
| S5.2 | Asset 360: Summary → Identity → Procurement → Where it is/History; Company shown; Documents/Changes/Custom fields under "More"; breadcrumb; viewers do not see lifecycle buttons | FE | M |
| S5.3 | Register: universal search incl. Item, ERP code, vendor, PO, holder; Item and PO columns; "More filters"; default work area | FE + API-C | M |
| S5.4 | People & Places: four menus over `asset_user`; plain role names; **work-area field** (IT/Non-IT/Both, today missing); store creation also creates its stock room + install point; password hand-over in bulk | FE + ORCH (`POST /people` typed create) | L |
| S5.5 | Move: plain-word actions, Register and Asset 360 open it pre-filled; label settings collapsed; contextual "Print labels" everywhere | FE | M |
| S5.6 | Remove `/dispatch` redirect and the dead `primary_asset_domain`/`app_setting` after a usage check | API-C | S |

### S6 — Dashboard and Reports — P2/P3

| # | Change | Class | Effort |
|---|---|---|---|
| S6.1 | Dashboard folded into Home (queues first; status tiles and Exceptions become one compact block) | FE | S |
| S6.2 | Reports: on-screen result with filters before Excel; work-area defaults | FE + API-C | M |
| S6.3 | "Set up CKAM" wizard (7 steps) for a new company; live example for the asset code format | FE | M |

### S7 — Full UAT and hardening — gate for release

Per role (head-office admin, Admin, IT/Non-IT operator, purchase, delivery, viewer, self-service) re-run **every journey in `CKAM_CURRENT_VS_SIMPLIFIED_JOURNEYS.md`** against the targets, plus: the S0 regression suite, two-company isolation, work-area isolation, 100-unit receipt timing, mobile/tablet layout, keyboard-only receipt, Excel parity (import vs Add assets), ledger/audit parity (no new write path outside `apply_event`). Real-browser evidence kept in the repo like AM-15.

## 4. Order and dependencies

```
S0 (defects) ─────────────┐
S1 (IA + wording) ────────┼─► S2 (PO by line) ─► S4 (Receive)
S3.1 (in-flow rights: D1) ┘            │              │
S3.2–3.8 (mapping, inbox) ─────────────┘              ├─► S5 (Add / People / Move) ─► S6 ─► S7
```
S0, S1 and S3.1 are independent and can start together. S2 before S4 because Receive consumes line grouping. S3.5 (inbox) needs S3.4 and the existing item-map rules, not S2.

Controls: each stage is a branch of small commits, full existing suites green (frontend 454 today) plus the added regression tests, a UAT pass of the stage's own journeys, no push, no deploy until the owner says so.

## 5. Risk classification of everything proposed

| Class | Items |
|---|---|
| FE only | S1.1–S1.7, S2.1–S2.3, S2.5, S3.2, S3.7, S4.1, S4.5, S5.2, S5.5, S6.1, S6.3 |
| API-compatible | S0.1–S0.10, S3.1, S3.3 (part), S3.4, S3.6, S3.8, S4.3, S4.4 (part), S5.3 (part), S5.6, S6.2 (part) |
| New orchestration endpoint (old stays) | S3.5 inbox, S4.2 receive, S5.1 batch add, S5.4 typed people create |
| DB migration | **only S2.4 (optional, additive, nullable)** |
| Breaking | **none** — old endpoints (`/deliver`, `/assets`, `/asset-users`) stay until the old screens are retired |

## 6. Security, audit, performance, mobile, migration implications

* **Security:** all new checks are server-side; hiding menus is cosmetic. S3.1 is the one real change to *who may write*; it is limited to small masters, logged with the actor, and reversible by the setting. S0 closes the three open privilege/scope holes.
* **Audit:** unchanged — every receipt still writes asset + `PROCURED` event via the same service; the receive endpoint adds no write path outside it. Mapping decisions keep their actor in `item_map`/`vendor_erp_link`.
* **Performance:** S4.3 turns ~10 queries per unit into per-call lookups; the receive endpoint processes in batches with one commit. Lists that are unpaginated today (POs, asset users, items) get server search before Items reach hundreds.
* **Mobile/responsive:** Receive, Move and Add assets are the screens used on phones/tablets at stock rooms; they are designed single-column with sticky action bars; Settings is desktop-first.
* **Migration:** none for S0–S6 except optional S2.4. No data conversion; the sandbox copy of dev is the dry-run bed.

## 7. What must not change

Append-only ledger and audit tables · `apply_event` as the only status/holder writer · serial uniqueness · company boundary for assets · soft-deactivate only · ERP read-only copy and its "as of" line · Item as asset identity · Alembic discipline · authorization on the server.

## 8. Quick wins vs medium vs major

| Bucket | Items |
|---|---|
| **Quick wins** (days, FE) | S1.2, S1.3, S1.4, S1.5, S2.2, S2.5, S4.5; S0.1, S0.2, S0.4, S0.7, S0.9 |
| **Medium** (a week each) | S1.1, S1.6, S1.7, S2.1, S2.3, S3.2, S3.3, S3.4, S3.8, S4.3, S5.2, S5.3, S5.5; S0.3, S0.5, S0.6, S0.8, S0.10 |
| **Major** (L) | S3.5 ERP inbox, S4.1 Receive screen + S4.2 endpoint, S5.4 People & Places |

## 9. Decisions needed from the owner before S3/S4/S5 (the audit does not assume them)

| # | Decision | Recommendation |
|---|---|---|
| D1 | May **Admin and Operator create small masters in the flow** (vendor, brand, Item, stock room, cost centre)? | Yes — it removes the largest dead end; heavy masters stay owner-only |
| D2 | May an Operator mark a PO line **"Not an asset"**? | Yes for that PO line and its ERP group; undo by the head-office admin |
| D3 | Is **Sub-Category optional** in the UI (one "type of asset" pick, model unchanged)? | Yes; keep the asset-code token working with a default |
| D4 | One stock room **auto-created per store** (and an install point)? | Yes |
| D5 | Name for the receipt screen: **Receive**? | Yes |
| D6 | Should an ordinary **ADMIN be restricted to chosen companies**? (today unrestricted, see Appendix B-16) | Yes; re-use Company Access |
| D7 | Work area wording **IT team / Admin team / Both**? | Yes |
| D8 | Should existing assets without an Item (all 53 in dev) be linked by a one-time tool? | Yes (S3.6) |

## 10. Done criteria for the programme

Targets in `CKAM_SIMPLIFIED_OPERATING_MODEL.md` §12 are met in a recorded S7 UAT: vendor < 1 min, category < 1 min, normal PO < 3 min, 10 serial assets received < 5 min, 50 non-serial received in one receipt, find < 30 s, move/allot < 1 min; zero dead ends for an Operator doing a PO + receipt with a new vendor, Item and stock room; no regression in the S0 suite or in the ledger/serial/scope guarantees.
