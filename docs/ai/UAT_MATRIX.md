# CKAM — UAT Matrix

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

**Backend:** 163/163 passing. **Frontend:** 56/56 passing (17 files),
typecheck clean.
