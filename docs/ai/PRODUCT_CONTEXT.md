# CKAM — Product Context

## What it does

CKAM (CityKart Asset Manager) tracks company assets (laptops, printers,
furniture, POS hardware, etc.) through their full lifecycle — procurement,
allotment, transfer, repair, disposal — with complete custody history always
visible. It replaces a cluttered third-party ERP module (Ginesys "Thread-ERP"
FAMS) that CityKart previously used for this.

Core guarantee: for any asset, at any time, you can answer *where is it, who
holds it, and how did it get there* — because every status/holder change is
recorded as an append-only ledger entry (`asset_event`), never overwritten.

## Personas / roles

| Role | Can do |
|---|---|
| **ADMIN** | Everything: masters, holders/users, code rules, all writes, all reports |
| **IT_TEAM** | Masters + asset writes (procure/move/import), reports — not holders/users or code rule |
| **VIEWER** | Read-only: dashboard, asset register, reports |
| **HOLDER** | Sees only their own currently-held assets ("My Assets"); no write access |

A **Holder** is CKAM's unifying concept: a person, a store, an IT-stock
location, or an installed-equipment location can all "hold" an asset and
(except installed locations) can log in. This is why login identity
resolution (see `DECISIONS.md`) has to handle non-person holders that may
have no email at all.

## Module map

| Area | Backend | Frontend |
|---|---|---|
| Auth | `app/auth/` | `routes/login.tsx`, `routes/change-password.tsx` |
| Masters (companies/locations/departments/cost centers/categories/sub-categories/vendors/custom fields) | `app/masters/` | `routes/setup/*.tsx` via shared `MasterCrudScreen` |
| Holders/Users | `app/holders/` | `features/holders/HoldersScreen.tsx` |
| Asset numbering (code rules) | `app/numbering/` | `features/numbering/CodeRuleScreen.tsx` |
| Assets (CRUD, search) | `app/assets/` | `features/assets/{AssetRegister,AddAssetForm,AssetDetail}.tsx` |
| Lifecycle (the event ledger + state machine) | `app/lifecycle/` | `features/assets/Timeline.tsx`, action dialogs in `AssetDetail.tsx` |
| Documents (attachments) | `app/documents/` | `features/assets/DocumentsTab.tsx` |
| Excel import | `app/imports/` | `features/imports/ImportScreen.tsx` |
| Purchase Orders (pre-delivery asset staging) | `app/purchase_orders/` | `routes/purchase-orders/*.tsx` via `features/purchase-orders/{PurchaseOrdersList,NewPurchaseOrderForm,PurchaseOrderDetail}.tsx` |
| Reports/exports | `app/reports/` | `features/reports/ReportsScreen.tsx` |
| Dashboard | (reads across the above) | `features/dashboard/Dashboard.tsx` |
| My Assets (holder self-service) | (scoped assets query) | `features/my-assets/MyAssets.tsx` |

## Deployment

Docker Compose on a CityKart LAN server: `db` (Postgres 17), `api` (FastAPI,
loopback-only on 8000), `web` (nginx serving the built React app, port
3211), `backup` (nightly pg_dump cron). No public internet exposure by
design — plain HTTP is acceptable on the LAN (see `DECISIONS.md` on
`COOKIE_SECURE`).

## Business rules that must never be silently weakened

- Company scoping: every list/read is scoped to the caller's company unless
  ADMIN.
- Holder scoping: a HOLDER only ever sees assets where
  `current_holder_id == their own id`.
- Asset identity fields (`asset_code`, `company_id`, `cost_center_id`) are
  immutable after creation (enforced by a DB trigger).
- The lifecycle state machine (`lifecycle/state_machine.py::transition`) is
  the only source of truth for which custody transitions are legal.
