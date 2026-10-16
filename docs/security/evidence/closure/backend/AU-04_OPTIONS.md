# AU-04 — lock-out after wrong passwords: where each option would change the code

Closure WP-A2, 2026-10-16. **Write-up only — no lock-out code was changed.** The decision itself is SD-06 in
`docs/security/CKAM_SECURITY_DECISIONS_REQUIRED.md` (plain-language options for the owner); this note is the
engineering side of the same three options, so whichever letter is chosen can be built and tested without a new
investigation. Code references are to the tree after WP-A2.

## 1. What the code does today (Option A)

| Piece | Where | Behaviour |
|---|---|---|
| Threshold and lock length | `backend/app/auth/router.py`: `MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_MINUTES = 15` (module constants, not settings) | 5 wrong passwords → `asset_user.locked_until = now + 15 min` |
| Counting | `router.py::login`, the `if not password_ok:` block — one atomic `UPDATE asset_user SET failed_login_count = failed_login_count + 1, locked_until = CASE … END WHERE id = :id AND not_locked RETURNING failed_login_count` (AU-16) | Parallel guesses cannot each get a try; the count stops at the threshold |
| While locked | `router.py::login`, `refuse_locked()` → **423** "Account locked, try again later" for ANY password, right or wrong (lead decision AU-02: otherwise the lock is a password oracle); a wrong password racing the lock → `refuse_wrong_while_locked()` → 401, not counted | The lock neither grows nor is extended by more guesses |
| Success | `router.py::login`, the reset `UPDATE … SET failed_login_count = 0, locked_until = NULL WHERE … not_locked` | A right password after the lock ran out signs in and clears the count |
| Open sessions of a locked person | `router.py::refresh`: `if asset_user.locked_until and asset_user.locked_until > now: refused("the account is locked")` | A person already signed in is pushed out at their next renewal (≤ 15 min) while someone else is locking them |
| Unlock by an admin | `backend/app/asset_users/service.py::reset_password` / `issue_passwords` set `failed_login_count = 0, locked_until = None` | Reset Password clears a lock at once |
| Rate limits (AU-03) | `backend/app/core/rate_limit.py::limit_login` — `RATE_LIMIT_LOGIN_PER_IP` 20/min per address, `RATE_LIMIT_LOGIN_PER_LOGIN_ID` 10/min per login id; 429 before any lookup | In-process sliding windows (one uvicorn process); reset on restart |
| Audit | `obs_writer.security` rows `LOGIN_FAILED` (reason wrong password / locked / wrong password while locked, attempt n), `LOCKED` (attempts, minutes), `RATE_LIMITED`, `LOGIN` | Never the password |
| Tests | `tests/auth/test_login.py::test_login_wrong_password_locks_after_five_attempts`, `::test_login_failed_attempts_reset_after_success`; `tests/auth/test_vapt_login.py::test_a_locked_account_says_locked_for_any_password_so_the_lock_is_no_guessing_oracle`, `::test_a_locked_account_and_the_right_password_still_says_locked`, `::test_once_the_lock_has_run_out_the_right_password_signs_in`, `::test_twenty_parallel_wrong_guesses_stop_at_the_threshold`, `::test_the_lock_threshold_is_the_same_one_by_one`; `tests/auth/test_rate_limit.py` (6); `frontend/src/routes/login.test.tsx` (423 message) | |

**Known-user DoS today (RT-AU-T313/T314):** anyone who knows or guesses a login id (store logins follow the public
pattern `sm.<code>@citykartstores.com`) locks that person for 15 minutes with 5 requests, and again every 15
minutes. One address can keep about 60 accounts locked (20 requests/min ÷ 5 = 4 accounts/min × 15 min;
calculated, not executed). Because `/refresh` refuses a locked account, the victim is also thrown out of an open
session. **Brute force today:** at most 5 guesses per account per 15 minutes = 20/hour (and the per-id limit of
10/min is never the binding one); against the AU-08 password policy that is negligible.

## 2. Option B — growing delay, never a lock

**What changes**

| Area | Change |
|---|---|
| `router.py::login` | Replace the lock with a "next try allowed at" time. Reuse `asset_user.locked_until` as `retry_after` (no migration) or rename it in a migration for clarity. Wrong password: same atomic `UPDATE … RETURNING`, but `locked_until = now + delay(failed_login_count + 1)` with `delay(n) = min(2^(n-1), 30)` seconds from the 1st or 3rd failure (choose: first 2 free). Before the password check: if `now < locked_until` → **429** (or 423) "Please wait N seconds and try again." with `Retry-After`, **for the right and the wrong password alike** (AU-02 rule: the wait must not reveal whether a guess was right), and the try does not count. Success clears count and wait as today |
| `router.py::refresh` | Remove the `locked_until > now` refusal (a delay is not a reason to end an existing session) — otherwise a stranger could still sign people out every 30 s |
| Settings (`backend/app/core/config.py`) | `LOGIN_DELAY_START_AFTER` (e.g. 2), `LOGIN_DELAY_MAX_SECONDS` (30); move `MAX_FAILED_ATTEMPTS` / `LOCKOUT_MINUTES` out |
| Count decay | Reset `failed_login_count` after e.g. 60 min without a failure (compare a `last_failed_at`; needs one small column, or use `locked_until` age as the clock) — otherwise one bad morning keeps a person at 30 s for ever |
| Audit | `LOGIN_FAILED` gains `wait_seconds`; `LOCKED` disappears (or becomes `LOGIN_DELAYED`, throttled once per account per 10 min); the diagnostics bundle / admin log filters that list `LOCKED` need the new name |
| Frontend (another work package) | `frontend/src/routes/login.tsx`: show the server sentence for 429/423 with the seconds; the existing 429 path from AU-03 already shows a plain sentence, so this may be a text-only change |
| Tests to change | The 5 lock tests above become delay tests: the wait applies to right and wrong passwords; it does not count; it grows and caps at 30 s; it decays; 20 parallel wrong guesses produce one count each but never a lock; `refresh` keeps working for a person under attack; Reset Password clears the wait. `login.test.tsx` 423 test → wait message |

