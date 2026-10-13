# CKAM — Current vs Simplified Journeys (proposal, not implemented)

"Before" numbers are the measured/counted ones in `CKAM_COMPLEXITY_AND_FRICTION_AUDIT.md` §3 (M measured in the UAT copy, C counted from forms).
"After" numbers are **design targets** for the flows below, counted the same way (a dropdown = 3 clicks, a tick = 1, a button = 1). They are goals to verify in the S7 UAT, not measurements.

## 1. Summary table

| # | Task | Screens before → after | Clicks before → after | Typed fields before → after | Manual mappings before → after | Dead ends before → after |
|---|---|---|---|---|---|---|
| A | ERP PO, everything mapped | 3 → 2 | 3 → 3 | 0 → 0 | 0 → 0 | 0 → 0 |
| B | ERP PO, 1 unmapped Item (operator) | 3 → 2 | 6 → 6 | 0 → 0 (+2 if a new Item) | 1 → 1 (in the flow) | **1 → 0** |
| C | ERP PO, unmapped vendor | invisible PO, 4 screens → 2 | ~8 → 3 | 1 → 0 | 1 per supplier code → 1 (one tick offers the whole PAN group) | **PO invisible → listed with "match vendor"** |
| D | Manual PO: 10 laptops + 5 ACs | 2 → 1 | ~24 → ~12 | ~18 → ~9 | 0 (3 if masters missing) → 0 | 3 → 0 |
| E | Receive 10 serialised laptops | PO page, 1 dialog → Receive screen | ~14 → ~8 | 4 + 10 serials → 3 + 10 serials | 0 | 0 |
| F | Receive 50 non-serial chairs | 1 + dialog → 1 | ~53 → ~5 | 4 → 3 | 0 | – (UNUSABLE → EXCELLENT) |
| G | Receive 10 serial-later, enter serials later | 2 → 2 | ~24 → ~12 | 14 → 14 | 0 | – |
| H | Add 20 identical direct assets | 20 forms → 1 | ~200 → ~14 | ~180 → ~10 | 0 | – |
| I | Move 20 assets to a store | 1 → 1 | ~24 → ~8 with "Add by Item", or 24 by scan | 20 → 0–20 | 0 | 0 |
| J | Create vendor | 1 → 1 (or inline) | 4 → 4 (or 3 inline) | 6 → 2 (Code generated) | – | operator dead end → 0 |
| K | Create Item | 1 → 1 (or inline) | ~8 → ~6 | 3 of 8 → 2 (name + one "type of asset" pick) | 2 → 1 | operator dead end → 0 |
| L | Create stock room / employee / store | 1 → 1 | ~9 → ~6 | 5 → 3 | 3 → 1 (store auto-creates its stock room and install point) | – |
| M | Find an asset (serial, code, ERP code, Item) | 1 | 2 | 1 | – | by Item/ERP code impossible → 1 box |
| N | First-time set-up of one environment | 10 → 1 wizard (7 steps) | ~70 → ~40 | ~41 → ~28 | 8 → 4 | late errors → blocked at entry |
| O | Non-IT: 20 gondolas, 10 to Store A, install 5, keep 5 | ≈12 → ≈5 | ≈80 → ≈35 | ≈55 → ≈25 | 3 asset users for one store → 0 (auto) | – |
| P | IT: laptop → stock → employee → return → reassign | 4 → 3 | ≈45 → ≈28 | 25 → 14 | employee must pre-exist → inline | – |

Row F is the headline: **50 chairs from ~53 clicks to ~5**, because the user states a quantity on a *line* instead of ticking units.

## 2. Target flows (wire structure)

### 2.1 ERP PO — exceptions only (Journeys A, B, C)

```
Purchase Orders  [ + New ] [ Pick from ERP (12) ]
─────────────────────────────────────────────────────────────
Pick from ERP                                       ERP data as of 2:43 pm [Refresh]
 [Search PO / vendor]  Company ▾   Show: Ready (9) · Needs your input (3)
 SPO/012247  HARSHIT INFOSOLUTION  3 lines  ₹2,50,101   ✔ ready              [ Review ]
 SPO/012993  HARSHIT INFOSOLUTION  2 lines  ₹6,36,403   ● 1 vendor to match  [ Review ]
 SPO/00xxxx  BLUE STAR LTD (MP)    1 line   ₹…          ● vendor not in CKAM [ Match… ]   ← never invisible

Review SPO/012247  (Citykart Stores · Cost centre CKSPL · Into Farukhnagar stock room · Vendor Harshit)  ← one summary line, editable by [Change]
 ┌ 3 lines ──────────────────────────────────────────────────────────────┐
 │ ✔ Indoor Camera        50 × ₹2,890   18%   matched by code             │
 │ ● GANG BOX PVC 4X4     50 × ₹45      18%   New from ERP  [Pick Item ▾] [+ New Item]  [Not an asset]
 │ ● NETGEAR WAX610       4 × ₹16,300   18%   New from ERP  [Pick Item ▾] [+ New Item]  [Not an asset]
 └─────────────────────────────────────────────────────────────────────────┘
 Pick or create an Item for 2 lines, then:                     [ Create PO ]
 ▸ More details (barcode, brand, model, warranty, tax)  — prefilled from the ERP/Item, open only if you need to change them
```
* Matched lines are collapsed; only exceptions are open. "Remember" is **on by default for the whole ERP group** and spelled in words ("use this Item for every code in this group"); the choice is stored once.
* **+ New Item** opens a two-field dialog (name, type of asset) for Admin and Operator too (decision D1, plan §9). **Not an asset** is available to Admin and Operator for a line (stored as the same not-tracked rule).
* The PO summary replaces the line "104 lines added" with "PO created: 3 lines, 104 units waiting".
* Orchestration: one call "import this ERP PO" returns what was matched and what remains; vendor/Item resolution is the server's job (see plan S3).

