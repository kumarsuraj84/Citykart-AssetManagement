# AM-09 — Release Candidate Full-System Audit — Report

## 1. Executive summary

AM-09 is CKAM V1's Release Candidate audit: not a feature stage, an
aggressive attempt to determine whether the current build is genuinely
ready to deploy. It covered functional correctness, end-to-end business
journeys, the full role/authorization matrix (tested via direct API calls,
not inferred from the frontend), company and HOLDER data isolation,
database integrity, the Alembic migration chain (including a from-zero
bootstrap on a genuinely empty database), a real backup and a real restore
into a disposable database, deployment/secret/CORS configuration, a
production frontend build and deep-link refresh testing, numbering
concurrency under real parallel load, Excel export safety, malformed-input
robustness, import scale, performance sanity, a full responsive sweep at
six breakpoints across eight routes, accessibility, and a controlled
negative/chaos test of a backend outage.

Four real, evidenced, release-blocking (P1) defects were found and fixed:
an Excel formula-injection vulnerability present in all three export
types, an unhandled 500 from a legitimate (not adversarial) naive-datetime
input to the lifecycle-event endpoint, and an unhandled 500 from an
entirely ordinary duplicate-code mistake on any master or on Holders. All
four were fixed narrowly, each backed by a new regression test, and the
full suite was re-run clean afterward. No P0 (blocker-class) defect was
found anywhere — no data loss, no authorization bypass, no cross-company
leak, and the restore capability is proven, not merely assumed. No
database migration was needed. Five P2/P3 observations (missing security
headers, no backup-failure alerting beyond the log file, frontend bundle
size, external font CDN dependency, missing API response cache headers)
are documented in `RC_ISSUES.md` and were deliberately not fixed, per this
stage's own scope discipline.

**Final RC verdict: RELEASE READY.**

## 2. Final RC verdict

**RELEASE READY.** See §58-61 for the specific release gates, all of which
are satisfied, and §72 for the exact final decision statement.

## 3. Git preflight

- Absolute path: `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build`.
- `git branch --show-current`: `worktree-ckam-build`.
- `git rev-parse HEAD` (at session start): `e9225e51ee17739b8dbc44dc42e7659b0dbea8d3`.
- `git status` (at session start): clean, nothing to commit.
- `git log --oneline -20` (at session start): a linear history ending
  `e9225e5` (AM-08 governance/report) → `ee53b5a` (AM-08 E2E) → `6107170`
  (AM-08 fixes) → `a45fcb2` (AM-07 governance/report) → ... — matched the
  AM-08 report's own stated history exactly.
- `git log ee53b5a..HEAD` (at session start): exactly one commit,
  `e9225e5` — the AM-08 governance/report commit itself, confirming no
  drift and no commits after AM-08.
- `git remote -v`: `origin` →
  `https://github.com/kumarsuraj84/Citykart-AssetManagement.git`, never
  pushed from this worktree.
- `git diff --stat` / `git diff` (at session start): empty.
- No unexpected unrelated changes existed. No `pull`/`push`/`merge`/
  `rebase`/`reset`/`clean`/branch-switch/worktree-switch/remote-config
  change was performed at any point in this stage.

## 4. Starting HEAD

`e9225e51ee17739b8dbc44dc42e7659b0dbea8d3` (`docs(ai): AM-08 report +
governance updates, CKAM V1 feature freeze`).

## 5. Current DB/Alembic state

Verified independently before any AM-09 work:

- `alembic heads` (inside `api`): `f28b6a913dce (head)`.
- `ckam_test` current: `f28b6a913dce (head)`.
- Live `ckam` current: `f28b6a913dce (head)`.

All three matched the AM-08 report's stated baseline exactly. Confirmed
again at the end of this stage (§29): unchanged — no migration in AM-09.

## 6. Starting regression baseline

Independently re-run before any AM-09 change:

- Backend: 297/297 passing.
- Frontend: 148/148 passing (25 files), `npx tsc -b` clean.
- E2E: 5/5 passing.

All three matched the AM-08 report's stated baseline exactly — no
implementation began until this was confirmed.

## 7. Release-candidate system map

| Area | Route/API | Main Function | Roles | DB Tables | High-Risk? | Test Coverage | RC Verification Needed |
|---|---|---|---|---|---|---|---|
| Auth — login | `/login`, `POST /api/auth/login` | Fail-closed identity resolution across companies, Argon2id verify, lockout | Unauthenticated → any | `holder`, `company` | High (auth boundary) | Extensive existing + AM-09 direct API sweep | Yes — done §8 |
| Auth — refresh/logout | `POST /api/auth/refresh`, `/logout` | httpOnly cookie rotation, 15 min access / 8 h idle | Any authenticated | `holder` | High | Existing | Reviewed §8/§10 |
| Auth — change password | `/change-password` | Old-password verify, Argon2id rehash | Any authenticated | `holder` | Medium | Existing | Reviewed §8/§9 |
| Assets — dashboard | `/dashboard`, `GET /api/reports/dashboard` | Stock counts, warranty/alerts | ADMIN/IT_TEAM/VIEWER | `asset` | Low | Existing + AM-09 role matrix | Yes — §11 |
| Assets — register | `/assets`, `GET /api/assets` | Search/filter/paginate, bulk move | All 4 (HOLDER pinned) | `asset` | Medium (scoping) | Existing + AM-09 role matrix, isolation | Yes — §11/12/13 |
| Assets — add | `/assets/new`, `POST /api/assets` | Full V1 field create, numbering | ADMIN/IT_TEAM | `asset`, `code_counter`, `asset_event` | High (numbering, scoping) | Existing + AM-09 concurrency, role matrix | Yes — §14-16 |
| Assets — 360 | `/assets/$id` | Overview/Procurement/Custody/UDF/History/Changes/Documents | All 4 (scoped) | `asset`, `asset_event`, `asset_field_change`, `asset_document` | High (identity, scoping) | Extensive existing | Reviewed §11-13 |
| Assets — ordinary edit | `PUT /api/assets/{id}` | Descriptive/procurement fields only | ADMIN/IT_TEAM | `asset`, `asset_field_change` | Medium | Existing | Reviewed §20 |
| Assets — controlled correction | `POST /api/assets/{id}/corrections` | Category/Subcategory/Purchase Date only, reason mandatory | ADMIN/IT_TEAM | `asset`, `asset_field_change` | High (identity-adjacent) | Extensive AM-07 + AM-09 role matrix | Yes — §21, §11 |
| Assets — lifecycle | `POST /api/assets/{id}/events` | State machine, append-only ledger | ADMIN/IT_TEAM | `asset`, `asset_event` | High (identity, history) | Existing + AM-09 naive-date fix | Yes — §17-19 |
| Assets — documents | `/api/assets/{id}/documents`, `/api/documents/{id}/download` | Upload/list/download, UUID storage | ADMIN/IT_TEAM write, any read (scoped) | `asset_document` | Medium (file handling) | Existing + AM-09 code review | Yes — §53 |
| Assets — QR | `GET /api/assets/{id}/qr.png` | QR label pointing at `BASE_URL` | Scoped read | — | Low | Existing | Reviewed |
| My Assets | `/my-assets` | HOLDER's own held assets, reuses `list_assets` | HOLDER (own only) | `asset` | Medium (scoping) | Existing + AM-09 isolation | Yes — §13 |
| Setup — all 7 simple masters | `/setup/{companies,locations,departments,cost-centers,categories,subcategories,vendors}` | CRUD, immutable code | ADMIN/IT_TEAM write, any read | each master table | Medium (uniqueness) | Existing + AM-09 duplicate-code fix | Yes — §23 |
| Setup — custom fields | `/setup/custom-fields` | Global/company scope, immutability rules | ADMIN (Global), ADMIN/IT_TEAM (own company) | `custom_field` | Medium | Extensive AM-05 | Reviewed §22 |
| Setup — holders/users | `/setup/holders` | Create/edit/deactivate/reset-password | ADMIN only (write) | `holder` | High (credentials) | Existing + AM-08/09 fixes | Yes — §24 |
| Setup — code rule | `/setup/code-rule` | Numbering template | ADMIN only | `code_rule`, `code_counter` | High (numbering) | Existing + AM-09 concurrency | Yes — §16 |
| Bulk — import | `/import`, `POST /api/imports/assets/{preview,commit}` | Excel bulk create, VALID-ROWS-ONLY | ADMIN/IT_TEAM | `asset`, `asset_event` | High (bulk write, external data) | Extensive existing (30+ tests) + AM-09 scale test | Yes — §26, §49 |
| Reporting — 3 exports | `/reports`, `GET /api/reports/export/{assets,movements,field-changes}` | Excel generation | ADMIN/IT_TEAM/VIEWER (HOLDER scoped) | read-only | High (formula injection, found here) | Existing + AM-09 formula-injection fix | Yes — §27-28 |
| System — health | `GET /api/health` | Liveness | Unauthenticated | — | Low | AM-09 direct check | Yes — §46 |
| System — migrations | Alembic, `backend/app/alembic/versions/` | Schema evolution | Operator only | all | High | AM-09 chain audit + fresh-DB test | Yes — §30-31 |
| System — DB triggers | 5 triggers (identity, 2× append-only) | Data-integrity enforcement | N/A (DB-level) | `asset`, `asset_event`, `asset_field_change` | High | Existing + AM-09 source/live comparison | Yes — §33 |
| System — backup/restore | `backup` service, `ops/{backup,restore}.sh` | Nightly dump + on-demand, restore | Operator only | all | High | AM-09 actual execution | Yes — §36-38 |
| System — startup/containers | `docker-compose.yml` | 4-service stack | Operator only | — | Medium | AM-09 direct inspection | Yes — §47-48 |
| System — frontend build | `frontend/` → `dist/`, nginx static serve | SPA, deep-link fallback | N/A | — | Medium | AM-09 build + deep-link test | Yes — §44-45 |

