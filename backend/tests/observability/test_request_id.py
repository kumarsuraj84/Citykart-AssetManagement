"""S8: every response carries X-Request-ID, error bodies carry request_id, and the request's context knows
who is asking."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.observability import context
from app.observability.models import AuditLog, ErrorLog
from tests.core.s0_world import build_world, login
from tests.observability.helpers import audit, errors, flush_logs, log_lines


def _rid(resp) -> str:
    value = resp.headers.get("x-request-id")
    assert value, f"no X-Request-ID on {resp.status_code} {resp.request.url}"
    return value


async def test_a_successful_answer_has_a_fresh_request_id(client):
    first = await client.get("/api/health")
    second = await client.get("/api/health")
    assert first.status_code == 200
    assert len(_rid(first)) == 32 and _rid(first) != _rid(second)


@pytest.mark.parametrize("path,code", [("/api/assets", 401), ("/api/does-not-exist", 404), ("/assets/missing.js", 404)])
async def test_refusals_and_not_found_carry_the_id_in_header_and_body(client, path, code):
    resp = await client.get(path)
    assert resp.status_code == code
    assert resp.json()["request_id"] == _rid(resp)


async def test_validation_errors_keep_the_s0_shape_plus_request_id(client):
    resp = await client.post("/api/auth/login", json={})
    assert resp.status_code == 422
    body = resp.json()
    assert isinstance(body["detail"], str) and isinstance(body["errors"], list)
    assert body["request_id"] == _rid(resp)


async def test_a_forbidden_answer_carries_the_id(client):
    w = await build_world()
    resp = await client.get("/api/admin/logs/audit", headers=await login(client, w, "admin"))
    assert resp.status_code == 403
    assert resp.json() == {"detail": "Only the head-office admin can do this.", "request_id": _rid(resp)}


async def test_a_well_formed_incoming_id_is_kept(client):
    resp = await client.get("/api/health", headers={"X-Request-ID": "client-123.abc_X"})
    assert _rid(resp) == "client-123.abc_X"


@pytest.mark.parametrize("bad", ["has space", "x" * 65, "semi;colon", "ünïcode"])
async def test_a_malformed_incoming_id_is_replaced(client, bad):
    resp = await client.get("/api/health", headers={"X-Request-ID": bad.encode("utf-8")})
    rid = _rid(resp)
    assert rid != bad and len(rid) == 32
    uuid.UUID(hex=rid)


async def test_an_unexpected_error_answers_500_with_the_id_and_is_logged(monkeypatch):
    import app.assets.tools_router as tools

    w = await build_world()

    async def broken(*args, **kwargs):
        raise RuntimeError("boom in the batch")

    monkeypatch.setattr(tools, "add_assets_batch", broken)
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as c:
        h = await login(c, w, "owner")
        resp = await c.post("/api/assets/batch", headers=h, json={
            "item_id": 1, "quantity": 1, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"],
            "password": "should-never-be-stored"})
    assert resp.status_code == 500
    body = resp.json()
    assert body["request_id"] == _rid(resp)
    assert "Something went wrong" in body["detail"] and "boom" not in body["detail"]
    [row] = await errors(ErrorLog.request_id == body["request_id"])
    assert row.level == "ERROR" and row.exception_type == "RuntimeError" and row.status_code == 500
    assert row.route == "/api/assets/batch" and row.method == "POST" and row.actor_code == "S0OWN"


async def test_the_exception_still_reaches_the_test_client_like_starlette_does(client, monkeypatch):
    import app.assets.tools_router as tools

    w = await build_world()

    async def broken(*args, **kwargs):
        raise RuntimeError("boom again")

    monkeypatch.setattr(tools, "add_assets_batch", broken)
    with pytest.raises(RuntimeError):
        await client.post("/api/assets/batch", headers=await login(client, w, "owner"), json={
            "item_id": 1, "quantity": 1, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]})
    assert len(await errors(ErrorLog.exception_type == "RuntimeError")) == 1


async def test_an_idempotent_replay_carries_its_own_request_id(client):
    from tests.purchase_orders.s4_world import build_s4_world

    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": str(uuid.uuid4())}
    body = {"item_id": w["item_gangbox"], "quantity": 2, "company_id": w["co"], "cost_center_id": w["cc"],
            "received_into_asset_user_id": w["stock"], "invoice_date": "2026-02-01"}
    first = await client.post("/api/assets/batch", headers=h, json=body)
    again = await client.post("/api/assets/batch", headers=h, json=body)
    assert first.status_code == 201, first.text
    assert again.headers.get("Idempotency-Replay") == "true"
    assert _rid(first) != _rid(again)
    [replay] = await audit(AuditLog.request_id == _rid(again))
    assert replay.category == "ACCESS" and replay.action == "IDEMPOTENT_REPLAY"


async def test_the_authenticated_actor_is_in_the_request_context(client):
    w = await build_world()
    h = await login(client, w, "op_it")
    resp = await client.get("/api/auth/capabilities", headers=h)
    assert resp.status_code == 200
    flush_logs()
    [line] = [x for x in log_lines("app.jsonl") if x.get("request_id") == _rid(resp) and x.get("kind") == "access"]
    assert line["actor_id"] == w["op_it"] and line["role"] == "OPERATOR"
    assert line["route"] == "/api/auth/capabilities" and line["status"] == 200


async def test_set_actor_outside_a_request_does_nothing():
    assert context.current() is None
    context.set_actor(object())          # no context: silently ignored
    with context.job("unit-test") as ctx:
        assert context.request_id().startswith("job-unit-test-") and ctx.source == "job"
    assert context.current() is None
