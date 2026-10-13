# CKAM — Simplified Operating Model (proposal, not implemented)

Written in business language on purpose. Nothing here changes the database or the strict rules underneath
(see §10 "What stays"). Evidence is in `CKAM_COMPLEXITY_AND_FRICTION_AUDIT.md`.

## 1. The whole product in four sentences

1. We **buy Items from Vendors** on a **Purchase Order**.
2. When goods arrive we **Receive** them into a **Place**; every unit becomes an **Asset**.
3. An Asset is always **with someone or somewhere** (a person, a store, a stock room, an install point); we **Move** it until it is scrapped or sold.
4. Everything we ever did to it is kept in its **History**.

A CityKart employee should be able to explain CKAM with exactly these nouns: **Item, Vendor, PO, Place, Person, Asset.**
Anything else (Article, Section, mapping rule, Category, Sub-Category, Asset User type, responsibility snapshot, pending asset, code rule, bundle part) is
either a *setting for the head-office admin* or *invisible*.

## 2. The six things people do (the whole daily menu)

| Verb | Who | One-line promise |
|---|---|---|
| **Buy** | purchase | pick an ERP PO (or write one) → review only the problems → save |
| **Receive** | delivery | open a waiting PO → say how many arrived → serials → done; assets, labels and history appear by themselves |
| **Add** | IT / Admin | add assets that did not come on a PO, many at once |
| **Move** | warehouse / IT / admin | scan or search, choose where, confirm; allot, return, install, repair, scrap are choices of the same screen |
| **Find** | everyone | one search box for serial, asset code, barcode, ERP code, Item, vendor, PO, holder |
| **Print** | everyone | "Print labels" wherever assets are shown or just created |

## 3. One mental model for Item, ERP Article, PO line, pending unit, Asset

| Word the user needs | What it is | Everything behind it (hidden) |
|---|---|---|
| **Item** | *what we buy and manage* ("Cassette AC", "Laptop"). It decides its group (category), whether it has a serial number, brand/warranty defaults, and whether it comes as a set | Category, Sub-Category, Responsibility (IT/Non-IT), serial policy, bundle, default brand, default warranty |
| **PO line** | "10 Laptops at ₹55,000" | ERP code, tax, barcode, one pending row per unit |
| **Waiting for delivery** | the units of a PO not yet received | `pending_asset` rows |
| **Asset** | one physical unit | asset code, ledger, snapshots, procurement copy |
| *(not a user concept)* ERP Article / code | finance's grouping and per-vendor code | an ERP code is just an alias of an Item, remembered forever |

Rule: **a daily user never sees "Article", "mapping", "pending asset", "Sub-Category" or "Responsibility".**

## 4. Remember once, never ask again

Every relationship below is asked **at most once**, only when it is actually needed on a real PO, and remembered.
The head-office admin may review or undo it later in one inbox; nobody has to pre-configure it.

| Remembered | Today | Proposed |
|---|---|---|
| ERP supplier → CKAM vendor (per company) | owner links each of 146 suppliers one by one, per company; POs of unlinked vendors are **invisible** | automatic when GSTIN/PAN matches; the PO list shows "3 POs wait for a vendor match" (never invisible); one-time "Create vendor / Link to…" at the moment of need; all registrations of one PAN offered together |
| ERP item code → Item | 850 undecided codes; 5 screens | only the codes on a PO being reviewed are ever asked; **"New Article from ERP: create an Item or pick one"**; the answer covers the whole Article by default and is remembered |
| Item → group, serial rule, brand, warranty | on the Item (already) | on the Item, applied **everywhere** (today the manual PO line and Add Asset ignore some of it) |
| PO → vendor, cost centre, stock room | partly (ERP draft) | all inherited by every delivered asset; asked once on the PO |
| Receipt → invoice no/date/amount, received-into place | once per delivery (good) | once per receipt, **place prefilled from the PO** |
| Cost centre per company, last used place | typed each time | defaulted; changed only when different |
| Asset → Item | only new assets; all 53 existing assets in dev have none and **no API can link them** | a one-time "Link existing assets to Items" tool |

## 5. Exceptions only

The old design asks the user to *configure* (every code, every vendor) before work. The new one lets the user *work*, and puts
only the unresolved things in front of them:

> **ERP PO SPO/012247 — 3 lines.** 1 Item matched automatically · **2 need an Item** · vendor matched · cost centre matched · delivered to Farukhnagar stock room.
> [ Choose / create Item ] for each of the two → **Create PO**.

