# CityKart Asset Manager (CKAM) — Design Spec

- **Date:** 2026-09-23
- **Status:** Draft for review
- **Source brief:** `citykart-asset-manager-BUILD-PROMPT.md` (this spec overrides the brief wherever they differ)

---

## 1. Purpose

An internal web app to track every CityKart asset from **procurement to scrap**, answering at any
moment:

- How many assets were procured, by company / category / cost center?
- Who or where holds each asset right now?
- How many are in stock, and at which location?
- What is the complete custody history of any one asset?

It replaces the Ginesys "Thread-ERP" FAMS module for **operational tracking only**. Accounting stays
in Ginesys.

**Guiding rule:** the app must stay easy to change. Decisions below are v1 defaults, not permanent
commitments.

### Out of scope for v1

Depreciation · approval workflows · AMC and insurance contracts · email/SMS notifications ·
GST breakup (CGST/SGST/IGST) · cross-company asset movement · mobile GPS verification.

---

## 2. Decisions taken during design

| # | Topic | Decision |
|---|---|---|
| D1 | Tax | One **Tax %** per asset; `tax_amount = purchase_cost × tax_percent / 100`, stored. `total_cost = purchase_cost + tax_amount`. |
| D2 | Approvals | None in v1. Every action takes effect immediately. |
| D3 | Holders and logins | **One unified Users/Holders list.** Every holder (employee, store, installed-location, IT stock) may optionally have a login. |
| D4 | Holder types | `EMPLOYEE`, `STORE`, `INSTALLED`, `IT_STOCK`. Stock is a holder, as in the current CityKart practice ("IT Stock-HO", "Installed in WH-F"). |
| D5 | Emp Code | Unique **within a company** (same code may exist in both companies). |
| D6 | Login screen | Company dropdown + User ID (Emp Code) + Password. Revisit after real use. |
| D7 | Asset code | Admin-configurable pattern with field tokens; default `FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_` + running number. **Separate counter per resolved prefix.** No zero-padding (`CK_1`). |
| D8 | Code immutability | Cost center is locked after the asset is saved, so the code never changes. Can be made editable later. |
| D9 | Legacy data | Imported assets receive a **new** CKAM code; the old code is stored verbatim in `legacy_asset_code` and is searchable. |
| D10 | Company boundary | An asset can only move between holders of its own company. |
| D11 | Depreciation / alerts | No depreciation. Alerts are in-app only. |
| D12 | Hosting | Company server / PC on the LAN via Docker Compose. |
| D13 | Stack | FastAPI (Python 3.13) + SQLAlchemy 2 + Alembic · PostgreSQL 17 · React 19 + Vite + TanStack + Tailwind + shadcn/ui, styled with the CityKart design system. |

---

## 3. Architecture

A single modular monolith, three containers:

```
Browser (LAN) ──► web (nginx: React build + /api reverse proxy)
                        │
                        ▼
                   api (FastAPI, uvicorn) ──► db (PostgreSQL 17)
                        │
                        └──► /data/uploads (Docker volume)
backup (cron container) ──► pg_dump + uploads → /backups (host folder, 14-day retention)
```

### Backend modules (`backend/app/`)

Each module has its own `models.py`, `schemas.py`, `service.py` and `router.py`, and talks to other
modules only through their `service.py`.

| Module | Responsibility |
|---|---|
| `core` | Config, DB session, security (JWT, Argon2), company-scope dependency, audit fields |
| `masters` | Company, Location, Department, Cost Center, Category, Sub-Category, Vendor, Custom Field definitions; one generic CRUD service |
| `holders` | Users/Holders, roles, login credentials, password change |
| `numbering` | Code-rule parsing, token resolution, per-prefix counters |
| `assets` | Asset create/read/update (non-derived fields), register search |
| `lifecycle` | **State machine** and the append-only event ledger; the only code that writes `status` and `current_holder_id` |
| `documents` | Upload/download of asset files |
| `imports` | Excel template, validation preview, commit |
| `reports` | Dashboard KPIs, alerts, Excel exports |

### Frontend (`frontend/src/`)

