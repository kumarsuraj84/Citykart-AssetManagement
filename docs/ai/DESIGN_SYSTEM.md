# CKAM — Design System

CKAM has its own visual identity, separate from any other CityKart
application. Reference apps (e.g. Citykart Desk) are studied for structural
principles only — never copied for exact branding/colors/components.

## Tokens

Source of truth: `frontend/src/styles.css` (`:root`, authoritative —
`frontend/src/design-tokens/tokens.css` is a generic starter kit imported
first and then largely overridden; keep both in sync when changing a value
either file also defines, but treat `styles.css` as what actually renders).
All colors are OKLCH, light theme only.

- **Primary** — deep navy `oklch(0.32 0.085 258)`. CKAM's own identity,
  dominant chrome/heading color.
- **Secondary/accent** — the original brand teal `oklch(0.465 0.083 218)`
  (`--teal`), used sparingly for accents — never the dominant color.
- **Background/canvas** — flat `--muted` (`oklch(0.955 0.012 250)`), applied
  to `body`. No decorative gradients on operational surfaces.
- **Status** — `--success` / `--warning` / `--destructive` / `--info`, each
  with a `-soft` pastel variant for chips/badges. Not yet used consistently
  everywhere a status is shown (see `REVIEW_FINDINGS.md`).
- **Sidebar-specific** — `--sidebar` (white), `--sidebar-accent` (=
  `--primary-soft`, active/hover tint), `--sidebar-accent-foreground` (=
  `--primary`).

A much larger token surface exists in `tokens.css` (chart palette, trust-mode
colors, per-section accents, avatar palette) inherited from the generic
starter kit and currently unused by CKAM's own screens. Don't feel obligated
to use all of it; trim only if it becomes actual clutter.

## Component sizing standard

Every shared form primitive in `frontend/src/components/ui/` targets ~40px
on desktop (AM-13: reduced from an earlier ~44px pass — a compact
enterprise-operational density, not a touch-first one):
- `Input`, `Select` (`SelectTrigger`): `h-10` (40px)
- `Button`: default `h-10`, `sm` `h-9`, `lg` `h-11`, `icon` `h-10 w-10`
- `Textarea`: `min-h-[80px]`
- `Checkbox`, `RadioGroupItem`: `h-5 w-5` (20px, up from the shadcn default 16px — unchanged by AM-13, already compact)

Focus state (all of the above): border color shifts to `--ring` **and** a
soft `ring-[3px] ring-ring/25` glow appears — never rely on the browser
default outline. Hover (pre-focus): border shifts toward `--ring` at 50%
opacity. This pattern is defined per-component, not as a shared utility —
if you add a new form primitive, match it by hand.

**When adding any new input-like control, use these exact classes/heights.
Do not introduce a differently-sized field.**

## Density & typography system (AM-13)

Established during the AM-13 UI density/professionalization pass — the
source of truth for any new component's spacing/sizing, so it stays
coherent instead of drifting page-by-page.

- **Typography scale**: `body` 14px / line-height 1.5 (`styles.css`,
  global). Page `<h1>` stays `text-lg` (18px) via `PageHeader` — unchanged
  by AM-13, it was already this restrained. Dialog title `text-lg` (18px,
  `DialogTitle`). Card title `text-base` (16px, `CardTitle` — AM-13 made
  this explicit; it previously had no size class and rendered ~15.5px by
  inheritance only, which happened to look right but wasn't a documented
  contract). Section heading (Add Asset/Import pattern): `text-sm
  font-semibold uppercase tracking-wide text-muted-foreground` (14px),
  unchanged. A bare `<h1>`/`<h2>`/`<h3>` with no explicit Tailwind
  `text-*` class falls back to a restrained 24px/20px/18px scale
  (`styles.css` `@layer base`) — normalized from the old
  generic-starter-kit values (`h1` up to a `clamp(2rem,3.2vw,2.75rem)`,
  `h2` 1.6rem) that no real heading in the app actually depended on
  (verified by grep before changing it), but which were a landmine for
  the next raw heading tag. Login/Change Password keep their own slightly
  larger `sm:text-3xl` title — auth screens are intentionally a little
  more spacious than operational ones, not covered by the operational
  scale above.
