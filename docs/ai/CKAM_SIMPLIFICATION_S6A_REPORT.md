# CKAM Simplification — Stage S6a (+ part of S3b) report: Settings, Asset Groups, simple Item form, Set up CKAM

Starting HEAD: `2bf5dd9` (S1). Date: 2026-10-13.
Scope: frontend only (`frontend/src`, `frontend/e2e`) plus this report. No backend, database, API or deployment
change; no request or payload shape changed. Not committed (the controller commits). A backend agent was editing
`backend/` at the same time; nothing there was touched.

## 1. What S6a delivers

1. **Settings restructured** (head-office admin only, S1 guards kept) under `/settings/*`, with a **Settings landing
   page** (one compact card per group, one line per entry) and the sidebar's Settings group rebuilt from the same
   single description (`features/settings/settings-structure.ts`).
2. **Organisation**: one screen, four tabs (Companies · Places · Cost Centres · Departments). Each tab is the existing
   master screen with its own Add / Edit / Deactivate / bulk Deactivate / Import-Export. The tab is in the address
   (`?tab=places`).
3. **Asset Groups**: one nested screen replacing Categories + Sub-categories (Category rows with their Sub-categories
   underneath, work-area chip, Item counts, Add Group, Add Sub-category inside a group, edit name, deactivate one or
   several, Codes suggested from the name).
4. **Simple Item form** (the one shared `ItemFormDialog`, used by Items and every "New Item…" in the app): Name ·
   Type of asset (one pick) · Serial (three plain choices) · More (default brand, default warranty, Comes as a set,
   ERP codes).
5. **Comes as a set** inside the Item form, reusing the Bundles logic and `/bundles` API (set first, then Item).
6. **Set up CKAM** wizard (`/settings/setup`): seven steps, live status from existing list endpoints, resumable, plus a
   Home "Finish setting up CKAM" row for the head-office admin until all seven are done.
7. Bundles removed from the sidebar (the `/setup/bundles` screen still works as a direct link).

## 2. Settings map (new addresses; every old one still works)

| Group | Entry | New address | Old address (behaviour now) |
|---|---|---|---|
| — | All Settings (landing) | `/settings` | — |
| — | Set up CKAM | `/settings/setup?step=1..7` | — |
| Organisation | Organisation (tabs) | `/settings/organisation?tab=companies\|places\|cost-centres\|departments` | `/setup/companies`, `/setup/locations`, `/setup/cost-centers`, `/setup/departments` → redirect to the matching tab |
| Catalogue | Items | `/settings/catalogue/items` | `/setup/items` → redirect |
| Catalogue | Asset Groups | `/settings/catalogue/asset-groups` | `/setup/categories`, `/setup/subcategories` → redirect |
| Catalogue | Brands | `/settings/catalogue/brands` | `/setup/brands` → redirect |
| Catalogue | (Bundles, direct link only) | — | `/setup/bundles` → still renders the Bundles screen (Items entry highlights) |
| Vendors | Vendors (keeps "Add from ERP") | `/settings/vendors` | `/setup/vendors` → redirect |
| Users & Access | Users & Access (landing → Employees, Stores, Stock Rooms, Install Points) | `/settings/users-access` | `/setup/asset-users` → `/people/employees` (unchanged from S1) |
| ERP | ERP Mapping ("Advanced mapping rules") | `/settings/erp/mapping` | `/setup/erp-articles` → redirect |
| ERP | ERP Data Sync (status + Refresh now) | `/settings/erp/sync` | — |
| Advanced | Custom Fields | `/settings/advanced/custom-fields` | `/setup/custom-fields` → redirect |
| Advanced | Asset Code Format (live example kept) | `/settings/advanced/code-format` | `/setup/code-rule` → redirect |
| Advanced | Bulk Import | `/settings/advanced/import` | `/import` → redirect |
| — | group addresses | `/settings/catalogue`, `/settings/erp`, `/settings/advanced` → `/settings` | — |

## 3. Files

