# AM-15 — Visual Acceptance Matrix

Compiled against the real running application (post-AM-14 baseline), before
any AM-15 code change, per the authorization's own "inspect first" rule.

**Viewport overflow methodology**: for every route below, `document.body.
scrollWidth` vs `window.innerWidth` was measured live via `getComputedStyle`/
DOM inspection at each of the 6 required viewports (not inferred, not
assumed) — a ≤2px difference is the browser's own scrollbar-width allowance,
not overflow. **Zero routes overflowed at any viewport.** Full numeric
readings are in the AM-15 report §8.

**Visual/Polish methodology**: the Browser-pane screenshot tool rendered
reliably at 1366×768 and 375×812 throughout this session (as it did in
AM-13/AM-14) but produced cropped/stale frames at 1920×1080, 1440×900,
1024×768, and 768×1024 (a tooling artifact — confirmed via
`getBoundingClientRect()`/computed-style cross-checks showing the actual
page renders correctly at those sizes, e.g. Login's card and logo measured
perfectly centered at 1920×1080 with no layout defect). Professional-Polish
scores below are therefore a real AM-15 judgment formed from: a live visual
screenshot at 1366 (every route) and 375 (every route), a real automated
overflow/structural check at all 6 sizes (every route), and for the 12
required core routes, direct interaction (opening dialogs, filling fields,
scrolling). No score in this matrix is "inherited" from AM-13/AM-14 without
this stage's own fresh check.

Legend: PASS / FAIL / N/A. Polish: A production-quality · B acceptable,
improvable · C unfinished · D poor.

| Surface | 1920 | 1440 | 1366 | 1024 | 768 | 375 | Alignment | Scroll | Actions | Polish | Defect? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/login` | PASS | PASS | PASS | PASS | PASS | PASS | PASS (card measured perfectly centered at every width) | N/A | PASS | A | None |
| `/change-password` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | A | None |
| `/dashboard` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/my-assets` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/assets` (Register) | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS (table owns horizontal scroll, page doesn't) | PASS | A | None |
| `/assets/new` (Add Asset) | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/assets/$id` (Asset 360) | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS (Correct Classification dialog opened and reviewed) | A | None |
| `/purchase-orders` (list) | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/purchase-orders/new` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/purchase-orders/$id` (detail) | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS (Delivery Done dialog stress-tested at 165 lines) | PASS | A | None |
| `/import` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/reports` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | A | None |
| `/setup/companies` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS (Add dialog opened) | A | None |
| `/setup/locations` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/setup/departments` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/setup/cost-centers` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/setup/categories` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS (Add dialog opened, confirmed compact for its 2 fields) | A | None |
| `/setup/subcategories` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/setup/vendors` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | A | None |
| `/setup/custom-fields` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS (Add dialog opened) | A | None |
| `/setup/holders` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS (Add User dialog re-tested top-to-bottom) | PASS | A | **P2 found + fixed** (dialog field contrast) |
| `/setup/code-rule` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | A | **P2 found + fixed** (Preview prominence) |

## Dialogs/interactions individually opened this stage

| Dialog | Opened | Scroll owner | Footer reachable | Field contrast | Defect? |
|---|---|---|---|---|---|
| Correct Classification (Asset 360) | Yes | Dialog itself (short content, no scroll needed) | Yes | PASS (post-fix) | None |
| Send for Repair (Asset 360) | Yes | Dialog itself | Yes | **Found: Reference No/Remarks nearly invisible against `bg-background`. Fixed: Dialog→`bg-card`.** | Fixed |
| Holders Add User | Yes, top-to-bottom, scrolled to footer | Dialog itself (`scrollHeight` 820 vs `clientHeight` 651) | Yes, Cancel/Save confirmed present after scroll | PASS (post-fix) | None (re-verification) |
| Categories Add (representative small 2-field master dialog) | Yes | N/A (fits without scroll) | Yes | PASS (post-fix) | None — dialog already proportionate, no width override needed |
| Custom Fields Add | Yes | N/A (fits without scroll) | Yes | PASS (post-fix) | None |
| Purchase Order Delivery Done — small selection (3 lines) | Yes | Dialog body (`overflow-y-auto`, header/footer fixed) | Yes | PASS (post-fix) | None |
| Purchase Order Delivery Done — stress test (165 lines, every pending line in the PO) | Yes | Dialog body (`scrollHeight` 22032 vs `clientHeight` 451 — correctly contained) | Yes, dialog height 620px within the 85vh/652.8px cap at 768px viewport | PASS (post-fix) | None — confirms AM-14's own structure holds under far more extreme content than previously tested |

**Not individually re-opened this stage** (see the report's §44 for the
full honest accounting): PO Add Line/Edit Line/Cancel-Line-confirmation
(all reviewed as part of the AM-14 Purchase Order detail redesign, not
re-opened fresh this stage since no code touching them changed);
Reset Password and Deactivate confirmations (Holders); each of the 7
simple masters' own Edit dialog and Deactivate confirmation individually
(all consume the identical `MasterCrudScreen`/`Dialog`/`AlertDialog`
primitives verified via Categories/Custom Fields/Holders); Move/Transfer,
Return, Reassign, Lost, Found, Dispose/Sold/Scrapped lifecycle dialogs
(Send for Repair was opened as the representative lifecycle dialog and
found+fixed the one cross-cutting contrast defect that would have affected
all of them identically, since they share the same `Dialog` primitive);
Documents tab / upload controls; report filters beyond the visual review
already performed; Asset Register's Columns picker (already exercised
live in the AM-13 session, unchanged this stage). Every one of these
consumes a primitive (`Dialog`, `Input`/`Select`/`Textarea`, `Card`) that
**was** individually verified and fixed this stage, so the fix is expected
to apply, but "expected to apply" is recorded as an honest gap here, not
claimed as its own fresh verification.
