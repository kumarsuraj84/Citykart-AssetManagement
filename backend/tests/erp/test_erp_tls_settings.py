"""Security IF-16 (closure WP-A1): TLS of the read-only ERP connection is configurable (PO_SOURCE_SSLMODE /
PO_SOURCE_SSLROOTCERT); the default is today's behaviour; a wrong mode stops the start with a plain message; the
ERP password never shows up in a repr, a log row, an error text or the diagnostics bundle. No real ERP and no
network: asyncpg.connect is replaced, or pointed at a local stand-in that cannot do TLS."""
import asyncio
import ssl

import asyncpg
import pytest
from pydantic import ValidationError

from app.core.config import ERP_SSL_MODES, Settings, settings
from app.erp import source as erp_source
from app.erp.source import ERP_CERTIFICATE_UNREADABLE, ErpUnavailable, PgErpSource, PgReadOnly, erp_ssl_argument
from app.erp.warehouse import PgWarehouseReader
from app.observability import diagnostics, redact
from app.core.db import SessionLocal
from tests.erp.test_vapt_erp_limits import FakeConn
from tests.observability.helpers import everything_logged

ERP_PASSWORD = "Erp-RO-canary-7Q2w"


@pytest.fixture
def erp(monkeypatch):
    for name, value in (("po_source_host", "erp.invalid"), ("po_source_db", "dw"), ("po_source_user", "ro"),
                        ("po_source_password", ERP_PASSWORD), ("po_source_sslmode", "prefer"),
                        ("po_source_sslrootcert", None)):
        monkeypatch.setattr(settings, name, value)
    redact.register_secret(ERP_PASSWORD)


@pytest.fixture
def connect_calls(monkeypatch, erp):
    calls = []

    async def fake_connect(**kwargs):
        calls.append(kwargs)
        return FakeConn(fetch_result=[{"x": 1}])

    monkeypatch.setattr(erp_source.asyncpg, "connect", fake_connect)
    return calls


def test_the_default_is_prefer_which_is_asyncpgs_own_default():
    assert Settings(_env_file=None).po_source_sslmode == "prefer"
    assert Settings(_env_file=None).po_source_sslrootcert is None


async def test_the_default_passes_no_ssl_argument_so_behaviour_is_unchanged(connect_calls):
    await PgErpSource()._fetch("select 1")
    [kw] = connect_calls
    assert "ssl" not in kw
    assert set(kw) == {"host", "port", "database", "user", "password", "timeout", "server_settings"}
    assert kw["server_settings"]["default_transaction_read_only"] == "on"      # IF-10 limits are kept


@pytest.mark.parametrize("mode", ["disable", "allow", "require"])
async def test_the_libpq_modes_reach_asyncpg_by_name(connect_calls, monkeypatch, mode):
    monkeypatch.setattr(settings, "po_source_sslmode", mode)
    await PgErpSource()._fetch("select 1")
    assert connect_calls[0]["ssl"] == mode


@pytest.mark.parametrize("mode,hostname", [("verify-ca", False), ("verify-full", True)])
async def test_the_verify_modes_check_the_certificate(connect_calls, monkeypatch, mode, hostname):
    monkeypatch.setattr(settings, "po_source_sslmode", mode)
    await PgWarehouseReader()._fetch("select 1")                 # the background copy uses the same connection code
    context = connect_calls[0]["ssl"]
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname is hostname
    assert connect_calls[0]["server_settings"]["default_transaction_read_only"] == "on"
    assert "statement_timeout" in connect_calls[0]["server_settings"]


async def test_a_root_certificate_file_is_used_for_the_check(connect_calls, monkeypatch, tmp_path):
    # a real CA file of this container (any PEM bundle will do for loading)
    bundle = ssl.get_default_verify_paths().cafile or ssl.get_default_verify_paths().openssl_cafile
    pem = tmp_path / "erp-ca.pem"
    pem.write_bytes(open(bundle, "rb").read())
    monkeypatch.setattr(settings, "po_source_sslmode", "verify-full")
    monkeypatch.setattr(settings, "po_source_sslrootcert", str(pem))
    await PgErpSource()._fetch("select 1")
    assert connect_calls[0]["ssl"].cert_store_stats()["x509_ca"] > 0


async def test_a_missing_certificate_file_is_the_friendly_erp_unavailable(monkeypatch, erp, tmp_path):
    monkeypatch.setattr(settings, "po_source_sslmode", "verify-ca")
    monkeypatch.setattr(settings, "po_source_sslrootcert", str(tmp_path / "missing.pem"))
    with pytest.raises(ErpUnavailable) as caught:
        await PgErpSource()._fetch("select 1")
    assert str(caught.value) == ERP_CERTIFICATE_UNREADABLE


