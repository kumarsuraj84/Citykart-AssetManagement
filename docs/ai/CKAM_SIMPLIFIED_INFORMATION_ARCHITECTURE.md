# CKAM — Simplified Information Architecture (proposal, not implemented)

Evidence: `CKAM_COMPLEXITY_AND_FRICTION_AUDIT.md`. Model: `CKAM_SIMPLIFIED_OPERATING_MODEL.md`.
Backend RBAC stays authoritative; everything here is what each person *sees*.

## 1. Current sidebar (exact, source-verified)

```
(no label)   Dashboard · My Assets
ASSETS       Asset Register · Add Asset · Serial Pending · Move / Dispatch · Print Labels · Purchase Orders · Import · Reports
MASTERS      Companies · Locations · Departments · Cost Centers · Categories · Sub-Categories · Vendors · Brands · Items · ERP Articles · Bundles · Custom Fields
ADMINISTRATION  Asset Users · Code Rule
```

24 entries for the head-office admin; 9 for an operator; 4 for a viewer; 1 for a self-service login.

### 1.1 What is wrong with it

| Observation | Evidence |
|---|---|
| Daily work, one-off bulk import, reporting and a decision queue are all in one group "Assets" | Import (owner, occasional) and Reports sit beside Add Asset and Move |
| **ERP Articles** — a de-facto daily queue for the PO user's owner — is buried 10th in Masters | 850 undecided codes in dev |
| 12 of 24 entries are one-time configuration but are permanent sidebar items | Masters + Administration |
| Locations and Departments are screens nobody uses except while creating an Asset User | used only by `asset_user` |
| Names disagree: Cost Centers/Centre, Sub-Categories/Subcategory/"Asset Subcategories", "Setup >" in 12 messages for a menu that does not exist, "Asset Users" for people + stores + rooms + install points | frontend map §8 |
| Operators open `/setup/*` by URL and see working buttons that fail | no route guards (measured) |
| Asset 360 has no menu entry, no breadcrumb | – |
| "Print Labels" and "Serial Pending" are menu items although they are views of assets | – |

## 2. Classification of every entry

| Entry | Class | Frequency | Keep as | Destination |
|---|---|---|---|---|
| Dashboard | Reporting → **Home** | daily | **Home** (task tiles + queues) | HOME |
| My Assets | Daily (self-service) | daily | filter "Mine" in Register; stays the only Home page of self-service logins | ASSETS |
| Asset Register | Daily | daily | **Assets** | WORK |
| Add Asset | Daily | daily | button inside Assets (+ Home tile) | WORK › Assets |
| Serial Pending | Daily queue | daily | tab/filter in Assets + Home queue | WORK › Assets |
| Move / Dispatch | Daily | daily | **Move** | WORK |
| Print Labels | Daily utility | daily | contextual **Print labels** action + one queue page | WORK › Move/Assets |
| Purchase Orders | Procurement | daily | **Purchase Orders** | WORK › Buy |
| (new) Receive | Procurement | daily | queue of POs with goods waiting | WORK › Buy |
| Import | Bulk setup | occasional | Settings › Advanced › Bulk import | SETTINGS |
| Reports | Reporting | weekly | **Reports** | REPORTS |
| Companies | Setup | once | Settings › Organisation | SETTINGS |
| Locations | Setup | rare | Settings › Organisation › Places (tab) | SETTINGS |
| Departments | Setup | rare | Settings › Organisation (tab) | SETTINGS |
| Cost Centers | Setup | rare | Settings › Organisation (tab) | SETTINGS |
| Categories + Sub-Categories | Setup | rare | one screen "Asset groups" (Category › Sub-Category nested); also created in the Item dialog | SETTINGS › Catalogue |
| Items | Setup / occasional | weekly | **Items** (with serial rule, group, bundle) | SETTINGS › Catalogue |
| Brands | Setup | rare | Settings › Catalogue (tab) | SETTINGS › Catalogue |
| Bundles | Setup | rare | inside Items ("comes as a set") | SETTINGS › Catalogue |
| Vendors | Setup / occasional | weekly | **Vendors** (ERP matches shown on the vendor) | SETTINGS (promoted: also reachable from Buy) |
| ERP Articles | decision queue | daily in practice | **ERP inbox** (exceptions only) + per-Item "ERP codes" | SETTINGS › ERP |
| Asset Users | Admin | weekly | split view: Employees · Stores · Stock rooms · Install points | PEOPLE & PLACES |
| Custom Fields | Advanced | once | Settings › Advanced | SETTINGS › Advanced |
| Code Rule | Advanced | once | Settings › Advanced (with live example) | SETTINGS › Advanced |