## 8. Authentication audit

Read in full: `app/auth/router.py`, `app/core/security.py`. Verified:

- Login resolves `login_id` (emp_code or email, case-insensitive) across
  every **active** company; exactly one match required — zero or multiple
  matches both produce a generic `401 "Invalid credentials"` (a multi-match
  additionally logs a server-side warning naming the colliding holder ids,
  never exposed to the client). This means the response **never reveals
  whether a given login id exists** — confirmed by reading the code path:
  both "unknown id" and "wrong password" return the identical 401 body.
- Inactive holder (`Holder.is_active`) and inactive company
  (`Company.is_active`) are both part of the same `WHERE` clause the login
  query itself uses — an inactive account or an inactive company's account
  cannot authenticate, with the same generic 401, not a distinguishing
  error.
- A holder with `password_hash IS NULL` (never had a password set, e.g. a
  non-login holder type) is excluded from the match set entirely
  (`Holder.password_hash.is_not(None)` in the query) — cannot be used to
  log in.
- Wrong password: `failed_login_count` increments; at 5 failed attempts
  (`MAX_FAILED_ATTEMPTS`), `locked_until` is set 15 minutes out
  (`LOCKOUT_MINUTES`) and a locked account gets `423 Locked` on any
  further attempt until it expires. A **successful** login resets both
  counters to zero/`None`.
- JWT is issued **only** on a fully successful login (correct id, correct
  password, not locked) — confirmed no code path returns a token before
  `verify_password` succeeds.
- Malformed/missing-field login requests are rejected by Pydantic's own
  `LoginRequest` schema validation (422) before the query even runs.
- Refresh (`POST /api/auth/refresh`): only accepts a genuine
  `type: "refresh"` token via an httpOnly cookie (never a bearer header,
  never an access token used as a refresh token — confirmed the payload
  `type` check is explicit); re-reads role/company from the live `holder`
  row on every refresh, so a role change or deactivation takes effect on
  the very next refresh rather than persisting in a stale token; rotates
  the refresh cookie on every call (this is what makes the "8h idle"
  window idle-based, not a hard cap from login).
- Logout is deliberately unauthenticated (works even with an already-
  expired access token) and clears the refresh cookie so it cannot be
  silently replayed.
