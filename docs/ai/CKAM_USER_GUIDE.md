# CKAM — How to start using it (simple guide)

Written in simple words for the people who will use CKAM every day. Menu names are exactly as on the screen.

## 1. The idea in four lines

1. We **buy** things from **Vendors** on a **Purchase Order (PO)**.
2. When the goods come, we **Receive** them. Every single unit becomes one **Asset** with its own code.
3. An asset is always **with** an Employee, a Store, a Stock Room or an Install Point. We **Move** it when it changes hands.
4. CKAM keeps the full **history** of every asset. Nothing is ever deleted.

Five words to remember: **Item, Vendor, PO, Place/Person, Asset.**

- **Item** = what the thing *is* ("Server", "Laptop", "Ceiling Fan"). It is CityKart's own name. One Item can have many ERP codes.
- **ERP code** = the code the ERP gives to a product from a vendor. A new vendor or a new configuration gets a new ERP code. CKAM remembers which Item each ERP code belongs to.
- **Asset** = one physical unit with its own asset code, serial number, price and history.

## 2. Who does what

| Person | What they do |
|---|---|
| **Head-office admin** | Does the set-up (Settings), adds vendors from the ERP, links ERP codes to Items |
| **Full Admin / Can Add & Move Assets** | Creates POs, brings ERP POs in, Receives, Adds assets, Moves, Prints labels |
| **View Only** | Looks at assets and reports |
| **Own Assets Only** | Sees only the assets that are with them |

The screen hides what you may not use, and the server checks again every time.

## 3. Set up once (head-office admin) — Settings › Set up CKAM

Seven short steps. Do them **for each company** (CKSPL and CKVPL). Progress is saved: you can stop and come back.

1. **Company** — CKSPL and CKVPL are already created. (The code can never be changed because it goes into every asset code.)
2. **Stock Room / Places** — where goods are received (for example "Head Office Stock"). Make at least one Stock Room per company.
3. **Cost Centre** — add the cost centres of each company.
4. **Asset Groups and first Items** — groups (for example "IT Fixed Assets") with Sub-categories (for example "Server"), then your Items.
5. **Vendors** — see section 4.
6. **People / Stores** — Employees and Stores. A Store is created together with its own Stock Room and Install Point.
7. **Asset Code Format** — how asset codes look. Assets cannot be added until this is saved.

**A company was switched off by mistake?** **Settings › Organisation › Companies** → **Show switched-off companies** → **Switch on again** (you confirm first). Only the company itself comes back on: its places, cost centres, people and assets are exactly as you left them. It is refused, with the reason, if another company that is on already has the same name or the same ERP code. Only the head-office admin can do this.

**"No company is switched on."** When every company is off, every screen shows a yellow note at the top saying purchase orders, assets and receiving cannot be added. The head-office admin gets a link to the Companies tab; everyone else is told to ask the head-office admin.

## 4. Add vendors from the ERP (for each company)

The ERP numbers its suppliers separately in each company. The same real supplier has a **different code** in CKSPL and in CKVPL. CKAM keeps **one vendor** and links it to the supplier code of each company.

**First company (for example CKSPL):**

1. Sign in as head-office admin → **Settings › Vendors**.
2. Click **Add from ERP**.
3. If there are two companies, choose **CKSPL** at the top.
4. Type the supplier name in the search box (name, ERP code, GSTIN or PAN all work).
5. Click **Add as vendor**.
   - If the supplier has several registrations (one per state, same PAN), they show as one group. Click **Add one vendor and link all N**.

**Second company (CKVPL) — the same supplier:**

1. Open **Add from ERP** again and choose **CKVPL**.
2. Search the same supplier name.
3. Do **not** click Add. The screen shows **Link to <your vendor> (same GSTIN)**. Click that. Now one vendor has a link in both companies.
4. Only if the supplier is not yet a vendor, click Add as vendor.

Rules to remember:
- **Never add the same supplier twice.** CKAM stops you if the GSTIN is already a vendor: link it instead.
- Nothing is ever linked by itself. A person always clicks.
- You can also add or link a vendor while reviewing a PO (see section 6) and in **Settings › ERP › ERP Inbox** ("New vendors from ERP").

## 5. Items and ERP codes ("add items from ERP")

Items are **not** copied from the ERP one by one. You make your own short list of Items once, then tell CKAM which ERP codes belong to which Item. CKAM remembers every answer.

### 5.1 Make the Items (once, head-office admin)

