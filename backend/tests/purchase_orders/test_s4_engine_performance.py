"""S4: one asset engine for every path, and its cost. The old POST /deliver and the new POST /receive make
the same assets and ledger entries for the same input; both run on the batch engine, so the number of SQL
statements barely grows with the number of units; asset codes stay unique and gap-free when several
receipts run at the same moment; two receipts of the same units at the same moment never make two assets
of one unit."""
import asyncio
import time

from sqlalchemy import func, select

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.lifecycle.models import AssetEvent
from app.purchase_orders.models import PendingAsset
from tests.purchase_orders.s4_world import Statements, build_s4_world, login, make_po, receipt, receive, serials

ASSET_FIELDS = (
    "company_id", "cost_center_id", "category_id", "subcategory_id", "item_id", "erp_item_code", "brand_id", "model",
    "serial_pending", "barcode", "description", "vendor_id", "po_date", "invoice_number", "invoice_date",
    "invoice_amount", "pi_number", "pi_date", "purchase_cost", "tax_percent", "tax_amount", "total_cost",
    "purchase_date", "warranty_years", "warranty_upto", "status", "current_asset_user_id", "status_since",
    "asset_domain", "custom_fields", "created_by", "updated_by", "deleted_at", "legacy_asset_code",
)
EVENT_FIELDS = (
    "event_type", "event_date", "from_asset_user_id", "to_asset_user_id", "from_asset_user_name_snapshot",
    "to_asset_user_name_snapshot", "status_after", "remarks", "reference_no", "recorded_by",
)


async def _snapshot(po_number: str) -> list[tuple]:
    async with SessionLocal() as s:
        assets = (await s.execute(select(Asset).where(Asset.po_number == po_number).order_by(Asset.id))).scalars().all()
        events = {e.asset_id: e for e in (await s.execute(
            select(AssetEvent).where(AssetEvent.asset_id.in_([a.id for a in assets])))).scalars().all()}
    return [(tuple(getattr(a, f) for f in ASSET_FIELDS), a.serial_number is None,
             tuple(getattr(events[a.id], f) for f in EVENT_FIELDS)) for a in assets]


async def test_the_old_deliver_and_the_new_receive_make_the_same_assets_and_ledger(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    old = await make_po(client, h, w, [("camera", 3), ("gangbox", 2), ("ap", 2)], number="OLD")
    new = await make_po(client, h, w, [("camera", 3), ("gangbox", 2), ("ap", 2)], number="NEW")

    units = (await client.get(f"/api/purchase-orders/{old['id']}/lines", headers=h)).json()
    lines = []
    for unit, serial in zip(units, ["S-A", "S-B", "S-C", "N/A", "N/A", None, None]):
        entry = {"pending_asset_id": unit["id"], "initial_asset_user_id": w["stock"]}
        entry.update({"serial_pending": True} if serial is None else {"serial_number": serial})
        lines.append(entry)
    delivered = await client.post(f"/api/purchase-orders/{old['id']}/deliver", headers=h, json={
        "invoice_number": "INV-SAME", "invoice_date": "2026-02-01", "invoice_amount": 5000, "lines": lines})
    assert delivered.status_code == 200, delivered.text
    received = await receive(client, h, new["id"], receipt(w, [
        {"line_no": 1, "quantity": 3, "serial_numbers": ["R-A", "R-B", "R-C"]},
        {"line_no": 2, "quantity": 2}, {"line_no": 3, "quantity": 2}], invoice_number="INV-SAME", invoice_amount=5000))
    assert received.status_code == 200, received.text

    assert await _snapshot("OLD") == await _snapshot("NEW")
    async with SessionLocal() as s:
        rows = (await s.execute(select(PendingAsset.purchase_order_id, PendingAsset.status, PendingAsset.serial_number,
                                       PendingAsset.invoice_number, PendingAsset.initial_asset_user_id)
                                .order_by(PendingAsset.id))).all()
    old_units = [r[1:] for r in rows if r[0] == old["id"]]
    new_units = [r[1:] for r in rows if r[0] == new["id"]]
    assert [u[0] for u in old_units] == [u[0] for u in new_units] == ["DELIVERED"] * 7
    assert [u[2:] for u in old_units] == [u[2:] for u in new_units]
    codes = sorted(a["asset_code"] for a in received.json()["assets"])
    assert codes == [f"S0/S0IT/{n:03d}" for n in range(8, 15)]          # continuing after the 7 delivered first


async def test_a_new_asset_given_straight_to_a_person_is_allotted_through_the_ledger(client):
    """The batch engine inserts the row IN_STOCK (the documented exception) and the ledger's batch entry
    point moves it: Add Asset / the old delivery to a person end ALLOTTED, in the database too."""
    w = await build_s4_world()
    h = await login(client, w, "admin")
    added = await client.post("/api/assets", headers=h, json={
        "company_id": w["co"], "cost_center_id": w["cc"], "item_id": w["item_camera"], "description": "Camera",
        "vendor_id": w["vendor"], "serial_number": "EMP-1", "initial_asset_user_id": w["employee"],
        "invoice_date": "2026-02-01"})
    assert added.status_code == 201, added.text
    po = await make_po(client, h, w, [("gangbox", 1)])
    [unit] = (await client.get(f"/api/purchase-orders/{po['id']}/lines", headers=h)).json()
    delivered = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json={
        "invoice_number": "INV", "invoice_date": "2026-02-01", "invoice_amount": 1,
        "lines": [{"pending_asset_id": unit["id"], "serial_number": "N/A", "initial_asset_user_id": w["employee2"]}]})
    assert delivered.status_code == 200, delivered.text
    async with SessionLocal() as s:
        rows = (await s.execute(select(Asset.status, Asset.current_asset_user_id).order_by(Asset.id))).all()
        events = (await s.execute(select(AssetEvent.status_after, AssetEvent.to_asset_user_name_snapshot,
                                         AssetEvent.from_asset_user_name_snapshot).order_by(AssetEvent.id))).all()
    assert [tuple(r) for r in rows] == [("ALLOTTED", w["employee"]), ("ALLOTTED", w["employee2"])]
    assert [tuple(e) for e in events] == [("ALLOTTED", "Ravi Kumar", "Ravi Kumar"), ("ALLOTTED", "Sita Devi", "Sita Devi")]
    assert added.json()[0]["status"] == "ALLOTTED"


