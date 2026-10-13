# CKAM — Final Operating Model (as built)

| | |
|---|---|
| Status | **As built** in the local worktree at HEAD `c656f33` (2026-10-14). Committed locally, **not pushed, not deployed** |
| Replaces | `CKAM_SIMPLIFIED_OPERATING_MODEL.md` (the proposal). Where the two differ, this document is right; the differences are listed in section 15 |
| Written from | The source (`frontend/src/router.tsx`, `lib/labels.ts`, `lib/access.ts`, `features/*`, `backend/app/core/capabilities.py` and the routers) checked against the stage reports `CKAM_SIMPLIFICATION_S0 … S6BE` |
| Language | Business words. Database words appear only in section 15 and in the guarantees |
| Companion | `CKAM_FINAL_INFORMATION_ARCHITECTURE.md` (menus, routes, vocabulary) |

## 1. The whole product in four sentences

1. We **buy Items from Vendors** on a **Purchase Order** (PO).
2. When goods arrive we **Receive** them into a **Stock Room**; every unit becomes an **Asset**.
3. An Asset is always **with an Employee, a Store, a Stock Room or an Install Point**; we **Move** it until it is sold, scrapped or disposed of.
4. Everything we ever did to it is kept in its **history**.

The nouns a CityKart employee needs are: **Item, Vendor, PO, Person/Place, Asset.**
Everything else (ERP code, mapping rule, Article, sub-category, pending unit, code format, set part) is either a
setting for the head-office admin or invisible.

Words that are deliberately **not** used on any screen: "Asset User", "Stock Point", "Responsibility",
"pending asset". The record that holds an Employee, Store, Stock Room or Install Point is still called an Asset
User inside the system (see `DECISIONS.md`, 2026-10-14), but people only ever see the four plain names.

## 2. The six verbs, screen by screen

| Verb | Screen (menu) | Who | What the person does | What it replaced |
|---|---|---|---|---|
| **Buy** | Work › **Purchase Orders**; **New Purchase Order**; **Pick from ERP** | Full Admin, Can Add & Move Assets | Write a PO on one screen, or pick an ERP PO and settle only its exceptions | A header-only "New PO" page then one dialog per line; an ERP list that hid POs |
| **Receive** | Work › **Receive** (queue) → **Receive** screen of one PO | Full Admin, Can Add & Move Assets | Say how many of each line arrived; type serials only where the Item needs them | Ticking one row per unit, a delivery dialog |
| **Add** | **Add Assets** button on Assets and on Home | Full Admin, Can Add & Move Assets | Choose the Item and how many; paste serials if the Item has them | One Add Asset form per unit |
| **Move** | Work › **Move** | Full Admin, Can Add & Move Assets | Scan or search, pick a choice (give, return, send, install, repair, lost, sell, scrap, dispose), pick the place, apply | Dropdown "Action" with a mixed list of places |
| **Find** | Work › **Assets** (one search box); **Find Asset** button on Home | Everyone who is staff (also View Only) | Type anything: serial, asset code, ERP code, PO, vendor, Item, person or place | A code-only search with six always-open filters |
| **Print** | A **Print labels** action wherever assets are shown or just created | Full Admin, Can Add & Move Assets | One dialog, one label design, prints only the labels | A menu page plus a different print path on each screen |

### 2.1 Buy

* **Purchase Orders** list: PO No, Vendor, Company, Date, Ordered, Received, Waiting, Status, Purchase Invoice (PI). Status chips
  *All · Waiting · Partly Received · Received · Cancelled*. One search box finds a PO number, a vendor name, an invoice number or a PI number
  (searched on the server; pages of 200 with "Load more"). Buttons: **Pick from ERP**, **New Purchase Order**. Above the list, the ERP data-age line shows when the ERP is set up; the cards "POs changed in the ERP" and
  "goods the ERP says arrived" appear only when there is something to act on.
* **New Purchase Order** is one screen. Header: Company (only if the person works in more than one), PO No, PO Date, Vendor, Cost Centre, Received Into
  (a Stock Room). Lines table: Item, Quantity (1 to 1,000), Unit Cost, Tax % (18 by default), Amount; **More details** per line holds description,
  barcode, brand, model, warranty (all prefilled from the Item). **+ Add line** and **+ Add set** (a set is priced once and split across its parts).
  Footer: "N lines · M units · total with tax". **Save PO** makes everything in one step or nothing; a refused line is marked with the server's sentence and
  nothing typed is lost. Result: "PO created: 3 lines, 25 units waiting."
