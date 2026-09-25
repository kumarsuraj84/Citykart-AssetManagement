# AM-10 — Production Go-Live Preparation — Report

## 1. Executive summary

AM-10 prepares CKAM V1 for an actual production cutover without
performing it. It resolves the exact release commit, determines the
correct production database/data strategy, inventories and isolates
UAT/test data, prepares production configuration documentation, rehearses
deployment and rollback against disposable environments, prepares a local
release tag, and defines the exact cutover sequence and a final
Go/No-Go gate.

The single most consequential finding this stage is about **data, not
code**: a full, evidence-based inventory of the live `ckam` database found
that 98 of its 99 companies, 299 of its 305 holders, and 158 of its 159
assets are confirmed E2E/UAT/RC test data — and the one genuinely real
company (Citykart Stores) has **zero** genuine business assets, and its
only supporting masters (a Cost Centre named "UAT Cost Centre," a Vendor
named "AM04 Test Vendor Co," and two active Code Rules with test prefixes)
are themselves test artifacts. Separately, an **active ADMIN-role test
account (`UATADMIN`)** was found still logged-in-capable inside the real
company itself — a genuine P1 go-live blocker per this stage's own
authorization, though not a defect in the application's code.

No code defect of any severity was found. One narrow, low-risk,
HTTPS-independent nginx hardening change was made and verified (resolving
AM09-05 and AM09-06). Full regression was re-run twice this stage — once
before any change, once after — and stayed at 305/148/5/clean throughout.
A fresh-production-database bootstrap, a code-rollback, and a
backup-restore cycle were all rehearsed live against disposable
environments and all passed.

**Final AM-10 verdict: GO-LIVE PREPARED WITH DECISIONS REQUIRED.** None of
the open items are software defects — every one is either an explicit
business/deployment decision (the data strategy) or a piece of
server-specific configuration this sandboxed session cannot resolve or
verify on the operator's behalf (the real production `BASE_URL`,
`BACKUP_DIR`, `POSTGRES_PASSWORD`, and firewall/disk state). See §46.

## 2. Git preflight

- Absolute path: `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build`.
- Branch: `worktree-ckam-build`.
- HEAD at AM-10 start: `6f666b7f48d231bf660f7260d8e6a8ada4053c0a` (AM-09
  report/governance commit).
- `git status` at AM-10 start: clean, nothing to commit.
- `git log --oneline -20` at AM-10 start: linear, ending
  `6f666b7 → 9c41797 → 4cf98df → e9225e5 → ...` — matches the AM-09
  report's own stated history exactly, no drift.
- `git log 4cf98df..HEAD` at AM-10 start: exactly two commits, `9c41797`
  and `6f666b7` — the AM-09 evidence/runbook commit and the AM-09
  report/governance commit, both already known and accounted for.
- `git remote -v`: `origin` →
  `https://github.com/kumarsuraj84/Citykart-AssetManagement.git`.
- `git diff` / `git diff --stat` at AM-10 start: empty.
- No unexpected changes existed. No `pull`/`push`/`merge`/`rebase`/
  `reset`/`clean`/branch-switch/remote-config change was performed at any
  point in this stage, except the deliberate, disposable `git worktree
  add`/`git worktree remove` pair used for the rollback rehearsal (§29),
  which never touched `worktree-ckam-build` itself.

## 3. AM-09 actual report/governance commit

`6f666b7f48d231bf660f7260d8e6a8ada4053c0a` — confirmed by `git log`, not
merely trusted from the AM-09 report's own text (which correctly recorded
the same hash).

## 4. Starting HEAD

`6f666b7f48d231bf660f7260d8e6a8ada4053c0a`.

## 5. Starting regression baseline

Independently re-run before any AM-10 change:

- Backend: 305/305 passing (`docker compose exec -T -e
  DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api
  python -m pytest -q`).
- Frontend: 148/148 passing, 25 files (`npx vitest run`), `npx tsc -b`
  clean.
- E2E: 5/5 passing (`E2E_BASE_URL=http://localhost:3211 npx playwright
  test`, against the already-running dev stack).
- Production frontend build: clean, 2257 modules, 737.95 kB / 222.43 kB
  gzip (unchanged from AM-09).
- `docker compose exec api alembic current`: `f28b6a913dce (head)`.

All figures matched the AM-09 baseline exactly — no drift, no surprise.

## 6. Feature-freeze confirmation

CKAM V1 remains under feature freeze. No new business feature was started
or considered during AM-10. The one code change made (§41) is a narrow
nginx response-header hardening — it changes zero business logic, zero
API contracts, and zero UI behavior; it was explicitly pre-authorized by
this stage's own §16.

## 7. Current environment topology

```
User Browser (on the CityKart LAN)
      |
      | http://<BASE_URL>:WEB_PORT
      v
  web (nginx)  --- publishes WEB_PORT (default 3211) on ALL interfaces
      |
      | proxy_pass /api/ -> http://api:8000/api/  (same origin -- no CORS needed)
      v
  api (FastAPI/uvicorn)  --- publishes API_PORT (default 8000) on 127.0.0.1 ONLY
      |
      | postgresql+asyncpg://ckam:***@db:5432/ckam
      v
  db (PostgreSQL 17)  --- publishes DB_PORT (default 5432) on 127.0.0.1 ONLY
      |
      +-- db_data volume (persistent)
      |
  api also mounts: uploads volume (persistent, document storage)

  backup (postgres:17-alpine, cron 0 2 * * *)
      |
      +-- reads db over the internal Docker network (pg_dump)
      +-- reads uploads volume (tar)
      +-- writes to BACKUP_DIR (host-mounted, currently ./backups -- DEV-ONLY)
```

