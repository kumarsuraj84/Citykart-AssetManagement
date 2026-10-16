# CKAM security closure — THIRD independent retest (CL3)

Independent penetration retest of the six fixes that had not yet been re-attacked by a third tester. Tests were
derived from the finding descriptions and attacker reasoning, not from the developers' own tests. **Local only.**

- Date: 2026-10-16. Repo HEAD: `fd34520` (Alembic head `c6e8a0b2d4f6`).
- Stacks used: throw-away `ckam-r3` (disposable compose, web 4011 / api 9000 / db 25502, `ENVIRONMENT_NAME=uat`,
  built from `docker-compose.yml` at HEAD, migrated to head, seeded from `seeded.dump` then upgraded);
  existing `ckam-sec` (web 3411 / api 8200 / Postgres 25442, final image); `docker run --rm` network-less
  container of the final `ckam-sec-api` image for the single-port test; a throw-away database `ckam_r3_rs` with
  roles `r3_owner/r3_migrator/r3_app` inside the `ckam-sec` Postgres.
- Scripts: `scripts/` · raw output: `raw/` · machine log: `tests.csv` (prefix `CL3-T`).
- Sign-ins: one per persona, tokens cached, paced; failed-login attacks were spaced and kept under the limits.

## Counts

- Discrete cases executed: **~360** across 6 items + a regression sweep (IF-04 probe 64 requests; role-split
  verify 49 rows + breakout matrix ~45 statements + 3 detection/reset checks; audit-failure ~10 requests/queries;
  IF-03 14 requests; SE-N01 ~79 requests; SE-N03 ~48 requests; sanity 11 requests).
- Logged assertions in `tests.csv`: **52** — **PASS 52, FAIL 0.**
- New findings: **0** (no new CL3-* finding). Two methodology notes and one coverage limitation below.

## Per-item verdict

| # | Finding | Verdict |
|---|---------|---------|
| 1 | CL2-IF-04 single-port production (Asset 360 / route-looking fallback / traversal 404) | **PASS** |
| 2 | CL2-IF-01 + CL2-IF-02 database role-split scripts (runtime breakout) | **PASS** |
| 3 | CL2-IF-01 audit-write failure visibility | **PASS** |
| 4 | CL2-IF-03 X-Request-ID exactly once, never client-chosen (unsafely) | **PASS** |
| 5 | CL2-SE-N01 one active category / sub-category name per scope | **PASS** |
| 6 | CL2-SE-N03 same-serial race | **PASS** |
| — | Regression sanity sweep on ckam-r3 | **PASS** (no regressions) |

## Findings/attacks table

