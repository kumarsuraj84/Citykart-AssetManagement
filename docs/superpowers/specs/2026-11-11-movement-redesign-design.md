# Movement redesign — simple Move, repair vendors, moves between companies, owner correction

| | |
|---|---|
| Status | Owner approved 2026-11-11. **Release 1 built** (`697cc9f`, pushed, not deployed). **Release 2 built locally** (see decision 14 in `DECISIONS.md`; migration `d7f9b1c3e5a7`). **Release 3 built locally** (decision 15; migration `e8a0c2d4f6b8`). Production runs `0b8c525` |
| Owner decisions | 2026-11-11, in chat (listed in section 1). They override older text in `ITEM_MODEL.md`, `CKAM_FINAL_OPERATING_MODEL.md` §9–§10 and the "assets move only within their own company" rule |
| Rules that still hold | `CLAUDE.md`: backend authorisation is authoritative; `lifecycle/service.py::apply_events` is the only writer of status / holder / status date; the ledger is append-only; every schema change has an Alembic migration; no hard deletes |

## 1. What the owner decided

1. **Choose only where an asset goes.** CKAM already knows where it is now and shows it as "From". Places: **Employee**, **Store**, **Site** (HO site, warehouse site: an Install Point), **Stock Point** (HO Stock, WH Stock). Plus the **repair vendor**, outside CityKart.
2. **Eight choices**, not eleven: Give to Employee · Give to Store · Install at HO / Warehouse · Move to Stock Point · Send for Repair · Receive from Repair · Report Lost / Mark Found · Sell / Scrap / Dispose. "Send to HO" / "send to WH" does not exist: it is either *Install at HO / Warehouse* (a site) or *Move to Stock Point*. A store is given things ("Give to Store"): the store uses them, with no separate install step.
3. **Repair names the vendor.** Send for Repair asks for the vendor; the asset shows as "With vendor, under repair"; CKAM shows how many assets each vendor has and for how long. **Receive from Repair asks every time**: *put it back where it came from*, or *another place* (a stock point, employee, store or site: anywhere). No hidden default.
4. **Assets may move between CKSPL and CKVPL.** Two separate ideas: **Owned by** (company and cost centre; fixed from the purchase until sold, scrapped or disposed) and **Where it is** (any place of any company).
5. **Owned-by correction.** If someone chose the wrong stock point or company while inwarding, **the platform owner (head-office admin) and Full Admins** may correct the owner company and cost centre, with a mandatory reason and a history entry. Nobody else, no other way.
6. Install Points are used for HO and warehouse sites: **one Install Point per site**. Repair vendors are **places** in CKAM (not just a note).

## 2. How it works today (checked in the code, 2026-11-11)

- Move has 11 choices (`frontend/src/features/assets/actionRules.ts`). The "from" is never chosen: `apply_events` records the asset's current holder (`from_asset_user_id`).
- The only "from" box is **Add by Item**, "Currently in stock at": `GET /api/assets/pick` is limited to stock rooms and `IN_STOCK` (`assets/tools_router.py`).
- A store is created with **three places**: the Store (status *With Store*), its Stock Room `STK-<code>` and its Install Point `INS-<code>` (`asset_users/store_rooms.py`). That is why *Send to Store*, *Install* and *Move to Stock Room* overlap.
- `SENT_FOR_REPAIR` has no destination and no vendor; the asset keeps its last holder with status `UNDER_REPAIR`. `RECEIVED_FROM_REPAIR` may go to any place.
- `apply_events` refuses a destination of another company ("Assets can only move within their own company", `lifecycle/service.py`).
- `asset_code`, `company_id` and `cost_center_id` cannot change: DB trigger `trg_asset_no_identity_change`. The existing correction feature touches only category, sub-category and purchase date (`assets/correction_service.py`).
- Company limits are applied by `scoped_company_ids` in about 50 places, always as "the asset's owning company is one of mine".
- Production holds **no assets, POs or saved Asset Code Format** yet, so nothing needs converting.

## 3. Design

### 3.1 The eight choices

| Choice | Goes to | Result status | Notes |
|---|---|---|---|
| Give to Employee | an Employee | With Employee | from any place |
| Give to Store | a Store | With Store | the store's own `STK-` / `INS-` rooms are not offered |
| Install at HO / Warehouse | an Install Point that is not a store's own | Installed | picker shows only real sites |
| Move to Stock Point | a Stock Point that is not a store's own | In stock | |
| Send for Repair | a repair vendor (place) | Under repair | vendor required; reference no. and remarks as today |
| Receive from Repair | asks: *back where it came from* or *another place* | per destination | see 3.4 |
| Report Lost / Mark Found | nowhere / a Stock Point (admin) | Lost / In stock | unchanged |
| Sell / Scrap / Dispose | nowhere | final | unchanged |

