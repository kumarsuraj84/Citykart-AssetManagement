# CKAM Simplification — Stage S1 report (frontend information architecture)

Starting HEAD: `6607757` (docs(audit): product simplification audit). Date: 2026-10-13.
Scope: frontend only (`frontend/src`, `frontend/e2e`) plus this report. No backend, database, API or
deployment change. Not committed (the controller commits).

## 1. What S1 delivers

1. **Role-aware sidebar**: Home · Work (Assets, Purchase Orders, Receive, Move) · People & Places (Employees,
   Stores, Stock Rooms, Install Points) · Reports · Settings (one collapsed group).
2. **Route guards**: every screen is wrapped by area; a person who may not use an area gets an in-shell
   "You don't have access to this area." page with a link Home (or My Assets). No flash of the screen and the
   screen's own requests never fire.
3. **Home** (`/dashboard`, titled "Home"): quick actions by role, "Needs attention" rows, Recent changes,
   Stock by Place, a collapsed Watch list, and a "Work area" selector.
4. **New routes**: `/receive` (Receive queue), `/people/employees`, `/people/stores`, `/people/stock-rooms`,
   `/people/install-points`. `/setup/asset-users` now redirects to `/people/employees`. Every other URL is unchanged.
5. **My Assets**: no staff menu entry; `/my-assets` sends staff to `/assets?mine=true`; Assets has a "Mine" toggle.
   For self-service logins `/my-assets` stays, with honest wording ("The assets that are with you right now").
6. **One label module** (`src/lib/labels.ts`) and **one option-builder module** (`src/lib/option-labels.ts`)
   used across the screens; no raw enum is shown anywhere.
7. **Terminology sweep** to the owner's locked words, in every screen.

## 2. Files

New:
- `src/lib/labels.ts` — status / place type / role / work area / event / audited-field words (+ `labels.test.ts`).
- `src/lib/option-labels.ts` — dropdown option builders (+ `option-labels.test.ts`).
- `src/lib/lookups.ts` — small shared lookups (category names; place names + company codes) on existing query keys.
- `src/lib/access.ts` — the one access matrix used by sidebar, guards and Home (+ `access.test.ts`, which also covers the auth-store id).
- `src/components/app-shell/AppNav.tsx` — role-aware sidebar (existing shadcn Sidebar primitives + Radix Collapsible).
- `src/components/app-shell/RouteGuard.tsx` — `guarded(area, Screen)` and the in-shell `NoAccess` page.
- `src/features/receive/ReceiveQueue.tsx` (+ test, which also covers the four `/people/*` routes), `src/routes/receive.tsx`, `src/routes/people.tsx`.

Changed (main ones): `router.tsx` (sidebar, guards, new routes, redirects), `lib/auth-store.ts` + `lib/auth-fetch.ts`
(own asset-user id), `components/shared/SearchableSelect.tsx` (muted `detail` context, searchable),
`components/shared/StatusBadge.tsx` (central words + `holderType`), `features/dashboard/Dashboard.tsx` (Home),
`features/assets/AssetRegister.tsx` (title Assets, header buttons, Mine, plain filters), `features/asset-users/*`
(fixed-type lists), `features/my-assets/MyAssets.tsx`, and the wording/dropdown changes in Add Asset, Asset 360, Move,
Print Labels, Serial Pending, Timeline, Documents, all Purchase Order screens and dialogs, ERP screens, Items/ERP Mapping,
Bundles, Vendors dialog, Custom Fields, generic master screens, quick-create dialogs, `/setup/*` route configs,
Asset Code Format, Bulk Import, Reports. 89 tracked files changed + 13 new; e2e: 9 spec/fixture files (static strings only).

## 3. API changes

None. No request or payload value changed, with one deliberate, additive exception: editing a person/place now
sends back that record's existing `allowed_asset_domains` / `primary_asset_domain` unchanged (see §7, a data-loss fix).