### 2.2 Manual PO (Journey D)

```
New Purchase Order
 Company ▾ (only if >1)   PO No [     ]   Date [today]   Vendor ▾ [+ Add vendor]   Cost centre ▾ (last used)   Deliver to ▾ [+ Add stock room]
 Lines
  Item ▾ [+ New Item]      Qty    Cost/unit   Tax%
  Laptop                    10     55,000      18
  Split AC                   5     42,000      18
  [ + Add line ]    [ + Add set (bundle) ]
 ▸ More details per line: description, barcode, brand, model, warranty (prefilled from the Item; barcode generated)
 Total 15 units · ₹10,17,000                                   [ Save PO ]
```
One screen, no second trip to a detail page. Category, Sub-Category, work area and serial rule come from the Item and are shown as a read-only chip.

### 2.3 Receive (Journeys E, F, G)

```
Receive                                   [Search PO / vendor]  Waiting (4) · Partly received (2)
 SPO/012247  Harshit  waiting: 104 of 104     [ Receive ]
─────────────────────────────────────────────────────────────
Receive SPO/012247 — Harshit Infosolution — Farukhnagar stock room
 Received into [Farukhnagar stock room ▾]   Invoice no [   ]  Invoice date [today]  Invoice amount [   ]   ← entered once
 ┌ Item               Ordered  Received before  Waiting  Receiving now │ Serial rule    │
 │ Indoor Camera         50          0             50    [ 50 ] ▲▼ (default = all)  Has serial   ▸ enter 50 serials
 │ Gang box PVC          50          0             50    [ 50 ]                      No serial
 │ Netgear WAX610         4          0              4    [  4 ]                      Serial later
 └───────────────────────────────────────────────────────────────────────────┘
 Serials for Indoor Camera (50 of 50):  one box, paste or scan, live count, duplicate warnings per line, "which unit got which" preview
 ☐ Leave units without a serial waiting       Print labels after saving ☑
                                                         [ Receive 104 units ]
 Result: 104 assets created · labels ready [Print] · open assets · history written.   Errors list the exact units and serials that failed; the rest are saved (see plan S4).
```
* Quantity is a number per line (default = everything waiting); no ticking of units. A line's serial rule is read from the Item: *Has serial* shows the serial box; *No serial* needs nothing; *Serial later* needs nothing (the unit appears in Serial pending).
* Keyboard: Tab through the common fields, Enter in the serial box adds a line, Ctrl+Enter receives.
* Same screen works for 1, 10, 50 or 100 units. "Why is Receive disabled?" is always printed next to the button.

### 2.4 Item and vendor mapping — resolve once, remember forever (admin inbox)

```
ERP inbox (head-office admin)                  5 new items · 1 new vendor · 2 new stores
 New items from ERP (ERP group "FA_CE_WIFI ROUTER" — NETGEAR WAX610 …)       seen on SPO/012247
    Suggested Item: Wifi Access Point  (92% match)   [ Use suggestion ] [ Pick another ▾ ] [ + New Item ] [ Not an asset ]
 New vendors from ERP (BLUE STAR LTD (MP) · GSTIN 23AAACB4487D1Z0 · same PAN as BLUE STAR LIMITED)
    [ Link to Blue Star Limited ]  (also 11 other Blue Star registrations — link all)  [ Create new vendor ]
 New stores from ERP  LAM, PTS …                [ Create 2 stores ]  (creates store + its stock room + install point)
```
Rules: item decisions are by ERP group by default and per code only when the user chooses; nothing is shown that is not on a real PO or a new ERP master row.
Operators resolve the *same* exceptions inside the PO review (2.1); the inbox is the head-office admin's cleanup view. Items also show an **ERP codes** tab (what is linked, unlink, add) — already built.

### 2.5 Category / Item setup

```
Settings › Catalogue › Items            [ + New Item ]
 New Item:  Name [Laptop]   Type of asset ▾ (shows "IT Fixed Assets › Laptop" ; [+ New type])   Serial: (●) Has serial ( ) No serial ( ) Read later
            ▸ More: default brand, warranty, "comes as a set" (parts), ERP codes
```
Category and Sub-Category are chosen as one "type of asset" (a combined list); the work area comes from the Category. Creating a Category (name + work area) takes one dialog and < 1 minute.

