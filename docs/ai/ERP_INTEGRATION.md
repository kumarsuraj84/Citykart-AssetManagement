# ERP integration (read-only)

CKAM reads purchase orders and vendors from the ERP data warehouse. It never
writes to it. Decided 2026-10-10: this replaced the earlier idea of reading
POs from an uploaded PDF (that code was dropped, never released).

## The connection

| | |
|---|---|
| Server | `10.0.1.69:5432`, PostgreSQL 17, database `data_extraction` |
| Login | role `ckpost`, read-only (every connection also sets `default_transaction_read_only`) |
| Settings | `PO_SOURCE_HOST/PORT/DB/USER/PASSWORD` in `.env` (dev) or `shared\.env` (prod). The password is typed in by the user, never into chat, code or compose files. All empty = ERP screens off |
| Code | `backend/app/erp/`: `warehouse.py` reads the warehouse (for the nightly copy), `sync.py` makes the copy, `local_source.py` serves it to the screens, `source.py` is the live reader and the `ErpSource` interface; tests replace the source through the `get_erp_source` dependency and the warehouse through `get_warehouse_reader` |

## CKAM's own copy of the ERP data (built 2026-10-13, both companies)

The screens no longer ask the warehouse live. A sync copies the **fixed-asset** PO lines, the suppliers and the items they
use into CKAM's own tables (`erp_po_line`, `erp_vendor`, `erp_item`, `erp_sync_run`); `LocalErpSource` serves the same
`ErpSource` interface from them, so the PO picker, drafts, reminders and the PO change check run unchanged on the copy.

- **Source**: the warehouse's `gold_ckpost` tables (`po_line`, `vendor`, `article`, `site`), which hold **both companies** in one table,
  told apart by `company` (`CKSPL`, `CKVPL`). They mirror `silver.ckp_*`. `gold_ckam.po_line` (CKSPL only) is no longer read for POs.
- **When**: at server start and then every `ERP_SYNC_CHECK_MINUTES` (30), a sync runs when the warehouse says it loaded newer data
  (`meta.v_freshness`, target `gold_ckpost.po_line`), or at least daily if it cannot say. `ERP_SYNC_ENABLED=false` switches it off.
  Primary Owner: **Refresh now** (`POST /api/erp/sync`); everyone who can work with POs sees "ERP data as of ..." (`GET /api/erp/sync`).
- **What is copied**: PO lines of the last 548 days plus every PO that still has an open line; the suppliers and items those lines use.
  A row the warehouse stops returning is marked `is_present = false`, never deleted; `row_hash` (business fields only) tells a real change
  from a plain reload. Real data (dev, 2026-10-13): 18,358 lines (CKSPL 17,955, CKVPL 403), 191 suppliers, 1,092 items; first copy about
  75 s, a repeat copy 3 s with nothing changed.
- **A PO's status** is derived from its lines (all cancelled = CANCELLED, all closed/cancelled = CLOSED, else OPEN); the new layer
  marks a fully received PO closed sooner than the old `gold_ckam` view did.
- **Tax**: the warehouse stores no tax % on a line. It is worked out from the PO (charges over gross when that is a GST slab, else the
  net-over-lines rule below) and flagged once per PO for a check. Where the old view had a tax, the copy agrees.
- **Codes are per company**: an ERP code is always (company, code). Supplier codes and site codes repeat across the two companies
  and mean different things; item codes (`CT...` / `CV...`) and PO codes do not.
- **Receipts and invoices** (`po_receipt_line`, `po_invoice`) are still read live and are not created yet (see below).

## What the live reader reads (schema `gold_ckam`; now only the fallback before the first copy, receipts and invoices)