**Effect on the known-user DoS:** removed. The real user waits at most 30 s (and can always sign in from a
session that is already open). **Effect on brute force:** weaker than A but still sufficient: ~120 guesses an
hour per account at the 30 s cap (A: 20/hour); the per-id limit (10/min) and per-address limit (20/min) still
apply. With the AU-08 policy (≥ 10 characters, not common, not a name look-alike) online guessing stays
impractical; a password-spray across many accounts is bounded by the per-address limit as today.
**Effort / risk:** small (≈ 1 day incl. tests); risk low-medium — the AU-02 oracle rule must be kept (wait checked
before the password), and the message the user sees changes.

## 3. Option C — hybrid (recommended)

B's growing delay per login **plus** the existing per-address and per-login-id limits, and a **short lock only
after sustained abuse** (SD-06 suggests 5 minutes after 20 wrong passwords within 60 minutes).

| Area | Change (on top of B) |
|---|---|
| `router.py::login` | Keep a rolling count of failures in the last 60 min (a `failed_window_started_at` column, or a per-login-id deque in `rate_limit.py` — in-process, lost on restart, acceptable for one process). When it reaches 20 → `locked_until = now + 5 min` and a `LOCKED` row (reason "sustained abuse"). Otherwise B's delay. Same AU-02 rule while locked |
| Optional per-address lock | `rate_limit.py`: an address with N failures across ≥ M different login ids in 10 min gets 429 for 15 min (protects against spraying; the person's own address is unaffected) — this is the "lock the attacking address, not the account" idea from the decisions paper |
| `router.py::refresh` | As B: do not end open sessions because of a delay; for the short lock, decide (recommended: also do not end them — the lock is about new sign-ins) |
| Settings | B's two settings + `LOGIN_ABUSE_FAILURES` (20), `LOGIN_ABUSE_WINDOW_MINUTES` (60), `LOGIN_ABUSE_LOCK_MINUTES` (5) |
| Audit | `LOGIN_FAILED` (+ wait), `LOGIN_DELAYED` (throttled), `LOCKED` (reason "sustained abuse", failures, window), `RATE_LIMITED` (+ "spray" when the per-address rule fires) |
| Tests | B's tests + "19 failures in an hour never lock", "20 lock for 5 min", "the 5-minute lock answers the same for right and wrong passwords", "a stranger cannot keep a person locked for more than 5 min per hour of continuous attack", per-address spray rule, restart behaviour documented |

**Effect on the known-user DoS:** a stranger needs an hour of continuous attempts (paced to the delay) to cause a
5-minute lock; the victim's open sessions stay up. With the per-address rule the attacker's own address is cut
off long before. **Effect on brute force:** close to A — the delay caps guesses at ~120/hour, the abuse lock
cuts that to ~20 per 65 min under sustained attack, plus the existing limits. **Effort / risk:** medium (≈ 2 days
incl. tests); risk medium — more moving parts, in-memory counters reset on restart (acceptable for a
single-process app; note it in the runbook).

## 4. Option A — keep the hard lock (no change)

No code change. If chosen, record the acceptance in `docs/ai/DECISIONS.md` (who, date, "anyone who knows a login id
can lock that person out for 15 minutes; Reset Password clears it"). Cheap mitigations that do not change the
semantics and could still be done: close or allow-list the internet forward (SD-04 / EXT-05), MFA for admins
(SD-03), and stop `/refresh` from ending an open session merely because the account is locked (removes the
"thrown out while working" part of the DoS; a one-line change plus a test, but it IS a behaviour change, so it
also needs the owner's yes).

## 5. Side-by-side

| | A (today) | B | C |
|---|---|---|---|
| Stranger can lock a named person | Yes, 15 min, repeatable | No (≤ 30 s wait) | Only after ~1 h of continuous attack, 5 min |
| Victim's open session | Ended at next renewal | Kept | Kept |
| Online guesses per account | ~20/hour | ~120/hour | ~120/hour, ~20/65 min under sustained attack |
| Guessing oracle (AU-02) | Closed | Must be kept closed (wait before password check) | Same |
| Schema change | — | None (reuse `locked_until`) or one column | One or two small columns, or in-memory counters |
| Effort | 0 | ≈ 1 day | ≈ 2 days |
| Risk of the change | — | Low-medium | Medium |

## 6. Recommendation

**C**, as in SD-06 — it removes the practical lock-out abuse (the part that hurts store operations) while
keeping guessing as hard as today under sustained attack. **B** if the owner wants the smallest change; it is
already a clear improvement over A for this user base. In either case also stop `/refresh` from ending open
sessions because of a delay or lock. Build only after the owner's answer to SD-06; then retest RT-AU-T313/T314.
