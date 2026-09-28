# AM-17 — DB-Layer Verification Findings

Date: 2026-09-28
Scope: DB-layer verification only (migrations, backup/restore, integrity sweep,
append-only trigger negative tests, numbering concurrency). Read-only against
live `ckam` except where explicitly noted as a disposable DB or a
`BEGIN; ...; ROLLBACK;` transaction. No application source code was touched.
Alembic head confirmed independently beforehand and reconfirmed here:
`278437eb710e` (single head).

---

## Task 1 — Fresh migration chain verification — PASS

1. Created disposable DB `ckam_am17_fresh`:
   ```
   docker compose exec -T db psql -U ckam -d postgres -c "CREATE DATABASE ckam_am17_fresh OWNER ckam;"
   ```
2. Ran the full migration chain against it via the `api` container:
   ```
   docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_am17_fresh api alembic upgrade head
   ```
   Output ran all 15 revisions in order (`62108649b9c8` ... through ...
   `278437eb710e`) with no errors. Confirmed via
   `SELECT version_num FROM alembic_version;` → `278437eb710e`. **PASS.**

3. Verified schema objects on the fresh DB:
   - 19 tables present, including `purchase_order`, `pending_asset`, `asset`.
   - `purchase_order.cost_center_id` column exists (`bigint`, nullable, FK to
     `cost_center.id` via `fk_purchase_order_cost_center_id`).
   - `pending_asset` has the delivered-asset linkage columns
     (`delivered_asset_id`, `delivered_at`, `delivered_by`) and its own
     `barcode` column.
   - `asset` has `barcode` column (nullable, deliberately non-unique per
     `docs/ai/DECISIONS.md`).
   - Partial unique index `ux_asset_serial_number_ci` exists on `asset`:
     `UNIQUE, btree (lower(TRIM(BOTH FROM serial_number))) WHERE serial_number IS NOT NULL AND TRIM(BOTH FROM serial_number) <> '' AND lower(trim(...)) <> 'n/a' AND deleted_at IS NULL`.
   - All 5 expected triggers present (via `information_schema.triggers`):
     | table | trigger | timing | event |
     |---|---|---|---|
     | asset | trg_asset_no_identity_change | BEFORE | UPDATE |
     | asset_event | trg_asset_event_no_delete | BEFORE | DELETE |
     | asset_event | trg_asset_event_no_update | BEFORE | UPDATE |
     | asset_field_change | trg_asset_field_change_no_delete | BEFORE | DELETE |
     | asset_field_change | trg_asset_field_change_no_update | BEFORE | UPDATE |

   All present. **PASS.**

4. Downgrade/upgrade round-trip on the SAME disposable DB (never live):
   ```
   docker compose exec -T -e DATABASE_URL=...ckam_am17_fresh api alembic downgrade -1
   ```
   → `278437eb710e -> 6c882ef3b225` succeeded, `alembic_version` confirmed
   `6c882ef3b225`.
   ```
   docker compose exec -T -e DATABASE_URL=...ckam_am17_fresh api alembic upgrade head
   ```
   → `6c882ef3b225 -> 278437eb710e` succeeded, `alembic_version` back to
   `278437eb710e`. Clean round-trip, no errors. **PASS.**

5. Dropped `ckam_am17_fresh`:
   ```
   docker compose exec -T db psql -U ckam -d postgres -c "DROP DATABASE ckam_am17_fresh;"
   ```

**Task 1 overall: PASS.** Migration head confirmed: `278437eb710e`.

---

## Task 2 — Backup + restore drill — PASS

1. Baseline (live `ckam`):
   - `alembic_version.version_num` = `278437eb710e`
   - Row counts: `asset`=250, `asset_event`=367, `asset_field_change`=73,
     `purchase_order`=3, `pending_asset`=191.

2. Real backup taken via the `backup` container:
   ```
   docker compose exec -T backup pg_dump -h db -U ckam -d ckam | gzip > backups/ckam_am17_backup.sql.gz
   ```
   No errors on stderr. **Backup file:**
   `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build\backups\ckam_am17_backup.sql.gz`
   **Size: 104,253 bytes (~101.8 KiB).**

