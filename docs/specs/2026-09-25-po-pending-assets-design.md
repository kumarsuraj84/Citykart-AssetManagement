# CKAM — Purchase Order / Pending Assets — Design Spec

**Status:** Approved for planning (pending final confirmation on role gate, §8).
**Author:** Session-driven design (Claude), directed by Suraj.
**Supersedes:** Nothing — purely additive. Add Asset is unchanged.

## 1. Purpose

Today, `Add Asset` creates a fully-real, numbered Asset in one step, with
`purchase_date` mandatory even though for a tracked procurement the real
"purchase date" is really the invoice date — which isn't known until the
vendor actually delivers and invoices. CityKart's real procurement flow
is: raise a PO → order arrives in stages, possibly partially → vendor
invoices → *then* the item becomes a trackable fixed asset with a serial
number.

This feature adds a second, optional entry path for that flow. It does
**not** replace Add Asset — a one-off purchase with no PO to track still
uses the existing form unchanged.

## 2. Core model

Two new entities, deliberately lightweight — no new lifecycle states, no
change to `Asset`'s own schema, no change to the existing asset event
ledger.

### 2.1 `PurchaseOrder` (header)

| Field | Type | Notes |
|---|---|---|
| `id` | PK | |
| `company_id` | FK → Company | From the logged-in user's company, like Add Asset — no company selector. |
| `po_number` | string | The vendor-facing PO number, e.g. "PO-2026-0042". |
| `po_date` | date | |
| `vendor_id` | FK → Vendor, nullable | Optional, matching Add Asset's own optional vendor. |
| `created_by` / `created_at` | audit | |
| `is_active` | bool | Soft-deactivate only, matching every other master — see §7. |

A PO has no status of its own; its lines individually track PENDING /
DELIVERED / CANCELLED (§2.2). A PO with every line delivered or cancelled
is simply "done" — no separate header-level status is needed.

### 2.2 `PendingAsset` (one row per physical unit)

| Field | Type | Notes |
|---|---|---|
| `id` | PK | |
| `purchase_order_id` | FK → PurchaseOrder | |
| `company_id` | FK → Company | Denormalized from the PO for scoping queries without a join, same pattern `Asset.company_id` already uses independently of other FKs. |
| `description` | string | Required. |
| `category_id` | FK → AssetCategory | Required, same as Add Asset. |
| `subcategory_id` | FK → AssetSubcategory, nullable | Optional, same as Add Asset. |
| `cost_center_id` | FK → CostCenter | Required, captured at PO-entry per your answer (§ Cost Centre timing). |
| `purchase_cost` | numeric, nullable | "Cost of the asset." |
| `tax_percent` | numeric, nullable | |
| `tax_amount` / `total_cost` (PO Value) | computed | Same `compute_tax` math Add Asset already uses — displayed read-only. |
| `status` | enum | `PENDING` / `DELIVERED` / `CANCELLED`. |
| `serial_number` | string, nullable | Filled only at Delivery Done. Free text, so "N/A" is a valid, explicit value for items with no real serial (your speaker example). |
| `invoice_number` / `invoice_date` / `invoice_amount` | nullable | Filled once per Delivery Done batch, copied onto every row in that batch. `invoice_amount` is the invoice's own total (informational), not required to reconcile line-by-line against `total_cost`. |
| `initial_holder_id` | FK → Holder, nullable | Filled at Delivery Done, same field Add Asset requires today. |
| `delivered_asset_id` | FK → Asset, nullable | Set once converted — the real Asset this row became. The `PendingAsset` row is never deleted after conversion; it stays as the traceability record of "this Asset came from PO X." |
| `delivered_at` / `delivered_by` | audit, nullable | |
| `created_by` / `created_at` | audit | |

**Quantity** is not a stored field — entering "Quantity: 20" on the Add
Line form creates 20 separate `PendingAsset` rows in one submit (same
description/category/subcategory/cost/tax/cost-centre on each), exactly
mirroring how Add Asset's own `quantity` parameter already expands into N
separate `Asset` rows via `procure_assets`.

## 3. Delivery Done — conversion

Selecting one or more `PENDING` rows *within a single PO* (§ Delivery
scope) and confirming the popup (Invoice No/Date/Amount once, Serial
Number + Initial Holder per row) does, per selected row:

1. Validate every required field is present (serial number — even if the
   value is literally "N/A" — and initial holder are mandatory per row;
   invoice fields are mandatory for the batch).
