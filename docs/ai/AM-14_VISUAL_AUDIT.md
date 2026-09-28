# AM-14 — Visual Problem Register

Compiled by opening the real running application (post-AM-13 baseline) in a
live browser session at 1366×768, the primary benchmark, before any AM-14
code change. Routes not individually screenshotted this pass are marked
"inherited" — they consume the same shared primitives (`Card`, `Dialog`,
`Input`/`Select`, `DataTable`, `PageHeader`) audited and fixed via the
routes that were opened, and are called out honestly rather than scored
from a guess. See the main report's §6/§48/§50 for what this register
does and does not claim.

Legend — Professional Quality: **A** production-quality · **B** acceptable,
refinement needed · **C** visibly unfinished · **D** poor.

| Route | Main Visual Problem (before) | Hierarchy | Density | Alignment | Composition | Scroll | Responsive | Professional Quality (before) | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `/login` | Fine as-is; auth screens are deliberately more spacious | OK | OK | OK | OK | OK | OK | B | Low |
| `/dashboard` | Cards read as "default shadcn" (visible shadow, 16px radius, plain badge pill above a bare number) | OK | OK (post-AM-13) | OK | OK | OK | OK | B | Medium |
| `/assets` (Register) | Filter row + Columns button floated as two structurally-unrelated rows, no toolbar container | OK | OK | Minor | Weak toolbar grouping | OK | OK | B | Medium |
| `/assets/new` (Add Asset) | Section headings were bare text with no divider; fields were plain bordered boxes ("default shadcn") | OK | OK | OK | Minor | OK | OK | B | Medium |
| `/assets/$id` (Asset 360) | Already compact/considered (no Card usage, quiet `ReadField` grid) | OK | OK | OK | OK | OK | OK | B | Low |
| `/my-assets` | Inherited only — same `DataTable`/control fixes as Asset Register | — | — | — | — | — | — | B (inherited) | Low |
| `/purchase-orders` (list) | Only 3 sparse columns (PO No/Date/Vendor); Cost Centre available in the API response but never rendered; row not clickable outside the PO-No link | Weak | Sparse | OK | Thin | N/A | Not checked | **C** | High |
| `/purchase-orders/$id` (detail) | No KPI/summary sense of the PO at a glance; Vendor missing from the header; the Add Line form was permanently expanded, pushing the actual lines table down regardless of whether anyone was adding a line | **Weak** | Cluttered by the always-open form | OK | Weak — no clear "state of this PO" section | OK (Delivery Done dialog already had correct fixed-header/scroll-body/fixed-footer structure, verified) | Not checked | **C** | High |
| `/import` | Already follows the numbered-section pattern well | OK | OK | OK | OK | OK | Not checked | B | Low |
| `/reports` | Already compact, 3 cards fit above the fold | OK | OK | OK | OK | N/A | Not checked | B | Low |
| `/setup/companies` … `/setup/vendors` (7 masters) | Inherited only — `MasterCrudScreen` consumes the same `Dialog`/`DataTable`/control fixes | — | — | — | — | — | — | B (inherited) | Low |
| `/setup/custom-fields` | Already compact (10 rows visible, no scroll) | OK | OK | OK | OK | OK | Not checked | B | Low |
| `/setup/holders` | Add/Edit User dialog is the longest form-in-a-dialog in the app — real target for the dialog-scroll verification | OK | OK | OK | OK | OK (AM-13's dialog fix re-verified live this stage) | Not checked | B | Medium |
| `/setup/code-rule` | Inherited only | — | — | — | — | — | — | B (inherited) | Low |

## Global root causes identified (feeding the Design Direction, §8 of the main report)

**GLOBAL**
- `Card`: shadcn-default `p-6`/`rounded-xl`/`shadow` read as generic and
  heavier than the rest of the (already fairly restrained) app.
- Form controls (`Input`/`Select`/`Textarea`): plain white bordered boxes —
  functionally fine (AM-13 fixed height/padding) but visually
  indistinguishable from an unstyled shadcn starter.
- `Badge`/`StatusBadge`: square-ish (`rounded-md`) rather than the
  pill shape a status chip conventionally uses.
- Sidebar group labels (`SidebarGroupLabel`): plain-case `text-xs`, no
  tracking — didn't read as structurally the same kind of label as the
  app's own section-heading convention used elsewhere.

**PAGE COMPOSITION**
- Add Asset: section headings had no visual "line" the reference app's own
  pattern uses to separate a labeled group from the fields under it.
- Asset Register: search/filters/Columns button had no shared toolbar
  container tying them together as one control band.
- Purchase Order detail: no summary/KPI sense of the record; the Add Line
  form's permanent visibility was the single biggest composition problem
  found in this audit.

**COMPONENT UX**
- Purchase Orders list: two backend-available fields (Cost Centre) were
  simply never wired into the frontend's row shape.
- Purchase Order detail: Vendor was fetched nowhere on this screen despite
  being core identifying information for the record.

**RESPONSIVE**
- No responsive-specific defect found this pass beyond what AM-13 already
  covered — the grid classes the AM-14 changes touch (`sm:grid-cols-2`,
  `lg:grid-cols-2`, `sm:grid-cols-4` for the new PO summary tiles) were
  verified live to collapse correctly at 375×812 (see main report §39).

## What this register does not cover

Full individual live audits of: 1920×1080, 1440×900, 1024×768, 768×1024
viewports on every route; `/purchase-orders/new`; every lifecycle action
dialog (Send for Repair, Lost, Found, Return, Reassign, Dispose/Sold/
Scrapped); the Correction dialog; each of the 7 simple master Add/Edit
dialogs individually; the Documents tab; Custom Fields' own Add/Edit
dialog. These all consume the shared primitives fixed this stage
(`Card`, `Dialog`/`AlertDialog`, `Input`/`Select`/`Textarea`, `Badge`) and
are expected to have inherited the same improvements, but that expectation
is recorded as inherited, not independently screenshotted — see the main
report's §48/§50 for the honest accounting of this gap.
