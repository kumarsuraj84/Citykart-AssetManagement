# CKAM — Product Context

## What it does

CKAM (CityKart Asset Manager) is one unified CityKart non-trading asset
platform — it tracks both IT assets (laptops, printers, POS hardware, network
equipment) and Admin/Non-IT assets (furniture, fixtures, facility equipment)
through their full lifecycle — procurement, allotment, transfer, repair,
disposal — with complete custody history always visible. It replaces a
cluttered third-party ERP module (Ginesys "Thread-ERP" FAMS) that CityKart
previously used for this.

Core guarantee: for any asset, at any time, you can answer *what is it, which
company/cost centre owns it, which team is responsible for it (IT or
Admin/Non-IT), which Asset User currently has it, where is it, and how did it
get there* — because every status/custody change is recorded as an
append-only ledger entry (`asset_event`), never overwritten.

## Personas / roles

CKAM's access model has two independent dimensions: a fixed **Primary
Owner** designation, and an ordinary **Access Role**.

### Primary Owner

A single, fixed, company-less bootstrap account (seeded once, named "Admin",
logs in by name — it has no Company/Location/Code of its own). It has
unconditional full access, always — the only role that may manage master
data (Companies, Locations, Departments, Cost Centres, Categories,
Sub-Categories, Vendors, Brands, Custom Fields) and bulk asset Import. It is
not selectable via the ordinary Role dropdown; only an existing Primary
Owner can grant it to another Asset User, and the system refuses to remove
the last one. See `DECISIONS.md` for why this is a separate dimension from
Access Role rather than a fifth role value.

### Access Roles

| Role | Can do |
|---|---|
| **ADMIN** | Every operational action (Add Asset, Purchase Orders, Delivery, PI, Asset Movement, Print Labels) across both IT and Admin/Non-IT, unrestricted by company. **Not** master data or Import — those are Primary-Owner-only, even for ADMIN. In practice CityKart does not assign ADMIN to ordinary staff; OPERATOR covers the same operational rights. |
| **OPERATOR** | The same operational actions as ADMIN, scoped to their own company (+ any company access grants) and their configured `allowed_asset_domains` (IT / NON_IT / BOTH). No master data, no Import, no Asset User administration. |
| **VIEWER** | Read-only: dashboard, asset register, reports, scoped the same way as OPERATOR. |
| **SELF_SERVICE** | Sees only their own currently-held assets ("My Assets"); no write access. |

### Asset User

An **Asset User** is CKAM's custody concept: the entity currently
responsible for, or representing the physical placement of, an asset. Four
types:

| Type | Meaning | Resulting status when assigned |
|---|---|---|
| **EMPLOYEE** | A named person | `ALLOTTED` |
| **STORE** | A CityKart store as accountable custodian | `ALLOTTED` |
| **INSTALLED** | A physical installation point (e.g. a server room, a store's fitted AC) | `INSTALLED` |
| **STOCK_POINT** | A physical stock/storage point (e.g. Head Office Stock, a warehouse) | `IN_STOCK` |

Login capability is a separate, explicit flag (`login_enabled`) on the Asset
User, not implied by type — a STORE/INSTALLED/STOCK_POINT record normally
has no login credentials at all; an EMPLOYEE may or may not be login-enabled.
When login-enabled, an Asset User also carries an Access Role and (for
OPERATOR/VIEWER) a domain scope — see `DECISIONS.md`.

## Asset Responsibility (IT / Admin-Non-IT)

Every Asset Category carries a `asset_domain` (IT or NON_IT) — the default
Responsibility for assets created under it. Every real Asset snapshots its
own `asset_domain` at creation time (derived server-side from its Category,
never client-supplied), so a later Category reclassification never silently
rewrites an existing asset's recorded Responsibility. Correcting an
existing asset's own Responsibility goes through the same Controlled
Correction flow as Category/Sub-Category/Purchase Date, ADMIN-only, with a
mandatory reason.

ADMIN and the Primary Owner always work across both domains regardless of
their own configured `primary_asset_domain` (a convenience default for
dashboards/reports, never an authorization restriction). OPERATOR/VIEWER are
restricted to their configured `allowed_asset_domains`.

## Module map

| Area | Backend | Frontend |
|---|---|---|
| Auth | `app/auth/` | `routes/login.tsx`, `routes/change-password.tsx` |
| Masters (companies/locations/departments/cost centers/categories/sub-categories/vendors/brands/custom fields) — Primary-Owner-only writes | `app/masters/` | `routes/setup/*.tsx` via shared `MasterCrudScreen` |
| Asset Users | `app/asset_users/` | `features/asset-users/AssetUsersScreen.tsx` |
| Asset numbering (code rules) | `app/numbering/` | `features/numbering/CodeRuleScreen.tsx` |
| Assets (CRUD, search) | `app/assets/` | `features/assets/{AssetRegister,AddAssetForm,AssetDetail}.tsx` |
| Lifecycle (the event ledger + state machine) | `app/lifecycle/` | `features/assets/Timeline.tsx`, action dialogs in `AssetDetail.tsx` |
| Documents (attachments) | `app/documents/` | `features/assets/DocumentsTab.tsx` |
| Excel import — Primary-Owner-only | `app/imports/` | `features/imports/ImportScreen.tsx` |
| Purchase Orders (pre-delivery asset staging) | `app/purchase_orders/` | `routes/purchase-orders/*.tsx` via `features/purchase-orders/{PurchaseOrdersList,NewPurchaseOrderForm,PurchaseOrderDetail}.tsx` |
| Reports/exports | `app/reports/` | `features/reports/ReportsScreen.tsx` |
| Dashboard | (reads across the above) | `features/dashboard/Dashboard.tsx` |
| My Assets (SELF_SERVICE self-service) | (scoped assets query) | `features/my-assets/MyAssets.tsx` |

## Deployment

Docker Compose on a CityKart LAN server: `db` (Postgres 17), `api` (FastAPI,
loopback-only on 8000), `web` (nginx serving the built React app, port
3211), `backup` (nightly pg_dump cron). No public internet exposure by
design — plain HTTP is acceptable on the LAN (see `DECISIONS.md` on
`COOKIE_SECURE`).

## Business rules that must never be silently weakened

- Company scoping: every list/read is scoped to the caller's company unless
  ADMIN or the Primary Owner.
- Domain scoping: OPERATOR/VIEWER never see or write an asset outside their
  configured `allowed_asset_domains`; ADMIN/Primary Owner are always
  unrestricted regardless of their own `primary_asset_domain`.
- SELF_SERVICE scoping: a SELF_SERVICE Asset User only ever sees assets
  where `current_asset_user_id == their own id`.
- Master data and bulk Import writes require `is_primary_owner`, not merely
  an ADMIN role check.
- Asset identity fields (`asset_code`, `company_id`, `cost_center_id`) are
  immutable after creation (enforced by a DB trigger).
- `Asset.asset_domain` is derived server-side at creation and never
  client-supplied; it changes only via Controlled Correction.
- The lifecycle state machine (`lifecycle/state_machine.py::transition`) is
  the only source of truth for which custody transitions are legal.
