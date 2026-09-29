# Asset User / RBAC / Responsibility Rebuild — Preflight Audit

**Date:** 2026-09-29
**Starting HEAD:** `ce7b3ff6601cb54250ca6258cfe5b8e513d00c5a` (branch `worktree-ckam-build`)
**Environment audited:** local dev Docker Compose stack (`ckam` database). Production (`10.0.1.12`) was NOT accessed.
**Scope:** read-only Phase A audit only. No code or schema changed by this document.

This rebuild supersedes `DECISIONS.md` entry #16.2 ("single current-holder/custody
concept... holder types EMPLOYEE/STORE/INSTALLED/IT_STOCK... locked for V1") and
entry #12.5/#12.9 (IT_TEAM/HOLDER role authorization rules). It does **not** touch
Serial Number validation (`DECISIONS.md` entry #1), which remains untouched and
out of scope for this rebuild.

---

## 1. Current AssetUser table/model (already renamed from Holder)

The Holder→AssetUser entity rename (table, columns, routes, frontend) was
completed in the prior session, commit `ce7b3ff`. **This rebuild starts from
`AssetUser`, not `Holder`.** What remains is the role/type *value* migration and
the new domain/responsibility layer described below.

`backend/app/asset_users/models.py` (verbatim):

```python
ASSET_USER_TYPES = ("EMPLOYEE", "STORE", "INSTALLED", "IT_STOCK")
ROLES = ("ADMIN", "IT_TEAM", "VIEWER", "ASSET_USER")

class AssetUser(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "asset_user"
    __table_args__ = (UniqueConstraint("company_id", "emp_code"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    emp_code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    asset_user_type: Mapped[str] = mapped_column(String(20))
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("location.id"))
    department_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("department.id"))
    email: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(30))
    password_hash: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="ASSET_USER")
    must_change_password: Mapped[bool] = mapped_column(default=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class AssetUserCompanyAccess(Base):
    __tablename__ = "asset_user_company_access"
    asset_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_user.id"), primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"), primary_key=True)
```

**Login is already optional per-row** — `email`/`password_hash` are nullable, and
`auth/router.py`'s login query already filters `password_hash IS NOT NULL` before
matching. There's no explicit `login_enabled` boolean today; login-capability is
implicit (`password_hash IS NOT NULL`). This is a good foundation for §10's
explicit `login_enabled` flag — it formalizes what's already the de facto rule
rather than introducing new behavior.

## 2. All FK references to asset_user (live DB, `\d asset_user` "Referenced by")

`asset_category`, `asset` (`current_asset_user_id`, `created_by`, `updated_by`),
`asset_document` (`uploaded_by`), `asset_event` (`from_asset_user_id`,
`to_asset_user_id`, `recorded_by`), `asset_field_change` (`actor_id`),
`asset_subcategory`, `company`, `cost_center`, `custom_field`, `department`,
`asset_user_company_access`, `asset_user` (self, `created_by`/`updated_by`),
`location`, `pending_asset` (`initial_asset_user_id`, `delivered_by`,
`created_by`, `updated_by`), `purchase_order`, `vendor`.

**Known cosmetic drift (not a migration blocker):** the underlying Postgres
constraint/index/FK **names** still say `holder` (e.g. `holder_pkey`,
`holder_company_id_emp_code_key`, `asset_event_from_holder_id_fkey`,
`pending_asset_initial_holder_id_fkey`) even though the table/columns are
already `asset_user`/`*_asset_user_id`. `ALTER TABLE RENAME` preserves the
constraint but not its name. This rebuild's migration will rename these
constraint names too while it has the table open for the role/type CHECK
changes, since it's the same class of change.

## 3. Current roles and row counts (live dev DB)

```
 role  | count
-------+-------
 ADMIN |     1
```
Only one real `asset_user` row exists: `id=1, emp_code=CS6872, name=Ankur Pahwa, asset_user_type=EMPLOYEE, role=ADMIN, company_id=2`.
No `IT_TEAM`, `VIEWER`, or `ASSET_USER`-role rows exist in this environment.

## 4. Current asset_user_type and row counts

```
 asset_user_type | count
-----------------+-------
 EMPLOYEE        |     1
```
No `STORE`, `INSTALLED`, or `IT_STOCK` rows exist yet.

## 5. IT_TEAM users: **0**
## 6. HOLDER-role users: **0** (role value `HOLDER` was already migrated to `ASSET_USER` by the prior rename's data migration)
## 7. IT_STOCK asset_user records: **0**
## 8. Company access records (`asset_user_company_access`): **0**

## 9. Category inventory (table is `asset_category`, not `category`)

```
 id | code |     name
----+------+--------------
  1 | ITHW | IT HW Assets
  2 | ITSW | IT SW Assets
```
Both existing categories are unambiguously **IT** by name. No `NON_IT` category
exists yet in this environment — there is nothing ambiguous to classify right
now, but the classification mechanism (§17/§41 of the spec) must still be built
generically since real CityKart data will include Admin/Non-IT categories
(Gondola, Fixture, Chair, etc.) once seeded for real use.

## 10. Current external/internal `/holders` API consumers

**Zero.** Confirmed via full-repo grep (`backend/app`, `backend/tests`,
`frontend/src`, `frontend/e2e`): no live code references `/api/holders` or
`/holders`. Every surviving reference is in historical, non-shipping locations
(`docs/specs/`, `docs/superpowers/plans/`, the dated `docs/ai/AM-*` report
trail, `.superpowers/sdd/` scratch artifacts) — expected and left untouched per
the "do not rewrite historical reports" rule. **No external system dependency
found; safe to proceed with the role/type rename with no compatibility alias.**

## 11. Proposed exact rename map

### Role values (CHECK constraint `ck_asset_user_role`, currently `('ADMIN','IT_TEAM','VIEWER','ASSET_USER')`)
| Old | New | Data migration |
|---|---|---|
| `ADMIN` | `ADMIN` | unchanged |
| `IT_TEAM` | `OPERATOR` | `UPDATE asset_user SET role='OPERATOR' WHERE role='IT_TEAM'` (0 rows today) |
| `VIEWER` | `VIEWER` | unchanged |
| `ASSET_USER` | `SELF_SERVICE` | `UPDATE asset_user SET role='SELF_SERVICE' WHERE role='ASSET_USER'` (0 rows today) |

### AssetUserType values (CHECK constraint `ck_asset_user_asset_user_type`, currently `('EMPLOYEE','STORE','INSTALLED','IT_STOCK')`)
| Old | New | Data migration |
|---|---|---|
| `EMPLOYEE` | `EMPLOYEE` | unchanged |
| `STORE` | `STORE` | unchanged |
| `INSTALLED` | `INSTALLED` | unchanged |
| `IT_STOCK` | `STOCK_POINT` | `UPDATE asset_user SET asset_user_type='STOCK_POINT' WHERE asset_user_type='IT_STOCK'` (0 rows today) |

### Column rename
| Old | New |
|---|---|
| `asset_user.emp_code` | `asset_user.code` |

### New columns
| Table | Column | Type | Notes |
|---|---|---|---|
| `asset_user` | `login_enabled` | `boolean not null default false` | formalizes today's implicit `password_hash IS NOT NULL` rule; backfilled `true` where `password_hash IS NOT NULL` |
| `asset_user` | `primary_asset_domain` | `varchar(10) null` | `IT` / `NON_IT` / `ALL`, only meaningful when `login_enabled` |
| `asset_user` | `allowed_asset_domains` | `varchar(10) null` | `IT` / `NON_IT` / `BOTH`, OPERATOR/VIEWER only |
| `asset_category` | `asset_domain` | `varchar(10) not null` | `IT` / `NON_IT`, backfilled from a classification pass (both existing rows → `IT`, unambiguous) |
| `asset` | `asset_domain` | `varchar(10) not null` | snapshot, backfilled from `Category.asset_domain` at migration time (table is empty today, so purely structural) |
| `pending_asset` | `asset_domain` | `varchar(10) null` | snapshot, same source (table is empty today) |

### Constraint/index renames (cosmetic cleanup, same migration)
`holder_pkey`→`asset_user_pkey`, `holder_company_id_emp_code_key`→`asset_user_company_id_code_key`,
`holder_company_id_fkey`→`asset_user_company_id_fkey`, `holder_created_by_fkey`→`asset_user_created_by_fkey`,
`holder_department_id_fkey`→`asset_user_department_id_fkey`, `holder_location_id_fkey`→`asset_user_location_id_fkey`,
`holder_updated_by_fkey`→`asset_user_updated_by_fkey`, and the matching `*_holder_id_fkey` names on
`asset` (`asset_current_holder_id_fkey`), `asset_event` (`asset_event_from_holder_id_fkey`,
`asset_event_to_holder_id_fkey`), `pending_asset` (`pending_asset_initial_holder_id_fkey`),
`asset_user_company_access` (`holder_company_access_holder_id_fkey`).

### API path: no change needed
`/api/asset-users` already exists; no further rename required.

## 12. Migration sequence (staged, per spec §42/§55)

1. **Migration A** (additive, safe): add `login_enabled`, `primary_asset_domain`,
   `allowed_asset_domains` to `asset_user` (nullable/defaulted); add
   `asset_domain` (nullable) to `asset_category`, `asset`, `pending_asset`;
   rename `emp_code`→`code`; rename stale `holder_*` constraint/index names.
2. **Data backfill** (in the same or immediately following migration, since the
   table is nearly empty — no staged classification pass needed *this
   environment*, but the code path must handle a populated one for real
   CityKart data later): `login_enabled = (password_hash IS NOT NULL)`;
   `asset_category.asset_domain` classified (both current rows → `IT`);
   `asset.asset_domain`/`pending_asset.asset_domain` copied from their
   Category (0 rows today, so this is a no-op here but must be correct code).
3. **Migration B** (role/type value + CHECK constraint swap): update
   `ck_asset_user_role` to `('ADMIN','OPERATOR','VIEWER','SELF_SERVICE')` and
   `ck_asset_user_asset_user_type` to `('EMPLOYEE','STORE','INSTALLED','STOCK_POINT')`,
   after the `UPDATE ... SET role=...`/`asset_user_type=...` data migrations
   above run (both are 0-row no-ops today but must run in the correct order
   for a populated environment).
4. **Migration C** (enforce NOT NULL where the spec requires it, only after
   confirming no NULLs remain): `asset_category.asset_domain NOT NULL`,
   `asset.asset_domain NOT NULL`. `pending_asset.asset_domain` stays nullable
   (spec §19 doesn't require NOT NULL there since not every pending line may
   have reached delivery-time classification).

Single Alembic head required at the end (`alembic heads` must show exactly one).

## 13. Data-loss risk assessment

**Overall risk: LOW.** The live dev database is nearly empty — 1 real
`asset_user` row (ADMIN, already targets a role value, `ADMIN`, that is
unchanged by this migration), 0 `asset`, 0 `pending_asset`, 0 `asset_event`,
0 `asset_user_company_access` rows, 2 unambiguous `asset_category` rows. Every
`UPDATE`-based value migration above is a 0-row no-op in this environment.
There is no real data to lose, corrupt, or misclassify right now. The genuine
engineering risk is entirely in the **code paths** (authorization logic,
lifecycle state machine, 40-50 test files referencing old role/type literals,
~15 frontend files with role-gating logic) being correctly and completely
updated — not in the data migration itself.

**Orphan-reference checks** (asset↔asset_user, asset_event↔asset_user,
pending_asset↔asset_user): all returned 0, but vacuously so, since the
referencing tables are empty. Re-run these same checks after this rebuild
lands, once real data exists, as a standing data-integrity habit — not because
this migration itself introduces risk.

## 14. Governance docs that will go stale (tracked for Phase K)

`docs/ai/PRODUCT_CONTEXT.md` (role table, Holder concept, module-map row — all
pre-rebuild), `docs/ai/DEVELOPMENT_GUARDRAILS.md` (one stale `current_holder_id`
reference — drift from the *prior* rename, not just this one), `docs/ai/DECISIONS.md`
(needs an explicit superseding note against entries #16.2 and #12.5/#12.9),
`docs/ai/CURRENT_STAGE.md` (needs both a terminology pass and an unrelated
currency fix — it's missing AM-18 through AM-22 already), `docs/ai/REVIEW_FINDINGS.md`
and `docs/ai/UAT_MATRIX.md` (moderate Holder/IT_TEAM exposure in route/role
tables). Historical `docs/ai/AM-*` reports and `docs/specs/`/`docs/superpowers/`
plans are left untouched per the "don't rewrite history" rule.

## 15. Authorization centralization gap (found during audit, in scope per spec §47)

Role-gating today funnels through a single `require_role(*roles)` dependency
(good), but the *grouping* of roles is duplicated: the literal tuple
`("ADMIN", "IT_TEAM")` is hand-typed at 26 separate call sites across 8 router
files instead of one named constant, and `role == "ASSET_USER"` self-scoping
logic is duplicated in `assets/router.py` (twice) and `reports/router.py`
(once) instead of living in `deps.py` alongside `scoped_company_ids`. The
lifecycle state machine also independently hardcodes `actor_role != "ADMIN"`
for CORRECTION/FOUND gating, outside `require_role` entirely. This rebuild
will consolidate all of this into named helpers in `deps.py`
(`can_administer_system`, `can_manage_assets`, `allowed_company_ids`,
`allowed_asset_domains`, `can_access_asset`, `can_write_asset` — per spec §47)
rather than perpetuating the scattered pattern.

## 16. Configurable-mechanism decisions (per explicit user instruction)

Two spec rules are conditionally worded rather than absolute, and current data
doesn't yet confirm which branch applies for real CityKart operation. Rather
than guessing a hardcoded answer, both become admin-editable settings (new
`app_setting` key/value table, ADMIN-only to change, read at request time):

- `enforce_stock_install_point_uniqueness` (bool, default **off**) — spec §35
  says "ONLY enforce if current data confirms the model." No STOCK_POINT/INSTALLED
  rows exist yet to confirm it either way, so it starts off; CityKart admins can
  turn it on once real data is in and the one-per-Company+Location rule is
  confirmed to hold.
- `operator_can_manage_masters` (bool, default **off**, matching spec §48's
  conservative default of "no security/master administration unless an
  existing requirement proves otherwise") — lets a future OPERATOR-manages-masters
  decision be flipped without a code change/redeploy.

Both ship with their spec-recommended safe default and can be changed by an
ADMIN without a migration. This satisfies "if something is not clear, make it
configurable" without introducing unbounded scope — only these two genuinely
conditional rules get this treatment; everything else in the spec is stated as
an unconditional rule and is implemented as such.

## 17. Verdict

**Safe to proceed to Phase B (role/type migration design) and Phase C (DB
migration).** No external dependency blocks this rename. No real data will be
lost. Proceeding.
