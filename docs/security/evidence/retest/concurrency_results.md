# Concurrency bursts (ACCESS retest, part C): NOT EXECUTED

**Status: not run in this retest. No verdict is given for any burst.**

The ACCESS retest session stopped while the burst script was being written. No burst request was sent to `ckam-sec`. The incomplete scratch script was never run and is not copied into this folder.

| Planned burst | Executed | Result |
|---|---|---|
| Parallel PO create with the same PO number | no | none |
| Parallel Receive of the same PO line, with and without the same Idempotency-Key | no | none |
| Parallel batch asset creation with the same Idempotency-Key | no | none |
| Parallel Move of one asset to two holders, and the same asset sold twice | no | none |
| Parallel entry of the same serial on two assets | no | none |
| Parallel vendor and item creation with the same name or code | no | none |
| Parallel change-password and login for one user | no | none |

## What the code and schema show (static, not proven under load)
These observations are not test results. They only show where a burst run should start.
- `purchase_order`: a partial unique index `uq_purchase_order_company_number_active (company_id, lower(btrim(po_number))) WHERE is_active` and an advisory lock (`purchase_orders/service.py::lock_po_number`).
- Receive (`purchase_orders/receive.py:230-238`) locks the waiting `pending_asset` units with `FOR UPDATE`.
- Lifecycle events (`lifecycle/service.py:128-134`) lock the asset rows with `FOR UPDATE`, in id order.
- Asset codes come from an atomic counter update (`numbering/service.py::reserve_codes`). `asset.asset_code` is UNIQUE. Serials have the partial unique index `ux_asset_serial_number_ci`.
- Items have the unique index `ux_item_name_active_ci`.
- **Vendors are different.** Only `vendor.code` is UNIQUE. Duplicate active names are refused by check-then-insert (`masters/router.py::_refuse_duplicate_name`), with no index or lock behind it. Two parallel creates with the same name and different explicit codes could therefore both succeed. This is a candidate race (SUSPECTED, not tested).
- Change-password and the other session-ending paths raise `token_version` in Python (`core/security.py::end_all_sessions`: read +1), not with an atomic SQL increment. Under a race two revocations can write the same value. This still ends every earlier session, so the expected impact is low (SUSPECTED, not tested).

## Throw-away data created by this retest (all RT-tagged, as SECHO)
- Asset 17 (`CKSPL/ADFA-SPL/0005`, "RT probe chair", in stock room 3), with documents 3, 4 and 5.
- PO 9 `RT-PO-PROBE-85582` (2 chairs waiting).
- Users 32 (`RT-SESS-A-771711`), 33 (`RT-SESS-B-771711`), 34 (employee coded `SECHO`, "RT Clash Employee") and 35 (`RT-MASS-771711`). All four are soft-deactivated.
