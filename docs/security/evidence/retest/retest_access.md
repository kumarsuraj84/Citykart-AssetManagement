# ACCESS area: retest report (stack `ckam-sec`, HEAD ae706bb, ENVIRONMENT_NAME=security-test)

Date: 2026-10-15. Personas come from the re-seeded fixture (`Sec#Test2026ok`).

Each persona signed in once. Tokens were cached and renewed by refresh. Sign-ins were spaced 3.5–6 s apart, and the change-password and refresh calls in the matrix were spaced 7 s apart. No request got a 429.

## Counts
| | executed | PASS | FAIL | N/A | INFO |
|---|---|---|---|---|---|
| Authorization matrix (217 routes x 11 personas) | 217 rows (2,387 cells) | 217 | 0 | 0 | 0 |
| IDOR/BOLA battery (rerun) | 208 | 208 | 0 | 0 | 0 |
| Escalation and mass-assignment battery (rerun) | 17 | 16 | 0 | 1 (T302 harness artifact, as in the original) | 0 |
| Business logic and idempotency battery (rerun) | 7 | 7 | 0 | 0 | 0 |
| AC-1, AC-2, IF-03 verification | 130 | 130 | 0 | 0 | 0 |
| Sessions AU-05/06/07, Primary-Owner clash, valid-body mass assignment | 51 | 50 | 0 | 0 | 1 |
| IN-03 uploads and IN-02 oversize import | 16 | 15 | 0 | 0 | 1 (polyglot) |
| **Total** (`retest_tests.csv`) | **646** | **643** | **0** | **1** | **2** |

**Concurrency bursts (part C) were NOT executed.** See `concurrency_results.md`.

## Matrix diff (`authz_matrix_retest.csv` vs `../access/authz_matrix.csv`; cells in `access_raw/authz_matrix_diff.csv`)
- 0 escalations: no lower-privilege persona got past a guard.
- 13 cells changed. Every change is an expected result of a fix:

| Route | Persona | Old | New | Why |
|---|---|---|---|---|
| GET /api/masters/{companies,locations,departments,cost-centers,categories,subcategories,brands,vendors,custom-fields}, GET /api/code-rules, GET /api/bundles | SECSELF | 200 | 403 | AC-1: the lists now use `require_role(*READ_ROLES)`. `locations` changed too because it shares the generic `build_master_router.list_items`. |
| POST /api/code-rules/preview | SECSELF | 422 | 403 | AC-1: commit 77431ba also put the preview behind staff roles. The role guard now answers before body validation. |
| GET /api/erp/pos/{po_code}/draft (9001001 = CKSPL PO) | SECOTHER (CKVPL) | 200 | 404 | IF-03: another company's PO now answers like a missing PO. |

- The 11 "role-denied" cells on POST /api/auth/refresh (401 for every persona) are the same as in the original run: the matrix sends no refresh cookie.
- Nothing changed on the upload routes in the matrix. The probe sends no multipart body, so it gets 422 both before and after.
- `/docs` (200) and `/openapi.json` (200) are still open. That is expected here, because the stack is not `production`.

