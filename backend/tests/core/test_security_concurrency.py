"""Security assurance (2026-10): requests that arrive at the same moment must never break a business rule.

Real sessions on the test database; "at the same moment" is asyncio.gather through the app. The permanent
suites already cover idempotent receipts, same-number POs, row locks on events and asset-code numbering
(test_s7_idempotency, test_s7_row_locks, test_am09_numbering_concurrency); this file adds the remaining races:
over-receiving one PO line, one serial on two assets, one vendor / brand name created twice."""
import asyncio

from sqlalchemy import func, select

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.masters.models import Brand, Vendor
from app.purchase_orders.models import PendingAsset
from tests.purchase_orders.s4_world import build_s4_world, login, make_po, receipt, receive


async def _count(model, *where) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def test_four_parallel_receipts_cannot_receive_more_than_the_po_line(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await make_po(client, h, w, [("chair", 10)], number="PO-RACE-1")
    body = receipt(w, [{"line_no": 1, "quantity": 5}])
    results = await asyncio.gather(*(receive(client, h, po["id"], body) for _ in range(4)))
    codes = sorted(r.status_code for r in results)
    assert not [c for c in codes if c >= 500], codes
    assert codes.count(200) == 2 and all(400 <= c < 500 for c in codes if c != 200), codes
    assert await _count(Asset) == 10
    assert await _count(PendingAsset, PendingAsset.purchase_order_id == po["id"], PendingAsset.status == "DELIVERED") == 10


async def test_the_same_serial_on_two_parallel_receipts_creates_one_asset(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po_a = await make_po(client, h, w, [("camera", 1)], number="PO-RACE-SA")
    po_b = await make_po(client, h, w, [("camera", 1)], number="PO-RACE-SB")
    body = receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["RACE-SERIAL-1"]}])
    results = await asyncio.gather(receive(client, h, po_a["id"], body), receive(client, h, po_b["id"], body))
    codes = sorted(r.status_code for r in results)
    assert not [c for c in codes if c >= 500], [r.text for r in results]
    assert codes[0] == 200 and 400 <= codes[1] < 500, codes
    assert await _count(Asset, Asset.serial_number == "RACE-SERIAL-1") == 1
    assert await _count(Asset) == 1


async def test_ten_parallel_vendor_creates_with_one_name_make_one_vendor(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    results = await asyncio.gather(*(client.post("/api/masters/vendors", headers=h, json={"name": "Race Vendor Pvt Ltd"})
                                     for _ in range(10)))
    codes = [r.status_code for r in results]
    assert not [c for c in codes if c >= 500], [r.text for r in results if r.status_code >= 500]
    assert codes.count(201) == 1, codes
    assert await _count(Vendor, func.lower(Vendor.name) == "race vendor pvt ltd", Vendor.is_active.is_(True)) == 1


async def test_ten_parallel_brand_creates_with_one_name_make_one_brand(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    results = await asyncio.gather(*(client.post("/api/masters/brands", headers=h, json={"name": "Race Brand"}) for _ in range(10)))
    codes = [r.status_code for r in results]
    assert not [c for c in codes if c >= 500], [r.text for r in results if r.status_code >= 500]
    assert codes.count(201) == 1, codes
    assert await _count(Brand, func.lower(Brand.name) == "race brand", Brand.is_active.is_(True)) == 1