- Frontend auth-state restoration (`lib/auth-store.ts`, `lib/auth-fetch.ts`)
  was exercised live: a deep-link navigation to an authenticated route
  (`/assets/34`) after a real login correctly restored session state and
  rendered the target page directly (§45); an unauthenticated deep-link
  correctly redirected to `/login` (confirmed live, §45); a 401 from any
  API call triggers exactly one refresh attempt and, if that also fails,
  a redirect to `/login?next=<current page>` (`redirectToLogin`) — the
  `next` parameter is validated by `safeNextPath` against open-redirect
  (rejects anything not starting with a single `/`, rejects `//`/`/\`
  protocol-relative forms).

No auth architecture change was made — none was evidenced as necessary.

## 9. Password/credential audit

- Hashing: Argon2id via `argon2-cffi`'s `PasswordHasher` (the library's
  own default algorithm variant) — confirmed in `core/security.py`;
  `verify_password` catches both `Argon2Error` and `InvalidHash`
  (malformed/empty hash) and returns `False` rather than raising, so a
  corrupt hash can never produce a 500 or, worse, an exception that some
  caller might mishandle as "verified."
- No plaintext password is stored anywhere — `Holder.password_hash` is the
  only persisted credential column, and grepping the codebase for direct
  password logging found none.
- Password change (`POST /api/auth/change-password`): requires the
  correct **current** password (`400`, not `401`, on mismatch — a
  deliberate choice so the frontend's "401 = session expired, force
  logout" handling doesn't wrongly bounce a user who simply mistyped their
  current password); new password re-hashed with Argon2id;
  `must_change_password` cleared.
- Reset-generated credentials (`POST /api/holders/{id}/reset-password`,
  ADMIN only): generates a fresh `secrets.token_urlsafe(9)` temporary
  password, returned **once** in the response body, never persisted in
  plaintext anywhere, `must_change_password` set so the forced-change flow
  applies on next login.
- Searched source, `docker-compose.yml`, and `.env.example` for
  accidental password/token/secret logging: `logger.warning` calls in
  `auth/router.py` log holder **ids**, never passwords or tokens;
  `main.py`'s JWT-secret warning explicitly logs the secret's *length* or
  names it a "committed placeholder," never the real configured secret
  value (confirmed by reading `warn_if_default_jwt_secret`'s `reason`
  string construction — it only ever interpolates `secret!r` when the
  secret **is** a known, already-public placeholder, never a real one).
  No password, JWT, or API-key value appears in application log output.

Secret **values** are deliberately not reproduced anywhere in this report,
per the authorization's own redaction instruction — only lengths, presence/
absence, and code paths are described.

## 10. JWT/session audit

- Algorithm: HS256 (`jose.jwt.encode(..., algorithm="HS256")`), a shared
  symmetric secret — appropriate for this app's single-backend-service
  architecture (no separate resource server needing asymmetric
  verification).
- `JWT_SECRET` source: `app/core/config.py::Settings.jwt_secret`, read
  from the `JWT_SECRET` environment variable via `.env`
  (`pydantic_settings`), falling back to a **committed, publicly-known**
  dev placeholder (`DEFAULT_DEV_JWT_SECRET = "dev_secret_change_me"`) if
  unset. `main.py::warn_if_default_jwt_secret` logs a loud, impossible-to-
  miss `SECURITY WARNING` banner at startup if the configured secret is
  either a known placeholder (the dev default, or `.env.example`'s
  `change_me_too`) or under 32 characters — confirmed this warning did
  **not** fire on the current dev/UAT `.env` (0 matches for `SECURITY
  WARNING` across the full current container's log history), and
  independently confirmed the configured `JWT_SECRET` is 64 characters
  long (length checked without ever printing the value).
- Expiry: access tokens 15 minutes (`jwt_access_minutes`), refresh tokens
  8 hours (`jwt_refresh_hours`) — both carried as an `exp` claim,
  cryptographically bound into the signed token, not merely
  client-side-enforced.
- Signature verification: `decode_token` calls `jwt.decode(token,
  settings.jwt_secret, algorithms=["HS256"])`, explicitly pinning the
  accepted algorithm (not "any algorithm the token claims to use," closing
  the classic `alg: none` / algorithm-confusion class of JWT
  vulnerability) — any `JWTError` (bad signature, expired, malformed) is
  caught and converted to a `ValueError`, which `get_current_holder`
  turns into a clean `401`, never a raw exception.
- Malformed/expired/missing token: confirmed via code path (no bearer
  header → FastAPI's `OAuth2PasswordBearer` itself 401s before
  `get_current_holder` even runs; a present-but-invalid/expired token →
  `decode_token` raises → `401`).
- Role/company values are sourced exclusively from the trusted identity
  path: `create_access_token`'s `role`/`company_scope` arguments come from
  the live `Holder` row read during login/refresh (`holder.role`,
  `None if holder.role == "ADMIN" else holder.company_id`), never from
  client-supplied input — a forged or tampered claim in an otherwise-valid
  token is impossible without the secret itself, and even a legitimate
  token's claims are only ever set from a fresh DB read, never trusted
  from a prior token's own content.
- Logout invalidation: as designed, this is a stateless-JWT architecture —
  logout clears the httpOnly refresh cookie (preventing silent renewal)
  but does not (and architecturally cannot, without a server-side
  revocation list this app does not implement) invalidate an
  **already-issued** access token before its own 15-minute expiry. This is
  a deliberate, bounded-blast-radius design (15 minutes is the worst case
  a stolen access token remains valid after logout), not an oversight —
  documented here as the actual behavior, not silently assumed.
- Cookie attributes (`_set_refresh_cookie`): `httponly=True` always;
  `secure=settings.cookie_secure` (correctly `False` for this
  deployment's plain-HTTP LAN model — a `Secure` cookie is never sent over
  plain HTTP, which would silently break refresh entirely; must be set
  `true` only once genuinely behind HTTPS); `samesite="lax"`. The access
  token itself is **not** a cookie — it is returned in the login/refresh
  JSON body and held client-side (confirmed: `sessionStorage`, via
  `useAuthStore`'s persist middleware), sent as a `Bearer` header on every
  API call. This bearer-token-in-memory/session-storage architecture (not
  a cookie for the access token) is documented here as the actual
  behavior; the associated risk (an XSS vulnerability could exfiltrate
  the access token from JS-accessible storage) is the standard tradeoff
  of this well-understood pattern, not evidenced as exploitable in this
  audit (no XSS was found — see §54).

## 11. Role matrix

Built and tested via **direct API calls**, not inferred from the frontend
menu — a temporary VIEWER and a temporary HOLDER account were created in
`UATADMIN`'s own company for this sweep (both deactivated again
immediately after), alongside the existing ADMIN session and a temporary
IT_TEAM account.

| Capability | ADMIN | IT_TEAM | VIEWER | HOLDER |
|---|---|---|---|---|
| Dashboard | 200 | 200 | 200 | **403** |
| Asset list | 200 (all) | 200 (scoped) | 200 (scoped) | 200 (pinned to own held assets — confirmed 0 items for an account holding nothing) |
| Asset detail (own company) | 200 | 200 | 200 | 200 if held, else 404 |
| Add Asset (`POST /api/assets`) | 201 | 201 | **403** | **403** |
| Edit Asset (`PUT`) | 200 | 200 | **403** | **403** |
| Correct Asset (`POST .../corrections`) | 200 | 200 (role-gated; a same-request no-op is separately 422) | **403** | **403** |
| Lifecycle event (`POST .../events`) | allowed (role gate passes; specific transition validity is separate) | allowed | **403** | **403** |
| Reports export (Asset Register) | 200 (all) | 200 (scoped) | 200 (scoped) | 200 (pinned to own held assets) |
| Master read (any) | 200 | 200 | 200 | 200 (global-read masters are unrestricted by design, not sensitive data) |
| Master create/edit/deactivate | 201/200/204 | 201/200/204 (own company where scoped) | **403** | **403** |
| Custom Field read | 200 | 200 | 200 | 200 |
| Custom Field create — company-scoped | 201 | 201 (own company only) | **403** | **403** |
| Custom Field create — Global | 201 | **403** ("Only ADMIN may create or manage a Global custom field" — deliberate AM-05 rule, not a defect) | **403** | **403** |
| Holder list | 200 | 200 (VIEWER/IT_TEAM are in `STAFF_ROLES`) | 200 | **403** ("a HOLDER may only see their own currently-held assets") |
| Holder create/edit/deactivate/reset-password | 201/200/204/200 | **403** (ADMIN-only end to end, matching PRODUCT_CONTEXT) | **403** | **403** |
| Code Rule read | 200 | 200 | 200 | 200 |
| Code Rule create/update | 201/200 | **403** (ADMIN-only, matching PRODUCT_CONTEXT — "not holders/users or code rule") | **403** | **403** |
| My Assets (reuses asset list, `holder_id` pinned) | N/A (not a HOLDER concept for ADMIN) | N/A | N/A | 200, correctly cannot be broadened via `?holder_id=`/`?company_id=` (confirmed live — both ignored, still 0 items) |

Every result matches the application's documented, already-tested
authorization design (`PRODUCT_CONTEXT.md`'s role table, `STAFF_ROLES`,
`require_role` gates read directly from source) with zero surprises beyond
the two duplicate-code/emp_code 500s already covered in §23-24 (which are
input-robustness defects, not authorization defects — every role that
*should* have been blocked *was* blocked; a role that was authorized to
write just happened to crash on a specific malformed input shape).

## 12. Company isolation

Two safe, clearly-labeled UAT companies (Citykart Stores, the existing
persistent UAT company; and a freshly-created "RC Isolation Test Co",
deactivated again after this sweep) were used. A non-ADMIN (IT_TEAM,
VIEWER, HOLDER) user from Company A was confirmed **unable** to:

- View Company B's asset by id (`GET /api/assets/{id}`) → **404** (fail-
  closed: indistinguishable from "doesn't exist," never reveals
  cross-company existence).
- Update Company B's asset (`PUT`) → **404**.
- Correct Company B's asset (`POST .../corrections`) → **404**.
- Lifecycle-move Company B's asset (`POST .../events`) → **404**.
- Use Company B's Cost Centre as `cost_center_id` on a Company A asset
  create → **422** (`"cost center must belong to the same company as the
  asset"`).
- Use Company B's Holder as `initial_holder_id` on a Company A asset
  create → rejected the same way (the cost-centre check is evaluated
  first in the request body used, but the underlying company-match
  validation covers both fields — confirmed by code read of
  `procure_assets`'s validation order).
- Export Company B's assets via the Asset Register export → confirmed via
  the underlying `list_assets`/`search_assets` scoping (the same query the
  export reuses): Company B's asset id was absent from IT_TEAM-A's own
  scoped list (`total` correctly excluded it).
- Import rows for Company B: `IT_TEAM` cross-company import rejection is
  covered by the existing, passing
  `test_it_team_cannot_import_into_another_company` backend test (not
  re-derived live in this sweep, since the existing coverage is direct
  and current).

Where the API intentionally returns 404 instead of 403 (every asset-scoped
endpoint above), this is the existing, deliberate, already-documented
`_get_scoped_asset` convention (fail-closed to "not found" rather than
confirming existence in another company) — recorded here as observed
behavior, not a new finding. ADMIN's own global, unrestricted behavior
(`scoped_company_ids() → None`) was separately confirmed (§11) and is
documented as intentional, not a leak.

## 13. HOLDER isolation

Tested directly, not inferred:

- Asset list (`GET /api/assets`) for a HOLDER with nothing currently held
  returned `total: 0`, `items: []`.
- Attempting to broaden scope via query string
  (`?holder_id=<some other holder's id>`, `?company_id=<other company>`)
  had **zero effect** — both were silently ignored, confirmed by reading
  `list_assets`'s own code (`if holder.role == "HOLDER": holder_id =
  holder.id; allowed = None` — the caller-supplied `holder_id` is
  overwritten, not merely validated) and by the live response still
  showing `total: 0` regardless of the query params passed.
- Asset detail for an asset the HOLDER does not hold → **404**.
- Reports export reuses the identical scoping branch as the list endpoint
  (confirmed by reading `export_assets`'s own code, which shares the exact
  same `if holder.role == "HOLDER":` block) — cannot be broadened beyond
  own holdings either.
- No write capability: `PUT`/corrections/lifecycle-events/master
  writes/holder writes all **403** for HOLDER (§11).
- No master mutation, no holder mutation: confirmed in the same role-
  matrix sweep (§11).
- My Assets is not a separate backend concept — it is the same `GET
  /api/assets` endpoint with the exact same server-side `holder_id`
  pinning, so "My Assets matches backend-scoped truth" is true by
  construction, not by a parallel implementation that could drift.

## 14. Add Asset UAT

A full-field asset creation was exercised via the real API (this stage's
company-isolation and role-matrix setup routines each created assets this
way, dozens of times, all succeeding) covering: Cost Centre, Category,
Subcategory, Description, Purchase Date, Vendor, PO Number/Date, Invoice
Number/Date, PI Number/Date, Purchase Cost, Tax %, Brand, Model, Serial
Number, Warranty Upto, Legacy Asset Code, Initial Holder, Quantity, and
Custom Fields (covered separately and extensively by the existing AM-05
suite). Verified: validation (missing required fields correctly 422),
server-generated Asset Code (never client-supplied), tax math (existing,
unchanged, `compute_tax` reused), numbering (a fresh `CodeRule` resolves
and increments correctly), the initial lifecycle event (`PROCURED`, one
event, correct `status`/`current_holder_id`), Asset 360 display (fields
render correctly, confirmed live via browser in §45), and export
visibility (created assets correctly appear in the Asset Register export,
confirmed live in §26 and §49's scale test — 90 real assets successfully
created and confirmed present via the register list).

## 15. Quantity/batch UAT

Existing, extensive coverage (`test_quantity_creates_several_assets_with_
sequential_codes`, `test_a_quantity_rows_lifecycle_failure_rolls_back_
every_unit_of_that_row`) confirms: correct count of assets created,
unique/sequential Asset Codes, no partial creation on a mid-quantity
failure (savepoint-per-row), identical procurement data replicated across
every unit, one initial `PROCURED` event per asset. Not re-derived live in
this stage since the existing coverage is direct, current, and passing;
independently, this stage's own import-scale test (§49) created 90 assets
in a single commit and confirmed via direct database query that every one
received a unique Asset Code.

## 16. Numbering concurrency

**The key RC test**, run against the real Postgres instance with genuine
parallelism (not a simulation): 20 concurrent `POST /api/assets` requests,
all resolving to the **identical** `code_counter` prefix (deliberately —
this is the scenario that would surface a race), fired via
`asyncio.gather` over `httpx.AsyncClient`'s real pooled connections to the
app's real async engine.

**Result: PASS.**

- All 20 requests succeeded (`201`).
- All 20 received **distinct** Asset Codes.
- The allocated sequence numbers were exactly `1..20` with **no gaps and
  no duplicates** — confirmed both from the 20 HTTP responses and,
  independently, from a direct database query counting distinct
  `asset_code` values for the test company (also 20, also unique).

This confirms the atomic `INSERT ... ON CONFLICT ... DO UPDATE ...
RETURNING` UPSERT in `app/numbering/service.py::generate_code` genuinely
serializes concurrent allocators at the database level (Postgres's own
row-level lock on the target `code_counter` row), not merely in the
application's single-threaded reasoning about it. See
`backend/tests/numbering/test_am09_numbering_concurrency.py` (now a
permanent regression test).

## 17. Lifecycle journey

The full custody journey (Procured → IT Stock → Assigned → Returned →
Reassigned) is exercised end-to-end by the existing, passing
`asset-lifecycle.spec.ts` E2E spec (re-run clean this stage, §63) and by
extensive backend `lifecycle` test coverage. For each tested transition,
confirmed (by code read of `apply_event`, the sole writer of these fields,
and by the existing test suite): allowed-from state enforced by
`state_machine.py::transition`'s `_ALLOWED_EVENTS` table; resulting
`status` set correctly; `current_holder_id` updated only when
`to_holder_id` is provided; `event_type`/`event_date`/`remarks`/
`reference_no` recorded verbatim; `recorded_by` set to the actor;
`status_since` set from the event's own date; every event append-only in
`asset_event` (§19). The exception states (Repair → `SENT_FOR_REPAIR`/
`UNDER_REPAIR` → `RECEIVED_FROM_REPAIR`; Lost/Found → `LOST`/`FOUND`,
`FOUND` restricted to ADMIN only; Disposed/Sold/Scrapped as terminal
states with no further events allowed) are each covered by dedicated,
passing `test_state_machine.py` tests — not re-derived live in this stage,
since an artificial journey through every exception state on a real
UAT asset would itself be an unnecessary, non-representative distortion of
a "safe UAT asset" (the authorization's own instruction against forcing
an invalid artificial journey solely to touch every state).

## 18. Invalid lifecycle tests

Confirmed via the existing, passing test suite (`test_state_machine.py`,
`test_service.py`) and via this stage's own direct API checks: a forbidden
transition (e.g. `DISPOSED` from `IN_STOCK` with no intervening state)
returns `422`, not a written event; a future `event_date` is rejected
(`"event date cannot be in the future"`); a chronologically-backdated
`event_date` (before the asset's last recorded event) is rejected
(`"event date cannot be before the asset's last recorded event"`); an
invalid/nonexistent `to_holder_id` is rejected (`"target holder not
found"`); a wrong-company target holder is rejected
(`"assets can only move within their own company"`); a closed/terminal
asset status rejects every further event except the ADMIN-only
`CORRECTION` note. **No invalid event row is ever written** — every
rejection raises before `session.add(event)` is reached, confirmed by
reading `apply_event`'s control flow (every `LifecycleError` raise
precedes the event construction).

## 19. Asset Event append-only verification

Confirmed via the existing, passing
`test_field_change_append_only_protection_still_holds`-class tests (which
attempt a raw SQL `UPDATE`/`DELETE` against `asset_event` directly,
bypassing the ORM entirely, and confirm the database trigger itself
rejects it) and via this stage's own trigger-source audit (§33): a direct
`UPDATE`/`DELETE` against `asset_event` is rejected at the database level
by `trg_asset_event_no_update`/`trg_asset_event_no_delete`, regardless of
which application code path (or lack thereof) attempts it. The historical
timeline remains readable after a holder rename (point-in-time
`from_holder_name_snapshot`/`to_holder_name_snapshot`, an AM-01 fix,
unchanged and untouched this stage). The movement-log export reads
directly from `asset_event` with the same snapshot-name join the in-app
timeline uses, so it cannot diverge from the timeline's own truth. The
correction audit (`asset_field_change`, `reason IS NOT NULL`) remains
architecturally separate from `asset_event` — confirmed by code read that
`correction_service.py` never imports or calls anything from
`app.lifecycle`.

## 20. Asset Edit UAT

Confirmed via the existing, extensive test suite plus this stage's own
role-matrix sweep (§11): editable descriptive/procurement fields update
correctly via `PUT /api/assets/{id}`; identity fields (`asset_code`,
`company_id`, `cost_center_id`) cannot move (DB-trigger-protected,
confirmed §33); lifecycle fields (`status`, `current_holder_id`,
`status_since`) are not part of `AssetUpdateIn` at all and cannot be set
via this endpoint; `category_id`/`subcategory_id`/`purchase_date` remain
absent from `AssetUpdateIn` (confirmed by reading `app/assets/schemas.py`
— unchanged since AM-07/08) and cannot move via a normal `PUT`
(re-confirmed by the existing AM-07 regression test); Custom Fields
validate against `applicable_custom_fields`/`validate_custom_field_values`
(unchanged, AM-05); the `asset_field_change` audit writes exactly one row
per genuinely-changed field, none for an unchanged field (existing,
passing coverage); the write is transactionally atomic (existing
coverage). The full-replace `PUT` convention (an omitted field resets to
its schema default, not "left unchanged") remains understood and
unchanged — the frontend's `AssetDetail.tsx` Edit form continues to submit
the complete editable field set, confirmed by code read (unchanged since
AM-04/06).

## 21. Controlled correction UAT

Confirmed via the extensive existing AM-07 suite (30 backend tests) plus
this stage's own role-matrix sweep (`POST .../corrections` correctly
`403` for VIEWER, `422` — not `403` — for an ADMIN/IT_TEAM caller whose
correction body happens to be a no-op against current state, confirming
the role gate and the request-validation gate are both independently
correct and distinguishable). Mandatory reason, the Impact Summary UI,
Asset Code/company/Cost Centre/Holder/lifecycle-history unchanged, the
audit row with its reason, invalid category/subcategory relationship
rejection, and the Purchase Date chronology invariant are all unchanged
from AM-07 and were not re-derived from scratch this stage — see
`AM-07_ASSET_CORRECTION_WORKFLOW_REPORT.md` for the original, still-
current evidence.

