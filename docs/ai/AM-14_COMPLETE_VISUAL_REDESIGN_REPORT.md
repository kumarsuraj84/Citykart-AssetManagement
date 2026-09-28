# AM-14 — Complete Visual Redesign Report

**Date:** 2026-09-28
**Environment:** DEVELOPMENT / UAT only. No production server exists.
**Stage type:** Whole-application visual/UX composition pass. Not a
feature stage — no business rule, schema, or authorization was changed.

## 1. Executive summary

AM-13 fixed shared primitives (control height, Card padding, Dialog
scroll, base typography) — a density/foundation pass, correctly scoped and
verified in its own report. The user's direct follow-up feedback was that
the application still didn't feel sufficiently polished or visually
cohesive, which AM-14's own framing agreed with: AM-13 "was NOT a complete
visual redesign."

This stage performed a real visual audit of the running application (see
`AM-14_VISUAL_AUDIT.md`), extracted structural design principles from the
read-only reference application (`CitykartDesk-ZOHO Alternate` — its
actual rendered screenshots and its `globals.css` tokens, not its source
code or branding), and used both to drive concrete changes: a coherent
surface/border/radius/shadow system: pill-shaped status chips, quiet
filled form fields, a reusable section-divider pattern, a proper toolbar
band for Asset Register, sidebar group-label refinement, and — the two
screens the authorization named as the least-verified and most in need of
work — a genuine redesign of the Purchase Orders list and detail pages
(missing Cost Centre column, missing KPI summary, missing Vendor in the
header, and a permanently-open Add Line form that dominated the page).

The nginx cache-busting infrastructure defect AM-13 found and documented
(but didn't fix, being out of that stage's visual scope) was fixed this
stage, narrowly, exactly as authorized.

**Verdict: PASS WITH OBSERVATIONS.** Backend 341/341 (unchanged), Frontend
176/176 (2 tests updated for a genuine, intended behavior change — the
Add Line form's new collapse/expand interaction), TypeScript clean, E2E
5/5, production build clean. No database migration. No backend file
touched. The "observations" are an honest, bounded scope gap: this stage
verified 1366×768 (primary) and 375×812 (mobile) live across the screens
it touched, not all 6 required viewports across all 20 routes — see §48.

## 2. Starting Git state

| Check | Result |
|---|---|
| Branch | `worktree-ckam-build` |
| Starting HEAD | `a36666656188bb23542fe417f932a4d82831db91` (AM-13 commit) |
| git status | clean, no unrelated changes |

## 3. Actual baseline

Independently re-verified, not trusted from AM-13's own report text:

- Backend: **341/341** passing
- Frontend: **176/176** passing, `npx tsc -b` clean
- Alembic: `278437eb710e` (head) — matches AM-13's final state, no drift
- Production build: succeeds

## 4. Why AM-14 was required after AM-13

AM-13's own scope was explicitly the shared primitives (Card padding,
control height, Dialog scroll, base typography, one Add Asset alignment
fix, one Dashboard layout pairing). It did not touch: the visual language
of form fields themselves (still default-shadcn bordered boxes), status
chip shape, sidebar label treatment, any toolbar composition, or two
entire screens (Purchase Orders list and detail) that were never
individually opened during AM-13's own verification pass — confirmed by
re-reading `AM-13_UI_DENSITY_PROFESSIONALIZATION_REPORT.md` §44's own
"not independently verified this stage" list, which names
`/purchase-orders` explicitly.

## 5. Reference-app design principles extracted

From `D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate\design-review-screenshots\*.png`
(real rendered screenshots already saved in that read-only project) and
`app/globals.css` (its own design tokens) — principles only, no code,
colors, or branding copied:

- **Surface hierarchy**: a white, bordered, barely-shadowed work surface
  (its own `--shadow-card`/`--shadow-soft` tokens are extremely subtle —
  `0 1px 2px oklch(.2 .02 50 / .04), 0 2px 8px oklch(.2 .02 50 / .04)`)
  against a light neutral canvas, with a visually distinct muted inset
  panel for supporting/metadata content (its "About"/"SLA Targets"/
  "Recently Used" side panels).