### Backend requests (worked around in the frontend for now)
| # | Request | Why / current workaround |
|---|---|---|
| B1 | Add `asset_user_id` to the login / refresh response (`LoginResponse`) | "Mine" needs the person's own id. Workaround: read the JWT `sub` claim client-side (UX only); the frontend prefers `asset_user_id` as soon as it is sent. |
| B2 | Add `waiting_units` (units still pending) to `GET /api/purchase-orders` rows | The Receive queue can only know "nothing received yet" (`pi_status = NOT_DELIVERED`) plus exact counts for the 5 newest open POs (dashboard) and ERP reminders. A partly-received PO beyond those may be missed (the page says so). The code already uses `waiting_units` when present. |
| B3 | Add `location_name` and `company_code` to `GET /api/asset-users` rows | People/place dropdowns now show "CODE · Name · Place · Company"; the frontend fetches `/masters/locations` + `/masters/companies` (small lists) to build it. The builders already prefer these fields when present. |
| B4 | `PUT /api/asset-users/{id}` replaces every field with defaults (`model_dump()`), so an edit that omits `allowed_asset_domains` resets an IT-only/Non-IT-only login to Both | Frontend now sends the existing values back. Backend should use `exclude_unset` (or require the field) so no client can clear it by accident. |
| B5 | Rename the movement-import column "Destination AssetUser Code" (`imports/movement_import_service.py`) | The Import hint still has to name the literal column the server reads. |

## 4. UX before → after

### Sidebar per role
| Role | Before | After |
|---|---|---|
| Head-office admin (Primary Owner) | Dashboard, My Assets · Assets: Asset Register, Add Asset, Serial Pending, Move / Dispatch, Print Labels, Purchase Orders, Import, Reports · Masters (12) · Administration: Asset Users, Code Rule — **24 entries** | Home · Work: Assets, Purchase Orders, Receive, Move · People & Places: Employees, Stores, Stock Rooms, Install Points · Reports · **Settings** (collapsed): Organisation (Companies, Places, Cost Centres, Departments) · Catalogue (Items, Asset Groups, Sub-categories, Brands, Bundles) · Vendors · Users & Access (People & Logins) · ERP (ERP Mapping) · Advanced (Custom Fields, Asset Code Format, Bulk Import) — **10 visible entries + Settings** |
| Admin (not Primary Owner) | 7 asset entries + Dashboard, My Assets + Asset Users, Code Rule — 11 | Home, Assets, Purchase Orders, Receive, Move, Employees, Stores, Stock Rooms, Install Points, Reports — 10 (no Settings) |
| Operator (IT or Non-IT, identical) | Dashboard, My Assets, Asset Register, Add Asset, Serial Pending, Move / Dispatch, Print Labels, Purchase Orders, Reports — 9 | Home, Assets, Purchase Orders, Receive, Move, Reports — 6 |
| Viewer | Dashboard, My Assets, Asset Register, Reports — 4 | Home, Assets, Reports — 3 |
| Self-service | My Assets — 1 | My Assets — 1 |

Still reachable without a menu item: Add Assets (Assets header button, Home quick action), Serial Pending
(Assets header "Serial Pending (n)", Home attention row), Print Labels (Assets selection bar "Print labels",
Move screen link, PO delivery links), Import (Settings › Advanced › Bulk Import), Asset 360 (from any asset link).

### Route guards
| Area | Who may open it |
|---|---|
| `/setup/*`, `/import` (Settings) | head-office admin only |
| `/people/*` | role ADMIN (head-office admin included) |
| `/receive`, `/purchase-orders*`, `/assets/new`, `/asset-movement`, `/serial-pending`, `/print-labels` | ADMIN, OPERATOR |
| `/dashboard`, `/assets`, `/reports` | ADMIN, OPERATOR, VIEWER |
| `/my-assets` | SELF_SERVICE (staff are redirected to `/assets?mine=true`) |
| `/assets/$id` (Asset 360), `/change-password` | everyone the server allows |

Asset 360 now hides the lifecycle action buttons from VIEWER as well (ADMIN/OPERATOR only); the Assets list gives
VIEWER no row checkboxes (nothing to move).