- **A store's own rooms** are recognised by their code: `STK-<code>` / `INS-<code>` where `<code>` is an existing Store's code. They stay for receiving a PO "into the store" but are hidden from these pickers.
- **From is always visible**: every queued asset shows "From: <place>"; above Apply a summary reads "3 from WH Stock, 2 from Ramesh". A mixed batch is fine (the existing per-asset validity rule stays).
- **Add by Item**: the box becomes **Currently with** and accepts any employee, store, site or stock point; `GET /api/assets/pick` loses the stock-room-only and `IN_STOCK`-only limits (it still takes the oldest N of that Item at that place, within the caller's scope, and only assets that may take the chosen choice).
- `Install` for stores disappears from the buttons. Existing `INSTALLED` assets and the status stay valid.

### 3.2 Install Points as sites

Create one Install Point per HO / warehouse site in Settings › Users & Access › Install Points (the screen exists). No code is needed for creating them; the picker filter in 3.1 is the change.

### 3.3 Moves between companies

- Remove the "own company only" refusal in `apply_events`. The mover must be allowed to work in **both** the asset's owning company and the destination's company (`scoped_company_ids`; the head-office admin always is). A person limited to one company can still move only inside it.
- `Asset.company_id` and `cost_center_id` do not change on a move: the asset stays **owned by** its purchase company.
- **Views:** asset list, Asset 360 and reports show **Owned by** (company, cost centre) and **Currently at** (place and its company); filters for both. Finance reports use *Owned by*, operations use *Currently at*.
- **Visibility, version 1:** staff who work in both companies see and move everything; a login that is "Own Assets Only" always sees what is with them. A single-company OPERATOR does not yet see another company's asset sitting at their store (that touches all ~50 company-limited queries). To be extended later if needed.
- Receiving: the company and cost centre of an asset come from the PO / the form, shown on the Receive and Add Assets screens as "Owned by CKVPL · cost centre X"; the Received-into place may belong to either company.

### 3.4 Repair vendors as places

- New place type **repair vendor** (`asset_user_type = 'REPAIR_VENDOR'`), created automatically (code `RPR-<vendor>`, name "<Vendor> (repair)") the first time a vendor is chosen, in the asset's owning company; never signs in; reuses the existing Vendor master (Vendor id kept on the place).
- State machine: `SENT_FOR_REPAIR` now **requires** a repair-vendor destination; the asset's holder becomes the vendor place and its status `UNDER_REPAIR`. `RECEIVED_FROM_REPAIR` leaves a repair-vendor place for any place. Old events without a vendor stay valid (history unchanged).
- **Receive from Repair** screen: pick the vendor, the list shows only that vendor's assets, tick what came back, then **ask**: *Put each back where it came from* (the `from` of its last `SENT_FOR_REPAIR` event; if that place is inactive, ask for another) or *Choose another place*. Optional reference no. / remarks.
- **Repairs screen** (Work › Repairs): one row per vendor: assets with them, oldest days, a link to the list and to *Receive from Repair*.
- Found / lost, sell, scrap and dispose stay as they are; an asset under repair can still be scrapped.

### 3.5 Owner company and cost centre correction

- New admin action **Correct owner company / cost centre** on Asset 360 (platform owner and Full Admin, within their companies), reason mandatory, not available for sold / scrapped / disposed assets.
- Writes one history row (who, when, old and new, reason) in the asset's ledger as a `CORRECTION` note plus an audit row; cost centre must belong to the chosen company.
- **Database:** the trigger `trg_asset_no_identity_change` keeps refusing `asset_code`; for `company_id` and `cost_center_id` it allows a change only inside a transaction that carries a transaction-local marker (as `ckam.lifecycle_writer` does), set only by this one function. New migration, with a test that every other path is still refused.
- **The asset code never changes.** So the Asset Code Format (not saved yet) must not contain the company or the cost centre, or a corrected asset would carry a wrong code forever. Recommendation: asset group + running number (for example `IT-LAP-000123`). This is an owner choice at Settings › Advanced › Asset Code Format and not part of this build.

## 4. Release plan (each release tested, deployed only on the owner's exact approval sentence)

| # | Release | Contents | Database change |
|---|---|---|---|
| R1 | **Simple Move** | 3.1 and 3.2: eight choices, From shown and summary, hidden store rooms, Add by Item from any place | none |
| R2 | **Between companies + owner correction** | 3.3 and 3.5: cross-company moves, Owned by / Currently at, correction action, trigger exception | one migration |
| R3 | **Repair vendors** | 3.4: repair places, Repairs screen, ask-every-time return | one migration |

Order is by risk and value: R1 fixes the daily confusion first and changes no data rules. R2 comes before R3 because purchases in CKVPL given to CKSPL are a day-one case.

## 5. Tests (each release)

- Backend: the state machine for every choice and status; each of the six place types as source and destination; cross-company allowed for a both-company mover and refused otherwise; trigger: correction allowed only through the one function, refused through any other path; repair round trip (send, vendor count, return to origin, return elsewhere, origin inactive); `pick` from any place within scope; scoping of every new query; audit and history rows.
- Frontend: the eight buttons and their pickers, From summary, hidden store rooms, Receive-from-Repair question, correction dialog.
- Browser journey: receive in CKVPL → give to a CKSPL employee → send for repair → receive back to a stock point → move to a store.
- `tsc`, full pytest and vitest suites before every commit.

## 6. Not in this work (noted)

A single-company operator seeing another company's assets at their places; delivering a PO straight to a store; ERP packet reference; a "back to the same place" shortcut for Sell / Scrap.

## 7. Open points for the owner

1. **Visibility version 1** as in 3.3: both-company staff and "Own Assets Only" only. Is that enough to start?
2. **Asset Code Format** without the company and the cost centre (3.5): agreed?
