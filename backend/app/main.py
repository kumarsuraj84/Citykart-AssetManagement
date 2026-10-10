import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from app.core.config import DEFAULT_DEV_JWT_SECRET, settings
from app.auth.router import router as auth_router
from app.asset_users.router import router as asset_users_router
from app.masters.router import router as masters_router
from app.numbering.router import router as numbering_router
from app.assets.router import router as assets_router
from app.lifecycle.router import router as lifecycle_router
from app.reports.router import router as reports_router
from app.documents.router import router as documents_router
from app.imports.router import router as imports_router, movement_router as imports_movement_router, po_router as imports_po_router
from app.purchase_orders.router import router as purchase_orders_router
from app.bundles.router import router as bundles_router
from app.erp.router import router as erp_router
from app.items.router import router as items_router

logger = logging.getLogger("ckam.security")
if not logger.handlers:
    # uvicorn only configures its own loggers; give this one a stderr handler so
    # the warning below always reaches `docker compose logs api`.
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(logging.Formatter("%(levelname)s:     [%(name)s] %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.WARNING)


# Every insecure placeholder that is committed anywhere in this repo -- the
# app's own default (DEFAULT_DEV_JWT_SECRET) plus every example value that
# appears in .env.example. Anyone who has read the source has seen all of
# these, so any of them in a real deployment is as forgeable as the others.
_KNOWN_INSECURE_JWT_SECRETS = {DEFAULT_DEV_JWT_SECRET, "change_me_too"}
_MIN_SECURE_JWT_SECRET_LENGTH = 32


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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    warn_if_default_jwt_secret(settings.jwt_secret)
    yield


app = FastAPI(title="CityKart Asset Manager API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(asset_users_router)
app.include_router(masters_router)
app.include_router(numbering_router)
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


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


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
    candidate = dist_dir / "assets" / file_path
    if not candidate.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(candidate)


@app.get("/{full_path:path}")
async def _serve_frontend_shell(full_path: str):
    dist_dir = _frontend_dist_dir()
    if dist_dir is None:
        raise HTTPException(status_code=404)
    if full_path in _FRONTEND_ROOT_FILES:
        candidate = dist_dir / full_path
        if candidate.is_file():
            return FileResponse(candidate)
    return FileResponse(dist_dir / "index.html", headers={"Cache-Control": "no-cache"})