## Findings status
| ID | Sev (orig) | Old behaviour | New behaviour / evidence | Status |
|---|---|---|---|---|
| AC-1 | MEDIUM | A SELF_SERVICE login read every setup list (vendors with GSTIN and contacts, companies, departments, categories, subcategories, brands, cost centres, custom fields, code rules, bundles) | SECSELF, SECSELFV and the store logins SPA and VPA get **403** on all 11 lists: `GET /api/masters/vendors -> 403 {"detail":"Not permitted for this action"}` (44 cases). The staff roles SECVIEW, SECOPIT, SECOTHER, SECFAIT and SECHO still get 200 (55 cases). SECSELF still reads its own asset 1 and its capabilities. Evidence: `access_raw/ac_fixes_transcript.txt`, `ac_fixes.json`. | **FIXED** |
| AC-2 | LOW | `GET /api/masters/custom-fields` returned company_ids [1,2] to every role | SECOPIT, SECVIEW and SECOPNIT get [1]. SECOTHER, SECVIEWV and SECOPITV get [2]. SECOPX (grant to CKVPL) gets [1,2]. ADMIN and SECHO get [1,2] (Full Admin is not company-scoped: open decision D6). `?company_id=2` does not widen SECOPIT's result. | **FIXED** |
| IF-03 (infra) | — | `GET /api/erp/pos/{code}/draft` returned another company's PO, with supplier and rates | SECOPIT gets **404** on 9002001 and 9002002. SECOTHER and SECOPITV get 404 on 9001001 and 9001002. The body is the same as for a non-existent code: `{"detail":"This purchase order was not found in the ERP."}`, so it is no existence oracle. Controls still work: own company 200, SECOPX both companies 200, SECFAIT and SECHO 200. Adjacent routes are also refused: receipts and pi 404, `POST /erp/pos/create` 422, and the ERP PO list shows no 9002xxx for SECOPIT. The local ERP copy holds these POs, so every case was exercised. | **FIXED** |
| Primary-Owner login clash | — | An employee coded like the Primary Owner's name made the "SECHO" login ambiguous (401) | SECHO matches by **name** ('SECHO'; the row has code SECHO and company_id null). SECHO created employee 34 with code `SECHO` in CKSPL, with sign-in on and an issued password. After that, `login_id "SECHO"` and `login_id "secho"` both return **200, asset_user_id 2, is_primary_owner true**. The employee's own password with login id SECHO returns 401. Employee 34 is soft-deactivated (204). | **FIXED**. Side effect (INFO): an employee whose code equals the Primary Owner's name cannot sign in by code. Each such attempt counts one failed sign-in against the Primary Owner. |
| IN-03 (input) | — | A document's content was not checked, and it was served with the type the browser claimed | HTML/script uploaded as .pdf, .png or .jpg, fake .xlsx and .docx, and .html or .svg files all get **422** with a plain message. A valid PDF or PNG uploaded with a claimed `text/html` gets **201**, and the stored `mime_type` is application/pdf or image/png. Downloads of docs 1–5 return `200`, a server-derived Content-Type, `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. | **FIXED**. INFO: the check only looks at the signature, so a `%PDF-` header followed by HTML is accepted (doc 5). It is still only ever served as an application/pdf attachment, so there is no XSS path. |
| IN-02 (input) | — | An Excel import of any size was read whole into openpyxl | A 16 MB file sent to `POST /api/imports/assets/preview?mode=add` on the API port (one attempt) gets **413** in 89 ms: `"This file is larger than 15 MB. Split it into smaller files and upload them one by one."` | **FIXED** (residual INFO: Starlette still receives and spools the whole multipart body before the handler refuses it, and production has no proxy body limit) |
| AU-05 / AU-06 (auth) | — | Logout, password change and reset left the old access and refresh tokens valid until they expired | Throw-away operator 32. The OLD access token and OLD refresh cookie both return **401 / 401** after each of: logout with own cookie, forced first change-password, own change-password, and reset by SECHO. The detail is "Your session has ended. Please sign in again." The NEW cookie from change-password still refreshes (200). Old passwords return 401. In every step SECOP2IT's and SECHO's sessions stay **200**. A logout with a bearer token and no cookie ends nothing. | **FIXED** |
| AU-07 (auth) | — | A changed role, work area, company access or sign-in setting only took effect at the next refresh | Role OPERATOR->VIEWER, work area IT->BOTH, company-access grant and sign-in switched off: each gives **401 / 401** at once on the old tokens. The next sign-in carries the new role (VIEWER). A phone-only edit does **not** end the session (200 / 200). For throw-away 33, switch-off kills the session at once, and re-enabling does not bring the old session back (401). After deactivation: 401 "Account not found or inactive". | **FIXED** |
| Mass assignment on user create (orig AC-T503) | — | (was PASS) | SECFABOTH POST /api/asset-users with `is_primary_owner, token_version, password_hash, id` in the body gets **201** with `is_primary_owner=false` and an auto id. User 35 is soft-deactivated. | still PASS |

Every IDOR/BOLA, escalation, Primary-Owner-protection, cross-company move and idempotency case from the original run still passes. That covers 208 + 16 + 7 cases.

## NEW findings
None from the cases executed. The two SUSPECTED items in `concurrency_results.md` (vendor duplicate-name race, non-atomic `token_version` increment) were **not** tested. They are not findings until a burst run confirms them.

## Not exercised
- **Part C concurrency bursts: none were run** (session stopped while the burst script was being written). There is no burst evidence, no SQL integrity check after bursts, and no log scan for deadlock or serialization errors. This retest gives no verdict on them.
- `/docs` and `/openapi.json` closing in production: this stack is `security-test`, so that cannot be checked here.

## Files
- `retest_tests.csv` (646 cases, ids RT-AC-M### for the matrix and RT-AC-T### for the batteries)
- `authz_matrix_retest.csv`
- `concurrency_results.md`
- `access_raw/`: scripts (`lib.mjs` paced/cached login, `matrix_retest.mjs`, `analyze_retest.mjs`, `idor_retest.mjs`, `escalation_retest.mjs`, `logic_retest.mjs`, `ac_fixes.mjs`, `sessions.mjs`, `uploads.mjs`, `probe_setup.mjs`, `make_retest_tests_csv.mjs`) and raw results (`*.json`, `*_transcript.txt`, `matrix_raw_retest.csv`, `authz_matrix_diff.csv`). No tokens or passwords are stored: the throw-away passwords were random and held only in memory.
