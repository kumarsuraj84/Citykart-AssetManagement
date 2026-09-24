# CKAM — CityKart Asset Manager

Internal asset-lifecycle tracking app for CityKart. FastAPI + SQLAlchemy 2.0
async + PostgreSQL 17 backend; React 19 + Vite + TanStack Query/Router +
Tailwind + shadcn/ui frontend. Deployed via Docker Compose on a company LAN
server (web on port 3211).

Full context lives in `docs/ai/`:
- `PRODUCT_CONTEXT.md` — what CKAM does, personas, module map
- `DESIGN_SYSTEM.md` — the actual CKAM design system (tokens, components, patterns)
- `DEVELOPMENT_GUARDRAILS.md` — rules that apply to every change (read before editing)
- `CURRENT_STAGE.md` — what's actively being worked on right now
- `REVIEW_FINDINGS.md` — open technical/design findings not yet fixed
- `DECISIONS.md` — durable product decisions and why they were made
- `UAT_MATRIX.md` — route-by-route functional/design/security/responsive test status

Spec/plan history (superseded where `docs/ai/DECISIONS.md` overrides it):
- `docs/specs/2026-09-23-ckam-design.md`
- `docs/superpowers/plans/2026-09-23-ckam-implementation.md`

## The five rules that matter most

1. **Backend authorization is authoritative, always.** Hiding a button or nav
   link in the frontend is UX, not security. Every write path re-checks role
   and company scope server-side regardless of what the UI shows.
2. **The asset event ledger is append-only.** `lifecycle/service.py::apply_event`
   is the only writer of `Asset.status`/`current_holder_id`/`status_since`.
   Never touch those fields anywhere else. No hard deletes of business
   records anywhere — soft-deactivate (`is_active=false`) only.
3. **No schema change without an Alembic migration.** Never `create_all` at
   runtime.
4. **Test before you commit, every time.** Backend: `docker compose exec -T
   -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test
   api python -m pytest -q` — never against the plain `ckam` database (the
   `conftest.py` guard refuses this on purpose; don't work around it).
   Frontend: `npx tsc -b && npx vitest run` in `frontend/`. Rebuild the
   relevant container (`docker compose up -d --build api|web`) before any
   browser-based check — the containers do not live-mount source.
5. **Commit locally with Conventional Commits; do not push.** This
   repository's remote push discipline is owned by the user, not this
   session. Commit clean, reviewable, logically-scoped changes and stop
   there unless explicitly asked to push.

## Known environment quirks (don't rediscover these)

- Git Bash/MSYS mangles absolute Unix-style paths passed to `docker compose
  exec`/`cp` — prefix with `MSYS_NO_PATHCONV=1` when a path-like argument is
  involved.
- The Browser-pane screenshot tool occasionally renders a stale/cropped frame
  after several `resize_window` calls in the same tab; if a screenshot looks
  wrong, open a fresh tab before concluding there's a real layout bug —
  verify with `getBoundingClientRect()` via `javascript_tool` if in doubt.
- jsdom has no `window.matchMedia` — the shared `Sidebar` component's
  mobile-detection hook needs it; a polyfill lives in `frontend/src/test-setup.ts`.
