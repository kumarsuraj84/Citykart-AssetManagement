"""S8: error_log rows -- unexpected errors (redacted stack and context, fingerprint), database errors, slow
requests and slow SQL -- and logging that never breaks a request."""
import pytest
from fastapi import Body, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import DataError, IntegrityError, OperationalError

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.lifecycle.state_machine import LifecycleError
from app.main import app as real_app
from app.observability import writer
from app.observability.middleware import RequestContextMiddleware
from app.observability.models import AuditLog, ErrorLog, SystemEvent
from tests.core.s0_world import build_world, login
from tests.observability.helpers import audit, errors, everything_logged, system_events

TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.dGhpcy1pcy1hLXNpZ25hdHVyZQ"


def _app_raising(exc: Exception) -> FastAPI:
    mini = FastAPI()
    register_exception_handlers(mini)
    mini.add_middleware(RequestContextMiddleware)

    @mini.post("/boom/{thing_id}")
    async def boom(thing_id: int, payload: dict | None = Body(default=None)):
        raise exc
    return mini


async def _post(app, **kwargs):
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as c:
        return await c.post("/boom/7?password=hunter22&page=2", headers={"Authorization": f"Bearer {TOKEN}",
                                                                          "Cookie": "refresh_token=abc.def.ghi"},
                            **kwargs)


class _Orig(Exception):
    pass


async def test_an_unexpected_error_is_one_row_with_a_redacted_stack_and_context():
    resp = await _post(_app_raising(RuntimeError("database url postgresql://ckam:ckam_dev_pw@db/ckam broke")),
                       json={"password": "Hunter2!", "name": "x" * 50, "lines": [1, 2, 3]})
    assert resp.status_code == 500
    rid = resp.headers["x-request-id"]
    [row] = await errors(ErrorLog.request_id == rid)
    assert (row.level, row.source, row.kind, row.exception_type, row.status_code) == ("ERROR", "api", "exception",
                                                                                      "RuntimeError", 500)
    assert row.route == "/boom/{thing_id}" and row.method == "POST" and len(row.fingerprint) == 40
    assert "Traceback" in row.stack and "ckam_dev_pw" not in row.stack and "ckam_dev_pw" not in row.message
    assert row.context["path_params"] == {"thing_id": "7"}
    assert row.context["query"] == {"password": "***", "page": "2"}
    assert row.context["body"]["keys"] == {"password": "***", "name": {"type": "text", "length": 50},
                                          "lines": {"type": "list", "items": 3}}
    text = await everything_logged()
    for secret in ("Hunter2!", "hunter22", TOKEN, "abc.def.ghi", "ckam_dev_pw"):
        assert secret not in text, secret


async def test_the_same_fault_twice_has_the_same_fingerprint():
    mini = _app_raising(KeyError("missing"))
    first, second = await _post(mini), await _post(mini)
    rows = await errors(ErrorLog.exception_type == "KeyError")
    assert len(rows) == 2 and rows[0].fingerprint == rows[1].fingerprint
    assert first.headers["x-request-id"] != second.headers["x-request-id"]


async def test_a_database_conflict_is_a_warning_row_and_a_plain_answer():
    resp = await _post(_app_raising(IntegrityError("INSERT ...", {}, _Orig("duplicate key"))))
    assert resp.status_code == 422 and resp.json()["request_id"] == resp.headers["x-request-id"]
    [row] = await errors()
    assert (row.level, row.source, row.exception_type) == ("WARNING", "db", "IntegrityError")
    assert row.message == "These values could not be saved together. Check them and try again."


async def test_a_handled_database_error_is_grouped_by_the_route_template():
    mini = _app_raising(IntegrityError("INSERT ...", {}, _Orig("duplicate key")))
    async with AsyncClient(transport=ASGITransport(app=mini, raise_app_exceptions=False), base_url="http://test") as c:
        assert (await c.post("/boom/1")).status_code == 422
        assert (await c.post("/boom/2")).status_code == 422
    first, second = await errors()
    assert first.route == second.route == "/boom/{thing_id}"
    assert first.fingerprint == second.fingerprint and first.context["path_params"] == {"thing_id": "1"}


async def test_a_nul_character_reaching_the_database_is_suspicious_input():
    resp = await _post(_app_raising(DataError("INSERT ...", {}, _Orig("invalid byte sequence for encoding UTF8: 0x00"))))
    assert resp.status_code == 422
    assert [r.action for r in await audit(AuditLog.request_id == resp.headers["x-request-id"])] == ["SUSPICIOUS_INPUT"]
    assert (await errors())[0].level == "WARNING"


