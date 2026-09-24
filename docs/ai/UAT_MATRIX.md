# CKAM — UAT Matrix

**AM-01 (2026-09-24) was a backend-only data-integrity stage** — indexes,
historical event name snapshots, company/cost-centre integrity test
coverage. No screen, route, or UI behavior changed, so the per-route rows
below are unchanged from AM-00 except the Asset Detail row's timeline
display (still functionally ✅, now additionally backed by snapshot-correct
history — no new UAT category needed, this is a backend truthfulness fix,
not a visible UI change). See `AM-01_DATA_INTEGRITY_REPORT.md` for the full
backend verification evidence (170/170 tests, migration + trigger + index
verification on both databases).

**AM-02 (2026-09-24) was also a backend-only stage** — expanded `AssetOut`,
a new `PUT /api/assets/{id}` endpoint, custom-field value validation, and
closed-value validation/CHECK constraints. No UI redesign, no frontend file
touched at all (confirmed — see `AM-02_ASSET_DATA_MODEL_REPORT.md` §24), so
the per-route rows below are unchanged from AM-01. The Add Asset, Asset
Detail, and Register screens still only render the original field subset —
the newly-exposed procurement/custom-field data has no UI consumer yet by
design (AM-02 explicitly deferred UI wiring). Full backend verification:
184/184 tests, migration + trigger verification on both databases.

Legend: ✅ verified this session · 🟡 spot-checked only (not full UAT) · ⬜ not yet checked · N/A not applicable

Functional = backend/frontend tests pass. Design = real-browser visual check.
Security = authz/scoping verified. Responsive = checked at 1440/768/375.

| Route | Functional | Design | Security | Responsive | Notes |
|---|---|---|---|---|---|
| `/login` | ✅ | ✅ | ✅ | ✅ | Full UAT: keyboard nav, Enter-submit, validation errors, failed-login banner, all 3 breakpoints, real login verified with owner account |
| `/change-password` | ✅ | 🟡 | ⬜ | ⬜ | Component tests pass; visually redesigned but not device-by-device checked |
| `/dashboard` | ✅ | 🟡 | ⬜ | ⬜ | Spot-checked at 1440 only during design-token rollout |
| `/assets` (register) | ✅ | 🟡 | ⬜ | ⬜ | Spot-checked at 1440 only |
| `/assets/new` (Add Asset) | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session |
| `/assets/$id` (Asset Detail) | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session; known gap: no loading state (`REVIEW_FINDINGS.md` #3) |
| `/my-assets` | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session |
| `/import` | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session |
| `/reports` | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session |
| `/setup/companies` | ✅ | 🟡 | ⬜ | ⬜ | Spot-checked at 1440 only (confirmed navy primary button rendering) |
| `/setup/locations` | ✅ | ⬜ | ⬜ | ⬜ | Same component as companies (`MasterCrudScreen`), not opened individually |
| `/setup/departments` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/cost-centers` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/categories` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/subcategories` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/vendors` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/custom-fields` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/holders` | ✅ | ⬜ | ⬜ | ⬜ | Bespoke component, not opened this session |
| `/setup/code-rule` | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session |
| App shell (sidebar/header) | ✅ | ✅ | N/A | ✅ | Verified expanded, collapsed-to-icons, and mobile drawer; role-gated nav content covered by `router.test.tsx` |

**E2E (Playwright):** 1/1 passing — `full custody journey: procure, allot,
return, allot again` covers login → add asset → search → lifecycle actions →
QR/logout redirect → forced password change → logout. Confirmed the seeded
test company is cleanly torn down afterward.

**Backend:** 184/184 passing (as of AM-02; was 170/170 at AM-01, 163/163 at
AM-00). **Frontend:** 56/56 passing (17 files), typecheck clean (unchanged —
AM-02 touched no frontend file).