- `routes/`: TanStack Router file routes (dashboard, assets, assets/$id, assets/new, import, reports, setup/*, my-assets, login)
- `features/`: per-module API hooks (TanStack Query) and components
- `components/master-crud/`: **one generic list + form component** driven by a field config, used by every setup list
- `components/ui/`: shadcn/ui, installed via the CityKart scaffold

---

## 4. Data model (PostgreSQL)

Shared columns on every mutable table: `created_at`, `created_by`, `updated_at`, `updated_by`.
Masters, holders and assets also have `is_active` and/or `deleted_at` (soft delete only).

### 4.1 Masters

```sql
company        (id, code UNIQUE, name, is_active)
location       (id, code UNIQUE, name, address, is_active)                -- shared across companies
department     (id, name UNIQUE, is_active)
cost_center    (id, company_id → company, code, name, is_active, UNIQUE(company_id, code))
asset_category (id, code UNIQUE, name, is_active)
asset_subcategory (id, category_id → asset_category, code, name, is_active, UNIQUE(category_id, code))
vendor         (id, code UNIQUE, name, gstin, contact_name, contact_phone, contact_email, is_active)

custom_field   (id, field_key UNIQUE, label,
                field_type CHECK IN ('text','number','date','dropdown','checkbox'),
                options JSONB, is_required, sort_order, is_active)
```

### 4.2 Holders (users)

```sql
holder (
  id, company_id → company NOT NULL,
  emp_code TEXT NOT NULL, name TEXT NOT NULL,
  holder_type TEXT NOT NULL CHECK IN ('EMPLOYEE','STORE','INSTALLED','IT_STOCK'),
  location_id → location NOT NULL, department_id → department,
  email, phone,
  -- login (optional)
  password_hash TEXT NULL,                 -- NULL = cannot log in
  role TEXT NOT NULL DEFAULT 'HOLDER' CHECK IN ('ADMIN','IT_TEAM','VIEWER','HOLDER'),
  must_change_password BOOLEAN DEFAULT TRUE,
  failed_login_count INT DEFAULT 0, locked_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE (company_id, emp_code)
)

holder_company_access (holder_id → holder, company_id → company, PRIMARY KEY (holder_id, company_id))
-- which companies an IT_TEAM / VIEWER login may see. ADMIN sees all; HOLDER sees only own assets.
```

### 4.3 Numbering

```sql
code_rule (
  id, company_id → company NULL,           -- NULL = default rule for all companies
  prefix_template TEXT NOT NULL,           -- 'FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_'
  suffix_template TEXT NOT NULL DEFAULT '',
  start_number BIGINT NOT NULL DEFAULT 1,
  pad_width INT NOT NULL DEFAULT 0,        -- 0 = no padding (CK_1)
  is_active BOOLEAN DEFAULT TRUE
)

code_counter (
  resolved_prefix TEXT PRIMARY KEY,        -- e.g. 'FA/HO01/IT/LAP/CK_'
  next_value BIGINT NOT NULL
)
```

**Tokens supported in v1:** `{company.code}`, `{cost_center.code}`, `{category.code}`,
`{subcategory.code}`, `{location.code}` (initial holder's location), `{yyyy}`, `{yy}`, `{mm}`
(from purchase date). An unknown token is rejected when the rule is saved.

**Allocation** happens inside the asset-insert transaction:
`INSERT … ON CONFLICT (resolved_prefix) DO UPDATE SET next_value = code_counter.next_value + 1 RETURNING next_value`.
The row lock makes concurrent saves safe. If a token's value is empty (for example no sub-category),
the save is rejected with a clear message, so no malformed code is ever produced.

### 4.4 Asset

```sql
asset (
  id,
  asset_code TEXT UNIQUE NOT NULL,         -- generated, immutable
  legacy_asset_code TEXT,                  -- imported data only, stored verbatim
  company_id → company NOT NULL,
  cost_center_id → cost_center NOT NULL,   -- locked after insert
  category_id → asset_category NOT NULL,
  subcategory_id → asset_subcategory,
  brand, model, serial_number, description TEXT NOT NULL,

  vendor_id → vendor,
  po_number, po_date, invoice_number, invoice_date, pi_number, pi_date,
  purchase_cost NUMERIC(14,2),
  tax_percent NUMERIC(5,2),
  tax_amount NUMERIC(14,2),                -- computed by the service
  total_cost NUMERIC(14,2),                -- computed by the service
  purchase_date DATE NOT NULL,
  warranty_upto DATE,

  -- derived; written ONLY by the lifecycle service
  status TEXT NOT NULL CHECK IN ('IN_STOCK','ALLOTTED','INSTALLED','UNDER_REPAIR',
                                 'DISPOSED','SOLD','SCRAPPED','LOST'),
  current_holder_id → holder NOT NULL,
  status_since TIMESTAMPTZ NOT NULL,

  custom_fields JSONB NOT NULL DEFAULT '{}',
  deleted_at TIMESTAMPTZ
)
-- indexes: (company_id, status), (current_holder_id), (legacy_asset_code), (serial_number),
--          GIN(custom_fields), trigram index on asset_code/serial/po/invoice/pi for search
```

A DB trigger rejects any `UPDATE` that changes `cost_center_id`, `company_id` or `asset_code`
(D8), so the rule holds even outside the app.

### 4.5 Event ledger (the history)

```sql
asset_event (
  id, asset_id → asset NOT NULL,
  event_type TEXT NOT NULL CHECK IN ('PROCURED','IMPORTED','MOVED',
                                     'SENT_FOR_REPAIR','RECEIVED_FROM_REPAIR',
                                     'DISPOSED','SOLD','SCRAPPED','LOST','FOUND','CORRECTION'),
  event_date TIMESTAMPTZ NOT NULL,         -- user may backdate
  from_holder_id → holder, to_holder_id → holder,
  status_after TEXT NOT NULL,
  remarks TEXT, reference_no TEXT,
  recorded_by → holder NOT NULL, recorded_at TIMESTAMPTZ DEFAULT now()
)
-- index: (asset_id, event_date, id)
-- A trigger raises an exception on any UPDATE or DELETE of asset_event.
```

### 4.6 Documents

```sql
asset_document (id, asset_id → asset, doc_type CHECK IN ('invoice','po','warranty_card','photo','other'),
                file_name, stored_path, mime_type, size_bytes, uploaded_by, uploaded_at, deleted_at)
```

Limit of 10 MB per file; allowed types are PDF, JPG, PNG, XLSX and DOCX. Files are stored under
`/data/uploads/{asset_id}/{uuid}.{ext}`.

---

## 5. Lifecycle rules (state machine)

**Status derived from the holder** after a `MOVED`, `PROCURED`, `IMPORTED` or `RECEIVED_FROM_REPAIR` event:

| Holder type | Status |
|---|---|
| IT_STOCK | IN_STOCK |
| EMPLOYEE, STORE | ALLOTTED |
| INSTALLED | INSTALLED |

**Allowed events by current status:**

| Current status | Allowed events |
|---|---|
| IN_STOCK | MOVED, SENT_FOR_REPAIR, DISPOSED, SOLD, SCRAPPED, LOST |
| ALLOTTED / INSTALLED | MOVED, SENT_FOR_REPAIR, LOST |
| UNDER_REPAIR | RECEIVED_FROM_REPAIR (to any holder, default IT stock), SCRAPPED |
| LOST | FOUND (**Admin only**; goes to a chosen IT_STOCK holder) |
| DISPOSED / SOLD / SCRAPPED | none (terminal) |

Other rules:

- `SENT_FOR_REPAIR` keeps the current holder unchanged, sets status UNDER_REPAIR, and records the repair vendor and ticket in remarks / reference_no.
- Disposal, sale and scrapping are only allowed **from IN_STOCK**. An allotted asset must first be returned.
- `MOVED` requires `to_holder` ≠ current holder, to be active, and to belong to the **same company** (D10).
- `event_date` must not be before the asset's latest event date or its purchase date, and must not be in the future.
- `CORRECTION` (Admin only) adds a remark-only entry to annotate a mistake; it never changes status.
- **Timeline labels** are derived from the event and holder types:
  - Moved to EMPLOYEE/STORE → "Allotted to {name}".
  - Moved to IT_STOCK → "Returned to {name}".
  - Moved to INSTALLED → "Installed at {name}".
  - Moved from EMPLOYEE/STORE to EMPLOYEE/STORE → "Transferred from {a} to {b}".

The whole state machine lives in one pure function `lifecycle.transition(asset, event) -> new_state | error`,
fully unit-tested. The service writes the event row and updates the asset row in **one transaction**.

---

## 6. Roles and access

| Capability | ADMIN | IT_TEAM | VIEWER | HOLDER |
|---|---|---|---|---|
| Company scope | all | assigned | assigned | own company |
| See assets | all | in scope | in scope | **only currently held** |
| Add / edit / move / repair assets | ✓ | ✓ | – | – |
| Dispose / sell / scrap / lost | ✓ | ✓ | – | – |
| Found, Correction | ✓ | – | – | – |
| Import | ✓ | ✓ | – | – |
| Setup lists, holders, code rule | ✓ | masters only (not users/roles/code rule) | – | – |
| Reports / export | ✓ | ✓ | ✓ | own list only |

Enforcement:

- Each API route declares a required capability.
- A single `scoped_asset_query(user)` dependency builds the `WHERE` clause (company scope, or `current_holder_id = user.id` for HOLDER).
- Out-of-scope reads return **404**; disallowed actions return **403**.

---

## 7. Screens

1. **Login:** Company, User ID, Password. Forced password change on first login.
2. **Dashboard:**
   - KPI tiles (Total, In Stock, Allotted, Installed, Under Repair, Disposed); clicking a tile opens a filtered register.
   - Category chart and Location/Company chart.
   - Stock-by-location table.
   - Alerts: warranty ending in ≤ 30 days; ALLOTTED for > 180 days (threshold configurable).
3. **Asset Register:**
   - Server-side paginated table with filters and full-text search (code, legacy code, serial, PO, invoice, PI).
   - Bulk Move, Excel export and print labels.
   - Row click opens the asset, covered by an E2E test.
4. **Add Asset:**
   - One page with sections: Identity → Procurement (live tax calculation) → Custom fields → Documents → Initial holder (defaults to the company's IT_STOCK holder).
   - A **Quantity** field (1–100) creates N assets with consecutive codes. Serial numbers are entered in a grid, or left blank and added later.
   - After a successful save, a preview of the generated code(s) is shown.
5. **Asset Detail:**
   - Header: code, legacy code, description, status badge, holder, QR code.
   - Contextual action buttons; each opens a dialog (holder, date, remarks, reference no).
   - Tabs: Overview (editable non-derived fields), History (vertical timeline, exportable), Documents.
   - Print label.
6. **My Assets (HOLDER):** a read-only list plus a detail view (no actions).
7. **Import:**
   - Download the template, upload, then preview with per-row errors; commit applies only valid rows, all in one transaction.
   - Separate templates for Holders, Masters and Assets.
   - Each imported asset gets a new code, keeps its legacy code and an `IMPORTED` event, and is assigned to its holder from the file.
8. **Reports (Excel):** asset register · holder-wise · location-wise stock · movement log (date range) · disposed assets · warranty expiry.
9. **Setup:**
   - Every master uses the generic list and form screen.
   - Holders screen with login/role/company-access fields and a reset-password action.
   - Code Rule screen with a template editor, token picker and live preview (modelled on the legacy "Numbering" screen).
   - Custom Fields screen.

**QR label:** encodes `{BASE_URL}/assets/{id}`. Scanning the label opens the asset after login. Labels print from the browser as a sheet of 50×25 mm labels showing the code, short description and QR.

**Styling:** apply the CityKart design system (`citykart-ui:sk-uisystem-ck`, scaffolded with
`sk-uiscaffold-ck`). The app must be usable at phone width for the QR lookup flow.

---

## 8. Non-functional requirements

- **Security:**
  - Argon2id password hashes.
  - JWT access token (15 min) plus a refresh token in an httpOnly cookie (8 h idle).
  - Lockout for 15 min after 5 failed attempts.
  - All inputs validated by Pydantic, and all queries parameterised.
- **Integrity:**
  - No hard deletes.
  - `asset_event` is protected by a trigger against UPDATE and DELETE.
  - Code, company and cost center are immutable (trigger).
  - Derived fields are written only by the lifecycle service.
- **Audit:** `created_by` / `updated_by` on every mutable table; the event ledger is the custody audit.
- **Backups:** nightly `pg_dump` plus an uploads archive to a host folder, keeping 14 days; a documented and tested restore command.
- **Performance target:** register search under 1 s for 20,000 assets on a modest LAN server.
- **Config:** a single `.env` file (DB password, JWT secret, base URL, backup path, ports).

---

## 9. Testing

- **Backend (pytest, against a real Postgres in Docker):**
  - The state-machine table, every allowed and forbidden transition.
  - Code generation: tokens, per-prefix counters, concurrency with parallel inserts, missing-token rejection.
  - Tax calculation.
  - Scope enforcement per role, including HOLDER isolation and the 404 on others' assets.
  - The immutability triggers.
  - Import validation.
- **Frontend (Vitest):** form schemas and the timeline label mapping.
- **E2E (Playwright):** log in → add asset → allot to Ankur → return to IT Stock-HO → allot to ALC → verify the timeline; row click on the register; holder login sees only own assets.
- **Seed data** from the design examples: 2 companies; HO, ALC, WH-F and WH-K locations; IT Stock and Installed holders for each; Ankur (CS6872); Ajay (A0032).

---

## 10. Build order

1. Project skeleton, Docker Compose, DB migrations, auth and login.
2. Masters (generic CRUD), holders, code rule.
3. Add Asset and numbering.
4. Lifecycle service, Asset Detail, timeline, actions.
5. Register, Dashboard, My Assets.
6. Import, reports / Excel, QR labels.
7. Backups, deployment guide for the LAN server, E2E pass.

---

## 11. Open items to revisit after first use

- Login with a Company dropdown (D6) versus globally unique login IDs.
- Whether holders should also see their **past** assets (v1: current only).
- Cross-company asset movement (v1: not allowed).
- Editable cost center after save (v1: locked).
- AMC and insurance tracking, approvals, email alerts, depreciation, mobile scan-to-verify.
