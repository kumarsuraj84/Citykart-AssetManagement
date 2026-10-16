# CKAM security closure — RETEST 2, area SESSIONS + CONCURRENCY

Independent second retest by a Senior Penetration Tester. Tests derived from the findings catalogue and attacker
thinking, **not** from the developers' own tests. No product code was changed. Local throw-away stack only.

- **Target:** `ckam-sec` rebuilt from the FINAL committed code (HEAD `734fd19`, Alembic head `c6e8a0b2d4f6`).
  Web (nginx) `http://localhost:3411`, API `http://127.0.0.1:8200`, Postgres `127.0.0.1:25442` (db/user `ckam`).
- **Tooling:** Node 24 (plain `fetch`, raw `net` sockets for malformed/chunked HTTP, `Promise.all` for bursts),
  read-only `psql` in the db container, `docker stats`, `docker compose logs`. Throw-away employees created via
  the real API as `SECHO` (`employees → issue-passwords`, then the temp password used directly). JWTs for the
  legacy/expired refresh paths were crafted with the throw-away stack's own `JWT_SECRET` (local test stack only).
- **Throw-away users:** `CL2RU1, CL2OTHER, CL2RLOGOUT, CL2RPWD, CL2RRESET, CL2RISSUE, CL2RROLE, CL2RDEACT,
  CL2RLOFF, BRUTE31, BRUTE32, CL2PWPOL, CL2TIM` (ids 48–60), all CKSPL / OPERATOR / IT. SEC* personas' passwords
  were never changed.
- **Evidence:** `tests.csv` (41 cases, prefix `CL2-SE-T`), `concurrency_results.md` (Part B burst table),
  `scripts/`, `raw/` (redacted JSON + SQL/log output).

## Result summary

| Block | Cases | PASS | FAIL |
|---|---|---|---|
| A1 refresh-token reuse / grace / legacy / expired / audit / no-leak | 15 | 15 | 0 |
| A2 revocation on 8 triggers + control | 9 | 9 | 0 |
| A3 rate limits (nginx + direct, XFF, 2 sources) | 5 | 5 | 0 |
| A4 lock-out (sequential + parallel + reset + no-extend) | 4 | 4 | 0 |
| A5 password policy (live API) | 2 | 2 | 0 |
| A6 request-size limits + flat RSS | 7 | 7 | 0 |
| A7 sign-in timing (AU-01 constant-time) | 1 | 1 | 0 |
| B concurrency burst (a–i) + integrity | 13 | 13 | 0 |
| **Total** | **56** | **56** | **0** |

All re-attacks were repelled. No HIGH/MEDIUM finding. Three LOW/INFO observations below.

---

## PART A — sessions / auth

### A1 — refresh-token reuse (AU-06). PASS
Flow on `CL2RU1`: sign in → refresh once (cookie rotated) → wait 16 s (past the 10 s grace) → replay the OLD
cookie. Result: **401 "Your session has ended"**, and every session of that person died — the newer (winner)
cookie, the access token minted at the rotation, and the original access token all returned **401**. A different
user (`CL2OTHER`) was unaffected (refresh 200).
- **Grace** (`REFRESH_REUSE_GRACE_SECONDS=10`): replaying the just-replaced cookie within ~1.5 s returned a new
  **access token only with NO `Set-Cookie`** (duplicate), and the winner's newer cookie stayed valid.
- **Two sign-ins** of one person = two independent live sessions (both refresh 200, distinct cookies).
- **Legacy** cookie (crafted with no `sid`, correct `tv`): first use accepted and rotated; a replay past grace →
  reuse → all sessions ended (401); the legacy session's rotated cookie then dead too.
- **Expired** refresh JWT (past `exp`) → 401.
- **Audit:** `REFRESH_REUSE` (outcome DENIED, `severity HIGH`) and `REFRESH_DUPLICATE` (OK, `severity LOW`) rows
  were written, naming the person and session, never a token.
- **No token material** anywhere: a grep of the raw cookie signature fragment and of any `eyJ…`/`refresh_token=`
  string found **0** matches in `audit_log`, `auth_session` (only 64-hex sha256 hashes), `error_log`, and the
  `/data/logs` JSON-lines files. `auth_session` stores only hashes and marks reuse rows `revoked_reason =
  "refresh token reuse"`.

### A2 — revocation. PASS
For each trigger: a live session (verified alive — `GET /api/auth/capabilities` returns 403 under the forced
first-login flag, i.e. the session is valid) was created, the trigger applied, then the OLD access token AND the
OLD refresh cookie were both confirmed **401**. Triggers covered: **logout, password change, admin Reset Password,
issue-passwords, role change, work-area change (`allowed_asset_domains`), deactivation, login switched off.** A
control user's session stayed alive (403) before and after every trigger. (Password change also returned a fresh
cookie; the old one was dead.)

