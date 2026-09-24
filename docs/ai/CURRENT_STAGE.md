# CKAM — Current Stage

**Stage:** AM-00 (baseline + governance) — complete.
**Next:** AM-01, awaiting explicit go-ahead (per the AM-00 gate — do not
start AM-01 automatically).

## What's actually done as of AM-00

- Login: no company selector, fail-closed identity resolution across
  companies (backend + frontend), tested.
- Change Password: redesigned to match Login's visual language.
- App shell: sidebar navigation (grouped, icon-labeled, collapsible,
  mobile-drawer) replacing the old top nav + dropdown.
- Design system: navy-forward palette, 44px form-control sizing, two-layer
  focus states — applied globally via shared tokens/components.
- Logo: fixed a real transparency defect (baked-in near-white plate).

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