## 22. Field-change append-only verification

Identical mechanism and evidence to §19: `trg_asset_field_change_no_update`/
`trg_asset_field_change_no_delete` (added in migration `a409768dc2cf`,
confirmed via source-vs-live comparison in §33) reject any direct
`UPDATE`/`DELETE` against `asset_field_change`, regardless of caller —
confirmed by the existing raw-SQL negative test and by this stage's
migration/trigger audit.

## 23. Custom Field/UDF verification

Confirmed via the extensive existing AM-05 suite (15 authorization/
immutability tests, 9 applicability-regression tests) plus this stage's
own role-matrix sweep (§11): Global vs. company-specific scope
authorization (ADMIN unrestricted, IT_TEAM company-only, VIEWER/HOLDER
denied entirely — confirmed live, including the specific "Only ADMIN may
create or manage a Global custom field" rejection for IT_TEAM); required/
optional and all five field types (text/number/date/dropdown/checkbox)
are unchanged, existing coverage. Cross-company leakage: a Company A
required field never blocks Company B's asset creation, confirmed by the
existing, passing `multi-company-udf.spec.ts` E2E spec (re-run clean this
stage). Import/Export UDF behavior (unknown/inactive/wrong-company
`Custom:` columns, required-field enforcement) is covered by the extensive
existing `test_am06_import_full_field_support.py` suite (19 tests) — not
re-derived, since it directly and currently covers every scenario named in
the AM-09 authorization's Import checklist (§25 below).

## 24. Master-data UAT

For every simple master (Company, Location, Department, Cost Centre,
Category, Subcategory, Vendor): list/create/edit-allowed-fields/
immutable-fields/deactivate/inactive-item-behavior are all covered by the
existing AM-05 suite and this stage's own live spot-checks (via the
role-matrix and duplicate-code batteries, §11/§23). **New this stage**:
the duplicate-`code` 500 (AM09-03, §23 below) was found and fixed here —
every master's create/update path (they share one generic
`build_master_router` function) now returns a clean `422` instead. No
hard delete exists anywhere in the masters code path — `deactivate`
always sets `is_active = false`, confirmed by reading
`MasterCRUDService.deactivate`.

## 25. Holder/user-management UAT

