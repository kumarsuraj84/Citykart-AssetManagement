# Request to the ERP team: fixed-asset transfer view for CKAM Move / Dispatch

Status: **requested 2026-10-11, not created yet.** Nothing in CKAM depends on it; Move / Dispatch works without it.

## Why

The person who sends fixed assets to a store creates the transfer / packet in the ERP and then dispatches
in CKAM (scanning serials, printing labels, moving). CKAM would show him, as read-only reference while he
works, what the ERP says about that packet: which items and how many, where it is going, and where it is
in the chain (transfer order -> challan -> in transit -> received at the store), next to what he has
scanned ("expected 20, scanned 18, 2 not scanned yet, 1 not on this challan"). CKAM never writes to the ERP.

## What CKAM's login (`ckpost`) can and cannot read today (checked 2026-10-11)

| Readable | Notes |
|---|---|
| `silver.fact_dc_line` | challan lines: `challan_no`, `dc_date`, `warehouse_code`, `destination_site_code`, `icode`, `division`, `qty`, `rate`, `dc_status`, `prepared_by`. Fixed assets are `division = 'FIXED ASSETS'` (e.g. icode CT324973 Desktop, section IT EQUIPMENTS). |
| `silver.fact_store_receipt_event` | store receipt: `sent_document_no`, `packet_status` (RECEIVED...), `received_document_no`, `received_document_date`, `receive_qty`, `damage_qty`, `shortexcess_qty`, `barcode`. |
| `gold_dc.vehicle_transfer_actual_document_bridge`, `transfer_out_challans` | per challan: vehicle, transporter, `invoice_no`, qty, value (no item codes). |
| `gold_dc.site_master`, `silver.dim_site` | site code -> store name. |

| Not readable | Why we need it |
|---|---|
| `silver.fact_transfer_out_line` (permission denied) | the transfer-out line with `icode`, `invoice_no`, `challan_no`, vehicle, transporter, `release_status`: this is the "in transit" step per item. |
| `silver.fact_to_line` (transfer order lines, `to_status`) | the store's order, the first step of the chain. |

**Performance:** the silver fact tables are large. Queries not limited to a recent date range time out (>60 s);
a date-limited query on `fact_dc_line` takes about 7 s. CKAM cannot query these live, so a small, indexed view is
needed (as was done for `gold_ckam.po_line`).

## The view

`gold_ckam.fa_transfer_line`, **one row per item line of a fixed-asset transfer**, rolling window of the last 90 days,
with `SELECT` granted to `ckpost`. Suggested columns:

| Column | Meaning |
|---|---|
| `company_code` | e.g. `CKSPL` (CKAM company is matched through its ERP company code) |
| `transfer_order_no`, `transfer_order_date`, `transfer_order_status` | the store's order, if any |
| `challan_no`, `challan_date`, `challan_status` | delivery challan (the packet as created / scanned) |
| `transferout_no` (invoice no), `transferout_ts`, `release_status` | the transfer-out document = goods left the warehouse (in transit) |
| `vehicle_plate`, `transporter` | |
| `from_site_code`, `from_warehouse_code` | where it is sent from |
| `to_site_code`, `to_store_name` | where it is going |
| `icode`, `item_name`, `section`, `department`, `division` | the item (CKAM matches assets by `icode`) |
| `qty`, `rate`, `value` | |
| `packet_status` | `CREATED` / `IN_TRANSIT` / `RECEIVED` (derived: challan only / transfer-out done / store receipt done) |
| `received_document_no`, `received_document_date`, `receive_qty`, `damage_qty`, `shortexcess_qty` | the GRC at the store |

Index it (or materialise it) on `(from_warehouse_code, challan_date)` and `(icode)`. Restrict to fixed assets
(`division = 'FIXED ASSETS'`). Note that division also carries bulk consumables (lines of hundreds of units: tags,
hangers...); that is fine, CKAM only ticks off the items it tracks individually.

## CKAM side (to build once the view exists)

- a read-only "What the ERP says" panel on Move / Dispatch: pick the sending warehouse, see its recent packets with
  status, open one to see items and quantities, compared with the scanned assets (matched on `asset.erp_item_code` = `icode`);
- an "ERP site code" on each store / stock point in Setup > Users, so "Send to" can be pre-selected from the packet's
  `to_site_code` and the warehouse from `from_warehouse_code`;
- `ErpSource.fa_transfers(...)` in `backend/app/erp/source.py` (same read-only, cached pattern as `po_line`).
