"""S7 fix round (P1-2): two requests at the same moment can no longer both record the same movement, and two
saves of the same PO number can no longer both make a purchase order.

The UAT found CHAIR/CKAM40 with SENT_FOR_REPAIR twice (0.5 ms apart) and two live POs "UAT-D-TXZPT". Real
sessions on the test database: either two sessions that both read the asset before either writes, or two
requests sent together with asyncio.gather."""
import asyncio
from datetime import date

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.lifecycle.models import AssetEvent
from app.lifecycle.service import apply_event, apply_events
from app.lifecycle.state_machine import LifecycleError
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import create_purchase_order
from tests.core.s0_world import make_asset
from tests.purchase_orders.s4_world import build_s4_world, login


async def events_of(asset_id: int, event_type: str) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(AssetEvent).where(
            AssetEvent.asset_id == asset_id, AssetEvent.event_type == event_type))).scalar_one()


async def live_pos(number: str) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(PurchaseOrder).where(
            func.lower(PurchaseOrder.po_number) == number.lower(), PurchaseOrder.is_active.is_(True)))).scalar_one()


# ------------------------------------------------------------------ the asset ledger

async def test_a_stale_read_cannot_record_the_same_repair_twice(client):
    """Both sessions read 'in stock'; the first records the repair and commits; the second is checked against
    what is in the database now (under the row lock), not what it read before."""
    w = await build_s4_world()
    h = await login(client, w, "owner")
    asset_id = (await make_asset(client, h, w, "it"))["id"]
    async with SessionLocal() as s1, SessionLocal() as s2:
        owner1, owner2 = await s1.get(AssetUser, w["owner"]), await s2.get(AssetUser, w["owner"])
        a1, a2 = await s1.get(Asset, asset_id), await s2.get(Asset, asset_id)
        assert a1.status == a2.status == "IN_STOCK"
        await apply_event(s1, a1, "SENT_FOR_REPAIR", None, owner1)
        await s1.commit()
        with pytest.raises(LifecycleError, match="under repair, so it cannot be sent for repair"):
            await apply_event(s2, a2, "SENT_FOR_REPAIR", None, owner2)
        await s2.rollback()
    assert await events_of(asset_id, "SENT_FOR_REPAIR") == 1


