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
   carries: serial default (Item > Sub-Category > Category), optional bundle (a
   Desktop becomes one asset per part), default brand and warranty.
3. **The asset (`asset`)**: its own brand, model, serial, vendor, price; plus
   `item_id` and `erp_item_code`. The ERP code is only a link back to the PO /
   receipt / PI, never the identity. Bundle parts keep the ERP code but have no
   `item_id` (a CPU is not the "Desktop" Item).

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

Open until the second company's data exists: where its item master / POs / receipts live (the
same warehouse with a `company_code` column, or another database, in which case the ERP source
becomes one connection per company) and its company code (CKVPL in the masters). Today the
warehouse holds only CKSPL's data (13,256 PO lines, all `CKSPL`); other CityKart entities appear
only as site and creditor names.

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

1. Add Asset (manual) and PO "Add Line" pick an Item instead of Category/Sub-Category.
2. Stores from the ERP site master as delivery locations; recently CLOSED POs in the
   picker (the ERP closes a PO when it is received).
3. Tracking mode per Item (individual / lot with quantity / not tracked): needs a
   finance policy; about 3 crore units a year (sensor tags, hangers, cash rolls) are not
   individual assets.
4. Finance asset class per Item (the ERP's depreciable ledgers: Computer, Furniture &
   Fixture, Plant & Machinery) and a register-vs-ERP reconciliation.
5. PI link (no PO/GRC link for a purchase invoice exists in any layer readable today).
