# "Not tracked in CKAM" decision for ERP codes (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, TDD). Commit locally per task; never push or deploy.

**Goal:** the owner can say, once, that an ERP code, product name, Article, Department, Section or Division is **not tracked in CKAM** (cables, hangers, sensor tags...). Those PO lines never reach CKAM, and nothing else (picker, change check, reminders) bothers the user about them.

**Owner request (2026-10-13):** the camera Article holds 6 cameras plus a CAT-6 cable and a connector; the ERP's Fixed Assets division is full of shop-fitting material CKAM must not be cluttered with. Decision levels: Code, Product name, Article, **Department, Section, Division**.

**Design:** a rule is an `item_map` row that either points to an Item or is `not_tracked`. Resolution order, most specific first: CODE > NAME > ARTICLE > DEPARTMENT > SECTION > DIVISION (per company; a company's own rule beats an every-company one, as today). Department / Section / Division rules can only be "not tracked" (a whole department is not one Item). An Article / name / code rule that links an Item beats a broader "not tracked" rule, so one Article can be kept inside a department that is not tracked.

## Global constraints
- Alembic migration for the schema change (head `e5a7c9b1d3f4`); upgrade and downgrade must work with rows present.
- Rules are soft: removing one deactivates it (`is_active=false`), nothing is deleted. Authorization: Primary Owner for rules, as now.
- Backend tests: `docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest -q` (rebuild `api` first, migrate `ckam` and `ckam_test`); frontend `npx tsc -b && npx vitest run`.
- Plain-language UI text. Nothing is written to the ERP.

## Task 1: the rule (migration, model, service)
- Migration `f6b8d0e2a4c5`: `item_map.item_id` nullable; `item_map.not_tracked boolean not null default false`; `item_map.level_key varchar(300)`; check `item_id IS NOT NULL OR not_tracked`.
- `MATCH_TYPES` gains DEPARTMENT, SECTION, DIVISION. `upsert_map` takes `not_tracked` and `level_key`; broader levels require `not_tracked`; saving an Item over a not-tracked rule at the same key (or the reverse) re-points the same rule.
- `Resolution(item=None, not_tracked=True, matched_by=..., map_id=..., level_key=...)`; `resolve_items` follows the order above; `_active_maps` keeps not-tracked rules (they have no Item); a deactivated Item's rules still stop applying.
- `ErpArticle.division` (live and local source). `article_overview` adds `decision` (`ITEM` / `NOT_TRACKED` / null), `not_tracked_by` ("ARTICLE", "DEPARTMENT: FA_FF_HANGER"...), `not_tracked_map_id`, `untracked_rules` (code/name rules inside the Article), `division`. `article_code_overview` rows add `not_tracked`. New `group_overview(level)` and `GET /api/items/articles/groups?level=&company_id=`.
- Tests: resolution order and precedence (code Item beats department not-tracked; department beats nothing; company rule beats every-company rule), upsert rules (department needs not_tracked, level_key required, re-point), overview and group endpoints, migration round trip.

## Task 2: where it takes effect
- `build_draft`: lines resolving not tracked are left out and returned as `untracked_lines` (code, description, quantity, why); a PO with no tracked line warns and cannot be created.
- `list_available_pos`: a PO whose lines are all not tracked is not offered; rows carry `tracked_lines` / `untracked_lines`.
- Change check (`erp_now`, `compute_changes`, `snapshot_baseline`, `changes_summary`): not-tracked codes are ignored on both sides, so marking a code not tracked later never shows as a cancellation.
- Delivery reminders ignore not-tracked codes.
- Tests for each.

## Task 3: screens
- ERP Articles: tabs **Not linked / Not tracked / All** with counts; a **Not tracked** button beside Link; a row badge "Not tracked (Department FA_FF_HANGER)" with Undo or Change; Codes... dialog: per product name and per code "Not tracked" next to the Item choice; a **Groups...** dialog (Division / Section / Department tabs) listing each value with its Articles, codes and units and a Not tracked / Track again toggle.
- PO review: the "not tracked here" lines are listed collapsed under the lines; an unresolved line gets a **Not tracked** choice (with the same remember-for scope: this code, this product name, this Article, or its Department / Section / Division).
- Vitest tests for each; docs (`ITEM_MODEL.md`, `ERP_INTEGRATION.md`, `DECISIONS.md`) and memory.