### A3 — rate limits (AU-03/AU-04, N3). PASS
- **Per-login-id** via nginx `:3411`: `401×10` then **429 at the 11th**, `Retry-After: 60`, plain body
  "Too many sign-in attempts. Wait a minute and try again."
- **Per-IP** via nginx: with a **distinct forged `X-Forwarded-For` on every request**, the limit still tripped at
  the **21st** — proving nginx overwrites XFF and the API keyed one bucket on the real client (if the spoof were
  believed, each distinct XFF would be its own bucket and never trip).
- **Per-IP direct `:8200`**: same — 429 at the 21st despite forged XFF (the direct peer is not a trusted proxy,
  so XFF is ignored entirely).
- **Audit:** `RATE_LIMITED` rows logged the **real** addresses — `172.25.0.1` (direct docker gateway) and
  `172.31.212.1` (the client address nginx forwarded) — and **0** rows contained any forged `203.0.113.*` /
  `198.51.100.*` value.
- **Two sources don't share a bucket:** with the host's direct `:8200` bucket saturated (429), a second source — an
  `alpine` container on `ckam-sec_default` (source `172.25.0.x`) — signed in and got a normal **401**, i.e. its own
  bucket. (`curlimages/curl` is not present locally and was not pulled; `alpine` + busybox `wget`, already local,
  was used instead.)

### A4 — lock-out (AU-16). PASS
- `BRUTE31`: 5 wrong passwords → `401×5` (DB `failed_login_count=5`, `locked_until` set ~15 min out); the **6th
  attempt with the CORRECT password → 423** "Account locked".
- **A stranger cannot extend the lock:** 3 further wrong attempts while locked → `423×3`, and `locked_until` and
  the count were **byte-identical** before and after (epoch `1792132566.763184`, count 5).
- **Admin Reset Password clears it:** after `POST /{id}/reset-password` the user signed in **200** with the new
  temp.
- **20 parallel wrong guesses** on `BRUTE32`: the login rate limiter let exactly 10 reach the handler
  (`401×10, 429×10`); the atomic `UPDATE … WHERE not_locked` counted **exactly 5** and locked the account — no
  parallel request slipped past the threshold.

