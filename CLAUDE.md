# CKAM — CityKart Asset Manager

Internal asset-lifecycle tracking app for CityKart. FastAPI + SQLAlchemy 2.0
async + PostgreSQL backend (PostgreSQL 17 in the dev Docker stack, 18 in
production); React 19 + Vite + TanStack Query/Router + Tailwind + shadcn/ui
frontend. Dev runs via Docker Compose (web on port 3211); production runs as a
single uvicorn process on port 3211 (no Docker, no nginx).

## Environments (fixed as of 2026-10-07; details in `docs/ai/PRODUCTION_INFRASTRUCTURE.md`)

| Role | Machine |
|---|---|
| Development | this machine, **10.0.0.47**. All development and testing happens here, never on production |
| Production app | **10.0.1.98**, `D:\Citykart_Applications\Citykart_AssetManagement_App`, task `CKAM-Web`, `http://10.0.1.98:3211` (SSH key `~/.ssh/citykart_newservers`) |
| Production database | **10.0.0.205**, PostgreSQL 18, database `ckassetmanagement` |
| Production files | NAS **10.0.0.25**, `\\10.0.0.25\ckapplications_data\CKASSETMANAGEMENT_DATA` |

- **10.0.1.12 is RETIRED for CKAM and must stay dead.** Its `CKAM-Web` task is disabled, its launcher/config are renamed `*.RETIRED-2026-10-07`, and its `ckam_app` database role cannot log in. Never work on, deploy to, start, or re-enable anything there. Running it alongside the new system would split the data.
- 10.0.1.98, 10.0.0.205 and the NAS are **shared** with other apps (Spinwheel, Citykart Desk). Touch only CKAM's own folder, task, firewall rule, database, role, backup task and NAS folder. Never read or change another app's database, files or config unless the user explicitly asks.
- "Commit and push to git and main" means: commit, then push to origin. `main` is the repo's default branch, which is named `claude/brave-euler-07879a` (no branch is literally called `main`). It does **not** mean deploy. Deploying to production is a separate step that needs its own explicit request, and the user types any superuser database password and NAS password on the servers themselves.

Full context lives in `docs/ai/`:
- `PRODUCT_CONTEXT.md` — what CKAM does, personas, module map
- `DESIGN_SYSTEM.md` — the actual CKAM design system (tokens, components, patterns)
- `DEVELOPMENT_GUARDRAILS.md` — rules that apply to every change (read before editing)
- `CURRENT_STAGE.md` — what's actively being worked on right now
- `REVIEW_FINDINGS.md` — open technical/design findings not yet fixed
- `DECISIONS.md` — durable product decisions and why they were made
- `UAT_MATRIX.md` — route-by-route functional/design/security/responsive test status
- `ERP_INTEGRATION.md` — read-only link to the ERP warehouse (vendors, POs; receipts/PI planned)

Spec/plan history (superseded where `docs/ai/DECISIONS.md` overrides it):
- `docs/specs/2026-09-23-ckam-design.md`
- `docs/superpowers/plans/2026-09-23-ckam-implementation.md`

## The five rules that matter most

1. **Backend authorization is authoritative, always.** Hiding a button or nav
   link in the frontend is UX, not security. Every write path re-checks role
   and company scope server-side regardless of what the UI shows.
2. **The asset event ledger is append-only.** `lifecycle/service.py::apply_event`
   is the only writer of `Asset.status`/`current_asset_user_id`/`status_since`.
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
5. **Commit locally with Conventional Commits; push only when told.** This
   repository's remote push discipline is owned by the user, not this
   session. Commit clean, reviewable, logically-scoped changes and stop
   there until the user says to push (for example "commit and push to git
   and main"). Each push approval covers that change only.

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
