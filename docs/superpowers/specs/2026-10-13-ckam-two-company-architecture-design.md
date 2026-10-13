# CKAM for two companies: the recommended architecture (proposal, not built)

Status: **proposal, waiting for the owner's approval.** Written 2026-10-13 after reading the ERP warehouse (silver and gold, both
companies) and the CKAM code. The owner said the current architecture may change; production holds **no data yet** (0 categories,
items, assets, POs), so reshaping now costs development time only, never a data migration.

## 1. What the business needs (in the owner's words, condensed)

- Two companies (CKSPL, CKVPL) buy the same articles from the same vendors, each with its own ERP codes.
- POs come from the ERP with their lines; they get edited (lines, vendor) or cancelled in the ERP, and CKAM must follow.
- Delivery is marked with serial numbers where the item has them.
- Products go warehouse -> location (mostly CKSPL), are installed there ("allotted to that location user"), and can be allotted to people.
- Every store has a mailbox named by its location code and logs in with it; HO and WH have no location mailbox (normal users);
  staff have their own emails.

## 2. What the ERP gives (checked 2026-10-13, read-only)

| Subject | CKSPL | CKVPL | Where |
|---|---|---|---|
| PO lines (status, qty, rate, tax, delivery site) | 13 k fixed-asset lines | 856 lines, ~500 POs, newest 2026-10-09 | CKSPL `gold_ckam.po_line`; CKVPL `silver.ckp_po_line` |
| Vendors with GSTIN | 13,231 (5,717 with GSTIN) | 904 (402) | `silver.ckp_vendor` |
| Items | 632 k (3 k fixed assets) | 1,173 (693 fixed assets) | `silver.ckp_article` |
| Sites | 300 active stores, ~11 WH, 5 HO | HO + 5 WH | `silver.ckp_site` |
| Purchase invoices | 826 k lines; linked to PO through the goods receipt | 2,905 lines, **no** PO link | `silver.ckp_pi_line` + `fact_grc_line` |
| Transfers, challans, store receipts | yes (partly) | none readable | silver / gold_dc |
| Location or staff emails | none | none | (created in CKAM) |

Facts that shape everything:
- Item codes never repeat across companies (`CT...` / `CV...`). **Vendor codes repeat and mean different vendors** (690 of them);
  271 real vendors exist in both (same GSTIN). **Site codes repeat** (1 to 24).
- The store's ERP short name (`LAM`, `LAD`, `ALC`) is the location code; POs can be delivered straight to a store (232 delivery locations).
- ERP is loaded **once a day**, so live queries buy no freshness.
- Large ERP tables time out; the link to the ERP also dropped for about a minute during the last deploy.
- Rule used everywhere below: every ERP code is the pair **(company, code)**.
- More read on 2026-10-13: **the ERP holds no serial numbers, brand, model, warranty or fixed-asset register** in any readable layer (the
  only "department" is the item hierarchy), so CKAM is the only place those facts will live. The warehouse stock snapshot has no fixed-asset
  rows, so there is nothing to reconcile warehouse stock against. PO numbers: CKSPL `GPO/#/#-#` (348 open) and `SPO/#/#-#` (154) plus 48
  open POs numbered "Automatic"; CKVPL `PO/#/#-#`; `po_code` never repeats across the companies, but the key in CKAM stays (company, code).
  `silver.dim_employee` holds employee no, name, designation, department and location but **no email** (personal data: only with an
  explicit decision, e.g. to pre-fill people users).

## 3. Three ways to get there

| | What | Verdict |
|---|---|---|
| A. Patch | Keep today's design; add a vendor link table and a CKVPL query | Fast, but ERP stays a live dependency, CKVPL is a special case, and "sent but not received" stays untracked |
| **B. Reshape the weak parts (recommended)** | Keep what is strong (ledger, Item model, labels, roles); change 5 things (section 4) | A few weeks of work, no data to migrate, fits the business exactly |
| C. Rewrite | Start over | No: the ledger, Item model, serial rules, labels, movement screen are good |

## 4. The recommended architecture: keep 6 things, change 4 (Change 4 was dropped, see below)

### Keep (already good)
1. Append-only asset event ledger and the one state machine.
2. Category > Sub-Category > Item, serial rule on the Item, Serial Pending, bundles.
3. Per-company ERP item rules (Article / name / code -> shared Item).
4. Label printing (70x20 mm, QR + code) and the merged Move / Dispatch screen.
5. Roles, company and IT / Non-IT scoping, "Asset User" as the holder of an asset (this matches how the owner thinks:
   a store *is* a user, an asset is "allotted to LAM").
