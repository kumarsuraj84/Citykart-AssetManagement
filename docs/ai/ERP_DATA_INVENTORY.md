# What CKAM's ERP login (`ckpost`) can read (surveyed 2026-10-12, metadata and row estimates only)

Warehouse `data_extraction` on 10.0.1.69, loaded **daily** (see `meta.v_freshness`). 94 of 96 relations are readable.
CKAM uses only `gold_ckam.po_line` today (and `silver.dim_item` as the item fallback). Everything below is read-only.
Row counts are estimates. **Large tables (millions of rows) time out unless filtered by a date or key**; CKAM must never
query them live without a narrow filter or a purpose-built `gold_ckam` view.

## Useful for CKAM (assets, purchasing, movement)

| Relation | ~Rows | What it holds | Use for CKAM |
|---|---|---|---|
| `gold_ckam.po_line` | 13 k | PO lines: PO, status (OPEN/CLOSED/CANCELLED), supplier, delivery site, `icode`, ordered / received / cancelled qty, rate, tax | in use: pick PO, reminders, **change check** |
| `silver.fact_po_line`, `gold_dc.fact_purchase_order_item` | 183 k | all POs (not only FA) | same, wider |
| `silver.fact_grc_line` / `gold_dc.fact_grc_item`, `grc_entries` | 233 k | GRC (goods received) lines: `po_line_key`, `icode`, qty, supplier, transporter, user | receipts (delivery reminders) |
| `silver.fact_gate_entry` | 36 k | gate-in entries and their GRC status | |
| `silver.fact_dc_line` | 21 M | **challan lines**: `challan_no`, date, `warehouse_code`, `destination_site_code`, `icode`, `division` (FIXED ASSETS), qty, rate, `source_flow`, prepared_by | Move / Dispatch packet reference |
| `silver.fact_store_receipt_event` | 3.7 M | store receipt per transfer-out line: `packet_status` (RECEIVED...), received document no/date, receive/damage/short qty, `barcode` (= icode) | "received at store" step |
| `gold_dc.vehicle_transfer_actual_document_bridge` | 2.2 M | one row per transfer-out document: challan, invoice no, vehicle, transporter, qty, value (no item codes) | "in transit" (document level) |
| `gold_dc.transfer_out_challans`, `vehicle_dispatch_history`, `mart_transfer_*` | 2.4 M... | transfer-out / dispatch summaries by challan, vehicle, store | |
| `silver.fact_stock_snapshot_daily`, `gold_dc.stockpoint_daily_snapshot` | 349 k | daily stock by site / stockpoint / `icode` (qty and value) | reconcile warehouse stock with CKAM assets in stock |
| `silver.dim_item` (+ `dim_item_detail`) | 632 k | item master: division > section > department > article, CAT1..CAT6, rates; detail: item name, HSN, unit, tax name | Items / ERP Articles (in use as fallback) |
| `gold_dc.site_master`, `silver.dim_site`, `gold_fpa.dim_site` | 457 | sites: code, name, store type/status, state, city, warehouse code, coordinates | stores / delivery locations |
| `silver.dim_stockpoint` | 76 | stock points (location code, name, site, warehouse) | stock points |
| `silver.dim_company` | 2 | the two companies (`company_code`, name) | company link |
| `silver.dim_party`, `gold_fpa.dim_party` | 13 k | vendors / parties: code, name, class, credit days (no GSTIN) | vendor link |
| `silver.ap_open_item`, `gold_fpa.creditors_open_items` | 13 k | open vendor bills (document no/date, due date, amount, pending) | possible PI lead (a PI-to-PO link is still not in any readable table) |
| `silver.gl_posting*`, `gold_fpa.voucher_lines` | 8 M / 2.6 M | accounting postings with narration | not needed; maybe a PI reference lead |

## Readable, but not CKAM's business (do not use without a reason)

- **Finance:** `gold_fpa.*` (P&L by store, COGS, budgets, cash drawer, bank ledger, related-party GL lines), `silver.gl_*`, `fact_budget`, `ckv_*` ledgers.
- **People / HR:** `silver.dim_employee` (21 k employees: name, gender, joining and leaving date, designation, site), `attendance_day`, `fact_swipe` (door swipes), `gold_hr.*`.
- **Distribution analytics:** `gold_dc.mart_*`, `tat_*`, `scanning_*` (turnaround times, scanning per ERP user).

Note: `dim_employee` could in future map CKAM employees to ERP employees (leavers returning assets), but it is personal data;
only with an explicit decision.

## Not readable (permission denied)

- `silver.fact_transfer_out_line` (19.9 M, per-item transfer-out with `icode`, invoice no, vehicle, release status): the "in transit" step per item.
- `silver.fact_to_line` (11.9 M, transfer-order lines with `to_status`): the store's order.
- Their `gold_dc.fact_*` legacy-name views, `gold_dc.mart_dc360_*__new`, `meta.read_roles`.

## Recommendations

1. Ask the ERP team for the `gold_ckam.fa_transfer_line` view (see `ERP_FA_TRANSFER_REQUEST.md`), small, indexed, fixed-asset only.
2. Ask them to **narrow `ckpost`**: it can read payroll-adjacent HR data, finance ledgers and swipe data that CKAM never needs. The login
   should read only `gold_ckam.*` (plus the few master tables CKAM uses).
3. Keep every CKAM query filtered by PO code, item code, challan or a short date window.