## 3. Proposed sidebar

```
HOME                       (task tiles + "needs your attention" queues)

WORK
  Assets                   (Register · + Add assets · Serial pending · Mine)
  Purchase Orders          (list · + New · Pick from ERP)
  Receive                  (POs waiting for goods)
  Move                     (move / allot / return / install / repair / scrap · scan · print labels)

PEOPLE & PLACES            (head-office admin and Admin)
  Employees · Stores · Stock rooms · Install points

REPORTS
  Dashboard & Reports

SETTINGS                   (head-office admin; Admin sees what they may change)
  Organisation             Companies · Places (locations) · Cost centres · Departments
  Catalogue                Items · Asset groups · Brands
  Vendors
  Users & access
  ERP                      Inbox (new items · new vendors · new stores) · Connection & sync
  Advanced                 Custom fields · Asset code format · Bulk import
```

Counts: head-office admin 24 → **8 top-level entries** (Home, 4 in WORK, People & Places, Reports, Settings; the last two open to 4 and 6 sub-entries, so 16 if you count every leaf, never all visible at once) ·
operator 9 → **6** (Home, Assets, Purchase Orders, Receive, Move, Reports) · viewer 4 → **3** · self-service stays **1**.
Settings is one collapsed group, not 14 permanent items.

## 4. Navigation by kind of user (what each is shown)

| User | Sees |
|---|---|
| **Purchase user** (operator, Admin team or both) | Home · Purchase Orders · Receive · Assets (read) |
| **Delivery / receipt user** | Home · Receive · Move · Assets |
| **IT admin / IT operator** | Home · Assets · Purchase Orders · Receive · Move · Reports (work area IT only; menu identical, data scoped server-side) |
| **Admin / Non-IT operator** | same, work area Admin team |
| **Admin** | the above + People & Places + Users & access |
| **Head-office admin (Primary Owner)** | everything + Settings (all groups) |
| **Viewer** | Home · Assets · Reports |
| **Self-service (employee/store login)** | **My assets** (single page) |

Role-aware Home (§6) is what makes the shorter menus workable.

## 5. Screen retire / merge / move matrix (30 screens; no capability removed)

| Today | Action | Result |
|---|---|---|
| `/dashboard` | **Transform** | Home: task tiles + queues; counts become secondary |
| `/my-assets` | **Merge** | "Mine" filter in Assets; self-service Home = this view |
| `/assets` | Keep, **upgrade** | one universal search (serial, asset code, barcode, ERP code, Item, vendor, PO, holder) + "More filters"; Item column |
| `/assets/new` | Keep, **reshape** | Essentials first, quantity, optional "Purchase details" and "Advanced"; Item fills the rest |
| `/assets/$id` | Keep, **reshape** | Summary → Identity → Procurement → Where it is/History; Documents/Changes/Custom fields under "More" |
| `/serial-pending` | **Merge** | tab of Assets + Home queue; bulk entry |
| `/asset-movement` | Keep | **Move**; label settings collapse under "Labels…" |
| `/print-labels` | **Make contextual** | "Print labels" action on Assets, Move, Receive result; page remains as a queue |
| `/dispatch` | **Retire** | already a redirect |
| `/purchase-orders` | Keep, **upgrade** | add status (waiting / partly / done), company, progress |
| `/purchase-orders/new` | **Merge** into one screen | header + lines table (Item, qty, cost) on one page |
| `/purchase-orders/from-erp` | Keep, **reshape** | exceptions-only review |
| `/purchase-orders/$id` | **Reshape** | lines (ordered/received/waiting), not units; Receive button; ERP changes as one card |
| (new) Receive queue + receipt screen | **Add** | replaces the tick-rows delivery |
| `/import` | **Move** | Settings › Advanced |
| `/reports` | Keep | add on-screen result before Excel |
| Companies, Locations, Departments, Cost Centers | **Merge** | one Settings › Organisation screen with tabs |
| Categories + Sub-Categories | **Merge** | one nested "Asset groups" screen |
| Brands | **Move** | Settings › Catalogue |
| Items | Keep, **reshape** | add serial mode in plain words, "comes as a set" (absorbs Bundles), "ERP codes" panel |
| Bundles | **Merge** into Items | single place to define sets |
| ERP Articles (Codes/Articles/Groups/Codes…) | **Replace** | ERP inbox of exceptions + "ERP codes" tab on each Item; the Groups (not tracked) tool remains under ERP › Rules |
| Vendors | Keep, **upgrade** | matching by GSTIN/PAN, all registrations of one company grouped |
| Custom Fields, Code Rule | **Move** | Settings › Advanced |
| Asset Users | **Split (presentation only)** | Employees, Stores, Stock rooms, Install points over the same table/API |
| Login, Change password | Keep | – |

