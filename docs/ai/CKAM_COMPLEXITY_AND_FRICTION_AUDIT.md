# CKAM — Complexity and Friction Audit (HEAD `fc5bda4`, 2026-10-13)

Read-only. Companion to `CKAM_CURRENT_PRODUCT_ARCHITECTURE_2026.md`.

## 0. How this was measured (and what is estimate)

| Mark | Meaning |
|---|---|
| **M** | Measured: driven in a real headless browser against the throw-away UAT copy (ports 3311/8100), as the actual user type (Primary Owner, IT operator, Non-IT operator, purchase operator, viewer). Screenshots/DOM counts taken. |
| **C** | Counted from the source of the form/dialog (every field, required marker, button) — exact for field counts, an honest minimum for clicks. |
| **E** | Estimate of elapsed time, from C counts at ordinary typing speed. Not a stopwatch. |

Click counts below count: each tick, each dropdown open + type + choose (3), each Save/Confirm, each navigation. Typed fields counted by field, not by keystroke.

## 1. The primary question

> "Can a normal CityKart employee do the daily job without first understanding CKAM's database?"

**No, not today — for four of the eight kinds of user.**

| Kind of user | Can finish the daily job unaided? | Why not |
|---|---|---|
| Purchase / PO user | Only if every Item, vendor, brand and cost centre already exists | Cannot create any of them (91 operations are Primary-Owner-only, and every "+ New…" is hidden); the unmapped-vendor PO is not even listed |
| Delivery user | Mostly yes (the delivery dialog is the best screen in the product) | Selecting units is per-row; a PO of 104 units is a 6,400 px list; one bad unit fails the whole delivery |
| IT admin | Partly | Cannot add a vendor, brand or Item; needs the owner for every new thing |
| Non-IT admin | Partly | Same, plus a store needs three different "Asset Users" (store, install point, stock room) |
| Asset operations user | Yes for moves; no for finding things | Register has no Item or ERP-code search/column; four ways to move |
| Primary Owner | Only with training | 24-entry menu, 10 setup screens before the first asset, 5 places to decide one ERP code |
| Viewer | Yes | – |
| Self-service | Yes (but sees the whole register under the caption "your custody" if not self-service) | bug |

## 2. Screen inventory with complexity rating

Rating: SIMPLE · ACCEPTABLE · COMPLICATED · VERY COMPLICATED. Frequency: D daily · O occasional · S setup · A advanced.

| Route | Persona | Freq | Main actions | Needs first | Manual links | Duplicates | Rating |
|---|---|---|---|---|---|---|---|
| `/login`, `/change-password` | all | D | sign in | – | – | – | SIMPLE |
| `/dashboard` | admin/operator/viewer | D | read counts, follow links | data | – | statuses shown twice; ERP-changes card ×3 | ACCEPTABLE (informational, not actionable) |
| `/my-assets` | everyone | D | list | – | – | = Register filtered | ACCEPTABLE (caption bug for staff) |
| `/assets` Register | operators | D | search, filter (6), columns (27), bulk move | assets | – | Move ×4 | COMPLICATED (no Item/ERP-code search; 3 plain-select filters) |
| `/assets/new` Add Asset | operator | D | one asset per save | company, cost centre, Item, vendor, stock point, code rule | 6 | PO/invoice/PI fields duplicate PO+delivery | **VERY COMPLICATED** (22 fields, 7 required) |
| `/assets/$id` Asset 360 | operators | D | read, edit, correct, move | – | – | History/Changes/Dashboard activity | COMPLICATED (7 tabs, no Company, Edit cannot change Item) |
| `/serial-pending` | operator | D | type serial per row | – | – | Asset 360 edit | ACCEPTABLE |
| `/asset-movement` | operator/warehouse | D | scan, choose action, destination, apply | asset users | 1 | Register move, Asset 360, Import movements, Print Labels | COMPLICATED (12 controls, label block inline) |
| `/print-labels` | operator | D | queue, preview, print | – | – | printing in 5 places | ACCEPTABLE |
| `/purchase-orders` list | PO user | D | search, open | – | – | ERP cards ×2 | ACCEPTABLE (no status, no company column) |
| `/purchase-orders/new` | PO user | D | header | company, vendor, cost centre | 3 | – | ACCEPTABLE |
| `/purchase-orders/from-erp` | PO user | D | pick, review, create | vendor link, Items, cost centre, stock point mapping, ERP copy | **up to 4** | item decision ×5 screens | **VERY COMPLICATED** when anything is unmapped; ACCEPTABLE when all mapped |
| `/purchase-orders/$id` | PO + delivery | D | add line, deliver, record PI, ERP changes | – | – | Delivery, PI ×4 | **VERY COMPLICATED** (one row per unit, 9 buttons, 3 tables, ERP panels) |
| `/import` | owner | S/O | 4 Excel imports | templates | – | Add Asset, PO new, Move | COMPLICATED |
| `/reports` | admin/viewer | O | 3 Excel downloads | – | – | Register | ACCEPTABLE |
| Masters ×8 (companies, locations, departments, cost centres, categories, sub-categories, vendors, brands) | owner | S | CRUD | order matters (company → location/cost centre; category → sub-category) | 1–2 each | Import/Export per master | ACCEPTABLE each, COMPLICATED together |
| `/setup/items` | owner | S/O | CRUD, ERP links | category + sub-category | 2 | ERP Articles | COMPLICATED |
| `/setup/erp-articles` | owner | **D in practice** | Codes / Articles / Groups… / Codes… | ERP copy, Items | **1 per code (850 undecided in dev)** | Items → ERP links, PO review | **VERY COMPLICATED** |
| `/setup/bundles` | owner | S | parts + shares | single Items | 2 | Item form, PO | COMPLICATED |
| `/setup/custom-fields` | owner | A | CRUD | – | scope | – | ACCEPTABLE (but a required field blocks all delivery) |
| `/setup/asset-users` | admin | S/O | CRUD, access, passwords, Stores from ERP | company, location | 5 | – | **VERY COMPLICATED** (4 kinds in one list, 11 concepts, no IT/Non-IT field) |
| `/setup/code-rule` | admin | A | template | – | – | – | COMPLICATED (token syntax; first error appears at first asset) |