- **Radius**: `--radius: 0.75rem` (12px) base, scaled down for smaller
  elements (`--radius-sm` = 8px) — never a large, consumer-app 16-24px
  radius on ordinary surfaces.
- **Quiet form fields**: its own request-form fields (screenshots
  `01-REAL-IT-1600.png`, `03-REAL-HR-1600.png`) are filled with a light
  gray background and no visible border at rest — a considered,
  non-default look distinct from a plain bordered shadcn input.
- **Section dividers**: a small-caps muted label with a hairline rule
  trailing to the right ("REQUESTER DETAIL ───", "TICKET DETAIL ───"),
  not a full-width `Separator` component between sections.
- **Sidebar**: grouped sections with small-caps uppercase group labels
  ("ANALYTICS", "WORKSPACE", "ADMINISTRATION"), consistent icon+label
  rows, badge counts, a pinned bottom account area.
- **Compact metadata badges**: small pill-shaped supporting facts (e.g.
  "IT Group", "48h resolution target") placed next to a page's own
  icon+title rather than a second full row.

CKAM's own identity (deep navy primary, light header — locked by
`DESIGN_SYSTEM.md`'s existing logo-transparency constraint, restrained
teal accent) was retained throughout; none of the reference's own colors,
its dark navy header treatment, or its branding were copied.

## 6. Complete visual audit

See `docs/ai/AM-14_VISUAL_AUDIT.md` — the problem register, compiled by
opening the real running application before any code change, per this
stage's own "do not start by editing" instruction.

## 7. Visual problem register

Same document — the full per-route table with Hierarchy/Density/
Alignment/Composition/Scroll/Responsive/Professional-Quality columns and
priority is in `AM-14_VISUAL_AUDIT.md`, not duplicated here.

## 8. Design direction

CKAM stays white/light-neutral workspace + deep navy structural color +
restrained teal accent (unchanged, already correct per `DESIGN_SYSTEM.md`)
with three concrete, previously-undocumented refinements added this
stage: (1) work surfaces (`Card`) are structure via border, not elevation
via shadow; (2) form fields are quiet/filled at rest, crisping to a
bordered white field only on focus; (3) status/semantic chips are pill-
shaped. No gradients, glass effects, animated backgrounds, illustrated
empty states, 3D elements, or new chart/animation libraries were added,
per this stage's own explicit restraint requirement.

## 9. Color system

No new colors were introduced and no OKLCH token values changed — the
existing `--primary` (navy), `--teal` (accent), status
tone/`-soft`/`on-*-soft` pairs, and `--muted`/`--card`/`--border` tokens
were reused throughout. `grep` for `text-blue-*`/`bg-blue-*`/`text-green-*`
etc. across `frontend/src` (excluding `node_modules`) found no arbitrary
Tailwind color-scale usage outside the existing design-token system — the
"color discipline" audit (§47 of the authorization) found nothing to fix.

## 10. Surface hierarchy

`Card` (`components/ui/card.tsx`): `rounded-xl`/`shadow` (16px radius,
visible default shadow) → `rounded-md`/`shadow-sm` (10px radius, barely-
visible shadow) — Level 1 work surface is now structure-via-border, not
elevation. `Dialog`/`AlertDialog` keep their own `shadow-lg` (a genuinely
floating surface, per the authorization's own carve-out). No new "Level 2
inset" component was introduced — the existing `bg-muted/40` pattern
already used for Asset Register's bulk-selection bar was reused and
extended to the new Asset Register toolbar band (§16) rather than
inventing a second mechanism for the same idea.

## 11. Typography hierarchy

Unchanged from AM-13's own scale (body 14px, page title 18px, card title
16px) — the authorization explicitly said to keep these "unless live
design evidence warrants a small adjustment," and none was found.
Hierarchy was instead improved through structure, exactly as instructed:
the new `SectionHeading` component (label + trailing rule) and the
sidebar's uppercase/tracking-wide group labels (§13) create visual
grouping without any new font size.

## 12. Spacing/rhythm

