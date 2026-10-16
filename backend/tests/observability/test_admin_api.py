"""S8: the admin Logs / Diagnostics API -- head-office admin only, filters, paging, grouping, correlation by
request id, entity history, export, the diagnostics bundle, database diagnostics."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import insert

from app.core.config import settings
from app.core.db import SessionLocal
from app.observability import admin_router, diagnostics
from app.observability.models import AuditLog, ClientReport, ErrorLog, SystemEvent
from tests.core.s0_world import PASSWORD, build_world, login
from tests.observability.helpers import audit, everything_logged

ENDPOINTS = [
    ("get", "/api/admin/logs/audit"), ("get", "/api/admin/logs/errors"), ("get", "/api/admin/logs/errors?group=true"),
    ("get", "/api/admin/logs/system"), ("get", "/api/admin/logs/client-reports"),
    ("get", "/api/admin/logs/entity/vendor/1"), ("get", "/api/admin/logs/request/abc"),
    ("get", "/api/admin/logs/export?kind=audit"), ("get", "/api/admin/diagnostics/bundle"),
    ("get", "/api/admin/diagnostics/db"), ("get", "/api/admin/diagnostics/health"),
]


@pytest.mark.parametrize("method,path", ENDPOINTS)
async def test_only_the_head_office_admin_may_use_them(client, method, path):
    w = await build_world()
    for who in ("op_both", "admin"):
        refused = await getattr(client, method)(path, headers=await login(client, w, who))
        assert refused.status_code == 403, (who, path)
        assert refused.json()["detail"] == "Only the head-office admin can do this."
    assert (await getattr(client, method)(path)).status_code == 401
    ok = await getattr(client, method)(path, headers=await login(client, w, "owner"))
    assert ok.status_code == 200, (path, ok.text)


async def test_every_use_is_itself_audited(client):
    w = await build_world()
    resp = await client.get("/api/admin/logs/audit", headers=await login(client, w, "owner"),
                            params={"category": "security"})
    [row] = await audit(AuditLog.request_id == resp.headers["x-request-id"])
    assert (row.category, row.action) == ("ACCESS", "LOGS_VIEWED")
    assert row.changes["filters"] == {"category": "security"}


async def _seed_audit(n: int = 5):
    now = datetime.now(timezone.utc)
    async with SessionLocal() as s:
        await s.execute(insert(AuditLog), [
            {"at": now - timedelta(days=i), "request_id": f"seed-{i}", "source": "api", "actor_id": 7,
             "actor_name": "Seeder", "category": "DATA" if i % 2 else "SECURITY", "action": "UPDATE" if i % 2 else "LOGIN",
             "entity": "vendor", "entity_id": str(100 + (i % 2)), "summary": f"Seed row {i} about GSTIN", "outcome": "OK",
             "is_head_office_admin": False} for i in range(n)])
        await s.commit()


async def test_audit_filters_paging_and_newest_first(client):
    w = await build_world()
    h = await login(client, w, "owner")
    await _seed_audit(6)
    page = await client.get("/api/admin/logs/audit", headers=h, params={"actor_id": 7, "limit": 2})
    assert page.status_code == 200 and page.headers["X-Total-Count"] == "6"
    assert [r["request_id"] for r in page.json()] == ["seed-0", "seed-1"]
    nxt = await client.get("/api/admin/logs/audit", headers=h, params={"actor_id": 7, "limit": 2, "offset": 2})
    assert [r["request_id"] for r in nxt.json()] == ["seed-2", "seed-3"]
    data = await client.get("/api/admin/logs/audit", headers=h, params={"category": "data", "actor_id": 7})
    assert {r["category"] for r in data.json()} == {"DATA"} and data.headers["X-Total-Count"] == "3"
    one = await client.get("/api/admin/logs/audit", headers=h, params={"entity": "vendor", "entity_id": "100"})
    assert {r["entity_id"] for r in one.json()} == {"100"}
    text = await client.get("/api/admin/logs/audit", headers=h, params={"q": "row 4 about"})
    assert [r["request_id"] for r in text.json()] == ["seed-4"]
    period = await client.get("/api/admin/logs/audit", headers=h, params={
        "actor_id": 7, "from": (datetime.now(timezone.utc) - timedelta(days=2, hours=12)).isoformat()})
    assert {r["request_id"] for r in period.json()} == {"seed-0", "seed-1", "seed-2"}
    day = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    one_day = await client.get("/api/admin/logs/audit", headers=h, params={"actor_id": 7, "from": day, "to": day})
    assert [r["request_id"] for r in one_day.json()] == ["seed-1"]
    assert (await client.get("/api/admin/logs/audit", headers=h, params={"limit": 201})).status_code == 422
    assert (await client.get("/api/admin/logs/audit", headers=h, params={"category": "nope"})).status_code == 422
    assert (await client.get("/api/admin/logs/audit", headers=h, params={"from": "yesterday"})).status_code == 422


async def _seed_errors():
    now = datetime.now(timezone.utc)
    async with SessionLocal() as s:
        await s.execute(insert(ErrorLog), [
            {"at": now - timedelta(minutes=i), "request_id": f"err-{i}", "level": "ERROR", "source": "api",
             "kind": "exception", "exception_type": "KeyError" if i < 3 else "ValueError", "message": f"m{i}",
             "route": "/api/x", "fingerprint": "fp-key" if i < 3 else "fp-value", "stack": "Traceback..."}
            for i in range(5)])
        await s.commit()


async def test_errors_grouped_by_fingerprint(client):
    w = await build_world()
    h = await login(client, w, "owner")
    await _seed_errors()
    resp = await client.get("/api/admin/logs/errors", headers=h, params={"group": "true"})
    assert resp.status_code == 200 and resp.headers["X-Total-Count"] == "2"
    groups = {g["fingerprint"]: g for g in resp.json()}
    assert groups["fp-key"]["count"] == 3 and groups["fp-key"]["last_request_id"] == "err-0"
    assert groups["fp-key"]["exception_type"] == "KeyError" and groups["fp-key"]["sample_route"] == "/api/x"
    assert groups["fp-value"]["count"] == 2 and groups["fp-value"]["first_seen"] < groups["fp-value"]["last_seen"]
    flat = await client.get("/api/admin/logs/errors", headers=h, params={"fingerprint": "fp-value"})
    assert flat.headers["X-Total-Count"] == "2"


async def test_everything_of_one_request_in_one_answer(client, monkeypatch):
    import app.assets.tools_router as tools
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    w = await build_world()

    async def broken(*args, **kwargs):
        raise RuntimeError("correlate me")

    monkeypatch.setattr(tools, "add_assets_batch", broken)
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://t") as c:
        failed = await c.post("/api/assets/batch", headers=await login(c, w, "admin"), json={
            "item_id": 1, "quantity": 1, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]})
    rid = failed.headers["x-request-id"]
    h = await login(client, w, "admin")
    report = await client.post("/api/client-reports", headers=h, json={
        "kind": "API_ERROR", "message": "Request failed: 500", "route": "/assets/add", "request_id": rid})
    assert report.status_code == 201
    from app.observability import filelog
    from tests.observability.helpers import flush_logs

    flush_logs()
    got = await client.get(f"/api/admin/logs/request/{rid}", headers=await login(client, w, "owner"))
    assert got.status_code == 200
    body = got.json()
    assert body["found"] is True and body["request_id"] == rid
    assert [e["exception_type"] for e in body["errors"]] == ["RuntimeError"]
    assert [r["message"] for r in body["client_reports"]] == ["Request failed: 500"]
    assert [line["status"] for line in body["access_log"]] == [500]
    by_reference = await client.get(f"/api/admin/logs/request/{report.json()['reference']}",
                                    headers=await login(client, w, "owner"))
    assert [r["kind"] for r in by_reference.json()["client_reports"]] == ["API_ERROR"]
    assert filelog.directory()


async def test_security_rows_are_apart_in_the_correlation(client):
    await build_world()
    failed = await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "nope"})
    owner = await client.post("/api/auth/login", json={"login_id": "S0OWN", "password": PASSWORD})
    h = {"Authorization": f"Bearer {owner.json()['access_token']}"}
    body = (await client.get(f"/api/admin/logs/request/{failed.headers['x-request-id']}", headers=h)).json()
    assert [r["action"] for r in body["security"]] == ["LOGIN_FAILED"] and body["audit"] == []


async def test_the_history_of_one_record(client):
    w = await build_world()
    h = await login(client, w, "owner")
    for name in ("Vendor One", "Vendor Two"):
        assert (await client.put(f"/api/masters/vendors/{w['vendor']}", headers=h, json={"name": name})).status_code == 200
    resp = await client.get(f"/api/admin/logs/entity/vendor/{w['vendor']}", headers=h)
    assert resp.status_code == 200 and resp.headers["X-Total-Count"] == "3"      # created (script) + 2 updates
    assert [r["summary"] for r in resp.json()[:2]] == ["Vendor 'Vendor Two' updated: name.",
                                                       "Vendor 'Vendor One' updated: name."]


async def test_system_events_and_client_reports_lists(client):
    w = await build_world()
    h = await login(client, w, "owner")
    async with SessionLocal() as s:
        await s.execute(insert(SystemEvent), [{"level": "INFO", "component": "retention", "event": "purge_finished",
                                               "message": "done"},
                                              {"level": "ERROR", "component": "erp_sync", "event": "sync_failed",
                                               "message": "down"}])
        await s.commit()
    resp = await client.get("/api/admin/logs/system", headers=h, params={"component": "erp_sync"})
    assert [e["event"] for e in resp.json()] == ["sync_failed"]
    level = await client.get("/api/admin/logs/system", headers=h, params={"level": "error"})
    assert level.headers["X-Total-Count"] == "1"


async def test_a_client_report_can_be_marked_reviewed(client):
    w = await build_world()
    made = await client.post("/api/client-reports", headers=await login(client, w, "op_it"),
                             json={"kind": "USER_REPORT", "message": "The label printed blank", "route": "/labels"})
    h = await login(client, w, "owner")
    new = await client.get("/api/admin/logs/client-reports", headers=h, params={"status": "new"})
    assert [r["id"] for r in new.json()] == [made.json()["id"]]
    resp = await client.patch(f"/api/admin/logs/client-reports/{made.json()['id']}", headers=h, json={"status": "REVIEWED"})
    assert resp.status_code == 200 and resp.json()["status"] == "REVIEWED" and resp.json()["reviewed_by"] == w["owner"]
    assert (await client.get("/api/admin/logs/client-reports", headers=h, params={"status": "new"})).json() == []
    assert (await client.patch("/api/admin/logs/client-reports/999999", headers=h,
                               json={"status": "REVIEWED"})).status_code == 404
    assert (await client.patch(f"/api/admin/logs/client-reports/{made.json()['id']}", headers=h,
                               json={"status": "DONE"})).status_code == 422


@pytest.mark.parametrize("fmt", ["jsonl", "csv"])
async def test_export_streams_redacted_rows_capped_and_is_audited(client, monkeypatch, fmt):
    w = await build_world()
    h = await login(client, w, "owner")
    await _seed_audit(5)
    async with SessionLocal() as s:
        await s.execute(insert(AuditLog), [{"source": "api", "category": "DATA", "action": "UPDATE", "summary":
                                            "token=abc123secret leaked", "changes": {"password": "plain"},
                                            "outcome": "OK", "is_head_office_admin": False}])
        await s.commit()
    monkeypatch.setattr(admin_router, "EXPORT_CAP", 4)
    resp = await client.get("/api/admin/logs/export", headers=h, params={"kind": "audit", "format": fmt})
    assert resp.status_code == 200
    assert resp.headers["X-Row-Count"] == "4" and resp.headers["X-Truncated"] == "true"
    assert resp.headers["x-request-id"]
    if fmt == "jsonl":
        lines = [json.loads(line) for line in resp.text.splitlines() if line.strip()]
        assert len(lines) == 4 and {"id", "at", "summary", "changes"} <= set(lines[0])
    else:
        lines = resp.text.strip().splitlines()
        assert len(lines) == 5 and lines[0].startswith("id,at,request_id")
    [row] = [r for r in await audit(AuditLog.request_id == resp.headers["x-request-id"])]
    assert (row.category, row.action, row.changes["rows"]) == ("EXPORT", "EXPORT", 4)
    monkeypatch.setattr(admin_router, "EXPORT_CAP", 100)
    full = await client.get("/api/admin/logs/export", headers=h, params={"kind": "audit"})
    assert "abc123secret" not in full.text and '"plain"' not in full.text


async def test_the_diagnostics_bundle_has_everything_and_no_secrets(client):
    w = await build_world()
    await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "Wrong-Secret-9"})
    await _seed_errors()
    h = await login(client, w, "owner")
    resp = await client.get("/api/admin/diagnostics/bundle", headers=h, params={"hours": 2})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    for key in ("generated_at", "app", "migration", "config", "erp_sync", "database", "table_counts", "error_groups",
                "security_events", "system_events", "new_client_reports", "slow", "markdown"):
        assert key in body, key
    # Security migrations (intended change): the head is now b5d7f9a1c3e5 (AU-06 auth_session, closure WP-A2).
    assert body["migration"]["code_head"] == "b5d7f9a1c3e5" and body["database"]["connected"] is True
    assert body["app"]["packages"]["fastapi"] and body["table_counts"]["asset_user"] >= 10
    assert len(body["error_groups"]) == 2 and body["error_groups"][0]["stack"]
    assert any(e["action"] == "LOGIN_FAILED" for e in body["security_events"])
    md = body["markdown"]
    assert md.startswith("# CKAM diagnostics bundle") and "## Error groups" in md and "KeyError x3" in md
    text = json.dumps(body)
    for secret in (settings.jwt_secret, "ckam_dev_pw", "Wrong-Secret-9", PASSWORD):
        assert secret not in text, secret
    [row] = await audit(AuditLog.request_id == resp.headers["x-request-id"])
    assert row.action == "DIAGNOSTICS_BUNDLE"


async def test_the_bundle_can_include_one_request(client):
    w = await build_world()
    failed = await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "nope"})
    h = await login(client, w, "owner")
    body = (await client.get("/api/admin/diagnostics/bundle", headers=h,
                             params={"request_id": failed.headers["x-request-id"]})).json()
    assert body["request"]["security"][0]["action"] == "LOGIN_FAILED"
    assert f"## Request {failed.headers['x-request-id']}" in body["markdown"]


async def test_database_diagnostics_report_what_they_may_not_read(client, monkeypatch):
    w = await build_world()
    h = await login(client, w, "owner")
    body = (await client.get("/api/admin/diagnostics/db", headers=h)).json()
    assert body["connected"] is True and body["server_version"]
    assert isinstance(body["connections_by_state"], list) and isinstance(body["largest_tables"], list)
    assert "slow_statement_logging_on" in body

    real = diagnostics._query

    async def picky(conn, sql, params=None):
        if "pg_stat_replication" in sql or "pg_stat_activity" in sql:
            from sqlalchemy.exc import ProgrammingError

            class Denied(Exception):
                sqlstate = "42501"
            raise ProgrammingError(sql, params, Denied("permission denied for view pg_stat_activity"))
        return await real(conn, sql, params)

    async def guarded(conn, sql, params=None):
        try:
            return await picky(conn, sql, params)
        except Exception as exc:
            return diagnostics._denied(exc)

    monkeypatch.setattr(diagnostics, "_query", guarded)
    body = (await client.get("/api/admin/diagnostics/db", headers=h)).json()
    assert body["connected"] is True
    assert body["connections_by_state"] == "not permitted" and body["replication"] == "not permitted"
    assert isinstance(body["largest_tables"], list)


async def test_the_health_check(client):
    w = await build_world()
    body = (await client.get("/api/admin/diagnostics/health", headers=await login(client, w, "owner"))).json()
    assert body["status"] in ("ok", "degraded")
    checks = body["checks"]
    assert checks["database"]["ok"] is True and checks["log_dir"]["ok"] is True
    assert checks["migrations"]["code_head"] == checks["migrations"]["db_head"] == "b5d7f9a1c3e5"
    assert "asset" in checks["table_counts"]


async def test_the_real_query_helper_turns_a_refusal_into_words():
    from app.core.db import engine

    async with engine.connect() as conn:
        assert await diagnostics._query(conn, "select * from table_that_does_not_exist") == "failed (ProgrammingError)"
        assert await diagnostics._query(conn, "select 1 as one") == [{"one": 1}]
