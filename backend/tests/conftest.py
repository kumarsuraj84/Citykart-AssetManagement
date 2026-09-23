import os

import pytest
import pytest_asyncio
from sqlalchemy import text
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.db import Base, engine

TEST_DATABASE_SUFFIX = "_test"
ALLOW_TRUNCATE_ENV_VAR = "CKAM_ALLOW_TEST_TRUNCATE"


class UnsafeTestDatabaseError(RuntimeError):
    """Raised when DATABASE_URL doesn't look like a dedicated test database."""


def _assert_safe_test_database(database_name: str | None, allow_override: bool) -> None:
    """Refuse to let the test suite point at a non-test database.

    `_truncate_tables` below wipes every application table before every
    test. docker-compose.yml's `api` service (and a plain `.env`) points
    DATABASE_URL at the single persistent `ckam` database the dev/demo
    stack actually runs on -- there is no separate test database by
    default. Running pytest against that DATABASE_URL previously wiped
    real production/demo data with no warning. Require the database name
    to end in "_test" (e.g. "ckam_test"), or an explicit
    CKAM_ALLOW_TEST_TRUNCATE=1 opt-in for setups that name their test
    database differently.
    """
    if allow_override:
        return
    name = database_name or ""
    if name.endswith(TEST_DATABASE_SUFFIX):
        return
    raise UnsafeTestDatabaseError(
        f"Refusing to run tests against database {name!r}: it does not look like a "
        f"dedicated test database (name must end with {TEST_DATABASE_SUFFIX!r}). "
        "This test suite TRUNCATEs every table before every test. Point DATABASE_URL "
        "at a dedicated test database (e.g. 'ckam_test'), or set "
        f"{ALLOW_TRUNCATE_ENV_VAR}=1 if you are certain this database is safe to wipe."
    )


@pytest.fixture(autouse=True, scope="session")
def _verify_safe_test_database():
    """Runs once per test session, before any test (and before the first
    _truncate_tables call): see _assert_safe_test_database for why."""
    _assert_safe_test_database(
        engine.url.database, os.environ.get(ALLOW_TRUNCATE_ENV_VAR) == "1"
    )


# loop_scope="session" matches asyncio_default_test_loop_scope (see the
# comment on that setting in pyproject.toml): this fixture uses the same
# app.core.db.engine (and its pooled asyncpg connections) as the tests, so it
# must run on the same event loop the tests run on, not pytest-asyncio's
# per-function default fixture loop, or connection checkout fails with
# "attached to a different loop".
@pytest_asyncio.fixture(autouse=True, scope="function", loop_scope="session")
async def _truncate_tables():
    """Give every test a clean, empty database.

    Truncates all application tables (everything registered on
    Base.metadata) before each test function runs, so tests never need to
    hand-pick "unique" data to avoid colliding with leftovers from a
    previous test run or a previous test module. `alembic_version` is
    excluded since it is Alembic's own bookkeeping table, not app data.
    CASCADE handles FK ordering automatically.
    """
    # Base.metadata.tables (not sorted_tables) since CASCADE handles FK
    # ordering for us and this app has mutually-dependent FKs (AuditMixin's
    # created_by/updated_by -> holder.id) that sorted_tables can't order.
    table_names = [name for name in Base.metadata.tables if name != "alembic_version"]
    if table_names:
        quoted = ", ".join(f'"{name}"' for name in table_names)
        async with engine.begin() as conn:
            await conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE;"))
    yield


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