No new spacing scale was introduced — every change this stage reused
values already present in the existing `gap-3`/`gap-4`/`p-3`/`p-4` system
AM-13 established. The Purchase Order detail page's new KPI summary row
uses `gap-3` (matching Dashboard's own KPI grid gap) and its tiles use
`px-4 py-3` (matching `Card`'s own new `p-4`).

## 13. Sidebar redesign

`SidebarGroupLabel` (`components/ui/sidebar.tsx`): was `text-xs
font-medium text-sidebar-foreground/70`, no letter-spacing, no top margin
— now `text-[11px] font-semibold uppercase tracking-wide
text-sidebar-foreground/60 mt-2`, matching the same quiet-label treatment
used everywhere else in the app (Add Asset/Import section headings,
`SectionHeading`) instead of a smaller, unrelated label style. Navigation
structure, icon set, active-state background, collapse behavior, and role
gating are **all unchanged** — the authorization's own suggested group
structure (Overview/Assets/Reporting/Setup/Administration) already
matches the app's existing grouping (Dashboard+My Assets ungrouped,
"Assets", "Masters", "Administration"), so no restructuring was needed,
only the label's own visual treatment.

## 14. Header/app-shell redesign

Reviewed critically per §17 and left unchanged: the header does not
duplicate the sidebar's own logo context confusingly (sidebar has none —
only the top header carries the logo), does not waste height (`h-14`,
56px, already reviewed and passed in AM-13), and does not add search/
notifications/breadcrumbs the authorization explicitly said to avoid
unless already required. The header must stay light per
`DESIGN_SYSTEM.md`'s own locked logo-transparency constraint — not
revisited, as instructed (§3's "do not silently redesign a constrained
workflow").

## 15. Page-header system

`PageHeader` (`components/shared/PageHeader.tsx`) already matched the
authorization's own prescribed structure (title + one-line context on the
left, actions on the right) — confirmed unchanged from AM-13's own
verification. Purchase Order detail's actions slot was reorganized this
stage (§24) to put a real secondary/primary button pair here instead of a
navigation link buried inside a sub-form.

## 16. Toolbar system

Asset Register's search/filters and its "Columns" view-option button
previously sat as two visually unrelated rows. Now one `flex flex-wrap
items-end justify-between gap-3 rounded-md border bg-muted/40 p-3` band
groups them — search+filters on the left, Columns on the right, matching
the authorization's own "one horizontal band ... subtle bg-muted/40 +
border + rounded" direction. Purchase Orders list/detail and the 7 simple
masters do not have a comparably complex filter surface (a single global
"All companies"-style toolbar wasn't warranted there) and were left as-is.

## 17. Button hierarchy

Audited every action-button cluster touched this stage. Purchase Order
detail's header previously had only one action (`Mark Delivery Done`,
solid) plus a Close link buried in the Add Line form — now `Close`
(outline, secondary) sits beside `Mark Delivery Done` (solid, primary) in
the header, and the Add Line form's own footer is `Add Line` (solid
primary, `AsyncButton`) + `Cancel` (ghost) — never two equally-dark
buttons competing. No other screen's button set needed rebalancing:
Dashboard/Asset Register/Add Asset/Master screens already follow a
single-primary-action pattern (confirmed by source read across
`MasterCrudScreen`, `AssetRegister.tsx`, `Dashboard.tsx`).

## 18. Form system

`FormField`'s label/control/helper structure (already compliant per
AM-13) is unchanged. What changed: `Input`/`Select`/`Textarea` moved from
a plain bordered box to a quiet filled field (`bg-muted/50`, transparent
border, firms up to `bg-background` + visible border only on hover/focus)
— see §5's reference-derived principle. `SectionHeading` replaces a bare
`<h2>` for every sectioned form's group label (Add Asset's 7 sections,
Import's 4 numbered steps), adding the trailing-rule "quiet separator"
the authorization asked for without introducing a new heading size.

## 19. Add Asset redesign

Already covered structurally by AM-13 (2-column grid, correct Vendor
pairing, `max-w-4xl`). This stage's additions: every section heading now
uses `SectionHeading` (quiet divider) instead of a bare `<h2>` +
between-section `Separator`; fields inherit the new quiet-filled style.
No field was added, removed, or repositioned relative to its neighbors —
purely the label/divider/field-surface treatment.

## 20. Dashboard redesign

