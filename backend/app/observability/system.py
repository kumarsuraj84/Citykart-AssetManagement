"""What the running application is (version, environment, migration state, safe configuration), and the
system events of its start and stop."""
from __future__ import annotations

import os
import platform
import sys
from functools import lru_cache
from importlib import metadata
from pathlib import Path

from sqlalchemy import text

from app.core import db as core_db
from app.core.config import DEFAULT_DEV_JWT_SECRET, settings
from app.observability import filelog, writer

BACKEND_DIR = Path(__file__).resolve().parents[2]
KEY_PACKAGES = ("fastapi", "starlette", "sqlalchemy", "asyncpg", "pydantic", "pydantic-settings", "uvicorn",
                "alembic", "python-jose", "argon2-cffi", "openpyxl")


@lru_cache(maxsize=1)
def app_version() -> str:
    """APP_VERSION, else GIT_COMMIT from the environment (a Docker build argument), else the first line of a
    VERSION file in the backend folder (the release script can write one), else "unknown"."""
    for value in (settings.app_version, os.environ.get("GIT_COMMIT")):
        if value and value.strip():
            return value.strip()[:64]
    for candidate in (BACKEND_DIR / "VERSION", BACKEND_DIR.parent / "VERSION"):
        try:
            line = candidate.read_text(encoding="utf-8").strip().splitlines()[0].strip()
            if line:
                return line[:64]
        except (OSError, IndexError):
            continue
    return "unknown"


def code_heads() -> list[str]:
    """The Alembic head(s) of the code that is running (normally exactly one)."""
    try:
        from alembic.script import ScriptDirectory
        return list(ScriptDirectory(str(BACKEND_DIR / "app" / "alembic")).get_heads())
    except Exception:
        return []


async def db_head() -> str | None:
    try:
        async with core_db.engine.connect() as conn:
            rows = (await conn.execute(text("select version_num from alembic_version"))).scalars().all()
        return ",".join(sorted(rows)) if rows else None
    except Exception:
        return None


async def migration_state() -> dict:
    heads = code_heads()
    current = await db_head()
    code = ",".join(sorted(heads)) if heads else None
    return {"code_head": code, "db_head": current, "matches": code is not None and code == current,
            "pending": code is not None and current is not None and code != current}


def package_versions() -> dict:
    out = {"python": sys.version.split()[0], "platform": platform.platform(terse=True)}
    for name in KEY_PACKAGES:
        try:
            out[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            out[name] = None
    return out


def safe_config() -> dict:
    """Configuration that is safe to show (never a secret, a password or a database URL)."""
    return {
        "environment_name": settings.environment_name,
        "log_level": settings.log_level,
        "log_dir": filelog.directory() or settings.log_dir,
        "log_dir_problem": filelog.problem(),
        "log_slow_request_ms": settings.log_slow_request_ms,
        "log_slow_sql_ms": settings.log_slow_sql_ms,
        "log_retention_days": settings.log_retention_days,
        "trusted_proxies_set": bool(settings.trusted_proxies.strip()),
        "base_url": settings.base_url,
        "cookie_secure": settings.cookie_secure,
        "frontend_served_by_api": bool(settings.frontend_dist_dir),
        "jwt_access_minutes": settings.jwt_access_minutes,
        "jwt_refresh_hours": settings.jwt_refresh_hours,
        # (named without "secret" / "password" so the redaction does not hide these yes/no flags)
        "jwt_signing_key_is_placeholder": settings.jwt_secret in (DEFAULT_DEV_JWT_SECRET, "change_me_too"),
        "jwt_signing_key_long_enough": len(settings.jwt_secret or "") >= 32,
        "erp_configured": bool(settings.po_source_host and settings.po_source_db and settings.po_source_user),
        "erp_login_complete": bool(settings.po_source_password),
        "erp_sync_enabled": settings.erp_sync_enabled,
        "erp_sync_check_minutes": settings.erp_sync_check_minutes,
        "database_host": core_db.engine.url.host,
        "database_name": core_db.engine.url.database,
    }


async def on_startup() -> None:
    state = await migration_state()
    await writer.system("startup", "app_started", f"CKAM started (version {app_version()}, {settings.environment_name}).",
                        details={"version": app_version(), "environment": settings.environment_name,
                                 "migration": state, "packages": package_versions(), "config": safe_config()})
    if state["code_head"] and state["db_head"] != state["code_head"]:
        await writer.system(
            "migration", "head_mismatch",
            f"The database is at migration {state['db_head']} but this code expects {state['code_head']}. "
            "Run `alembic upgrade head` (after a backup).", level="WARNING", details=state)
    if filelog.problem():
        await writer.system("config", "log_dir_unwritable",
                            f"The log directory {settings.log_dir} cannot be written ({filelog.problem()}); "
                            "log lines go to the console instead.", level="WARNING",
                            details={"log_dir": settings.log_dir})


async def on_shutdown() -> None:
    await writer.system("shutdown", "app_stopped", f"CKAM stopped (version {app_version()}).",
                        details={"version": app_version()})