6. ERP change check with manual confirm.

### Change 1: a local copy of the ERP data (the foundation)
Today CKAM asks the ERP live and keeps one baseline per PO. Instead:
- A nightly **sync job** (runs after the ERP's own daily load, found in `meta.load_status`) copies the slices CKAM needs into CKAM's own
  tables: `erp_po_line`, `erp_vendor`, `erp_item`, `erp_site`, `erp_pi_line`. Same tables for both companies (a `company_id` column);
  fixed assets only; PO lines of the last ~18 months plus all open ones; vendors and items referenced by them; all sites.
- Each row keeps `first_seen`, `last_seen`, a content hash, and `is_present`. A changed hash is a **change event**; a row that vanished
  or turned CANCELLED is a cancellation. This replaces the baseline table and makes the PO change check automatic and instant.
- Screens read the copy, never the ERP. The ERP can be down, slow or change its views and CKAM keeps working ("as of 06:10 today").
  A "Refresh now" button runs the same sync for one PO.
- **Silver only (owner decision 2026-10-13):** the gold layer for CKAM does not exist yet beyond `gold_ckam.po_line`, so the sync reads
  `silver.ckp_po_line`, `ckp_pi_line`, `ckp_vendor`, `ckp_article`, `ckp_site` for **both** companies with one query shape (company
  column). Measured: CKSPL fixed-asset PO lines since 2025-04 = 18 k rows in 10 s, open ones in 0.2 s, invoices 2.7 s: fine for a nightly
  job (impossible for live screens, which is another reason for the local copy). When gold views arrive the owner will tell us and we
  change one query. CKAM never writes to the ERP.
- Nothing personal is copied (no employees, no finance).

### Change 2: one rule for linking ERP codes to CKAM records
`(company, ERP code)` -> CKAM record, with a confirm-once screen, for all four kinds:
- **Vendor** (`vendor_erp_link`): one CKAM vendor, one link per company. Unknown supplier: CKAM suggests vendors with the same GSTIN,
  then the same name; the Primary Owner confirms once. Spend reports can then add both companies per vendor.
- **Item**: already built (per-company rules).
- **Site -> Location** (`location.erp_site_code`): the store/WH/HO the ERP names becomes a CKAM Location of that company.
- Delivery location of a PO line is resolved the same way.

### Change 3: places are first-class (Location grows up)
Location gets a `kind` (STORE, WAREHOUSE, HEAD_OFFICE, OTHER) and `erp_site_code`. Then:
- **"Create stores from ERP"**: one STORE user per active ERP store with `code = ERP short name` (LAM...) and
  **`email = sm.<code in lower case>@citykartstores.com`** (owner's rule: all sites except HO / WH / Training Room; codes are 3 letters,
  one has 4: `SPR2` -> `sm.spr2@citykartstores.com`). ERP has no emails, so the rule is the only source.
  Checked against the ERP (2026-10-13): of 300 CKSPL sites of kind STORE, 276 have exactly 3 letters; 24 have other shapes (SPR2 and
  NSO1 are real-looking; the rest are DUMMY / test / `xx` / closed). So the button creates users only for codes of 3 letters or
  3 letters + 1 digit whose ERP store status is active, and lists the others as "skipped, please review" for the owner to include or ignore.
  Re-running adds only new stores. No duplicates exist among active short names. The store logs in with that email (login by code or email
  already works) as a self-service user: it sees only what is allotted to it (read-only; it confirms nothing).
- **HO, WH and Training Room** (no location mailbox; the ERP has no Training Room site): created by hand, two holders each: **stock
  point** (spares, status In stock) and **in use** point (equipment installed there, status Installed). Plus normal named users.
- **People**: own email, own login; a person in both companies gets one user per company plus the existing company-access grant.
- A new store opening in the ERP shows up in a "new stores" list; one click creates its user.

### Change 4 (DROPPED by the owner, 2026-10-13): no in-transit, no receipt step
Owner decision (option B): **the store does nothing in CKAM.** Moving assets to a store user allots them directly, exactly as the merged
Move / Dispatch screen does today (one MOVED event per asset). No In-transit status, no dispatch-note header, no store confirmation, no
"not received" alerts. Anything the ERP says about the packet is shown to the dispatcher as read-only reference (step 7), nothing more.
- **Straight-to-store deliveries matter instead:** in the last 6 months 3,223 of CKSPL's fixed-asset PO lines (568 POs) were delivered
  directly to a STORE, 3,258 (1,010 POs) to a warehouse, 15 to HO. So the delivery screen must accept a store user as the delivery
  location and allot the delivered assets to it in one step (already possible for a Stock-point/Store holder; to be verified and tested).
  CKVPL deliveries are HO (300 POs) and warehouses (200 POs).

### Change 5: owner company is not the same as where it sits
An asset belongs to the company that bought it (books, asset code). Today it can only move to holders of that company. Recommended:
an asset may sit with a holder of **another** company when the person moving it can act in both; it stays owned by the buyer and is
flagged "inter-company use" in the register, so reports can be cut by *owner company* and by *location company*.
**Decided 2026-10-13: yes, both ways.** A CKSPL asset can be allotted or installed to a CKVPL user or location, and a CKVPL asset to a
CKSPL user or location. The "only within its own company" rule in `lifecycle/service.py` is replaced by: the person moving it must have
access to the asset's company and to the holder's company.

### PO model on top of the copy
- A CKAM PO = ERP PO lines (from the copy) + CKAM's own part: Item chosen per line, units staged, deliveries with serials. Manual POs
  (no ERP) stay possible.
- The nightly diff marks POs "changed in ERP" automatically (badge + dashboard count). Cancelled PO, cancelled or added units, rate and
  header changes are as built. **New:** vendor change is an applicable change (moves the PO to the new vendor via Change 2; units already
  delivered keep their vendor); a line **edited in CKAM** is never overwritten silently (both values shown, the person picks).
- Delivered units are never touched by the ERP.
- Invoice details (vendor bill no and date, GSTIN) come from `ckp_pi_line`: CKSPL through the goods-receipt link, CKVPL by vendor + item
  with a person confirming.

## 5. Whole flow, end to end

1. Nightly sync copies both companies' ERP data. 2. A buyer picks an ERP PO (CKSPL or CKVPL); vendor and Items are resolved through the
links. 3. Goods arrive: delivery with serials (or Serial Pending) at the PO's delivery location (a WH or straight to a store).
4. Labels are printed (after receiving or when dispatching). 5. WH scans the assets, picks the store and applies: the assets are Allotted
to the store user straight away (a PO delivered directly to a store does the same at delivery). 6. IT allots a spare to a person.
7. If the ERP edits or cancels the PO, the morning list shows "changed in ERP" and the owner applies or keeps.

## 6. Build order (each step ships by itself)

| Step | What | Depends on |
|---|---|---|
| 1 | ERP local copy + nightly sync + CKVPL reader; PO change check reads the copy | none |
| 2 | Vendor links, GSTIN suggestions, vendor-change as applicable change, "edited here" rule | 1 |
| 3 | Location kinds + ERP site link + "Create stores from ERP" + email pattern + store login | 1 |
| 4 | Deliver a PO straight to a store user (allot at delivery); check/test the existing path | 3 |
| 5 | Cross-company allotment (replace the "same company only" rule; reports by owner and by location company) | decided |
| 6 | Invoice details from the ERP | 1, 2 |
| 7 | ERP packet reference on Move / Dispatch (read-only), from silver challan + receipt tables (CKSPL only) | 1 |

## 7. Decisions needed from the owner

1. ~~Email pattern~~ **Answered:** `sm.<code>@citykartstores.com` for every site except HO / WH / Training Room.
2. ~~Cross-company use~~ **Answered:** yes, both directions.
3. ~~Store confirms receipt?~~ **Answered: option B.** The store does nothing; assets are allotted directly to the store user.
4. ~~ERP team requests~~ **Answered:** use the silver layer only for now; the owner will share gold views when they exist. Consequence: the
   ERP packet reference is built from `silver.fact_dc_line` (challan lines of fixed assets: challan no, date, destination site, item, qty;
   2.2 s for 30 days, fine for the nightly copy) and `silver.fact_store_receipt_event` (store receipt, where it matches). The per-item
   "in transit" table (`fact_transfer_out_line`) is still not readable, so "in transit" in the packet panel is inferred (challan exists,
   no receipt yet). `ERP_FA_TRANSFER_REQUEST.md` stays on file but is not needed to start.