### A5 — password policy (AU-08). PASS
Through the live `POST /api/auth/change-password` on `CL2PWPOL`: all 13 weak choices were refused **422** with a
plain sentence — `Password@2026, Welcome@2026, Admin@2026, Qwerty@123` ("a common word with a few numbers/symbols
added…"), `Citykart2026, CKAM2026` ("company or app name and numbers…"), `password1, 12345678, 87654321` ("too
common…"), `aaaaaaaa, abcdefgh` ("the same character or a simple sequence…"), `CL2PWPOL-river`, `the-throwaway-key`
("must not contain your name, login code or email…"). A long passphrase (`copper lantern harbor meadow`) was
accepted **204**.

### A6 — request-size limits (N1) + flat RSS. PASS
- login body >64 KB → **413**; ~60 KB → not 413 (reaches login, 422).
- JSON declared >5 MB (no token) → **413** before read/auth; multipart declared >16 MB → **413**.
- chunked login body >64 KB (no Content-Length) → counted and stopped → **413**.
- malformed (non-numeric) Content-Length → **safely refused (400)**: uvicorn's h11 parser rejects the malformed
  framing before ASGI, so the body is never read (the `BodyLimit` ValueError→413 branch is belt-and-braces behind
  it). Controlled, no 500 — see finding CL2-SE-N02.
- **RSS stayed flat:** API container memory was **155.6 MiB before → 155.7 MiB after** firing the 6 MB / 17 MB /
  96 KB oversized bodies, confirming oversized bodies are refused on the declared length before being buffered.

### A7 — sign-in timing (AU-01 constant-time). PASS
35 samples each for right password / wrong password / unknown user / disabled (`SECDIS`) / locked (`SECLOCK`),
paced to stay under the rate limits. All five categories pay one Argon2 verification (real hash, or
`burn_password_check` against a dummy hash), so the response time does not reveal which login ids exist or their
state. 35 clean samples each, 0 rate-limited:

| Category | median ms | p25 | p75 |
|---|---|---|---|
| right password (`CL2TIM`) | 44.9 | 43.2 | 49.6 |
| wrong password (`CL2OTHER`) | 41.1 | 38.6 | 43.6 |
| unknown user | 41.7 | 38.3 | 44.0 |
| disabled (`SECDIS`) | 41.1 | 39.7 | 43.0 |
| locked (`SECLOCK`, 423) | 41.7 | 39.8 | 45.3 |

Spread of medians across all five: **3.8 ms**. Across the four *refused* categories (what an attacker uses to tell
"exists / disabled / locked / unknown" apart) it is **0.6 ms**, which is below the noise. The ~3–4 ms extra on a
correct password comes from opening the session record and writing the LOGIN audit row. It only shows that the
password was right, which the 200 response already says. Raw: `raw/a7_timing.json`.

---

## PART B — external concurrency burst

Full detail and the per-scenario burst table are in **`concurrency_results.md`**. Headline: every scenario held.
- (a) same PO# ×20 → **1** live PO; (b) receive a 6-unit line ×20 → **exactly 6**, no over-receipt; (b2) one
  Idempotency-Key ×20 → **1** unit; (c) same serial ×20 → **1** asset; (d) batch one key ×20 → **1** batch;
  (d2) 10 batches no key → **10**, no dup codes; (e) sold twice ×20 → **1** terminal event, moved ×20 → **one**
  holder, ledger consistent; (f) dup names: vendor/brand/item **1** active each, category **3** (name not unique —
  see CL2-SE-N01); (g) auth storm → `token_version` consistent (2→7), earlier session dead; (h) parallel refresh
  ×20 → **exactly one** rotation, never two valid cookies; (i) create+deactivate+receive → controlled only.
- **Integrity (read-only SQL):** 0 duplicate asset codes, 0 duplicate live serials, 0 duplicate live PO numbers,
  0 negative remaining, 0 orphan units, status == last event everywhere. `error_log` held only **13 controlled
  409 `IntegrityError` WARNINGs** (the serial-race losers); **no 500, no deadlock, no serialization failure, no
  raw SQL text** in the app/db logs.

---

## New findings (all LOW / INFO — none block closure)

**CL2-SE-N01 (LOW, data consistency).** The **Category** master has no name-uniqueness guard (unlike Vendor/Brand,
which take a transaction advisory lock on the active name, and Item, which has an application-level name check).
20 parallel `POST /api/masters/categories` with the same name created **3** active rows with identical names
(distinct auto-generated codes); the full unique index on `code` stopped the rest. No corruption (codes are
unique), but duplicate category *names* are allowed, and the code auto-generation is not serialised the way the
vendor/brand name check is. Recommend: apply the same advisory-lock active-name check (or a partial unique index on
`lower(name) where is_active`) to Category, for consistency with the other masters.

**CL2-SE-N02 (INFO, defense-in-depth / dead branch).** A malformed (non-numeric) `Content-Length` is rejected by
uvicorn's h11 HTTP parser with a 400 *before* the ASGI `BodyLimitMiddleware` runs, so the middleware's
`except ValueError: _refuse(413)` branch is never reached for that input. The request is still safely refused and
the body never read; the only effect is that the status is 400 (parser) rather than 413 (app), and that branch is
effectively unreachable. No action required; noted so a future reader does not assume the 413 path covers it.

**CL2-SE-N03 (LOW, friendly-message consistency).** The same logical condition "this serial already exists" is
answered two different ways depending on timing: the application pre-check returns a friendly **422** with a plain
sentence, but a concurrent loser that reaches the DB unique index returns a bare **409 "This record already
exists."** (logged WARNING). Both are controlled and non-leaking, but the 409 path does not get the friendly
serial-specific message. Recommend mapping the serial `IntegrityError` to the same 422 + plain wording.

## Clean-up (`scripts/cleanup.mjs`)
All 13 throw-away employees (ids 48–60), the CL2 vendor/brand/item and the 3 CL2 categories were soft-deactivated
(204). Four CL2 POs were deactivated (200). Two POs that already have delivered units, `CL2-PO-RCV-2` and
`CL2-PO-RCV-IDEM2`, were refused with a controlled **409**, which is the expected guard. `CL2-PO-MIX-2` was already
cancelled by scenario (i). The assets created by the bursts were left on the throw-away stack. SEC* personas were
not touched.

## What could not be exercised (and why)

- **`curlimages/curl` second container:** not present locally; per the brief it was **not** pulled. The two-source
  rate-limit test was done with the already-local `alpine` image and busybox `wget` instead (equivalent evidence).
- **True 20-way parallel lock-out:** the login rate limiter (10/min per login id) correctly let only 10 of the 20
  concurrent wrong guesses reach the handler, so the atomic counter was raced by 10, not 20. The "exactly 5
  counted" property was still proven; a full 20 simultaneously could not reach the counter because the rate limit
  (by design) refused half first.
- **Rate limiting could not be switched off** (no stack restart/rebuild permitted), so parallel-login scenarios
  (A3, the auth storm in B-g) and the timing samples were paced / drained around the 20-per-IP and 10-per-login-id
  windows rather than run unthrottled.
