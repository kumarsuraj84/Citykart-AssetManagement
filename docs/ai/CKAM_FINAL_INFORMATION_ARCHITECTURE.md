# CKAM — Final Information Architecture (as built)

| | |
|---|---|
| Status | **As built** in the local worktree at HEAD `c656f33` (2026-10-14). Committed locally, not pushed, not deployed |
| Replaces | `CKAM_SIMPLIFIED_INFORMATION_ARCHITECTURE.md` (the proposal); differences are in section 8 |
| Read from | `frontend/src/router.tsx`, `components/app-shell/AppNav.tsx`, `lib/access.ts`, `lib/labels.ts`, `features/settings/settings-structure.ts`, `features/dashboard/Dashboard.tsx` |
| Companion | `CKAM_FINAL_OPERATING_MODEL.md` (how the work is done) |

Everything here is **what a person sees**. Hiding a menu entry or showing "You don't have access to this area." is convenience; the server re-checks role, company and work area on every request.

## 1. Sidebar, exactly, per role

The sidebar is built from one function (`navSectionsFor`) and one Settings description (`settings-structure.ts`). The header (all roles) has the logo (link to Home), the person's access in words, **Change password** and **Log out**.

| Section | Entry | Opens |
|---|---|---|
| *(no label)* | **Home** | `/dashboard` |
| **Work** | **Assets** | `/assets` (also lit on `/assets/…`, `/serial-pending`, `/print-labels`) |
| | **Purchase Orders** | `/purchase-orders` (also lit on `/purchase-orders/…`) |
| | **Receive** | `/receive` (also lit on `/receive/…`) |
| | **Move** | `/asset-movement` |
| **People & Places** | **Employees** · **Stores** · **Stock Rooms** · **Install Points** | `/people/employees`, `/people/stores`, `/people/stock-rooms`, `/people/install-points` |
| *(no label)* | **Reports** | `/reports` |
| *(no label)* | **Settings** (one collapsed group) | `/settings` and its entries (section 4) |
| *(self-service only)* | **My Assets** | `/my-assets` |

What each role sees:

| Role (as shown in the header) | Entries | Count |
|---|---|---|
| **Head-office Admin** | Home · Work: Assets, Purchase Orders, Receive, Move · People & Places: Employees, Stores, Stock Rooms, Install Points · Reports · **Settings** (collapsed) | 10 + Settings |
| **Full Admin** | Home · Work: Assets, Purchase Orders, Receive, Move · People & Places (4) · Reports | 10 |
| **Can Add & Move Assets** (IT Team, Admin / Non-IT Team or Both — the menu is the same; the data is narrowed by the server) | Home · Work: Assets, Purchase Orders, Receive, Move · Reports | 6 |
| **View Only** | Home · Work: Assets · Reports | 3 |
| **Own Assets Only** | My Assets (nothing else) | 1 |

Proposal-era counts were 24 / 11 / 9 / 4 / 1 (`CKAM_CURRENT_PRODUCT_ARCHITECTURE_2026.md` §2.2).

Notes:

* The **Settings** group is open only for the head-office admin (`canUse("settings")`). It starts collapsed and opens by itself on any Settings page (including the old `/setup/…` and `/import` addresses). In the icon-only (collapsed) sidebar the Settings icon opens the Settings landing page.
* **Add Assets, Serial Pending, Print Labels and Asset 360 have no menu entry** (section 7). A person reaches them from the Assets page, Home, the Receive result and any asset code.
* A headed Settings group is shown only when it has more than one entry (Organisation, Vendors and Users & Access have no heading of their own).

## 2. Who may open what (route guards)

`lib/access.ts` defines six areas; `guarded(area, Screen)` wraps every screen. A person outside the area gets an in-shell page, "You don't have access to this area. If you need it for your work, ask the head-office admin.", with a link to Home (or My Assets), and the screen's own data requests never fire.

| Area | Who | Used for |
|---|---|---|
| `staff` | Full Admin, Can Add & Move Assets, View Only (and the head-office admin) | Home, Assets, Reports |
| `work` | Full Admin, Can Add & Move Assets | Purchase Orders, Receive, Add Assets, Move, Serial Pending, Print Labels |
| `people` | Full Admin (the head-office admin included) | the four People & Places lists |
| `settings` | Head-office admin only | every `/settings/*` screen and `/setup/bundles` |
| `admin` | Full Admin (the head-office admin included) | Link Assets to Items (`/settings/catalogue/link-assets`) |
| `self` | Own Assets Only | `/my-assets` |
| *(not guarded)* | everyone signed in | `/assets/$id` (Asset 360 — the server decides which assets a person may open, so a self-service login can open its own from a QR label) |