### 2.6 Vendor setup

```
Vendors [ + Add vendor ] [ From ERP ]
 Add vendor: Name [ ]  GSTIN [ ] (optional; validated)   — Code generated automatically (editable under More)
 From ERP: grouped by company and PAN: "Blue Star Limited — 12 registrations in Citykart Stores"  [ Add one vendor and link all 12 ]
```
< 1 minute; never required for a PO to be listed.

### 2.7 People & Places

```
People & Places › Stock rooms [ + Add stock room ]    Name [HO stock]  Company ▾  Place/Location [HO ▾ or type new]   (code generated)
                 › Employees   [ + Add employee ]     Name Code Department Phone ☐ Can sign in → Email, Role in words, Work area, Companies
                 › Stores      [ From ERP ]           creates store + stock room + install point (+ login if wanted, password set once in bulk)
                 › Install points
```
Types disappear as a dropdown; the menu is the type. IT/Non-IT **work area** appears as a field (today missing).

### 2.8 Direct Add asset (Journey H)

```
Add assets
 ESSENTIAL   Item ▾ [+ New Item]   Quantity [20]   Into [stock room ▾]        Cost centre ▾ (last used)
 IDENTIFICATION  (appears by serial rule)   Serials: paste 20 lines  |  ☐ no serial  |  ☐ add later     Brand · Model
 PURCHASE (optional ▸)  Vendor ▾ · PO no · Invoice no/date/amount · Cost · Tax
 ADVANCED (▸)   Warranty · Custom fields · Legacy code · Barcode
                                                         [ Add 20 assets ]  → labels offered
```
Description defaults from Item (+brand/model); barcode defaults to the Item's code or is generated; the 22 fields become 4 essential + 3 conditional.

### 2.9 Assignment, return, installation, repair, scrap, movement (one Move screen, plain words)

```
Move
 What do you want to do?  ( ) Give to a person   ( ) Return to a stock room   ( ) Send to a store / install   ( ) Send for repair / back from repair   ( ) Report lost   ( ) Sell / scrap
 Add assets:  [ scan or type serial / asset code / description ]   or  [ Add 20 of ▾ Item ] [ from ▾ stock room ]
 To:          [ person / store / stock room ▾ ]  (list shows name · place · company)
 ☑ Print labels as I scan   ▸ Label settings
                                                         [ Move 20 assets ]
```
The eight actions stay (the lifecycle table is unchanged); wording replaces "Move / Allot / Transfer". Register bulk-move and Asset 360 buttons open this same screen pre-filled instead of three field sets. Event date and reference number become optional fields everywhere.

### 2.10 Find an asset
One search box on Assets and in the header: serial, asset code, barcode, ERP code, Item, vendor, PO number, holder; "More filters" holds status, group, company, work area. Item and PO become columns.

### 2.11 Import
Settings › Advanced › Bulk import; unchanged functionality; on Add assets a "Paste from Excel" shortcut covers the common case without leaving the flow.

## 3. Current → target at a glance (per task asked in the brief)

| Task | Current flow (steps) | Main problem | Target flow | Reduction |
|---|---|---|---|---|
| Category setup | Categories → Add (3 fields) → Sub-Categories → Add (3) → Items → New Item (8) | three levels the user never uses on an asset | Item dialog with "type of asset" pick; [+ New type] inline | 3 screens → 1; ~14 fields → 3 |
| Vendor setup | Vendors → Add (6 fields) or Add from ERP → per company → per supplier; operator cannot | duplicates per GST state; owner only | in-flow Add vendor (2 fields) + PAN-grouped ERP link | operator dead end → 0; 12 links → 1 |
| Asset user setup | Asset Users → Add (Company, Type, Location, Code, Name, Dept, Phone, login, email, role) | raw types, no work area, 3 holders per store | People & Places menu per type; store creates its rooms | 10 fields → 3–5; raw words → plain |
| Direct asset entry | Add Asset 22 fields × N | one per save | Add assets with quantity | N forms → 1 |
| PO creation | header → detail → line form per line | repeats description/barcode; 104 rows | one-screen lines table | 2 screens → 1; ~24 → ~12 clicks |
| PO delivery | tick units → dialog | unit rows; all-or-nothing | Receive screen with line quantities | 53 → 5 clicks for 50 units |
| Asset assignment | Move/Dispatch (12 controls) or Asset 360 | four paths | one Move screen | 4 paths → 1 |
| Asset return | Move to a stock room | wording "Move / Allot / Transfer" | "Return to a stock room" | clarity |
| Installation | needs an *install point* asset user per store (manual) | hidden prerequisite | store auto-creates install point | 1 manual setup → 0 |
| Repair / scrap | Asset 360 buttons or Move action | scattered | same Move screen | – |
| Import | `/import` in the Assets group | owner only; far from the task | Settings › Advanced + paste shortcut | – |
