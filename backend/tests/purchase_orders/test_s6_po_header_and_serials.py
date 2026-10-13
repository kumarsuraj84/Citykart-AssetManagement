"""S6: PUT /api/purchase-orders/{id} (header edit: vendor, cost centre, delivery place, PO date, PO number) and
the additive `masked` flag on check-serials conflicts."""
from sqlalchemy import select, update

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.masters.models import CostCenter, MasterAudit, Vendor
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.core.s0_world import make_asset
from tests.purchase_orders.s4_world import build_s4_world, login, make_po, receipt


async def _audit(po_id: int) -> list[tuple[str, str | None, str | None]]:
    async with SessionLocal() as s:
        rows = (await s.execute(select(MasterAudit).where(
            MasterAudit.entity == "purchase_order", MasterAudit.entity_id == po_id).order_by(MasterAudit.id))).scalars().all()
        return [(r.field, r.old_value, r.new_value) for r in rows]


async def _extra_masters(w: dict) -> dict:
    async with SessionLocal() as s:
        vendor2 = Vendor(code="S6V2", name="Second Vendor")
        cc2 = CostCenter(company_id=w["co"], code="WH", name="Warehouse")
        s.add_all([vendor2, cc2])
        await s.commit()
        return {"vendor2": vendor2.id, "cc2": cc2.id}


async def _po(client, h, w, number="PO-H", lines=(("gangbox", 2),)):
    return await make_po(client, h, w, list(lines), number=number)


# ------------------------------------------------------------------ header edit

async def test_every_header_field_can_be_changed_while_nothing_is_received_and_is_audited(client):
    w = await build_s4_world()
    m = await _extra_masters(w)
    h = await login(client, w, "owner")
    po = await _po(client, h, w)
    resp = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={
        "vendor_id": m["vendor2"], "cost_center_id": m["cc2"], "delivery_asset_user_id": w["stock2"],
        "po_date": "2026-01-15", "po_number": "PO-H2"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["vendor_id"], body["cost_center_id"], body["delivery_asset_user_id"], body["po_date"], body["po_number"]) == (
        m["vendor2"], m["cc2"], w["stock2"], "2026-01-15", "PO-H2")
    assert body["vendor_name"] == "Second Vendor" and body["waiting_units"] == 2          # same shape as GET
    assert sorted(await _audit(po["id"])) == sorted([
        ("vendor", "Good Vendor", "Second Vendor"), ("cost_centre", "Head Office", "Warehouse"),
        ("delivery_place", "Main Stock", "Second Stock"), ("po_number", "PO-H", "PO-H2"),
        ("po_date", "01-01-2026", "15-01-2026")])
    async with SessionLocal() as s:                  # the waiting units carry the new cost centre to their assets
        assert set((await s.execute(select(PendingAsset.cost_center_id).where(
            PendingAsset.purchase_order_id == po["id"]))).scalars().all()) == {m["cc2"]}


async def test_only_sent_fields_change_and_resending_the_same_values_writes_nothing(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await _po(client, h, w)
    same = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={
        "po_number": " PO-H ", "po_date": "2026-01-01", "vendor_id": w["vendor"], "cost_center_id": w["cc"]})
    assert same.status_code == 200 and await _audit(po["id"]) == []
    only_place = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={"delivery_asset_user_id": None})
    assert only_place.status_code == 200
    assert only_place.json()["delivery_asset_user_id"] is None and only_place.json()["vendor_id"] == w["vendor"]
    assert await _audit(po["id"]) == [("delivery_place", "Main Stock", None)]


async def test_after_a_receipt_only_the_delivery_place_can_change(client):
    w = await build_s4_world()
    m = await _extra_masters(w)
    h = await login(client, w, "owner")
    po = await _po(client, h, w)
    received = await client.post(f"/api/purchase-orders/{po['id']}/receive", headers=h,
                                 json=receipt(w, [{"line_no": 1, "quantity": 1}]))
    assert received.status_code == 200, received.text
    for change, words in (({"vendor_id": m["vendor2"]}, "vendor"), ({"cost_center_id": m["cc2"]}, "cost centre"),
                          ({"po_number": "NEW"}, "PO number"), ({"po_date": "2026-01-02"}, "PO date"),
                          ({"vendor_id": m["vendor2"], "po_number": "NEW"}, "vendor and PO number")):
        resp = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json=change)
        assert resp.status_code == 422, change
        assert resp.json()["detail"] == (
            f"Goods have already been received on this purchase order, so its {words} can no longer be changed "
            "(the received assets keep what they were received with). Only the delivery place can still be changed.")
    place = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={"delivery_asset_user_id": w["stock2"]})
    assert place.status_code == 200 and place.json()["delivery_asset_user_id"] == w["stock2"]
    assert await _audit(po["id"]) == [("delivery_place", "Main Stock", "Second Stock")]