* **Pick from ERP** lists **every** open ERP PO of the person's companies (none is hidden), each marked **Ready** or **Needs your input** with the reason
  in words, with filters, a server search and "ERP data as of <time>". See section 6.
* **A PO page is by line, not by unit.** Tiles: Lines, Ordered, Received, Waiting, Value. One row per line with Ordered / Received / Waiting / Rate / Value / Status
  and the actions **Receive**, **Edit**, **Cancel waiting**, **View units**. Header: Close, **Edit details** (PO number, PO date, vendor, cost centre,
  delivery place — what is locked after a receipt is shown with the reason), **Cancel waiting items**, **Receive all waiting (N)**. Line changes: **Edit** a line's
  details and its *Ordered* quantity (0 to 1,000, never below what is already received; lowering it cancels the newest waiting units), or **Cancel waiting** for part
  or all of what is still waiting.
* **Delete PO** is offered only while nothing has been received. Once anything is received the PO can never be deleted (for anyone, head-office admin
  included); the way out is **Cancel waiting items**. Received assets always stay in the register.

### 2.2 Receive, Add, Move, Find, Print

Described in sections 7, 8, 9; Find and Print below.

* **Find.** The **Assets** page has one search box. It looks in asset code, old code, serial, barcode, ERP item code, PO / invoice / PI number, description,
  model, Item name, vendor name, brand name, and the name and code of the person or place the asset is with. Exact matches come first, then "starts with",
  then "contains". **More filters** (count shown on the button): Status, Work area, Company (only if more than one), Item, Asset group, Currently with (Employee /
  Store / Stock Room / Install Point and a person or place), Vendor, PO number. Every choice shows as a removable chip and lives in the address, so a view can be
  shared and Back works. **Mine** shows what is with the signed-in person (not offered to the head-office admin's own account, which is not a person or place). Selecting rows offers **Print labels (n)** and **Move (n)**.
  A link such as `/assets?ids=…` shows only the assets just received or added.
* **Asset 360** (opened from any asset code or a scanned QR label): a summary strip (code, QR, status, work area, Item, With, Company) and four sections —
  Identity, Procurement, Where it is & history, and a small **More** (Documents, Field changes, Custom fields, Advanced). Each fact appears once.
  Full Admin and Can Add & Move Assets see **Move…**, **Print Label**, **Edit** and a **More actions** menu; View Only and Own Assets Only see none of them.
* **Print.** One dialog (`Print labels`) with one settings area (what the label shows: Barcode + QR, Barcode or QR; size, default 70 × 20 mm), used from the
  Assets selection bar, Asset 360, the Move result, the Receive result, the Add Assets result and the PO invoices card. It prints only the labels, not the page.
  The page `/print-labels` remains as a scan-and-queue page but has no menu entry. Label settings are remembered per browser.

## 3. The nouns

| Noun | What it is | Who creates it | Notes |
|---|---|---|---|
| **Item** | CityKart's own name for what we buy and manage ("Cassette AC", "Laptop"). **The one source of**: asset group (Category › Sub-category), work area, serial behaviour (Has serial number / No serial number / Serial will be entered later), default brand, default warranty, and whether it comes as a set | Head-office admin; Full Admin and Can Add & Move Assets **in the flow**, within their work area | Section 4 |
| **Vendor** | A supplier. One CKAM vendor can be matched to several ERP supplier codes in each company | Head-office admin, Full Admin, Can Add & Move Assets (in the flow) | Edit / deactivate: head-office admin only |
| **PO** | A purchase order: header (company, vendor, cost centre, received-into place) and lines | Full Admin, Can Add & Move Assets | |
| **Person / Place** | **Employee, Store, Stock Room, Install Point** — anyone or anywhere an asset can be with | Full Admin, head-office admin (Stock Room also in the flow by Can Add & Move Assets) | Section 10 |
| **Asset** | One physical unit, with its own code, serial, history | Receive, Add Assets, or Bulk Import | Never deleted |

## 4. One mental model: Item, ERP code, PO line, waiting units, Asset

| Word the user sees | What it is | Where it comes from |
|---|---|---|
| **Item** | What the thing *is* | CityKart's own list. Decides group, work area, serial rule, brand and warranty defaults, set or not |
| **ERP code** | The ERP's per-vendor code for a product | Not a CKAM concept for daily users. Each ERP code is **remembered as pointing at one Item** (or as *not tracked*), once |
| **PO line** | "10 Laptops at ₹55,000" | One numbered line (`1…n`) of a PO; every line has an Item |
| **Waiting** | The units of a line not yet received | Counted per line: Ordered = Received + Waiting (cancelled units are no longer ordered) |
| **Asset** | One unit that has been received or added | Made by Receive or Add Assets, carries its Item, its PO line, vendor, invoice and place |

A daily user never sees "mapping", "Article", "pending asset" or "Responsibility". "Work area" is the one word for IT / Non-IT.

**The Item is the single source.** Every path that makes an asset — manual PO, ERP review, Receive, Add Assets — reads the Item for group, work area, serial rule,
brand and warranty, so the same Item gives the same answer everywhere. The **work area** is the Item's group's work area.

The Item form is short: **Name**, **Type of asset** (one pick, "Group › Sub-category", with the work area shown as a chip), **Serial** (three plain choices),
and a **More** section: default brand, default warranty (years), **Comes as a set** (parts and their percentage shares, which must total 100), ERP codes.
A group with exactly one Sub-category is used automatically; a group with none opens "New Sub-category" for that group. Saving an Item and its set is one step.

## 5. Remembered once (every mapping and where it is asked)

| What is remembered | Asked where, and when | Who can answer | Remembered as |
|---|---|---|---|
| ERP item code (or product name, or whole ERP group) → Item | In the **PO review**, only for the lines that have no Item yet, with a one-click suggestion; or in the **ERP Inbox** in bulk | Review: Full Admin, Can Add & Move Assets, head-office admin. Inbox: head-office admin | A rule per company. Default reach is the server's suggestion ("every code in this ERP group", "this product name", "this code only"); "Don't remember" is a choice |
| ERP code / name / group → **Not tracked** | In the PO review ("Not tracked") or the Inbox | Code, product name, ERP group: Full Admin, Can Add & Move Assets, head-office admin. Department / Section / Division: head-office admin only | A rule per company; a rule that links an Item beats a broader "not tracked"; undo is head-office only |
| ERP supplier → CKAM vendor (per company) | In the **PO review** (panel "Vendor needs matching") or the **ERP Inbox** or Settings › Vendors › Add from ERP | Review: Full Admin, Can Add & Move Assets, head-office admin | A link per company and supplier code. Several ERP registrations of one company (same PAN) can be linked together |
| Item → group, work area, serial rule, brand, warranty, set | On the Item, once | See section 11 | Applied in every path |
| PO → vendor, cost centre, received-into place | Once on the PO | PO writers | Inherited by every unit received |
| Receipt → invoice number, date, amount, received-into place | Once per receipt | Receivers | Written on every asset of the receipt |
| Last Cost Centre and last Received Into | Chosen once; pre-selected next time | The person | Per person and company, **in that browser** |

**Vendor matching by GSTIN, PAN and name.** For an ERP supplier that is not yet matched the screen offers, strongest first: a vendor with the **same GSTIN**,
a vendor whose other registrations share the **same PAN** (characters 3–12 of the GSTIN), or a **similar name** (case, punctuation, LTD / PVT / LIMITED and
trailing city qualifiers ignored). **Nothing is linked unless a person clicks**; there is no automatic merge. A supplier whose GSTIN already belongs to another
vendor cannot be added twice, only linked to that vendor.

## 6. Exceptions only (the ERP flow)

The ERP stays **read-only**. CKAM works from its own copy of the ERP data and always says "ERP data as of <time>"; if a refresh fails it keeps working on the
last copy with one calm line.

1. **Nothing is hidden.** Every open ERP PO of the person's companies is listed. A PO of an unmatched supplier shows *Needs your input · Vendor needs matching*; a PO with
   undecided items shows *N items need a decision*. A PO made only of *not tracked* lines is the one thing left out, by design.
2. **The review shows only what is wrong.** A summary line (PO, date, vendor, company, cost centre, received-into place, lines, value) with **Change**. Lines whose Item is already
   known are one tidy row ("Desktop · 7 × 20,000.00 · Tax 18% · matched by ERP group") with **Details**. Only exception lines are open: the ERP's own words, **Suggested: Network Switch
   (50% match) [Use suggestion]**, **Choose Item** (or **+ New Item**), **Remember**, and **Not tracked**. A sentence at the top says what is left ("Match the vendor and 2 lines need an
   Item, then you can create the PO"), and under a disabled **Create** it says why.
3. **Create** brings in the PO, its lines, the vendor match and the remembered choices in **one step**; if anything is refused, nothing is created. The PO number and date are the ERP's
   (read-only), the quantity of a line cannot exceed what the ERP still has open, and the rate must stay within half to double of the ERP rate.
4. **A decision already in force** (a rule that exists for the company) cannot be re-pointed by anyone but the head-office admin; others can add a narrower rule ("this code only").
5. **ERP Inbox** (head-office admin; Settings › ERP › ERP Inbox, and a block on Home): three sections with counts — *New items from ERP* (by ERP group, with suggestions, bulk "Use the suggestions"),
   *New vendors from ERP* (by PAN, "Link all N to …" or "Create new vendor (links all N)"), *New stores* (ERP stores not yet created). Each entry is settled on its own and answered "done" or "not done" with the reason.
6. **ERP changes to a PO CKAM already made** (cancelled, quantity, rate, supplier) are shown on the PO and on the list; a person applies or keeps each one. This works as before this programme, except that a one-area login now sees only the POs and items of their own work area.
7. **ERP Mapping** (Settings › ERP) stays as the advanced screen for the rare cases: Codes / Articles / Groups, bulk decisions, Not tracked rules.

## 7. Receive

* **Queue** (Work › Receive): POs with units still waiting, with Waiting / Ordered / Received, search, chips *All waiting · Waiting · Partly Received*, and (when the ERP reports it) a column "ERP shows N arrived".
* **The Receive screen of one PO.**
  * **Receipt details, once**: Received Into (a Stock Room; defaults to the PO's delivery place, else the last one used), Invoice No, Invoice Date (not in the future), Invoice Amount.
  * **A quantity per line.** *Receiving now* defaults to everything waiting; 0 skips the line; the screen says how many stay waiting.
  * **Serial only where needed.** Each line shows its serial rule as three buttons: *Has serial number* / *No serial number* / *Serial will be entered later* (the Item's rule is the default; a change applies to this receipt only).
    A serial box (paste or scan, one per row, "k of n entered", duplicates marked by row, a hint when a serial is already used by another asset) appears only for lines that have serials.
    No-serial lines become "N/A"; later lines are queued on **Serial Pending**.
  * **Needed for every asset**: any custom field the company marked required, asked once for the whole receipt, or one value per asset if wanted.
  * **"Why can't I receive?"** — one line beside the button names what is missing. **[Receive N units]** (or Ctrl+Enter) is sticky at the bottom of the screen.
* **All-or-nothing.** The whole receipt is checked first. If anything is wrong, the screen lists **every** problem (common fields at the top, line problems on the line, serial problems on the exact row) and **nothing is saved**; everything typed stays.
  If the check passes, everything is saved in one transaction: units are taken oldest-first, assets get their codes with no gaps, and each asset's first history entry is written. A receipt is at most 1,000 units.
* **Result panel**: "N assets created", "N serial numbers pending — enter them later from Serial Pending", **Print labels (N)**, **Open assets**, **Receive more**, the first 20 asset codes as links.
* **Purchase Invoice (PI)**: the PO page keeps an *Invoices received* card; **Record PI** opens one dialog — *Fetch from ERP* first for ERP POs, or *Type it in*.

## 8. Add Assets (not on a PO)

One batch form: **Item**, **Quantity** (1 to 1,000), **Received Into**, **Cost Centre** — four essentials. The Item's chips show its type, work area and serial rule.
Serial box only if the Item has serials; *No serial number* and *Serial will be entered later* are one click. **Purchase details** (vendor, PO no/date, invoice no/date/amount, cost per asset, tax) and **Advanced**
(brand, model, warranty, description, barcode, old asset code when adding exactly one) are folded. Required custom fields are never folded. The same all-or-nothing rule and result panel as Receive apply, and it uses
**the same asset engine** as Receive, so an asset made either way has the same fields and the same history.

## 9. Move

One screen, **Move**. "What do you want to do?" is a list of 11 plain-word choices:

| Choice | Goes to | Result status |
|---|---|---|
| Give to Employee | an Employee | With Employee |
| Return to Stock Room | a Stock Room | In Stock |
| Send to Store | a Store | With Store |
| Install | an Install Point | Installed |
| Send for Repair | nowhere | Under Repair |
| Receive from Repair | any Employee, Store, Stock Room or Install Point (marked "Received into") | per destination |
| Report Lost | nowhere | Lost |
| Mark Found | a Stock Room (**admin only**) | In Stock |
| Sell / Scrap / Dispose | nowhere | Sold / Scrapped / Disposed |

* The destination picker lists only the matching kind. A choice that is not valid for **every** asset in the batch is switched off with the reason; a mixed batch says so in one line.
* Scan by serial, asset code, or the QR on a label; the cursor stays in the scan box. Also: search, **Add by Item** (take N of an Item from a Stock Room, with "only 8 in stock" if short), "Currently with" browse.
* **More** (closed): Date (default today, never in the future), Reference number (for example a gate-pass), Remarks. One request carries the whole batch; a refusal for one asset (for example a date before its last movement) is reported on that asset and the rest go ahead. At most 1,000 assets at a time.
* **Labels**: *Print labels as I scan* appears for **Send to Store**; the rest of the label controls sit in a closed **Label settings** line. The result panel has **Print labels (n)** and **Move more**.
* Asset 360's actions and the Assets selection bar's **Move (n)** open this same screen pre-filled (`?ids=…&choice=…`). The old Dispatch address is a redirect.

## 10. People & Places

The menu has four lists over one record type: **Employees · Stores · Stock Rooms · Install Points**. Each has the same layout: search (server), paging (50), Company filter only when the person works in more than one,
one **Add** form for that kind (no "type" dropdown), Edit, Deactivate (several at once), Company access, Reset password.

| List | Add | What is created |
|---|---|---|
| **Employees** | Code, Name, Place (an existing Place, or type a new one), optional Department, phone, email; **Can sign in** toggle with *Access level* (Full Admin / Can Add & Move Assets / View Only / Own Assets Only; default Own Assets Only), *Work Area* (IT Team / Admin / Non-IT Team / Both) and extra companies | One Employee. No password is ever typed in this form |
| **Stores** | Store code (three letters plus at most one more letter or digit, e.g. `LAM`, `SPR2`), Name, Company | **A Store, its Stock Room (`STK-<code>`) and its Install Point (`INS-<code>`)** — always all three. The Store's login email follows the rule `sm.<code>@citykartstores.com`. Running it again creates nothing and says "already existed". **Stores from ERP** (head-office admin) creates stores from the ERP site list, each with its two rooms; **Create missing rooms for existing stores** (head-office admin) repairs older stores |
| **Stock Rooms** | Name, Company, Place | One Stock Room (the same dialog as the "+ New Stock Room…" inside tasks); the same name in the same company returns the existing one |
| **Install Points** | Name, Company, Place | One Install Point (same behaviour) |

* **Logins and passwords.** A Store has a login but **no password** until one is issued. **Issue login passwords…** (Employees and Stores) gives a temporary password to the ticked accounts or to every account in the chosen company that has none;
  it is shown **once** (Copy all / Download CSV), is never stored by the screen, and each person must change it at first sign-in. Head-office admins and the person issuing are never included. **Reset password** does the same for one account.
* **Work area.** Set on a signed-in staff member (not offered for Own Assets Only). A Full Admin limited to one work area cannot give anyone a wider area than their own, and cannot change the login, access level or work area of a person whose area is wider.
* **A head-office admin account** is listed but can be changed only by a head-office admin; for everyone else the row says "Head-office admin only".
* **A person or place that still holds assets cannot be deactivated** ("X still holds 3 assets. Move them … first"). Deactivation never deletes anything.
* Settings › **Users & Access** is a small page linking to these four lists.

## 11. Roles and what each may create or do

Roles shown on screen: **Full Admin**, **Can Add & Move Assets**, **View Only**, **Own Assets Only**; the owner's account is **Head-office Admin** (it has the Full Admin role plus the head-office flag).
**Work area** (IT Team / Admin / Non-IT Team / Both) narrows what a staff login can see and do; a Full Admin can be limited to one area; an unset area means both.
The screen hides what a person may not use, but **the server decides every time**: role, company and work area are re-checked on every request.
The "what may I create" answer comes from one server call (`GET /api/auth/capabilities`) built from the same functions the endpoints enforce with.

HO = Head-office Admin · FA = Full Admin, both work areas · FA-1 = Full Admin limited to one work area · CAM = Can Add & Move Assets (in their own work area) · VO = View Only · OAO = Own Assets Only. "Own area" = the login's work area.

| Action | HO | FA | FA-1 | CAM | VO | OAO |
|---|---|---|---|---|---|---|
| Open Home, Assets, Reports | yes | yes | yes | yes | yes | no (My Assets only) |
| Open an asset (Asset 360) | yes | yes | yes | yes | yes | its own assets |
| Create / edit a PO, receive, record PI, cancel waiting, Add Assets, Move | yes | yes | own area | own area | no | no |
| Mark a lost asset Found | yes | yes | yes | no | no | no |
| Add a vendor, brand, cost centre or stock room **in the flow** (cost centre and stock room: own companies for a scoped login) | yes | yes | yes | yes | no | no |
| Link or create a vendor from an ERP supplier (own companies) | yes | yes | yes | yes | no | no |
| Unlink an ERP supplier; see the ERP supplier list | yes | no | no | no | no | no |
| Mark an ERP code / product name / ERP group *not tracked* from a PO review | yes | yes | yes | yes | no | no |
| Mark a whole Department / Section / Division not tracked; change a decision already in force; undo a rule | yes | no | no | no | no | no |
| Add an Item (with its set parts) | yes (both) | yes (both) | own area | own area | no | no |
| Add / edit / deactivate a Category or Sub-category; edit / deactivate an Item | yes (both) | yes (both) | own area | no | no | no |
| Move a Category or Item to the other work area (with a confirmation that is also shown to the head-office admin) | yes | yes | no | no | no | no |
| Edit / deactivate a vendor, brand or cost centre | yes | no | no | no | no | no |
| Define or change a set directly (Sets screen) | yes | no | no | no | no | no |
| Link existing assets to Items | yes | yes | yes (own area) | no | no | no |
| Add an Employee, Store or Install Point; edit, reset password, issue passwords, company access | yes | yes | yes, within the limits in section 10 | no | no | no |
| Change a head-office admin account | yes | no | no | no | no | no |
| Stores from ERP; Create missing store rooms; ERP Inbox; ERP Mapping; Refresh ERP data | yes | no | no | no | no | no |
| Companies, Places, Departments, Custom Fields, Asset Code Format, Bulk Import, Set up CKAM | yes | no | no | no | no | no |

Moving an asset to another company is refused for everyone (the engine's existing rule).

## 12. Settings and the Set up CKAM wizard

Settings is **one collapsed group** in the sidebar and is shown to the head-office admin only. **All Settings** is a landing page with one card per group and a "Set up CKAM · x of 7 done" line.

| Group | Entries |
|---|---|
| Organisation | **Organisation** (tabs: Companies · Places · Cost Centres · Departments) |
| Catalogue | **Items** · **Link Assets to Items** · **Asset Groups** (Categories with their Sub-categories, work area, Item counts) · **Brands** |
| Vendors | **Vendors** (with *Add from ERP*, grouped by PAN) |
| Users & Access | **Users & Access** (links to the four People & Places lists) |
| ERP | **ERP Inbox** · **ERP Mapping** · **ERP Data Sync** |
| Advanced | **Custom Fields** · **Asset Code Format** (with a live example) · **Bulk Import** |

**Set up CKAM** (`/settings/setup`) is a resumable seven-step path for a new company. Each step shows the normal screen, and a step turns "Done" when its records exist (read from the data, nothing stored):

1. Company → 2. Stock Room / Places (a Place and at least one Stock Room) → 3. Cost Centre → 4. Asset Groups and first Items → 5. Vendors → 6. People / Stores → 7. Asset Code Format (assets cannot be added until it is saved).

Until all seven are done the head-office admin's Home shows "Finish setting up CKAM · x of 7 steps done".
After set-up, daily users never open Settings; the head-office admin opens it for ERP decisions, new groups, new stores.

## 13. What stayed unchanged (the guarantees)

* **Server-side authorization is authoritative.** Hiding a button or a menu entry is convenience, not security.
* **The asset history is append-only.** Moves and edits are written to a ledger and an audit that cannot be changed or deleted; the single door that changes an asset's status or who it is with is the lifecycle service (`apply_event` / the batch `apply_events`). Receive, Add Assets and Move all go through it.
* **No hard deletes** of business records anywhere; deactivation only. Received assets can never be removed by deleting a PO.
* **Serial numbers are unique** across CKAM ("N/A" is exempt); enforced twice (checked before saving and by the database).
* **Assets move only within their own company.**
* **Item is an asset's identity**, never an ERP code.
* **The ERP is read-only**; the PO ↔ asset links, vendor and invoice snapshots on every asset, and the "ERP data as of" line are kept.
* **No schema change without a migration.** This programme added two (section 15).
* **Edits and deactivations of Categories, Sub-categories and Items, changes to an Item's set, and edits of a PO's header are audited** in an append-only table (`master_audit`), whoever makes them, the head-office admin included.

## 14. Who does what in a normal day

| Person | A normal day |
|---|---|
| **Purchase** (Full Admin or Can Add & Move Assets) | Home → **Create PO** (one screen) or **Pick from ERP**. Looks at the rows marked *Needs your input*; matches the vendor in the review with one click; uses the suggested Item or picks one; **Create**. Watches PO statuses and the "ERP changed N POs" row |
| **Delivery / receipt** (Can Add & Move Assets or Full Admin) | Home → **Receive Delivery** (or Work › Receive) → opens the PO → types the invoice once and the quantity per line → pastes serials where needed → **Receive N units** → **Print labels** → sticks them on |
| **IT admin** (Full Admin, work area IT Team) | Home attention rows (serial pending, repairs), **Add Assets** for things that did not come on a PO, **Move** to employees and stores, Serial Pending bulk entry. Adds Employees / Stores / Stock Rooms. In the flow can add a vendor, brand, cost centre, stock room and IT Items. Sees only IT work |
| **Non-IT admin** (Full Admin, work area Admin / Non-IT Team) | Same, for Non-IT work (furniture, AC, store fittings) |
| **Operator** (Can Add & Move Assets, IT Team or Admin / Non-IT Team or Both) | Receives, adds, moves and prints inside their work area; can add a missing vendor, brand, cost centre, stock room or Item without leaving the task. Cannot open People & Places or Settings |
| **Head-office admin** | Home → the **ERP Inbox** block (new items, new vendors, new stores), links existing assets to Items, Settings only for exceptions (new group, code format, imports, custom fields). Issues store passwords, creates stores from the ERP |
| **Viewer** (View Only) | Home → **Find Asset**; Assets; Reports (on-screen preview, then Excel). Sees no action buttons |
| **Self-service** (Own Assets Only) | Signs in to **My Assets** — the assets with them right now; can open one asset (including from a scanned label) and change the password |

## 15. How the build differs from the proposal, and known limits

Verified against source on 2026-10-14.

* **Level 3, not a rebuild.** Backend and data model were kept; two additive migrations were made: `b8d0f2a4c6e8` (`pending_asset.line_no`, the number of a PO line) and `c1d3e5f7a9b0` (`master_audit`, the append-only audit of work-area-owned masters).
* **Naming.** The proposal's umbrella word for people and places was rejected by the owner; screens say Employee / Store / Stock Room / Install Point, and "Asset User" is kept as the internal name (`DECISIONS.md`, 2026-10-14).
* **Receive is all-or-nothing**, not "the rest are saved" as one early sketch suggested.
* **Sub-category is still required under the hood**; the Item form hides that by choosing the group's only Sub-category.
* **Cross-company allotment** (an owner decision of 2026-10-13) is **not** part of this programme; the lifecycle engine still refuses it ("Assets can only move within their own company").
* **The screens for editing Items, Asset Groups, Brands and Vendors are head-office-only**, although the server also lets a Full Admin edit Items, Categories and Sub-categories of their own work area. A Full Admin therefore creates these only in the flow.
* **"A store always has its Stock Room and Install Point"** is guaranteed by the Add Store form, Stores from ERP and Create missing rooms. The older generic create call for a person or place (and the Excel people import) can still make a Store alone; no screen calls it.
* **Company limit for a Full Admin** (decision D6 of the audit: should an ordinary Full Admin be limited to chosen companies?) is still open; today a Full Admin works in every company.
* Production deployment and `git push` have **not** been done.