Result: 30 screens → **~18 destinations**, none of the 41 dialogs' underlying functions removed.

## 6. Home (task-based)

```
Good morning, <name>                              ERP data as of 2:43 pm   [Refresh]
 [ Create PO ] [ Receive delivery ] [ Add assets ] [ Move assets ] [ Find asset ]

 NEEDS ATTENTION                          (each row opens the work, role-aware)
  3 POs waiting for goods ........................ Receive
  7 assets waiting for a serial number ........... Serial pending
  2 POs changed or cancelled in the ERP .......... Review
  4 ERP POs wait for a vendor match .............. Match
  1 asset under repair > 30 days; 2 reported lost  Assets
 ADMIN INBOX (head-office admin): 5 new items from ERP · 1 new vendor · 2 new stores
 WHAT CHANGED     last 5 events
 STOCK            by place (small)
```
Statuses move to the Assets filter; the Dashboard's status tiles, Exceptions table and Warranty/Allotted lists become small links or reports. "My Responsibility" is replaced by the user's own work area by default.

## 7. Settings tree (conceptual)

| Group | Contents | Who | How often |
|---|---|---|---|
| Organisation | Companies · Places · Cost centres · Departments | head-office admin | once |
| Catalogue | Items (incl. serial mode, set/bundle, default brand/warranty) · Asset groups · Brands | head-office admin; Items/brands creatable in-flow by Admin and Operator | weekly |
| Vendors | vendors with their ERP matches | head-office admin; creatable in-flow | weekly |
| Users & access | People & Places records, logins, role in plain words, work area, companies | Admin | weekly |
| ERP | Inbox (new items · new vendors · new stores) · Connection & sync · Not-tracked rules | head-office admin | exceptions |
| Advanced | Custom fields · Asset code format (with live example) · Bulk import | head-office admin | once / rare |

### 7.1 First-time "Set up CKAM" wizard (supported by the evidence)

Today: 10 screens, ~41 fields, errors that appear only at the first asset. Wizard order that removes every ordering trap:
1 Company → 2 Stock room (creates the Place it needs) → 3 Cost centre → 4 Asset groups and first Items (pick from templates, Sub-Category optional) → 5 Vendors (from ERP or manual) → 6 People (employees, stores from ERP) → 7 Asset code format (live example, blocks invalid tokens).
Every step reuses the normal Settings forms; the wizard is only an ordered, resumable path.

## 8. Naming (one word per idea)

| Idea | Use | Stop using |
|---|---|---|
| who/where an asset is with | **Holder** (people & places) | Asset User, Initial Asset User, Goes Into, Initial Custody, Delivery location |
| a place that stores things | **Stock room** | Stock Point |
| a place where things are installed | **Install point** | Installed |
| IT vs Admin work area | **Work area** (IT team / Admin team / Both) | Responsibility, domain |
| the purchase invoice | **Purchase invoice (PI)** spelled out once | bare "PI" |
| not an asset for us | **Not tracked** (kept) | – |
| statuses | In stock · With a person · Installed · Under repair · Lost · Sold · Scrapped | IN_STOCK, ALLOTTED… |
| Settings | **Settings** | Setup, Masters, Administration |
| spelling | Cost centre, Sub-category (one each) | Cost Center/Centre, Subcategory |

## 9. Route guards

Add a route-level guard that hides `/setup/*`, `/import` and People & Places from users the server would refuse, and shows "Ask the head-office admin" instead of a screen with failing buttons. UX only; the server remains the authority.

## 10. Contextual instead of permanent

| Today (permanent menu) | Becomes (contextual) |
|---|---|
| Print Labels | action on any asset list/selection and on the receipt result |
| Serial Pending | tab on Assets + a Home queue |
| Import | only inside Settings › Advanced |
| ERP Articles | a Home inbox badge and the Item's "ERP codes" tab |
| Asset 360 | opened from any asset reference; breadcrumb added |
| Bundles | an Item property |