@pytest.mark.parametrize("raw,expected", [("PREFER", "prefer"), (" verify-full ", "verify-full"), ("", "prefer"),
                                          ("Require", "require")])
def test_the_mode_is_read_forgivingly(raw, expected):
    assert Settings(_env_file=None, po_source_sslmode=raw).po_source_sslmode == expected


@pytest.mark.parametrize("bad", ["on", "true", "ssl", "verify_full", "tls1.2", "preferred"])
def test_an_unknown_mode_stops_the_start_with_a_plain_message(bad):
    with pytest.raises(ValidationError) as caught:
        Settings(_env_file=None, po_source_sslmode=bad, po_source_password=ERP_PASSWORD)
    text = str(caught.value)
    assert "PO_SOURCE_SSLMODE must be one of: " + ", ".join(ERP_SSL_MODES) in text
    assert ERP_PASSWORD not in text


def test_an_unknown_mode_from_the_environment_stops_the_start(monkeypatch):
    monkeypatch.setenv("PO_SOURCE_SSLMODE", "verify")
    with pytest.raises(ValidationError, match="PO_SOURCE_SSLMODE must be one of"):
        Settings(_env_file=None)


async def _plain_text_stand_in():
    """A local stand-in for a PostgreSQL server that cannot do TLS: answers 'N' to the SSLRequest and records every
    byte it receives."""
    received = bytearray()

    async def handle(reader, writer):
        try:
            while True:
                chunk = await asyncio.wait_for(reader.read(4096), timeout=2)
                if not chunk:
                    break
                received.extend(chunk)
                if len(received) >= 8 and received[4:8] == (80877103).to_bytes(4, "big"):
                    writer.write(b"N")                           # "no TLS here"
                    await writer.drain()
        except (asyncio.TimeoutError, ConnectionError):
            pass
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1], received


@pytest.mark.parametrize("mode", ["require", "verify-ca", "verify-full"])
async def test_a_tls_mode_refuses_a_server_without_tls_before_sending_the_password(monkeypatch, erp, mode):
    server, port, received = await _plain_text_stand_in()
    monkeypatch.setattr(settings, "po_source_host", "127.0.0.1")
    monkeypatch.setattr(settings, "po_source_port", port)
    monkeypatch.setattr(settings, "po_source_sslmode", mode)
    monkeypatch.setattr(settings, "erp_connect_timeout_seconds", 3)
    try:
        with pytest.raises(ErpUnavailable) as caught:
            await PgErpSource()._fetch("select 1")
    finally:
        server.close()
        await server.wait_closed()
    assert "could not be reached" in str(caught.value) and ERP_PASSWORD not in str(caught.value)
    assert bytes(received[4:8]) == (80877103).to_bytes(4, "big")         # only the TLS request was sent ...
    assert b"ro\x00" not in bytes(received) and ERP_PASSWORD.encode() not in bytes(received)   # ... no login


def test_the_password_is_not_in_the_settings_repr_or_the_connect_arguments_repr(erp):
    assert ERP_PASSWORD not in repr(settings) and ERP_PASSWORD not in str(settings)
    assert settings.jwt_secret not in repr(settings)
    assert "po_source_sslmode='prefer'" in repr(settings)
    assert "ckam_dev_pw" not in repr(Settings(_env_file=None))


async def test_the_password_never_reaches_logs_or_the_diagnostics_bundle(monkeypatch, erp):
    async def refused(**_kw):
        raise asyncpg.InvalidPasswordError(f"password authentication failed (password={ERP_PASSWORD})")

    monkeypatch.setattr(erp_source.asyncpg, "connect", refused)
    monkeypatch.setattr(settings, "po_source_sslmode", "verify-full")
    with pytest.raises(ErpUnavailable) as caught:
        await PgErpSource()._fetch("select 1")
    assert ERP_PASSWORD not in str(caught.value)
    async with SessionLocal() as session:
        bundle = await diagnostics.bundle(session)
    assert bundle["config"]["erp_tls_mode"] == "verify-full"
    assert bundle["config"]["erp_tls_root_certificate_set"] is False
    assert ERP_PASSWORD not in str(bundle)
    assert ERP_PASSWORD not in await everything_logged()


def test_the_reader_base_class_builds_the_same_arguments(erp, monkeypatch):
    monkeypatch.setattr(settings, "po_source_sslmode", "require")
    assert PgReadOnly().connect_arguments()["ssl"] == "require"
    monkeypatch.setattr(settings, "po_source_sslmode", "prefer")
    assert erp_ssl_argument() is None
