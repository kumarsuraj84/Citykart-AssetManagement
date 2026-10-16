import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from app.core.config import DEFAULT_DEV_JWT_SECRET, settings
from app.core.body_limit import BodyLimitMiddleware
from app.core.errors import SPA_FALLBACK_PATH, is_api_path, register_exception_handlers, unknown_api_response
from app.core.static_safety import safe_asset_path
from app.core.idempotency import IdempotencyMiddleware
from app.core.db import SessionLocal
from app.erp.source import is_configured as erp_is_configured
from app.erp.sync import sync_loop
from app.erp.warehouse import get_warehouse_reader
from app.auth.router import router as auth_router
from app.asset_users.router import router as asset_users_router
from app.asset_users.stock_rooms import router as stock_rooms_router
from app.masters.router import router as masters_router
from app.numbering.router import router as numbering_router
from app.assets.router import router as assets_router
from app.assets.tools_router import router as asset_tools_router
from app.asset_users.people import router as people_router
from app.lifecycle.router import router as lifecycle_router
from app.reports.router import router as reports_router
from app.documents.router import router as documents_router
from app.imports.router import router as imports_router, movement_router as imports_movement_router, po_router as imports_po_router
from app.purchase_orders.router import router as purchase_orders_router
from app.bundles.router import router as bundles_router
from app.erp.router import router as erp_router
from app.items.router import router as items_router
from app.home.router import router as home_router

from app.core.db import engine
from app.observability import audit as obs_audit
from app.observability import filelog as obs_filelog
from app.observability import sqltiming as obs_sqltiming
from app.observability import system as obs_system
from app.observability import writer as obs_writer
from app.observability.admin_router import router as admin_logs_router
from app.observability.client_reports import router as client_reports_router
from app.observability.middleware import RequestContextMiddleware
from app.observability.redact import register_settings_secrets
from app.observability.retention import retention_loop

# S8: JSON-lines log files in LOG_DIR (and WARNING+ on stderr, so `docker compose logs api` and the
# production launcher log still show problems), the automatic data audit, SQL timing, and the server's own
# secrets registered for redaction -- all before the first request.
register_settings_secrets(settings)
obs_filelog.setup(settings.log_dir, settings.log_level)
obs_audit.install()
obs_sqltiming.install(engine)

logger = logging.getLogger("ckam.security")


# Every insecure placeholder that is committed anywhere in this repo -- the
# app's own default (DEFAULT_DEV_JWT_SECRET) plus every example value that
# appears in .env.example. Anyone who has read the source has seen all of
# these, so any of them in a real deployment is as forgeable as the others.
_KNOWN_INSECURE_JWT_SECRETS = {DEFAULT_DEV_JWT_SECRET, "change_me_too"}
_MIN_SECURE_JWT_SECRET_LENGTH = 32
_MIN_DISTINCT_JWT_SECRET_CHARACTERS = 8


def warn_if_default_jwt_secret(secret: str) -> bool:
    """Logs a prominent WARNING if JWT_SECRET is still a committed placeholder
    (the app's own default, or one of .env.example's example values) or is
    simply too short to be a real random secret -- with any of these, anyone
    who has read the source (or guessed a short value) can forge valid tokens,
    including ADMIN ones. Deliberately does not refuse to start: local dev and
    the test suite rely on the default. Returns True if it warned."""
    is_known_placeholder = secret in _KNOWN_INSECURE_JWT_SECRETS
    is_too_short = len(secret) < _MIN_SECURE_JWT_SECRET_LENGTH
    if not is_known_placeholder and not is_too_short:
        return False
    banner = "!" * 78
    reason = (
        f"it is a committed placeholder value ({secret!r})"
        if is_known_placeholder
        else f"it is only {len(secret)} characters (a real secret should be at least {_MIN_SECURE_JWT_SECRET_LENGTH})"
    )
    logger.warning(
        "\n%s\n"
        "SECURITY WARNING: JWT_SECRET is insecure -- %s.\n"
        "Anyone who knows or has seen this value can FORGE login tokens for any\n"
        "account, including ADMIN.\n"
        "Set JWT_SECRET in .env to a long random value (e.g. `openssl rand -hex 32`)\n"
        "and restart: docker compose up -d api\n"
        "%s",
        banner, reason, banner,
    )
    return True