### Terms replaced (user-visible text only)
| Before | After |
|---|---|
| IN STOCK / ALLOTTED / INSTALLED / UNDER REPAIR / LOST / SOLD / SCRAPPED / DISPOSED | In Stock / With Employee · With Store (when the holder type is known, else "With Employee / Store") / Installed / Under Repair / Lost / Sold / Scrapped / Disposed |
| EMPLOYEE / STORE / STOCK_POINT / INSTALLED, "Stock Point" | Employee / Store / Stock Room / Install Point |
| ADMIN / OPERATOR / VIEWER / SELF_SERVICE; Primary Owner | Full Admin / Can Add & Move Assets / View Only / Own Assets Only; Head-office Admin |
| Responsibility, My Responsibility, IT / NON_IT | Work area: IT Team / Admin / Non-IT Team / Both |
| Asset User (column, filter), "All asset_users", Current Asset User, Destination Asset User, "AssetUser: …" | With, Everyone, Currently With, Move To, "With: … · In Stock" |
| Initial Asset User, Goes Into, Initial Custody, Delivery location | Received Into |
| "Not in IT Stock" | With a person or at a store |
| Dashboard | Home; Asset Register → Assets; Move / Dispatch → Move (page "Move Assets") |
| Masters / Administration / "Setup > …" in messages | Settings › … with the real new path (e.g. Settings › Organisation › Cost Centres, People & Places › Stock Rooms) |
| Locations, Cost Centers, Sub-Categories / Subcategories, Categories, ERP Articles, Code Rule, Import | Places, Cost Centres, Sub-categories, Asset Groups, ERP Mapping, Asset Code Format, Bulk Import |
| PI (bare) | "Purchase Invoice (PI)" spelled out once per screen |
| "can be restored / reversed later by an administrator" | "deactivated, not deleted: its history is kept" (no reactivation exists anywhere) |
| `PO_SOURCE_*` empty state | "The ERP connection is not set up on this server. Ask the head-office admin." |
| Changes tab field names (`serial_number`, `custom_fields.x`) | Serial number, the custom field's own label |
| Location (Asset 360 Custody, asset-user form) | Place |

### Dropdowns
One builder per kind, used by Add Asset, PO new / detail / lines / Edit line, PO from ERP, Delivery dialog, Move
(Move To, Currently With, Add by Item, stock-room picker), Assets filters + bulk Move, Asset 360 actions and Edit,
Correct Classification, Bundles, ERP Mapping pickers, Reports:
Item "Laptop · IT Fixed Assets" (› Sub-category only when it adds something); people/places
"CODE · Name · Place · Company" (company only when the list spans companies; place dropped when equal to the name);
Stock Room "HO Stock · Head Office · CKSPL"; Cost Centre "IT-HO · IT Head Office"; Vendor "Name · GSTIN"; Brand by name.
Plain Radix selects converted to searchable: Vendor + Brand (Asset 360 Edit), Category (Assets filter, Reports,
Correct Classification), Company (Assets filter, asset-user form, master forms, Custom Fields scope).
The context is a muted suffix and is searchable too.

## 5. Tests

| | Files | Tests |
|---|---|---|
| Before (HEAD 6607757) | 50 | 454 |
| After | 54 | **534** (+80) |

`npx tsc -b`: clean. `npx vitest run`: 534/534 green. `npm run build`: succeeds (existing >500 kB chunk warning only).
e2e specs: static strings updated and type-checked (`tsc --noEmit` on `e2e/*.ts`); Playwright not run, as instructed.