- **Control height**: see "Component sizing standard" above — 40px desktop
  for `Input`/`Select`/`Button`/default `Textarea` padding.
- **Card padding**: `CardHeader`/`CardContent`/`CardFooter` all `p-4`
  (16px; was `p-6`/24px). This was the single largest contributor to the
  pre-AM-13 "giant cards" complaint — Dashboard stacks a header + content
  per card, so the old value doubled to 48px+ of padding per section.
- **Page gutters**: `<main>` in `AppShell` (`router.tsx`) is `p-4 md:p-6`
  (16px mobile / 24px desktop) — unchanged by AM-13, already within the
  target range.
- **Section/page gap**: `gap-4`–`gap-5` between major page sections
  (Dashboard's outer container: `gap-6`→`gap-4`; Add Asset's outer
  container: `gap-6`→`gap-5`). Add Asset's own section-internal gap
  (heading → field grid) stays `gap-4` (16px) — already within range.
- **Form field gap**: `FormField`'s own label→control gap stays `gap-1.5`
  (6px) — already within the AM-13 target (6-8px), unchanged. A field
  grid's row gap stays `gap-4` (16px) — already within range, unchanged.
- **Form grid pairing**: a field with no natural Number/Date (or similar)
  partner should span the full row (`sm:col-span-2`) rather than sit in
  the first slot of a 2-column grid, which silently offsets every pair
  after it by one slot. Add Asset's Vendor field was fixed this way
  (AM-13) so PO Number/PO Date, Invoice Number/Invoice Date, and PI
  Number/PI Date actually align as the pairs they are.
- **Dialog/AlertDialog sizing**: `max-h-[85vh] overflow-y-auto` on
  `DialogContent`/`AlertDialogContent` (was unbounded — a genuine defect,
  not just density: a long dialog could previously grow past the viewport
  with Cancel/Save unreachable and no scrollbar at all). The whole dialog
  scrolls as one unit (header and footer scroll with it) rather than a
  pinned-header/pinned-footer/scrolling-body layout — the simpler, safe
  choice that works for every existing dialog's DOM shape without
  retrofitting each call site's internal structure. Padding `p-5` (was
  `p-6`).
- **Table row height**: `TableHead h-10` / `TableCell p-2` (`table.tsx`)
  were already compact and were not changed by AM-13 — they were never
  part of the "oversized" complaint; the complaint was Card padding and
  control height, not the table primitive itself.
- **Responsive**: unchanged by AM-13 — every existing `sm:`/`lg:` grid
  collapse (Add Asset's 2-column field grid, Dashboard's paired-card
  rows) was verified live to still collapse to one column correctly at
  375px, since the pairing/sizing changes only touch spacing values
  inside the same responsive classes, never the breakpoints themselves.

## Visual composition system (AM-14)

Established during the AM-14 complete-visual-redesign pass, on top of
AM-13's density/typography system above — the source of truth for surface
treatment, form-control skin, status chips, and section/toolbar
composition going forward.

- **Surfaces are structure via border, not elevation via shadow.** `Card`
  is `rounded-md border bg-card shadow-sm` (was `rounded-xl`/`shadow`) —
  a work surface reads as bordered and quiet, not "floating." A real
  shadow (`shadow-lg`) stays reserved for genuinely floating surfaces:
  `Dialog`/`AlertDialog`, `DropdownMenu`, `Popover`, `Select` content.
  Never add a visible shadow to an ordinary Card-based section.
- **Form fields are quiet/filled at rest.** `Input`/`Select`
  (`SelectTrigger`)/`Textarea` are `bg-muted/50` with a transparent border
  at rest, `bg-muted` on hover, and only firm up to `bg-background` with a
  visible `border-ring` on focus. This replaces a plain bordered-white-box
  look (the single biggest contributor to a "default shadcn" feel) with a
  more considered field treatment, derived from the CitykartDesk reference
  app's own request-form fields — never copy that app's colors or source,
  only this structural idea. `rounded-sm` (8px, was `rounded-md`/10px) on
  the same three controls, matching the radius scale below.
