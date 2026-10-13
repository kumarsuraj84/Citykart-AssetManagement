# What CKAM's ERP login (`ckpost`) can read (surveyed 2026-10-12, metadata and row estimates only)

Warehouse `data_extraction` on 10.0.1.69, loaded **daily** (see `meta.v_freshness`). 94 of 96 relations are readable.
CKAM uses only `gold_ckam.po_line` today (and `silver.dim_item` as the item fallback). Everything below is read-only.
Row counts are estimates. **Large tables (millions of rows) time out unless filtered by a date or key**; CKAM must never
query them live without a narrow filter or a purpose-built `gold_ckam` view.

## The layers (checked 2026-10-12)

| Layer | Schema | Can `ckpost` read it? |
|---|---|---|
| Bronze (raw ERP tables, as extracted) | `bronze` (71 relations) | **No** (no USAGE) |
| Silver (cleaned facts and dimensions) | `silver` (35) | Yes, except `fact_to_line` and `fact_transfer_out_line` |
| Gold (marts and views for apps) | `gold_dc` (45), `gold_fpa` (15), `gold_hr` (2), **`gold_ckam`** (1: `po_line`) | Yes. A plain `gold` schema exists but is empty / no access |
| Catalogue and load logs | `meta` | Yes (`dataset_catalog`, `raw_files`, `load_status`, `v_freshness`) |

Other databases on the server: `dc360_logistics` and `fpa_app` exist (no connect permission); `postgres`.

