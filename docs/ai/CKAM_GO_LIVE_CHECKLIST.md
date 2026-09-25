# CKAM — Go-Live Checklist

Prepared during AM-10. This is the operator-facing checklist for the
actual cutover day — the human-executable smoke test, the post-cutover
database verification, the release-day backup plan, the objective
rollback triggers, and the final Go/No-Go decision table. It assumes the
production-data strategy decision (`AM-10_GO_LIVE_PREPARATION_REPORT.md`
§9-13) and every item in `CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md` /
`CKAM_PRODUCTION_SERVER_CHECKLIST.md` have already been resolved.

## 1. Release-day backup plan

**Before deployment:**
1. `docker compose exec backup sh /scripts/backup.sh` — take a fresh
   manual DB + uploads backup, on top of the nightly automatic one.
2. Confirm both files landed in `${BACKUP_DIR}` and are non-zero size.

**After deployment:**
3. Verify the database (see §3 below).
4. Verify uploads (spot-check that the `uploads` volume still mounts and,
   if any documents existed before deployment, that one is still
   downloadable).
5. Run the smoke test (§2 below).
6. Run another backup once the smoke test passes, so the first
   confirmed-good post-deploy state is itself backed up.

Uses only the existing `ops/backup.sh` mechanism — no new backup tooling.

## 2. Go-live smoke test (~10–15 minutes, human-executable)

Every check below uses a function that already exists in the app — none
were invented for this checklist.

- [ ] `GET /api/health` returns `{"status":"ok"}`
- [ ] `docker compose exec api alembic current` reports `(head)`
- [ ] Log in with the real owner account (or the account the production
      data strategy established)
- [ ] If `must_change_password` is set: forced password-change screen
      appears and completing it logs the user in normally afterward
- [ ] Dashboard loads with real (not error, not stuck-loading) data
- [ ] Asset Register loads, search/filter controls respond
- [ ] Open one real Asset 360 page — all tabs (Overview, Procurement,
      Custody, Custom Fields, History, Changes, Documents) render
- [ ] Add Asset: either create one real, deliberate first asset, or at
      minimum open the form and confirm every dropdown (Cost Centre,
      Category, Subcategory, Vendor, initial Holder) is populated with
      real, correctly-scoped options — not empty, not a leftover test
      value
- [ ] Holder list loads and shows the real holders created during initial
      setup
- [ ] Import: download the template from `/import` and confirm it opens
      and matches the documented 22-column contract
- [ ] Reports: download one real export (Asset Register) and confirm it
      opens and contains the expected columns
- [ ] Scan one printed QR label with a phone actually on the LAN and
      confirm it opens the correct Asset 360 page at the real `BASE_URL`
      (not `localhost`)
- [ ] `docker compose exec backup cat /var/log/ckam-backup.log` shows a
      `Backup complete` line from tonight's (or the manual pre-deploy)
      run
- [ ] `docker compose logs api` shows **no** tracebacks and **no**
      `SECURITY WARNING` line

## 3. Post-cutover database verification (read-only — no write statements)

```sql
-- Row counts (compare against what the chosen data strategy expects)
SELECT count(*) FROM company;
SELECT count(*) FROM holder;
SELECT count(*) FROM asset;

-- Data integrity (every one of these must return 0)
SELECT count(*) FROM (
  SELECT asset_code FROM asset GROUP BY asset_code HAVING count(*) > 1
) dup_codes;                                                        -- duplicate Asset Codes
SELECT count(*) FROM asset a LEFT JOIN holder h ON h.id = a.current_holder_id
  WHERE a.current_holder_id IS NOT NULL AND h.id IS NULL;           -- orphaned current_holder_id
SELECT count(*) FROM asset_event e LEFT JOIN asset a ON a.id = e.asset_id
  WHERE a.id IS NULL;                                                -- orphaned asset_event rows

-- Migration state
-- (run via: docker compose exec api alembic current)
-- expected: f28b6a913dce (head)

-- Trigger presence (expect exactly 5 rows)
SELECT tgname FROM pg_trigger WHERE tgname IN (
  'trg_asset_no_identity_change', 'trg_asset_event_no_update', 'trg_asset_event_no_delete',
  'trg_asset_field_change_no_update', 'trg_asset_field_change_no_delete'
);

-- Index presence (expect exactly 6 rows, the AM-01 indexes)
SELECT indexname FROM pg_indexes WHERE indexname LIKE 'ix_asset%';

-- Recent event activity (sanity-check that the smoke test's own actions, if any, landed)
SELECT count(*) FROM asset_event WHERE created_at > now() - interval '1 hour';

-- Backup file presence (run on the host, not in SQL)
-- ls -la ${BACKUP_DIR}
```

## 4. Objective rollback triggers

Roll back if, and only if, one of these is objectively true:

- The app does not start (`docker compose ps` shows `api` or `web` not
  `Up`, or `/api/health` does not respond)
- A migration fails (`alembic upgrade head` exits non-zero)
- Login is unavailable for every account (not one specific account's own
  credential mistake)
- Wrong-company data is visible to a scoped account (a genuine
  cross-company leak, not an expected ADMIN-sees-everything view)
- A key workflow (login, Add Asset, Asset 360, an export) returns a raw
  500/unhandled exception, not a controlled 4xx