| Finding | Attack | Expected | Actual | Verdict | Evidence |
|---|---|---|---|---|---|
| CL2-IF-04 | App routes `/assets/<id>`, `/assets/new`, multi-segment | HTML shell, `Cache-Control: no-cache`, no disk read | 200 text/html shell, `no-cache`, for all | PASS | raw/if04_result.txt |
| CL2-IF-04 | **Route-looking canary files** `new`/`123`/`settings` placed in `<dist>/assets` | shell returned, file never served | shell returned; **0 canary leaks** | PASS | raw/if04_result.txt |
| CL2-IF-04 | Missing `.js/.css/.map` | identical plain 404, never the shell | 404 JSON `{detail:"Not Found",request_id}` identical bar the id | PASS | raw/if04_result.txt |
| CL2-IF-04 | Traversal/Windows/double-/overlong-encoding/device/overlong/empty/NUL/unicode/symlink (≈45 payloads) | identical 404, no 5xx, no leak | all 404 JSON, **0 leaks, 0 5xx, 0 traceback** | PASS | raw/if04_result.txt |
| CL2-IF-04 | HEAD/OPTIONS/POST on an app route | no file read | 405 Method Not Allowed (GET-only) | PASS | raw/if04_result.txt |
| CL2-IF-01 | role_split + verify on fresh DB | every row PASS | 49/49 PASS* | PASS | raw/r3_04_verify.txt |
| CL2-IF-01 | as `r3_app`: `setval`/`ALTER SEQUENCE` on ledger id seqs (first) + bigint-max + loop over all 32 seqs | all denied; `nextval` allowed | every `setval`/`ALTER SEQUENCE` **permission denied / must be owner**; loop "no LEAK = all denied"; `nextval` ok | PASS | raw/r3_06_runtime_matrix.txt |
| CL2-IF-01 | as `r3_app`: TRUNCATE/UPDATE/DELETE ledgers, ALTER/DROP/CREATE, DISABLE/DROP/ENABLE-REPLICA trigger, `SET session_replication_role`, purge fn, `SET ROLE`, COPY TO PROGRAM, `UPDATE alembic_version`, ALTER OWNER | all denied | all **ERROR** (permission denied / must be owner / set role denied) | PASS | raw/r3_06_runtime_matrix.txt |
| CL2-IF-02 | as `r3_app`: `ALTER ROLE self SET …` incl per-db `statement_timeout`, and **`SET role=r3_owner`** (escalation) | settable but detected; escalation ineffective; superuser-only params refused | 4 stored defaults set; **all listed by check row 21**; `session_replication_role` refused; stored `role=r3_owner` **rejected at login — no escalation** | PASS | raw/r3_06_runtime_matrix.txt; raw/adhoc_transcripts.txt |
| CL2-IF-02 | hide-damage: any undetected persistent change | none undetected | none — sequence writes denied; every stored default reported | PASS | raw/r3_06_runtime_matrix.txt |
| CL2-IF-02 | documented superuser RESET | clears defaults, check PASS, writes resume | row 21 PASS; fresh session `ro=off`; INSERT ok | PASS | raw/r3_07_reset.txt |
| CL2-IF-01 | audit-insert failure provoked (`audit_log_id_seq := bigint max`); user-facing behaviour | sensible, no 500/SQL leak | failed login → **401** `{detail:"Invalid credentials"}`, no SQL in body | PASS | raw/if01b_01_break.txt |
| CL2-IF-01 | failure reporting over time | first report, then re-reported ≤ once/min with running count; not silent, not a flood | "Failure 1 …"; then **"6 failures so far, 5 since the last report 125 s ago"** | PASS | raw/if01b_03_reports.txt |
| CL2-IF-01 | system_event on failure | write_failed row when DB allows, once per report | 1 row (component=logging,event=write_failed,total=1), request_id matches; not one-per-failure | PASS | raw/if01b_02_systemevent.txt |
| CL2-IF-01 | repair sequence | audit resumes, reporting stops | audit_log 240→241 after repair; no new report | PASS | raw/if01b_04_repair.txt |
| CL2-IF-03 | X-Request-ID on static/SPA/404/map-404/413/API | exactly one, server-generated, not doubled | **count=1 everywhere**; 32-hex server id; 413 `@too_large` JSON id=1 | PASS | raw/if03_reqid_result.txt |
| CL2-IF-03 | client `X-Request-ID: attacker-1` (well-formed) to API | per app rule (1-64 `[A-Za-z0-9._-]` honoured for correlation) | returned `attacker-1`, count=1 — documented sanitised-accept | PASS | raw/if03_reqid_result.txt |
| CL2-IF-03 | client 500-char / CRLF+odd-char id | server id, never the unsafe value | long & odd → fresh server id; no CRLF/injection | PASS | raw/if03_reqid_result.txt |
| CL2-IF-03 | client id on an nginx-served static page | nginx uses its own id | returned server id, not `attacker-1` | PASS | raw/if03_reqid_result.txt |
| CL2-SE-N01 | 20 parallel category creates, one name, one work area (SECHO & SECFANIT) | exactly 1 active row, losers 422 plain | 201:1 / 422:19 both personas; "A category with this name already exists." | PASS | raw/cl3_masters_race.txt; raw/cl3_masters_verify_sql.txt |
| CL2-SE-N01 | case/space variants parallel | exactly 1 active | 201:1 / 422:5 | PASS | raw/cl3_masters_race.txt |
| CL2-SE-N01 | same name other work area / sub-category other category | allowed | 201; SQL: 1 IT + 1 NON_IT | PASS | raw/cl3_masters_verify_sql.txt |
| CL2-SE-N01 | SECFANIT creates IT category (out of area) | 403, no row | 403; no row | PASS | raw/cl3_masters_race.txt |
| CL2-SE-N01 | 20 parallel sub-category creates one name one category | exactly 1 active | 201:1 / 422:19 | PASS | raw/cl3_masters_race.txt |
| CL2-SE-N01 | rename onto existing name / onto other-area name | refuse / allow | 422 refuse; 200 allow | PASS | raw/adhoc_transcripts.txt |
| CL2-SE-N01 | Excel import of duplicate rows | in-file dup + existing-name refused, other-area allowed | imported:2; row3 in-file dup & row5 existing-name refused | PASS | raw/cl3_import_commit.txt |
| CL2-SE-N03 | 20 parallel asset creates, one serial (single add, serial Item) | exactly 1 asset; losers plain serial 422; no bare 409/500 | 201:1 / 422:19; **no 409/5xx** | PASS | raw/cl3_serial_race.txt; raw/cl3_serial_verify_sql.txt |
| CL2-SE-N03 | loser message | serial-specific, no SQL | pre-check `serial number "…" is already used by asset CKSPL/…` and index-path `This serial number is already used by another asset…` | PASS | raw/cl3_serial_race.txt |
| CL2-SE-N03 | case/whitespace serial variants parallel | exactly 1 asset (`ux_asset_serial_number_ci`) | 201:1 / 422:6; SQL 1 row/serial | PASS | raw/cl3_serial_verify_sql.txt |
| regression | ckam-r3: sign-in, Asset360 (API+SPA), reports preview+dashboard, admin Logs, /api/health | all OK | all 200; SPA 200 html | PASS | raw/adhoc_transcripts.txt |
| regression | ckam-r3: move + receive (ledger writes) | succeed, status/PO progress | MOVED IN_STOCK→ALLOTTED (201, event 25); receive → asset 17, PO PARTLY_RECEIVED (200) | PASS | raw/adhoc_transcripts.txt |