1. **Settings › Catalogue › Asset Groups** — check the groups and Sub-categories (for example group "IT Fixed Assets", Sub-category "Server"). Keep Sub-categories narrow.
2. **Settings › Catalogue › Items** — click Add. Fill in:
   - **Name** (for example "Server")
   - **Type of asset** (pick "Group › Sub-category")
   - **Serial** — *Has serial number*, *No serial number* or *Serial will be entered later*
   - under **More**: default brand, default warranty, **Comes as a set** (for a Desktop made of CPU, TFT, Keyboard, Mouse)

The Item decides the group, the IT / Non-IT work area, the serial rule and the warranty default for every asset made from it.

### 5.2 Tell CKAM which ERP codes belong to the Item — three ways

**Way A — while you bring in a PO (easiest, and the one most people will use).** On the review screen a line with a new ERP code says **Needs your input**. Click **Choose Item** (or **Use suggestion**), then choose how far to remember it. You answer once; next time that code is automatic. See section 6.

**Way B — all at once for one Item.** **Settings › Catalogue › Items** → on the Item click the **ERP links** button → choose the **company** → open **Add codes** → search (for example "server") → tick the codes → click **Link N to this Item**. Then choose the other company and repeat.

**Way C — in bulk.** **Settings › ERP › ERP Inbox** shows new items from the ERP in groups, each with a suggested Item. Accept the suggestions or choose another Item. **Settings › ERP › ERP Mapping** is the advanced screen for rare cases.

Each company has its **own** ERP codes. So link CKSPL's codes and CKVPL's codes separately. The **Item is shared** by both. A rule made for one company never applies to the other.

### 5.3 Things CKAM should not track

Hangers, sensor tags, cables and similar shop material are not individual assets. On the PO review click **Not tracked** for that line (choose "this code" or "this product name"). Those lines are left out of the PO. A PO made only of such lines is not offered at all.

## 6. Your case: "Server" is one Item, but every server has a different ERP code

This is exactly what CKAM is built for. **One Item "Server" can have many ERP codes.**

**One-time set-up**
1. Create the Item **Server**: Type of asset "IT Fixed Assets › Server", Serial **Has serial number**. Leave **Comes as a set** off.
2. For every server configuration the ERP has, link its ERP code to the Item "Server" in each company (Way A or Way B in 5.2).

**Which reach to choose when you "Remember"**
- **"Use this Item for this code only"** — safest for servers. Every configuration is its own code, so you answer once per configuration.
- **"Use this Item for this product name"** — only if the product name is the same.
- **"Use this Item for every code in this ERP group"** — **only if you are sure every code in that ERP group is a server.** If the group also holds other things (storage, UPS, cables), they would all wrongly become "Server".

**What you get on every server PO line**
- The **ERP code** of that configuration is filled in on the line (as the barcode), and the **ERP description** (the configuration text) comes across too. You can edit them under **More details**.
- The quantity and the rate come from the ERP (CKAM allows the rate to differ only between half and double of the ERP rate).

**After you receive them**
- **Each physical server becomes its own asset** with its own asset code, serial number, price and history.
- The **ERP code is stored on the asset** (Asset 360 › Procurement › ERP Item Code). Type that code in the search box on **Assets** to find every server of that configuration.
- Different configurations stay different assets even though they share the Item "Server".

Check this with your **first real server PO**: after Receive, open one asset and confirm that the ERP code and the configuration text are what you expect.

## 7. Bring in a PO from the ERP (Pick from ERP)

1. **Work › Purchase Orders** → **Pick from ERP**.
2. The list starts with the POs of vendors you already added. Use **Also show other suppliers' POs (N)** to see the others. Filter by company if needed.
3. Each PO says **Ready** or **Needs your input**, with the reason in words.
4. Click **Review**. Fix only what is marked:
   - **Vendor needs matching** → choose **Link to <vendor>** or **Add as vendor**.
   - **An item needs a decision** → **Choose Item** / **Use suggestion** / **+ New Item** → choose what to remember → or **Not tracked**.
5. Click **Create**. The PO, its lines, the vendor link and your remembered answers are saved in one step. If anything is refused, nothing is saved.

The PO number and date come from the ERP and cannot be edited. CKAM only **reads** the ERP and never writes to it. Every screen shows "ERP data as of <time>"; use **Settings › ERP › ERP Data Sync** (Refresh now) to update it.

You can also write a PO by hand: **Work › Purchase Orders › New Purchase Order**.

## 8. Receive the goods

1. **Work › Receive** → open the PO.
2. Fill the receipt once: **Received Into** (a Stock Room), **Invoice No**, **Invoice Date**, **Invoice Amount**.
3. For each line, type how many arrived (default: all that are waiting; 0 skips a line).
4. Serial numbers: paste or scan them only for lines that need them (one per row). "Serial will be entered later" puts the unit on **Serial Pending**.
5. Click **Receive N units**. It is **all or nothing**: if anything is wrong, CKAM lists every problem and saves nothing.
6. Use **Print labels** to print the QR / barcode labels.

