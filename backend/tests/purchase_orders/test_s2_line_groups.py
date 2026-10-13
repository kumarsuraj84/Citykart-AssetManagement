"""S2.1: a purchase order read and worked by LINE (all units sharing a line
number): counts, value and status per line, a line's units, editing a whole
line (fields + quantity), cancelling waiting units of a line or of the PO.
Received and cancelled units are never changed; the work area (S0.3),
company scope and deleted-PO rules hold."""
from sqlalchemy import event, select

from app.assets.models import Asset
from app.core.db import SessionLocal, engine
from app.items.models import Item
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.core.s0_world import add_line, build_world, login, make_po


async def _groups(client, h, po_id):
    resp = await client.get(f"/api/purchase-orders/{po_id}/line-groups", headers=h)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _deliver(client, h, w, po_id, unit_ids, prefix="SN"):
    resp = await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json={
        "invoice_number": f"INV-{prefix}", "invoice_date": "2026-02-01", "invoice_amount": 100,
        "lines": [{"pending_asset_id": i, "serial_number": f"{prefix}-{i}", "initial_asset_user_id": w["stock"]} for i in unit_ids]})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _po_with_line(client, w, who="admin", quantity=3, **over):
    h = await login(client, w, who)
    po = await make_po(client, h, w)
    units = (await add_line(client, h, w, po["id"], quantity=quantity, **over)).json()
    return h, po, units


async def test_a_line_shows_names_counts_value_and_status(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, brand_id=w["brand"], barcode="BC-9", model="Latitude", warranty_years=2)
    [g] = await _groups(client, h, po["id"])
    assert g["line_no"] == 1 and g["description"] == "Laptop" and g["barcode"] == "BC-9"
    assert (g["category_name"], g["subcategory_name"], g["brand_name"], g["work_area"]) == ("Computers", "Laptop", "Dell", "IT")
    assert (g["model"], g["warranty_years"], g["rate"], g["tax_percent"]) == ("Latitude", 2, 1000.0, 18.0)
    assert (g["ordered"], g["received"], g["waiting"], g["cancelled"], g["waiting_unit_count"]) == (3, 0, 3, 0, 3)
    assert g["line_value"] == 3540.0 and g["unit_total"] == 1180.0
    assert g["status"] == "WAITING" and g["serial_mode"] == "HAS_SERIAL" and g["bundle_label"] is None


async def test_status_follows_partial_delivery_cancellation_and_completion(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=3)
    await _deliver(client, h, w, po["id"], [units[0]["id"]])
    [g] = await _groups(client, h, po["id"])
    assert (g["ordered"], g["received"], g["waiting"], g["status"]) == (3, 1, 2, "PARTLY_RECEIVED")
    assert g["line_value"] == 3540.0
    await client.post(f"/api/purchase-orders/lines/{units[1]['id']}/cancel", headers=h)
    [g] = await _groups(client, h, po["id"])
    assert (g["ordered"], g["received"], g["waiting"], g["cancelled"], g["status"]) == (2, 1, 1, 1, "PARTLY_RECEIVED")
    assert g["line_value"] == 2360.0                                     # cancelled units are not ordered any more
    await _deliver(client, h, w, po["id"], [units[2]["id"]], prefix="SN2")
    [g] = await _groups(client, h, po["id"])
    assert (g["ordered"], g["received"], g["waiting"], g["status"]) == (2, 2, 0, "RECEIVED")


async def test_a_line_with_everything_cancelled_is_cancelled_and_received_plus_cancelled_is_received(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=2)
    second = (await add_line(client, h, w, po["id"], "nonit", quantity=2)).json()
    for u in units:
        await client.post(f"/api/purchase-orders/lines/{u['id']}/cancel", headers=h)
    await _deliver(client, h, w, po["id"], [second[0]["id"]])
    await client.post(f"/api/purchase-orders/lines/{second[1]['id']}/cancel", headers=h)
    g1, g2 = await _groups(client, h, po["id"])
    assert (g1["status"], g1["ordered"], g1["cancelled"], g1["line_value"]) == ("CANCELLED", 0, 2, 0.0)
    assert (g2["status"], g2["received"], g2["cancelled"]) == ("RECEIVED", 1, 1)


async def test_the_serial_mode_comes_from_the_units_snapshot(client):
    w = await build_world()
    async with SessionLocal() as s:
        mouse = Item(name="S2 Mouse", category_id=w["it"], subcategory_id=w["lap"], serial_required=False)
        amp = Item(name="S2 Amplifier", category_id=w["it"], subcategory_id=w["lap"], serial_later=True)
        s.add_all([mouse, amp])
        await s.commit()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    await add_line(client, h, w, po["id"])
    await add_line(client, h, w, po["id"], item_id=mouse.id, description="Mouse")
    await add_line(client, h, w, po["id"], item_id=amp.id, description="Amplifier")
    modes = [(g["item_name"], g["serial_mode"]) for g in await _groups(client, h, po["id"])]
    assert modes == [(None, "HAS_SERIAL"), ("S2 Mouse", "NO_SERIAL"), ("S2 Amplifier", "SERIAL_LATER")]


