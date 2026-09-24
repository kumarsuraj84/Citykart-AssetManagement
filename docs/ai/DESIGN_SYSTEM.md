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

Every shared form primitive in `frontend/src/components/ui/` targets ~44px
on desktop:
- `Input`, `Select` (`SelectTrigger`): `h-11` (44px)
- `Button`: default `h-11`, `sm` `h-9`, `lg` `h-12`
- `Textarea`: `min-h-[88px]`
- `Checkbox`, `RadioGroupItem`: `h-5 w-5` (20px, up from the shadcn default 16px)

Focus state (all of the above): border color shifts to `--ring` **and** a
soft `ring-[3px] ring-ring/25` glow appears — never rely on the browser
default outline. Hover (pre-focus): border shifts toward `--ring` at 50%
opacity. This pattern is defined per-component, not as a shared utility —
if you add a new form primitive, match it by hand.

**When adding any new input-like control, use these exact classes/heights.
Do not introduce a differently-sized field.**

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
Asset Register, Add Asset and Asset 360 (AM-03/AM-04) — see
`REVIEW_FINDINGS.md` for which screens still need migrating. `DataTable`
presents rows/loading-skeleton/empty/error states and an optional pagination
footer; it never owns fetching, query state, sorting, or filtering — the
page keeps that. `StatusBadge` maps the 8 `Asset.status` values to a
semantic tone (info/success/warning/destructive/neutral) via the existing
`--*-soft`/`--on-*-soft` tokens, always alongside the status name as text,
never color alone.

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

## Known gaps (not yet fixed — see `REVIEW_FINDINGS.md` for the full list)

- `DataTable`/`PageHeader` exist now but are only used on 4 screens
  (Dashboard, Asset Register, Add Asset, Asset 360) — Holders, Import
  preview, My Assets, and the 8 master screens still hand-roll their own
  table/header/empty-state markup. `MasterCrudScreen` is the one exception
  among those (shared by the 8 setup screens).
- Page `<h1>` sizing drifts between `text-xl` and `text-lg` outside the four
  screens above (all four now render it via the shared `PageHeader`, fixed
  at `text-lg`) — no documented rule for the rest.
- Loading/empty/error states exist on the four screens above but not on the
  8 master-data screens, Holders, or Import.
