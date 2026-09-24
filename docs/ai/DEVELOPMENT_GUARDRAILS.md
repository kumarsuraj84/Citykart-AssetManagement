# CKAM — Development Guardrails

Rules that apply to every change, regardless of stage. Read before editing.

## Business logic

- **Never change lifecycle/custody logic while doing UI work.** If a UI
  improvement seems to need a backend behavior change, stop, write it down
  in `REVIEW_FINDINGS.md` or `DECISIONS.md` first, then decide separately
  whether to make it.
- **`lifecycle/service.py::apply_event` is the only writer** of
  `Asset.status` / `current_holder_id` / `status_since`. Nothing else may
  touch these fields.
- **No hard deletes of business records, ever.** Soft-deactivate
  (`is_active=false`) only. This includes remediating incidents — deactivate,
  don't delete.
- **Backend authorization is authoritative.** Never weaken a server-side
  role/company/holder check because the frontend already hides the action.
  Hiding a button is UX; the 403 is the actual control.
- **Company/holder scoping is mandatory on every read.** ADMIN sees
  everything; every other role is scoped.

## Database

- **No schema change without an Alembic migration.** Never `create_all` at
  runtime.
- Preserve monetary precision and existing audit fields
  (`created_by`/`updated_by`/timestamps).
- New migrations go through the same review as code — write the downgrade
  path too where practical.

## Security

- No plaintext passwords, ever — Argon2id hashing only
  (`core/security.py::hash_password`).
- No secrets in the repository. `.env` is gitignored; `.env.example` ships
  only placeholder values, and `main.py::warn_if_default_jwt_secret` exists
  specifically to catch a placeholder or too-short `JWT_SECRET` reaching a
  real deployment.
- Don't leak stack traces, DB errors, or internal paths in API error
  responses.
- File uploads: keep the existing bounded-read size cap and extension
  allowlist (`documents/router.py`) — don't buffer an unbounded body before
  checking size.

## Testing

- **Test before every commit.** Backend and frontend suites must pass; a
  new behavior needs a new test, not just a manual check.
- **Never run backend pytest against the plain `ckam` database.** Use
  `ckam_test` (`DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test`).
  The `conftest.py` guard will refuse otherwise — don't set
  `CKAM_ALLOW_TEST_TRUNCATE=1` to bypass it casually; that escape hatch
  exists for a genuine one-off, not routine use.
- Don't modify a test merely to make a failure disappear unless the
  underlying expected behavior has legitimately changed — and say so in the
  commit message when you do.
- E2E (Playwright) seeds and tears down its own throwaway company via the
  app's real ADMIN API (`frontend/e2e/fixtures.ts`) — it's safe to run
  against the live dev stack. Verify teardown afterward with `GET
  /api/auth/companies` if in doubt.

## No fake functionality

- Never add a button, chart, or metric that doesn't work end-to-end or
  isn't backed by real data. No fake "Forgot Password," no placeholder
  dashboard numbers, no decorative charts without operational meaning.
- Every visible action either works, is disabled with a clear reason, or
  isn't shown.

## Scope discipline

- Don't rebuild working backend functionality "while you're in there."
- Don't introduce new frameworks, state-management libraries, or
  dependencies without a proven need — FastAPI/Postgres/React/TanStack/
  shadcn is sufficient.
- Prefer extending the existing generic components (`MasterCrudScreen`, the
  shared `components/ui/*` primitives) over writing a new one-off.

## Commit discipline

- Conventional Commit messages (`feat(scope): ...`, `fix(scope): ...`,
  `docs(scope): ...`).
- Commit locally, logically scoped, reviewable. **Do not push** — pushing
  to `origin` is the user's call, not this session's, unless explicitly
  asked.
- Never force-push, never rewrite history, never run a destructive
  operation against the live dev database without explicit confirmation
  (see `docs/deployment.md` for the one prior incident this rule exists
  because of).