async def test_the_units_of_a_line_can_be_listed_and_filtered_by_status(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=3)
    await add_line(client, h, w, po["id"], "nonit")
    await _deliver(client, h, w, po["id"], [units[0]["id"]])
    url = f"/api/purchase-orders/{po['id']}/line-groups/1/units"
    assert [u["id"] for u in (await client.get(url, headers=h)).json()] == [u["id"] for u in units]
    waiting = (await client.get(url, params={"status": "WAITING"}, headers=h)).json()
    assert [u["id"] for u in waiting] == [units[1]["id"], units[2]["id"]]
    received = (await client.get(url, params={"status": "received"}, headers=h)).json()
    assert [u["status"] for u in received] == ["DELIVERED"]
    bad = await client.get(url, params={"status": "LOST"}, headers=h)
    assert bad.status_code == 422 and "Choose a status" in bad.json()["detail"]
    missing = await client.get(f"/api/purchase-orders/{po['id']}/line-groups/9/units", headers=h)
    assert missing.status_code == 404


async def test_editing_a_line_changes_every_waiting_unit_and_never_a_received_one(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=3)
    [delivered] = await _deliver(client, h, w, po["id"], [units[0]["id"]])
    resp = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={
        "description": "Laptop 14 inch", "purchase_cost": 900, "brand_id": w["brand"], "model": "X1"})
    assert resp.status_code == 200, resp.text
    g = resp.json()
    assert (g["description"], g["rate"], g["brand_name"], g["model"], g["ordered"]) == ("Laptop 14 inch", 900.0, "Dell", "X1", 3)
    assert g["line_value"] == round(1180 + 2 * 1062, 2)
    async with SessionLocal() as s:
        rows = {u.id: u for u in (await s.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po["id"]))).scalars()}
        asset = await s.get(Asset, delivered["delivered_asset_id"])
    assert rows[units[0]["id"]].description == "Laptop" and float(rows[units[0]["id"]].purchase_cost) == 1000.0
    assert {rows[u["id"]].description for u in units[1:]} == {"Laptop 14 inch"}
    assert {float(rows[u["id"]].total_cost) for u in units[1:]} == {1062.0}
    assert asset.description == "Laptop" and float(asset.purchase_cost) == 1000.0      # the received asset is untouched


async def test_fields_left_out_of_a_line_edit_keep_their_values(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=2, barcode="KEEP-ME", model="M-1", warranty_years=3)
    resp = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"tax_percent": 12})
    assert resp.status_code == 200, resp.text
    g = resp.json()
    assert (g["barcode"], g["model"], g["warranty_years"], g["rate"], g["tax_percent"]) == ("KEEP-ME", "M-1", 3, 1000.0, 12.0)
    assert g["unit_total"] == 1120.0


async def test_raising_the_quantity_adds_units_copied_from_the_line_with_the_same_number(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=2, barcode="BC-Q", brand_id=w["brand"])
    await add_line(client, h, w, po["id"], "nonit")                       # line 2 stays as it is
    await _deliver(client, h, w, po["id"], [units[0]["id"]])
    resp = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"quantity": 5})
    assert resp.status_code == 200, resp.text
    g = resp.json()
    assert (g["ordered"], g["received"], g["waiting"], g["status"]) == (5, 1, 4, "PARTLY_RECEIVED")
    async with SessionLocal() as s:
        line1 = (await s.execute(select(PendingAsset).where(
            PendingAsset.purchase_order_id == po["id"], PendingAsset.line_no == 1))).scalars().all()
    assert len(line1) == 5 and {u.barcode for u in line1} == {"BC-Q"} and {u.brand_id for u in line1} == {w["brand"]}
    assert {u.asset_domain for u in line1} == {"IT"}
    assert [g["ordered"] for g in await _groups(client, h, po["id"])] == [5, 1]


async def test_raising_the_quantity_together_with_an_edit_copies_the_edited_values(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=1)
    resp = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h,
                            json={"quantity": 3, "purchase_cost": 500, "description": "Laptop B"})
    assert resp.status_code == 200, resp.text
    async with SessionLocal() as s:
        rows = (await s.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po["id"]))).scalars().all()
    assert len(rows) == 3 and {r.description for r in rows} == {"Laptop B"} and {float(r.purchase_cost) for r in rows} == {500.0}