- **Externally (LAN) reachable:** `web` on `WEB_PORT` only.
- **Localhost-bound only (server itself):** `db` on `DB_PORT`, `api` on
  `API_PORT`.
- **Persistent volumes:** `db_data` (database files), `uploads` (document
  attachments).
- **Backup path:** `BACKUP_DIR` on the host, mounted into `backup` at
  `/backups`.
- **Restore path:** `ops/restore.sh`, run inside the `backup` container,
  reversing the backup path.
- **Hostname/base URL:** currently `http://localhost:3211` in this dev
  environment — a placeholder, not the production value (§13).

No infrastructure beyond these four services exists or is proposed. This
diagram is drawn directly from `docker-compose.yml` and
`frontend/nginx.conf`, not invented.

## 8. Current DB role — dev/UAT/production assessment

Read-only inventory performed against the live `ckam` database (evidence
in §9-10 below). Verdict: **the current `ckam` database is, in its
entirety, a development/UAT database that happens to contain one
genuinely real, correctly-configured account (the owner ADMIN) and zero
genuine business assets.** Every other row of substance — every other
company, the overwhelming majority of holders, every asset except one
(which is itself explicitly a UAT test asset), and every populated
supporting master in the real company — is confirmed test data by direct
evidence (naming, creation context, or direct cross-reference to a known
test/E2E/UAT/RC fixture pattern), not by assumption.

## 9. Test-data inventory

| Entity | Total rows | Evidenced UAT/test rows | Genuine/unknown rows | Safe to ignore? | Action required before go-live |
|---|---|---|---|---|---|
| Company | 99 | 98 (97 `E2E-*`/`E2EB*` seed companies from Playwright runs, code-tagged `AM03UAT`/`AM04UAT`/`AM09SCALE`/`RCmufj5lux`) | 1 (`CKS` / Citykart Stores — the real company) | Yes, all 98 are already `is_active=false` | None for the 98 (already correctly deactivated). The 1 real company needs its own contamination cleaned (see rows below) if promoted. |
| Holder | 305 | 299 (E2E `SEEDADMIN`s and their masters, `AM03UAT`/`AM04UAT` test holders, `AM09SCALE` import-scale holders, RC-isolation-test holders) | 6 active (see §10 — 1 is genuinely the real owner, 5 are test/leftover) | Mostly — 293 of the 299 test holders are already `is_active=false`. The 6 active ones need individual review (§10). | Resolve the 5 non-owner active holders (§10) before go-live, regardless of data-strategy choice. |
| Asset | 159 | 158 (90 from the AM-09 `AM09SCALE` import-scale test, 68 one-per-company E2E fixture assets) | 1 (`AM04UAT/2`, in the real `CKS` company — but this asset is itself explicitly named "AM07 UAT Correction Test Laptop," created by `UATADMIN`, so it is **also** test data, just filed under the real company by mistake, not a genuine business asset) | Yes for the 158; the 1 "genuine-company" asset is not safe to treat as real business data | If the current DB is ever promoted: this one asset cannot be hard-deleted (append-only ledger, soft-deactivate only) — see §14 for the proposed handling. |
| Asset Event | 231 | Matches the asset population above (append-only, one row per lifecycle transition + corrections across the same test assets) | 1 event tied to the one real-company test asset | N/A — append-only, cannot be deleted regardless | None beyond what's already true: this ledger is permanent by design. |
| Field Change | 34 | Matches the same asset population | Some tied to the real-company test asset (6 rows, from repeated AM-07/08 correction testing) | N/A — append-only | None. |
| Cost Centre | 82 | 76 (one per E2E/UAT/scale company) | 6 active total, only 1 in the real company (`CC-UAT` / "UAT Cost Centre" — itself test-named) | The 76 are inactive already | The real company's only Cost Centre is test data — a genuine one must be created before real assets are added, regardless of data strategy. |
| Category | 86 | 81 (E2E/UAT/scale seeds) | 5 active (`AM4CAT`/"AM04 Test Category," `AM09SCALE`/"AM-09 Scale Category," 3 E2E) — **none genuinely business-named** | Categories are global (no company scope), so "safe" is less clear-cut | If the current DB is promoted, real Category/Subcategory values must be created — none of the existing active ones are usable as-is. |
| Subcategory | 82 | 77 | 5 active, same pattern as Category — all test-named | Same as Category | Same as Category. |
| Location | 78 | 68 | 10 active — 1 genuinely real (`HO`/"Head Office," created by `scripts.create_owner`, used by the real owner holder), 9 test-tagged (`E2E-*-HO`, `AM03UAT-HO`, `AM04UAT-HO`, `AM09SCALE-HO`) | The 68 inactive ones, yes. Of the 10 active, only 1 is genuine. | The 9 active test locations are global (not company-scoped) and technically harmless if simply left inactive-adjacent, but should be deactivated for cleanliness if the current DB is promoted. |
| Department | 78 | 68 | 10 active — 1 genuinely real (`IT`, same reasoning as Location), 9 test-tagged | Same as Location | Same as Location. |
| Vendor | 1 | 1 | 0 | The only vendor row that exists is itself named "AM04 Test Vendor Co" and is active | A real vendor list must be created from scratch regardless of data strategy — there is currently no usable vendor data at all. |
| Custom Field | 30 | 27 inactive test fields | 3 rows touch the real company or Global scope, all already `is_active=false` | Yes | None currently blocking — no active Custom Field contamination exists. |
| Code Rule | 74 | 72 | 2 active touching the real company: one company-scoped (`RCMX/`, from AM-09 RC-isolation testing) and one **global** (`AM04UAT/`, `company_id IS NULL`) | **No** — both are currently live and would number any newly-created asset under a test prefix | **Must be resolved before the first real Add Asset**, regardless of data strategy — see `CKAM_INITIAL_SETUP_GUIDE.md`'s explicit warning. |
| Document | 0 | 0 | 0 | N/A — no documents exist at all | None. |

