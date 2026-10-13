# Items: what an asset IS, and how ERP item codes map to it

Decided 2026-10-10 with the user, after studying the ERP item master (3,149 Fixed
Assets item codes) and the user's `FAR MASTER.xlsx` export.

## The problem

The ERP gives a new **item code** (`CT...`) whenever the same thing is bought from
another vendor or in another spec. Across the full master, 3,149 codes collapse
into 2,026 distinct products (Article + product name) and 48% of codes have a
sibling for the same product; for the 724 codes actually bought since Sep 2025 it
is 68%. Item names are free text ("CASSETTE AC 4 TR Ref (Gas)...", "CASSETTE BLUE
STAR 4 TR", "CASSETTE AC|HITACHI|4 TON" are one product) and 23% of items have no
usable product name. So a code cannot be an asset's identity, and neither can a
name.

## The model: three layers, never mixed

1. **ERP reference (read-only, finance's language).** Division > Section >
   Department > Article > item code, shown as the ERP has it (only what has been
   bought is ever shown).
2. **Item (CityKart's own, `item`)**: what the asset is ("Cassette AC",
   "Floor Gondola", "UPS"). Points at the Category / Sub-Category that already
   drive asset codes, reports and Responsibility (these stay underneath), and
   carries: **the serial yes/no (the only place that rule lives)**, optional
   bundle (a Desktop becomes one asset per part), default brand and warranty.
3. **The asset (`asset`)**: its own brand, model, serial, vendor, price; plus
   `item_id` and `erp_item_code`. The ERP code is only a link back to the PO /
   receipt / PI, never the identity. Bundle parts keep the ERP code but have no
   `item_id` (a CPU is not the "Desktop" Item).

## Category > Sub-Category > Item (decided 2026-10-11)

| Level | Means | Example |
|---|---|---|
| Category | which group of fixed assets it belongs to, and **Responsibility** (IT / Non-IT); its code is in the asset code | IT Fixed Assets, Admin Fixed Assets |
| Sub-Category | the kind of thing, narrow enough to count in reports | Fan, Network Switch |
| Item | what people pick; many ERP item codes point to one Item | Ceiling Fan, Exhaust Fan, Wall Fan, Normal Switch, PoE Switch |

- **The serial yes/no lives on the Item only.** Category and Sub-Category have no serial setting any more
  (migration `f8b1d3e5a7c9` first copied each Item's effective answer, then dropped the two columns).
  `item.serial_required` is a plain yes/no, default yes. Still only a default: a serial can be typed on a
  "no" Item and N/A saved on a "yes" Item. Anything without an Item (old assets, Excel import) counts as yes.
- **An Item must have a Sub-Category.** The Item decides the asset's Category and Sub-Category on the
  server (`items/lookup.py::fill_from_item`): Add Asset, PO lines and bundle lines send `item_id`, and
  whatever Category the client sends is overridden. The category/sub-category path is kept only for the
  Excel import and old callers.
- **Prefer a narrow Sub-Category** ("Network Switch" with Items Normal Switch / PoE Switch) over a wide
  one ("IT H/W"): that is what the Category is for. Whether Categories follow the owning department or
  the ERP's own groups is a naming choice; the app works the same.
- **Bundle parts are Items.** The Desktop *Item* exists only to link the ERP code and carry the bundle;
  its parts (CPU, TFT, Keyboard, Mouse) are Items of their own (`bundle_part.item_id`; category and
  sub-category are copied from the part's Item). Delivered part assets carry `item_id` = CPU / TFT / ...
  and never "Desktop". A bundle Item cannot be a part, and a part Item cannot become a bundle.

## Create it where you need it

A missing linked record is created from the screen that needs it, not in another screen and back
(`components/quick-create/`, `SearchableSelect`'s "+ New ..." entry, only shown to the Primary Owner because
only they may create masters): Category (from Sub-Category and Item forms), Sub-Category (from Item form),
Item (Add Asset, PO lines, ERP review, bundle parts, ERP Articles), Brand, Vendor, Cost Centre (company
known), Location and Department (Users). Nested: Item form > New Sub-Category > New Category. Not inline:
Company (changes asset codes), Bundle, Stock-point delivery location (an Asset User).

## Mapping an ERP code to an Item (`item_map`)

Looked up most specific first:

| Rule | Matches | Used for |
|---|---|---|
| `CODE` | one ERP item code | the odd one out |
| `NAME` | the product name (CAT1, normalised) inside one Article | catch-all Articles such as `FA_IT_OTHERS` (109 unrelated codes) |
| `ARTICLE` | every code of the Article | the normal case: a new vendor code lands on the right Item by itself |

Nothing matched = the code is **unlinked**: the PO review asks for the Item once and
remembers the choice (for the Article by default; narrowable to the product name or
the code). Setup > ERP Articles lists every bought Article (136 today, 663 codes) with
a suggested Item (word overlap) so the Items can be linked in one sitting with finance.
New Articles appear about once a month; new codes inside a known Article need nothing.
Rules store a snapshot of Section / Department / Article name so an ERP rename never
changes history. The Article key is the ERP `article_code` when the item view has it,
else the article name. A deactivated Item's rules stop applying; assets keep their link.

## Two companies, two ERP masters

CKSPL and CKVPL each have their own ERP item master: the same product (a mic) has different
item codes, Sections, Departments and Articles in each, and the same Article *name* can mean
different things. So the **Item is shared, the mapping rules are per company**
(`item_map.company_id`): CKSPL's `FA_CE_MIC` and CKVPL's `VT_MIC_STD` both point to the one
Item "Mic", and a rule made for one company never applies to the other. Resolution uses the
PO's company, and at each step the company's own rule beats an every-company rule
(`company_id` NULL = two companies that share one master). Setup > ERP Articles has a Company
selector, so each company's bought Articles are linked in that company's own language, and a
choice made on a PO is remembered for that PO's company only. An asset already records its
company, so company + `erp_item_code` identifies the ERP code unambiguously.

Where the second company's data lives (found 2026-10-13): the same warehouse, in `silver.ckp_po_line`,
`ckp_pi_line`, `ckp_vendor`, `ckp_article`, `ckp_site` with a `company` column (`CKSPL` / `CKVPL`); see
`ERP_DATA_INVENTORY.md`. `gold_ckam.po_line` still holds CKSPL only. So one connection is enough, but the
ERP codes are only unique *inside* a company (vendor codes and site codes clash across the two companies;
item codes happen not to). Treat every ERP code as `(company, code)`.

## Where it shows

- **Setup > Items** (Primary Owner): create/edit/deactivate; "Create from
  Sub-Categories" makes one Item per existing Sub-Category in one click.
- **Setup > ERP Articles** (Primary Owner): link an Article to an Item; "Codes..." links
  a single code or a product name.
- **Pick from ERP > Review**: each line shows the ERP words beside the code
  ("In the ERP: DELL DESKTOP... · VANSH ENTERPRISES", Section > Department > Article),
  the Item (chosen from the mapping), and what to remember. Category, sub-category and
  bundle come from the Item on the server, never the client.
- **Asset 360**: Item (Overview) and ERP Item Code (Procurement).

## The ERP view we asked for

`gold_ckam.item` (not created yet; until then `silver.dim_item` is read, which has the
same hierarchy and CAT1..CAT6 but no `article_code`): `icode, article_code,
article_name, section, department, division, cat1..cat6, item_name, vendor_name,
unit_name, hsn_code, item_extinct, article_extinct`. `silver.dim_item` lacks the stable
numeric `article_code`, the vendor per code, unit, HSN and the extinct flags; the user's
export proves they exist in the raw master.

## Not built yet (planned, in this order)

1. ~~Add Asset (manual) and PO "Add Line" pick an Item~~ (done 2026-10-11).
2. Stores from the ERP site master as delivery locations; recently CLOSED POs in the
   picker (the ERP closes a PO when it is received).
3. Tracking mode per Item (individual / lot with quantity / not tracked): needs a
   finance policy; about 3 crore units a year (sensor tags, hangers, cash rolls) are not
   individual assets.
4. Finance asset class per Item (the ERP's depreciable ledgers: Computer, Furniture &
   Fixture, Plant & Machinery) and a register-vs-ERP reconciliation.
5. PI link: for CKSPL, `ckp_pi_line.grc_line_key` -> `fact_grc_line.po_line_key` resolves most recent FA invoices to their PO line
   (bill no / date, GSTIN). CKVPL receipts are not in `fact_grc_line`, so its invoices can only be matched by vendor + item.