30 screens: 2 SIMPLE, 11 ACCEPTABLE, 11 COMPLICATED, 6 VERY COMPLICATED.

## 3. Measured and counted journeys

| # | Journey (persona) | Basis | Screens | Dialogs | Clicks | Typed fields | Repeated values | Manual maps | Backtracks | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| A | New **ERP PO, everything already mapped** (PO user) | **M** | 3 (list → picker → review) | 0 | 3 (Pick, Review, Create) | 0 | 0 | 0 | 0 | **ACCEPTABLE** — good. Not a one-click import: the review is a long form of every field. |
| B | ERP PO with **1 unmapped Item** (PO user) | **M** | 3 | 0 | 3 + 3 (open, type, choose) = 6 | 0 | 0 | 1 | **dead end if the Item does not exist** (operators have no "+ New Item") | TOO COMPLEX; UNUSABLE for a non-owner when the Item is missing |
| B′ | same, owner, Item missing | **C** | 3 + Items + back | 1 (8 fields) | ~14 | 3 | 0 | 1 | 1 | TOO COMPLEX |
| C | ERP PO of an **unmapped vendor** (owner) | **M/C** | picker does **not list the PO at all**; owner goes Vendors → Add from ERP → company → search → Add → back to picker | 1 | ~8 | 1 (search) | 0 | 1 per company per ERP supplier code | 2 | TOO COMPLEX (and silent: the user sees no PO, not "a vendor is unmapped") |
| D | **Manual PO**: vendor ABC, 10 laptops + 5 ACs | **C** | 2 (new, detail) | 0 | ≈ 24 | ≈ 18 (header 6, per line: description, barcode, cost, qty, tax, warranty) | description and barcode per line; cost centre | 0 (3 if vendor/Item/cost centre missing → dead end) | 0 | TOO COMPLEX for a 2-line PO; ~4–6 min **E** |
| E | **Receive 10 serialised laptops** into HO stock | **M/C** | 1 (PO detail) | 1 | tick 10 rows (or header select-all = every product) + open + paste + confirm ≈ 14 | 4 common + 10 serials (paste) | location prefilled; invoice once | 0 | 0 | ACCEPTABLE (best flow in the product) once rows are selected; ~4 min **E** |
| F | Receive **50 non-serial chairs** | **M** (selection) /**C** | 1 | 1 | 50 ticks (header checkbox cannot select one product when the PO has several) + "No serial" + confirm ≈ 53 | 4 | 0 | 0 | 0 | TOO COMPLEX → **UNUSABLE AT SCALE** (100 units = 100 ticks and a 6,400 px page) |
| G | Receive 10 **serial-later** units | **C** | PO detail + Serial Pending | 1 | 4 + 10 × (type, Save) = 24 | 4 + 10 | 0 | 0 | 1 | TOO COMPLEX (no bulk serial entry later) |
| H | **Add direct asset** (IT) | **M/C** | 1 | 0 (4 quick-creates owner-only) | 8 – 12 | 8 – 10 of 22 fields | description, barcode, vendor, cost centre, stock point, cost per asset | 0 | 1 if a vendor/brand/Item is missing | **UNUSABLE AT SCALE** (N assets = N full forms; Import is owner-only) |
| I | **Move 20 assets to a store** | **M/C** | 1 | 0 | 2 selects + 20 scans/Enter + Apply ≈ 24 | 20 scans, remarks | 0 | 0 | 0 | ACCEPTABLE; "Add by Item" + count shortens it; page carries 12 controls of which 5 are label settings |
| J | **Create vendor** (owner) | **M/C** | 1 | 1 | 4 | 6 fields (2 in quick-create, but the user must invent a Code) | – | – | – | ACCEPTABLE (<1 min) — but only the owner |
| K | **Create Item** (owner) | **M/C** | 1 | 1 | ~8 | 3 required of 8 | – | 2 (Category + Sub-Category must exist) | maybe 2 | ACCEPTABLE |
| L | **Create employee / stock room** (admin) | **M/C** | 1 | 1 | ~9 | 5 required of 10 (+3 for login) | – | 3 (company, location, department) | 1 | COMPLICATED (raw type names, hidden roles, no work-area field) |
| M | **Find an asset by serial / barcode** | **M** | 1 | 0 | 2 | 1 | – | – | – | ACCEPTABLE (<30 s); not by Item or ERP code |
| N | **First-time owner set-up of one IT environment** | **C** | **10** (Company, Location, Cost Centre, Code Rule, Category, Sub-Category, Item, Vendor, Asset User (stock room), Brand) | 7 | ~70 | ~41 | company/location repeated | 8 | many (a missing Code Rule or stock room only fails at the first asset) | **TOO COMPLEX** — needs prior knowledge of 7 things below |
| O | Non-IT: Gondola, buy 20, send 10 to Store A, install 5, keep 5 | **C** | ≈ 12 | ≈ 8 | ≈ 80 | ≈ 55 | – | **3 asset users for one store** (STORE, INSTALLED, STOCK_POINT; the ERP store import makes only the STORE) | 3 | TOO COMPLEX |
| P | IT: laptop → HO stock → employee → return → reassign | **C** | PO detail, Move ×3 | 1 | ≈ 45 end to end | 25 | – | employee must exist (7-field form) | 0 | ACCEPTABLE except creating things |

### 3.1 First-time owner: moments that require prior knowledge (journey N)

1. Why a **Code Rule** must exist before anything else, and what `{cost_center.code}` means — fails only at the first asset.
2. **Location** is not a place assets sit; it is only used by Asset Users.
3. A **stock room must exist** as an "Asset User of type STOCK_POINT" before the first asset can be added ("Goes Into"). The empty-state text sends the user to "Setup > Users" — no such menu.
4. **Category vs Sub-Category vs Item**: an Item needs both; asset codes use the Sub-Category; the user never picks either on an asset.
5. **Responsibility** (IT/Non-IT) is set on the Category; there is no screen that says what it does.
6. An ordinary ADMIN **cannot do any of this** — only the Primary Owner.
7. Item **serial rule** (yes/no/later) is on the Item; Add Asset presets from it but does not enforce it.

### 3.2 Delivery at scale (measured on a 104-unit PO)

| Units | Selecting | Dialog | Page |
|---|---|---|---|
| 1–5 | fine | 4 common fields + one serial box | fine |
| 10 | 10 ticks, or select-all if the PO holds a single product | one textarea of 10 lines | fine |
| 50 | 50 ticks (or all 104) | one 6-row textarea scrolling 50 lines; no per-unit view | 3,400 px of identical rows |
| 100 | 100 ticks | same, "3 too many" counter helps; no way to see which unit got which serial | 6,453 px page (measured) |

The dialog design (common data once, serial per product group, N/A and "later" as one tick) is right. The surrounding PO page is what makes it unusable at scale.

## 4. Ranked complexity and friction issues

Impact 1–5 (5 = stops work) × frequency (D daily, O occasional, S setup) → priority. Root cause classes: UI · IA (information architecture) · WF (workflow) · API (orchestration) · DM (data model) · RBAC · MD (master-data design) · ERP.

| # | Issue (evidence) | Users hit | Impact | Freq | Root cause | Effort | Priority |
|---|---|---|---|---|---|---|---|
| 1 | **PO page = one row per unit** (3 ordered lines → 104 rows; Edit/Cancel per unit; select-all picks everything) (M) | PO, delivery | 5 | D | WF + UI (+ API grouping) | M | **P0** |
| 2 | **Operators cannot create a vendor, brand, Item, cost centre or stock room** — every "+ New…" is hidden; the form only says to ask the owner (M, source) | PO, IT, Non-IT admin | 5 | D | RBAC + MD | M | **P0** |
| 3 | **ERP Item mapping is a 5-screen, 4-mode owner chore** with 850 of 863 codes "Not decided" in dev; the daily need is only the codes on open POs (M) | owner, PO | 5 | D | WF + ERP | L | **P0** |
| 4 | **Vendor mapping lists 146 ERP suppliers; one real vendor appears once per GST state** (Blue Star at least 12, Daikin 10, Godrej 10, Bosch 6, Johnson Controls 5; the dialog shows only the first 100 of 146 so the true counts can be higher; they share one PAN inside the GSTIN). Only the exact-name twin gets "Link"; the rest offer "Add as vendor", which makes duplicate vendors. Unlinked vendor's POs are **invisible** in the picker (M) | owner, PO | 4 | S/D | ERP + UI | M | **P1** |
| 5 | **Add Asset: 22 fields, one asset per save**; description/barcode/vendor/cost centre retyped; not derived from Item; 100 assets = 100 forms; Import owner-only (M, C) | IT, Non-IT | 4 | D | WF | M | **P1** |
| 6 | **Navigation**: 24 entries; Masters (12) and Administration (2) are permanent sidebar groups; ERP Articles (daily in practice) buried under Masters; Import and Reports sit with daily work; labels, spelling and group names inconsistent (C, M) | all | 4 | D | IA | M | **P1** |
| 7 | **Asset User** is one list of people, stores, stock rooms and install points with raw type names; 11 concepts to give someone a login; no field for IT/Non-IT work area (the UAT operators had to be created by script); a store needs 3 asset users; password reset per store (M, C) | admin, owner | 4 | S/O | IA + UI + RBAC | M | **P1** |
| 8 | **Delivery selection and failure model**: units ticked row by row; no per-line quantity; one bad unit fails the whole delivery; a required custom field silently blocks every delivery; no per-unit result (C) | delivery | 4 | D | WF + API | M | **P1** |
| 9 | **Serial rule is 3 states × 5 phrasings × 5 surfaces**; Item rule only presets; "serial later" needs one Save per asset (C) | delivery, IT | 3 | D | WF + MD | M | **P1** |
| 10 | **Terminology leaks** (list in §6) incl. "All asset_users", raw enums, "Setup >" ×12 though no Setup menu exists, "Primary Owner", "PI" never spelled out (C) | all | 3 | D | UI | S | **P1** (cheap) |
| 11 | **No route guards**: operators open `/setup/*`, `/import` and see working Add/Edit buttons that fail with 403 (M). Security is intact (server), UX is not | operators | 3 | O | UI | S | P2 |
| 12 | **Move has 4 paths and 4 field sets** (Register bulk, Move/Dispatch, Asset 360, Import) and Move/Dispatch carries a 5-control label block inline (C) | warehouse | 3 | D | IA | M | P2 |
| 13 | **Labels in 5 places** with settings per browser (C) | warehouse | 2 | D | IA | S | P2 |
| 14 | **Register**: no Item column or filter, no ERP-code/PO/vendor search; Category and Company filters are plain selects (M, C) | all | 3 | D | UI | M | P2 |
| 15 | **Asset 360**: 7 tabs; Company not shown; Edit cannot change Item/Cost Centre/Category; Correction changes Category without touching the Item; **no API to link an existing asset to an Item** (all 53 dev assets have none) (C) | operators | 3 | D | UI + API | M | P2 |
| 16 | **Dashboard** is counts, not work: statuses appear twice; no "needs attention" queue (deliveries waiting, serial pending, ERP changes) (M) | all | 3 | D | IA | S | P2 |
| 17 | **ERP changes appear in 4 places**; PI can be entered in 4 places (C) | PO | 2 | O | IA | S | P2 |
| 18 | **PO list**: no status/progress, no company; PO header cannot be edited; line Cancel has no confirm; Delete PO removes delivered assets (C, M) | PO | 3 | D | UI | S | P2 |
| 19 | **Category / Sub-Category / Item**: three levels, Item must have both, asset code uses the Sub-Category, users never choose either on an asset (C) | owner | 2 | S | MD | M | P3 |
| 20 | **Bundles** in 3 places (Bundles screen, Item form, PO) and two copies of the split logic (C) | owner, PO | 2 | O | IA | S | P3 |
| 21 | **Dropdowns show only names**: Item list has no category; asset users with the same name in two companies are identical; Location code and cost-centre code never shown (C) | all | 3 | D | UI | S | P2 |
| 22 | **Errors only after Save**: no code rule / bad token, company mismatches, required custom field blocking delivery, serial duplicate on Add Asset, lifecycle illegalities as sentences with enum codes (C) | all | 3 | D | UI + API | M | P2 |
| 23 | **Silent failures**: ERP reminders 503 in the sandbox shows nothing; empty-state mentions `PO_SOURCE_*` env names (M) | PO | 2 | O | UI | S | P3 |
| 24 | Bugs: Move/Dispatch queue sort key (`AssetMovement.tsx:656`); My Assets caption for staff; Dashboard warranty rows reload the page; Asset 360 Print = whole-page print (C) | various | 1–2 | D | UI | S | P3 |
| 25 | Config clutter: 215 inactive stray companies, 222 locations under one company, dead `app_setting`/`primary_asset_domain`, copy promising a "restore" that does not exist (C) | owner | 1–2 | S | MD | S | P3 |

## 5. Duplication audit (same job, several places)

| Job | Places |
|---|---|
| Decide an ERP code's Item / not tracked | ERP Articles → Codes, → Articles, → Groups…, → Codes…; Items → ERP links; PO review line "Remember" |
| Move an asset | Register bulk, Move/Dispatch, Asset 360, Import → Movements |
| Create assets | Add Asset, PO delivery, Import (assets), Import (PO), ERP draft |
| Print a label | Print Labels, Move/Dispatch, Asset 360, Delivery ×2 |
| Serial | Add Asset (3 states), Delivery (3 states per product), Serial Pending, Asset 360 Edit (N/A only), Import → Edit |
| PI | Add Asset, Asset 360 Edit, Record PI, Fetch PI, PO list columns |
| Responsibility filter | Dashboard "My Responsibility", Register, Reports; never defaulted to the user's own work area |
| Status | Dashboard tiles, Exceptions table, Register filter, Reports filter, Asset 360 pill |
| History | Dashboard Recent Activity, Asset 360 History, Changes, two Excel logs |
| ERP changes / freshness | PO list (card + badges), Dashboard card, per-PO panel, sync line ×2 |
| Bundle definition | Bundles screen, Item form, PO Add Bundle, ERP draft grid |
| Same field on several forms | Invoice no/date/amount (delivery, Add Asset, Asset Edit); vendor (Add Asset, PO, Asset Edit); barcode (PO line, Add Asset, Asset Edit) |

## 6. Technical concept leakage (replace with business words)

| Seen by the user | Where | Say |
|---|---|---|
| "All asset_users" | Register filter | Everyone |
| IN_STOCK / ALLOTTED / UNDER_REPAIR / SCRAPPED | status badges, filters | In stock · With a person · Under repair · Scrapped |
| EMPLOYEE / STORE / INSTALLED / STOCK_POINT | Asset Users, Asset 360 | Employee · Store · Installed at a store · Stock room |
| ADMIN / OPERATOR / VIEWER / SELF_SERVICE | Asset Users | Full admin · Can add and move · Can only view · Sees own assets |
| "Asset User", "Initial Asset User", "Goes Into", "Delivery location", "Initial Custody" | five screens, one concept | **Holder** ("who/where it is with") and **Received into** |
| "Responsibility" | 8 places | Handled by (IT team / Admin team) |
| "Primary Owner" | 4 messages | the head-office admin |
| "Setup > …" (12) and "Users" | messages | Settings > … / Asset Users (menu does not exist today) |
| "Remember for every code of this Article" | PO review | Use this Item for every code in this group |
| Article, Section › Department, "Decide by", "Not decided", "ERP links" | ERP Articles | not needed once mapping is an inbox of exceptions |
| PI | everywhere | Purchase invoice (spell out once) |
| field names in Changes tab (`serial_number`, `po_date`) | Asset 360 | Serial number, PO date |
| "Pending asset", "104 lines added" for a 3-line PO | PO create banner, PO detail | "3 lines, 104 units" |
| `PO_SOURCE_*` | empty state | "The ERP connection is not set up on this server" |

## 7. Inline creation: where users leave their task

| Master | Created in place today | Dead end for operators |
|---|---|---|
| Vendor, Brand, Cost centre, Item | yes, owner only | **yes** |
| Category, Sub-Category | inside Item / Sub-Category forms, owner only | yes |
| Stock room / store / install point | **never** (only the "Stores from ERP" bulk dialog) | **yes for everyone**, incl. Add Asset "Goes Into", PO delivery location, Delivery dialog, Move destination |
| Location, Department | Asset User form only | – |
| Company, Bundle, Custom field, Code rule, ERP vendor link | never | owner leaves the task |

## 8. Smart defaults and "enter once" — what is repeated today

| Value | Entered | Should be |
|---|---|---|
| Company | Add Asset, PO new (defaulted for single-company users) | implied by cost centre / holder / user |
| Cost centre | every PO, every asset | default per company / last used; inherited by delivered assets (already) |
| Vendor | PO header **and again** on Add Asset | PO → assets (already inherited on delivery) |
| Description, barcode | every PO line and every Add Asset | description from Item (+brand/model); barcode derived or generated |
| Initial stock room | PO header, again in the Delivery dialog (prefilled), per unit in the API | once per receipt |
| Invoice no/date/amount | once per delivery (good); again on Add Asset | once |
| Brand / warranty | Item defaults applied in ERP draft and Add Asset, **not** in the manual PO line | applied everywhere |
| Serial rule | Item, PO unit, delivery dialog, Add Asset, bundle part | Item only; the rest are derived views |

## 9. What the audit found to be GOOD (keep)

* Delivery dialog design: common data once, serial per product group, paste/scan, live duplicate check, N/A and "later" as one tick, partial delivery.
* ERP copy with "data as of" line; PO draft prefill (vendor, cost centre, stock point, tax derived from PO total).
* Append-only ledger, name snapshots, server-side scope checks, serial uniqueness (UI + DB), single writer `apply_event`.
* Move/Dispatch scan-and-queue model; per-scan label printing for moves to stores.
* Soft deactivation everywhere; role re-read per request.
* The browser census of 26 routes as the Primary Owner and as the IT operator showed **no crash, no page-level horizontal overflow and no failed request except the ERP-reminders 503** of the sandbox; the problem is the operating model, not defects. (The viewer, Non-IT operator and ordinary admin were only logged in, not toured; the API-level role sweep is Appendix B.)

## Appendix A — Evidence list

Screenshots in the scratch UAT folder (not in the repo): PO review (3 lines), PO detail (6,453 px), delivery dialog, Add Asset, Move/Dispatch, Add User dialog, every route as the owner. Route-by-route DOM census printed for owner and IT operator.

## Appendix B — API-level role and validation UAT (117 calls by a background QA agent, sandbox only)

These are **defects, not simplification items**. They were found while testing the operating flows and are **not fixed** (this stage is read-only).
Finding 1 was re-confirmed by reading the source (`asset_users/router.py::reset_password` checks only that the target can log in, never that the target is a Primary Owner). The others are as reported by the agent with reproduction; each should be re-verified before its fix.

| # | Sev | Defect | Where (agent's pointer) |
|---|---|---|---|
| 1 | **P1** | An ordinary ADMIN can take over a Primary Owner: reset-password returns a temp password and the login works; PUT can demote the owner, DELETE can deactivate them. Defeats "masters and Import are owner-only" | `asset_users/router.py` reset/update/deactivate (no target check) |
| 2 | **P1** | One operator request can exhaust server memory: `POST /purchase-orders/{id}/lines` with `quantity` 1,099,511,627,776 pinned the API at 15 GB. `quantity` 0 or −3 returns 201 with no lines. Bulk move/action accept unbounded id lists | `PendingAssetLineIn.quantity`, `add_pending_asset_line` |
| 3 | P2 | IT/Non-IT work area is **not enforced on purchase orders, asset creation, delivery, ERP create, PI recording** — an IT operator can read, edit, deliver and create Non-IT assets (and the reverse); only asset reads/edits are scoped | `purchase_orders/router.py`, `procure_assets`, `erp/service.py::create_from_draft` |
| 4 | P2 | Movement-log and field-change exports ignore the work area (and include soft-deleted assets); the asset export is correct | `reports/router.py` |
| 5 | P2 | A lifecycle event's `to_asset_user_id` is applied even for events that have no destination (repair, lost); an ADMIN CORRECTION with a target moves custody without changing status (a disposed asset was handed to an employee); CORRECTION overwrites `status_since` | `lifecycle/service.py::apply_event`, `state_machine.py` |
| 6 | P2 | Blank / negative / absurd values accepted: blank invoice no, negative invoice amount, **blank serial creates an asset that is neither pending nor N/A**, serial cleared by PUT, negative cost/tax/warranty, empty description, empty or duplicate manual PO number, PO date 2099, correction date 1900 | request schemas in `purchase_orders`, `assets`; `check_serial_number_unique` |
| 7 | P2 | Deactivated records still accepted for new work (cost centre, category, sub-category, Item, vendor, holder); **a delivery was accepted onto a deleted PO**; deactivating a user ignores what they hold | `create_purchase_order`, `procure_assets`, `apply_event`, `_get_scoped_po` |
| 8 | P2 | PO delivery returns **500** for a future invoice date (the friendly message exists but the route catches only `ValueError`) | `deliver` route vs `LifecycleError` |
| 9 | P2 | ERP PO create trusts the client: wrong PO number with a real ERP code (then blocks the real PO), nonexistent ERP code accepted, 1000 lines at rate 0.0001; nonexistent vendor id reports "already created here" | `erp/service.py::create_from_draft`, `erp/router.py:314` |
| 10 | P2 | An ordinary ADMIN can replace the active asset-code rule with an unvalidated one (negative start, `{nonexistent.token}`); the next asset became `X-5` | `numbering` router/service |
| 11 | P3 | Oversized or malformed input (long text, NUL, 1e20 amounts, bad foreign keys, garbage Excel files on every import) returns a bare 500 "Internal Server Error"; no `DataError`/`IntegrityError` handler | across schemas |
| 12 | P3 | Nonexistent `vendor_id` / `brand_id` / company-access ids give 500 | PO/asset/line routes |
| 13 | P3 | Wrong or technical messages: duplicate email blamed on "code", missing parent blamed on "duplicate code", "unknown asset user type 'None'", internal ids in messages ("pending asset 218…"), "token 'subcategory.code' resolved to an empty value" at delivery, "item 62 not found" for an inactive Item, today's date rejected as "before the last event" | various |
| 14 | P3 | Data quality: blank/unbounded codes and names, no email or GSTIN format check, case-sensitive code uniqueness (`it` next to `IT`), SELF_SERVICE or STOCK_POINT with login, OPERATOR with no work area | masters, asset users |
| 15 | P3 | `q=%` / `q=_` match every asset (LIKE not escaped); 0-byte documents accepted; 100,000-character passwords; empty `lines` on deliver returns 200 | register, documents, auth, deliver |
| 16 | decision | An ordinary ADMIN is unrestricted across companies (created a CKVPL PO and asset from a CKSPL login). The code says this is intended; it should be confirmed against "assets belong to a company" | `scoped_company_ids` |

Checked and fine (agent): the role matrix on write endpoints (viewer denied everywhere, masters/imports/items/ERP links/stores/bundles owner-only, ADMIN denied on all of them); a purchase operator can run a PO end-to-end; cross-company reads/writes for CKSPL operators are blocked; serial uniqueness; edit/cancel of delivered lines refused clearly; ledger transitions, terminal states and future dates refused; login errors generic with lockout; token tampering gives 401; document storage safe; PO delivered counts match asset counts. Not covered: store users as targets, vendor change on a PO; the ERP reminders/PI endpoints answer 503 in the sandbox (no live ERP view), which looks like a sandbox limitation.

Side effects in the UAT copy only: heavy test-data pollution, an API restart after finding 2, UATNONIT locked and UATVIEW's password reset. None touched dev or production.