- **Radius scale**: Inputs/Select/Textarea `rounded-sm` (8px). Cards
  `rounded-md` (10px). Dialogs `rounded-lg` (12px, unchanged — already
  correct). Badges/status chips `rounded-full` (pill). Don't introduce a
  fourth radius value without updating this list.
- **Status/semantic chips are pill-shaped.** `Badge`'s base
  (`components/ui/badge.tsx`) is `rounded-full`, no shadow — every
  consumer (`StatusBadge`, Purchase Order lines' `LineStatusBadge`, any
  future badge) inherits this from the one shared primitive. Never round
  a status chip differently per screen.
- **`SectionHeading`** (`components/shared/SectionHeading.tsx`): a small-
  caps muted label with a hairline rule trailing to the right — the
  "quiet separator" for a sectioned form or numbered-step page (Add
  Asset's 7 sections, Import's 4 steps). Replaces a bare `<h2
  className="text-sm font-semibold uppercase tracking-wide
  text-muted-foreground">` plus a separate full-width `Separator` between
  sections — use `SectionHeading` for any new sectioned page instead of
  reintroducing the bare-heading-plus-Separator pattern by hand.
- **Toolbar band**: a page's search/filter controls and its view-option
  controls (e.g. a "Columns" picker) share one `flex flex-wrap items-end
  justify-between gap-3 rounded-md border bg-muted/40 p-3` band — see
  Asset Register. Don't let a filter row and a nearby action float as two
  structurally unrelated rows; group them in this band when a page has
  both.
- **Sidebar group labels**: `text-[11px] font-semibold uppercase
  tracking-wide text-sidebar-foreground/60`, `mt-2` — matches
  `SectionHeading`'s own label treatment so a sidebar group and a form
  section read as the same kind of structural label, not two unrelated
  styles.
- **Button hierarchy**: one primary (solid, default variant) action per
  context; a secondary navigation/dismissal action is `variant="outline"`;
  a low-emphasis in-context action (e.g. "Cancel" inside an expanded
  inline form, as opposed to a Dialog's own footer Cancel) is
  `variant="ghost"`. Never place two solid/default-variant buttons next to
  each other — see Purchase Order detail's header (`Close` outline +
  `Mark Delivery Done` solid) for the reference shape.
- **KPI/summary tiles** (a smaller, denser sibling of Dashboard's own
  `Card`-based KPI, for a page that needs a compact at-a-glance summary
  row rather than a full KPI grid): `rounded-md border bg-card px-4 py-3
  shadow-sm` containing a `text-xs font-medium text-muted-foreground`
  label and a `text-xl font-semibold` value — see Purchase Order detail's
  `SummaryTile`. Reach for this, not a full `Card`/`CardHeader`/
  `CardContent`, when the tile is just label+number with no description
  or table inside it.
- **A field with no backend-provided derived data stays off a list
  column** rather than being approximated or guessed client-side (Purchase
  Orders list's Pending/Delivered/Value were deliberately left off — see
  `AM-14_COMPLETE_VISUAL_REDESIGN_REPORT.md` §23/§50) — reading an
  already-returned-but-unused API field onto a column is fine (zero cost,
  zero risk); computing an aggregate that needs N extra requests or a
  backend change is a decision for the stage that actually authorizes
  that backend change, not something to route around silently in a
  visual-only pass.

## App shell

`AppShell` in `frontend/src/router.tsx`: light top header (logo + collapse
trigger + account controls) + collapsible left sidebar (shadcn `Sidebar`
primitive, `collapsible="icon"`) + main content area.

- Header is **light** (`bg-background`), not dark — the logo is a
  transparent PNG with dark navy/red content and no light plate behind it,
  so it needs a light background to stay legible. Don't make the header
  dark again without also redesigning the logo.
- Sidebar nav is grouped (`SidebarGroup` + `SidebarGroupLabel`): an
  ungrouped top section (Dashboard, My Assets), then "Assets", "Masters",
  "Administration" — mirrors the same role-gating as before
  (`WRITE_ROLES`/`REPORT_ROLES`/ADMIN-only), just restructured from a flat
  nav + dropdown.
- Mobile: the `Sidebar` primitive automatically swaps to a `Sheet` slide-in
  drawer below the `md` breakpoint — no custom mobile nav code needed.
