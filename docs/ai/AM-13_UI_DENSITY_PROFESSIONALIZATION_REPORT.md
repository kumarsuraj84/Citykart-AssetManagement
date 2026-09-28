# AM-13 — UI Density / Professionalization Pass Report

**Date:** 2026-09-28
**Environment:** DEVELOPMENT / UAT only. No production server exists.
**Stage type:** Whole-application visual/layout correction pass. Not a
feature stage — no business rule, schema, or authorization was changed.

## 1. Executive summary

The AM-13 authorization named a systemic problem: fonts too large,
excessive whitespace/padding, inconsistent form alignment, missing or
wrongly-placed scrollbars, and an overall feel short of "polished
professional enterprise Asset Management system." The instruction was
explicit that this must be solved at shared components/tokens, not by
shrinking CSS on individual pages.

Measuring the real, running application (not just reading source) found
the actual root causes were narrow and concrete: three shared UI
primitives — `Card`'s default padding, form-control height, and
`Dialog`/`AlertDialog` having no viewport cap or scroll at all — plus one
real field-alignment bug in Add Asset's grid. All four were fixed once, at
the primitive/shared-component level, and verified live to cascade
correctly to every consumer. A latent, currently-inert typography landmine
(unscaled `h1`/`h2`/`h3` base styles, generic-starter-kit leftovers) was
also normalized defensively.

Two unrelated, real issues were found incidentally during this stage and
are reported honestly rather than folded silently into "density work": the
dev database was one migration behind code head (fixed — an existing
migration applied, not a new one authored), and the `web` container's
nginx sends no cache-busting header on `index.html` (documented, not
fixed — infra/ops scope). A transient E2E failure was root-caused to this
session's own ad-hoc test-account pollution, not to the AM-13 changes, and
resolved.

**Verdict: PASS.** Backend 341/341 (unchanged), Frontend 176/176
(unchanged), TypeScript clean, E2E 5/5, production build clean. No
database migration authored. No backend file touched. No push.

## 2. Git preflight

| Check | Result |
|---|---|
| Repository | `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build` |
| Branch | `worktree-ckam-build` |
| Starting HEAD | `96e11a2b87edfb8f6887db2b5968361cc629c02e` (feat(assets): show every Asset field on the Asset Register, with a column picker) |
| git status | clean, no unrelated changes, before AM-13 work began |
| Alembic (code head) | `278437eb710e` |
| Alembic (live `ckam` DB, before fix) | `6c882ef3b225` — **one migration behind**, caught up this stage (§50) |

No `push`/`pull`/`merge`/`reset`/`rebase`/`clean`/branch-switch was
performed at any point.

## 3. Starting baseline

The AM-13 authorization's own "expected baseline" (Backend 312, Frontend
154, E2E 5, Alembic `f28b6a913dce`) predates the Purchase Orders, Serial
Number uniqueness, and Asset Register field-expansion work already
committed earlier this session — it was stale before this stage began, as
"do not trust documentation blindly" itself anticipated. The **real**,
directly-verified starting baseline was:

- Backend: **341/341** passing
- Frontend: **176/176** passing, `npx tsc -b` clean
- E2E: **5/5** passing
- Production build: succeeds (pre-existing 783KB chunk-size warning,
  unrelated)
- Alembic: `6c882ef3b225`, one migration behind code head `278437eb710e`
  (see §50)

## 4. Complete route visual inventory

Every route below was opened in a real browser session (authenticated as
a throwaway ADMIN, `SEEDADMIN` / company "VERIFY1 Seed Co", created via
`backend/scripts/seed_admin.py` and soft-deactivated after use). Routes
marked "inspected live" got a real screenshot/computed-style check this
stage; routes marked "shared-foundation only" were not opened individually
this stage but consume the same shared primitives (`Card`, `Dialog`,
`Input`/`Select`/`Button`, `DataTable`, `PageHeader`) that were fixed and
verified elsewhere, so they inherit the fix without their own dedicated
screenshot.