Added coverage:
- Role-based navigation for each role (exact menu lists), Settings collapsed by default and auto-opened on a Settings page, header role words.
- Route guards: allowed + denied for every guarded area and role, NoAccess link Home / My Assets, no data request for a denied screen, Asset 360 open to self-service, `/setup/asset-users` redirect.
- Home: quick actions per role (ADMIN, OPERATOR, VIEWER), every attention row and its link, VIEWER sees no PO/serial rows and no ERP calls, ERP 503 tolerated silently, no status tiles / Exceptions table / raw codes, Watch list collapsed with SPA links, work-area filter, error + retry, `buildAttentionRows` unit tests.
- Mine toggle on/off, `/assets?mine=true`, Mine hidden for the head-office admin account, `/my-assets` redirect for staff, self-service caption; Find Asset focuses search; Assets header buttons and Print labels; VIEWER without checkboxes.
- Central labels (no raw enum in status badges, both modes; status filter words; Register page body free of raw codes), `labels.test.ts`, `option-labels.test.ts` (every builder), `access.test.ts` (matrix + JWT id + login-response id).
- `/people/*` routes (title, Add button, active menu) and fixed-type lists (filtering, plain columns, role words, work area, fixed type on save, Stores from ERP only on Stores, places without login columns, deactivation wording, work area kept on edit).
- Receive queue (filtering, counts, ERP rows, ERP down, empty state, `waiting_units` path).
- Asset screens: VIEWER has no lifecycle buttons, readable Changes tab, Move sort by "With" fixed (was `sortKey="SELF_SERVICE"`), no "IN_STOCK"/"AssetUser:"/"Not in IT Stock" text, Received Into with stock-room context.
- Purchase/ERP/Settings screens: Received Into, PI spelled out, no "Primary Owner"/`PO_SOURCE`/"Setup", work-area words, new titles, no restore promise, Item options show their category.

## 6. Decisions taken where the brief was open

- **Home and Reports** are single top-level entries (no "Reports" group heading over one "Reports" link).
- **Settings in the icon-only (collapsed) sidebar** opens Settings › Companies, since a sub-list cannot show there.
- **Asset Groups**: the Categories screen is listed as "Asset Groups" (page title "Asset Groups (Categories)"), with
  "Sub-categories" beside it until the later merge.
- **Users & Access** holds one link, "People & Logins" → `/people/employees`.
- **Code rule ("Asset Code Format") is head-office admin only** in the UI, matching the server (`require_primary_owner`);
  an ordinary ADMIN previously saw a screen whose Save always failed.
- **"Mine"** shows for anyone whose own id is known, except the head-office admin account (not a person/place).
- **Home's "waiting for goods" row** counts *units* (`pending_po_summary.count` is a unit count), linking to Receive.
- **Status counts** survive on Home as one compact line of plain-word links to the filtered Assets list (not tiles).
- **Receive queue** = POs with nothing received yet, POs with known waiting units (dashboard's newest open POs), and
  POs the ERP says have arrived; it states that a partly received PO may not show yet (until B2).
- The **Assets register** row selection bar gained "Print labels" (contextual print) next to Move.
- The header shows the signed-in person's access in plain words (e.g. "Can Add & Move Assets").
- People & Places columns: Employees (Employee Code, Name, Place, Department, Login, Work area, Company); Stores
  (Store Code, Name, Place, Login, Work area, Company); Stock Rooms / Install Points (name, Code, Place, Company).
  One Import/Export file still covers all four kinds (its Type column says which).

## 7. Open observations

- **Data-loss bug (fixed on the client, needs B4):** before S1, saving the asset-user Edit form silently reset a
  login's work area (`allowed_asset_domains`) to Both, because the form never sent it and the server overwrites.
- `/setup/asset-users` wrapper file (`routes/setup/asset-users.tsx`) is no longer routed (the path redirects); kept, not deleted.
- The Asset User form still has no Work area field (S1 only displays it); a later stage rebuilds these forms.
- The movement Import template column is still named "Destination AssetUser Code" by the server (B5).
- No browser check was done in this stage (the brief forbids starting/stopping docker; containers do not live-mount
  source). Recommend a quick visual pass of the sidebar, Settings group, Home and `/people/*` after rebuilding `web`.
- Production bundle is ~1 MB (pre-existing single-chunk warning); route-level code splitting would help later.

## 8. Deferred to later stages

Real receipt screen replacing the Receive queue; merging Categories + Sub-categories into one Asset Groups screen;
Organisation tabs; ERP inbox; head-office admin attention group on Home (extension point: `Dashboard`'s
`headOfficeSection` prop); asset-user form rebuild (work area, logins as a toggle, store email rule); breadcrumb on
Asset 360; in-flow creation of small masters for Admin/Operator (needs the owner's decision and backend change).