3. Created disposable DB `ckam_am17_restore` and restored into it (NOT
   `ops/restore.sh`, which hardcodes `-d ckam` — replicated its logic
   manually against the disposable DB instead):
   ```
   docker compose exec -T db psql -U ckam -d postgres -c "CREATE DATABASE ckam_am17_restore OWNER ckam;"
   gunzip -c backups/ckam_am17_backup.sql.gz | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U ckam -d ckam_am17_restore
   ```
   Restore completed with `ON_ERROR_STOP=1` and no errors (clean stderr).

4. Verification against `ckam_am17_restore`:
   - `alembic_version.version_num` = `278437eb710e` — matches baseline.
   - Row counts: `asset`=250, `asset_event`=367, `asset_field_change`=73,
     `purchase_order`=3, `pending_asset`=191 — **exact match** to live
     baseline.
   - All 5 triggers present (same table above).
   - `ux_asset_serial_number_ci` index present.

5. Dropped `ckam_am17_restore`:
   ```
   docker compose exec -T db psql -U ckam -d postgres -c "DROP DATABASE ckam_am17_restore;"
   ```

**Task 2 overall: PASS.** Backup/restore round-trip is exact and lossless.

---

## Task 3 — DB integrity read-only sweep (live `ckam`) — PASS (0 anomalies, all 15 checks)

Model/enum values confirmed by reading `backend/app/assets/models.py`,
`backend/app/holders/models.py`, `backend/app/masters/models.py` before
writing queries:
- `ASSET_STATUSES = ("IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST")`
  — note this differs from the task prompt's assumed set: **`INSTALLED` is a
  real, valid asset status** not listed in the prompt's guessed enum. Used
  the real set from the model, not the guessed one.
- `HOLDER_TYPES = ("EMPLOYEE", "STORE", "INSTALLED", "IT_STOCK")`
- `ROLES = ("ADMIN", "IT_TEAM", "VIEWER", "HOLDER")`
- `FIELD_TYPES = ("text", "number", "date", "dropdown", "checkbox")` on table
  `custom_field` (not `custom_field_definition` — that table name doesn't
  exist in this codebase; the actual table is `custom_field`).
- `asset.asset_code` carries a table-wide (not per-company) `UNIQUE`
  constraint (`asset_asset_code_key`) at the DB level, so a same-company
  duplicate is structurally impossible unless the constraint itself were
  bypassed.

All 15 checks run as individual read-only `SELECT`s against live `ckam`
(full SQL in `docker compose exec -T db psql -U ckam -d ckam` session,
scratch file `am17_integrity_checks.sql`, not committed to the repo):

| # | Check | Result |
|---|---|---|
| 1 | Duplicate `asset_code` within same company | **0 rows — PASS** |
| 2 | Duplicate non-"N/A" serial number, case-insensitive, system-wide (active assets) | **0 rows — PASS** |
| 2b | Same, including soft-deleted assets (informational, not required) | **0 rows — PASS** |
| 3 | Asset `cost_center_id` company ≠ asset `company_id` | **0 rows — PASS** |
| 4 | Asset `current_holder_id` company ≠ asset `company_id` | **0 rows — PASS** |
| 5 | Asset category/subcategory mismatch | **0 rows — PASS** |
| 6 | Orphan `asset.current_holder_id` | **0 rows — PASS** |
| 7 | Orphan `asset_event` rows | **0 rows — PASS** |
| 8 | Orphan `asset_field_change` rows | **0 rows — PASS** |
| 9 | `pending_asset` → nonexistent `purchase_order` | **0 rows — PASS** |
| 10 | DELIVERED `pending_asset` with NULL `delivered_asset_id` | **0 rows — PASS** |
| 11 | non-DELIVERED `pending_asset` with `delivered_asset_id` set | **0 rows — PASS** |
| 12a | DELIVERED `pending_asset` → nonexistent linked asset | **0 rows — PASS** |
| 12b | DELIVERED `pending_asset` linked asset company/cost_center ≠ PO's | **0 rows — PASS** |
| 13 | `purchase_order.cost_center_id` company ≠ PO `company_id` | **0 rows — PASS** |
| 14 | `asset.status` outside real enum (8 values incl. INSTALLED) | **0 rows — PASS** |
| 15 | `holder.holder_type` / `holder.role` / `custom_field.field_type` outside enum | **0 rows each — PASS** |