async def test_a_lost_database_is_critical_and_its_return_is_a_system_event(client):
    resp = await _post(_app_raising(OperationalError("SELECT 1", {}, _Orig("connection refused"))))
    assert resp.status_code == 503 and resp.json()["detail"] == "The database could not be reached. Try again in a moment."
    [row] = await errors()
    assert row.level == "CRITICAL" and row.source == "db"
    assert [e.event for e in await system_events(SystemEvent.component == "db")] == ["connectivity_lost"]
    w = await build_world()
    await login(client, w, "admin")          # a request that reached the database again
    assert [e.event for e in await system_events(SystemEvent.component == "db")] == ["connectivity_lost",
                                                                                   "connectivity_restored"]


async def test_a_lifecycle_refusal_nobody_caught_is_a_warning_with_the_sentence():
    resp = await _post(_app_raising(LifecycleError("This asset is reported lost, so it cannot be moved.")))
    assert resp.status_code == 422 and resp.json()["detail"] == "This asset is reported lost, so it cannot be moved."
    [row] = await errors()
    assert row.level == "WARNING" and row.exception_type == "LifecycleError"


async def test_expected_business_refusals_are_not_error_rows(client):
    w = await build_world()
    h = await login(client, w, "admin")
    bad = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co"], "po_number": "", "po_date": "2026-01-01", "cost_center_id": w["cc"]})
    missing = await client.get("/api/assets/999999", headers=h)
    assert bad.status_code == 422 and missing.status_code == 404
    assert await errors() == []


async def test_a_slow_request_is_one_throttled_warning(client, monkeypatch):
    monkeypatch.setattr(settings, "log_slow_request_ms", 0.001)
    for _ in range(3):
        assert (await client.get("/api/health")).status_code == 200
    rows = await errors(ErrorLog.kind == "slow_request")
    assert len(rows) == 1
    assert rows[0].level == "WARNING" and rows[0].route == "/api/health" and "took" in rows[0].message
    assert rows[0].context["duration_ms"] > 0


async def test_slow_sql_is_logged_without_its_values(client, monkeypatch):
    from app.observability import sqltiming

    monkeypatch.setattr(settings, "log_slow_sql_ms", 0.0001)
    w = await build_world()
    await login(client, w, "admin")
    rows = await errors(ErrorLog.kind == "slow_sql")
    assert rows and all(r.source == "db" and r.context["statement"] for r in rows)
    assert all("'" not in r.context["statement"] for r in rows)
    assert sqltiming.RECENT_SLOW


async def test_slow_sql_outside_a_request_is_remembered_without_its_literals(monkeypatch):
    from sqlalchemy import text

    from app.core.db import SessionLocal
    from app.observability import sqltiming

    monkeypatch.setattr(settings, "log_slow_sql_ms", 0.0001)
    sqltiming.RECENT_SLOW.clear()
    async with SessionLocal() as s:
        await s.execute(text("select 'secret-literal' as x, 4242 as n"))
    last = sqltiming.RECENT_SLOW[-1]
    assert last["request_id"] is None and last["route"] is None
    assert "secret-literal" not in last["statement"] and "4242" not in last["statement"]


async def test_a_logging_failure_never_breaks_the_request(client, monkeypatch, capsys):
    w = await build_world()

    class Broken:
        def __call__(self, *args, **kwargs):
            raise ConnectionError("log database gone")

    from types import SimpleNamespace

    monkeypatch.setattr(writer, "_reported", set())
    monkeypatch.setattr(writer, "core_db", SimpleNamespace(SessionLocal=Broken()))   # only the log writes break
    resp = await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "wrong"})
    assert resp.status_code == 401
    err = capsys.readouterr().err
    assert err.count("CKAM logging: could not write audit_log") == 1


@pytest.mark.parametrize("value", [None, "plain"])
async def test_the_writer_helpers_never_raise(value):
    await writer.security("TEST", value or "x", changes={"password": value})
    await writer.warning("unit", value or "x")
    await writer.system("config", "unit", value or "x")


async def test_real_app_error_answer_has_no_internal_details(monkeypatch):
    import app.assets.tools_router as tools

    w = await build_world()

    async def broken(*args, **kwargs):
        raise ZeroDivisionError("secret internal detail")

    monkeypatch.setattr(tools, "add_assets_batch", broken)
    async with AsyncClient(transport=ASGITransport(app=real_app, raise_app_exceptions=False), base_url="http://t") as c:
        resp = await c.post("/api/assets/batch", headers=await login(c, w, "owner"), json={
            "item_id": 1, "quantity": 1, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]})
    assert resp.status_code == 500 and "secret internal detail" not in resp.text and "Traceback" not in resp.text