async def test_lowering_the_quantity_cancels_the_newest_waiting_units_but_never_below_received(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=5)
    await _deliver(client, h, w, po["id"], [units[0]["id"], units[1]["id"]])
    resp = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"quantity": 3})
    assert resp.status_code == 200, resp.text
    assert (resp.json()["ordered"], resp.json()["waiting"], resp.json()["cancelled"]) == (3, 1, 2)
    async with SessionLocal() as s:
        status = {u.id: u.status for u in (await s.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po["id"]))).scalars()}
    assert [status[u["id"]] for u in units] == ["DELIVERED", "DELIVERED", "PENDING", "CANCELLED", "CANCELLED"]
    too_low = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"quantity": 1})
    assert too_low.status_code == 422 and "cannot be less than 2" in too_low.json()["detail"]
    too_high = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"quantity": 1001})
    assert too_high.status_code == 422
    same = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"quantity": 3})
    assert same.status_code == 200 and same.json()["ordered"] == 3


async def test_quantity_zero_on_a_line_with_nothing_received_cancels_it(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=2)
    resp = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"quantity": 0})
    assert resp.status_code == 200 and resp.json()["status"] == "CANCELLED"


async def test_a_line_edit_is_validated_like_a_unit_edit(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=2)
    url = f"/api/purchase-orders/{po['id']}/line-groups/1"
    blank = await client.put(url, headers=h, json={"description": "  "})
    assert blank.status_code == 422 and "Description cannot be blank" in blank.json()["detail"]
    dead_brand = await client.put(url, headers=h, json={"brand_id": w["dead_brand"]})
    assert dead_brand.status_code == 422 and "Gone Brand is no longer active" in dead_brand.json()["detail"]
    tax = await client.put(url, headers=h, json={"tax_percent": 150})
    assert tax.status_code == 422
    nothing = await client.put(url, headers=h, json={})
    assert nothing.status_code == 422 and nothing.json()["detail"] == "Nothing was changed."
    async with SessionLocal() as s:
        rows = (await s.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po["id"]))).scalars().all()
    assert {r.description for r in rows} == {"Laptop"} and {r.brand_id for r in rows} == {None}


async def test_a_line_with_nothing_waiting_cannot_be_edited_but_can_be_raised(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=1)
    await _deliver(client, h, w, po["id"], [units[0]["id"]])
    url = f"/api/purchase-orders/{po['id']}/line-groups/1"
    refused = await client.put(url, headers=h, json={"description": "Changed"})
    assert refused.status_code == 422 and "Nothing on this line is still waiting" in refused.json()["detail"]
    raised = await client.put(url, headers=h, json={"quantity": 2})
    assert raised.status_code == 200 and (raised.json()["received"], raised.json()["waiting"]) == (1, 1)


async def test_cancelling_waiting_units_of_one_line(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=4)
    await _deliver(client, h, w, po["id"], [units[0]["id"]])
    url = f"/api/purchase-orders/{po['id']}/line-groups/1/cancel-waiting"
    too_many = await client.post(url, headers=h, json={"quantity": 4})
    assert too_many.status_code == 422 and "Only 3 of this line are still waiting" in too_many.json()["detail"]
    some = await client.post(url, headers=h, json={"quantity": 2})
    assert some.status_code == 200 and (some.json()["waiting"], some.json()["cancelled"]) == (1, 2)
    async with SessionLocal() as s:
        status = {u.id: u.status for u in (await s.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po["id"]))).scalars()}
    assert [status[u["id"]] for u in units] == ["DELIVERED", "PENDING", "CANCELLED", "CANCELLED"]   # newest first
    rest = await client.post(url, headers=h)
    assert rest.status_code == 200 and rest.json()["status"] == "RECEIVED"
    again = await client.post(url, headers=h)
    assert again.status_code == 422 and again.json()["detail"] == "Nothing on this line is still waiting."


async def test_cancelling_every_waiting_unit_of_a_po_keeps_the_po_and_its_received_items(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=3)
    other = (await add_line(client, h, w, po["id"], "nonit", quantity=2)).json()
    [delivered] = await _deliver(client, h, w, po["id"], [units[0]["id"]])
    resp = await client.post(f"/api/purchase-orders/{po['id']}/cancel-waiting", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"cancelled_units": 4, "status": "RECEIVED"}
    async with SessionLocal() as s:
        p = await s.get(PurchaseOrder, po["id"])
        asset = await s.get(Asset, delivered["delivered_asset_id"])
        status = {u.id: u.status for u in (await s.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po["id"]))).scalars()}
    assert p.is_active is True and asset.deleted_at is None
    assert status[units[0]["id"]] == "DELIVERED" and {status[u["id"]] for u in units[1:] + other} == {"CANCELLED"}
    again = await client.post(f"/api/purchase-orders/{po['id']}/cancel-waiting", headers=h)
    assert again.status_code == 422 and again.json()["detail"] == "Nothing on this purchase order is still waiting."
    listed = (await client.get(f"/api/purchase-orders/{po['id']}", headers=h)).json()
    assert (listed["status"], listed["received_units"], listed["cancelled_units"]) == ("RECEIVED", 1, 4)