## 3. All routes

56 route definitions: 37 render a screen (including login and change-password), 19 are redirect-only addresses.
`$id` / `$poId` are record numbers. Search keys that a route reads are shown in the last column.

### 3.1 System

| Path | Screen | Who | Notes |
|---|---|---|---|
| `/` | redirect | anyone | to `/login`, `/change-password`, or the person's home (`/dashboard`, or `/my-assets` for Own Assets Only) |
| `/login` | Sign in | public | `?next=<in-app path>` returns the person to the page they wanted (for example a scanned QR label's asset) |
| `/change-password` | Change password | signed in | `?next=`; forced on first sign-in; nothing else is reachable until done |

### 3.2 Daily work

| Path | Screen | Who may open it | Search keys / notes |
|---|---|---|---|
| `/dashboard` | **Home** | staff | role-aware (section 6) |
| `/assets` | **Assets** (register + Find) | staff | `q, exact, status, with, mine, item, vendor, po, area, company, group, ids, find`, and a key for the kind of person or place (Employee / Store / Stock Room / Install Point) |
| `/assets/new` | **Add Assets** | work | batch form |
| `/serial-pending` | **Serial Pending** | work | bulk paste |
| `/assets/$id` | **Asset 360** | everyone signed in (server decides) | summary + 4 sections |
| `/asset-movement` | **Move** | work | `?ids=` (comma list) and `?choice=` (`employee, stock-room, store, install, repair, from-repair, lost, found, sell, scrap, dispose`) |
| `/print-labels` | **Print Labels** (scan-and-queue page) | work | `?assets=` (comma list of asset ids) |
| `/receive` | **Receive** (queue) | work | |
| `/receive/$poId` | **Receive** (one PO) | work | `?line=` starts with only that line's quantity filled in |
| `/purchase-orders` | **Purchase Orders** | work | |
| `/purchase-orders/new` | **New Purchase Order** (one screen) | work | |
| `/purchase-orders/from-erp` | **Pick from ERP** (list, then review) | work | |
| `/purchase-orders/$id` | **PO page** (by line) | work | `#po-lines` scrolls to the lines |
| `/reports` | **Reports** (Asset register · Movements · Field change audit) | staff | on-screen preview, then Excel |
| `/my-assets` | **My Assets** | self (staff are redirected to `/assets?mine=true`) | |
| `/people/employees` | **Employees** | people | |
| `/people/stores` | **Stores** | people | includes Stores from ERP and Create missing rooms (head-office only actions) |
| `/people/stock-rooms` | **Stock Rooms** | people | |
| `/people/install-points` | **Install Points** | people | |

### 3.3 Settings (head-office admin unless stated)

| Path | Screen | Who | Notes |
|---|---|---|---|
| `/settings` | **All Settings** (landing) | settings | one card per group; "Set up CKAM · x of 7" line |
| `/settings/setup` | **Set up CKAM** (wizard) | settings | `?step=1..7` |
| `/settings/organisation` | **Organisation** | settings | `?tab=companies\|places\|cost-centres\|departments` |
| `/settings/catalogue/items` | **Items** | settings | |
| `/settings/catalogue/link-assets` | **Link Assets to Items** | **admin** (any Full Admin) | an ordinary Full Admin reaches it from Home's "N assets have no Item yet" row |
| `/settings/catalogue/asset-groups` | **Asset Groups** | settings | Categories with their Sub-categories |
| `/settings/catalogue/brands` | **Brands** | settings | |
| `/settings/vendors` | **Vendors** | settings | with *Add from ERP* |
| `/settings/users-access` | **Users & Access** | settings | links to the four People & Places lists |
| `/settings/erp/inbox` | **ERP Inbox** | settings | `?section=items\|vendors\|stores` |
| `/settings/erp/mapping` | **ERP Mapping** (advanced rules) | settings | Codes / Articles / Groups |
| `/settings/erp/sync` | **ERP Data Sync** | settings | data age, Refresh now |
| `/settings/advanced/custom-fields` | **Custom Fields** | settings | |
| `/settings/advanced/code-format` | **Asset Code Format** | settings | live example |
| `/settings/advanced/import` | **Bulk Import** | settings | |
| `/setup/bundles` | **Bundles** (sets) | settings | **direct link only, no menu entry**; the Items entry lights up |

## 4. Settings tree

Sidebar Settings group (14 entries, in this order) and the landing page are generated from the same list:

```
Settings
  All Settings                      /settings   (also lit on /settings/setup)
  Organisation                      /settings/organisation        Companies · Places · Cost Centres · Departments (tabs)
  Catalogue
    Items                           /settings/catalogue/items
    Link Assets to Items            /settings/catalogue/link-assets
    Asset Groups                    /settings/catalogue/asset-groups
    Brands                          /settings/catalogue/brands
  Vendors                           /settings/vendors
  Users & Access                    /settings/users-access
  ERP
    ERP Inbox                       /settings/erp/inbox
    ERP Mapping                     /settings/erp/mapping       (advanced mapping rules for the rare cases)
    ERP Data Sync                   /settings/erp/sync
  Advanced
    Custom Fields                   /settings/advanced/custom-fields
    Asset Code Format               /settings/advanced/code-format
    Bulk Import                     /settings/advanced/import
```

The landing page gives each entry a one-line description. The three group addresses `/settings/catalogue`, `/settings/erp`, `/settings/advanced` open the landing page.

## 5. Redirects of old addresses (all still work)

| Old address | Opens |
|---|---|
| `/dispatch` | `/asset-movement` (Move) |
| `/import` | `/settings/advanced/import` |
| `/my-assets` (as staff) | `/assets?mine=true` |
| `/setup/companies` | `/settings/organisation?tab=companies` |
| `/setup/locations` | `/settings/organisation?tab=places` |
| `/setup/departments` | `/settings/organisation?tab=departments` |
| `/setup/cost-centers` | `/settings/organisation?tab=cost-centres` |
| `/setup/categories`, `/setup/subcategories` | `/settings/catalogue/asset-groups` |
| `/setup/brands` | `/settings/catalogue/brands` |
| `/setup/items` | `/settings/catalogue/items` |
| `/setup/vendors` | `/settings/vendors` |
| `/setup/erp-articles` | `/settings/erp/mapping` |
| `/setup/custom-fields` | `/settings/advanced/custom-fields` |
| `/setup/code-rule` | `/settings/advanced/code-format` |
| `/setup/asset-users` | `/people/employees` |
| `/setup/bundles` | **not a redirect**: still renders the Bundles screen (head-office, direct link only) |
| `/settings/catalogue`, `/settings/erp`, `/settings/advanced` | `/settings` |

## 6. Home, by role (`/dashboard`)

Home asks "what needs doing", not "what are the numbers". Title **Home**; a **Work area** selector (All · IT Team · Admin / Non-IT Team) beside it is a convenience view — the server narrows to the person's own area regardless.

| Block | Full Admin, Can Add & Move Assets | View Only | Head-office Admin (additionally) |
|---|---|---|---|
| **Quick actions** | Create PO · Receive Delivery · Add Assets · Move Assets · Find Asset | Find Asset | same as Full Admin |
| **Needs attention** (rows come from one server call; a number that is not for this login simply gives no row) | POs waiting for goods → *Receive*; "the ERP shows goods arrived for N POs not yet received here" → *Receive*; "N ERP purchase orders need your input before they can be brought in" → *Review* (Pick from ERP); N assets waiting for a serial number → *Add serials*; "the ERP changed N purchase orders" → *Review*; N assets under repair / reported lost → *See them* (Assets, filtered). Full Admin and head-office admin also: "N assets have no Item yet" → *Link to Items* | under repair and lost rows only | same as Full Admin |
| **ERP Inbox** block | — | — | N new items from the ERP to link to an Item → *Decide*; N new vendors from the ERP to match → *Match*; N stores from the ERP not created yet → *Create*. Shown only when something waits and the ERP is readable |
| **Finish setting up CKAM · x of 7 steps done** | — | — | shown until all seven steps are done |
| **Assets by status** line | one line of links to the filtered Assets list (In Stock, With Employee, …) | same | same |
| **Recent changes** (8) · **Stock by Place** | yes | yes | yes |
| **Watch list** (collapsed) | Warranty Expiring Soon (30 days) · With Employee / Store Over 180 Days | same | same |

If the single "attention" call fails, Home still shows the rows it can build from its other data (no ERP rows) and no error. Own Assets Only has no Home; they land on **My Assets**.

## 7. Contextual features (reached from where the work is, not from a menu)

| Feature | How a person reaches it | Notes |
|---|---|---|
| **Add Assets** (`/assets/new`) | **Add Assets** button in the Assets header; Home quick action | batch form; result panel offers labels and "Open assets" |
| **Serial Pending** (`/serial-pending`) | **Serial Pending (n)** button in the Assets header; Home row "N assets waiting for a serial number"; the Receive and Add Assets result panels | tick rows, **Paste serials for N selected assets** with a preview "asset → serial", or **Mark N as no serial**; one all-or-nothing save; filters Item and PO |
| **Print labels** | **Print labels (n)** on the Assets selection bar; **Print Label** on Asset 360; the Move, Receive and Add Assets result panels; the PO invoices card ("Print labels for the received units") | one dialog, one settings area (`Label settings`: contents and size; remembered per browser). `/print-labels` remains as a scan-and-queue page without a menu entry |
| **Bulk Import** | Settings › Advanced › Bulk Import (and the old `/import`) | head-office admin; Excel for assets, POs, movements and the masters |
| **Asset 360** | any asset code; a scanned QR label (`/assets/<id>`) | Breadcrumb "← Assets" |
| **Move, pre-filled** | **Move (n)** on the Assets selection bar; **Move…** and the **More actions** menu on Asset 360 | opens `/asset-movement?ids=…&choice=…` |
| **Receive of one PO** | **Receive** on a Receive-queue row; **Receive** on a PO line (`?line=N`); **Receive all waiting (N)** on the PO page | |
| **Link Assets to Items** | Settings › Catalogue; Items screen header "Link existing assets"; Home row for admins | staged choices and one confirmation |
| **ERP Inbox** | Settings › ERP; Home block (links to each section) | head-office admin |
| **Item "ERP codes"** | the Items screen's ERP links column | what points at an Item, unlink, add codes |
| **Set up CKAM** | Settings landing line; Home row | resumable |

## 8. Retire / merge results against the proposal

| Proposal (`CKAM_SIMPLIFIED_INFORMATION_ARCHITECTURE.md`) | As built | Result |
|---|---|---|
| Dashboard → Home with task tiles and queues | Home (`/dashboard` address kept) | done |
| My Assets → "Mine" filter in Assets; self-service keeps one page | `/my-assets` redirects staff to `/assets?mine=true`; Own Assets Only keep `/my-assets` | done |
| Assets: one universal search, More filters, Item column | done | done |
| Add Asset → batch with essentials first | **Add Assets** (single create call is no longer used by any screen) | done |
| Asset 360 reshaped, breadcrumb, viewers without actions | 4 sections, "← Assets", no actions for View Only / Own Assets Only | done |
| Serial Pending merged into Assets as a tab | **kept as its own screen** (`/serial-pending`), reached from the Assets header and Home | differs: merged in navigation only |
| Move with plain-word choices; labels collapsed | one **Move** screen, 11 choices, Label settings closed | done |
| Print Labels contextual | one shared action everywhere; the old page stays as a queue without a menu entry | done |
| `/dispatch` retired | redirect kept | done |
| PO list with status and progress; PO page by line; one-screen manual PO; exceptions-only ERP review | all four | done |
| New **Receive** queue and receipt screen | `/receive`, `/receive/$poId` | done |
| Import → Settings › Advanced | `/settings/advanced/import` (old address redirects) | done |
| Reports with an on-screen result before Excel | three tabs with a preview | done |
| Companies / Locations / Departments / Cost Centres → one Organisation screen with tabs | done (Locations are called **Places**) | done |
| Categories + Sub-categories → one nested "Asset groups" | **Asset Groups** | done |
| Brands under Catalogue | done | done |
| Bundles merged into Items ("comes as a set") | the Item form holds the set; the Bundles screen **remains as an advanced direct-link route** (`/setup/bundles`) | done, one advanced route left |
| ERP Articles replaced by an ERP inbox + per-Item "ERP codes" | **ERP Inbox** + Item "ERP codes"; **ERP Mapping** (Codes / Articles / Groups) stays as an advanced screen | done, advanced screen kept |
| Vendors promoted (also reachable from Buy) | vendors are created in the flow; the Vendors screen stays in Settings | differs: no separate Buy entry |
| Asset Users split into Employees / Stores / Stock rooms / Install points | four lists over the same records; Settings › Users & Access links to them | done |
| Settings: Organisation · Catalogue · Vendors · Users & access · ERP · Advanced | built; plus **Link Assets to Items** in Catalogue | done |
| "Admin sees what they may change" in Settings | Settings is head-office only; a Full Admin creates records in the flow and gets People & Places | differs |
| Route guards with "ask the head-office admin" | `guarded(area, …)` with the in-shell message | done |
| Naming: one word per idea (including an umbrella word for people and places) | central `lib/labels.ts`; the umbrella word was **rejected by the owner** | done with the owner's wording (section 9) |
| Sub-category optional in the UI | the Item form hides it by choosing the group's only Sub-category; the server still requires one | partly |
| 30 screens → about 18 destinations | 37 routes render a screen; the sidebar shows 6 to 10 entries (+ the 14-entry Settings group for the head-office admin) | done in effect |

## 9. Vocabulary (one word per idea)

Every backend code is turned into words in **one module**, `frontend/src/lib/labels.ts` (statuses, place types, roles, work areas, PO statuses, serial modes, event types, audited field names), plus `lib/option-labels.ts` (how a record reads inside a dropdown). Screens call these helpers; no raw code such as `IN_STOCK`, `STOCK_POINT` or `SELF_SERVICE` reaches a screen, and an unknown future code is shown in sentence case. Payloads still carry the raw codes.

| Idea | The word on screen | Words no longer used |
|---|---|---|
| Anyone or anywhere an asset can be | **Employee · Store · Stock Room · Install Point** (plural for lists); in the data model "Asset User" | Asset User, Initial Asset User, Stock Point, "Goes Into", "Initial Custody", "Delivery location" |
| Who an asset is with | **With** (column and filter); "Currently With"; "Move To"; **Received Into** (where goods or repaired items land) | Current Asset User, Destination Asset User |
| Asset status | **In Stock · With Employee · With Store · Installed · Under Repair · Lost · Sold · Scrapped · Disposed** ("With Employee / Store" only where the kind is not known) | IN STOCK, ALLOTTED … |
| Access level | **Full Admin · Can Add & Move Assets · View Only · Own Assets Only**; the owner is **Head-office Admin** | ADMIN, OPERATOR, VIEWER, SELF_SERVICE, Primary Owner |
| Work area | **IT Team · Admin / Non-IT Team · Both** (Home's selector adds *All*) | Responsibility, My Responsibility, domain |
| Asset group | **Asset Group** (Category) › **Sub-category**; in the Item form the pair is **Type of asset** | Categories, Subcategory |
| Where | **Place** | Location |
| Money centre | **Cost Centre** | Cost Center |
| Purchase order status | **Waiting · Partly Received · Received · Cancelled** (a unit: Waiting / Received / Cancelled) | PENDING, DELIVERED |
| Serial rule | **Has serial number · No serial number · Serial will be entered later** | serial_required / serial_later |
| A purchase set | **Set** (the Item "Comes as a set") | Bundle (kept only on the direct-link screen's route name) |
| Invoice | **Purchase Invoice (PI)** spelled out once per screen | bare "PI" |
| ERP decision | **Not tracked**; **ERP Inbox**; **ERP Mapping** (advanced) | ERP Articles |
| Asset history events | Received · Imported · Moved · Sent for repair · Back from repair · Disposed · Sold · Scrapped · Reported lost · Found · Corrected | PROCURED, SENT_FOR_REPAIR … |
| Menu words | **Home · Work · People & Places · Reports · Settings** | Dashboard, Masters, Administration, "Setup >" |
| Setup words | **Asset Code Format**, **Bulk Import**, **Custom Fields**, **Users & Access** | Code Rule, Import |

A small number of internal identifiers keep the older words for compatibility (API field names, one address key on the Assets page, the route file names); no screen shows them.
