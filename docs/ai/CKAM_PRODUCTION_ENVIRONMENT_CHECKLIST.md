# CKAM — Production Environment Variable Checklist

Prepared during AM-10 (Production Go-Live Preparation). Every value below
was assessed against the actual current `.env`/running-container
configuration in this dev/UAT environment, without ever printing a real
secret value — only length, placeholder-identity, and behavioral evidence
(e.g. whether `main.py`'s own `SECURITY WARNING` fired) are used as
evidence. **Every one of these must be set independently on the actual
production server** — this checklist assesses this session's own
environment as a rehearsal reference, not the production server itself.

| Variable | Purpose | Required? | Example format | Current-state classification (this dev/UAT env) | Production action |
|---|---|---|---|---|---|
| `POSTGRES_PASSWORD` | Postgres superuser/app password, shared by `db`/`api`/`backup` | Yes | a long random string, e.g. `openssl rand -hex 24` | **PLACEHOLDER** — 11 characters, confirmed to be exactly `docker-compose.yml`'s own hardcoded dev fallback (`ckam_dev_pw`), not a real generated production value. This value is visible to anyone who has seen the repository. | Generate a new, unique, sufficiently long random value on the production server's own `.env`. Never reuse this dev value in production. |
| `JWT_SECRET` | Signs/verifies every access and refresh token | Yes | `openssl rand -hex 32` (64 hex chars) | **ACCEPTABLE** — 64 characters, confirmed not equal to either known placeholder (`dev_secret_change_me`, `change_me_too`); `main.py::warn_if_default_jwt_secret`'s own `SECURITY WARNING` banner has not fired once across this container's full log history. | Generate an independent value on the production server (do not copy this dev value — a shared secret across environments means a dev-environment compromise could forge production tokens). Confirm the `SECURITY WARNING` does not appear in `docker compose logs api` after first startup. |
| `BASE_URL` | Public address of the web app as a LAN device reaches it; encoded into every printed QR label (`${BASE_URL}/assets/{id}`) | Yes | `http://assets.citykart.local:3211` or `http://192.168.1.50:3211` | **NOT PRODUCTION-READY** — currently `http://localhost:3211`, which only resolves on the machine running the containers; a QR label printed with this value cannot be scanned from any other device. See `CKAM_GO_LIVE_CHECKLIST.md`'s BASE_URL gate. | Set to the actual LAN hostname or static IP the production server will be reached at, **before** printing any real QR label. A label printed under the wrong `BASE_URL` must be reprinted — there is no way to retroactively fix a printed label. |
| `BACKUP_DIR` | Where nightly/manual backups land on the host | Yes | `/srv/ckam-backups` (Linux) or `D:/ckam-backups` (Windows) — a disk other than the one holding Docker's volumes, itself copied off the server | **DEV-ONLY** — currently the compose default `./backups`, inside the repository checkout, on the same disk as the `db_data`/`uploads` Docker volumes. Acceptable for development; explicitly documented in `docs/deployment.md` as unsuitable for production. | Point to a path on a separate physical disk from the Docker volumes, and ensure that path is itself copied off the server (NAS share, external drive rotation, or the company file server's own backup). Create the folder before `docker compose up`. |
| `COOKIE_SECURE` | `Secure` attribute on the refresh-token cookie | Yes | `false` (plain HTTP) or `true` (HTTPS only) | **ACCEPTABLE (for the documented plain-HTTP LAN deployment)** — currently `false`, which is correct as long as the site is served over plain HTTP. A browser never sends a `Secure` cookie over HTTP, so setting this `true` without HTTPS would silently break session refresh for everyone. | Leave `false` unless and until the production deployment is genuinely served over HTTPS. If HTTPS is introduced later, flip to `true` in the same change that introduces it — never before. |
| `WEB_PORT` | Host port nginx (the app) listens on, LAN-facing | Yes (has a working default) | `3211` (current default) | **ACCEPTABLE** — `3211`, matches `docs/deployment.md`'s documented port and `CLAUDE.md`'s own statement of the deployment port. | Confirm `3211` (or the chosen alternative) is open in the production server's firewall for LAN access, and does not collide with another service already using that port. |
| `DB_PORT` | Host port Postgres is published on, loopback-only | Yes (has a working default) | `5432` (current default) | **ACCEPTABLE** — currently remapped to `25432` in this dev environment specifically because a native Postgres already holds `5432` on this machine; the underlying container port is still `127.0.0.1`-only regardless of the host port chosen. | Set to `5432` (or an alternate free port) on the production server; confirm no native Postgres or other service already binds it, and confirm the `127.0.0.1:` prefix is **not** removed from `docker-compose.yml`'s `db` port mapping (removing it would expose Postgres to the whole LAN). |
| `API_PORT` | Host port the raw FastAPI service is published on, loopback-only | Yes (has a working default) | `8000` (current default) | **ACCEPTABLE** — `8000`, unchanged from default in this environment. | Same reasoning as `DB_PORT`: confirm the port is free and confirm the `127.0.0.1:` binding is not removed. |

## Summary classification

| Classification | Count | Variables |
|---|---|---|
| SET / ACCEPTABLE for this environment | 4 | `JWT_SECRET`, `COOKIE_SECURE`, `WEB_PORT`, `API_PORT` |
| PLACEHOLDER (repository-known dev default) | 1 | `POSTGRES_PASSWORD` |
| NOT PRODUCTION-READY (dev-only value, must change) | 2 | `BASE_URL`, `BACKUP_DIR` |
| MISSING | 0 | — |
| WEAK | 0 | — |

**No secret value is reproduced anywhere in this document** — only
lengths, placeholder-identity checks, and observed application behavior
(the absence of the `SECURITY WARNING` log line) were used as evidence,
per the AM-09/AM-10 redaction rule.

See `docs/ai/CKAM_GO_LIVE_CHECKLIST.md` for how these feed into the final
Go/No-Go gate, and `docs/ai/AM-10_GO_LIVE_PREPARATION_REPORT.md` §15-20 for
the full evidence behind each row.