async def test_the_second_writer_waits_for_the_first_and_is_then_refused(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    asset_id = (await make_asset(client, h, w, "it"))["id"]
    async with SessionLocal() as s1, SessionLocal() as s2:
        owner1, owner2 = await s1.get(AssetUser, w["owner"]), await s2.get(AssetUser, w["owner"])
        a1, a2 = await s1.get(Asset, asset_id), await s2.get(Asset, asset_id)
        await apply_event(s1, a1, "SENT_FOR_REPAIR", None, owner1)          # holds the row lock, not committed
        second = asyncio.create_task(apply_event(s2, a2, "SENT_FOR_REPAIR", None, owner2))
        await asyncio.sleep(0.3)
        assert not second.done()                                            # waiting for the first one
        await s1.commit()
        with pytest.raises(LifecycleError):
            await second
        await s2.rollback()
    assert await events_of(asset_id, "SENT_FOR_REPAIR") == 1


async def test_after_the_first_writer_gives_up_the_second_goes_ahead(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    asset_id = (await make_asset(client, h, w, "it"))["id"]
    async with SessionLocal() as s1, SessionLocal() as s2:
        owner1, owner2 = await s1.get(AssetUser, w["owner"]), await s2.get(AssetUser, w["owner"])
        a1, a2 = await s1.get(Asset, asset_id), await s2.get(Asset, asset_id)
        await apply_event(s1, a1, "SENT_FOR_REPAIR", None, owner1)
        second = asyncio.create_task(apply_event(s2, a2, "SENT_FOR_REPAIR", None, owner2))
        await asyncio.sleep(0.2)
        await s1.rollback()
        await second
        await s2.commit()
    assert await events_of(asset_id, "SENT_FOR_REPAIR") == 1


async def test_two_simultaneous_repair_requests_record_one_event(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    asset_id = (await make_asset(client, h, w, "it"))["id"]
    first, second = await asyncio.gather(*(
        client.post(f"/api/assets/{asset_id}/events", headers=h, json={"event_type": "SENT_FOR_REPAIR"}) for _ in range(2)))
    assert sorted([first.status_code, second.status_code]) == [201, 422]
    refused = first if first.status_code == 422 else second
    assert refused.json()["detail"] == "This asset is under repair, so it cannot be sent for repair."
    assert await events_of(asset_id, "SENT_FOR_REPAIR") == 1


async def test_two_simultaneous_bulk_actions_on_the_same_assets_record_each_once(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    ids = [(await make_asset(client, h, w, "it", serial_number=f"BULK-{n}"))["id"] for n in range(4)]
    body = {"asset_ids": ids, "event_type": "SENT_FOR_REPAIR"}
    first, second = await asyncio.gather(*(client.post("/api/assets/bulk-action", headers=h, json=body) for _ in range(2)))
    assert first.status_code == second.status_code == 200
    assert first.json()["done"] + second.json()["done"] == 4
    assert len(first.json()["failed"]) + len(second.json()["failed"]) == 4
    for asset_id in ids:
        assert await events_of(asset_id, "SENT_FOR_REPAIR") == 1


async def test_overlapping_bulk_moves_in_opposite_orders_do_not_deadlock(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    ids = [(await make_asset(client, h, w, "it", serial_number=f"MV-{n}"))["id"] for n in range(6)]
    to_emp = {"asset_ids": ids, "to_asset_user_id": w["employee"]}
    to_stock2 = {"asset_ids": list(reversed(ids)), "to_asset_user_id": w["stock2"]}
    first, second = await asyncio.wait_for(asyncio.gather(
        client.post("/api/assets/bulk-move", headers=h, json=to_emp),
        client.post("/api/assets/bulk-move", headers=h, json=to_stock2),
    ), timeout=30)
    assert first.status_code == second.status_code == 200
    assert first.json()["moved"] + second.json()["moved"] == 12          # both legal: each asset moved twice, in order
    async with SessionLocal() as s:
        moved = (await s.execute(select(func.count()).select_from(AssetEvent).where(
            AssetEvent.asset_id.in_(ids), AssetEvent.event_type == "MOVED"))).scalar_one()
    assert moved == 12


async def test_a_batch_is_checked_against_the_locked_state_of_every_asset(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    ids = [(await make_asset(client, h, w, "it", serial_number=f"BT-{n}"))["id"] for n in range(3)]
    async with SessionLocal() as s1, SessionLocal() as s2:
        o1, o2 = await s1.get(AssetUser, w["owner"]), await s2.get(AssetUser, w["owner"])
        stale = [await s2.get(Asset, i) for i in ids]                         # all read "in stock"
        await apply_event(s1, await s1.get(Asset, ids[1]), "LOST", None, o1)
        await s1.commit()
        with pytest.raises(LifecycleError, match="reported lost"):
            await apply_events(s2, [(a, None) for a in stale], "SENT_FOR_REPAIR", o2)
        await s2.rollback()
    for asset_id in ids:
        assert await events_of(asset_id, "SENT_FOR_REPAIR") == 0          # all or nothing, as before


# ------------------------------------------------------------------ one live PO number per company

async def test_a_second_save_of_the_same_po_number_waits_and_is_then_refused(client):
    w = await build_s4_world()
    data = {"company_id": w["co"], "po_number": "UAT-D-TXZPT", "po_date": date(2026, 1, 1), "cost_center_id": w["cc"]}
    async with SessionLocal() as s1, SessionLocal() as s2:
        o1, o2 = await s1.get(AssetUser, w["owner"]), await s2.get(AssetUser, w["owner"])
        await create_purchase_order(s1, dict(data), o1)                      # holds the number, not committed
        second = asyncio.create_task(create_purchase_order(s2, {**data, "po_number": " uat-d-txzpt "}, o2))
        await asyncio.sleep(0.3)
        assert not second.done()
        await s1.commit()
        with pytest.raises(ValueError, match="already exists for this company"):
            await second
        await s2.rollback()
    assert await live_pos("UAT-D-TXZPT") == 1


async def test_the_same_number_in_another_company_is_not_held_up(client):
    w = await build_s4_world()
    async with SessionLocal() as s1, SessionLocal() as s2:
        o1, o2 = await s1.get(AssetUser, w["owner"]), await s2.get(AssetUser, w["owner"])
        await create_purchase_order(s1, {"company_id": w["co"], "po_number": "SAME-1", "po_date": date(2026, 1, 1),
                                         "cost_center_id": w["cc"]}, o1)
        other = await asyncio.wait_for(create_purchase_order(s2, {
            "company_id": w["co_b"], "po_number": "SAME-1", "po_date": date(2026, 1, 1), "cost_center_id": w["cc_b"]}, o2), timeout=5)
        assert other.id is not None
        await s1.commit()
        await s2.commit()


async def test_two_simultaneous_po_saves_make_one_po(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    body = {"company_id": w["co"], "po_number": "PO-DOUBLE", "po_date": "2026-01-01", "vendor_id": w["vendor"],
            "cost_center_id": w["cc"], "lines": [{"item_id": w["item_chair"], "quantity": 2, "purchase_cost": 10, "tax_percent": 18}]}
    first, second = await asyncio.gather(*(client.post("/api/purchase-orders/with-lines", headers=h, json=body) for _ in range(2)))
    assert sorted([first.status_code, second.status_code]) == [201, 422]
    refused = first if first.status_code == 422 else second
    assert "already exists for this company" in refused.json()["detail"]
    assert await live_pos("PO-DOUBLE") == 1


async def test_two_simultaneous_header_only_po_saves_make_one_po(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    body = {"company_id": w["co"], "po_number": "PO-HDR-2", "po_date": "2026-01-01", "cost_center_id": w["cc"]}
    results = await asyncio.gather(*(client.post("/api/purchase-orders", headers=h, json=body) for _ in range(3)))
    assert sorted(r.status_code for r in results) == [201, 422, 422]
    assert await live_pos("PO-HDR-2") == 1


async def test_the_database_itself_refuses_a_second_live_po_with_the_same_number(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        s.add(PurchaseOrder(company_id=w["co"], po_number="IDX-1", po_date=date(2026, 1, 1), cost_center_id=w["cc"]))
        await s.commit()
        s.add(PurchaseOrder(company_id=w["co"], po_number=" idx-1", po_date=date(2026, 1, 1), cost_center_id=w["cc"]))
        with pytest.raises(IntegrityError):
            await s.commit()
        await s.rollback()
        # a deactivated PO does not count; another company does not count
        s.add(PurchaseOrder(company_id=w["co"], po_number="IDX-1", po_date=date(2026, 1, 1), cost_center_id=w["cc"], is_active=False))
        s.add(PurchaseOrder(company_id=w["co_b"], po_number="IDX-1", po_date=date(2026, 1, 1), cost_center_id=w["cc_b"]))
        await s.commit()


async def test_the_unique_index_is_in_the_test_database():
    async with SessionLocal() as s:
        from sqlalchemy import text
        found = (await s.execute(text(
            "select indexdef from pg_indexes where indexname = 'uq_purchase_order_company_number_active'"))).scalar_one()
    assert "lower(btrim" in found and "WHERE is_active" in found


def test_the_index_violation_is_a_plain_sentence():
    from app.core.errors import integrity_message

    class _Pg(Exception):
        sqlstate = "23505"
        constraint_name = "uq_purchase_order_company_number_active"
        detail = "Key (company_id, lower(btrim(po_number::text)))=(1, x) already exists."

    class _Orig(Exception):
        pass

    orig = _Orig()
    orig.__cause__ = _Pg()
    exc = IntegrityError("INSERT", {}, orig)
    assert integrity_message(exc) == (409, "A purchase order with this PO number already exists for this company.")


async def test_renaming_a_po_to_a_number_in_use_is_still_refused(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    for number in ("REN-1", "REN-2"):
        assert (await client.post("/api/purchase-orders", headers=h, json={
            "company_id": w["co"], "po_number": number, "po_date": "2026-01-01", "cost_center_id": w["cc"]})).status_code == 201
    async with SessionLocal() as s:
        po_id = (await s.execute(select(PurchaseOrder.id).where(PurchaseOrder.po_number == "REN-2"))).scalar_one()
    resp = await client.put(f"/api/purchase-orders/{po_id}", headers=h, json={"po_number": "ren-1"})
    assert resp.status_code == 422 and "already exists for this company" in resp.json()["detail"]