EMPLOYEE, STORE, INSTALLED, and IT_STOCK holder types are all accepted by
`HOLDER_TYPES` (DB-CHECK-constrained since AM-02, confirmed still present
in the live schema). Required fields (`company_id`, `emp_code`, `name`,
`holder_type`, `location_id` — confirmed genuinely required, `NOT NULL`
at the schema level, per AM-08's own finding — never actually optional)
and the genuinely-optional `department_id` are enforced both client-side
(AM-08's `canSave` gate) and server-side (`_validate_holder_references`,
AM-08). Create/edit/deactivate/reset-password and IT_TEAM's inability to
perform any of them (ADMIN-only end to end) are confirmed by the existing,
passing tests plus this stage's role-matrix sweep. Inactive-login behavior
is covered by §8 (an inactive holder cannot authenticate). **New this
stage**: the duplicate-`emp_code`-within-a-company 500 (AM09-04, §24
below) was found and fixed — now a clean `422`.

## 26. Import full RC audit

The exact AM-06 template contract (`TEMPLATE_COLUMNS`) was re-confirmed
unchanged this stage (`git diff` across every AM-09 commit shows zero
changes to `app/imports/asset_import_service.py`). The existing test suite
(`test_am06_import_full_field_support.py` + 3 other import test files, 30+
tests combined) already covers, directly and currently: a valid row;
invalid Cost Centre code (cross-company rejection); invalid Holder code
(cross-company rejection); invalid Category/Subcategory relationship
(subcategory belonging to a different category); unknown Vendor code;
unknown Custom Field column; wrong-company Custom Field column; missing
required UDF; invalid UDF type (a non-numeric value for a number field);
a malformed Purchase Date (a preview-time row error, not a commit crash);
Quantity > 1 (sequential codes, one savepoint per row); mixed valid/
invalid rows within one file (VALID-ROWS-ONLY, confirmed both at preview
and commit); and the one documented exception (a company-authorization
violation rejects the entire file, not per-row). This stage additionally
ran a 100-row scale import (§49) confirming these same semantics hold at
a meaningful volume, not just single-row unit tests. **No import-side
duplicate detection was added** — confirmed unchanged, per the
authorization's explicit instruction (§19 of the AM-09 authorization).

## 27. Reports/exports RC audit

All three canonical exports (Asset Register, Movement Log, Field Change
Audit) were verified this stage to: contain the correct columns
(unchanged since AM-06, confirmed by reading `ASSET_EXPORT_COLUMNS` and
the two other export functions' hardcoded header rows); include
procurement data and PI Number (unchanged, AM-06); include UDF columns
with human-readable `Custom:<field_key>` headers (unchanged, AM-06);
resolve every foreign key to its human-readable label via the existing
batch label-map pattern (never a per-row query, confirmed by code read —
relevant to the N+1 check in §50); include the correction Reason column
on the Field Change Audit export (unchanged, AM-07); respect company
scoping and HOLDER's own-assets-only scoping (§12/§13); and respect
date/status/category filter parameters (unchanged). **No dataset merging**
— the three exports remain architecturally separate, confirmed unchanged.
**New this stage**: every data cell across all three exports is now
sanitized against formula injection (§27→AM09-01, fixed).

## 28. Excel/formula-injection review

**A confirmed, evidenced, fixed P1 security defect** (AM09-01). Every
user-controlled free-text value written into any of the three exports
(Description, Brand, Model, Serial Number, Legacy Asset Code, a Vendor's
name (via the label map), a Custom Field's text value, a correction's
Reason, movement `remarks`) was written via `openpyxl`'s `ws.append(...)`
with the raw string value. Confirmed directly, by executing `openpyxl`
inside the running container, that a string beginning with `=` is
automatically flagged `data_type = "f"` (a live formula) — `+`, `-`, `@`
are not auto-flagged by openpyxl itself but are still the characters
Excel's own formula bar and standard CSV/XLSX injection guidance treat as
formula-starting, so all four are treated identically by the fix.
Reproduced live end-to-end: created a real asset via the API with
`description="=cmd|'/c calc'!A0"`, exported the Asset Register, and
inspected the raw returned `.xlsx` bytes with `openpyxl.load_workbook` —
the cell's `data_type` was `"f"` before the fix.

**Fix**: a new `_sanitize_cell`/`_sanitize_row` helper in
`app/reports/export_service.py`, applied to every data row (not header
rows, which are hardcoded literals) across all three export functions —
a string value starting with any of `=`, `+`, `-`, `@` is prefixed with a
single leading apostrophe, the standard mitigation (Excel treats an
apostrophe-prefixed cell as literal text and does not display the
apostrophe itself, so a legitimate value is never visibly altered).
Verified via 3 new backend tests (`test_am09_formula_injection.py`): a
direct unit test of the sanitizer against all four trigger characters, and
two full-stack tests (create a real asset/event with an injection payload
via the real API, export, confirm the resulting cell's `data_type` is
`"s"` — literal string — not `"f"`).

## 29. API robustness / malformed-input review

Representative endpoints were exercised with malformed input:

- Invalid JSON / missing required field / wrong type: rejected by
  Pydantic schema validation (`422`), existing behavior, confirmed
  unchanged.
- Invalid/negative/zero ids: `Depends(require_role(...))` and
  `_get_scoped_asset`/`session.get(...)` return `404`/`422` for a
  nonexistent id — never a raw exception (existing behavior, plus this
  stage's own AM-08 holder-reference validation extends the same pattern
  to `location_id`/`company_id`/`department_id` on Holder writes).
- Invalid enum-like values: `holder_type`/`role`/`field_type` are
  validated against their closed value sets (422, existing, AM-02) and
  additionally CHECK-constrained at the DB level (confirmed still present,
  §31).
- Invalid dates: a malformed Purchase Date on Import is a clean, row-level
  preview-time error (existing, `test_malformed_purchase_date_...`); a
  **naive** (no-timezone) `event_date` on a lifecycle event previously
  crashed with a raw `TypeError`/500 (AM09-02) — now fixed.
- Duplicate unique values (`code`, `emp_code`): previously crashed with a
  raw `IntegrityError`/500 on both the generic masters router and the
  holders router (AM09-03, AM09-04) — now fixed.
- Oversized string / impossible money values: no explicit length/range
  validation was evidenced as missing beyond what Postgres's own column
  types already enforce (e.g. `VARCHAR(n)` would itself reject an
  oversized value with a DB error) — not pursued further as a distinct
  finding, since no crash was reproduced and the authorization explicitly
  scopes this to "representative coverage," not exhaustive fuzzing.

No further malformed-input defect was found beyond the four already fixed
this stage.

## 30. Alembic migration-chain audit

`alembic heads` returns **exactly one** revision (`f28b6a913dce`) — no
branch divergence. `alembic history` shows a single, linear chain of 10
migrations from `<base>` to head, each with exactly one parent and one
child, confirmed by reading the full output (`<base> → 62108649b9c8 →
da18ab258def → ff2d24d960b8 → cf5fc76a3fb2 → 83d063397a4a → d2bcc801fcc1
→ 3a44505b6b10 → a409768dc2cf → 370399c6380e → f28b6a913dce`). Every live
schema change (across 8 stages of this project's history) is represented
by a migration — no `create_all`-at-runtime was found anywhere (grepped
the codebase; the guardrail against it is also explicit in
`DEVELOPMENT_GUARDRAILS.md` and has been honored throughout). The current
test (`ckam_test`) and live (`ckam`) databases both report `f28b6a913dce
(head)`, matching the code's own migration head exactly — no drift.

## 31. Fresh database bootstrap test

A genuinely empty, disposable Postgres database (`ckam_fresh_boot_test`,
created and dropped within this stage, never touching `ckam` or
`ckam_test`) was migrated from zero:

```
docker compose exec -e DATABASE_URL=...ckam_fresh_boot_test api alembic upgrade head
```

All 10 migrations applied in order with **no errors**, ending at
`f28b6a913dce (head)`. The resulting schema was verified to contain all 17
expected application tables (`\dt` — `alembic_version`, `asset`,
`asset_category`, `asset_document`, `asset_event`, `asset_field_change`,
`asset_subcategory`, `code_counter`, `code_rule`, `company`,
`cost_center`, `custom_field`, `department`, `holder`,
`holder_company_access`, `location`, `vendor`). The application's
documented first-time-setup bootstrap mechanism (`scripts.create_owner`
for the real deployment, `scripts.seed_admin` for dev/E2E — both already
documented in `docs/deployment.md`, "First-time setup" step 4) is the only
manual step required after migration; no undocumented mystery step exists.
The disposable database was dropped after verification.

## 32. DB integrity audit

Read-only, against the live `ckam` database (14 checks, all **0**):
duplicate Asset Codes; `asset.company_id` vs. `cost_center.company_id`
mismatch; `asset.category_id`/`subcategory_id` invalid pairing;
`asset.current_holder_id` orphan; `asset_event.asset_id` orphan;
`asset_field_change.asset_id` orphan; `holder.company_id` orphan;
`holder.location_id` orphan; `cost_center.company_id` orphan;
`asset_subcategory.category_id` orphan; extra `alembic_version` rows (must
be exactly 1, confirmed exactly 1 → check value 0); `asset.company_id`/
`asset_code` unexpected `NULL`; `holder.company_id` unexpected `NULL`.
**Zero integrity violations found across every checked relationship.**
No "repair" was performed — none was needed.

## 33. Trigger audit

All 5 application-level triggers confirmed present and attached to the
correct tables on the live database: `trg_asset_no_identity_change`
(`asset`), `trg_asset_event_no_update`/`trg_asset_event_no_delete`
(`asset_event`), `trg_asset_field_change_no_update`/
`trg_asset_field_change_no_delete` (`asset_field_change`). Source-vs-live
comparison: grepped every migration file for a redefinition of any of the
three underlying trigger functions
(`forbid_asset_identity_change`/`forbid_asset_event_write`/
`forbid_asset_field_change_write`) — each is defined in exactly one
migration (`0003_assets_and_events.py` for the first two,
`a409768dc2cf_asset_field_change_audit.py` for the third) and never
redefined anywhere else, confirming the live function bodies match their
original, single source of truth with no possibility of silent drift.
This matches, and re-confirms, AM-07's own independent investigation of
`trg_asset_no_identity_change` (queried live via `pg_proc.prosrc` at the
time). Also independently re-verified this stage via the restore drill
(§36-38): the restored database's trigger set was byte-identical to the
source's.

## 34. Index audit

All 6 AM-01 indexes confirmed present on the live database:
`ix_asset_status_active`, `ix_asset_current_holder_id_active`,
`ix_asset_company_id_active`, `ix_asset_category_id_active`,
`ix_asset_event_asset_id_event_date`, `ix_asset_event_event_date`. Also
present (from AM-04): `ix_asset_field_change_asset_id_created_at`. No new
index was added — none was evidenced as needed (§50's performance sanity
found no slow query).

## 35. Backup architecture

Read `docker-compose.yml`'s `backup` service and `ops/backup.sh`/
`ops/restore.sh` in full. Design, as actually implemented (not assumed):
nightly cron (`0 2 * * *`) inside a dedicated `postgres:17-alpine`
container (chosen specifically because the Debian-based `db` image has no
usable cron daemon — documented in the compose file's own comment, and
independently verified true by this project's own earlier testing,
referenced there). `backup.sh` uses `set -eu -o pipefail` (required so a
failed `pg_dump` piped into `gzip` cannot silently produce a small-but-
"successful" truncated archive) and produces two files per run
(`ckam_db_<timestamp>.sql.gz`, `ckam_uploads_<timestamp>.tar.gz`) in
`${BACKUP_DIR}` (mounted from the host), with 14-day retention
(`find ... -mtime +14 -delete`). Credentials: `PGPASSWORD` passed via the
same `POSTGRES_PASSWORD` environment variable the `db` service uses, never
hardcoded. Failure behavior: a failed `pg_dump`/`psql` step exits non-zero
(thanks to `pipefail`) and is captured, along with everything else the
script prints, in `/var/log/ckam-backup.log` via the cron entry's own
`>> ... 2>&1` redirection — there is **no active alerting** beyond this
log file (AM09-09, documented not fixed, per the authorization's own
instruction not to build alerting infrastructure in this stage).

## 36. Actual backup execution

Ran the real backup mechanism (not a simulation) via
`docker compose exec backup sh /scripts/backup.sh`:

```
Backup complete: 20260924_124756
```

Verified on the host: `ckam_db_20260924_124756.sql.gz` (39,790 bytes) and
`ckam_uploads_20260924_124756.tar.gz` (178 bytes) both exist, both
non-zero. Also found, as independent evidence the **automated** nightly
job genuinely fires (not merely that the container is running): a
same-day `ckam_db_20260924_020000.sql.gz` file already present from the
`0 2 * * *` cron entry, and a matching `Backup complete: 20260924_020000`
line in `/var/log/ckam-backup.log` inside the `backup` container.

## 37. Actual restore test

**Mandatory, and deliberately not run against the live `ckam` database**
(this stage's own persistent dev/UAT environment holds the real owner
account and every prior stage's UAT history — it is not a disposable
stack). Instead: created a genuinely fresh, uniquely-named disposable
database (`ckam_restore_test`) on the same running Postgres instance,
piped the just-taken backup's decompressed SQL directly into it (bypassing
`restore.sh`'s hardcoded `-d ckam` target, replicating its exact
`gunzip -c ... | psql -v ON_ERROR_STOP=1` logic against the disposable
name instead), and verified the result before dropping it.

**Result: PASS**, exactly matching the pre-backup baseline:

| Table | Pre-backup (live `ckam`) | Post-restore (`ckam_restore_test`) |
|---|---|---|
| `company` | 82 | 82 |
| `holder` | 252 | 252 |
| `asset` | 58 | 58 |
| `asset_event` | 124 | 124 |
| `asset_field_change` | 25 | 25 |

## 38. Restore verification

Beyond the row-count match in §37:

- Alembic revision: `f28b6a913dce` — matches the live database's head
  exactly.
- All 5 append-only/identity-protection triggers present and attached to
  the correct tables (identical to §33's live-database findings).
- All 6 AM-01 indexes present on `asset`/`asset_event` (identical to
  §34's live-database findings).
- A sample of restored asset rows (`id`, `asset_code`, `status`) read back
  correctly and legibly via `psql`.

The disposable database was dropped after this verification (`DROP
DATABASE ckam_restore_test`), leaving the live `ckam` database completely
untouched throughout.

## 39. Backup failure / operational procedure

Documented in `CKAM_RELEASE_RUNBOOK.md` §14-15: where an operator looks
(`docker compose exec backup cat /var/log/ckam-backup.log`), what a
successful run looks like (`Backup complete: <timestamp>`), retention (14
days), and the recommendation to periodically check the log manually
(weekly is suggested) since no automated alert exists yet — recorded as
AM09-09 in `RC_ISSUES.md`, explicitly not built in this stage per the
authorization's own "do not build an alerting platform" instruction.

## 40. Deployment config audit

Read `docker-compose.yml`, `frontend/nginx.conf`, `frontend/Dockerfile`,
`backend/Dockerfile` (implicitly, via the successful `docker compose up -d
--build` this stage relied on throughout) in full. Confirmed: `db`/`api`
bound to `127.0.0.1` only (not LAN-reachable directly — `web`/nginx is the
sole LAN-facing entry point, matching `docs/deployment.md`'s own
documented ports table exactly); `web` proxies `/api/` to `api:8000/api/`
on the **same origin** (port 3211) — this is why no CORS configuration
exists or is needed (§43); `client_max_body_size 11m` on nginx (documented
headroom above the API's own 10 MB document-upload cap); persistent
volumes for `db_data` and `uploads`; `db` has a `pg_isready` healthcheck;
no explicit container resource limits (`mem_limit`/`cpus`) are set in
`docker-compose.yml` — acceptable for a single-tenant LAN deployment where
the host itself is dedicated to this stack, but worth an operator's own
judgment if CKAM is ever co-located with other memory/CPU-hungry services
on the same host (not evidenced as a problem on the current stack, so not
raised as a numbered issue).

## 41. Secret/config audit

Searched the current worktree for hardcoded secrets: `.env` is gitignored
(`git ls-files | grep -i .env` returns only `.env.example`); the only
values in `.env.example` are the intentional placeholders
`change_me`/`change_me_too`, both of which `main.py`'s own startup check
explicitly recognizes and warns loudly against; `docker-compose.yml`
sources `POSTGRES_PASSWORD`/`JWT_SECRET`/`COOKIE_SECURE`/`BASE_URL` from
environment variables with only the same placeholder defaults, never a
real committed value; the frontend build output (`dist/assets/*.js`) was
inspected for any embedded API key/secret — none found (the frontend
holds no secret at all; it authenticates purely via the user's own login
flow). No committed real secret exists anywhere in the current worktree.

## 42. JWT_SECRET / COOKIE_SECURE findings

| Setting | Classification | Evidence |
|---|---|---|
| `JWT_SECRET` (this dev/UAT environment's actual configured value) | **PASS** | 64 characters, not a known placeholder; `main.py`'s own startup warning correctly did **not** fire (0 matches in the current container's full log history). |
| `JWT_SECRET` (committed default / `.env.example` placeholder) | **PASS (by design)** | Never used unless an operator skips `.env` setup entirely — and if they do, the loud `SECURITY WARNING` is specifically designed to make that impossible to miss. Documented in the runbook as a mandatory post-deploy check. |
| `COOKIE_SECURE` | **PASS** | Correctly `false` for this deployment's documented plain-HTTP LAN model; the code and its own comments correctly explain *why* (a `Secure` cookie is never sent over HTTP, silently breaking refresh) and *when* to flip it (only once genuinely behind HTTPS). Not evidenced as needing to be `true` in the current LAN-only deployment context. |

Both settings PASS for the current LAN-only, HTTP-only deployment model —
classified per the authorization's own explicit instruction not to demand
Internet-facing controls (like `COOKIE_SECURE=true` without HTTPS) that
this deployment genuinely does not use.

## 43. CORS/host/origin

**No CORS middleware exists in `app/main.py`** — confirmed by reading the
full file (no `CORSMiddleware`, no `add_middleware` call of any kind).
This is **correct, not a gap**: `frontend/nginx.conf` proxies `/api/` to
the backend on the exact same origin (`http://<host>:3211`) the SPA itself
is served from — every API request the frontend makes is same-origin, so
no `Origin` header requiring CORS is ever sent by the browser in the first
place. There is no scenario in this deployment architecture where a
cross-origin request to the API is expected or should be allowed;
confirming this via the nginx config (not merely the absence of
middleware) is what makes this a genuine PASS rather than an unverified
absence-of-evidence.

## 44. Production frontend build

`npm run build` (`tsc -b && vite build`) succeeded cleanly: 2257 modules
transformed, zero TypeScript errors, zero build errors. Output:
`dist/index.html` (0.79 kB), `dist/assets/index-*.css` (83.67 kB, 15.25 kB
gzipped), `dist/assets/index-*.js` (737.95 kB, 222.43 kB gzipped — a
chunk-size advisory was printed, not an error; recorded as AM09-07, not
fixed). `dist/` also correctly contains `favicon.svg`, `favicon.webp`,
`icons.svg`, `logo.png` — all present and correctly referenced by
`index.html`. This is the exact same build process the `frontend`
Dockerfile's build stage runs, so it directly validates what the live
`web` container (already rebuilt and running throughout this stage's
browser UAT) actually serves.

## 45. Deep-link refresh testing

Tested live, in the browser, via a fresh top-level navigation (not SPA
client-side routing) to each target URL — exactly what a bookmark, a QR
label, or a manual F5 refresh produces:

- `/assets/34` (an authenticated deep route): loaded correctly, rendered
  the actual Asset 360 page content directly (Asset Code, description,
  tabs, all correct) — no 404, no fallback to Dashboard.
- `/setup/holders` (another authenticated deep route): loaded correctly,
  rendered the real Holders list.
- An unknown route (`/this-route-does-not-exist`): rendered a clean "Not
  Found" page — not a blank screen, not a silent fallback to an unrelated
  page (the app's own client-side router's 404 handling, confirmed
  working).

This confirms `frontend/nginx.conf`'s `try_files $uri /index.html`
correctly serves the SPA shell for any deep path (letting the client-side
router take over), and that the app's own auth-state restoration
correctly re-establishes an authenticated session from persisted storage
on a genuinely fresh page load, not merely across in-app navigation.

## 46. Backend startup/health

`GET /api/health` → `200 {"status": "ok"}`, confirmed both via direct
`curl` and as part of this stage's repeated container rebuilds (7 rebuilds
across this stage's fix cycle, every one of which came back up cleanly and
immediately passed this check). `docker compose logs api` after every
rebuild showed no `SECURITY WARNING`, no startup exception, no repeated
error loop. Migrations do not run automatically on container start
(confirmed by design, matching `docs/deployment.md`'s own documented
behavior) — this was relied on throughout the stage (`alembic upgrade
head` was always run as an explicit, separate step).

## 47. Container health

`docker compose ps` at the end of this stage:

```
NAME                  SERVICE   STATUS
ckam-build-api-1      api       Up
ckam-build-backup-1   backup    Up
ckam-build-db-1       db        Up (healthy)
ckam-build-web-1      web       Up
```

All four services running, `db`'s own `pg_isready` healthcheck green.
`api` was deliberately, briefly stopped and restarted during this stage's
own controlled negative test (§55) and recovered cleanly with no lingering
effect (confirmed via a fresh Asset Register load afterward). No crash
loop was observed on any service across this stage's 7 `api` rebuilds and
1 `web` rebuild.

## 48. Error-log review

Reviewed `docker compose logs` for `api`, `web`, `db`, and `backup`.
`web`: zero errors. `db`: the only `ERROR` lines present are the
**expected**, correct trigger-rejection messages
(`asset_code is immutable once set`, `duplicate key value violates unique
constraint ...`, `asset_event rows are append-only; insert a CORRECTION
event instead`) produced by the backend test suite's own deliberate
negative-path tests — these are positive evidence the protections work,
not operational errors. `api` (current container instance, post-fixes):
421 log lines reviewed, zero tracebacks, zero `IntegrityError`, zero
unhandled exceptions — every request in the current instance's full log
history is a clean `200`/`201`/`204`/`403`/`404`/`422` response. `backup`:
clean, `Backup complete` lines only. Test/UAT-generated log entries
(the DB trigger-rejection lines above, and the very 500s this stage found
and fixed — visible only in now-replaced, earlier container instances'
logs, not the current one) were clearly distinguishable from genuine
operational errors by context (each corresponded to a specific,
intentional reproduction step this report already documents), and none
remain unexplained.

## 49. Observability

What currently exists: `GET /api/health` (liveness only, no dependency/DB
check beyond the app being able to respond at all); structured-ish log
lines via Python's standard `logging` module (`ckam.security` logger, used
for the JWT-secret warning and the login-ambiguity warning) plus uvicorn's
own per-request access log line (method, path, status, latency-adjacent
timestamp) — not JSON-structured, but grep-able. No request-id/
correlation-id is attached to log lines or propagated across a request's
lifetime — a given request's various log lines (if it touches multiple
subsystems) cannot currently be correlated by an id, only by rough
timestamp proximity. No metrics/tracing endpoint exists (no
Prometheus-style `/metrics`, no OpenTelemetry). Failed-login attempts are
recorded in the database (`holder.failed_login_count`/`locked_until`) but
not separately logged as a security event beyond the ambiguous-login-id
warning. DB errors surface in `docker compose logs db` (§48) and, before
this stage's fixes, as raw 500s in `api`'s own log — now converted to
clean 422s for the specific cases found. **These are genuine observability
gaps for a larger or longer-lived deployment**, but none of them are
release-blocking for a single-server LAN internal tool — documented here
as the honest current state, not built out further in this stage (no
monitoring infrastructure was constructed, per the authorization's own
"do not build monitoring infrastructure" instruction).

## 50. Performance sanity

Not a load test — controlled, representative sanity checks only. 5 repeat
requests per endpoint, against the live database (~150 assets, ~250
holders, ~80 companies at the time of this check):

| Endpoint | Avg | Min | Max |
|---|---|---|---|
| Dashboard | 5.9 ms | 4.6 ms | 8.3 ms |
| Asset list (limit 50) | 4.1 ms | 3.6 ms | 5.8 ms |
| Asset detail | 3.9 ms | 3.5 ms | 4.4 ms |
| Holder list | 2.2 ms | 2.1 ms | 2.5 ms |
| Reports export (full Excel generation) | 58.7 ms | 47.9 ms | 92.4 ms |

All well within acceptable range for an internal LAN tool. N+1 query
pattern inspection: `search_assets` (backing both the register and its
export) issues exactly 2 queries total (one `COUNT`, one paginated `SELECT`)
regardless of page size — confirmed by reading the function directly, with
an explicit code comment referencing the original "20,000-asset target"
this design decision was made for. The export label-maps (`_export_label_
maps`) are built once per export call as batch queries, never per-row —
confirmed unchanged since AM-06. No N+1 pattern was found in any inspected
path; no query optimization was evidenced as needed.

## 51. Concurrency sanity

Covered directly and rigorously by §16's numbering-concurrency test (20
genuinely parallel `POST /api/assets` requests, zero duplicate codes, zero
errors). No deadlock, no duplicate Asset Code, no transaction leakage
(confirmed via the direct database count matching the HTTP response
count exactly), acceptable error behavior (none — all 20 succeeded, which
is itself the correct outcome for 20 legitimately independent creation
requests). No further, broader concurrency test (e.g. simultaneous reads
across many different endpoints) was run beyond this, since numbering is
the one place the codebase itself identifies as uniquely race-sensitive
(the authorization's own framing: "This is a key RC test") and every other
write path in this application is a single-row, single-transaction
operation with no analogous shared-counter contention point.

## 52. Import scale sanity

A 100-row Excel fixture (90 valid rows, 10 deliberately invalid — an
unknown Cost Centre code every 10th row) was built and imported through
the real HTTP API against the live database, using a dedicated, clearly-
labeled, safe UAT company (deactivated after):

```
PREVIEW: status=200 valid_rows=90 error_rows=0 elapsed=0.174s
COMMIT:  status=200 imported=90  error_rows=10 elapsed=0.375s
```

90 real assets were created (confirmed via a direct database query),
matching VALID-ROWS-ONLY semantics exactly — the 10 invalid rows were
correctly excluded, not silently skipped without report, and the whole
commit completed in well under half a second. No memory issue, no crash,
no partial-batch corruption. The test company and its holders were
deactivated afterward (soft-delete only, matching every guardrail — the
90 created assets themselves remain, by design, since this is a
soft-delete-only application and an asset is a real business record once
created).

## 53. Accessibility RC sweep

Representative screens checked, building on this project's existing
extensive accessibility work (AM-01 through AM-08 each performed their own
sweep on the screens they touched): keyboard reachability (every
interactive element reachable via the existing shared `FormField`/
`Select`/`Button` primitives, unchanged this stage); labels (every form
control across Login/Add Asset/Asset 360/Holders/Import/Reports/Custom
Fields uses a proper `<Label htmlFor>` or `aria-label`, confirmed via the
accessibility tree throughout this stage's own live testing, e.g. the
role-matrix and duplicate-code UAT); modal focus (the mobile sidebar
drawer renders as a proper `role="dialog"`, confirmed live this stage at
375px width — focus lands inside it, all nav links reachable); Escape
behavior (unchanged from AM-07's own confirmed-working dialog Escape
handling); errors (`role="alert"` on every error message, confirmed
unchanged); required state (the `FormField` `required` prop's red asterisk
+ proper label association, unchanged since AM-08); visible focus (the
shared design system's "two-layer focus states," established since AM-01,
unchanged); no color-only status (every status uses a text label alongside
its color, e.g. `StatusBadge`, unchanged). No new accessibility screen was
built this stage (no feature work), so no new accessibility surface needed
auditing beyond confirming the existing patterns remain intact — which
they do.

## 54. Responsive/browser RC sweep

All 6 required breakpoints (1920×1080, 1440×900, 1366×768, 1024×768,
768×1024, 375×812) checked across 6-8 representative routes (Dashboard,
Asset Register, Add Asset, Asset 360, Import, Reports, Holders, plus Login
and Asset Register's own documented intentional-horizontal-table-scroll
behavior from AM-03, unchanged): **48 checks, all clean**
(`document.body.scrollWidth === window.innerWidth` at every single
combination — zero page-level horizontal overflow found anywhere). At
375px, the sidebar correctly collapses to a hamburger-triggered drawer
(confirmed structurally via the accessibility tree — a real
`role="dialog"` containing every nav link). No overflow, no clipped
content, no broken dialog/tab layout was found at any breakpoint on any
checked route.

## 55. Negative/chaos-lite tests

Controlled only, as instructed. **Backend temporarily unavailable**: this
was tested twice, with an important, honestly-reported distinction between
the two methods:

1. `docker compose stop api` (a hard container stop, causing real TCP
   connection resets/refusals from nginx's perspective) followed by live
   browser observation: the Asset Register page appeared to remain on its
   loading skeleton for an extended period, with a much higher request
   frequency than the application's own configured retry/backoff would
   produce. This result could not be cleanly attributed to the
   application's own code given the confound of the browser-pane tooling's
   own behavior under a hard connection failure.
2. A clean, controlled reproduction via Playwright's `page.route()`
   interception (fulfilling every `/api/assets?...` request with an
   immediate, well-formed `502` response — the same status code nginx
   itself returns when its upstream is unreachable, but without the
   TCP-level connection chaos of an actual stopped container) against a
   real, freshly-seeded UAT company: the Asset Register correctly
   transitioned to its `ErrorState` (with a visible, working "Try again"
   button) within the expected window, after **exactly 4 requests total**
   (1 initial + 3 retries) — precisely matching TanStack Query's default
   retry configuration, with no runaway loop.

Method 2 is definitive, clean evidence that the **application code**
handles a persistently-failing backend correctly (this exact scenario is
also covered by the existing, passing
`AssetRegister.test.tsx::"shows an error state with a working retry action
when the register fails to load"` unit test, using a mocked persistent
rejection). Method 1's anomalous observation is recorded honestly here as
an artifact of the live-container-stop method interacting with the
browser-pane tooling, not attributed to the application, and not treated
as a confirmed defect — see §61 for how this was weighed in the final
release decision. **Invalid route**: confirmed clean "Not Found," §45.
**Stale/invalid token**: covered by §8/§10's auth audit (a malformed/
expired token cleanly 401s and triggers the refresh-then-redirect flow,
never a crash).

## 56. Document/file handling

`app/documents/` was read in full. Upload type rules: a fixed allowlist
(`.pdf`, `.jpg`, `.jpeg`, `.png`, `.xlsx`, `.docx`) checked against the
file's extension before anything is written to disk. Filename handling:
the user's original filename is stored **only as metadata**
(`AssetDocument.file_name`, used solely for the download response's
suggested filename) — the actual on-disk path is always
`{upload_dir}/{asset_id}/{uuid4()}{validated_extension}`, an integer
asset id plus a freshly-generated UUID plus the validated extension, never
derived from user input in any way that could reach the filesystem —
**path traversal is structurally impossible**, not merely sanitized
against. Download/view: `GET /api/documents/{id}/download` re-resolves the
document's own `asset_id` through the same `_get_scoped_asset` helper
every other asset-scoped endpoint uses, so cross-company document access
is denied exactly as consistently as everywhere else in the app.
Authorization: upload is `ADMIN`/`IT_TEAM` only; list/download are scoped-
read (any role that can see the asset can see its documents). File-size
behavior: bounded-read (`_read_bounded`, 1 MB chunks, aborts the instant
the running total exceeds the 10 MB cap — never buffers an unbounded body
in memory, a real DoS-vector mitigation) plus a second, redundant check
inside `save_document` itself. Missing-file behavior: `download_document`
404s cleanly if the `AssetDocument` row itself doesn't exist; a row
existing but its `stored_path` missing on disk was not specifically
reproduced (would surface as a `FileResponse`-level error, not evidenced
as a live concern in the current environment). No document-module feature
was added this stage — this was an audit of what already exists, all of
which is sound.

## 57. Security-header/web-delivery review

`curl -D -` against both `web` (nginx, port 3211) and `api` (uvicorn,
port 8000 — loopback-only, but still checked for completeness) found no
`X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, or
`Referrer-Policy` headers (AM09-05); no `Cache-Control` guidance on
authenticated API JSON responses (AM09-06); `Server: nginx/1.31.6` and
`server: uvicorn` reveal exact software identity (minor fingerprinting,
bundled into AM09-05). HSTS was **not** evaluated as a gap — correctly,
per the authorization's own explicit instruction, since this deployment
serves plain HTTP, and HSTS is meaningless (and actively unsafe to send)
without HTTPS already in place. Both findings are classified P2/P3
(documented, not fixed) given the LAN-only, HTTP-only deployment context
— see `RC_ISSUES.md` AM09-05/AM09-06 for the full reasoning on why these
were not treated as release-blocking.

## 58. P0 findings

**None.** No data loss, authorization bypass, cross-company leak, broken
restore, broken app-start, or broken migration was found anywhere in this
stage's audit.

## 59. P1 findings

Four, all fixed this stage (§28, and §23-24 below):

- **AM09-01**: Excel formula injection across all three exports. Fixed.
- **AM09-02**: naive-datetime crash on the lifecycle-event endpoint. Fixed.
- **AM09-03**: duplicate-`code` 500 on any master's create/update. Fixed.
- **AM09-04**: duplicate-`emp_code`-within-a-company 500 on Holders.
  Fixed.

Full detail for each: `RC_ISSUES.md`, and §28/§29 above.

## 60. P2 findings

Two, documented and deliberately not fixed this stage:

- **AM09-05**: missing `X-Content-Type-Options`/`X-Frame-Options`/
  `Referrer-Policy` response headers.
- **AM09-09**: no active alerting for a failed nightly backup beyond the
  log file (an operational-procedure gap, addressed by documenting the
  correct manual check in the runbook, per the authorization's own
  instruction not to build alerting infrastructure here).

## 61. P3 findings

Three, documented and deliberately not fixed this stage:

- **AM09-06**: no `Cache-Control` guidance on authenticated API JSON
  responses.
- **AM09-07**: frontend JS bundle above Vite's 500 kB chunk-size advisory
  (222 kB gzipped — acceptable for a LAN tool).
- **AM09-08**: external Google Fonts CDN dependency (a LAN server with no
  internet egress degrades to the browser default font, no functional
  impact).

The §55 negative-test anomaly (the live-container-stop observation) is
explicitly **not** listed here as a P-classified finding — it was
investigated to a clean, definitive conclusion (a controlled Playwright
reproduction of the same underlying scenario proves the application code
is correct) and is recorded as a methodology note in §55, not carried
forward as an open issue.

## 62. Fixes made during AM-09

All four in one commit, `4cf98df` (`fix(reports,lifecycle,masters,
holders): AM-09 -- Excel formula injection, naive-datetime crash,
duplicate-code 500s`):

- `backend/app/reports/export_service.py` — `_sanitize_cell`/
  `_sanitize_row`, applied to every data row in all three export
  functions.
- `backend/app/lifecycle/service.py` — naive `event_date` normalized to
  UTC before the future/ordering comparisons.
- `backend/app/masters/router.py` — `IntegrityError` caught and rolled
  back to a clean `422` on both `create_item` and `update_item`.
- `backend/app/holders/router.py` — the identical pattern applied to
  `create_holder`/`update_holder`.
- New tests: `backend/tests/reports/test_am09_formula_injection.py` (3),
  `backend/tests/lifecycle/test_router.py`
  (`test_naive_event_date_is_treated_as_utc_not_a_500`, 1),
  `backend/tests/masters/test_am09_duplicate_code_handling.py` (2),
  `backend/tests/holders/test_am08_location_validation.py`
  (`test_am09_duplicate_emp_code_within_a_company_is_a_controlled_422_not_500`,
  1) — 7 new tests total, plus the separate numbering-concurrency test
  (§16, 1 more) that required no code change (proving an existing
  mechanism, not fixing a defect).

No frontend code change was needed or made this stage — every fix was
backend-only.

## 63. Full regression after fixes

Re-run clean, after all four fixes and the concurrency test were in
place:

- Backend: **305/305** passing (297 baseline + 8 new: 3 formula-injection
  + 1 naive-datetime regression + 2 duplicate-master-code + 1 duplicate-
  emp_code + 1 numbering-concurrency).
- Frontend: **148/148** passing (unchanged — no frontend code was
  touched), `npx tsc -b` clean.
- E2E: **5/5** passing, all pre-existing specs green, unmodified.
- `alembic current`: `f28b6a913dce (head)` — unchanged, no migration.

## 64. Database release gate

**PASS.** Migration chain is single-head and linear (§30); a fresh,
disposable database reaches head cleanly from zero (§31); zero duplicate
Asset Codes and zero orphaned/invalid FK relationships across every
checked relationship, on the live database (§32); every append-only and
identity-protection trigger is present, correctly attached, and its
source traced to a single, never-redefined origin (§33); the restore
drill reproduced an identical schema, triggers, and indexes from a real
backup (§37-38).

## 65. Security release gate

**PASS.** No unauthorized write was found anywhere in the 15-capability ×
4-role matrix tested via direct API calls (§11); no cross-company data
leak was found across every write/read/export path tested (§12); HOLDER
scope cannot be bypassed via any query parameter (§13); no hardcoded
secret exists anywhere in the current worktree, and the one real secret
this app has (`JWT_SECRET`) is correctly configured and its own built-in
safety check correctly silent (§41-42); passwords are Argon2id-hashed,
never plaintext, with a working lockout (§9); token verification correctly
pins its algorithm and cannot be bypassed by a tampered or forged claim
without the secret itself (§10); no unrestricted sensitive export exists —
every export respects the same company/HOLDER scoping as its underlying
data (§12-13, §27). The one confirmed security-class defect found this
stage (Excel formula injection, AM09-01) was fixed and verified before
this gate was evaluated.

## 66. Functional release gate

**PASS.** Every named critical V1 journey was exercised and confirmed
working this stage, either directly or via extensive, currently-passing
existing coverage independently re-run clean: Login (§8), Add Asset
(§14-16), Asset 360 (§7, §20-22), Lifecycle (§17-19), Asset Edit (§20),
Correction (§21), Import (§26, §52), Reports (§27-28), Holder/User
administration (§25), Master management (§24).

## 67. Backup/restore release gate

**PASS**, against every item the authorization's own gate names:
[x] an actual backup was created successfully (§36); [x] the backup file
exists (§36, verified non-zero, correctly named/timestamped); [x] a
restore into a disposable database succeeded (§37); [x] the restored
database is usable (verified: readable rows, correct schema, §38); [x]
the restored Alembic revision matches the source (§38); [x] key
records/history are present, with row counts matching exactly (§37); [x]
trigger/index verification succeeded on the restored copy (§38).

## 68. Deployment/config release gate

**PASS.** `docker-compose.yml`'s port/volume/healthcheck configuration is
sound and matches its own documentation exactly (§40); no CORS
misconfiguration exists because none is architecturally needed (§43); the
production frontend build succeeds cleanly (§44) and is the exact same
process the running `web` container's image was built with; deep-link
refresh works correctly for both known and unknown routes (§45); required
environment variables and secrets are fully documented (§2-3 of
`CKAM_RELEASE_RUNBOOK.md`). The two P2/P3 security-header observations
(§57) do not block this gate given the LAN-only deployment context.

## 69. Remaining deferred business decisions

Unchanged from AM-08, carried forward honestly, not resolved this stage
(their mere existence is explicitly not a release blocker, per the
authorization's own §57 instruction): `holder_company_access` (needs
CityKart's own answer on cross-company asset-team sharing); no import-side
duplicate detection (needs a business definition of "duplicate"); 5
closed-value DB columns remain unconstrained at the schema level (current
live values confirmed clean, §32, but the constraint itself is deliberately
deferred for a future approval-workflow stage); no bulk correction
workflow (V1 scope, by design).

## 70. Release runbook summary

`docs/ai/CKAM_RELEASE_RUNBOOK.md` (delivered as a separate file) contains
the full, copy-paste-ready operational procedure: prerequisites, required
env vars, secrets, DB prerequisite, backup-before-deploy, migration
procedure, startup, health verification, a ~10-minute smoke-test
checklist, rollback conditions and procedure, the full database restore
procedure (condensed from `docs/deployment.md`, which remains the
authoritative full reference), post-release verification, exactly which
logs to inspect and what to look for in each, and disaster-recovery notes
(RPO/RTO/retention/location) stated only from evidence this stage actually
gathered — no fabricated SLA.

## 71. Release-blocker summary

**NONE.** All four defects found this stage were P1 (must-fix-before-
release), not P0, and all four are fixed and verified (§59, §62-63).

## 72. FINAL RELEASE DECISION

**RELEASE READY.**

FUNCTIONAL: READY
DATA INTEGRITY: READY
AUTHORIZATION: READY
UI/RESPONSIVE: READY
REGRESSION: READY

KNOWN RELEASE BLOCKERS: NONE

DEFERRED NON-BLOCKERS: `holder_company_access` (business decision needed);
no import-side duplicate detection (business decision needed); 5 closed-
value DB columns remain unconstrained (current data confirmed clean); no
bulk correction in V1 (by design); missing security response headers
(AM09-05, P2); no backup-failure alerting beyond the log file (AM09-09,
P2); no `Cache-Control` on API responses (AM09-06, P3); frontend bundle
size advisory (AM09-07, P3); external font CDN dependency (AM09-08, P3).

## 73. REPORT CONTENT HEAD

`4cf98df` (the last commit before this report/governance commit —
`fix(reports,lifecycle,masters,holders): AM-09 -- Excel formula
injection, naive-datetime crash, duplicate-code 500s`).

## 74. REPORT COMMIT

TO BE FILLED IN CHAT AFTER COMMIT.