| View | Used for | Status |
|---|---|---|
| `po_line` | One row per PO line: PO number, date, status, company, delivery location, vendor, item, description, group, HSN, unit, qty, rate, tax %, received/cancelled qty, header totals | exists and readable (grant fixed 2026-10-10; CKAM's own `PgErpSource` was run against it read-only and works). If the load job rebuilds the table the grant can be lost again: the symptom is "CKAM is not allowed to read the ERP view" |
| `item` | the item master: `icode, article_code, article_name, section, department, division, cat1..cat6, item_name, vendor_name, unit_name, hsn_code, item_extinct, article_extinct` (see `ITEM_MODEL.md`) | requested, **not created yet**; `silver.dim_item` (readable, no `article_code`/vendor/unit/HSN/extinct flags) is read as a fallback, so Items work today |
| `vendor` | `supplier_code, supplier_name, gstin, contact_name, phone, email, is_active` | requested, **not created yet**; until it is, Vendors > Add from ERP lists the suppliers that appear on Fixed Assets POs (about 104, from `po_line`) without GSTIN/contact details |
| `po_receipt_line` | `po_code, icode, grc_no, grc_date, received_qty` (one row per GRC line) | requested, **not created yet**; code and tests are done |
| `po_invoice` | `po_code, vendor_invoice_no, vendor_invoice_date, pi_number, pi_date, pi_amount` (rows without a `pi_number` = not booked yet) | requested, **not created yet**; code and tests are done |

View names are constants at the top of `source.py`.

## What exists today

- **Vendors**: `vendor_erp_link(vendor, company, ERP supplier code)` ties a CKAM vendor to an ERP supplier **per company** (unique per company and code; one vendor can have a link in each company, and several inside one company). The same supplier has a different code in each company and the same code is a different supplier (690 clashing codes), so a code alone never identifies a vendor. Vendors screen -> "Add from ERP": pick the company, then add a supplier as a vendor (CKAM Code = the ERP code, or `<COMPANY>-<code>` when the other company's supplier already took it), link an existing vendor, or unlink. A suggestion is the vendor with the same **GSTIN** (its own, or the one the ERP holds for a supplier it is already linked to), else the same name or code; a supplier whose GSTIN is already a vendor cannot be added twice, only linked. Primary Owner only. Matching is by (company, ERP code), so renaming a vendor never breaks it.
- **Purchase orders**: Purchase Orders -> "Pick from ERP" lists OPEN POs of linked vendors that are not in CKAM yet; "Review" opens an editable draft (same screen the PDF idea had: bundle suggestion, item memory, delivery location pre-selected as the future Initial Asset User); "Create this purchase order" makes the PO and its lines. `purchase_order.erp_po_code` (unique) stops it being created twice. ADMIN and OPERATOR.
- Each ERP code is resolved to a CityKart **Item** (code > product name > Article rule, see `ITEM_MODEL.md`); category, sub-category, bundle and default brand/warranty come from the Item, and an unlinked code asks for the Item once. The ERP's own words (CAT1..CAT6) and Section > Department > Article are shown beside the code.
- Draft rules: company by code (no match -> left empty with a warning); cost centre = the company's own code/name; delivery location `CKSPL-WH-TAJNAGAR` -> stock point named like `WH Tajnagar` (an earlier PO's choice for the same location wins); blank tax % is worked out as (PO net total / sum of its lines - 1) and snapped to a GST slab, with a warning (on the real data every blank-tax PO comes out at exactly 18%; the ERP's own "charges" field is NOT used because on those POs it just repeats the line total; anything above 35% is treated as not-tax and left for the user); non-piece units (MTR, KG), fractional quantities and already-received quantities are flagged; fully cancelled lines are dropped.

## Data facts (profiled 2026-10-10)

13,225 lines / 3,292 POs, 2025-10-09 to 2026-10-08, all company CKSPL; about 38% of lines have no `tax_percent`; ~44% of lines are deliveries to stores (short codes like `SVP`) rather than warehouses; one PO number appears under two PO codes.

Open POs (539): series `GPO` 316 (store fixed assets: sensormatic/AC/lights/shelving, delivered to stores), `SPO` 175 (IT and head-office/warehouse items, e.g. Vansh Dell desktops to `CKSPL-WH-FARUKHNAGAR`), and 48 whose number does not start with a series (`Automatic ...`). 231 open POs have blank line tax, including 110 of the 175 SPO; a PO has either all lines taxed or none. Only POs of vendors linked in CKAM are ever offered, so the GPO series stays out unless those vendors are linked.

## Delivery reminders and PI (built, waiting for their ERP views)

- **Delivery reminders** (`app/erp/reminders.py`, `GET /api/erp/reminders`): for POs created from the ERP, the ERP's received quantity per item code (summed over GRC lines) is compared with the units delivered here (barcode = item code; a bundle counts as its most-delivered part). If the ERP shows more received than delivered, a card on Purchase Orders and a banner on the PO say "N to deliver", with GRC numbers and dates. It only ever reminds: delivery needs serial numbers. If the ERP is off or unreachable the card is simply hidden.
- **PI from the ERP** (`app/erp/invoices.py`, `GET/POST /api/erp/purchase-orders/{id}/pi[/apply]`): "Fetch PI from ERP" on a PO's delivered-invoices section previews the ERP PIs matched to the invoices delivered here by vendor invoice number (ignoring case/punctuation; if a PO has exactly one delivered invoice and the ERP has exactly one PI they are paired even if the numbers differ, and it says so). Rows are Ready / Already recorded / Different PI already recorded / No matching invoice. Only ticked rows are recorded, through `record_pi_for_invoice` (same audit trail); the server re-checks every requested PI against the ERP, so a PI the ERP does not hold for the PO can never be recorded; an existing different PI is kept unless "replace" is ticked.

## When the ERP changes a PO that CKAM made from it (built 2026-10-12)

A CKAM PO made from an ERP PO is a copy; the ERP is loaded daily and keeps no edit history. CKAM therefore
remembers what the ERP said when the PO was made (`purchase_order.erp_status/erp_supplier_code/erp_delivery_location/
erp_synced_at` and one `purchase_order_erp_baseline` row per item code: units after cancellations, rate, tax %)
and shows what is different NOW (`app/erp/changes.py`). Changes are measured against that baseline, not against
CKAM's own lines, so units a person cancelled deliberately here never reappear as a difference.

| Difference | Shown as | Apply does |
|---|---|---|
| PO cancelled in the ERP | red banner | cancels every still-pending unit (delivered units stay; the banner says how many were delivered) |
| quantity reduced / line cancelled | `CANCEL_UNITS` | cancels that many pending units (latest first; a bundle's parts each lose that many); warns if more than the new quantity was already delivered |
| quantity raised | `ADD_UNITS` | adds units copied from the existing lines (bundles through the bundle) at the ERP's rate and tax |
| rate / tax edited | `COST_CHANGED` | pending units get the new cost (a bundle's price is split by its shares); delivered assets keep theirs |
| new item code | `NEW_ITEM` | not applied automatically: add it with + Add Line / + Add Bundle, then mark it as added |
| the ERP moved the PO to another supplier | `VENDOR_CHANGED` | moves the PO to the CKAM vendor linked to that supplier **in the PO's company** (refused until it is linked); delivered units keep the vendor they were delivered with |
| closed or delivery location changed | `HEADER` | information only; "Noted" (acknowledging it does not hide a vendor change, and vice versa) |

Every difference can instead be **kept** (the PO is left alone and the ERP's state is remembered as agreed). Nothing
changes by itself; only a person applies or keeps, and every choice is logged (`purchase_order_erp_change`, shown on
the PO). Only differences still present when the choice is made can be applied (the ERP is re-read first). A PO made
before this existed has no baseline: "Start comparing with the ERP" takes one. Endpoints: `GET /api/erp/purchase-orders/
{id}/changes`, `POST .../changes/apply` (`{"items": [{"id", "mode": "apply"|"keep"}]}`, or id `WATCH`), `GET /api/erp/changes/summary`
(PO list badge/card and the dashboard count; "not available" instead of an error when the ERP cannot be read). The
ERP view shows a cancelled PO as `po_status = 'CANCELLED'` with `cnlqty` per line; "CLOSED" only means fully received
there. The ERP's data is as of its daily load, so a change shows the next morning (the panel says "ERP data as of").

## Open decisions

- Fully received POs: the ERP closes a PO when it is received, so a PO received before anyone picks it here is no longer offered
  (it was the same with `gold_ckam`, only the new layer shows it a day sooner). Offering recently closed POs is still open.
- CKVPL has 856 fixed-asset PO lines (about 500 POs, newest 2026-10-09), delivered to HO and its warehouses; its goods receipts are
  not in `fact_grc_line`, so its received quantity comes from the PO line itself and its invoices cannot be matched to a PO.
- The 48 open POs whose number has no series prefix.