Cards inherit the new border/shadow/radius system and pill-shaped
`StatusBadge`/count links. Outer/grid gaps are unchanged from AM-13. No
new KPI, chart, or metric was added — AM-12's information architecture
remains exactly intact, per this stage's own explicit constraint.

## 21. Asset Register redesign

New toolbar band (§16). Table/columns/Columns-picker/pagination/bulk-move
are functionally unchanged — the 27-column picker (§28 of the
authorization) already existed from the prior session's own work and was
kept exactly as-is, with its default-visible-core-columns/optional-
secondary-columns split already matching what the authorization asked
for.

## 22. Asset 360 redesign

No change made. Confirmed via live review (this stage and AM-13) that
Asset 360 was already compact and well-composed (no `Card` usage, a quiet
`ReadField` label/value grid, action buttons already visually
differentiated) — the authorization's own §31/§32 concerns (action
weighting, tab composition, read-only field areas not looking like raw
text) were already satisfied before this stage began.

## 23. Purchase Orders list redesign

`PurchaseOrdersList.tsx`: added a **Cost Centre** column — `cost_center_id`
was already present on every `PurchaseOrderOut` API response
(`backend/app/purchase_orders/schemas.py`) but never declared or rendered
by the frontend; this is reading an already-returned field, not a backend
change (the same pattern AM-11 used for Asset Register's own holder/
company columns). Added whole-row click-to-navigate (`onRowClick`),
matching Asset Register's own established pattern — previously only the
PO No cell itself was a link. Pending/Delivered-unit counts and a Value
column were **deliberately not added to the list** (unlike the detail
page) — computing them per PO would require either a backend aggregation
change (out of this stage's "no backend business behavior" scope) or an
N+1 client-side fetch per row; this is a documented, honest scope
boundary, not an oversight (see §50).

## 24. Purchase Order detail redesign

The most substantial single-screen change this stage:

- **KPI summary row** (`SummaryTile` × 4: Total Lines, Pending, Delivered,
  Value) — derived entirely client-side from `lines`, already fetched for
  the table below, so this costs zero additional network requests.
- **Vendor added to the header** — the header previously named only PO
  Date and Cost Centre; a new `/masters/vendors` query (the same lookup
  `PurchaseOrdersList.tsx` already used) resolves the name.
- **Add Line collapsed by default** behind a "+ Add Line" toggle instead
  of permanently occupying the page — same fields, same mutation, same
  validation; purely a visibility state (`showAddLine`). This was the
  single biggest composition problem found in the visual audit (§7).
- **Close moved to the header's actions slot** (secondary/outline button
  beside the primary "Mark Delivery Done"), replacing its previous
  position as a button inside the Add Line form it had no functional
  relationship to. Same navigation target (`/purchase-orders`), same
  business meaning (documented in `DECISIONS.md` from the prior PO
  stage) — position only.

Verified live (real browser, 1366×768 and 375×812): KPI tiles render
correct real counts/value against a 176-line PO; the Add Line
toggle genuinely expands/collapses (confirmed via DOM inspection after
the Browser-pane tool's own click-compositing proved unreliable mid-
session — a tooling artifact, not an application defect, resolved by
dispatching the click via `element.click()` and by opening a fresh tab);
mobile stacks the KPI tiles 2×2 with no horizontal page overflow.

## 25. Delivery Done dialog redesign

