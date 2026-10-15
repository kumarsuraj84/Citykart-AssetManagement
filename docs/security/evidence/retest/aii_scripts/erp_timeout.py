"""RT IF-10: ERP connection limits, exercised at unit level with NO real ERP host.

mode "connect" (throw-away, network-less container):
  * a local black-hole TCP listener (accepts, never answers) -> the connect timeout must turn into ErpUnavailable
  * TEST-NET-1 192.0.2.1 (non-routable; the container has no network) -> ErpUnavailable
mode "stmt" (stand-in "ERP" = the local ckam-sec Postgres, read-only probe statements only):
  * statement_timeout / read-only / application_name applied to the session
  * a slow query beyond ERP_STATEMENT_TIMEOUT_SECONDS -> ErpUnavailable(ERP_TOO_SLOW)
  * a write attempt -> refused (read-only transaction)
No credentials are printed."""
import asyncio
import os
import sys
import time
from urllib.parse import urlparse

from app.core.config import settings
from app.erp import source as src
from app.erp.router import _unavailable
from app.erp.warehouse import PgWarehouseReader


async def timed(label, coro):
    t = time.monotonic()
    try:
        out = await coro
        res = f"OK {out!r}"[:160]
    except src.ErpUnavailable as exc:
        http = _unavailable(exc)
        res = f"ErpUnavailable -> HTTP {http.status_code}: {exc}"
    except Exception as exc:  # noqa: BLE001
        res = f"OTHER {type(exc).__name__}: {exc}"[:200]
    print(f"{label} | {time.monotonic() - t:.2f}s | {res}")


async def blackhole(reader, writer):
    await asyncio.sleep(3600)


async def connect_mode():
    server = await asyncio.start_server(blackhole, "127.0.0.1", 59999)
    settings.po_source_host, settings.po_source_port = "127.0.0.1", 59999
    settings.po_source_db, settings.po_source_user, settings.po_source_password = "erpdb", "ckpost", "FAKE-NOT-REAL"
    print("server_settings PgErpSource:", src.PgErpSource()._server_settings())
    print("server_settings PgWarehouseReader:", PgWarehouseReader()._server_settings())
    print("connect timeout setting:", settings.erp_connect_timeout_seconds)
    await timed("black-hole listener, default connect timeout", src.PgErpSource()._fetch("select 1"))
    settings.erp_connect_timeout_seconds = 3
    await timed("black-hole listener, ERP_CONNECT_TIMEOUT_SECONDS=3", src.PgErpSource()._fetch("select 1"))
    settings.erp_connect_timeout_seconds = 10
    settings.po_source_host, settings.po_source_port = "192.0.2.1", 5432
    await timed("TEST-NET-1 192.0.2.1 (no network in container)", src.PgErpSource()._fetch("select 1"))
    settings.po_source_host = None
    await timed("not configured", src.PgErpSource()._fetch("select 1"))
    server.close()


async def stmt_mode():
    u = urlparse(os.environ["DATABASE_URL"].replace("postgresql+asyncpg", "postgresql"))
    settings.po_source_host, settings.po_source_port = u.hostname, u.port or 5432
    settings.po_source_db, settings.po_source_user = u.path.lstrip("/"), u.username
    settings.po_source_password = u.password
    await timed("session settings (read_only, statement_timeout, application_name)", src.PgErpSource()._fetch(
        "select current_setting('transaction_read_only') ro, current_setting('default_transaction_read_only') dro, "
        "current_setting('statement_timeout') st, current_setting('application_name') app"))
    await timed("warehouse reader statement_timeout", PgWarehouseReader()._fetch("select current_setting('statement_timeout') st"))
    settings.erp_statement_timeout_seconds = 2
    await timed("pg_sleep(6) with ERP_STATEMENT_TIMEOUT_SECONDS=2", src.PgErpSource()._fetch("select pg_sleep(6)"))
    settings.erp_statement_timeout_seconds = 60
    await timed("write attempt: CREATE TEMP TABLE", src.PgErpSource()._fetch("create temp table rt_ro_probe(x int)"))
    await timed("write attempt: SET TRANSACTION READ WRITE then nextval", src.PgErpSource()._fetch(
        "select set_config('transaction_read_only','off',true)"))


if __name__ == "__main__":
    asyncio.run(connect_mode() if sys.argv[1] == "connect" else stmt_mode())
