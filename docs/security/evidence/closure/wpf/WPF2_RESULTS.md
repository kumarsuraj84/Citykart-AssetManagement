# WP-F2 — closure of CL2-SE-N01 and CL2-SE-N03 (sessions / concurrency retest 2, both LOW)

Base: HEAD after `ca94574` (Alembic head `c6e8a0b2d4f6`). **No migration** (application-level guard, same as
vendors / brands; the existing DB unique indexes are unchanged). Local only: the dev `api` container's test
database `ckam_test`; nothing on any server.

| Item | Status | Where |
|---|---|---|
| CL2-SE-N01 — Category has no name-uniqueness guard (20 parallel adds → 3 active categories) | **FIXED** (local, tested) | `backend/app/masters/router.py` |
| CL2-SE-N03 — same-serial race losers get a bare 409 "This record already exists." | **FIXED** (local, tested) | `backend/app/core/errors.py` |

## CL2-SE-N01 — one active Category name per work area, one Sub-category name per Category

**Scope decision.** Nothing in the code treats category names as globally unique (no name lookup of a category
anywhere; the Excel import resolves a category by **code**), and categories are owned per work area (IT / Non-IT,
S3a-1). So the rule is: no second **active** category with the same name (trimmed, any letter case) **in the same
work area**; the same name may exist once in IT and once in Non-IT. Sub-categories: no second active sub-category
of one name **inside its category** (the same race existed there: no name check at all; an existing test already
relies on "Wires" under two different categories). A deactivated twin does not block (vendor / brand policy).
Existing rows are never touched, never checked against each other, and an existing (legacy) twin never blocks an
unrelated save.

**Change.**
- `_active_name_exists` / `_refuse_duplicate_name` gain an optional `scope` (column values the rule and the lock
  are narrowed to) and `exclude_id` (the record being renamed). With no scope the advisory-lock key is byte-for-byte
  the old one (`vendor:<name>`), so vendor / brand behaviour is unchanged.
- Category create: after the work-area authorization (`ensure_domain_manage`), the advisory lock on
  `asset_category:<IT|NON_IT>:<name>` + active-name check → 422 **"A category with this name already exists."**
  The lock is held to commit, which also serialises the code made from the name (the cause of the 3 rows).
- Category edit: when the name or the work area really changes, the same check in the target work area
  (excluding itself), after the work-area-change authorization and before the "confirm the move" refusal.
- Sub-category create / rename: same, scoped to the category → 422 **"A sub-category with this name already
  exists."**
- Excel import (`/api/masters/categories|subcategories/import/preview|commit`): `MasterPolicy.unique_name_scope`
  makes the existing per-row import name check (WP-A1 OBS-NAME-IMPORT) scope-aware; categories and sub-categories
  now opt in. A duplicate row (against an active record, or an earlier row of the same file in the same scope) is
  refused with a plain sentence; the other rows still go in.
- Authorization order kept: a caller who may not manage a work area gets the 403 first and learns nothing about
  that area's names.

**Tests** — `backend/tests/masters/test_wpf2_category_names.py` (11):
sequential duplicate refused + case / space variants + typed code does not bypass + an existing world category;
other work area allowed + deactivated twin allowed; 403 before the name check for a one-area admin;
**20 parallel creates → 201×1, 422×19, exactly one active row**; rename onto an active name refused, move to the
other work area onto an active name refused (even confirmed), own name in another case allowed; legacy twins left
alone and still saveable; sub-category duplicate / variants refused, other category and deactivated twin allowed;
**20 parallel sub-category creates → exactly one**; sub-category rename refused / own-case allowed / other
category allowed; category import (preview + commit: in-file duplicate, existing name, other work area, deactivated
twin) and the screen refusing a name the import created; sub-category import.

## CL2-SE-N03 — the serial index answers like the serial pre-check