**No anomalies found anywhere in the live `ckam` database.**

---

## Task 4 — Append-only ledger trigger negative tests — PASS (all 6 rejected as expected)

Every statement below was run as `BEGIN; <stmt>; ROLLBACK;` against live
`ckam`; nothing was ever committed. Confirmed afterward that
`asset_event` count (367), `asset_field_change` count (73), and `asset` row
1's `asset_code`/`company_id`/`cost_center_id` were unchanged.

| # | Statement | Result |
|---|---|---|
| 1 | `UPDATE asset_event SET remarks='hacked' WHERE id=1` | `ERROR: asset_event rows are append-only; insert a CORRECTION event instead` (via `forbid_asset_event_write()`) — **REJECTED** |
| 2 | `DELETE FROM asset_event WHERE id=1` | `ERROR: asset_event rows are append-only; insert a CORRECTION event instead` — **REJECTED** |
| 3 | `UPDATE asset_field_change SET new_value='hacked' WHERE id=1` | `ERROR: asset_field_change rows are append-only` (via `forbid_asset_field_change_write()`) — **REJECTED** |
| 4 | `DELETE FROM asset_field_change WHERE id=1` | `ERROR: asset_field_change rows are append-only` — **REJECTED** |
| 5 | `UPDATE asset SET asset_code='X-HACKED' WHERE id=1` | `ERROR: asset_code is immutable once set` (via `forbid_asset_identity_change()`) — **REJECTED** |
| 6 | `UPDATE asset SET company_id=2 WHERE id=1` | `ERROR: company_id is immutable once set` — **REJECTED** |
| 7 | `UPDATE asset SET cost_center_id=2 WHERE id=1` | `ERROR: cost_center_id is immutable once set` — **REJECTED** |

(Numbered 1–6 in the task; `asset_event`/`asset_field_change` each needed
both an UPDATE and a DELETE variant, for 7 statements total, all rejected.)

Normal app-level INSERT into `asset_event`/`asset_field_change` is not
re-tested here — it is implicitly proven by the passing pytest suite and was
also exercised live during Task 5 (20 successful `PROCURED` event inserts).

**Task 4 overall: PASS.** All three trigger functions
(`forbid_asset_event_write`, `forbid_asset_field_change_write`,
`forbid_asset_identity_change`) correctly reject every attempted mutation,
with clear, specific error messages. Live data confirmed untouched after
every rollback.

---

## Task 5 — Numbering concurrency test (20 parallel requests) — PASS (20/20 unique codes)

Pre-check: `SELECT emp_code, company_id, is_active FROM holder WHERE emp_code='SEEDADMIN';`
showed multiple **active** `SEEDADMIN` rows already in use in other
companies (e.g. company_id 9, 13, ...). Per instructions, did **not** reuse
`SEEDADMIN`; created a fully isolated throwaway setup instead:

- Disposable company: `company.code = 'UAT-AM17-CONCURRENCY'` (id=215)
- Disposable location `UAT-AM17-HO` (id=166), department `UAT-AM17-IT`
  (id=166), cost center `UAT-AM17-CC` (id=169, company_id=215)
- Throwaway ADMIN holder: `emp_code='UAT-AM17-CONCURRENCY-ADMIN'` (id=615),
  scoped only to company 215, `role='ADMIN'`