2. Call the **existing** `app.assets.service.procure_assets` with a
   payload built from the `PendingAsset` row's own stored fields
   (company, cost centre, category, subcategory, description, cost, tax)
   plus the newly-supplied purchase_date (= invoice_date, per your
   original point that they're the same thing here), serial number,
   invoice fields, and initial holder — `quantity=1` per row, since each
   `PendingAsset` is already one physical unit.
3. This reuses, unchanged: the numbering service (Asset Code
   generation), the append-only `asset_event` ledger (the resulting
   Asset's first event is the same `PROCURED` event Add Asset produces),
   and every existing validation `procure_assets` already does
   (company/cost-centre match, active masters, etc.).
4. On success, set `PendingAsset.status = DELIVERED`,
   `delivered_asset_id`, `delivered_at`, `delivered_by`.
5. All rows in one Delivery Done submission are processed inside one
   transaction-per-row (same savepoint-per-row pattern Add Asset's own
   `quantity>1` path already uses) — one row's failure doesn't corrupt
   the others' already-committed conversions.

A converted asset is **indistinguishable** from one entered through Add
Asset — same table, same fields, same numbering, same ledger. The only
trace of its PO origin is the (nullable, one-directional)
`PendingAsset.delivered_asset_id` link, readable from the PO side; Asset
360 itself gains no new field or tab for this (out of scope — see §9).

## 4. Screens

- **Purchase Orders** (new nav item, likely under "Assets" alongside
  Add Asset/Import) — a list of POs (PO No, PO Date, Vendor, line
  counts by status), "New PO" action.
- **PO detail** — header fields (editable/cancellable while it has no
  delivered lines yet — see §5), an "Add Line" form (Description/
  Category/Subcategory/Cost Centre/Cost/Tax %/Quantity), and a table of
  this PO's own `PendingAsset` lines with a status badge each
  (`PENDING`/`DELIVERED`/`CANCELLED`, reusing `StatusBadge`'s pattern —
  a new, small status vocabulary local to this feature, not mixed into
  `Asset.status`'s own values).
- **Delivery Done** — triggered from the PO detail page: select one or
  more `PENDING` rows (checkboxes, same interaction `AssetRegister`'s own
  bulk-move already uses) → a dialog asking Invoice No/Date/Amount once,
  then Serial Number + Initial Holder per selected row → Confirm.

## 5. Editing / cancelling a pending line

Per your answer: a `PENDING` line can be edited (fix a typo) or
cancelled (vendor won't deliver it) at any time before conversion. Once
`DELIVERED`, the row is frozen — the resulting real Asset follows the
existing Correction workflow like any other asset, never edited here
again. A `CANCELLED` line is terminal (soft state, never deleted, kept
for PO history — consistent with the no-hard-delete rule).

## 6. Visibility / reporting

`PendingAsset` rows are **not** assets — they do not appear in the Asset
Register, Dashboard KPIs/exceptions, or any of the three canonical
exports until converted. This is intentional and matches "will not be our
Asset till it gets delivered" literally. No dashboard widget for pending
POs is in scope for this stage (a future, separately-authorized
enhancement, analogous to ThreadERP's own "Asset WIP" dashboard card,
could add one later if evidenced as needed).

## 7. Authorization / company scoping

Every `PurchaseOrder`/`PendingAsset` read/write is scoped by
`company_id` exactly like `Asset` — ADMIN unrestricted, everyone else
pinned to their own company via the existing `scoped_company_ids`
helper. No new scoping mechanism.

**Role gate — not yet finalized (explicitly deferred by you).** Default
proposal for planning purposes: `ADMIN`/`IT_TEAM`, identical to Add
Asset's own `require_role("ADMIN", "IT_TEAM")` gate, applied to every PO/
PendingAsset write (create PO, add line, edit line, cancel line, Delivery
Done). This is a single `require_role(...)` argument, trivial to narrow
to ADMIN-only later if you decide differently before or during
implementation — flagged here so the plan doesn't silently ship an
un-reviewed default.

## 8. Database migration

Two new tables (`purchase_order`, `pending_asset`), additive only — no
existing table's schema changes. Both follow the project's existing
audit-column and soft-deactivate conventions. Reversible downgrade drops
both tables (no data migration needed, since nothing existing moves into
them).

## 9. Explicitly out of scope for this stage

- Any dashboard/report surfacing of pending POs (§6).
- Any change to Add Asset itself.
- Cross-PO delivery batching (§ Delivery scope — deliberately restricted
  to one PO at a time).
- A visible "PO origin" field/tab on Asset 360 (the link exists in the
  data model for traceability, but no UI surfaces it yet — a small,
  separately-scoped follow-up if wanted).
- Approval workflow on POs (matches CKAM's existing, locked "no approval
  workflow in V1" decision).
- Any per-line invoice override (invoice fields are strictly batch-level
  per your confirmed answer).

## 10. Summary of your decisions this spec is built from

1. New path alongside Add Asset, not a replacement.
2. PO No/Date/Amount and Invoice No/Date/Amount: entered once per PO/per
   Delivery Done batch, shared across every line in that batch.
3. Serial Number: per physical unit, filled at Delivery Done, free text
   (so "N/A" is valid).
4. Quantity at PO-entry creates that many individual pending rows
   immediately, not one grouped row.
5. Initial Holder: chosen at Delivery Done, not at PO entry.
6. Pending lines are editable/cancellable before delivery.
7. Cost Centre: captured at PO-entry, per line.
8. Delivery Done is scoped to one PO's own lines at a time.
9. Role gate: proposed ADMIN/IT_TEAM (matching Add Asset), final call
   still open.