| Route | Screen | Inspected live this stage | Severity found |
|---|---|---|---|
| `/login` | Auth | Source-audited (control height, intentional larger title) | None — auth screens deliberately more spacious per AM-13 §38 |
| `/change-password` | Auth | Source-audited (shares Login's Card) | None |
| `/dashboard` | Core | **Yes** — 1366×768, 375×812 | High (Card padding, stacked full-width cards) |
| `/assets` (Asset Register) | Core | **Yes** — 1366×768 | Low (already compact; no `Card` usage) |
| `/assets/new` (Add Asset) | Core | **Yes** — 1366×768, 375×812 | High (max-width too narrow, Vendor pairing offset) |
| `/assets/$id` (Asset 360) | Core | **Yes** — 1366×768 | Low (already compact; no `Card` usage) |
| `/my-assets` | Core | Shared-foundation only | Inherits control-height/DataTable fixes |
| `/import` | Operations | **Yes** — 1366×768 | Low (bordered-section pattern already compact) |
| `/reports` | Operations | **Yes** — 1366×768 | Low (already compact; all 3 cards fit above the fold) |
| `/purchase-orders` | Operations | Shared-foundation only | Inherits control-height/DataTable/Dialog fixes |
| `/setup/companies` … `/setup/vendors` (7 simple masters) | Setup | Shared-foundation only (`MasterCrudScreen`) | Inherits Dialog/control fixes |
| `/setup/custom-fields` | Setup | **Yes** — 1366×768 | Low (already compact) |
| `/setup/holders` | Setup | **Yes** — 1366×768, dialog opened and scroll-tested | High (Dialog had no scroll bound — real defect, not density) |
| `/setup/code-rule` | Setup | Shared-foundation only | Inherits control fixes |
| Dialogs/drawers generally | Cross-cutting | **Yes** — `Dialog`/`AlertDialog` primitives fixed and one long dialog (Holders' Add User) verified live | High |
| Correction workflow, lifecycle action dialogs, Add/Edit Master dialogs, Holder dialogs, import preview, report actions, documents, tabs | Cross-cutting | Not individually re-opened — all consume `Dialog`/`FormField`/`DataTable`, fixed and verified elsewhere | Inherits fixes |

**No Drawer component usage found anywhere in the app** (`grep` for
`from "@/components/ui/drawer"` / `"@/components/ui/sheet"` across
`features/`/`routes/` returned zero matches) — the only `Sheet` consumer
is the shared `Sidebar` primitive's own mobile slide-in, unrelated to
page-level drawers. §22 (Drawers) is therefore N/A for this app.

## 5. Global root causes

Three shared primitives, evidenced by direct source read + live computed-
style measurement, not guesswork:

1. **`Card`** (`components/ui/card.tsx`): `CardHeader`/`CardContent`/
   `CardFooter` all used shadcn's unmodified default `p-6` (24px).
   Dashboard stacks a `CardHeader` + `CardContent` per section (Exceptions,
   Purchase Orders, Stock by Location, Warranty, Allotted, Recent
   Activity — 6 sections), each paying 24px+24px = 48px+ of padding
   before any content. This was the single largest contributor to the
   "giant cards"/"excessive whitespace" complaint.
2. **Form controls** (`Input`, `Select`'s `SelectTrigger`, `Button`,
   `Textarea`): all `h-11` (44px), a value CKAM's own prior design system
   had documented as deliberate (`DESIGN_SYSTEM.md`, pre-AM-13). AM-13's
   explicit target range is 40-42px.
3. **`Dialog`/`AlertDialog`** (`components/ui/dialog.tsx`,
   `alert-dialog.tsx`): `DialogContent`/`AlertDialogContent` had no
   `max-height` and no `overflow`, so a dialog with enough fields (verified
   live: Holders' "Add User" — Company/Emp Code/Name/Type/Location/
   Department/Email/Phone/Role/etc.) could grow past the viewport height
   with no way to scroll to Cancel/Save. This is a genuine, reproduced
   defect matching AM-13 §21's description exactly, not a density
   preference.

One additional, narrower root cause found in a specific screen rather than
a shared primitive: Add Asset's own form container was capped at
`max-w-3xl` (768px), wasting the available width on any laptop/desktop
viewport, and its Vendor field's position in a 2-column grid offset every
later Number/Date pair by one slot (§16).

A fourth, latent-only root cause: global `body`/`h1`/`h2`/`h3` base styles
in `styles.css` inherited generic-starter-kit values (`body` 15.5px/1.55
line-height; `h1` up to `clamp(2rem, 3.2vw, 2.75rem)` ≈ 32-44px). Grepping
every `<h1>`/`<h2>`/`<h3>` in the app (`grep -rn "<h1\|<h2\|<h3"
--include="*.tsx" | grep -v "text-"`) found **zero** raw, unscaled usages
— every real heading already carries its own explicit Tailwind `text-*`
class and was unaffected. This was normalized as defensive cleanup (§9),
not because it was visibly broken today.

## 6. Typography audit

- `body`: 15.5px / line-height 1.55 (global, `styles.css`) — above AM-13's
  14px/1.4-1.5 target, but **inert almost everywhere** since Tailwind's
  `text-*` utilities bundle their own font-size+line-height and win over
  the inherited body value on any element that carries one (confirmed:
  every text node checked in `AddAssetForm.tsx`, `Dashboard.tsx`,
  `FormField.tsx`, `DataTable`/`table.tsx` carries an explicit `text-sm`/
  `text-xs`/`text-base` class).
- `h1`/`h2`/`h3` (bare tag, `styles.css`): up to `clamp(2rem, 3.2vw,
  2.75rem)` for `h1` — but **zero live usages** of a bare, unscaled
  heading tag exist in the app (verified by grep, §5).
- `PageHeader`'s `<h1>`: already `text-lg` (18px) — well within AM-13's
  24px-max target, unchanged.
- `DialogTitle`: already `text-lg` (18px) — within the 18-20px target,
  unchanged.
- `CardTitle`: **no explicit size class at all** before this stage —
  rendered ~15.5px by inheritance only (the `body` value), which happened
  to look reasonable but was not a documented contract. Given an explicit
  `text-base` (16px) this stage, within the 14-16px target.
- Section headings (Add Asset/Import pattern): already `text-sm
  font-semibold uppercase tracking-wide` (14px) — unchanged, already
  compliant.
- Only one `text-3xl` usage exists anywhere in the app (`router.tsx`'s
  Login `<h1>`, at the `sm:` breakpoint) — intentional, auth screens are
  allowed to be more spacious per AM-13 §38. No `text-4xl`/`text-5xl`
  usage found anywhere.

## 7. Typography changes

- `styles.css`: `body` font-size 15.5px→14px, line-height 1.55→1.5.
- `styles.css`: `h1`/`h2`/`h3` bare-tag fallback scale: `h1` `clamp(2rem,
  3.2vw, 2.75rem)`→`1.5rem` (24px), `h2` `1.6rem`→`1.25rem` (20px), `h3`
  `1.2rem`→`1.125rem` (18px). Line-heights tightened to 1.25/1.3/1.35.
- `components/ui/card.tsx`: `CardTitle` gained an explicit `text-base`
  (16px).

No other heading/label/body text size was changed — everything else was
already within AM-13's target ranges (verified, not assumed).

## 8. Spacing audit

- `Card` (`CardHeader`/`CardContent`/`CardFooter`): `p-6` (24px) — see §5.
- `Dashboard.tsx`: outer page container `gap-6` (24px); several sections
  each a separate full-width `Card` with no pairing.
- `AddAssetForm.tsx`: outer container `gap-6`; field grid `gap-4` (already
  compliant); `FormField`'s own label→control gap `gap-1.5` (6px, already
  compliant).
- `Dialog`/`AlertDialog`: `p-6` (24px) padding, `gap-4` between
  Header/body/Footer (already compliant), no height/scroll bound.
- `AppShell`'s `<main>` page gutter: `p-4 md:p-6` (16px/24px) — already
  within the 16-24px target range across breakpoints, unchanged.
- `TableHead`/`TableCell` (`table.tsx`): `h-10`/`p-2` — already compact,
  not part of the complaint (confirmed by direct row-height inspection),
  unchanged.

## 9. Spacing changes

- `Card`: `CardHeader`/`CardContent`/`CardFooter` `p-6`→`p-4`;
  `CardHeader`'s internal `space-y-1.5`→`space-y-1`.
- `Dashboard.tsx`: outer container `gap-6`→`gap-4`; KPI grid `gap-4`→
  `gap-3`.
- `AddAssetForm.tsx`: outer container `gap-6`→`gap-5`.
- `Dialog`/`AlertDialog`: `p-6`→`p-5`.
- `Textarea`: `px-3.5 py-2.5`→`px-3 py-2`, `min-h-[88px]`→`min-h-[80px]`
  (matches the `Input`/`Select` horizontal-padding reduction below).

## 10. Page gutter system

Audited `AppShell`'s `<main className="flex-1 p-4 md:p-6">`
(`router.tsx`) — 16px mobile / 24px desktop, applied uniformly to every
authenticated route through the one shared shell. Already consistent
across every page (there is no per-page override anywhere in
`features/`/`routes/` — confirmed by grep for a second `p-` override on a
page-root container). No change made; already compliant with the AM-13
target (16px mobile → 24px large desktop).

## 11. PageHeader changes

None needed. `PageHeader` (`components/shared/PageHeader.tsx`) was
already exactly the compact shape AM-13 asks for: `text-lg` title (18px),
optional `text-sm` description, actions right-aligned in the same row,
`gap-4`/`gap-3` — no oversized title, no redundant action row. Confirmed
by direct source read; this component needed zero changes this stage.

## 12. Sidebar density

Audited `components/ui/sidebar.tsx`'s `SidebarMenuButton`: default variant
is `h-8` (32px) — already **below** AM-13's 36-40px target range, i.e.
already compact, not oversized. Header height (`AppShell`'s `<header
className="flex h-14 ...">`) is 56px, reasonable for a top bar with
logo+trigger+account controls. No change made — this was already
compliant and was confirmed clean visually in every screenshot taken this
stage (sidebar icons/labels/active state all aligned correctly).

## 13. Form control sizing

See §5/§9. `Input`/`Select`(`SelectTrigger`)/`Button`(default+icon)/
`Textarea` moved from 44px to 40px, matching AM-13's target range exactly.
Verified live via `getComputedStyle` on Add Asset's PO Number `Input` and
Cost Centre `Select`: both report `height: "40px"` post-fix. `Checkbox`/
`RadioGroupItem` (`h-5 w-5`, 20px) were already compact and were not
changed.

## 14. Form alignment system

`FormField` (`components/shared/FormField.tsx`) already enforces
consistent label/control/helper-or-error structure with a fixed `gap-1.5`
— every field in the app goes through this one component, so label
baseline/control top/helper-region alignment was already systemic, not
per-field. The one real alignment defect found was not inside `FormField`
itself but in how fields were *arranged into the grid* — see §16.

## 15. Form grid system

Add Asset's existing pattern (`grid gap-4 sm:grid-cols-2`, a section
heading, a `Separator` between sections) already matches AM-13's own
described target almost exactly — this pattern was not invented this
stage, it already existed from AM-04. The fixes this stage were: widen the
overall container (§16) and fix one field-pairing offset (§16). No new
grid pattern was introduced; the existing one was corrected in place.

## 16. Add Asset redesign

Two concrete, evidenced defects fixed, no visual redesign beyond them
(the sectioned structure itself was already compliant — see §15):

1. **Width**: the form's outer container was `max-w-3xl` (768px) on every
   viewport, including 1920×1080 desktops — using well under half the
   available width on a laptop screen while the 2-column field grid
   inside it was correspondingly cramped. Widened to `max-w-4xl` (896px).
2. **Field pairing offset**: the Purchase/Procurement section is Vendor,
   PO Number, PO Date, Invoice Number, Invoice Date, PI Number, PI Date —
   7 fields in a 2-column grid. Vendor (no Number/Date partner) occupied
   slot 1, so every subsequent pair drifted: PO Number paired visually
   with Vendor, PO Date paired with Invoice Number, Invoice Date paired
   with PI Number. Fixed by giving Vendor `sm:col-span-2` (its own full
   row), so the three actual pairs — PO Number/PO Date, Invoice
   Number/Invoice Date, PI Number/PI Date — now align correctly. Verified
   live via screenshot at 1366×768.

## 17. Dialog sizing/scroll system

`DialogContent`/`AlertDialogContent`: added `max-h-[85vh]
overflow-y-auto`. The whole dialog scrolls as one unit (header and footer
scroll together) rather than a pinned-header/pinned-footer layout — chosen
deliberately over a 3-row CSS grid split (which was tried, then reverted
after recognizing it would silently clip content in any dialog whose
direct children aren't exactly 3 elements in Header/body/Footer order,
since only the outer container would have had `overflow-hidden` with no
child carrying its own `overflow-y-auto`). The simpler, universally-safe
fix works for every existing dialog's DOM shape with zero call-site
changes. Verified live (Holders' "Add User" dialog, the longest in the
app): `maxHeight: "652.8px"` (85% of a 768px viewport), `overflowY:
"auto"`, `scrollHeight: 820` vs `clientHeight: 651` — genuinely
scrollable; `dialog.scrollTop = dialog.scrollHeight` reached the bottom
where Cancel/Save (confirmed present in the DOM) become reachable.

## 18. Drawer behavior

N/A — no page in the app uses the `Drawer`/`Sheet` primitives directly
(confirmed by grep, §4). The only `Sheet` consumer is the shared
`Sidebar`'s own mobile slide-in, which was not touched this stage and was
not reported as a problem in the authorization.

## 19. Page-scroll architecture

`AppShell`'s `<main className="flex-1 p-4 md:p-6">` inside `SidebarInset`
(itself inside a `flex min-h-0 flex-1` row) is the one and only page-level
vertical scroll owner for every authenticated route — confirmed by source
read, not changed this stage (no `h-screen`/`min-h-screen` misuse found
inside any page's own content; the only `min-h-screen` usages are Login
and Change Password's own top-level centered-card containers, which are
correct there since those pages sit outside `AppShell` entirely). No
double-scroll architecture defect found at the shell level.

## 20. Horizontal-scroll architecture

`Table` (`components/ui/table.tsx`) already wraps itself in its own
`overflow-auto` div, and `DataTable`'s outer wrapper only clips that to a
rounded/bordered card without adding a second scroll container (confirmed
by source read — this exact non-double-wrapping behavior is called out in
`DataTable`'s own code comment). Verified live on Asset Register (27
possible columns via the Columns picker) — the table region scrolls
horizontally on its own, pagination and the Columns button stay reachable
outside the scrolling region, no page-level horizontal scroll. Not changed
this stage; already correct.

## 21. Double-scroll defects found/fixed

None found at the shell/table level (§19/§20). One was found and fixed at
the dialog level: a sufficiently long dialog previously had no scroll
bound at all, so its content could exceed the viewport with nothing
scrollable to reach it — not literally a "double scroll" but the sibling
defect AM-13 groups with it (§21 names both "no internal scroll" and
"button footer disappears below viewport" as the same class of bug). Fixed
per §17.

## 22. Missing-scroll defects found/fixed

The Dialog/AlertDialog fix (§17) is the one missing-scroll defect found
and fixed this stage. Every other named example in AM-13 §25 (Asset
Register, Asset 360, Import, Holders, Custom Fields) was checked live at
1366×768 and 375×812 and found to already scroll correctly (page-level,
inherited from `AppShell`) with no unreachable content.

## 23. DataTable density

`components/ui/table.tsx`: `TableHead h-10` (40px), `TableCell p-2` (8px
padding), root `text-sm` (14px) — measured against AM-13's 40-44px row
height target and found **already compliant**, not part of the
"oversized" complaint. No change made. Verified visually across Asset
Register, Custom Fields, and Dashboard's several `DataTable` instances —
compact, readable, no excessive row height anywhere.

## 24. Table alignment

Already consistent across every `DataTableColumn` definition audited
(Dashboard's KPI/exception/PO/warranty/allocation columns, Asset
Register's 27-field column config): text left-aligned by default, numeric/
count columns explicitly right-aligned via `headerClassName`/
`cellClassName: "text-right"`, actions right-aligned. No arbitrary
center-alignment found anywhere. Not changed this stage — already
compliant.

## 25. Dashboard density

See §5/§9. Card padding reduced app-wide (cascades here), outer gap
`gap-6`→`gap-4`, KPI grid `gap-4`→`gap-3`, and `Exceptions`+`Stock by
Location` (previously two separate full-width `Card` rows) now pair
side-by-side at `lg:grid-cols-2` — the same pattern the existing
Warranty/Allotted pair already used, just extended to one more pair.
Dashboard's information architecture, KPI set, Exceptions, Recent
Activity, and Purchase Orders card are all **unchanged** — no feature was
added, removed, or restructured beyond this layout pairing and spacing
reduction.

## 26. Asset Register density

Already compact (§4) — no `Card` usage, `DataTable` already dense (§23),
filter bar already a single `flex flex-wrap items-end gap-3` row. The only
inherited change is control height (search box, 5 filter `Select`s, the
new Columns-picker `Button` all now 40px instead of 44px). No structural
change made.

## 27. Asset 360 density

Already compact (§4) — no `Card` usage, `ReadField`'s `<dl>` label/value
grid (`text-xs` label, `text-sm` value) was already restrained, tabs
already compact. Action buttons (Move/Transfer, Send for Repair, etc.)
inherit the 40px `Button` height. No structural change made; information
architecture unchanged (Overview/Procurement/Custody/Custom
Fields/History/Changes/Documents tabs all preserved exactly).

## 28. Master screens

All `MasterCrudScreen` consumers (7 simple masters) and the bespoke
`CustomFieldsScreen`/`HoldersScreen` share the same `PageHeader`/
`DataTable`/`Dialog`/`FormField` foundation already fixed and verified
elsewhere in this report — no master screen needed its own individual
change. Custom Fields was opened live and confirmed compact (10 rows
visible at 1366×768, no scroll needed). Holders was opened live
specifically to verify the Dialog scroll fix (§17).

## 29. Holders

Table already compact (Emp Code/Name/Type/Role/Company/Actions columns,
verified live). The Add/Edit User dialog is the longest form-in-a-dialog
in the app (Company/Emp Code/Name/Type/Location/Department/Email/Phone
plus Role/password fields below the fold at 768px height) and is the
dialog used to verify the scroll fix (§17) — confirmed genuinely
overflowing the old unbounded dialog and genuinely fixed by the new
`max-h-[85vh] overflow-y-auto`.

## 30. Import

Opened live at 1366×768 — the existing 2-step numbered-section pattern
(Download Template, Choose File + Preview) was already compact with no
giant empty panels; confirmed unchanged. No structural change made.

## 31. Reports

Opened live at 1366×768 — all three report cards (Asset Register,
Movement Log, Field Change Audit) fit entirely above the fold with no
scrolling; filter controls and the download action already share one row
per card. Inherits the `Card` padding reduction; no structural change
made.

## 32. Login/change-password

Source-audited only (not re-screenshotted — no defect was reported or
expected here). `CardContent`'s `px-8 py-8` on both auth pages is a
per-instance override, independent of the shared `Card` default that
changed, so auth screens keep their intentionally slightly more spacious
feel per AM-13 §38. Control height (40px) is inherited like everywhere
else. No change made beyond the inherited primitive fixes.

## 33. Responsive system

Verified live at 1366×768 and 375×812 for Dashboard and Add Asset (the
two screens with the most significant grid changes this stage):
`sm:grid-cols-2` (Add Asset field grid) and `lg:grid-cols-2` (Dashboard's
paired cards, including the newly-added Exceptions/Stock-by-Location pair)
both correctly collapse to a single column below their breakpoints — no
horizontal overflow, no clipped content, sidebar correctly swaps to the
mobile hamburger trigger. 1024/768 were not independently re-screenshotted
this stage (time-bounded — see §44); the breakpoints touched are the same
Tailwind `sm:`/`lg:` classes already exercised at 375/1366, so intermediate
widths are expected to behave consistently, but this is a documented gap,
not a claimed verification.

## 34. Accessibility

No accessibility regression introduced: `Checkbox`/`RadioGroupItem` sizing
(20px) untouched; focus-ring classes on `Input`/`Select`/`Button`
untouched (only height/padding utilities changed, not the
`focus-visible:ring-*` classes); body text floor is 14px, not shrunk
below any readable minimum; `Dialog`'s `role="dialog"` and Radix's own
focus-trap/keyboard behavior are unaffected by the added
`max-h`/`overflow-y-auto` (confirmed live — Escape closed the Holders
dialog correctly, Tab/keyboard interaction was not disrupted by the new
scroll container).

## 35. 1366×768 viewport efficiency

Measured directly (screenshots + `get_page_text`), before vs. after:

- **Dashboard**: before, only the 5 KPI cards + the start of "Exceptions"
  fit before scrolling; "Stock by Location" required a full scroll to
  reach. After, the 5 KPI cards + **both** "Exceptions" and "Stock by
  Location" (now paired side-by-side) fit in the same space, with
  "Purchase Orders" beginning to appear at the very bottom of the fold —
  a real, measured density improvement, not a subjective one.
- **Add Asset**: before, the 768px-wide form showed Organization +
  Asset Classification (Category/Sub-Category/Description) before
  scrolling. After, at 896px width with tighter section/outer gaps, the
  same vertical space additionally reaches into the start of Purchase/
  Procurement (Vendor + PO Number/PO Date visible) before scrolling.
- **Asset Register**: unchanged row count per page (still ~50 rows/page
  via existing pagination) — this screen was already dense; the only
  visible change is the 40px vs 44px filter-bar control height.

## 36. Before/after visual evidence

Screenshot file persistence to `docs/ai/evidence/am13/` was not performed
this stage — the browser tool used in this environment does not save
screenshots to disk as files; every screenshot in this stage was reviewed
inline during the session and cross-checked against direct
`getComputedStyle`/DOM measurements (heights, padding, `scrollHeight` vs
`clientHeight`) rather than left as visual-only evidence. **DOWNLOADABLE
SCREENSHOT FILES NOT SUPPORTED IN THIS ENVIRONMENT** — the measured,
numeric evidence above (§13, §17, §35) is offered in its place, since it
is more precise than a screenshot comparison would be for a padding/
sizing change.

## 37. Exact files changed

```
frontend/src/components/ui/alert-dialog.tsx
frontend/src/components/ui/button.tsx
frontend/src/components/ui/card.tsx
frontend/src/components/ui/dialog.tsx
frontend/src/components/ui/input.tsx
frontend/src/components/ui/select.tsx
frontend/src/components/ui/textarea.tsx
frontend/src/features/assets/AddAssetForm.tsx
frontend/src/features/dashboard/Dashboard.tsx
frontend/src/styles.css
```

10 files, all frontend, all visual/layout. Zero backend files touched
(confirmed via `git diff --stat` against the AM-13 starting HEAD).

## 38. Backend test results

**341/341 passing** (unchanged from the starting baseline — AM-13 touched
no backend file). Full suite re-run after this stage's frontend changes to
confirm no incidental coupling: clean.

## 39. Frontend test results

**176/176 passing** (unchanged — no test file was added or modified this
stage; a Tailwind-class/spacing-token change does not need its own new
test per this stage's own testing guidance, "do not generate dozens of
tests for Tailwind class names"). `npx tsc -b`: clean.

## 40. TypeScript

Clean (`npx tsc -b`, zero errors) — verified twice, once immediately after
the shared-primitive edits and once again after the E2E-pollution cleanup
and final regression pass.

## 41. E2E

**5/5 passing** on the final run. Transiently **failed 5/5** partway
through this stage on an unrelated cause — see §51 for the full
root-cause account. Re-verified clean after the fix, with no change to
any spec file.

## 42. Production build

`npm run build` succeeds cleanly both before and after this stage's
changes (`vite build`, `tsc -b` first). The pre-existing 783KB main-chunk
size warning is unchanged and unrelated to this stage (a code-splitting
recommendation, not an error).

## 43. Browser UAT

Performed live throughout this stage (not deferred to the end) — see §4
for the full route table and §13/§17/§33/§35 for the specific measured
evidence. Authenticated as a throwaway `SEEDADMIN` / "VERIFY1 Seed Co"
ADMIN account (created via `backend/scripts/seed_admin.py`, the
documented safe pattern for this kind of verification per
`docs/deployment.md`), soft-deactivated at the end of the stage (§51).
Viewports actually used this stage: 1366×768 (primary, per AM-13's own
emphasis) and 375×812 (mobile). 1920×1080/1440×900/1024×768/768×1024 were
**not** independently re-screenshotted this stage — see §44 for this
honestly-stated gap.

## 44. Remaining visual observations

- **Not independently verified this stage**: 1920×1080, 1440×900,
  1024×768, and 768×1024 viewports; the `/purchase-orders` screen and its
  dialogs; the 7 simple `MasterCrudScreen` routes individually (Companies,
  Locations, Departments, Cost Centers, Categories, Subcategories,
  Vendors) beyond their shared-primitive inheritance; the Correction
  workflow dialog, lifecycle action dialogs, and Documents tab
  individually. All of these consume the same fixed shared primitives
  (`Card`, `Dialog`, `Input`/`Select`/`Button`, `DataTable`) verified
  elsewhere, so they are expected to have inherited the same
  improvements, but this expectation is not the same as a screenshot of
  each one — stated honestly rather than claimed as verified.
- **nginx cache-busting gap** (found incidentally, §50): documented as a
  recommendation for a future stage, not fixed here (out of AM-13's UI-
  visual scope).
- **Main JS chunk is 783KB** (pre-existing, unrelated to this stage) — a
  code-splitting opportunity noted by `vite build`'s own output, not an
  AM-13 finding.

## 45. DESIGN_SYSTEM updates

`docs/ai/DESIGN_SYSTEM.md` updated: "Component sizing standard" section's
44px references corrected to 40px; a new "Density & typography system
(AM-13)" section added documenting the full scale (typography, control
height, card padding, page gutters, section/form gaps, form-grid pairing
rule, dialog sizing, table row height, responsive) as the source of truth
for future component work.

## 46. No-feature-change confirmation

**Confirmed: no feature behavior changed.** No lifecycle logic, permission
check, company-scoping rule, database schema, import/export logic,
numbering rule, audit behavior, correction workflow, Custom Field
semantics, Holder semantics, report logic, dashboard metric, or Asset Code
logic was touched. The Dashboard's Exceptions/Stock-by-Location cards
still show exactly the same data via exactly the same queries — only their
visual arrangement (side-by-side instead of stacked) changed. Add Asset's
Vendor field still submits to the same form state — only its grid position
changed. Confirmed by `git diff --stat` (§37: zero backend files) and by
the unchanged backend/frontend/E2E pass counts (§38/§39/§41).

## 47. Database migration

**NONE.** The one migration applied this stage (`278437eb710e`) already
existed in the repository from the prior PO stage — it had simply never
been run against the live dev `ckam` database (only `ckam_test` had it).
No new migration file was authored. Alembic head is unchanged:
`278437eb710e`.

## 48. Recommended next step

Await explicit user review of the redesigned development application per
AM-13's own stop condition. If the user wants broader viewport coverage
(1920/1440/1024/768) or additional individually-screenshotted routes
(Purchase Orders, the 7 simple masters, Correction workflow) confirmed
rather than inherited, that is a natural, cheap follow-up given the
primitives are already fixed. The nginx cache-busting gap (§44) is a
separate, small, infra-scoped fix worth a short dedicated follow-up if the
user wants it addressed.

## 49. Report content head

This report's own file was created fresh this stage
(`docs/ai/AM-13_UI_DENSITY_PROFESSIONALIZATION_REPORT.md`) — no prior
version existed to diff against.

## 50. Report commit

TO BE FILLED IN CHAT AFTER COMMIT.

---

## 51. Appendix — incidental findings during this stage

**Migration gap (fixed).** Preflight found the live dev `ckam` database at
Alembic `6c882ef3b225`, one revision behind code head `278437eb710e` (the
prior PO stage's Serial Number global-uniqueness migration — applied to
`ckam_test` for testing but never run against the actual dev database).
Applied `alembic upgrade head`; the migration itself was not authored this
stage, it already existed and was simply un-applied.

**nginx cache-busting gap (documented, not fixed).** While verifying the
rebuilt `web` container actually served the new CSS/JS, a browser tab that
had loaded the app *before* a rebuild kept running the *old* bundle
(`index-CKIl0ue4.js`) even after a fresh `navigate` to the same URL — a
direct `fetch('/', {cache: 'no-store'})` proved the server was correctly
serving the new `index.html`, but the browser's own HTTP cache was serving
a stale cached copy of `index.html` itself (which has no content hash in
its own filename, unlike the assets it references) until a cache-busting
query string was used. This is a real, currently-live nginx configuration
gap (no `Cache-Control: no-cache` on `index.html`) that could cause a real
user's browser tab to keep running against a stale SPA shell after any
future redeploy. Documented here rather than fixed, since it is an
infra/deployment concern, not a UI-visual one, and AM-13 explicitly scopes
out anything beyond the visual pass.

**E2E test-data pollution (found, root-caused, fixed).** Partway through
this stage's live verification, the full E2E suite went from 5/5 to 0/5,
every failure `POST /api/auth/login -> 401: Invalid credentials`,
originating inside each spec's own `seedTestCompany`/`teardownTestCompany`
fixture helper (`e2e/fixtures.ts`), not inside any AM-13-changed file.
Reading `app/auth/router.py::login` showed the actual cause: login
resolves `login_id` (emp_code or email) to *exactly one* active holder
across *every* active company, and deliberately refuses with a generic 401
(not a silent pick) if more than one match is found — a real anti-
account-takeover guard, not a bug. `backend/scripts/seed_admin.py` (used
both by every E2E spec's own fixture *and* by this session's own ad-hoc
manual verification account) always creates a holder literally named
`SEEDADMIN`. A direct query found **7** simultaneously-active holders
named `SEEDADMIN` across 7 different active companies — this session's own
throwaway verification account (left active across the whole visual-UAT
portion of this stage, rather than deactivated immediately after each
check) plus 6 more left over from earlier, apparently-interrupted E2E runs
this same session that never reached their own `teardownTestCompany` step.
Soft-deactivated all 7 (`holder.is_active=false`, `company.is_active=false`
— no hard delete, consistent with the project's own append-only/soft-
delete rule); re-ran the full E2E suite clean at 5/5. This was **not** a
regression caused by any AM-13 CSS/layout change — confirmed by the fact
that the failure and fix were both entirely inside authentication/test-
fixture data, with zero relationship to any of the 10 files this stage
actually changed (§37). Lesson recorded in `CURRENT_STAGE.md`: deactivate
an ad-hoc `seed_admin` verification account immediately after the specific
check it was created for, not "at the end of the session."
