"""S7 fix round (P1-2): the Idempotency-Key header -- a request repeated with the same key is done once.

Real sessions on the test database; "at the same moment" is asyncio.gather of two requests through the app."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.core.idempotency import BAD_KEY, BUSY, DIFFERENT, IdempotencyKey, applies, request_hash
from app.lifecycle.models import AssetEvent
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.core.s0_world import make_asset
from tests.purchase_orders.s4_world import build_s4_world, login, make_po, receipt


def key() -> str:
    return str(uuid.uuid4())


def batch_body(w, quantity=2, **over):
    body = {"item_id": w["item_chair"], "quantity": quantity, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]}
    body.update(over)
    return body


async def asset_count() -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(Asset))).scalar_one()


async def key_rows() -> list[IdempotencyKey]:
    async with SessionLocal() as s:
        return list((await s.execute(select(IdempotencyKey).order_by(IdempotencyKey.id))).scalars().all())


@pytest.fixture
def slow_batch(monkeypatch):
    """Makes Add Assets take a moment, so a second request surely arrives while the first is running."""
    import app.assets.tools_router as tools
    original = tools.add_assets_batch

    async def slow(*args, **kwargs):
        await asyncio.sleep(0.4)
        return await original(*args, **kwargs)

    monkeypatch.setattr(tools, "add_assets_batch", slow)


# ------------------------------------------------------------------ behaviour without the header

async def test_without_the_header_two_identical_requests_still_both_run(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    first = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    second = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    assert first.status_code == second.status_code == 201
    assert "Idempotency-Replay" not in second.headers
    assert await asset_count() == 4 and await key_rows() == []


# ------------------------------------------------------------------ replay

async def test_the_same_key_and_request_is_done_once_and_answered_again(client):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": key()}
    first = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    again = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    assert first.status_code == again.status_code == 201
    assert "Idempotency-Replay" not in first.headers
    assert again.headers["Idempotency-Replay"] == "true"
    assert again.json() == first.json()
    assert await asset_count() == 2
    [row] = await key_rows()
    assert row.status_code == 201 and row.completed_at is not None and row.response_json == first.json()


async def test_key_order_and_spacing_of_the_json_body_do_not_make_it_another_request(client):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": key(), "Content-Type": "application/json"}
    body = batch_body(w)
    first = await client.post("/api/assets/batch", headers=h, content=str(body).replace("'", '"'))
    reordered = dict(reversed(list(body.items())))
    again = await client.post("/api/assets/batch", headers=h, content=str(reordered).replace("'", '"').replace(", ", " ,  "))
    assert first.status_code == 201 and again.status_code == 201 and again.headers["Idempotency-Replay"] == "true"
    assert await asset_count() == 2


async def test_two_simultaneous_requests_with_one_key_make_one_batch_and_the_second_is_told_it_is_running(client, slow_batch):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": key()}
    first, second = await asyncio.gather(
        client.post("/api/assets/batch", headers=h, json=batch_body(w)),
        client.post("/api/assets/batch", headers=h, json=batch_body(w)),
    )
    assert sorted([first.status_code, second.status_code]) == [201, 409]
    busy = first if first.status_code == 409 else second
    assert busy.json()["detail"] == BUSY
    assert await asset_count() == 2
    # once the first has finished, the same request is answered from the stored result
    late = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    assert late.status_code == 201 and late.headers["Idempotency-Replay"] == "true"
    assert await asset_count() == 2


async def test_the_same_key_for_a_different_request_is_refused(client):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": key()}
    assert (await client.post("/api/assets/batch", headers=h, json=batch_body(w, quantity=2))).status_code == 201
    other = await client.post("/api/assets/batch", headers=h, json=batch_body(w, quantity=3))
    assert other.status_code == 422 and other.json()["detail"] == DIFFERENT
    elsewhere = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co"], "po_number": "PO-KEY", "po_date": "2026-01-01", "cost_center_id": w["cc"]})
    assert elsewhere.status_code == 422 and elsewhere.json()["detail"] == DIFFERENT
    assert await asset_count() == 2


async def test_a_refused_request_does_not_use_up_its_key(client):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": key()}
    bad = await client.post("/api/assets/batch", headers=h, json=batch_body(w, cost_center_id=999999))
    assert bad.status_code == 422 and await key_rows() == []
    # the corrected request goes through with the same key (a different body is fine: nothing was stored)
    good = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    assert good.status_code == 201 and "Idempotency-Replay" not in good.headers
    assert await asset_count() == 2


async def test_an_unexpected_failure_releases_the_key(client, monkeypatch):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": key()}
    import app.assets.tools_router as tools

    async def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(tools, "add_assets_batch", broken)
    with pytest.raises(RuntimeError):
        await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    assert await key_rows() == []


async def test_keys_expire_after_a_day(client):
    w = await build_s4_world()
    k = key()
    h = {**await login(client, w, "owner"), "Idempotency-Key": k}
    assert (await client.post("/api/assets/batch", headers=h, json=batch_body(w))).status_code == 201
    async with SessionLocal() as s:
        await s.execute(update(IdempotencyKey).values(created_at=datetime.now(timezone.utc) - timedelta(hours=25)))
        await s.commit()
    again = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    assert again.status_code == 201 and "Idempotency-Replay" not in again.headers       # a new request now
    assert await asset_count() == 4
    rows = await key_rows()
    assert len(rows) == 1 and rows[0].created_at > datetime.now(timezone.utc) - timedelta(hours=1)


async def test_old_keys_are_removed_when_a_new_one_is_claimed(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    assert (await client.post("/api/assets/batch", headers={**h, "Idempotency-Key": key()}, json=batch_body(w))).status_code == 201
    async with SessionLocal() as s:
        await s.execute(update(IdempotencyKey).values(created_at=datetime.now(timezone.utc) - timedelta(hours=30)))
        await s.commit()
    assert (await client.post("/api/assets/batch", headers={**h, "Idempotency-Key": key()}, json=batch_body(w))).status_code == 201
    assert len(await key_rows()) == 1


async def test_keys_belong_to_one_user(client):
    w = await build_s4_world()
    k = key()
    owner = {**await login(client, w, "owner"), "Idempotency-Key": k}
    admin = {**await login(client, w, "admin"), "Idempotency-Key": k}
    assert (await client.post("/api/assets/batch", headers=owner, json=batch_body(w))).status_code == 201
    theirs = await client.post("/api/assets/batch", headers=admin, json=batch_body(w))
    assert theirs.status_code == 201 and "Idempotency-Replay" not in theirs.headers
    assert await asset_count() == 4


async def test_a_malformed_key_is_refused_in_plain_words(client):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": "x"}
    resp = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    assert resp.status_code == 422 and resp.json()["detail"] == BAD_KEY
    assert await asset_count() == 0


async def test_without_a_valid_login_the_header_changes_nothing(client):
    w = await build_s4_world()
    resp = await client.post("/api/assets/batch", headers={"Idempotency-Key": key()}, json=batch_body(w))
    assert resp.status_code == 401 and await key_rows() == []
    bad = await client.post("/api/assets/batch", headers={"Idempotency-Key": key(), "Authorization": "Bearer nonsense"},
                            json=batch_body(w))
    assert bad.status_code == 401 and await key_rows() == []


async def test_other_requests_ignore_the_header(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await make_po(client, h, w, [("chair", 2)], number="PO-HDR")
    k = {**h, "Idempotency-Key": key()}
    for _ in range(2):
        resp = await client.put(f"/api/purchase-orders/{po['id']}", headers=k, json={"po_date": "2026-01-02"})
        assert resp.status_code == 200 and "Idempotency-Replay" not in resp.headers
    assert await key_rows() == []
    assert not applies("PUT", f"/api/purchase-orders/{po['id']}") and not applies("GET", "/api/assets/batch")


def test_the_listed_requests_honour_the_header():
    for path in ("/api/assets", "/api/assets/batch", "/api/assets/bulk-action", "/api/assets/bulk-move", "/api/assets/link-items",
                 "/api/assets/12/events", "/api/purchase-orders", "/api/purchase-orders/with-lines", "/api/purchase-orders/7/receive",
                 "/api/purchase-orders/7/deliver", "/api/erp/pos/create", "/api/people/employees", "/api/people/stores",
                 "/api/people/install-points", "/api/stock-rooms", "/api/assets/batch/"):
        assert applies("POST", path), path
    assert not applies("POST", "/api/auth/login") and not applies("POST", "/api/assets/12/corrections")


def test_the_request_hash_ignores_json_key_order_but_not_values():
    a = request_hash("POST", "/api/x", b"", b'{"a": 1, "b": 2}', "application/json")
    assert a == request_hash("POST", "/api/x", b"", b'{"b":2,"a":1}', "application/json; charset=utf-8")
    assert a != request_hash("POST", "/api/x", b"", b'{"a": 1, "b": 3}', "application/json")
    assert a != request_hash("POST", "/api/y", b"", b'{"a": 1, "b": 2}', "application/json")
    assert a != request_hash("POST", "/api/x", b"q=1", b'{"a": 1, "b": 2}', "application/json")


# ------------------------------------------------------------------ the other write paths

async def test_two_identical_receipts_with_one_key_receive_once(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await make_po(client, h, w, [("chair", 10)], number="PO-RCV")
    body = receipt(w, [{"line_no": 1, "quantity": 5}])
    k = {**h, "Idempotency-Key": key()}
    first, second = await asyncio.gather(
        client.post(f"/api/purchase-orders/{po['id']}/receive", headers=k, json=body),
        client.post(f"/api/purchase-orders/{po['id']}/receive", headers=k, json=body),
    )
    assert sorted([first.status_code, second.status_code]) in ([200, 200], [200, 409])
    async with SessionLocal() as s:
        delivered = (await s.execute(select(func.count()).select_from(PendingAsset).where(
            PendingAsset.purchase_order_id == po["id"], PendingAsset.status == "DELIVERED"))).scalar_one()
    assert delivered == 5 and await asset_count() == 5
    replay = await client.post(f"/api/purchase-orders/{po['id']}/receive", headers=k, json=body)
    assert replay.status_code == 200 and replay.headers["Idempotency-Replay"] == "true"
    assert replay.json()["assets_created"] == 5 and await asset_count() == 5


async def test_without_a_key_two_receipts_of_part_of_a_line_are_two_receipts(client):
    """Behaviour unchanged without the header: each receipt takes the next waiting units (a real second
    delivery is allowed); only the header makes it 'the same request'."""
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await make_po(client, h, w, [("chair", 10)], number="PO-RCV2")
    body = receipt(w, [{"line_no": 1, "quantity": 5}])
    results = await asyncio.gather(*(client.post(f"/api/purchase-orders/{po['id']}/receive", headers=h, json=body) for _ in range(2)))
    assert [r.status_code for r in results] == [200, 200] and await asset_count() == 10


async def test_two_identical_purchase_orders_with_one_key_make_one(client):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": key()}
    body = {"company_id": w["co"], "po_number": "PO-ONE", "po_date": "2026-01-01", "vendor_id": w["vendor"], "cost_center_id": w["cc"],
            "lines": [{"item_id": w["item_chair"], "quantity": 3, "purchase_cost": 100, "tax_percent": 18}]}
    first, second = await asyncio.gather(
        client.post("/api/purchase-orders/with-lines", headers=h, json=body),
        client.post("/api/purchase-orders/with-lines", headers=h, json=body),
    )
    assert 201 in (first.status_code, second.status_code)
    assert {first.status_code, second.status_code} <= {201, 409}
    async with SessionLocal() as s:
        pos = (await s.execute(select(func.count()).select_from(PurchaseOrder))).scalar_one()
    assert pos == 1
    replay = await client.post("/api/purchase-orders/with-lines", headers=h, json=body)
    assert replay.status_code == 201 and replay.headers["Idempotency-Replay"] == "true"


async def test_an_event_repeated_with_its_key_is_recorded_once(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    asset = await make_asset(client, h, w, "it")
    k = {**h, "Idempotency-Key": key()}
    first = await client.post(f"/api/assets/{asset['id']}/events", headers=k, json={"event_type": "SENT_FOR_REPAIR"})
    again = await client.post(f"/api/assets/{asset['id']}/events", headers=k, json={"event_type": "SENT_FOR_REPAIR"})
    assert first.status_code == again.status_code == 201 and again.json() == first.json()
    assert again.headers["Idempotency-Replay"] == "true"
    async with SessionLocal() as s:
        repairs = (await s.execute(select(func.count()).select_from(AssetEvent).where(
            AssetEvent.asset_id == asset["id"], AssetEvent.event_type == "SENT_FOR_REPAIR"))).scalar_one()
    assert repairs == 1


async def test_a_replayed_answer_keeps_the_security_headers(client):
    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": key()}
    await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    again = await client.post("/api/assets/batch", headers=h, json=batch_body(w))
    assert again.headers["Cache-Control"] == "no-store" and again.headers["X-Content-Type-Options"] == "nosniff"