\* The role-split verify initially showed one FAIL — see methodology note 1.

## Methodology notes & limitations (full honesty)

1. **Role-split verify — test-setup INHERIT artifact (not a product defect).** On the first verify run, the
   split-specific check "migrator … cannot create anything without becoming the owner" FAILed (`schema create=t`).
   Root cause was my setup order: I pre-created `r3_migrator` with the default `INHERIT` and then granted
   `r3_owner` to it so the first Alembic run could `SET ROLE` — in PostgreSQL 16+ the membership captured
   `INHERIT TRUE`, and `role_split.sql`'s idempotent `IF NOT already member` guard then skipped re-granting, so
   the stale inheriting membership survived. In the documented runbook flow the split **creates** the migrator
   fresh as `NOINHERIT` before granting, producing `INHERIT FALSE`. Re-issuing `GRANT r3_owner TO r3_migrator
   WITH INHERIT FALSE` (the runbook end-state) made `has_schema_privilege(migrator,'public','CREATE')` → `f` and
   every verify row PASS. **Observation worth passing to the DBA:** if a migrator role *already exists* as
   `INHERIT` when `role_split.sql` is run, the `IF NOT pg_has_role(...)` guard will not correct its membership
   inherit flag — the runbook should either drop/recreate the migrator or add an explicit `GRANT … WITH INHERIT
   FALSE`. Low severity (the documented path creates the role itself); not a CL3 finding.
2. **CL2-IF-03 client-id behaviour is intentional and safe.** The API honours a *well-formed* inbound
   `X-Request-ID` (1-64 of `A-Za-z0-9._-`, per `observability/middleware.py` / `context.accept_incoming`) for
   client-side log correlation and generates a UUID4 otherwise. A client can therefore choose its own request's
   correlation id within that safe charset, but cannot inject CR/LF/control characters (verified: 500-char and
   CRLF/odd values were replaced by a server id), cannot double the header, and cannot influence any
   nginx-served response's id. This matches "server-generated or a sanitised id, per the application's existing
   behaviour." No finding.
3. **Coverage limitation — OBS-STATUS direct status UPDATE as `r3_app` (DDL-18) was inconclusive on the fresh
   DB.** `ckam_r3_rs` was freshly migrated with no `asset` rows, so `UPDATE asset SET status='LOST' WHERE id=(SELECT
   min(id)…)` matched 0 rows and did not exercise `trg_asset_lifecycle_fields_guard`. The guard is independently
   confirmed **present and enabled** by `role_split_verify.sql`, and the dedicated OBS-STATUS behaviour lives in
   the FINAL suite and earlier WP-B evidence; this retest's IF-01/IF-02 focus (sequences, roles, stored defaults)
   was fully exercised. Not re-run on seeded data to avoid a destructive write on the shared `ckam-sec` ledger.

## Everything created has been removed

- `docker run --rm` single-port container: auto-removed (`--rm`).
- Throw-away DB/roles: `DROP DATABASE ckam_r3_rs` + `DROP ROLE r3_app/r3_migrator/r3_owner`; proven gone
  (`\l`→0 rows, `\du`→0 rows). (raw/r3_08_cleanup.txt)
- `ckam-r3` compose project: `down -v --rmi local` — 0 containers, 0 images, 0 volumes, 0 networks remain.
- `ckam-sec` test objects: CL3 categories/sub-categories soft-deactivated via the API (204); CL3 serial-race
  assets soft-deleted; imported xlsx removed from the uploads volume; `/tmp` helper SQL removed from the db
  container. Verify: 0 active CL3 categories, 0 active CL3 sub-categories, 0 live CL3 assets. **SEC* persona
  passwords were never changed.**
- Pre-existing stacks `ckam-sec` / `ckam-uat` / `ckam-build` untouched and healthy.
