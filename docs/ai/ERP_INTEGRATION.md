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
| Code | `backend/app/erp/` (`source.py` is the only place that talks to the ERP; tests replace it with a stand-in through the `get_erp_source` dependency) |

## What it reads (all in schema `gold_ckam`)

| View | Used for | Status |
|---|---|---|
| `po_line` | One row per PO line: PO number, date, status, company, delivery location, vendor, item, description, group, HSN, unit, qty, rate, tax %, received/cancelled qty, header totals | exists; **the `ckpost` grant on it kept disappearing / was missing on 2026-10-10**, so it has not been read from CKAM yet. Needs `GRANT SELECT` (and a default privilege or a grant at the end of the load job, because the load rebuilds the table) |
| `vendor` | `supplier_code, supplier_name, gstin, contact_name, phone, email, is_active` | requested, not created yet |
| `po_receipt_line`, `po_invoice` | delivery reminders and PI sync | requested, not built yet |

View names are constants at the top of `source.py`.

## What exists today

- **Vendors**: `vendor.erp_vendor_code` ties a CKAM vendor to an ERP supplier (unique when set). Vendors screen -> "Add from ERP" lists ERP suppliers; add one as a vendor (CKAM Code = ERP supplier code), link an existing vendor (name/code suggestion shown), or unlink. Primary Owner only. Matching is by the ERP code, so renaming a vendor never breaks it.
- **Purchase orders**: Purchase Orders -> "Pick from ERP" lists OPEN POs of linked vendors that are not in CKAM yet; "Review" opens an editable draft (same screen the PDF idea had: bundle suggestion, item memory, delivery location pre-selected as the future Initial Asset User); "Create this purchase order" makes the PO and its lines. `purchase_order.erp_po_code` (unique) stops it being created twice. ADMIN and OPERATOR.
- Draft rules: company by code (no match -> left empty with a warning); cost centre = the company's own code/name; delivery location `CKSPL-WH-TAJNAGAR` -> stock point named like `WH Tajnagar` (an earlier PO's choice for the same location wins); blank tax % is worked out from the PO's total charges against its line amounts and snapped to a GST slab, with a warning; non-piece units (MTR, KG), fractional quantities and already-received quantities are flagged; fully cancelled lines are dropped.

## Data facts (profiled 2026-10-10 before the grant was lost)

13,225 lines / 3,292 POs, 2025-10-09 to 2026-10-08, all company CKSPL; about 38% of lines have no `tax_percent`; ~44% of lines are deliveries to stores (short codes like `SVP`) rather than warehouses; one PO number appears under two PO codes.

## Not built yet

1. Delivery reminders: ERP shows more received than CKAM has delivered -> badge/reminder on the PO ("mark delivery"); never delivers by itself because serial numbers are needed. Needs `po_receipt_line`.
2. PI from the ERP: "Fetch PI" per PO, preview, confirm, then `record_pi_for_invoice` (PI is stored per PO + vendor invoice number, so the ERP view must carry the vendor invoice number). Needs `po_invoice`.
3. Open decisions: blank-tax policy (derive vs default 18), CKVPL POs (none in the view), whether store deliveries should be offered.