New:
- `src/features/settings/settings-structure.ts` — the one Settings description (sidebar + landing), `isSettingsPath`, active-link rule.
- `src/features/settings/SettingsLanding.tsx`, `OrganisationScreen.tsx`, `UsersAccessScreen.tsx`, `ErpSyncScreen.tsx`.
- `src/features/settings/setup-progress.ts` (pure `computeSetupSteps` + `useSetupProgress`), `SetupWizard.tsx`, `SetupHomeRow.tsx`.
- `src/features/asset-groups/AssetGroupsScreen.tsx`.
- `src/features/items/type-of-asset.ts` — "Category › Sub-category" as one choice (options, parse, auto Sub-category).
- `src/features/bundles/bundle-parts.ts` — **consolidated set logic** (types, draft parts, Desktop example, share total / 100 % rule, payload, summary, `splitAmounts`).
- `src/features/bundles/BundlePartsEditor.tsx` — the shared parts editor (Bundles screen + Item form).
- `src/lib/code-suggest.ts` — Code suggested from a name.
- Tests: `src/features/settings/settings.test.tsx`, `src/features/asset-groups/AssetGroupsScreen.test.tsx`,
  `src/features/items/item-form.test.tsx`, `src/lib/code-suggest.test.ts`.

Changed: `router.tsx` (new `/settings/*` routes, old routes → redirects, `/import` → redirect), `components/app-shell/AppNav.tsx`
(Settings group from the shared structure; collapsed rail → `/settings`; highlighting by section), `features/items/ItemFormDialog.tsx`
(rewritten, same props + `allowSet`), `features/items/ItemsScreen.tsx` (columns "Type of asset", "Comes as a set", "Yes (entered later)";
link to the new ERP Mapping address; `embedded`), `features/bundles/BundlesScreen.tsx` (uses the shared module/editor),
`features/purchase-orders/AddBundleDialog.tsx` + `PoDraftCard.tsx` (import `splitAmounts`/`Bundle` from `bundle-parts`; empty-state wording),
`features/items/ArticleMapScreen.tsx` ("Advanced mapping rules" wording, Items link), `components/quick-create/QuickCreateDialog.tsx`
(Code suggestion from the Name; `idPrefix`), `components/quick-create/masters.tsx` (suggested Codes for Category, Sub-category, Brand,
Vendor; nested New Category uses ids `qc-cat-*`), `components/shared/SearchableSelect.tsx` (optional `badge` chip on an option),
`components/shared/PageHeader.tsx` (`as="h2"` for embedded screens), `components/shared/BulkImportExport.tsx` (optional `buttonLabel`),
`components/master-crud/MasterCrudScreen.tsx`, `features/asset-users/AssetUsersScreen.tsx`, `features/numbering/CodeRuleScreen.tsx`
and `routes/setup/{companies,locations,cost-centers,departments,brands,vendors}.tsx` (optional `embedded`), `routes/dashboard.tsx`
(Home gets `SetupHomeRow` through S1's `headOfficeSection` extension point).

Removed (no longer routed; replaced by Asset Groups): `routes/setup/categories.tsx`, `routes/setup/subcategories.tsx` and their test
`routes/setup/categories-subcategories.test.tsx` (its assertions are covered by the Asset Groups and Item form tests).

Tests updated: `router.test.tsx` (new Settings menu, highlighting, guards for the new addresses), `items-screens.test.tsx`
(new Item form), `BundlesScreen.test.tsx`, `AddAssetForm.test.tsx` (New Item via Type of asset), `AddBundleDialog.test.tsx` (wording).
e2e (static strings/selectors only, not run): `inline-create.spec.ts` (new address, `#item-type`, "New type…", `#qc-cat-*`),
`bundle-journey.spec.ts` (comment). Other specs use `/setup/bundles` and `/import`, which still work.

### Logic consolidated (brief item D)
The set rules lived in two places: the share-total / 100 % / Desktop example / payload logic inside `BundlesScreen.tsx`, and the price
split `splitAmounts` inside `AddBundleDialog.tsx` (imported from there by `PoDraftCard.tsx`). All of it is now in
`features/bundles/bundle-parts.ts`; the parts UI is `BundlePartsEditor.tsx`, used by both the Bundles screen and the Item form.
`AddBundleDialog.tsx` re-exports `splitAmounts` and `BundlesScreen.tsx` re-exports the types, so existing imports keep working.

## 4. API changes

None. Every call uses an existing endpoint with its existing body: `/masters/{companies,locations,cost-centers,departments,categories,subcategories,brands,vendors}`,
`/items`, `/bundles`, `/asset-users`, `/code-rules`, `/erp/sync`. The Item body is unchanged
(`name, category_id, subcategory_id, serial_required, serial_later, bundle_id, default_brand_id, default_warranty_years`).

## 5. UX before → after

| Area | Before (S1) | After (S6a) |
|---|---|---|
| Sidebar › Settings | 15 links: Companies, Places, Cost Centres, Departments · Items, Asset Groups, Sub-categories, Brands, Bundles · Vendors · People & Logins · ERP Mapping · Custom Fields, Asset Code Format, Bulk Import | 12 links: All Settings · Organisation · Items, Asset Groups, Brands · Vendors · Users & Access · ERP Mapping, ERP Data Sync · Custom Fields, Asset Code Format, Bulk Import. Collapsed rail opens the Settings landing |
| Settings landing | none (rail opened Companies) | one card per group, one line per entry, "Set up CKAM · x of 7 done" with Start / Continue |
| Organisation | 4 separate screens | 1 screen, 4 tabs, each with its own Add/Edit/Deactivate/Import |
| Categories / Sub-categories | 2 flat tables, Code typed by hand, Category picked again for every Sub-category | 1 nested list (group › its Sub-categories), work-area chip, Item counts, "+ Sub-category" inside the group, Code suggested (editable under More), confirmation before a work-area change |
| New Item | 8 fields: Item name, Category, Sub-category, Serial (Yes/No), When (delivery/later), Bundle (pick an existing one), Default brand, Default warranty — 3 required + 2 serial questions | Name · Type of asset (one searchable pick "Group › Sub-category" with work-area chip, "+ New type…") · Serial (3 radio choices) — 2 required + 1 choice. More: brand, warranty, Comes as a set (parts editor), ERP codes |
| A group with one Sub-category | user picked both | its only Sub-category is used automatically (also for legacy Items stored without one) |
| A group with no Sub-category | Item could not be saved; user had to find the Sub-categories screen | listed in the picker; picking it opens New Sub-category for that group right away (head-office admin), others are told whom to ask |
| Sets (bundles) | separate Bundles screen; Item could only point at an existing bundle | "Comes as a set" on the Item: parts editor with the Desktop example; saves the set then the Item; an existing set can still be chosen |
| First-time setup | 10 screens in no order | Set up CKAM: 7 steps, status from data, Skip / Back / Next, resumable; Home row until done |
| Quick-create Code fields | blank, required | suggested from the Name (Category, Sub-category, Brand, Vendor), still editable |

Target "a standard Item in < 1 minute": type the name, pick the type, keep "Has serial number", Save — 2 fields + 1 click.

## 6. Tests

| | Files | Tests |
|---|---|---|
| Before (HEAD 2bf5dd9) | 54 | 534 |
| After | 57 | **587** (+61 new, −7 removed with the old Categories/Sub-categories screens, −1 obsolete "when do we get the serial" test) |

`npx tsc -b`: clean. `npx vitest run`: 587/587 green. `npm run build`: succeeds (existing >500 kB chunk warning only).
e2e specs: updated statically and type-checked (`tsc --ignoreConfig --noEmit … e2e/*.ts`); Playwright not run, as instructed.

New coverage:
- **Organisation tabs**: opens on Companies; switching tabs updates `?tab=` and shows that tab's own Add button and list; each old address lands on its tab.
- **Asset Groups** (12): nested render with work-area words, Item counts, empty group note, no raw codes/serial; search; Add Group with suggested Code (More) and payload; taken Code gets a number, typed Code wins; Add Sub-category inside a group; edit Sub-category name only (Code/group read-only); rename group keeps work area; work-area change confirmation text then PUT; deactivate group and Sub-category; bulk deactivate with a listed refusal; `/setup/categories` and `/setup/subcategories` redirect.
- **Simple Item form** (18 + 7 in items-screens): type-of-asset option list (labels, chips, group without Sub-category), auto Sub-category, value parsing; serial modes ↔ flags (unit and each radio → payload); defaults; legacy Item without Sub-category saved with the group's only one; group without Sub-category opens New Sub-category (Code suggested) and the Item saves with it; New type… only for the head-office admin, others told whom to ask; set toggle creates the bundle **then** the Item (call order) and bundle Items are not offered as parts; Desktop example; editing an Item's set PUTs the same set with part ids then the Item; using an existing set; set saved + Item failed → clear message, retry updates the same set (one POST only); set refused → "Nothing was saved", no Item call; turning the set off unlinks only (no bundle call, no delete); ERP codes count + "Open ERP links".
- **Settings landing + sidebar**: every card/entry/line and href; "Advanced mapping rules"; set-up progress line; exact sidebar order; Bundles/Sub-categories/Companies/People & Logins gone; highlighting (Organisation active on an Organisation page; Items active on `/setup/bundles`).
- **Old routes**: every `/setup/*` and `/import` lands on its new page (heading checked); `/setup/bundles` still renders Bundles.
- **Wizard**: `computeSetupSteps` empty / partial (two-part steps) / complete; screen with nothing (0 of 7, step 1 pinned in the URL, Companies screen embedded, Skip and Back), partial (2 of 7, resumes at step 3, Done/To do lines, head-office admin's own record not counted), complete (7 of 7, "CKAM is set up", live code example, Finish).
- **Home row**: shown to the head-office admin with "x of 7 steps done" and a link; gone when complete; never shown to an ordinary ADMIN, whose Home makes no set-up calls.
- **Users & Access** links; **ERP Data Sync** unconfigured message and configured status with Refresh now.
- **Guards**: the new `/settings/*` addresses and `/setup/bundles` are head-office admin only (allowed + denied for every other role).

## 7. Decisions taken where the brief was open

- **Addresses**: `/settings/organisation?tab=…`, `/settings/catalogue/{items,asset-groups,brands}`, `/settings/vendors`, `/settings/users-access`,
  `/settings/erp/{mapping,sync}`, `/settings/advanced/{custom-fields,code-format,import}`, `/settings/setup?step=n`. Old `/setup/*` addresses redirect
  (Bundles keeps rendering). `/import` also redirects.
- **Brands** is its own Catalogue entry (consistent with Items and Asset Groups being entries, not tabs).
- **"Advanced mapping rules"**: the entry and page keep the title "ERP Mapping"; the label appears as the landing line and the first words of the page
  description, so existing references/tests to "ERP Mapping" stay valid.
- **ERP Inbox tile: skipped** — there is no clean extension point without new backend counts; nothing "coming next" is shown.
- **Users & Access** is a small landing page linking to the four People & Places lists (logins and roles are set there).
- **Sidebar**: an "All Settings" entry first (landing page; also lit on Set up CKAM); one-entry groups (Organisation, Vendors, Users & Access) have no heading.
- **Asset Groups** keeps everything the two old screens had: both Import/Export files ("Import / Export groups", "… sub-categories"), single and bulk
  deactivate, immutable Code and group. A Sub-category's group cannot change (as before). Edits send exactly the old edit bodies.
- **Code suggestion** (`suggestCode`): upper-case letters/digits; one word → first 6 characters; several words → initials, keeping an abbreviation
  word whole ("IT Fixed Assets" → ITFA); a taken code gets 2, 3 …; a typed Code is never overwritten. Also applied to the quick-create dialogs
  (Category, Sub-category, Brand, Vendor) because "+ New type…" uses them.
- **Type of asset** shows only active groups/Sub-categories; work area comes from the group and is shown as a chip and as helper text after the pick.
  No frontend work-area filtering: the auth state does not carry the user's allowed work areas (see B8); the server decides.
- **Comes as a set**: a new set is named after the Item (bundle names are unique on the server); an existing set can be chosen instead
  ("Or use a set that already exists"); editing keeps the same set and its name and part ids; turning it off only clears `bundle_id`
  (the set is kept, never deleted). An Item created as a part of a set (from the parts editor or the Bundles screen) is not offered "Comes as a set".
- **Serial wording**: "Has serial number" / "No serial number" / "Serial will be entered later" → (true,false) / (false,false) / (true,true).
  The Items list now says "Yes (entered later)" (was "Yes (read later)").
- **Wizard**: each step embeds the normal screen(s) inline (step 2: Places + Stock Rooms; step 4: Asset Groups + Items; step 6: Employees + Stores).
  Opening it without `?step` pins the first step not done (replace, no history entry), so the page never jumps by itself while someone works.
  Step 6 is done with at least one Employee **or** Store (the head-office admin's own record does not count). Step 7 is done when any code rule exists.
- **Home row** uses S1's `headOfficeSection` extension point; shown only when every set-up list loaded and fewer than 7 steps are done.
- **Embedded screens** use an `h2` heading (`PageHeader as="h2"`) so a page keeps one `h1`.

## 8. Deferred

- ERP Inbox (new items / vendors / stores from the ERP) — needs backend counts (S-later).
- Server rule for changing a group's work area (only the confirmation text exists now, as briefed).
- Work-area-aware hiding in the Type of asset picker (needs B8).
- Browser/visual pass of the new screens (docker could not be rebuilt in this stage) — recommended after `docker compose up -d --build web`:
  Settings landing, Organisation tabs at phone width, Asset Groups, the Item form with a set, Set up CKAM.
- Route-level code splitting (bundle still ~1 MB, pre-existing warning).

## 9. Backend requests

| # | Request | Why / current workaround |
|---|---|---|
| B6 | Save an Item and its set in one call (e.g. `POST/PUT /items` accepting `parts`, one transaction) | The Item form saves the set first, then the Item. If the Item fails, the set already exists; the form says so and the retry updates that set (never a second one), but an abandoned form can leave an unused set behind. |
| B7 | Item counts per Category / Sub-category on `/masters/categories` and `/masters/subcategories` | Asset Groups counts from the full `/items` list client-side. |
| B8 | The user's allowed work areas (`allowed_asset_domains`) in the login/refresh response | Needed to hide other work areas' groups in pickers (UX only). Not available, so nothing is hidden. |
| B9 | Optional Codes for Category / Sub-category / Brand / Vendor (server generates when blank) | The frontend now suggests one; a server rule would make it the same for imports and every client. |
| B10 | A single `GET /setup/status` (the seven counts) | Set up CKAM and the head-office admin's Home read 8 list endpoints (cached, small, same keys as the Settings screens). |
| B11 | Mark which set belongs to which Item (e.g. `bundle.item_id`) | Today a set is just named after its Item; the Bundles screen cannot tell Item-owned sets from shared ones. |
| B12 | Confirm what deactivating a group with active Sub-categories/Items does | The screen shows the server's answer; no client rule was added. |

(B1–B5 from S1 still stand.)

## 10. Observations

- **Fixed: duplicate element ids** — opening "New Category…" from inside "New Sub-category" rendered two `#qc-name` / `#qc-code` inputs at once,
  so the inner dialog's labels pointed at the outer dialog's fields (screen readers, and Playwright's `#qc-*` selectors). The nested dialog now uses
  `qc-cat-*` ids; `inline-create.spec.ts` updated.
- The Item form's "Type of asset" needs an active Sub-category for every Item (backend rule kept); legacy Items stored without one get the group's
  only Sub-category on their next save, or must pick one when the group has several.
- `backend/app/bundles/service.py` was being modified by the concurrent backend agent; the frontend uses only the existing `/bundles` request/response
  shapes. Re-run `npx vitest run src/features/items src/features/bundles` after both changes are merged.
- The two removed route files (`routes/setup/categories.tsx`, `subcategories.tsx`) had no other importers; `DOMAIN_OPTIONS` (quick-create) is kept.
- No browser check was done in this stage (see Deferred).