- An export downloads corrupted or truncated
- A restore/DB mismatch is discovered (row counts or Alembic revision
  don't match what was expected)
- Persistent, unexplained tracebacks appear in `docker compose logs api`
  after cutover

**Do not roll back** for a cosmetic P3 issue (e.g. the font CDN being
slow, the bundle-size advisory) — these have no user-facing correctness
impact and rolling back for them destroys more stability than it
protects.

## 5. Rollback application procedure

See `docs/ai/CKAM_RELEASE_RUNBOOK.md` §10-11 for the full step-by-step
(git checkout the prior release commit, `docker compose up -d --build`,
verify health) — re-verified mechanically safe this session via a live
rehearsal: the prior release commit (`e9225e5`) was checked out into a
disposable worktree, its backend image built fresh, and a throwaway
container from that image was run against a disposable database at the
**current** Alembic head (`f28b6a913dce`) — `/api/health` and a real login
both succeeded cleanly, with zero `SECURITY WARNING` lines, proving a
code-only rollback to that point is safe against the current schema (no
migration divergence between that commit and the current release). See
`AM-10_GO_LIVE_PREPARATION_REPORT.md` §29 for the full rehearsal evidence.

## 6. Go/No-Go decision table

| Gate | Required state | Evidence | Status | Blocking? |
|---|---|---|---|---|
| Git | Clean working tree, unambiguous final commit | `git status` clean, HEAD resolved and recorded in `CKAM_RELEASE_MANIFEST.md` | PASS | No |
| Regression | Backend ≥305, Frontend ≥148, Typecheck clean, E2E ≥5, all re-run this stage | Backend 305/305, Frontend 148/148, Typecheck clean, E2E 5/5 (re-run twice — before and after the nginx change) | PASS | No |
| Database | Single Alembic head, fresh-DB boot clean, zero integrity violations | Re-confirmed `f28b6a913dce (head)` on `ckam`/`ckam_test`, fresh disposable-DB migration clean this session | PASS | No |
| Data cleanliness | Production data strategy explicitly decided, not assumed | **DECISION REQUIRED** — see the AM-10 report §9-13. Strong evidence favors FRESH PRODUCTION DATABASE, but this is a business/deployment decision this audit cannot make unilaterally | **DECISION REQUIRED** | **Yes** |
| Secrets | `JWT_SECRET`/`POSTGRES_PASSWORD` real, not placeholders, on the actual production server | This dev environment: `JWT_SECRET` acceptable, `POSTGRES_PASSWORD` is a repository-known dev default and must be regenerated for production | **DECISION REQUIRED** (must be set on the real server; cannot be verified from this session) | **Yes** |
| BASE_URL | Set to the real production LAN address before any QR label is printed | Currently `http://localhost:3211` in this dev environment | **NEEDS CONFIGURATION** on the real server | **Yes** (blocks QR correctness, not the app itself) |
| Backup destination | On a separate disk from Docker's volumes, itself copied off the server | Currently the dev default `./backups`, same disk as volumes — DEV-ONLY | **NEEDS CONFIGURATION** on the real server | **Yes** (before the server holds real data) |
| Restore | Proven end-to-end against a disposable database, not merely assumed | Real backup + real restore into a disposable DB rehearsed twice now (AM-09 and AM-10), byte-for-byte row-count match both times | PASS | No |
| Admin account | Exactly one real, correctly-configured ADMIN account for the real company at cutover | Real owner account (`CS6872`, Ankur Pahwa) confirmed correctly configured; **however**, an unrelated test ADMIN account (`UATADMIN`) is currently active in the SAME real company (`CKS`) — see the AM-10 report §10 | **BLOCKING until resolved** | **Yes — P1 go-live blocker** |
| Test accounts | No active test/E2E/UAT account anywhere, especially not ADMIN-role | 2 leftover active `SEEDADMIN` holders (in already-deactivated companies, so not currently exploitable via login, but still messy state), plus the `UATADMIN` finding above | **BLOCKING until resolved** | **Yes — P1 go-live blocker (see row above)** |
| Production master readiness | Company/Location/Department/Cost Centre/Category/Subcategory/Vendor/Code Rule all reviewed and correct for real use, not leftover test values | The real company's own Cost Centre ("UAT Cost Centre"), Vendor ("AM04 Test Vendor Co"), and both active Code Rules (`RCMX/`, `AM04UAT/`) are all confirmed test artifacts — see `CKAM_INITIAL_SETUP_GUIDE.md`'s warning | **DECISION REQUIRED** (depends on the data-strategy decision above) | **Yes** |
| Server | Docker/Compose present, disk capacity adequate, ports free | Verified in this dev sandbox only; the real production server has not been inspected by this session | **NEEDS VERIFICATION on the real server** | **Yes** (cannot be confirmed remotely) |
| Networking | Firewall allows `WEB_PORT`, `DB_PORT`/`API_PORT` stay loopback-only | Verified in this dev sandbox's own network only | **NEEDS VERIFICATION on the real server** | **Yes** |
| Smoke test | Defined and ready to execute | §2 above, ready | PASS (definition only — not yet run against a real production server) | No |
| Rollback | Rehearsed, proven mechanically safe | Live rehearsal this session (§5 above) | PASS | No |
| Runbook | Exists, accurate, references real evidence | `docs/ai/CKAM_RELEASE_RUNBOOK.md` (AM-09), still accurate — no change needed | PASS | No |

## Conclusion

**GO-LIVE PREPARED WITH DECISIONS REQUIRED.** See
`AM-10_GO_LIVE_PREPARATION_REPORT.md` §46 for the full verdict and the
exact list of decisions that must be made — none of them are technical
blockers in the sense of "the software doesn't work"; all of them are
either explicit business/deployment decisions (data strategy) or
server-specific configuration/cleanup steps this session's sandboxed
environment cannot resolve or verify on the operator's behalf.
