# CKAM — Initial Production Master-Data Setup Guide

Prepared during AM-10. This documents the **correct order** to set up
master data on a freshly-bootstrapped production database, derived from
the actual foreign-key dependencies in `backend/app/*/models.py` and
verified live this session by running the exact sequence below end-to-end
against a disposable, genuinely fresh database (see
`AM-10_GO_LIVE_PREPARATION_REPORT.md` §28 for the full rehearsal
evidence). **No real production master data was created during AM-10** —
this guide documents the order; it does not execute it against a real
deployment.

## Dependency order (verified)

```
1. Company           (root -- everything else that is company-scoped needs this)
2. Location           (global master, no FK -- independent)
3. Department          (global master, no FK -- independent)
4. Cost Centre         (needs: Company)
5. Category            (global master, no FK -- independent)
6. Subcategory          (needs: Category)
7. Vendor              (global master, no FK -- independent)
8. Custom Fields        (optional; if company-scoped, needs: Company)
9. Holders/Users        (needs: Company, Location; Department optional)
10. Code Rule           (needs: Company if company-scoped, or leave global)
11. Assets              (needs: Company, Cost Centre, Category; Subcategory,
                          Vendor, Custom Fields, initial Holder all optional
                          except Holder, which is required)
```

Location, Department, Category, and Vendor are **global masters** with no
`company_id` column at all (confirmed by reading `app/masters/models.py`
and independently re-confirmed by the AM-09 audit, §7 of that report) —
they do not need to be created per company. Cost Centre is the one
genuinely company-owned simple master.

## Step-by-step (matches the app's own UI navigation)

1. **Setup → Companies**: create the company (e.g. `CKS` / "Citykart
   Stores" — already exists in this dev database, created by
   `scripts.create_owner`).
2. **Setup → Locations**: create at least one Location (e.g. `HO` / "Head
   Office"). `scripts.create_owner` creates this automatically for the
   hardcoded owner deployment; a second company or a different location
   scheme needs this done manually via Setup.
3. **Setup → Departments**: create at least one Department (e.g. "IT").
   Same automatic-creation note as Locations.
4. **Setup → Cost Centers**: create at least one Cost Centre for the
   company, since `Asset.cost_center_id` is a required field on every
   asset.
5. **Setup → Categories**: create at least one asset Category.
6. **Setup → Subcategories**: create at least one Subcategory under that
   Category (Subcategory is optional on an asset, but if used it must
   belong to the chosen Category — enforced server-side).
7. **Setup → Vendors**: create real vendor records as needed (optional on
   an asset, but needed if procurement traceability by vendor matters from
   day one).
8. **Setup → Custom Fields** (optional): create any Global or
   company-scoped required/optional fields CityKart wants captured on
   every asset, before the first real Add Asset — a field marked required
   *after* assets already exist does not retroactively block those
   existing assets (see `docs/ai/DECISIONS.md`, AM-04 section), but
   setting it up first avoids ever needing to backfill it.
9. **Setup → Holders & Users**: create at least one `IT_STOCK` holder per
   physical stock location **before** adding the first asset — every asset
   needs an `initial_holder_id`, and `docs/deployment.md`'s own First-time
   setup guidance already states this (step 5).
10. **Setup → Code Rule**: create the production numbering rule for the
    real company **before** creating the first real asset. This is the
    single most important step to get right before go-live — see the
    warning below.
11. **Add Asset**: only after all of the above exist.

## Critical warning: the current `ckam` database's own Code Rule state must NOT be reused as-is

This session's live `ckam` database inventory (AM-10 §9) found the real
company (`CKS`) currently has an **active, company-scoped Code Rule**
whose prefix is `RCMX/` — a leftover from AM-09's RC-isolation testing,
not a real business prefix — plus a separate **active, global** Code Rule
(`company_id IS NULL`) whose prefix is `AM04UAT/`, which would silently
apply as the numbering prefix for any *other* company created without its
own rule. If the current database is ever promoted to production without
cleanup, the very first real asset created would be numbered under one of
these test prefixes, not a real CityKart-meaningful one. **Whichever
production-data strategy is chosen (see the AM-10 report §9-13), the
production Code Rule for the real company must be explicitly set —
reviewed and confirmed correct — before the first real Add Asset, not
assumed correct because *a* rule already exists and returns a 201.**

## Bootstrap script reference

The first real ADMIN account is created by
`docker compose exec api python -m scripts.create_owner` (idempotent, safe
to re-run, documented in `docs/deployment.md` and re-verified live this
session — see the AM-10 report §28-29 for the full rehearsal). It creates
the Company/Location/Department/Holder rows listed above with fixed,
intentionally-hardcoded values (this script is written for exactly one
real deployment, not as a generic dev fixture) and prints a one-time
temporary password that must be relayed to the account owner out-of-band
and never logged persistently.

No production master data was populated by this rehearsal — it ran only
against a disposable database, dropped immediately after verification.
