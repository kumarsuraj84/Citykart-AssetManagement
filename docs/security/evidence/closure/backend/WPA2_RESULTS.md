# Closure WP-A2 — backend authentication: results

Date 2026-10-16. Starting point: `79dbae7` (backend code as at `7b039fb`), Alembic head `a3c5e7f9b1d4`.
All work is local (dev PC 10.0.0.47, dev api container, test database `ckam_test`, a temporary `ckam_migcheck`
database that was dropped afterwards). Nothing was deployed; production is unchanged. Not committed (the lead
commits).

| Item | Status | Change | Tests | Result |
|---|---|---|---|---|
| **OBS-TV** atomic `token_version` | **FIXED — local, tested** | `backend/app/core/security.py::end_all_sessions` is now `async (session, user, *, reason, only_if_version=None)`: one `UPDATE asset_user SET token_version = token_version + 1 WHERE id = :id RETURNING token_version` (ORM `update(...)`, `synchronize_session=False`, inside `no_autoflush` so callers' other pending writes flush exactly when they did before); the returned value becomes the object's *committed* value (`set_committed_value`, so a later flush can never write a stale number back); the person's open `auth_session` rows are marked revoked in the same transaction. Every bump site moved to it: `auth/router.py` (logout, change-password, refresh reuse), `asset_users/service.py` (deactivate, reset password, issue passwords, primary-owner removal, company-access change), `asset_users/router.py::update_asset_user` (sign-in off, role, work area, home company) | New `tests/auth/test_wpa2_token_version_atomic.py` (3): 20 concurrent bumps end at start+20 with 20 distinct returned values; a bump leaves no pending stale write; sign-out + admin reset + company-access change + role change + own password change at the same moment → every earlier access/refresh token 401, version ≥ start+3, a sign-in afterwards works | PASS. Probe (`wpa2_probe_output.txt`): the old read/add/write pattern lost 18–19 of 20 concurrent bumps; the new statement lost 0 |
| **AU-06** refresh-token reuse detection | **FIXED — local, tested** (was MITIGATED) | New table `auth_session` (migration `b5d7f9a1c3e5`), model `backend/app/auth/models.py`, logic `backend/app/auth/sessions.py`, wiring in `backend/app/auth/router.py` (login, refresh, logout, change-password). Details below | New `tests/auth/test_wpa2_refresh_reuse.py` (24 incl. parametrised cases) | PASS. Race probe: 9 parallel renewals were seen WAITING on the row lock and came out as 9 DUPLICATE + 1 ROTATED (grace 10) / 1 ROTATED + 1 REUSE + 8 ENDED (grace 0) |
| **AU-04** lock-out | **DECISION REQUIRED (unchanged)** | No code change. Options write-up `AU-04_OPTIONS.md` (where A/B/C change the code, settings, tests, audit events; effect on the known-user DoS and brute force; effort/risk; recommendation C, as SD-06) | — | Document delivered |
| Session regression check | **PASS** | — | `tests/auth/test_vapt_sessions.py` (1 test changed, see below), `test_vapt_login.py`, `test_rate_limit.py`, `test_refresh.py` unchanged and passing | `wpa2_targeted_tests.txt`: 68 passed |

## AU-06 design as built

- **One row per sign-in** (`auth_session`: id, asset_user_id → asset_user, created_at, last_used_at, expires_at,
  revoked_at, revoked_reason, current_jti_hash, previous_jti_hash, previous_valid_until, legacy_token_hash
  [unique]; indexes on asset_user_id and expires_at). A phone and a PC are two rows; rotating one never touches
  the other.
- **Only SHA-256 hashes** of token ids are stored. The refresh token carries `sid` (row id) and `jti`. No token,
  jti or hash goes into audit rows, logs, errors or the diagnostics bundle (tested).
- **Sign-in** (`login`) inserts the row and issues the cookie for it. **Change-password** ends all sessions
  (version + revoke) and opens a fresh row for the device that changed it (the 204 answer still carries the new
  cookie, as before).
- **Refresh** (`sessions.renew`): one atomic
  `UPDATE auth_session SET previous_jti_hash = current_jti_hash, previous_valid_until = now + grace,
  current_jti_hash = :new, last_used_at = now, expires_at = now + 8 h WHERE id = :sid AND asset_user_id = :uid
  AND current_jti_hash = :presented AND revoked_at IS NULL AND expires_at > now RETURNING id`.
  Exactly one of any number of parallel renewals with the same token matches; the others wait for its row lock and
  then find the hash replaced. A token that did not rotate is judged:
  - account version changed meanwhile (sign-out, password, access change) → plain 401, no alarm (ENDED);
  - row missing / another person's / revoked → **REUSE**;
  - row expired → plain 401 "the session has expired" (EXPIRED, nothing else ended);
  - presented hash = `previous_jti_hash` and `previous_valid_until > now` and grace > 0 → **DUPLICATE**: 200 with a
    new 15-minute access token, **no Set-Cookie**, SECURITY `REFRESH_DUPLICATE` (changes `{session, severity:
    LOW}`, throttled once per session per minute);
  - anything else → **REUSE**: 401 "Your session has ended. Please sign in again.", `token_version` bumped
    atomically *only if still the token's version* (no double count when two reuses race), every open row of the
    person revoked ("refresh token reuse"), SECURITY `REFRESH_REUSE` (outcome DENIED, actor, `{session, legacy,
    severity: HIGH}`).
- **Grace window:** new setting `REFRESH_REUSE_GRACE_SECONDS` (default 10, clamped 0–300; 0 = strict: the late
  twin is treated as reuse).
- **Lock order** (found by a probe, fixed before shipping): PostgreSQL keeps a lock on the session row a waiting
  UPDATE re-checked until that transaction ends. Every session-ending path locks `asset_user` first and session
  rows second, so `renew` commits (releases the row) before it ends anything. The first draft deadlocked against a
  parallel sign-out (`wpa2_probe_output.txt`); the shipped code does not, and a permanent test covers the mix.
- **Legacy tokens** (no `sid`, issued before this release — production today has no `jti` either): the first
  renewal inserts a row keyed by the hash of the old token (`INSERT … ON CONFLICT (legacy_token_hash) DO NOTHING`)
  and issues a normal `sid` cookie — nobody is signed out by the deploy. A parallel first use (several tabs at the
  deploy moment) is a duplicate; the same old token later is reuse.
- **Logout** keeps today's semantics (a current cookie ends every session of the person) and marks all their rows
  revoked ("signed out"). Admin changes (reset, issue passwords, deactivate, sign-in off, role, work area, home
  company, company access, head-office rights removed) revoke the rows in the same transaction as the version bump.
- **Expiry and clean-up:** `expires_at` slides with every renewal (the cookie's own 8-hour idle window). The daily
  retention job (`observability/retention.py::purge_old_logs`) now also deletes rows 30 days past expiry
  (`auth_session` count in its result / system_event). `auth_session` is a TECHNICAL table for the audit layer
  (`observability/audit.py`), so a renewal does not create a generic DATA "WRITE" row.
- **Unchanged for the frontend:** access token lifetime (15 min), cookie name/flags/path/max-age, every response
  shape (`POST /api/auth/refresh` returns the same JSON; only the duplicate case omits Set-Cookie).

## Migration

`backend/app/alembic/versions/b5d7f9a1c3e5_auth_session_refresh_reuse.py`, revises `a3c5e7f9b1d4`; additive
(new table only); downgrade drops the table.

| Check | Result |
|---|---|
| `alembic heads` | `b5d7f9a1c3e5 (head)` — one head |
| Existing test DB `ckam_test`: upgrade → downgrade to `a3c5e7f9b1d4` (table absent) → upgrade | PASS; `\d auth_session` shows the columns, PK, both indexes, the unique constraint and the FK |
| Empty database `ckam_migcheck` (created on the dev db server): `alembic upgrade head` from nothing → `downgrade -1` → `upgrade head` → `alembic current` = `b5d7f9a1c3e5 (head)`; database dropped | PASS |
| `alembic check` (autogenerate drift) | Not usable: fails before comparing on a pre-existing `env.py` gap (`app.items.models` not imported → `NoReferencedTableError` for `asset.item_id`). Unrelated to WP-A2; `app.auth.models` was added to `env.py` |

**Operational note:** the dev `ckam` database and production need `alembic upgrade head` before the new code
starts (login inserts into `auth_session`). The dev api container was only given the new files for the test run
(uvicorn runs without reload, so the running dev app is unchanged until the lead rebuilds it).

## Existing tests changed (and why)

| File | Change | Reason |
|---|---|---|
| `tests/auth/test_vapt_sessions.py::test_every_refresh_hands_out_a_new_unique_token` | The second renewal now uses the cookie the first one returned (it used the original cookie twice); adds "one sign-in = one sid" | Intended AU-06 behaviour: the same cookie twice is now a duplicate (no new cookie) or reuse — exactly the RT-AU-T103 finding |
| `tests/core/test_s3a1_master_audit_migration.py` | Head `a3c5e7f9b1d4` → `b5d7f9a1c3e5` (+ its down-revision) | New migration |
| `tests/observability/test_admin_api.py` (2 asserts), `tests/observability/test_system_events.py` (2 asserts) | Expected code/db head `b5d7f9a1c3e5` | New migration |

`test_vapt_login.py`, `test_rate_limit.py`, `test_refresh.py`, `test_must_change_password.py`,
`test_security_events.py`, `test_coverage_walker.py` needed no change.

## Full backend suite

One run, dev api container, `ckam_test` at `b5d7f9a1c3e5`, `python -m pytest -q -rs`:

    2464 passed, 2 skipped in 473.08s (0:07:53)

(Baseline at `7b039fb`: 2437 passed, 1 skipped; +27 = the new WP-A2 tests.) Both skips are in
`tests/core/test_n2_forwarded_for.py` and depend on the environment, not on WP-A2: "backend/Dockerfile is not
inside this image" and "not run from a repository checkout" (the container image predates the WP-C Dockerfile
commit `79dbae7`, which this run did not rebuild). Not verified which of the two was the single baseline skip.

## What users notice

Nothing in normal use. Several tabs renewing at the same moment keep working (grace window). The only visible
differences are stricter security: if a refresh token that was already used comes back (a copied cookie), that
person is signed out everywhere and sees "Your session has ended. Please sign in again."

## Residual risks of the reuse design

1. **Grace window (10 s):** a thief who presents the *just-replaced* token within 10 s of the real renewal gets one
   15-minute access token (no cookie, so no lasting session). Set `REFRESH_REUSE_GRACE_SECONDS=0` for strict mode
   at the cost of signing out users whose tabs renew at the same instant.
2. **Thief wins the race:** if the thief renews first, they hold the live cookie until the real user's browser
   renews; then the real user's (now old) token is reuse → everyone signed out, `REFRESH_REUSE` row. Detection is
   after the fact, not prevention (HTTPS, SD-05, and `Secure` cookies reduce theft in the first place).
3. **Lost response:** if a renewal's answer never reaches the browser (network drop after the server committed),
   the browser keeps the old cookie; its next renewal after the window is treated as reuse → that person is signed
   out (a false alarm, one sign-in to recover; visible as `REFRESH_REUSE`).
4. **Access tokens stay stateless** (15 min, ended only by `token_version`): reuse detection ends them through the
   version bump, as before.
5. **Shared store logins (SD-07):** reuse on one device signs out every device of that login, like sign-out does
   today (N7).
6. **No absolute session lifetime** (unchanged; SD-14): a session renewed at least every 8 hours lives on.
7. **Key compromise:** anyone with the JWT signing key can still mint tokens — a forged token with a `sid` fails the
   hash check (and signs that person out as "reuse"), but a forged *legacy-style* token (no `sid`) is accepted
   once and becomes a session. The legacy path is only needed for tokens from before the deploy, which all expire
   within 8 hours (`JWT_REFRESH_HOURS`); it can be removed in the next release. EXT-02 (new secret right after the
   deploy, which also signs everyone out) remains the real control.
