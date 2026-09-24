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

## Known gaps (not yet fixed — see `REVIEW_FINDINGS.md` for the full list)

- No shared `DataTable`/`PageHeader`/`StatusBadge`/`EmptyState` component yet
  — every screen hand-rolls its own table/header/empty-state markup.
  `MasterCrudScreen` is the one exception (shared by 8 setup screens).
- Page `<h1>` sizing drifts between `text-xl` and `text-lg` across screens
  with no documented rule.
- Loading/empty states exist on Dashboard and Asset Register but not on
  Asset Detail or the 8 master-data screens.