# Security (N4): only these names are "not production"; anything else (prod, prd, live, a typo) is treated as production,
# so a mistyped ENVIRONMENT_NAME can never silently switch the production protections off.
_NON_PRODUCTION_NAMES = {"development", "dev", "test", "testing", "uat", "security-test", "local", "ci"}


def is_production(environment_name: str | None) -> bool:
    return (environment_name or "").strip().lower() not in _NON_PRODUCTION_NAMES


def docs_urls(environment_name: str | None) -> dict:
    """Security AU-11: production publishes no API map -- /docs, /redoc and /openapi.json are switched off there
    (FastAPI constructor arguments). Every other environment keeps FastAPI's defaults."""
    if is_production(environment_name):
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {}


def refuse_to_start_with_insecure_secret(environment_name: str, secret: str) -> None:
    """Security (IF-04): a server that says it is production must not run with a committed placeholder or a too
    short JWT_SECRET -- that would let anyone who has read the source forge ADMIN tokens. Development, the test
    suite and UAT (any other ENVIRONMENT_NAME) are unchanged: they only get the warning above."""
    if not is_production(environment_name):
        return
    value = (secret or "").strip()
    if (value in _KNOWN_INSECURE_JWT_SECRETS or len(value) < _MIN_SECURE_JWT_SECRET_LENGTH
            or len(set(value)) < _MIN_DISTINCT_JWT_SECRET_CHARACTERS):
        # OBS-GUARD-MSG: name every rule (the operator must not chase the wrong one), never the value itself.
        raise RuntimeError(
            "Refusing to start: this server counts as production (ENVIRONMENT_NAME is not a development or test "
            "name) and its JWT_SECRET is not strong enough. The JWT_SECRET must not be a placeholder value from "
            f"the source code, must be at least {_MIN_SECURE_JWT_SECRET_LENGTH} characters long AND must contain at "
            f"least {_MIN_DISTINCT_JWT_SECRET_CHARACTERS} different characters. Set a long random JWT_SECRET "
            "(e.g. `openssl rand -hex 32`) and start again."
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    refuse_to_start_with_insecure_secret(settings.environment_name, settings.jwt_secret)
    warn_if_default_jwt_secret(settings.jwt_secret)
    # S8: a system_event for the start (version, migration state, safe config), a WARNING one when the
    # database's migration is not the code's, and one when LOG_DIR could not be written.
    try:
        await obs_system.on_startup()
    except Exception as exc:          # never stop the app from starting over logging
        obs_writer.report_failure("startup event", exc)
    # Keep CKAM's own copy of the ERP data up to date in the background (only when the ERP link is set up).
    stop = asyncio.Event()
    tasks = []
    if settings.erp_sync_enabled and erp_is_configured():
        tasks.append(asyncio.create_task(sync_loop(SessionLocal, get_warehouse_reader(), stop)))
    # S8: the daily purge of old error / system / client-report rows (audit_log is never purged).
    tasks.append(asyncio.create_task(retention_loop(stop)))
    try:
        yield
    finally:
        stop.set()
        for task in tasks:
            try:
                await asyncio.wait_for(task, timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
        try:
            await obs_system.on_shutdown()
        except Exception as exc:
            obs_writer.report_failure("shutdown event", exc)


app = FastAPI(title="CityKart Asset Manager API", lifespan=lifespan, **docs_urls(settings.environment_name))
# S0.7: friendly 422/409 answers instead of bare 500s or raw validation arrays.
register_exception_handlers(app)
# S7 (P1-2): the Idempotency-Key header on create / receive / move requests (app.core.idempotency). Added
# before the security-headers middleware below, so a replayed answer gets those headers too.
app.add_middleware(IdempotencyMiddleware)
# Security N1: bigger-than-useful request bodies are refused before anything reads them (added after the
# idempotency middleware so it sits outside it, and before the security-headers one so a 413 carries them).
app.add_middleware(BodyLimitMiddleware)
app.include_router(auth_router)
app.include_router(asset_users_router)
app.include_router(stock_rooms_router)
app.include_router(people_router)
app.include_router(masters_router)
app.include_router(numbering_router)
# S5: the fixed /api/assets/... paths (batch, pick, unlinked-items, link-items) before /api/assets/{asset_id}
app.include_router(asset_tools_router)
app.include_router(assets_router)
app.include_router(lifecycle_router)
app.include_router(reports_router)
app.include_router(documents_router)
app.include_router(imports_router)
app.include_router(imports_po_router)
app.include_router(imports_movement_router)
app.include_router(purchase_orders_router)
app.include_router(bundles_router)
app.include_router(erp_router)
app.include_router(items_router)
app.include_router(home_router)
# S8: admin logs / diagnostics (head-office admin only) and the browser's problem reports.
app.include_router(admin_logs_router)
app.include_router(client_reports_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Single-port production hosting (no separate nginx container): serve the
# built frontend from this same FastAPI process, replicating frontend/nginx.conf's
# behavior (AM-10 security headers on every response, `Cache-Control: no-store`
# on API responses so they're never cached, `no-cache` on the SPA shell so a
# stale index.html never references deleted hashed asset filenames, and a
# `try_files $uri /index.html`-style fallback for client-side routes) instead
# of reimplementing it as a separate nginx config. Dev/Docker leaves
# frontend_dist_dir unset, so `_frontend_dist_dir()` always returns None there
# and every request below 404s exactly as if these routes didn't exist.
_FRONTEND_ROOT_FILES = {"favicon.svg", "favicon.webp", "icons.svg", "logo.png"}


def _frontend_dist_dir() -> Path | None:
    if not settings.frontend_dist_dir:
        return None
    candidate = Path(settings.frontend_dist_dir)
    return candidate if candidate.is_dir() else None


# Security AU-14/AU-15: the same values frontend/nginx.conf sends in the Docker stack. Google Fonts serves the Inter /
# IBM Plex stylesheet and font files. No in-browser camera use exists (labels are scanned with the phone's own
# camera app, which opens the asset link), so the camera is off like the rest.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; "
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
)
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
# FastAPI's own /docs and /redoc pages load Swagger / ReDoc from a CDN with an inline script; they exist only
# outside production (docs_urls), so they are left without the CSP instead of being broken in development.
_DOCS_PATHS = frozenset({"/docs", "/docs/oauth2-redirect", "/redoc"})
_DOCS_OFF_PATHS = _DOCS_PATHS | {"/openapi.json"}


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
    if request.url.path not in _DOCS_PATHS or app.docs_url is None:
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# S8: added LAST, so it is the OUTERMOST middleware (inside Starlette's own error middleware): every
# response -- idempotency replays, refusals, unexpected errors, files, the SPA -- carries X-Request-ID, and
# the access line / error rows see the final status.
app.add_middleware(RequestContextMiddleware)


@app.get("/assets/{file_path:path}")
async def _serve_frontend_asset(file_path: str):
    # Deliberately 404s instead of falling back to index.html like nginx's
    # single `try_files $uri /index.html` catch-all technically would for an
    # unmatched /assets/ path -- a missing hashed JS/CSS file should surface
    # as a clear 404, not silently return HTML that breaks the importing
    # module with a confusing "Unexpected token '<'".
    dist_dir = _frontend_dist_dir()
    if dist_dir is None:
        raise HTTPException(status_code=404)
    # Security (IF-01 / IF-01-WIN): `file_path` comes from the URL and may hold `..` segments (percent-encoded), an
    # absolute path, or a Windows UNC / drive / device / stream name. app.core.static_safety refuses all of those
    # by looking at the text alone, BEFORE any filesystem call (on Windows even a stat of a UNC path contacts that
    # host), then requires the resolved file to sit inside <dist>/assets. Every refusal is the same plain 404.
    candidate = safe_asset_path(dist_dir / "assets", file_path)
    if candidate is None:
        raise HTTPException(status_code=404)
    return FileResponse(candidate)


@app.get(SPA_FALLBACK_PATH)
async def _serve_frontend_shell(full_path: str):
    # Security N6: an /api address no API route serves is a JSON 404, never the SPA shell with 200.
    if is_api_path("/" + full_path.lstrip("/")):
        return unknown_api_response()
    # Security (AU-11, closure): where the API documentation is switched off (production) /docs, /redoc and
    # /openapi.json are a plain JSON 404 too -- not the SPA shell with 200, which looked like "still there".
    if app.docs_url is None and "/" + full_path.strip("/") in _DOCS_OFF_PATHS:
        return unknown_api_response()
    dist_dir = _frontend_dist_dir()
    if dist_dir is None:
        raise HTTPException(status_code=404)
    if full_path in _FRONTEND_ROOT_FILES:
        candidate = safe_asset_path(dist_dir, full_path)        # IF-01-WIN: same lexical check first
        if candidate is not None:
            return FileResponse(candidate)
    return FileResponse(dist_dir / "index.html", headers={"Cache-Control": "no-cache"})