async def test_an_operators_header_edit_is_recorded_with_who_made_it(client):
    w = await build_s4_world()
    owner = await login(client, w, "owner")
    po = await _po(client, owner, w)
    op = await login(client, w, "op_it")
    resp = await client.put(f"/api/purchase-orders/{po['id']}", headers=op, json={"po_number": "PO-OP"})
    assert resp.status_code == 200 and resp.json()["po_number"] == "PO-OP"
    async with SessionLocal() as s:
        [row] = (await s.execute(select(MasterAudit).where(MasterAudit.entity == "purchase_order"))).scalars().all()
        assert (row.field, row.old_value, row.new_value, row.actor_id) == ("po_number", "PO-H", "PO-OP", w["op_it"])
        assert (await s.get(PurchaseOrder, po["id"])).updated_by == w["op_it"]


async def test_the_po_number_stays_unique_per_company(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    first = await _po(client, h, w, "PO-A")
    await _po(client, h, w, "PO-B")
    other = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co_b"], "po_number": "PO-IN-B", "po_date": "2026-01-01", "cost_center_id": w["cc_b"]})
    assert other.status_code == 201
    clash = await client.put(f"/api/purchase-orders/{first['id']}", headers=h, json={"po_number": "po-b"})
    assert clash.status_code == 422 and clash.json()["detail"] == "Purchase order po-b already exists for this company."
    fine = await client.put(f"/api/purchase-orders/{first['id']}", headers=h, json={"po_number": "PO-IN-B"})
    assert fine.status_code == 200 and fine.json()["po_number"] == "PO-IN-B"            # another company's number


async def test_a_po_made_from_the_erp_keeps_the_erps_number_date_and_supplier(client):
    w = await build_s4_world()
    m = await _extra_masters(w)
    h = await login(client, w, "owner")
    po = await _po(client, h, w)
    async with SessionLocal() as s:
        await s.execute(update(PurchaseOrder).where(PurchaseOrder.id == po["id"]).values(erp_po_code=777001))
        await s.commit()
    for change in ({"po_number": "MINE"}, {"po_date": "2026-01-02"}):
        resp = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json=change)
        assert resp.status_code == 422 and resp.json()["detail"] == (
            "This purchase order was made from the ERP, so its PO number and PO date are the ERP's and cannot be changed here.")
    vendor = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={"vendor_id": m["vendor2"]})
    assert vendor.status_code == 422 and vendor.json()["detail"].startswith(
        "This purchase order was made from the ERP, so its vendor follows the ERP supplier.")
    same = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={"po_number": "PO-H", "po_date": "2026-01-01",
                                                                                 "vendor_id": w["vendor"]})
    assert same.status_code == 200                                                   # unchanged values are fine
    cc = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={"cost_center_id": m["cc2"]})
    assert cc.status_code == 200 and cc.json()["cost_center_id"] == m["cc2"]


async def test_new_choices_are_checked_in_plain_words(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await _po(client, h, w)
    url = f"/api/purchase-orders/{po['id']}"
    cases = [
        ({"vendor_id": w["dead_vendor"]}, "The vendor Closed Vendor is no longer active; choose another."),
        ({"vendor_id": 999999}, "The vendor you chose does not exist."),
        ({"cost_center_id": w["dead_cc"]}, "The cost centre Closed office is no longer active; choose another."),
        ({"cost_center_id": w["cc_b"]}, "The cost centre must belong to the same company as the purchase order."),
        ({"cost_center_id": None}, "Choose the cost centre."),
        ({"delivery_asset_user_id": w["dead_stock"]}, "The delivery location you chose does not exist or is no longer active."),
        ({"delivery_asset_user_id": w["stock_b"]}, "The delivery location must belong to the same company as the purchase order."),
        ({"po_number": "   "}, "PO number cannot be blank."),
        ({"po_number": None}, "PO number cannot be blank."),
        ({"po_date": None}, "Choose the PO date."),
        ({"po_date": "2999-01-01"}, "PO date cannot be in the future."),
    ]
    for change, message in cases:
        resp = await client.put(url, headers=h, json=change)
        assert resp.status_code == 422, (change, resp.text)
        assert resp.json()["detail"] == message, change
    assert await _audit(po["id"]) == []


async def test_a_refused_edit_changes_nothing(client):
    w = await build_s4_world()
    m = await _extra_masters(w)
    h = await login(client, w, "owner")
    po = await _po(client, h, w, "PO-A")
    await _po(client, h, w, "PO-B")
    resp = await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={"vendor_id": m["vendor2"], "po_number": "PO-B"})
    assert resp.status_code == 422
    async with SessionLocal() as s:
        fresh = await s.get(PurchaseOrder, po["id"])
        assert (fresh.vendor_id, fresh.po_number) == (w["vendor"], "PO-A")
    assert await _audit(po["id"]) == []


