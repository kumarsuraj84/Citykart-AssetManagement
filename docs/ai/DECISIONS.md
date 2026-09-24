# CKAM — Durable Product Decisions

Newest first. These override older spec/plan text where they conflict.

## 2026-09-24 — Login has no company selector; identity resolution is fail-closed

**Decision:** The login screen asks only for User ID (Emp Code or email) and
Password. No Company dropdown.

**Why:** Requiring a company selector on every login was pure friction for a
single-company deployment, and added a step users had no way to get wrong
(there's exactly one real answer). The company-selector-based design was a
holdover from initial multi-tenant caution, not a real requirement.

**How it's actually resolved (this matters — it's not a naive fix):**
`emp_code` and `email` are only unique **per company**
(`UniqueConstraint(company_id, emp_code)` and the partial unique index from
migration `0005_holder_email_unique.py`), so `login_id` alone does not
uniquely identify a holder in the general case — it's possible, though
unlikely, for the same id to exist in two different companies.

The backend (`app/auth/router.py::login`) queries across every **active**
company for a holder matching `login_id`, and:
- exactly one match → proceed normally
- zero matches → 401 "Invalid credentials"
- **more than one match → 401 "Invalid credentials" (the same message as
  zero matches — no information leak) plus a server-side warning log**, so
  an admin can rename one of the colliding accounts. It never guesses, and
  it never silently picks the first row.

This is deliberately conservative: an account-takeover risk (silently
picking the wrong company's same-named account) is worse than a rare,
loud-in-the-logs "please disambiguate this" failure.

Company authorization/scoping after login is unaffected — the JWT still
carries the resolved `company_id`, and every downstream endpoint scopes by
it exactly as before.

**No migration was needed or applied** beyond the pre-existing
`0005_holder_email_unique.py` (already in place from an earlier stage) —
this stage only changed the login query, not the schema.

## 2026-09-24 — CKAM has its own visual identity

**Decision:** Deep navy primary + the existing brand teal as a secondary
accent, light canvas, no dark chrome (see `DESIGN_SYSTEM.md`). Other CityKart
applications (e.g. Citykart Desk) are used only as structural/UX references
— their exact colors, branding, and components are never copied.

**Why:** The user explicitly asked for CKAM's own identity, distinct from
sibling apps, after finding an earlier teal-only palette visually weak.

## 2026-09-24 — Sidebar shell replaces the flat top nav

**Decision:** Left sidebar (collapsible, grouped, icon-labeled) + light top
header, replacing the original single-row top nav + Setup dropdown.

**Why:** The flat nav didn't scale to CKAM's real number of screens (19),
and the Setup dropdown buried 10 of them behind a menu. Explicitly requested
by the user after seeing a reference app's sidebar pattern.

**Constraint that shaped this:** the header must stay **light**, not dark —
the logo is a transparent PNG with dark content and no light backing plate,
so a dark header makes it unreadable. This was discovered and fixed live
(see commit `feat(shell): replace the top nav with a collapsible CKAM
sidebar` and the follow-up header-color fix folded into it).

## Existing lifecycle/custody logic is preserved

**Decision:** The append-only event ledger, the lifecycle state machine, and
all existing scoping/authorization rules from the original 26-task SDD build
remain the source of truth. UI work does not get to quietly change them.

**Why:** Stated explicitly as a hard constraint for this stage of work; also
consistent with the original build's own design principles.