## 9. Add assets that have no PO

**Add Assets** button (on Home or Assets): choose the **Item**, the **Quantity**, **Received Into** and **Cost Centre**; add serials if the Item needs them. Purchase details are folded away until you need them.

## 10. Move an asset

**Work › Move**. Scan the QR label (or search), choose what you want to do, choose the place, apply.

You only choose **where it goes**. CKAM already knows where each asset is now and shows it as **From** (and a line such as "3 from WH Stock, 2 from Ramesh" before you apply).

- **Give to Employee** — a person has it.
- **Give to Store** — the store uses it.
- **Install at HO / Warehouse** — used at a head-office or warehouse site (an Install Point, for example "HO Site").
- **Move to Stock Point** — kept as spare stock (HO Stock, WH Stock).
- **Send for Repair** — choose the **repair vendor** (a Vendor from your list). The asset shows as "With <vendor>, under repair" until it comes back.
- **Receive from Repair** — choose the vendor to see what it holds (and where each asset was sent from), tick what came back, then answer **Where do they go?**: **Back where each came from** or **Another place** (one place for all of them). CKAM asks every time; nothing is pre-selected.
- **Report Lost** · **Mark Found** (admin) · **Sell** · **Scrap** · **Dispose**.

A store's own stock room and install point (made together with the store) are not offered as places to send to: give things to the store itself.
**From any place:** an asset can be moved from a stock point, an employee, a store or a site to any other place. The **From** box in "No serial to scan? Add by Item" also accepts any of them.

Every move is written to the asset's history. You can move up to 1,000 assets at once.

**Between CKSPL and CKVPL.** An asset can be given to an employee, a store or a site of the **other company** (for example a laptop bought in CKVPL for a CKSPL employee). Whoever does it must work in both companies (an admin does). The Move screen says so when you choose such a place.
- **Owned by** is the company and cost centre the asset was bought under. It **never changes when you move it**, until the asset is sold, scrapped or disposed.
- **Currently at** is the company of the place that holds it now. Asset 360 shows it only when it is different, and the Assets list has two filters: **Owned by** and **Currently at**.
- **Received Into** (Receive and Add Assets) may be a stock room of either company; the assets stay owned by the company you bought them under.

**Repairs.** **Work › Repairs** shows, for each repair vendor, how many of your assets it holds and how long the oldest has been away; open a vendor to see each asset and where it was sent from. Assets sent for repair before vendors were recorded appear under **No vendor recorded**: find them in Assets (status Under Repair) and receive them back from Move as usual. If "Back where each came from" cannot return an asset (for example the employee has left), that asset stays in the batch with the reason: receive it into another place.

**Chose the wrong company or cost centre while receiving?** Only the platform owner or a Full Admin can fix it: open the asset → **⋯ More actions** → **Correct owner company / cost centre**, choose the right company and cost centre, and write the reason. It is kept in the asset's history ("Field changes"). It cannot be done once the asset is sold, scrapped or disposed, and the asset code never changes. **Tip:** don't put the company or the cost centre into the Asset Code Format, so a corrected asset never carries a wrong code.

## 11. Find things

**Work › Assets**: one search box. Type a serial, asset code, ERP code, PO number, vendor, Item, person or place. Open any asset to see its full history (**Asset 360**). Scanning a QR label opens the same page after sign-in.

## 12. Quick start checklist for you

1. Ask the ERP owner to restore the ERP database (CKAM cannot refresh the ERP copy until then).
2. Settings › Set up CKAM: finish all seven steps for **CKSPL**, then for **CKVPL**.
3. Add your vendors from the ERP in both companies (section 4).
4. Create the Items you buy most (Server, Laptop, Desktop, Switch…).
5. Pick **one** real ERP PO of a linked vendor. Review it. Create it. Receive it. Open one asset and check it.
6. Print a label, scan it, and Move the asset to a person or a store.
7. When that works, bring in the rest.

## 13. If something does not look right

- **The vendor window is empty** → a company is missing or switched off. Check **Settings › Organisation**.
- **A PO is not in the list** → press **Also show other suppliers' POs**, or check "ERP data as of" (the ERP copy may be old).
- **"Needs your input"** is normal for a new vendor or a new ERP code. Answer it once.
- **Create / Receive is greyed out** → the line under the button says what is missing.
- Anything else: **Settings › System › Logs** shows every error. Copy the reference shown on the error and send it to support.