**Root cause.** `app/core/errors.py::integrity_message` maps a unique violation to "A record with this <column>
already exists." by parsing `Key (<cols>)=` from the PostgreSQL detail. The serial index
`ux_asset_serial_number_ci` is an **expression** index (`lower(trim(serial_number))`), so the detail is
`Key (lower(TRIM(BOTH FROM serial_number)))=(...)`, the regex does not match, and the fallback is the bare
409 "This record already exists.". The application pre-checks (receive, batch add, single add, bulk serials) answer
422 "Serial number X is already used by asset Y."; a request that passed its pre-check just before the winner
committed reached the index instead.

**Change.** A small `CONSTRAINT_REFUSALS` map, consulted first for a unique violation:
`ux_asset_serial_number_ci → (422, "This serial number is already used by another asset. Check the serial number
and try again.")`. The index stays the real guard (nothing about what counts as a clash changed; N/A still repeats).
The sentence does not name the other asset (the global handler cannot apply the caller's company / work-area
visibility rule that the pre-check uses). Everything else is answered exactly as before; the handler still writes
its WARNING `error_log` row (now with status 422).

Other constraints reviewed: **asset code** (`asset_asset_code_key`, plain column) already gets "A record with
this asset code already exists." (409; codes come from the atomic counter, so not reachable in a race); **live PO
number** (`uq_purchase_order_company_number_active`) already has its own sentence (409; serialised by the advisory
lock, pinned by `test_s7_row_locks::test_the_index_violation_is_a_plain_sentence`); **idempotency key** uses
`ON CONFLICT DO NOTHING` + its own 409 "already being processed". None of them shared the generic text, so they
were left unchanged (task: "if they share the generic text").

**Tests** — `backend/tests/core/test_wpf2_serial_race_message.py` (9):
- unit: constraint-name → message map (serial → 422 sentence; PO number, asset code, another expression index
  (generic text, not hidden) and a foreign-key error unchanged); the serial index exists in the test DB;
- the index path made certain (pre-check monkeypatched to "nothing in use", i.e. the exact race-loser situation):
  receive → 422 with the serial sentence + `request_id`, nothing written (PO unit still PENDING); batch add → same;
- real bursts of 20 at once, each → exactly one success, 19 × 422 with a serial sentence, **no 409, no 500**,
  exactly one asset with the serial:

| Burst (20 parallel) | Before (retest 2) | After (this run) | 422 answered by index / pre-check |
|---|---|---|---|
| `POST /{po}/receive` one serial, 20 POs | (not burst by retest; pair test was 200 + 409) | 200×1, 422×19 | 14 / 5 |
| `POST /api/assets/batch` one serial | — | 201×1, 422×19 | 4 / 15 |
| `POST /api/assets` one serial (retest scenario c) | 201×1, **409×13**, 422×6 | 201×1, 422×19 | 13 / 6 |

(The index / pre-check split varies run to run; it is printed by the tests under `pytest -s`.)
- regression guard: "N/A" / " n/a " still repeat freely in parallel.

## Existing tests changed

None. (`test_security_concurrency::test_the_same_serial_on_two_parallel_receipts_creates_one_asset` asserts only a
4xx for the loser, still true; no test pinned the generic sentence or a 409 for the serial.)

## Full backend suite

One full run in the dev `api` container against `ckam_test` (app + tests synced with `docker compose cp`; the
extra `/app/ops`, `/app/Dockerfile`, `/app/frontend-router.tsx` kept in place):

```
2541 passed, 1 skipped in 545.25s (0:09:05)
```

Baseline was 2521 passed, 1 skipped; +20 = the 20 new tests (11 + 9). No regressions.

## User-visible behaviour change

- Adding (or renaming / moving / importing) a category whose name an active category of the same work area already
  has is refused: "A category with this name already exists." Same for sub-categories inside one category.
  Existing duplicate rows stay as they are.
- A person who loses a same-serial race now sees "This serial number is already used by another asset. Check the
  serial number and try again." (422) instead of "This record already exists." (409).

## Files changed

- `backend/app/masters/router.py`
- `backend/app/core/errors.py`
- `backend/tests/masters/test_wpf2_category_names.py` (new)
- `backend/tests/core/test_wpf2_serial_race_message.py` (new)
- `docs/security/evidence/closure/wpf/WPF2_RESULTS.md` (this file)
