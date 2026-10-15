"""Security IF-10 (VAPT 2026-10): every read from the ERP warehouse is bounded -- connect timeout, server-side
statement timeout, read-only session AND read-only transaction, application_name=ckam -- and a read that runs
too long becomes the friendly ErpUnavailable (the 503 path of the ERP screens). No real ERP is contacted."""
import asyncpg
import pytest

from app.core.config import settings
from app.erp import source as erp_source
from app.erp.source import ERP_TOO_SLOW, ErpUnavailable, PgErpSource, PgReadOnly
from app.erp.warehouse import PgWarehouseReader


class _Transaction:
    def __init__(self, conn, kw):
        self.conn, self.kw = conn, kw

    async def __aenter__(self):
        self.conn.transactions.append(self.kw)
        return self

    async def __aexit__(self, *_exc):
        return False


class FakeConn:
    def __init__(self, fetch_result=None, fetch_error=None):
        self.fetch_result, self.fetch_error = fetch_result or [], fetch_error
        self.transactions, self.fetches, self.closed = [], [], False

    def transaction(self, **kw):
        return _Transaction(self, kw)

    async def fetch(self, sql, *args, timeout=None):
        self.fetches.append((sql, args, timeout))
        if self.fetch_error is not None:
            raise self.fetch_error
        return self.fetch_result

    async def close(self, timeout=None):
        self.closed = True

    def terminate(self):
        self.closed = True


@pytest.fixture
def erp_settings(monkeypatch):
    for name, value in (("po_source_host", "erp.invalid"), ("po_source_db", "dw"), ("po_source_user", "ro"),
                        ("po_source_password", "secret-ro")):
        monkeypatch.setattr(settings, name, value)


@pytest.fixture
def connect_calls(monkeypatch, erp_settings):
    calls = []
    conn = FakeConn(fetch_result=[{"x": 1}])

    async def fake_connect(**kwargs):
        calls.append(kwargs)
        return conn

    monkeypatch.setattr(erp_source.asyncpg, "connect", fake_connect)
    return calls, conn


async def test_every_connection_is_bounded_read_only_and_named(connect_calls, monkeypatch):
    calls, conn = connect_calls
    monkeypatch.setattr(settings, "erp_connect_timeout_seconds", 7)
    monkeypatch.setattr(settings, "erp_statement_timeout_seconds", 45)
    rows = await PgErpSource()._fetch("select 1")
    assert rows == [{"x": 1}]
    [kw] = calls
    assert kw["timeout"] == 7
    assert kw["server_settings"] == {"default_transaction_read_only": "on", "application_name": "ckam",
                                     "statement_timeout": "45000"}
    assert conn.transactions == [{"readonly": True}]
    assert conn.fetches[0][2] == 50                       # client-side limit a little above the server's
    assert conn.closed


async def test_the_background_copy_has_its_own_longer_limit(connect_calls, monkeypatch):
    calls, _ = connect_calls
    monkeypatch.setattr(settings, "erp_copy_statement_timeout_seconds", 300)
    await PgWarehouseReader()._fetch("select 1")
    assert calls[0]["server_settings"]["statement_timeout"] == "300000"


@pytest.mark.parametrize("error", [asyncpg.QueryCanceledError("canceling statement due to statement timeout"),
                                   TimeoutError()])
async def test_a_query_that_runs_too_long_becomes_erp_unavailable(monkeypatch, erp_settings, error):
    conn = FakeConn(fetch_error=error)
    reader = PgReadOnly()

    async def connect():
        return conn
    monkeypatch.setattr(reader, "_connect", connect)
    with pytest.raises(ErpUnavailable) as caught:
        await reader._fetch("select pg_sleep(600)")
    assert str(caught.value) == ERP_TOO_SLOW and conn.closed


async def test_a_connection_that_cannot_be_made_in_time_becomes_erp_unavailable(monkeypatch, erp_settings):
    async def slow_connect(**_kw):
        raise TimeoutError()

    monkeypatch.setattr(erp_source.asyncpg, "connect", slow_connect)
    with pytest.raises(ErpUnavailable, match="could not be reached"):
        await PgErpSource()._fetch("select 1")