**What is in bronze**, from `meta.raw_files` (names and sizes only; the tables themselves are not readable): 64 raw ERP source
tables in two ERP schemas.
- `SSRK.*` (the main company's ERP, 457 sites; history from 2023-10): purchase orders `PURORDMAIN/DET`; warehouse gate-in and GRC
  `INVGATEIN`, `INVGRCMAIN/DET`; **delivery challans** `INVDCMAIN/DET` (26 M lines); sales / transfer documents `SALORDMAIN/DET`,
  `SALINVMAIN/DET`; **store packets and receipts** `PSITE_PACKETITEM` (6.6 M), `T_PACKETREC` (2.8 M), `PSITE_GRC`, `PSITE_GRCITEM`
  (25 M), `PSITE_GRT`/`GRTITEM` (store returns); masters `MAS$ITEM` (632 k items), `MAS$STOCKPOINT`, `ADMSITE`, `ADMOU`, `MLV_USER`,
  `MLV_TRANSPORTER`; finance `FINPOST`, `FINCOSTTAG`, `FINGL`, `FINSL`...
- `CSPL.*` (the second company, CKVPL, "ckv" in silver, 24 sites): in the *bronze* source list only finance and masters (`FINPOST`,
  `FINCOSTTAG`, `FINGL`, `FINSL`, `ADMSITE`, `ADMCLS`...). **But silver does carry CKVPL purchasing data**: see "Both companies" below
  (corrected 2026-10-13; an earlier version of this file wrongly said the warehouse had no PO data for the second company).
- `MISRETAIL.*`: management / reporting tables (targets, footfall, COGS, weekly closing stock, store opening dates).

The packet trail the dispatcher wants (packet created -> in transit -> GRC at the store) lives in `PSITE_PACKETITEM`, `T_PACKETREC`,
`PSITE_GRC*` and the challan / transfer tables, i.e. in bronze, partly already cleaned into silver (`fact_dc_line`,
`fact_store_receipt_event`). The ERP team can build `gold_ckam.fa_transfer_line` from them (see `ERP_FA_TRANSFER_REQUEST.md`);
CKAM should not be given the raw layer.

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
| `silver.dim_party`, `gold_fpa.dim_party` | 13 k | vendors / parties: code, name, class, credit days (no GSTIN here; **`silver.ckp_vendor` has GSTIN**, see below) | vendor link |
| `silver.ap_open_item`, `gold_fpa.creditors_open_items` | 13 k | open vendor bills (document no/date, due date, amount, pending) | not needed for PI: `silver.ckp_pi_line` has the invoices themselves |
| **`silver.ckp_*`** (`ckp_vendor`, `ckp_po_line`, `ckp_pi_line`, `ckp_article`, `ckp_site`) | 14 k / 969 k / 829 k / 633 k / 481 | **both companies** in one table each, with a `company` column (`CKSPL`, `CKVPL`) | see "Both companies" |
| `silver.gl_posting*`, `gold_fpa.voucher_lines` | 8 M / 2.6 M | accounting postings with narration | not needed; maybe a PI reference lead |

## Both companies (`silver.ckp_*`, surveyed 2026-10-13)

One table per subject, `company` = `CKSPL` or `CKVPL`. `gold_ckam.po_line` is CKSPL only (13,254 lines); the CKVPL lines are in
`silver.ckp_po_line`. The `ckp_*` tables are big because of CKSPL; **always filter on `company`** (CKVPL slices are tiny and fast).

| Table | CKSPL | CKVPL | Notes |
|---|---|---|---|
| `ckp_vendor` | 13,231 (5,717 with GSTIN) | 904 (402 with GSTIN) | `vendor_code`, name, **`gstin`**, address, credit days, `is_extinct` |
| `ckp_po_line` | 966 k | 3,217 (856 FIXED ASSETS lines, ~500 POs, newest 2026-10-09; 132 open FA lines) | same columns as `gold_ckam.po_line` (po_line_key text, line_status OPEN/CLOSED/CANCELLED, ordqty/rcqty/cnlqty, rate, tax, vendor, site, division/section/department/article) |
| `ckp_pi_line` | 826 k | 2,905 | purchase invoice lines: `pi_number`, `vendor_bill_no`, `vendor_bill_date`, `vendor_gstin`, `company_gstin`, `grc_line_key`, amounts |
| `ckp_article` | 632 k | 1,173 (693 FIXED ASSETS) | item master: `icode`, name, article, CAT1..CAT6, HSN |
| `ckp_site` | 457 | 24 | CKVPL: HO, 5 warehouses (Gurgaon WH, Farukhnagar, Khetawas, Tajnagar, Wazirpur) and 18 `EXTERNAL` rows that are CKSPL regions |

What the comparison showed:

- **Item codes never clash**: CKVPL codes are `CV####`, CKSPL's are `CT######`; zero codes in both. CKVPL article names differ too
  (`FIXED ASSETS-IT EQUIPMENST-FA_IT_LAPTOP`, `01-MOUSE[IT-01]`).
- **Vendor codes DO clash**: 690 vendor codes exist in both companies and **in every case they are different vendors** (e.g. code 2470 =
  JS Technology in CKSPL; code 61 = JS Technology in CKVPL). A vendor code is only meaningful together with the company.
- **The same real vendor exists in both**: 271 GSTINs appear in both companies (different codes: CKSPL 2470 / CKVPL 61). Of the 108 CKVPL
  vendors that have POs, 85 are also CKSPL vendors by GSTIN. Inside one company a GSTIN can still appear under several codes (CKSPL 228,
  CKVPL 17), so GSTIN is a very good suggestion key but a person should confirm.
- **Site codes clash** (1..24 exist in both companies): a site is also (company, code).
- **PO line keys do not clash** across companies (0 overlap).
- **PI -> PO link exists for CKSPL**: `ckp_pi_line.grc_line_key` -> `silver.fact_grc_line.grc_line_key` -> `fact_grc_line.po_line_key` ->
  PO line. 725 of 1,163 FA invoice lines of the last 30 days resolve (the rest are not against a PO / not yet received). For CKVPL the
  chain does **not** resolve (`fact_grc_line` holds no CKVPL receipts), so CKVPL gets received quantity from the PO line (`rcqty`) and the
  invoice only by vendor + item. (This corrects the earlier claim that no PI link existed in any readable layer.)
- CKVPL has no transfer / packet data in a readable layer.

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