async def _statements_to_receive(client, h, w, units: int) -> tuple[int, float]:
    po = await make_po(client, h, w, [("camera", units)], number=f"PERF-R-{units}")
    body = receipt(w, [{"line_no": 1, "quantity": units, "serial_numbers": serials(f"R{units}", units)}])
    with Statements() as counted:
        started = time.perf_counter()
        resp = await receive(client, h, po["id"], body)
        elapsed = time.perf_counter() - started
    assert resp.status_code == 200, resp.text
    assert resp.json()["assets_created"] == units
    return counted.count, elapsed


async def _statements_to_deliver(client, h, w, units: int) -> tuple[int, float]:
    po = await make_po(client, h, w, [("camera", units)], number=f"PERF-D-{units}")
    ids = [u["id"] for u in (await client.get(f"/api/purchase-orders/{po['id']}/lines", headers=h)).json()]
    body = {"invoice_number": "INV-P", "invoice_date": "2026-02-01", "invoice_amount": 10, "lines": [
        {"pending_asset_id": i, "serial_number": s, "initial_asset_user_id": w["stock"]}
        for i, s in zip(ids, serials(f"D{units}", units))]}
    with Statements() as counted:
        started = time.perf_counter()
        resp = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json=body)
        elapsed = time.perf_counter() - started
    assert resp.status_code == 200, resp.text
    return counted.count, elapsed


async def test_the_number_of_statements_grows_far_slower_than_the_number_of_units(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    table = []
    for units in (1, 10, 50, 100):
        r_count, r_time = await _statements_to_receive(client, h, w, units)
        d_count, d_time = await _statements_to_deliver(client, h, w, units)
        table.append((units, r_count, r_time, d_count, d_time))
    print("\nS4 performance (units, receive statements, receive seconds, deliver statements, deliver seconds)")
    for row in table:
        print("  %4d  %3d  %.3f  %3d  %.3f" % row)
    by_units = {row[0]: row for row in table}
    assert by_units[100][1] < 60 and by_units[100][3] < 60
    assert by_units[100][1] - by_units[1][1] <= 5          # receive: constant, not per unit
    assert by_units[100][3] - by_units[1][3] <= 5          # the old deliver runs on the same engine
    assert by_units[100][2] < 10 and by_units[100][4] < 10


async def test_a_mixed_hundred_unit_receipt_stays_within_the_statement_budget(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 30), ("gangbox", 50), ("ap", 20)])
    with Statements() as counted:
        resp = await receive(client, h, po["id"], receipt(w, [
            {"line_no": 1, "quantity": 30, "serial_numbers": serials("MX", 30)},
            {"line_no": 2, "quantity": 50}, {"line_no": 3, "quantity": 20}]))
    assert resp.status_code == 200, resp.text
    assert counted.count < 60, counted.count


async def test_parallel_receipts_get_unique_gap_free_asset_codes(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    pos = [await make_po(client, h, w, [("gangbox", 20)], number=f"PAR-{n}") for n in range(5)]
    responses = await asyncio.gather(*[
        receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 20}], invoice_number=f"INV-{n}"))
        for n, po in enumerate(pos)
    ])
    assert [r.status_code for r in responses] == [200] * 5, [r.text for r in responses]
    codes = [a["asset_code"] for r in responses for a in r.json()["assets"]]
    assert len(codes) == len(set(codes)) == 100
    assert sorted(int(c.rsplit("/", 1)[1]) for c in codes) == list(range(1, 101))
    for r in responses:                                     # each receipt got one consecutive block
        numbers = [int(a["asset_code"].rsplit("/", 1)[1]) for a in r.json()["assets"]]
        assert numbers == list(range(numbers[0], numbers[0] + 20))


async def test_two_receipts_of_the_same_units_at_once_never_make_two_assets_of_one_unit(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 10)])
    first, second = await asyncio.gather(
        receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 10}], invoice_number="INV-1")),
        receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 10}], invoice_number="INV-2")),
    )
    assert sorted([first.status_code, second.status_code]) == [200, 422]
    loser = first if first.status_code == 422 else second
    assert loser.json()["problems"] == [{"line_no": 1, "message": "Nothing on this line is still waiting."}]
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count()).select_from(Asset))).scalar_one() == 10
        delivered = (await s.execute(select(PendingAsset.delivered_asset_id))).scalars().all()
    assert len(set(delivered)) == 10


async def test_two_old_style_deliveries_of_the_same_unit_at_once_make_one_asset(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    [unit] = (await client.get(f"/api/purchase-orders/{po['id']}/lines", headers=h)).json()
    body = {"invoice_number": "INV", "invoice_date": "2026-02-01", "invoice_amount": 1,
            "lines": [{"pending_asset_id": unit["id"], "serial_number": "N/A", "initial_asset_user_id": w["stock"]}]}
    results = await asyncio.gather(*[client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json=body)
                                     for _ in range(2)])
    assert sorted(r.status_code for r in results) == [200, 422]
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count()).select_from(Asset))).scalar_one() == 1