async def test_who_may_edit_a_po_header(client):
    w = await build_s4_world()
    owner = await login(client, w, "owner")
    it_po = await _po(client, owner, w, "PO-IT", lines=(("gangbox", 1),))
    mixed = await _po(client, owner, w, "PO-MIX", lines=(("gangbox", 1), ("chair", 1)))
    body = {"delivery_asset_user_id": w["stock2"]}
    assert (await client.put(f"/api/purchase-orders/{it_po['id']}", headers=await login(client, w, "op_it"), json=body)).status_code == 200
    refused = await client.put(f"/api/purchase-orders/{mixed['id']}", headers=await login(client, w, "op_it"), json=body)
    assert refused.status_code == 403 and "Non-IT work" in refused.json()["detail"]
    assert (await client.put(f"/api/purchase-orders/{mixed['id']}", headers=await login(client, w, "admin"), json=body)).status_code == 200
    assert (await client.put(f"/api/purchase-orders/{it_po['id']}", headers=await login(client, w, "viewer_it"), json=body)).status_code == 403
    assert (await client.put(f"/api/purchase-orders/{it_po['id']}", headers=await login(client, w, "op_nonit"), json=body)).status_code == 404


async def test_another_companys_po_is_not_found_and_a_deleted_po_cannot_be_edited(client):
    w = await build_s4_world()
    owner = await login(client, w, "owner")
    po_b = await client.post("/api/purchase-orders", headers=owner, json={
        "company_id": w["co_b"], "po_number": "PO-B1", "po_date": "2026-01-01", "cost_center_id": w["cc_b"]})
    resp = await client.put(f"/api/purchase-orders/{po_b.json()['id']}", headers=await login(client, w, "op_both"),
                            json={"po_number": "X"})
    assert resp.status_code == 404
    po = await _po(client, owner, w)
    assert (await client.delete(f"/api/purchase-orders/{po['id']}", headers=owner)).status_code == 200
    gone = await client.put(f"/api/purchase-orders/{po['id']}", headers=owner, json={"po_number": "AGAIN"})
    assert gone.status_code == 422 and gone.json()["detail"] == (
        "This purchase order has been deleted, so nothing new can be recorded on it.")


# ------------------------------------------------------------------ check-serials `masked`

async def test_check_serials_flags_a_conflict_outside_the_callers_scope_as_masked(client):
    w = await build_s4_world()
    owner = await login(client, w, "owner")
    await make_asset(client, owner, w, "it", serial_number="LAP-1")
    await make_asset(client, owner, w, "nonit", serial_number="CHAIR-1")
    it_op = await login(client, w, "op_it")
    resp = await client.post("/api/purchase-orders/check-serials", headers=it_op, json={"serials": ["LAP-1", "CHAIR-1", "FREE-1"]})
    by = {c["serial"]: c for c in resp.json()["conflicts"]}
    assert set(by) == {"LAP-1", "CHAIR-1"}
    assert by["LAP-1"]["masked"] is False and by["LAP-1"]["asset_code"].startswith("S0/")
    assert by["CHAIR-1"] == {"serial": "CHAIR-1", "asset_code": "an asset outside your companies or work area", "masked": True}
    seen_all = await client.post("/api/purchase-orders/check-serials", headers=owner, json={"serials": ["CHAIR-1"]})
    assert seen_all.json()["conflicts"][0]["masked"] is False


async def test_check_serials_masks_another_companys_asset(client):
    w = await build_s4_world()
    owner = await login(client, w, "owner")
    await make_asset(client, owner, w, "it", serial_number="B-SER-1", company_id=w["co_b"], cost_center_id=w["cc_b"],
                     initial_asset_user_id=w["stock_b"])
    resp = await client.post("/api/purchase-orders/check-serials", headers=await login(client, w, "op_both"),
                             json={"serials": ["b-ser-1"]})
    [conflict] = resp.json()["conflicts"]
    assert conflict["masked"] is True and conflict["asset_code"] == "an asset outside your companies or work area"


async def test_goods_received_after_a_header_edit_carry_the_new_header(client):
    w = await build_s4_world()
    m = await _extra_masters(w)
    h = await login(client, w, "owner")
    po = await _po(client, h, w)
    assert (await client.put(f"/api/purchase-orders/{po['id']}", headers=h, json={
        "vendor_id": m["vendor2"], "cost_center_id": m["cc2"], "po_number": "PO-NEW", "po_date": "2026-01-10"})).status_code == 200
    received = await client.post(f"/api/purchase-orders/{po['id']}/receive", headers=h,
                                 json=receipt(w, [{"line_no": 1, "quantity": 2}]))
    assert received.status_code == 200, received.text
    async with SessionLocal() as s:
        assets = (await s.execute(select(Asset).where(Asset.po_number == "PO-NEW"))).scalars().all()
        assert len(assets) == 2
        assert {(a.vendor_id, a.cost_center_id, a.po_date.isoformat()) for a in assets} == {(m["vendor2"], m["cc2"], "2026-01-10")}