async def test_cancelling_a_po_with_nothing_received_makes_it_cancelled(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=2)
    resp = await client.post(f"/api/purchase-orders/{po['id']}/cancel-waiting", headers=h)
    assert resp.json() == {"cancelled_units": 2, "status": "CANCELLED"}


async def _mixed(client, w):
    owner = await login(client, w, "owner")
    po = await make_po(client, owner, w, number="MIX")
    it_units = (await add_line(client, owner, w, po["id"], "it", quantity=2)).json()
    nonit_units = (await add_line(client, owner, w, po["id"], "nonit", quantity=3)).json()
    return owner, po, it_units, nonit_units


async def test_someone_limited_to_one_work_area_sees_and_works_only_their_own_lines(client):
    w = await build_world()
    owner, po, it_units, nonit_units = await _mixed(client, w)
    it = await login(client, w, "op_it")
    groups = await _groups(client, it, po["id"])
    assert [(g["line_no"], g["work_area"]) for g in groups] == [(1, "IT")]
    assert (await client.get(f"/api/purchase-orders/{po['id']}/line-groups/2/units", headers=it)).status_code == 404
    edit = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/2", headers=it, json={"quantity": 1})
    assert edit.status_code == 404
    to_other_area = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=it,
                                     json={"category_id": w["nonit"], "subcategory_id": w["chair"]})
    assert to_other_area.status_code == 403
    cancel_line = await client.post(f"/api/purchase-orders/{po['id']}/line-groups/2/cancel-waiting", headers=it)
    assert cancel_line.status_code == 404
    cancel_po = await client.post(f"/api/purchase-orders/{po['id']}/cancel-waiting", headers=it)
    assert cancel_po.json()["cancelled_units"] == 2                          # only the IT units
    both = await _groups(client, owner, po["id"])
    assert [(g["line_no"], g["waiting"], g["cancelled"]) for g in both] == [(1, 0, 2), (2, 3, 0)]


async def test_line_groups_follow_company_scope_roles_and_deleted_pos(client):
    w = await build_world()
    h, po, units = await _po_with_line(client, w, quantity=2)
    viewer = await login(client, w, "viewer_it")
    assert (await client.get(f"/api/purchase-orders/{po['id']}/line-groups", headers=viewer)).status_code == 403
    async with SessionLocal() as s:
        p = await s.get(PurchaseOrder, po["id"])
        p.company_id = w["co_b"]                     # a PO of another company
        await s.commit()
    op = await login(client, w, "op_both")
    assert (await client.get(f"/api/purchase-orders/{po['id']}/line-groups", headers=op)).status_code == 404
    async with SessionLocal() as s:
        p = await s.get(PurchaseOrder, po["id"])
        p.company_id = w["co"]
        await s.commit()
    assert (await client.delete(f"/api/purchase-orders/{po['id']}", headers=h)).status_code == 200
    assert len(await _groups(client, h, po["id"])) == 1                  # a deleted PO is still readable
    for call in (
        client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"quantity": 5}),
        client.post(f"/api/purchase-orders/{po['id']}/line-groups/1/cancel-waiting", headers=h),
        client.post(f"/api/purchase-orders/{po['id']}/cancel-waiting", headers=h),
    ):
        resp = await call
        assert resp.status_code == 422 and "has been deleted" in resp.json()["detail"]


async def test_reading_the_lines_takes_the_same_few_queries_however_many_units_and_lines(client):
    w = await build_world()
    h = await login(client, w, "admin")
    small = await make_po(client, h, w, number="SMALL")
    await add_line(client, h, w, small["id"], quantity=1)
    big = await make_po(client, h, w, number="BIG")
    for n in range(12):
        await add_line(client, h, w, big["id"], "it" if n % 2 else "nonit", quantity=40, description=f"Thing {n}")

    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        statements.clear()
        assert len(await _groups(client, h, small["id"])) == 1
        few = len(statements)
        statements.clear()
        groups = await _groups(client, h, big["id"])
        many = len(statements)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)
    assert len(groups) == 12 and sum(g["ordered"] for g in groups) == 480
    assert many == few