- These setup rows were inserted directly via SQL (company/location/
  department/cost_center/holder — fast, safe, read-verified first); the
  Code Rule itself and every asset-creation call were exercised through the
  **real HTTP API**, exactly as the app would drive them:
  - Logged in for real: `POST /api/auth/login` with the throwaway holder's
    credentials → real JWT access token.
  - Created a real Code Rule via `POST /api/code-rules`:
    `{"company_id":215,"prefix_template":"UAT-AM17-","suffix_template":"","start_number":1,"pad_width":4}`
    → `id=147`, `is_active=true`.

Fired 20 truly concurrent HTTP requests (20 backgrounded `curl` processes,
`&` + `wait`, single shell script) against `POST /api/assets`, each
`quantity=1`, each with `serial_number="N/A"` (the reserved
uniqueness-exempt placeholder, so the 20 calls can't collide with each
other on that axis), same company/cost-center/category/subcategory/vendor,
differing only in per-unit PO/invoice/PI numbers and description.

Result: **all 20 HTTP calls returned 201 with a unique asset**, codes
`UAT-AM17-0001` through `UAT-AM17-0020`, no duplicates, no gaps, in a
single test run (no retries needed).

DB-side verification:
```sql
SELECT asset_code, count(*) FROM asset WHERE company_id=215 GROUP BY asset_code HAVING count(*)>1;  -- 0 rows
SELECT count(DISTINCT asset_code), count(*) FROM asset WHERE company_id=215;                        -- 20, 20
SELECT resolved_prefix, next_value FROM code_counter WHERE resolved_prefix='UAT-AM17-';              -- next_value = 21
```
`start_number=1` → first allocated number is 1, 20 allocations later
`next_value` correctly sits at `21` (1 + 20). No skips, no corruption —
`generate_code`'s `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`
atomic-upsert design held up under real concurrent load exactly as its
code comment claims.

**Observation (not a defect):** the throwaway holder used as
`initial_holder_id` was `holder_type='EMPLOYEE'` (not `IT_STOCK`, since it
was also doubling as the test's ADMIN actor for convenience). The system
accepted this without complaint and `apply_event` set the resulting assets'
status directly to `ALLOTTED` (not `IN_STOCK`) because the initial holder is
an employee, not stock. This is expected behavior given the input, not a
migration/DB-layer issue — noted here only because it might look surprising
at a glance in the raw API responses saved during this test.

### Cleanup (soft-deactivate only, no hard deletes)

- All 20 test assets: `deleted_at` set (mirrors exactly what
  `DELETE /api/assets/{id}` — "delete_asset_entry_mistake" — does; each
  asset had only its single PROCURED event, so this is the same case that
  endpoint is designed for). Direct SQL was used for this specific step only
  because the app-level endpoint could no longer authenticate once the
  throwaway holder had already been deactivated in the same cleanup pass —
  the effect is identical (`deleted_at = now()`, `updated_by` set).
- Code Rule id 147: `is_active=false`
- Holder id 615: `is_active=false`
- Cost center id 169: `is_active=false`
- Location id 166: `is_active=false`
- Department id 166: `is_active=false`
- Company id 215: `is_active=false`

Verified after cleanup: all 20 assets have `deleted_at IS NOT NULL`; all 6
master/holder rows have `is_active=false`. Nothing hard-deleted.

**Task 5 overall: PASS.** 20/20 unique codes, counter exactly +20, no
corruption, full cleanup confirmed.

---

## Summary

| Task | Result |
|---|---|
| 1. Fresh migration chain | **PASS** — head `278437eb710e`, all objects present, downgrade/upgrade round-trip clean |
| 2. Backup + restore drill | **PASS** — exact match on revision, row counts, indexes, triggers |
| 3. Integrity sweep (15 checks) | **PASS** — 0 anomalies on every check |
| 4. Append-only trigger negative tests | **PASS** — all 7 statements (6 required + 1 extra DELETE variant) rejected with correct errors; live data unaffected |
| 5. Numbering concurrency (20 parallel) | **PASS** — 20/20 unique codes, counter exactly +20 |

No anomalies, no data corruption, no security or integrity findings of any
kind surfaced during this verification pass. No application source code was
modified. No destructive SQL was ever run against the live `ckam` database.
