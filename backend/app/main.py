import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from app.core.config import DEFAULT_DEV_JWT_SECRET, settings
from app.auth.router import router as auth_router
from app.holders.router import router as holders_router
from app.masters.router import router as masters_router
from app.numbering.router import router as numbering_router
from app.assets.router import router as assets_router
from app.lifecycle.router import router as lifecycle_router
from app.reports.router import router as reports_router
from app.documents.router import router as documents_router
from app.imports.router import router as imports_router

logger = logging.getLogger("ckam.security")
if not logger.handlers:
    # uvicorn only configures its own loggers; give this one a stderr handler so
    # the warning below always reaches `docker compose logs api`.
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(logging.Formatter("%(levelname)s:     [%(name)s] %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.WARNING)


def warn_if_default_jwt_secret(secret: str) -> bool:
    """Logs a prominent WARNING if JWT_SECRET is still the dev default that is
    committed to this repository -- with it, anyone who has read the source can
    forge valid tokens, including ADMIN ones. Deliberately does not refuse to start:
    local dev and the test suite rely on the default. Returns True if it warned."""
    if secret != DEFAULT_DEV_JWT_SECRET:
        return False
    banner = "!" * 78
    logger.warning(
        "\n%s\n"
        "SECURITY WARNING: JWT_SECRET is the built-in development default (%r).\n"
        "That value is committed to the source repository, so anyone who has seen\n"
        "the code can FORGE login tokens for any account, including ADMIN.\n"
        "Set JWT_SECRET in .env to a long random value (e.g. `openssl rand -hex 32`)\n"
        "and restart: docker compose up -d api\n"
        "%s",
        banner, DEFAULT_DEV_JWT_SECRET, banner,
    )
    return True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    warn_if_default_jwt_secret(settings.jwt_secret)
    yield


app = FastAPI(title="CityKart Asset Manager API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(holders_router)
app.include_router(masters_router)
app.include_router(numbering_router)
app.include_router(assets_router)
app.include_router(lifecycle_router)
app.include_router(reports_router)
app.include_router(documents_router)
app.include_router(imports_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
