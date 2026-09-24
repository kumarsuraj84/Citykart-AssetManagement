# CKAM — Current Stage

**Stage:** AM-01 (data integrity + procurement foundation) — complete, PASS.
**Next:** awaiting explicit go-ahead on AM-02, or on the two deferred AM-01
follow-up items (see below) — do not start further work automatically.

Full AM-01 evidence: `docs/ai/AM-01_DATA_INTEGRITY_REPORT.md`.

## Locked V1 business decisions (from the AM-01 authorization — see `DECISIONS.md` for full detail)

No approval workflow in V1. Single current-holder/custody concept (no
custodian/user split). No AMC/insurance. No depreciation/accounting. No
physical verification (but QR/barcode stays forward-compatible). Lost/Damaged
tracks lifecycle state + reason + audit only, no recovery/write-off
accounting. Custom Fields are **required** long-term but not wired into any
screen yet — do not remove the master. Procurement traceability (including PI
Number) is a locked target requirement. Auto-generated Asset Code stays
mandatory, race-safe numbering preserved as-is. CKAM supports ≥2 companies;
Cost Centres must match their asset's company (already enforced, now
test-covered on both creation paths). No login company selector (already
shipped). Core V1 lifecycle: Procured → IT Stock → Assigned → Returned →
Reassigned, plus Repair/Lost-Found/Disposed-Sold-Scrapped.

## What's actually done as of AM-01

- Login: no company selector, fail-closed identity resolution across
  companies (backend + frontend), tested.
- Change Password: redesigned to match Login's visual language.
- App shell: sidebar navigation (grouped, icon-labeled, collapsible,
  mobile-drawer) replacing the old top nav + dropdown.
- Design system: navy-forward palette, 44px form-control sizing, two-layer
  focus states — applied globally via shared tokens/components.
- Logo: fixed a real transparency defect (baked-in near-white plate).
- **Data integrity (AM-01):** 6 new indexes on evidenced hot-path columns
  (`asset.status/current_holder_id/company_id/category_id`,
  `asset_event.asset_id+event_date`, `asset_event.event_date`); historical
  event display now snapshots holder names at write time (a holder rename no
  longer rewrites past events' apparent custody); company/cost-centre
  cross-company protection confirmed already correct on both the Add Asset
  and Import paths, now test-covered on both; Holder model confirmed to
  correctly represent all 4 custody types with no fake-employee workaround.

## Deferred from AM-01, awaiting your decision (not blockers, not failures)

1. **`holder_company_access`**: written to, never read by authorization.
   Classified as either "needed for multi-company asset-team access" or
   "dormant/obsolete" — genuinely depends on whether CityKart's asset team is
   organizationally shared across companies. No behavioral change made.
2. **Closed-value field validation**: `holder.holder_type`, `holder.role`,
   `custom_field.field_type` currently accept any string (no validation at
   all, confirmed by test). Proposed fix (not applied): a router-level check
   mirroring the existing `doc_type` pattern. CHECK constraints proposed as
   a separate, low-risk follow-up migration once value lists are final.

None of AM-02 through AM-16 (shared DataTable/PageHeader/etc., Dashboard,
Asset Register, Asset Detail, Add Asset, Holders, Setup/masters, Import,
Reports, My Assets, responsive/accessibility passes, security regression,
full UAT) have been started as dedicated stages yet — see
`REVIEW_FINDINGS.md` for what's still open on each of those screens.

## Branch / remote state

Working on `worktree-ckam-build` (local worktree). This branch has **never
been pushed to `origin`** — only `claude/brave-euler-07879a` exists on the
remote (a small, unrelated test-DB-safety-guard commit). Pushing is a
decision for the user, not this session, to make explicitly.