- `SidebarNavItem` (in `router.tsx`) computes active state via
  `useLocation().pathname === to` (exact match, not prefix — so `/assets`
  doesn't light up while viewing `/assets/new` or an asset detail page).
- `SidebarInset` (`components/ui/sidebar.tsx`, the `<main>` wrapper) carries
  `min-w-0` (AM-04) — without it, a page whose content is wide enough (e.g.
  a header with several inline actions) silently forces the whole page
  wider than the viewport at exactly 768px, where the sidebar is docked but
  the viewport is still narrow. See `DECISIONS.md`.

## Shared components (AM-03)

`frontend/src/components/shared/`: `PageHeader`, `DataTable`, `StatusBadge`,
`EmptyState`, `ErrorState`, `AsyncButton`, `FormField`. Proven on Dashboard,
Asset Register, Add Asset and Asset 360 (AM-03/AM-04), every master screen/
Custom Fields/Holders/Code Rule (AM-05), and now (AM-06) Import, Reports,
and My Assets — every screen in the app uses this foundation. `DataTable`
presents rows/loading-skeleton/empty/error states and an optional
pagination footer; it never owns fetching, query state, sorting, or
filtering — the page keeps that. `StatusBadge` maps the 8 `Asset.status`
values to a semantic tone (info/success/warning/destructive/neutral) via
the existing `--*-soft`/`--on-*-soft` tokens, always alongside the status
name as text, never color alone.

## Sectioned enterprise forms (AM-04)

Add Asset's pattern for a long data-entry form: restrained grouping via a
`text-xs font-semibold uppercase tracking-wide text-muted-foreground`
section heading + a `grid gap-4 sm:grid-cols-2` field grid + a `Separator`
between sections — never a `Card` per section, never one card per field.
Every field is a `FormField` (label/required-marker/helper-or-error-text/
spacing), never a bare `<Input>` with only a placeholder standing in for a
label. A `Select` whose `id` is used by `FormField`'s `htmlFor` should also
carry a matching `aria-label` on its `SelectTrigger` — the visible label and
the accessible name should say the same thing.

## Dynamic UDF (Custom Field) controls (AM-04)

One rendering rule per `CustomField.field_type`, always `sort_order`-
respecting, active definitions only: `text`→`Input`, `number`→`Input
type="number"`, `date`→`Input type="date"`, `dropdown`→`Select` populated
from `options.choices`, `checkbox`→`Checkbox` (paired with a `<label>`, not
wrapped in `FormField`, since a checkbox has no separate helper/error slot
in this pattern). A field's required marker/error text comes from the same
`FormField` component every other field uses. Used identically in both Add
Asset (create) and Asset 360's Edit mode (update) — not two parallel
implementations.

## Asset 360 information hierarchy (AM-04)

`PageHeader` (Asset Code as title, Description as description, Status/
current-Holder+type+location and lifecycle action buttons in the actions
slot) + tabs: Overview, Procurement, Custody, Custom Fields, History
(lifecycle `Timeline`, unchanged), **Changes** (the field-change audit —
kept visually distinct from History, never merged into it), Documents
(unchanged). Read-only content inside a tab uses a `<dl>`/`ReadField`
label-value grid (`text-xs text-muted-foreground` label, `text-sm` value,
em-dash for empty), not a table, since each tab shows one asset's own
attributes, not rows of many assets.

## Edit mode (AM-04)

A role-gated (ADMIN/IT_TEAM) "Edit" button in `PageHeader`'s actions slot
swaps the tabbed read view for a single, un-tabbed edit panel (same
`FormField`/`Separator`/section-heading pattern as Add Asset) with Save
(`AsyncButton`) / Cancel actions. Only the AM-02-approved editable
descriptive/procurement fields ever appear as controls — identity and
lifecycle fields are simply not present in the edit form, not disabled
controls a curious user could inspect. Because `PUT /api/assets/{id}` is a
full-replace endpoint (see `DECISIONS.md`), Edit mode always prefills every
editable field (including the full current `custom_fields` set) before
allowing Save — never a partial diff.

## Master list screens (AM-05)

`MasterCrudScreen<T>` (7 of 8 simple masters) and the bespoke
`CustomFieldsScreen` share one pattern: `PageHeader` (title + "Add X" as the
sole primary action) → `DataTable` (business columns + a trailing icon-only
actions column, `Pencil`/`Trash2`, each with a row-specific `aria-label`
like "Edit Vendor One" — never a bare "Edit" when several rows are on
screen) → a Create `Dialog` and a separate Edit `Dialog`. A master's
`MasterConfig` carries `editFields`, a strict subset of `formFields`
matching its backend `*EditIn` schema; a field left out of `editFields`
(e.g. an immutable `code`) is shown read-only at the top of the Edit dialog
in a bordered `bg-muted/50` block with a one-line "Not editable after
creation." note, not silently omitted — the admin can still see it, just
not change it.

## Destructive confirmation (AM-05)

Deactivating a master, a Custom Field, or a Holder never fires directly
from the row action — it opens an `AlertDialog` (`AlertDialogTitle` names
the specific record, e.g. "Deactivate Vendor One?"; `AlertDialogDescription`
states the effect in plain language and that it's reversible by an
administrator) with `Cancel` / a destructive-styled `AlertDialogAction`
(`bg-destructive text-destructive-foreground`). This is the one dialog
pattern in the app that's allowed to skip `FormField` entirely, since it
has no form fields.

## Custom Field scope selector (AM-05)

`CustomFieldsScreen`'s Scope control is role-shaped, not just
value-shaped: ADMIN gets a real `Select` with "Global (all companies)" plus
every company; IT_TEAM gets a disabled, read-only `Input` pre-filled with
their own company's name — never a `Select` they could open to see (or try)
other values they aren't authorized for. The Scope column in the list
itself always renders a human name ("Global" or the company's name), never
a raw `company_id`. Flipping a field from optional to required goes through
its own `AlertDialog` confirmation before the PUT fires — worded to name
every company for a Global field, or the one specific company for a scoped
field, since the two have very different blast radii.

## Security-sensitive Holder role editing (AM-05)

`HoldersScreen`'s Edit dialog's Role `FormField` always shows a
`helperText` naming the holder's current role ("Current role: ADMIN.
Controls what this person can see and do in CKAM."). If the selected value
differs from the role the dialog opened with, an inline `role="alert"`
warning appears directly under the control ("Changing role from ADMIN to
VIEWER will immediately change this person's access.") — text, not color
alone, and it only ever appears as a direct consequence of the admin's own
selection, never on an unrelated field edit (so editing a holder's phone
number can never look like it's also touching their role).

## Table row actions (AM-05)

Every row-actions column across `MasterCrudScreen`, `CustomFieldsScreen`,
and `HoldersScreen` uses the same shape: `variant="ghost" size="icon"`
buttons from `lucide-react` (`Pencil` for Edit, `KeyRound` for Holders'
Reset Password, `Trash2` for Deactivate), each with an explicit
`aria-label` naming the row ("Deactivate Ankur Pahwa"), inside a
`flex justify-end gap-1` cell — never a bare icon with no accessible name,
never a clickable non-semantic `<div>`. An action a caller isn't authorized
for (e.g. IT_TEAM viewing a Global or another company's Custom Field) is
omitted from the row entirely rather than rendered disabled, since the
distinction ("you can't do this right now" vs. "this will never be yours to
do") matters here.

## Import workflow (AM-06)

`ImportScreen` is a sequence of numbered, bordered sections (`text-sm
font-semibold uppercase tracking-wide text-muted-foreground` heading, same
as Add Asset's section pattern, applied to a page-level workflow instead of
a form), not one dense upload box: 1. Download Template, 2. Choose File +
Preview, 3. Review, 4. Result. Steps 3 and 4 only render once their data
exists (no empty "Review"/"Result" section flashing before there's anything
to show). Preview shows two separate `DataTable`s — rows ready to import
and rows needing attention — rather than only surfacing errors, since a
successful preview is exactly as important to see clearly as a failed one.
An error row's `field` (when the backend can attribute one) gets its own
column, never buried inside the message string.

## Validation-summary pattern (AM-06)

Both Import's preview/result and any future bulk-validation surface should
follow the same shape: a one-line plain-language count ("N rows ready to
import, M rows with errors") above the detail tables, not a raw JSON dump
or a single combined "N/M" number that hides which N. Never render a raw
backend exception string as the error text (`app.imports.asset_import_
service` already composes user-facing messages, e.g. "unknown Cost Centre
Code 'X'" naming the actual column, not a stack trace).

## Report/download action pattern (AM-06)

Every export button in `ReportsScreen` (and Import's Template download) is
an `AsyncButton`, not a hand-rolled `useState` pending/error pair — the
"Duplicated async-state plumbing in Imports/Reports" finding this closes.
A report card with filters (`ReportsScreen`'s Asset Register card) puts the
filter controls and the download button in one `flex flex-wrap items-end
gap-3` row, matching `AssetRegister`'s own filter-bar layout, so the same
horizontal-filters-then-action shape appears everywhere filters exist in
the app.

## Sensitive-field correction pattern (AM-07)

A **correction** (a deliberate change to a field the app normally treats as
fixed after creation) is a distinct, dedicated action — never a field
quietly added to an existing Edit form. Asset 360's "Correct Classification"
establishes the reusable shape a future correction workflow (any master or
record with an identity-adjacent field) should follow:

1. A separate, clearly-labeled action button next to (not inside) the
   ordinary Edit action, visible only to the roles actually authorized to
   use it (omitted entirely for a role that can never perform it, not shown
   disabled).
2. The dialog/drawer opens with an immutable-identity block at the top
   (`Asset Code` + "Asset Code will not change.") so the one thing that can
   never change is the first thing the user sees, not an afterthought.
3. Every correctable field is prefilled with its current value; a dependent
   field (Sub-Category) reacts live to its parent (Category) changing, and
   clears an option that would become invalid rather than silently keeping
   a stale selection.
4. Once at least one field actually differs from its current value, an
   **Impact Summary** block appears above the confirmation control: one
   line per changed field as `Field: old → new`, plus the immutable
   identity line again (`Asset Code: AM04UAT/2 — unchanged`) — never a
   single opaque "N fields will change" count.
5. A mandatory Reason (`Textarea`, non-blank, sensible max length) is
   required before the confirm control enables. The confirm control itself
   (`AsyncButton`, labeled for the action — "Confirm Correction", not a
   generic "Save") stays disabled until both "at least one real change" and
   "non-blank reason" are true simultaneously — never enabled on a
   no-op submission.
6. The record's existing change-history surface (Asset 360's Changes tab)
   renders a correction visually distinct from an ordinary edit (a labeled
   pill, e.g. "Correction" vs. plain "Edit" text) and shows the reason
   alongside the old/new values — never merged indistinguishably into the
   same row shape as a routine field edit.

## Read-only immutable relational fields in MasterCrudScreen (AM-08)

`MasterCrudScreen`'s Edit dialog already shows a `formFields` entry not
repeated in `editFields` as read-only (an immutable identifier like `code`,
or an immutable parent relationship like `category_id`/`company_id`). A
field that's a foreign key must render its human-readable label there, not
the raw stored id — an optional `format` callback on `FormField`
(`(value, row) => string`), the same shape the list column's own `format`
already uses, is the reusable mechanism: pass the same `categoryName`/
`companyName` lookup function the screen already built for its list column.
Do not invent a parallel lookup just for the Edit dialog when the list
column already has one.

## Company-scoped vs. global master lookups (AM-08)

Before assuming a `Select` populated from `/api/masters/<resource>` needs
company filtering, check the actual model: only a master with a
`company_id` column (`CostCenter`, and `CustomField`'s nullable
Global/company variant) is company-owned. `AssetCategory`, `AssetSubcategory`
(scoped to `category_id`, not company), `Location`, `Department`, and
`Vendor` are genuinely global by schema — every company sees the same rows,
correctly. The generic master list endpoint's `company_id` query filter
(`app/masters/router.py::build_master_router`) is a no-op against a global
master's endpoint, by design, so it's safe to always pass a caller's own
company id without checking per-master whether it will matter.

`DataTable`/`PageHeader`/loading-empty-error states/skeletons are used on
every screen in the app (AM-06 closed the last two, My Assets and Import).
Page `<h1>` sizing is consistently `text-lg` everywhere via the shared
`PageHeader`.