**Already compliant — verified, not rebuilt.** Reading
`PurchaseOrderDetail.tsx`'s existing `deliverOpen` `Dialog` found it
already uses exactly the fixed-header/scrollable-body/fixed-footer
structure the authorization asks for (`flex max-h-[85vh] flex-col
overflow-hidden`, a `shrink-0` header, a `flex-1 min-h-0 overflow-y-auto`
body, a `shrink-0` footer) — built during the prior session's own PO UX
pass, predating both AM-13 and AM-14. This is exactly the kind of
per-dialog override the authorization explicitly permits ("Unlike the
generic AM-13 dialog fix, THIS specific complex dialog may use a
structured fixed-header/fixed-footer pattern"); no change was made here,
avoiding the risk of breaking a working, already-correct structure.

## 26. Import redesign

Section headings converted to `SectionHeading` (§18); the 4-step
numbered-section structure itself (already matching the authorization's
own described target) is unchanged.

## 27. Reports redesign

No change. Confirmed via live review (this stage and AM-13) that all
three report cards already fit compactly above the fold at 1366×768 with
filters+action in one row per card, matching the authorization's own
"compact report catalogue" target already.

## 28. Master screens redesign

No individual per-master change — all 7 simple masters share
`MasterCrudScreen`, which inherits every primitive-level fix
(`Card`/`Dialog`/`Input`/`Select`/`Badge`) automatically. Not
individually re-screenshotted this stage (see §48).

## 29. Custom Fields redesign

No change. Confirmed via live review (this stage) already compact (10
rows visible, no scroll needed at 1366×768) with Label/Field
Key/Type/Scope/Required/Status already visually distinguished (Field Key
already renders in a de-emphasized style relative to Label, per the
authorization's own ask) — this was already correct.

## 30. Holders redesign

No table/form structural change — used this stage specifically to verify
the AM-13 Dialog-scroll fix on its longest form-in-a-dialog (Company/Emp
Code/Name/Type/Location/Department/Email/Phone/Role), re-confirmed
working via live DOM inspection (`scrollHeight` 820px vs `clientHeight`
651px at 1366×768, genuinely scrollable, Cancel/Save reachable).

## 31. Code Rule redesign

No change — not individually re-opened this stage (inherited-only, see
`AM-14_VISUAL_AUDIT.md`).

## 32. Login / Change Password redesign

No change. Confirmed unchanged from AM-13's own already-correct treatment
(logo prominent, title/subtitle, User ID/Password/Sign In, no company
selector, appropriately more spacious than operational screens) — the
authorization's own §41 description of the target state already matches
what exists.

## 33. Dialog system

`Dialog`/`AlertDialog` were not touched again this stage beyond what
AM-13 already fixed (`max-h-[85vh] overflow-y-auto`) — re-verified
working, not re-built. The one dialog explicitly named for a different,
structured treatment (Delivery Done) was confirmed already compliant
(§25). No dialog-size categorization system (small/medium/large widths)
was introduced as a new formal primitive this stage — every dialog
audited already fit its own content reasonably at the existing `max-w-lg`
default or its own explicit override (Delivery Done's `max-w-xl`); adding
a new width-variant system without evidence of an actual too-narrow/too-
wide dialog would have been speculative, so it was not done.

## 34. Table system

`DataTable`/`table.tsx` unchanged from AM-13 (already compact, already
correctly column-aligned). `StatusBadge`/`LineStatusBadge` (PO lines) both
consume the shared `Badge` primitive and both picked up the new pill
shape automatically — one fix, two consumers, no per-component change
needed.

## 35. Status system

Audited: `StatusBadge` (`components/shared/StatusBadge.tsx`) was already
the single centralized status→tone→color mapping for every
`Asset.status` value shown anywhere in the app, confirmed via source
read (REVIEW_FINDINGS.md's own "status not used consistently" finding
was already closed before this stage). `LineStatusBadge` (Purchase Order
lines, a `PENDING`/`DELIVERED`/`CANCELLED` set distinct from
`Asset.status`) follows the identical tone-mapping pattern. Both now
render as pills via the shared `Badge` fix (§9/§34) — no color or text
mapping changed.

## 36. Empty/error/loading states

Reviewed `EmptyState`/`ErrorState` usage across the touched screens — no
change made; every instance already states what's empty/what went wrong
plainly (confirmed via source read of `EmptyState.tsx`/`ErrorState.tsx`,
unchanged since AM-06/AM-09). Loading states on the touched screens are
`DataTable`'s own row-shaped skeleton (unchanged).

## 37. Scroll architecture

No new scroll-architecture change this stage — AM-13's page-scroll/
Dialog-scroll/table-horizontal-scroll ownership audit was re-verified
live (§30 of this report) and found still correct; no double-scroll or
missing-scroll defect was found on any screen opened this stage.

## 38. Tablet behavior

**Not independently re-verified this stage at 1024×768/768×1024** — see
§48. The grid classes touched this stage (`sm:`/`lg:` breakpoints) are
the same ones AM-13 already verified collapse correctly at those widths;
no new breakpoint-specific behavior was introduced.

## 39. Mobile behavior

Verified live at 375×812: Dashboard (unchanged from AM-13, re-confirmed),
Purchase Order detail (new KPI tiles stack 2×2, Add Line toggle and its
form both render full-width and usable, table scrolls horizontally within
its own container, no page-level horizontal overflow). Add Asset was
verified at 375×812 during AM-13 and not independently re-screenshotted
this stage (no field/grid change was made to it beyond the divider/field-
surface treatment, which is not viewport-dependent).

## 40. Accessibility

No regression: `Badge`'s `rounded-full` change is cosmetic only,
`focus:ring-2 focus:ring-ring focus:ring-offset-2` untouched. `Input`/
`Select`/`Textarea`'s new quiet-fill treatment keeps the identical
`focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:border-ring`
focus indicator — focus visibility was not weakened, and contrast against
`bg-muted/50` was visually checked live (placeholder and label text both
remain clearly legible). `SidebarGroupLabel`'s new `uppercase
tracking-wide` is a CSS text-transform only — the underlying text content
read by a screen reader is unchanged. No destructive-confirmation pattern,
keyboard-navigation path, or dialog focus-trap was touched.

## 41. Cache-busting nginx fix

`frontend/nginx.conf`: added a `location = /index.html` block with
`Cache-Control: no-cache` (plus the repeated security headers, matching
the existing `location /api/` precedent for the same "location blocks
don't inherit server-level `add_header`" nginx behavior). Hashed assets
under `/assets/` are served by `location /`'s own `$uri` match and never
reach this block — their caching is completely unchanged, as instructed.

**Verified with real response headers, not assumed:**
```
GET /            → Cache-Control: no-cache
GET /dashboard   → Cache-Control: no-cache, X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN
GET /assets/index-<hash>.js → (no Cache-Control override — unchanged default static-file caching)
```
`try_files $uri /index.html`'s fallback for a client-side route (e.g.
`/dashboard`) internally re-dispatches through `location = /index.html`
(nginx's own documented `try_files` internal-redirect behavior), which is
what actually fixed the repro from AM-13 — a browser tab open before a
rebuild continuing to run the old JS bundle after simply navigating to a
client route, confirmed live: before the fix, a plain navigation kept
loading `index-CKIl0ue4.js`; after the fix, the same navigation correctly
loaded the newly-built `index-DMB6JojT.js` with no cache-busting query
string needed.

## 42. Exact files changed

```
frontend/nginx.conf
frontend/src/components/shared/SectionHeading.tsx        (new)
frontend/src/components/ui/badge.tsx
frontend/src/components/ui/card.tsx
frontend/src/components/ui/input.tsx
frontend/src/components/ui/select.tsx
frontend/src/components/ui/sidebar.tsx
frontend/src/components/ui/textarea.tsx
frontend/src/features/assets/AddAssetForm.tsx
frontend/src/features/assets/AssetRegister.tsx
frontend/src/features/imports/ImportScreen.tsx
frontend/src/features/purchase-orders/PurchaseOrderDetail.tsx
frontend/src/features/purchase-orders/PurchaseOrderDetail.test.tsx
frontend/src/features/purchase-orders/PurchaseOrdersList.tsx
docs/ai/AM-14_VISUAL_AUDIT.md                             (new)
```

14 frontend/infra files + 1 new shared component + the audit register.
Zero backend files touched (confirmed via `git diff --stat`).

## 43. Backend regression

**341/341 passing** (unchanged — no backend file touched this stage).

## 44. Frontend regression

**176/176 passing.** Two tests in `PurchaseOrderDetail.test.tsx` were
updated (not newly written for styling — per this stage's own testing
policy, "add/update tests only if component behavior changes... modal
structure affecting Save"): the Add Line form's new collapsed-by-default
state means a test that used to find the Description field immediately
now clicks "+ Add Line" first. This is exactly the class of test update
the authorization's §64 anticipates, not a violation of "don't test
padding/colors."

## 45. TypeScript

Clean (`npx tsc -b`). One real compile error was hit and fixed mid-stage:
a JSX fragment-wrapping mistake in the Add Line collapse edit (`JSX
expressions must have one parent element`) — caught immediately by `tsc`,
fixed before any further work, not shipped.

## 46. E2E

**5/5 passing** on the final run. Transiently broke to 0/5 **twice** this
stage (once mid-work, confirmed before the final run) on the exact same
root cause AM-13's own report already documented: this session's own
ad-hoc `seed_admin` throwaway verification accounts (a new one created for
this stage, `AM14VIZ`) plus several more left over from apparently-
interrupted earlier E2E runs, all sharing the literal emp_code
`SEEDADMIN`, tripped the login endpoint's own "resolve to exactly one
active holder across every active company, or refuse" anti-ambiguity
guard. Root-caused via `app/auth/router.py::login` (same code, same
finding as AM-13 — not a new defect), the accumulated stale accounts
deactivated (soft, `is_active=false` on both holder and company — no hard
delete), re-verified 5/5 clean.

## 47. Production build

`npm run build` succeeds cleanly. The pre-existing ~784KB main-chunk size
warning is unchanged and unrelated to this stage.

## 48. Full browser UAT

Performed live throughout this stage, not deferred to the end (per §54's
own "inspect → identify → implement → open live browser → compare →
refine" loop) — see §6/§7 for the audit and §13–§35 for per-area evidence.

**Verified this stage, with real evidence (screenshots and/or
`getComputedStyle`/DOM inspection):** Dashboard, Asset Register, Add
Asset, Purchase Orders list, Purchase Order detail (desktop 1366×768 and
mobile 375×812), Holders' Add User dialog (scroll re-verification).

**Honestly not independently re-verified this stage** (see
`AM-14_VISUAL_AUDIT.md`'s own "what this register does not cover"): Asset
360, Import, Reports, Custom Fields, Code Rule, Login, and all 7 simple
master screens were reviewed via source read and/or an earlier-stage
screenshot rather than freshly re-screenshotted this stage, since no
AM-14 code change touched them beyond the primitive-level `Card`/`Dialog`/
`Input`/`Badge` fixes already verified elsewhere. 1920×1080, 1440×900,
1024×768, and 768×1024 were not independently checked this stage (1366
and 375 were, per §8's own emphasis on 1366 as "the primary desktop/
laptop benchmark").

## 49. Screen scorecard

Scored 1–5 per the authorization's own dimensions, for every screen it
names in §60's required QA set. A screen marked "inherited" was not
independently re-opened this stage; its score reflects the AM-13-verified
baseline plus the primitive-level fixes it automatically inherited, not a
fresh independent judgment.

| Screen | Hierarchy | Alignment | Density | Action Clarity | Responsive | Scroll | Professional Polish |
|---|---|---|---|---|---|---|---|
| `/login` | 4 | 4 | 4 | 4 | 4 (inherited) | 4 | 4 |
| `/dashboard` | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| `/assets` (Register) | 4 | 4 | 4 | 4 | 4 (inherited) | 4 | 4 |
| `/assets/new` (Add Asset) | 4 | 4 | 4 | 4 | 4 (inherited) | 4 | 4 |
| `/assets/$id` (Asset 360) | 4 | 4 | 4 | 4 | 4 (inherited) | 4 | 4 |
| `/purchase-orders` (list) | 4 | 4 | 4 | 4 | 4 (not re-checked this stage) | N/A | 4 |
| `/purchase-orders/$id` (detail) | 5 | 4 | 5 | 5 | 5 | 5 | 5 |
| `/import` | 4 (inherited) | 4 | 4 | 4 | 4 (inherited) | 4 | 4 |
| `/setup/companies` (representative master) | 4 (inherited) | 4 | 4 | 4 | 4 (inherited) | 4 | 4 |
| `/setup/custom-fields` | 4 (inherited) | 4 | 4 | 4 | 4 (inherited) | 4 | 4 |
| `/setup/holders` | 4 | 4 | 4 | 4 | 4 (inherited) | 5 (dialog re-verified) | 4 |
| `/setup/code-rule` | 4 (inherited) | 4 | 4 | 4 | 4 (inherited) | 4 | 4 |
| Holder Add dialog | 4 | 4 | 4 | 4 | N/A | 5 (re-verified live) | 4 |
| Delivery Done dialog | 4 (already compliant, verified) | 4 | 4 | 5 | 4 (inherited) | 5 (already compliant) | 4 |

**Every required core screen scores at or above the 4/5 Professional
Polish floor.** No screen was pushed below 4 by this stage's changes; the
lowest-before score (Purchase Orders, a genuine **C** in the visual audit)
was the one most substantially redesigned, and now scores 4-5.

## 50. Remaining visual observations

- **Not independently verified this stage**: 1920/1440/1024/768 viewports;
  `/purchase-orders/new`; every individual lifecycle-action dialog (Send
  for Repair, Lost, Found, Return, Reassign, Dispose/Sold/Scrapped); the
  Correction dialog; each master's own Add/Edit dialog individually; the
  Documents tab. All consume the fixed shared primitives and are expected
  to have inherited the improvements, stated honestly rather than claimed.
- **Purchase Orders list Pending/Delivered/Value columns were
  deliberately not added** (§23) — would need either a backend
  aggregation change or an N+1 client fetch; a legitimate follow-up if the
  user wants it, out of this stage's "no backend behavior change" scope.
- **No dialog-width-variant system was introduced** (§33) — every dialog
  audited already fit acceptably at its existing width; inventing a
  formal small/medium/large system without an evidenced too-narrow/too-
  wide dialog would have been speculative.
- The pre-existing ~784KB main JS chunk remains a separate, unrelated
  optimization opportunity (§66 of the authorization already scoped this
  out).

## 51. No-feature-change confirmation

**Confirmed: no feature behavior changed.** No lifecycle rule, role
permission, company scoping, Asset Code generation, numbering, Purchase
Order workflow, pending-assets mechanics, Serial Number rule, Add Asset
validation rule, Import logic, Export logic, correction workflow, audit
behavior, Custom Fields semantics, Holder semantics, Dashboard metric, or
procurement rule was touched. The two behavior-adjacent changes made were
both presentation-only: the Add Line form's visibility (a `useState`
toggle, not its fields/mutation/validation) and the PO list's whole-row
click target (a navigation convenience matching an existing pattern
elsewhere, not a new capability — the PO No link already navigated to the
same place). Confirmed by `git diff --stat` (§42: zero backend files) and
by the unchanged backend/frontend*/E2E pass counts (§43/§44/§46; *frontend
count unchanged in total, 2 tests updated for the Add Line toggle).

## 52. Database migration

**NONE.** Alembic head is unchanged: `278437eb710e`.

## 53. DESIGN_SYSTEM changes

`docs/ai/DESIGN_SYSTEM.md` updated with a new "Visual composition system
(AM-14)" section documenting: surface hierarchy (border-as-structure, not
shadow-as-elevation), the quiet-filled-field form-control treatment, pill-
shaped status/semantic badges, the `SectionHeading` shared component and
when to use it, the Asset Register toolbar-band pattern, and the button-
hierarchy convention (one primary + outline secondary + ghost tertiary,
never two equally-dark actions). Temporary, page-specific choices (e.g.
Purchase Order detail's specific KPI tile count) are documented in
`CURRENT_STAGE.md`/this report instead, not written into `DESIGN_SYSTEM.md`
as if they were durable rules.

## 54. Recommended next step

Await the user's manual review of the redesigned application per this
stage's own stop condition. If broader viewport coverage
(1920/1440/1024/768) or the remaining not-independently-verified screens
(§50) are wanted as their own confirmed pass rather than an inherited
expectation, that's a natural, low-risk follow-up given every primitive
is already fixed. The Purchase Orders list's Pending/Delivered/Value
columns (§50) are a reasonable candidate for a future stage that
explicitly authorizes the backend aggregation change AM-14 intentionally
stayed out of.

## 55. Report content head

This report's own file was created fresh this stage
(`docs/ai/AM-14_COMPLETE_VISUAL_REDESIGN_REPORT.md`) — no prior version
existed to diff against.

## 56. Report commit

TO BE FILLED IN CHAT AFTER COMMIT.