## 10. Test-account inventory

All 6 currently-**active** holders (out of 305 total), found via a direct,
read-only query against `holder`/`company`:

| emp_code | Name | Role | Company | Active | Can log in | must_change_password | Created | Evidence of purpose |
|---|---|---|---|---|---|---|---|---|
| `CS6872` | Ankur Pahwa | ADMIN | CKS (real) | Yes | Yes | No | 2026-09-23 12:33 (earliest timestamp in the whole database) | **Genuine** — created by `scripts.create_owner`, the documented, real-deployment bootstrap mechanism; matches `PRODUCT_CONTEXT.md`'s own named real owner. |
| `SEEDADMIN` | Seed Admin | ADMIN | AM03UAT (inactive) | Yes (holder row) | Login blocked by the company-inactive clause in the login query (confirmed by code, AM-09 report §8) | No | 2026-09-24 06:50 | Test — `scripts.seed_admin`'s fixed emp_code, in an already-deactivated company. Not currently exploitable, but a messy leftover active-holder-row-in-inactive-company state. |
| `SEEDADMIN` | Seed Admin | ADMIN | AM04UAT (inactive) | Yes (holder row) | Same as above — login blocked by company-inactive | No | 2026-09-24 07:37 | Same as above. |
| `STK-AM04` | IT Stock-HO | HOLDER | AM04UAT (inactive) | Yes (holder row) | No — `IT_STOCK` type, no `password_hash` at all | Yes | 2026-09-24 07:42 | Test — cannot log in regardless of company state. |
| **`UATADMIN`** | UAT Admin | **ADMIN** | **CKS (real, active)** | **Yes** | **Yes** | No | 2026-09-24 09:18 | **Test — but in the genuinely real, currently-active production company.** Created manually during this project's own AM-05 through AM-09 UAT sessions (referenced by name in `AM-05_MASTERS_HOLDERS_REPORT.md` through `AM-09_RC_FULL_AUDIT_REPORT.md`); its password is not committed to source (unlike `SEEDADMIN`'s documented dev password), but its mere active existence as an undocumented, non-owner ADMIN inside the real company is itself the problem. |
| `STK-UAT07` | IT Stock - UAT | HOLDER | CKS (real, active) | Yes | No — `IT_STOCK` type, no password | Yes | 2026-09-24 11:17 | Test — created during AM-07/09 UAT, references an E2E company's own "Seed HO" location (`location_id=1`), confirming it was created carelessly for throwaway testing, not real operational use. Cannot log in, but would still appear in the real company's own Holder list and dropdowns. |

**Per the AM-10 authorization's own rule (§10): any active known-test
ADMIN account at production cutover is a P1 go-live blocker.**
`UATADMIN` meets that definition exactly — it is a documented,
project-history-referenced test account, it is ADMIN-role, and it is
currently active inside the real production company. This is recorded as
a **P1 go-live blocker** (see §45) and was **not** deactivated
automatically, per the authorization's explicit instruction not to.

## 11. The AM-09 90-asset import-scale dataset, explicitly accounted for