The same idea gives the head-office admin an **ERP inbox** with three counters: *New items from ERP · New vendors from ERP · Stores not yet created* — never a list of 850.

## 6. People and places (one backend entity, four natural screens)

Keep the unified `asset_user` table. Present it as:

| Menu | Creates | The user thinks |
|---|---|---|
| **Employees** | type EMPLOYEE (+ login if wanted) | "add an employee" |
| **Stores** | type STORE (from ERP, with email rule `sm.<code>@citykartstores.com`) | "add/update a store" |
| **Stock rooms** | type STOCK_POINT | "add a stock room (HO stock, warehouse)" |
| **Install points** | type INSTALLED | "add where things get installed" |

A store creates its own stock room and install point automatically (one store = 3 holders today; the user should never have to know). Logins are a toggle on an Employee or Store:
role in plain words (*Full admin / Can add and move assets / Can only view / Sees own assets*) and **work area** (IT team / Admin team / Both) — the field that is missing from the form today.

## 7. Receipts as a first-class idea

Today "receive" is a button on a PO page of one-row-per-unit. In the new model:

* A PO page shows **lines** with *ordered · received · waiting*, not units.
* There is a **Receive** queue (home tile and menu): POs with goods waiting.
* A receipt records the *common* things once (received into, invoice no/date/amount) and a **quantity per line**; serial entry appears only for lines that need it; "same serial rule for all" is the default.
* Behind it nothing changes: it still calls the deliver orchestration that writes asset, ledger event, procurement link, vendor, invoice and place.

## 8. Roles in business terms

| Role (as shown) | Can do | Notes |
|---|---|---|
| Head-office admin (Primary Owner) | everything incl. company, code rule, custom fields, imports, access | one or two people |
| Admin | all daily work, users, create vendor/brand/Item/stock room **in the flow** | today an ordinary ADMIN cannot even create a vendor |
| Operator (IT team / Admin team) | all daily work **within their work area**; may create a vendor, brand, Item or stock room **while doing a PO or receipt** (small records only) | today a dead end |
| Viewer | read | |
| Employee / Store login | own assets only | |

This is the one change that touches permissions: allow *in-flow creation of small master records* for Admin and Operator
(vendor, brand, Item, stock room, cost centre), keep editing/deactivating and the heavy masters (company, category, code rule, custom fields, imports, ERP rules) with the head-office admin.
Backend authorization stays authoritative; the existing but unused `operator_can_manage_masters` setting is the natural switch. **Needs the owner's decision (see implementation plan).**

## 9. Setup is a one-time guided job, not a menu

* **Set up CKAM** wizard for a new company: Company → Places (stock room) → Cost centre → Asset groups & first Items → Vendors → People → *Asset code format* (with a live example). 7 steps, each ≤ 1 minute, nothing to remember afterwards; the same pages remain available under Settings.
* After set-up, daily users never open Settings. The head-office admin opens it for exceptions (ERP inbox, new store, new group).
* Advanced (custom fields, code rule, imports, ERP connection) is separate and labelled so.

## 10. What stays exactly as it is

Append-only ledger and field-change audit · one writer of status/holder (`apply_event`) · server-side role, company and work-area checks · serial uniqueness (UI + DB) · assets move only inside their company ·
no hard deletes · Alembic discipline · ERP copy and the "data as of" line · Item as the identity of an asset (never an ERP code) · PO ↔ asset links, vendor and invoice snapshots · soft-deactivate everywhere.
The redesign changes **where the user clicks and what the screen asks**, not what the system guarantees.

## 11. Design principles used (from the brief) and how this model meets them

| Principle | Where |
|---|---|
| One application, task-based | six verbs; Home tiles |
| Daily work first, configuration second | menu split in IA report |
| Enter once, derive everything possible, system makes links | §4, §7 |
| Create masters inline where safe | §8 |
| Advanced hidden from normal users | §9 |
| Minimum clicks, batch for high volume | quantity on receipt and Add; scan batches |
| Business language only | §3, §6, audit §6 |
| Backend complexity does not leak | pending asset, rules, snapshots invisible |
| Auditability and security stay server-side | §10 |

## 12. Quality bar this model is designed to hit (directional)

Create a vendor < 1 min · basic category < 1 min · normal PO < 3 min · receive 10 serial assets < 5 min · receive 50 non-serial assets in one receipt (no per-unit dialogs) ·
find an asset < 30 s · move or allot < 1 min · no database knowledge needed by anyone except the head-office admin's occasional ERP exceptions.