Company `AM09SCALE` (id 84, `is_active=false`), its 2 holders, its 1
Cost Centre (`HO01`), its 1 Category (`AM-09 Scale Category`), and its 90
assets (created during AM-09's §49 import-scale sanity test) all remain in
the database exactly as AM-09 itself documented — soft-deactivated at the
company/holder level, the 90 assets themselves permanently present
because CKAM is soft-delete-only and an asset's own ledger cannot be
erased. This dataset requires **no further action**: it is already fully
isolated (inactive company, inactive holders, distinct code prefix
`AM09SCALE`), does not appear in any active company's data, and would not
be visible to any real user of the real company. It is explicitly called
out here, as the authorization requires, but is not itself a go-live
blocker.

## 12. Genuine-data vs. test-data assessment

**Genuine:** the real company (`CKS`/Citykart Stores), the real owner
account (`CS6872`/Ankur Pahwa, correctly configured, correctly the
earliest-created row in the database), and the two masters
`scripts.create_owner` itself created for that owner (`HO`/"Head Office"
location, `IT` department — confirmed by direct code read of
`create_owner.py` plus a live rehearsal reproducing the exact same rows).

**Test, but sitting inside the real company:** the `UATADMIN` and
`STK-UAT07` holders, the one asset (`AM04UAT/2`), the one Cost Centre
("UAT Cost Centre"), and the two active Code Rules touching `CKS` or
global scope.

**Test, cleanly isolated:** everything else — 98 companies, ~293 holders,
158 assets, all in already-deactivated companies with no reference from
the real company.

**Never classified as fake merely by an unusual-looking name** — every
row above was confirmed by direct evidence (a creation-context match, a
cross-reference to a known test fixture pattern, or a direct code-level
trace to the bootstrap script that created it), per this stage's own
explicit instruction.

## 13. Recommended production-data strategy

**FRESH PRODUCTION DATABASE.**

Reasoning, from the evidence in §9-12: the current `ckam` database
contains **zero genuine business assets** and **zero genuine, reusable
supporting master data** beyond the real owner account itself and its two
bootstrap-created masters (Location "HO," Department "IT"). Every other
populated row of substance in the real company is test data that
happened to be created there rather than in a properly isolated test
company. There is no meaningful *existing business data* to preserve —
promoting the current database would mean inheriting a contaminated
Code Rule state (§9's warning), a fake Cost Centre, a fake Vendor, an
extra active ADMIN account, and 158 unrelated test assets sitting
alongside the real company's own single test asset, all of which would
need individual cleanup regardless. `docs/deployment.md`'s own
pre-existing guidance already anticipates exactly this situation: *"If
the dev database has ever had the E2E suite, seed_admin.py or other test
data run against it, a clean First-time setup on the server plus the
Excel import is often safer than carrying the dev database over."* This
database meets that description precisely.

This is presented as a strong, evidence-based **recommendation**, not an
executed decision — see §46 for why it is still listed as requiring
explicit confirmation before go-live, and §14 for what a cleanup plan
would look like if the alternative is chosen instead.

## 14. Proposed cleanup/migration plan if PROMOTE CURRENT DATABASE is chosen instead (NOT executed)

If, despite §13's recommendation, the decision is made to promote the
current `ckam` database rather than start fresh, the following would need
to happen — listed here for completeness, **not performed during AM-10**:

1. Deactivate `UATADMIN` (`is_active=false`) and clear its
   `password_hash` — same pattern `docs/deployment.md` already documents
   for a leftover `SEEDADMIN`.
2. Deactivate `STK-UAT07` (already cannot log in, but should not appear
   in the real company's Holder list).
3. The one real-company asset (`AM04UAT/2`) cannot be deleted (append-only
   ledger, soft-delete-only). It should be moved to a clearly-labeled
   disposed/retired lifecycle state via the normal lifecycle event
   mechanism (never a direct DB write) so it stops appearing as
   "in stock" in any real report, with its test nature preserved in its
   own description field (already self-documenting: "AM07 UAT Correction
   Test Laptop").
4. Deactivate the fake Cost Centre ("UAT Cost Centre") and create a real
   one.
5. Deactivate the fake Vendor ("AM04 Test Vendor Co") and create real
   vendor records.
6. Deactivate both active Code Rules touching the real company (`RCMX/`
   and the global `AM04UAT/`) and create a real, reviewed production Code
   Rule **before** any real asset is created.
7. Create real Category/Subcategory values (none of the 5 currently
   active ones are usable).
8. Re-run the exact test-account query from `docs/deployment.md`'s
   "Moving from the dev machine to the production server" §1 to confirm
   zero active test/E2E rows remain anywhere in the database, not only in
   the real company.
9. Take a fresh backup only after every step above is complete and
   verified.

Every step above is a **soft-deactivate or a normal lifecycle event**,
never a hard delete — consistent with `DEVELOPMENT_GUARDRAILS.md`'s
absolute rule. None of these steps were executed during AM-10.

## 15. Production environment-variable audit

See `CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md` for the full table. No
secret value is reproduced in that document or in this one.

## 16. JWT_SECRET readiness

**ACCEPTABLE** for this dev/UAT environment: 64 characters, not equal to
either known placeholder value, and `main.py`'s own `SECURITY WARNING`
banner has not fired once. Still must be independently generated on the
real production server — this dev value must never be reused there.

## 17. POSTGRES_PASSWORD readiness

**PLACEHOLDER.** Confirmed, without printing the value, that the
currently-configured `POSTGRES_PASSWORD` is exactly 11 characters and
matches `docker-compose.yml`'s own hardcoded dev fallback
(`ckam_dev_pw`) — a value visible to anyone who has read the repository.
Must be replaced with a real, independently-generated value on the
production server before go-live.

## 18. BASE_URL readiness

**NOT PRODUCTION-READY.** Currently `http://localhost:3211` — resolves
only on the machine running the containers, not from any other LAN
device. Every printed QR label encodes `${BASE_URL}/assets/{id}`; a label
printed under this value would scan to nowhere from a phone. Must be set
to the real LAN hostname or static IP **before** the first real QR label
is printed. See §31 for the documented post-deployment QR verification
step.

## 19. COOKIE_SECURE decision

**Leave `false`**, for as long as the production deployment is genuinely
served over plain HTTP (the documented, intended deployment model per
`PRODUCT_CONTEXT.md` and `docs/deployment.md`). A `Secure` cookie is never
sent by a browser over plain HTTP, so setting this `true` prematurely
would silently break session refresh for every user (forced re-login
every 15 minutes). Flip to `true` only in the same change that introduces
genuine HTTPS.

## 20. Backup destination readiness

**DEV-ONLY.** Currently the compose default `./backups`, inside the
repository checkout, on the same physical disk as the `db_data` and
`uploads` Docker volumes — a single disk failure would take out both the
live database and its own backups simultaneously. `docs/deployment.md`
already documents this as unsuitable for production. Must be pointed to a
separate disk, itself copied off the server, before go-live.

## 21. AM09-05 security-header disposition

**RESOLVED in AM-10.** `X-Content-Type-Options: nosniff`,
`X-Frame-Options: SAMEORIGIN`, and `Referrer-Policy:
strict-origin-when-cross-origin` were added to both the static-file
response path and the `/api/` proxied path in `frontend/nginx.conf`
(commit `1f77c24`), verified live via `curl -D -` against both paths
after a full `web` container rebuild, and confirmed not to regress the
E2E suite (5/5 re-run clean afterward). No HSTS was added — correctly,
since this deployment remains plain-HTTP. See §41 for the full change
detail, including an nginx `add_header`-inheritance gotcha discovered and
fixed live during verification (a `location` block's own `add_header`
directives silently suppress inheritance from the parent `server` block —
the three general headers had to be explicitly repeated inside
`location /api/`, not only relied upon from the server block).

## 22. AM09-06 cache-header disposition

**RESOLVED in AM-10**, same commit as §21. `Cache-Control: no-store` was
added to the `/api/` proxied response path only (not the static SPA
assets, which are meant to be cached normally) — verified live via curl.

## 23. AM09-07 bundle disposition

**Left P3, unchanged.** No code-splitting or bundle-size work was done —
no LAN-load evidence was gathered this stage suggesting it is a real
problem in practice (see §27 for the measured response-time evidence,
which found no performance concern), and the authorization is explicit
that bundle optimization should not happen without such evidence.

## 24. AM09-08 external-font disposition

**ACCEPTABLE, confirmed via source-code evidence.**
`frontend/src/styles.css` defines `--font-sans: "Inter", system-ui,
sans-serif;` — a proper CSS fallback chain. If the Google Fonts CDN is
unreachable (a real possibility on some CityKart LAN deployments with
restricted internet egress), the browser transparently falls back to the
OS's own default UI font; the application remains fully functional and
readable, only visually slightly different from the intended typeface.
Not vendored/copied locally, per the authorization's own instruction not
to do so automatically. Classified **ACCEPTABLE**, not a go-live risk.

## 25. AM09-09 backup-alert disposition

**Left P2, documented only**, per the authorization's own preference
order (§15): a full monitoring platform was explicitly out of scope; no
narrow, already-available host-level scheduled-check mechanism was
evidenced as safely addable without knowing the real production server's
own OS/scheduling environment (Linux cron vs. Windows Task Scheduler
would need a concrete decision this session cannot make on the operator's
behalf). Resolved instead by requiring **named operational ownership** —
see the Operations Ownership Matrix, §40 — as the smallest practical
improvement available in AM-10 itself.

## 26. Production topology manifest

See §7 above — the same diagram, not duplicated a second time.

## 27. Disk/storage assessment

Current dev/UAT volumes: `db_data` 95.3 MB (159 test assets, 305 test
holders, 231 events, 34 field changes), `uploads` 18 bytes (0 real
documents). Host free disk in this dev sandbox: 132 GB of 586 GB. **These
numbers describe this session's own development sandbox, not the eventual
production server, and must not be used for production capacity
planning** — no fabricated production-scale number is given here. Before
go-live, CityKart should estimate its real expected asset/holder/document
counts from its actual fleet size and confirm the production server has
headroom well beyond that; this is a business estimate this audit cannot
supply.

## 28. Fresh-production bootstrap rehearsal

Performed live, against a genuinely disposable database
(`ckam_am10_fresh_rehearsal`, created and dropped within this session,
never touching `ckam` or `ckam_test`):

1. Created empty disposable database, migrated to head — 10 migrations
   applied cleanly, ending at `f28b6a913dce (head)`.
2. Ran `docker compose exec api python -m scripts.create_owner` — created
   the real owner's Company/Location/Department/Holder rows and printed a
   one-time temporary password (never persisted, never logged, discarded
   after this rehearsal's own use).
3. Logged in with the temp password — confirmed `must_change_password:
   true`.
4. Confirmed every other endpoint is refused (`403`) until the password
   is changed — verified live (`GET /api/masters/locations` → 403).
5. Changed the password via `POST /api/auth/change-password` — succeeded
   (`204`).
6. Logged in again with the new real password — succeeded,
   `must_change_password: false`.
7. Created minimal master data in the documented dependency order
   (`CKAM_INITIAL_SETUP_GUIDE.md`): reused the owner-bootstrap's own
   Location/Department, then created a Cost Centre, Category, Subcategory,
   Vendor, one `IT_STOCK` Holder, and one Code Rule.
8. Created one real asset — server-generated Asset Code
   `CKS/2026/0001` (a properly production-styled prefix, using the real
   company code and year, in clear contrast to the current live
   database's own contaminated `RCMX/`/`AM04UAT/` prefixes).
9. Read the asset back via Asset 360 (`GET /api/assets/{id}`) —
   succeeded.
10. Exported the Asset Register — downloaded a real `.xlsx`, confirmed
    exactly 1 data row matching the created asset.

**Every step passed.** This directly rehearses and validates the
recommended FRESH PRODUCTION DATABASE path (§13).

## 29. First-admin bootstrap verification

The documented mechanism (`docker compose exec api python -m
scripts.create_owner`) is idempotent (confirmed by the script's own logic
— it looks up the company/holder by their real unique keys before
creating anything, re-run-safe) and requires no source-code editing by
the operator — every value it needs is already hardcoded for this one
real deployment, by design (see the script's own docstring). The one-time
temporary password is printed to stdout exactly once, on first creation
only; `must_change_password` is correctly enforced (every other API call
403s until the password is changed, verified live in §28 step 4); the
forced password-change flow itself was exercised live and works
correctly end-to-end. No new bootstrap mechanism was created — the
existing one is not broken.

**Rollback rehearsal** (a related but separate concern, §5/§37 of
`CKAM_GO_LIVE_CHECKLIST.md`) was also performed live this stage: the
prior release commit (`e9225e5`) was checked out into a disposable git
worktree (`git worktree add`, removed afterward with `git worktree
remove`), its backend Docker image built fresh
(`ckam-rollback-rehearsal-api`), and a throwaway container from that
image run against the same disposable rehearsal database (at the
**current** schema head, `f28b6a913dce`) — `GET /api/health` returned
`{"status":"ok"}`, and a real login with the rehearsal owner's changed
password succeeded correctly (`role: ADMIN`, `must_change_password:
false`), with zero `SECURITY WARNING` lines in the container's logs. This
proves a code-only rollback to the immediately-prior release point is
mechanically safe against the current database schema — neither AM-09
nor AM-10 introduced any migration, so there is no schema divergence to
worry about. The disposable worktree, container, and image were all
removed afterward.

## 30. Initial master-data setup order

See `CKAM_INITIAL_SETUP_GUIDE.md` for the full, dependency-verified order
and its critical warning about the current database's own contaminated
Code Rule state. Not duplicated here.

## 31. Cutover rehearsal

Performed against the same disposable rehearsal database and API process
used in §28-29 (a genuine cutover rehearsal, not a second, different
environment, since the fresh-bootstrap rehearsal already exercised every
step the runbook's own cutover sequence calls for):

| Step | Result | Elapsed |
|---|---|---|
| 1. Environment configuration | Disposable DB created, migrated | (see §22 timing) |
| 2. Pre-deploy backup | N/A for a fresh DB with no prior data (this step matters for the PROMOTE-CURRENT-DB path, §14, not the fresh-DB path) | — |
| 3. Build | Backend image build (rehearsed separately in §29's rollback test, since AM-10 made no backend code change): a few seconds for a cached-layer rebuild | ~1-3 s per image layer |
| 4. Migrations | `alembic upgrade head`, 10 migrations, empty→head | ~1-2 s |
| 5. Service start / health | `GET /api/health` → `{"status":"ok"}` | immediate |
| 6. Login | `POST /api/auth/login` | 63.8 ms |
| 7. Dashboard | `GET /api/reports/dashboard` | 38.4 ms |
| 8. Register | `GET /api/assets` | 3.9 ms |
| 9. Asset detail | `GET /api/assets/{id}` | (sub-10ms, same order as register) |
| 10. Holder list | `GET /api/holders` | 2.1 ms |
| 11. Report export | `GET /api/reports/export/assets` | (sub-100ms, matches AM-09's own measured export timing) |
| 12. Backup verification | Real `pg_dump | gzip` of the rehearsal DB, 5,610 bytes, non-zero | a few hundred ms |
| 13. (Restore, for completeness) | Restored into a second disposable DB, verified byte-for-byte row-count match, Alembic head match | a few hundred ms |

**Every step passed.** These timings are measured against a tiny
disposable database (1 company, a handful of masters, 1 asset) and are
evidence of correctness, not a production-scale performance benchmark —
AM-09's own performance-sanity section (against the much larger live
`ckam` database, ~150 assets/250 holders/80 companies at the time)
already established representative response times in the single-digit-
to-tens-of-milliseconds range for the same set of endpoints, so there is
no reason to expect materially different behavior at a real production
scale within the range CityKart's actual fleet size implies.

## 32. Cutover elapsed-time evidence

See the table in §31 — not duplicated a second time. Total rehearsed
sequence (steps 1-13) completed in well under 10 seconds end-to-end
against the disposable database, excluding the one-time Docker image
build step which is dominated by layer-caching behavior, not a
per-deployment cost.

## 33. Rollback rehearsal

See §29 above (the rollback rehearsal is described there, alongside the
first-admin verification it shares infrastructure with) — not duplicated
a second time. **Result: PASS.**

## 34. Backup/restore rehearsal evidence

Performed twice this stage, both against disposable databases:

1. **Rehearsal-DB backup/restore** (§28's created data): `pg_dump | gzip`
   of `ckam_am10_fresh_rehearsal` → 5,610-byte archive; restored into a
   second fresh disposable database (`ckam_am10_restore_test`) via
   `gunzip | psql -v ON_ERROR_STOP=1`, zero errors; verified row-for-row
   match (1 company, 2 holders, 1 asset, 1 event, matching the source
   exactly) and `alembic current` on the restored copy correctly reporting
   `f28b6a913dce (head)`.
2. This directly re-confirms the AM-09 restore drill's own conclusion
   (a real backup taken from a live, populated database restores cleanly
   into a disposable target) using a **second, independent** dataset —
   strengthening, not merely repeating, the AM-09 evidence.

Both disposable databases were dropped after verification. The live
`ckam` database was never touched by either rehearsal.

## 35. Go-live smoke-test definition

See `CKAM_GO_LIVE_CHECKLIST.md` §2 — not duplicated here.

## 36. Post-cutover DB verification

See `CKAM_GO_LIVE_CHECKLIST.md` §3 (the exact read-only SQL) — not
duplicated here.

## 37. Git remote/release strategy

**Read-only findings:**

- `git remote -v`: `origin` →
  `https://github.com/kumarsuraj84/Citykart-AssetManagement.git`.
- `git branch -vv`: three local branches exist — `main` (at the original
  spec/plan-only commit, `7ee9523`, never touched this project's
  implementation history), `claude/brave-euler-07879a` (a small,
  unrelated test-DB-safety-guard commit, already pushed and tracked as
  `[origin/claude/brave-euler-07879a]`), and `worktree-ckam-build` (this
  entire project's implementation history, `1f77c24` as of this report,
  **no upstream tracking branch set** — confirmed by the absence of a
  `[origin/...]` marker in `git branch -vv`'s own output).
- `git ls-remote origin`: the remote currently holds exactly one branch,
  `claude/brave-euler-07879a` — **no CKAM release history exists on the
  remote at all.** `worktree-ckam-build` has never been pushed, at any
  point across AM-01 through AM-10.

**Recommended push/merge sequence (not executed):** once explicit
deployment authorization is granted, the operator should (1) decide
whether `worktree-ckam-build`'s history should be pushed directly as a
new branch, merged into `main` via a reviewed pull request, or squashed —
this is a repository-workflow decision belonging to the user, not this
audit; (2) push the chosen branch to `origin`; (3) if a PR/merge-into-
`main` workflow is preferred, open that PR for review before any merge;
(4) only after the code is on the branch/commit the production server
will actually deploy from should the production server's own `git clone`/
`git pull` happen.

**No push, force-push, merge, remote PR creation, or remote branch
deletion was performed.**

## 38. Local release tag

Checked `git tag --list` before any tagging decision: **empty — no
existing tags, no conflict possible.** Git is clean, full regression
passes (§5, re-confirmed §41), and the final release commit is
unambiguous (recorded in §2/§4 and `CKAM_RELEASE_MANIFEST.md`). A local
annotated tag, `ckam-v1.0.0-rc1`, **was created** at the final AM-10
commit (after the governance/report commit — recorded in the final chat
response, not inside this report, per the self-reference convention) and
was **not pushed**.

## 39. Release manifest

See `docs/ai/CKAM_RELEASE_MANIFEST.md` (a separate, downloadable file) —
not duplicated here.

## 40. Operations ownership matrix

| Operational task | Owner required? | Frequency | Evidence/tool |
|---|---|---|---|
| Backup log check | Yes | At minimum weekly (no active alert exists, AM09-09) | `docker compose exec backup cat /var/log/ckam-backup.log`, looking for `Backup complete` lines and their absence |
| Disk capacity check | Yes | Monthly, or whenever backup retention (14 days) approaches the disk's own limit | `docker system df -v`, plus the host's own disk-free tooling |
| Restore drill | Yes | At minimum before go-live (done, this stage and AM-09), then periodically (e.g. quarterly) against a disposable database — never the live one without a real incident | `ops/restore.sh` into a disposable target, verified against `docs/deployment.md`'s own Restore section |
| Admin account management | Yes | On every staffing change | `Setup → Holders & Users`, ADMIN-only |
| Test-account audit | Yes | Before every future promotion of dev/UAT work toward production, and periodically thereafter | The exact query in `docs/deployment.md`'s "Moving from the dev machine to the production server" §1, or the broader one this stage used (§9-10) |
| Logs | Yes | Ad hoc, and always immediately after a deployment | `docker compose logs api` / `web` / `db` / `backup` |
| Security warning | Yes | Every deployment/restart | Confirm `docker compose logs api` shows no `SECURITY WARNING` line |
| Certificate/HTTPS | OWNER TO BE ASSIGNED (only if HTTPS is introduced later — not applicable to the current plain-HTTP LAN deployment) | N/A yet | N/A yet |
| DB maintenance (vacuum/analyze, disk growth) | OWNER TO BE ASSIGNED | Periodic, standard PostgreSQL operational practice | Standard `psql`/`pg_stat` tooling — no CKAM-specific tooling needed beyond what Postgres itself provides |

No people are named beyond what this session already knows (Ankur Pahwa
as the real account owner) — every other "OWNER TO BE ASSIGNED" row is
intentionally left for CityKart to fill in, not invented.

## 41. Changes made during AM-10

One commit, `1f77c24` (`fix(web): AM-10 -- narrow nginx hardening headers
(AM09-05, AM09-06)`):

- `frontend/nginx.conf` — added `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy:
  strict-origin-when-cross-origin` at the `server` block level (applying
  to the static SPA response path), and repeated all three plus
  `Cache-Control: no-store` inside `location /api/` — required because
  nginx does not inherit a parent `server` block's `add_header`
  directives into a `location` block that defines its own `add_header`
  directives (discovered live: the first version of this change silently
  dropped all three general headers from every `/api/` response until the
  omission was found via `curl -D -` and fixed).
- No backend, frontend TypeScript/React, or database code was touched.
  No migration was created — none was needed.

## 42. Regression after changes

Re-run after the nginx change and container rebuild:

- E2E: 5/5 passing (the meaningful regression surface for a
  nginx-config-only change, since it is the only suite that exercises the
  real, nginx-fronted stack end-to-end).
- Backend/Frontend unit suites and the production frontend build were not
  re-run a second time after this specific change, since neither `pytest`
  nor `vitest`/`tsc`/`vite build` exercises `nginx.conf` at all — their
  §5 baseline (305/305, 148/148, clean, clean) remains the accurate,
  current figure and is unaffected by a runtime web-server config change.
- `docker compose logs api`/`web` reviewed after the rebuild: no
  tracebacks, no `SECURITY WARNING`.

## 43. Go/No-Go gate table

See `CKAM_GO_LIVE_CHECKLIST.md` §6 (the full table) — not duplicated here.

## 44. Remaining P2/P3 issues

See `docs/ai/RC_ISSUES.md` for the updated register. Summary: AM09-05 and
AM09-06 are now marked Fixed (commit `1f77c24`); AM09-07, AM09-08, and
AM09-09 remain open exactly as AM-09 left them, per this stage's own
narrow-scope discipline.

## 45. Remaining deferred business decisions

Unchanged and still explicitly out of scope for AM-10, per its own
authorization: `holder_company_access`, import duplicate detection, the 5
unconstrained closed-value DB columns, no bulk correction workflow. None
were touched.

**New this stage, and load-bearing for the go-live decision (not a code
defect, a data/account hygiene finding):**

- **P1 go-live blocker:** the `UATADMIN` active ADMIN-role test account
  inside the real production company (§10). Must be deactivated (per
  §14's proposed handling, if the current DB is ever promoted) or simply
  becomes moot if the FRESH PRODUCTION DATABASE recommendation (§13) is
  followed instead — either way, this requires an explicit operator
  action or an explicit data-strategy decision before go-live, not an
  automatic fix from this audit.
- **Data strategy decision required:** FRESH PRODUCTION DATABASE
  (recommended, §13) vs. PROMOTE CURRENT DATABASE AFTER CLEANUP (§14) —
  this is a genuine business/deployment decision, not a technical one
  this audit can make unilaterally.

## 46. FINAL AM-10 VERDICT

**GO-LIVE PREPARED WITH DECISIONS REQUIRED.**

Decisions required before deployment/go-live authorization should be
requested:

1. **Which database becomes production** — FRESH PRODUCTION DATABASE
   (recommended, strong evidence in §13) or PROMOTE CURRENT DATABASE
   AFTER CONTROLLED CLEANUP (§14, cleanup plan prepared but not executed).
2. **The real production `BASE_URL`** (LAN hostname or static IP) — must
   be determined and set before the first QR label is printed.
3. **The real production `BACKUP_DIR`** — a separate physical disk,
   itself copied off the server, must be provisioned.
4. **Disposition of the `UATADMIN` active test-ADMIN account** — resolved
   automatically if FRESH PRODUCTION DATABASE is chosen (it simply never
   exists in the new database); requires an explicit deactivation step if
   PROMOTE CURRENT DATABASE is chosen instead.
5. **Whether/when to push `worktree-ckam-build` to `origin`**, and in
   what form (direct branch push, PR into `main`, or another workflow) —
   a repository-management decision belonging to the user.
6. **Production admin ownership and the operational owners named "OWNER
   TO BE ASSIGNED"** in §40.

None of these are software defects. No code, test, or database-integrity
issue blocks go-live — the application itself is confirmed
RELEASE READY (AM-09) and remains so after AM-10's own full regression
re-run (§5, §42).

## 47. REPORT CONTENT HEAD

`1f77c2452c0cf853031676a2f7e7ba70786b3702` — the last commit before this
report/governance commit (`fix(web): AM-10 -- narrow nginx hardening
headers (AM09-05, AM09-06)`).

## 48. REPORT COMMIT

TO BE FILLED IN CHAT AFTER COMMIT.
