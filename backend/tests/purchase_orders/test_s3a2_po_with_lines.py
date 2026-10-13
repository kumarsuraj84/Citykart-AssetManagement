"""S3a-2: POST /api/purchase-orders/with-lines -- the one-screen manual PO: header, lines and sets in ONE
transaction, defaults from the Item, optional barcode (which delivery and labels never needed)."""
from sqlalchemy import func, select

from app.bundles.models import Bundle, BundlePart
from app.core.db import SessionLocal
from app.items.models import Item
from app.masters.models import Brand
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.core.s3a1_world import build_s3_world, login

URL = "/api/purchase-orders/with-lines"


async def world():
    w = await build_s3_world()
    async with SessionLocal() as s:
        laptop = await s.get(Item, w["item_it"])
        laptop.default_brand_id, laptop.default_warranty_years = w["brand"], 3
        later = Item(name="Amplifier", category_id=w["it"], subcategory_id=w["lap"], serial_later=True)
        mouse = Item(name="Mouse", category_id=w["it"], subcategory_id=w["lap"], serial_required=False)
        retired = Item(name="Old Printer", category_id=w["it"], subcategory_id=w["lap"], is_active=False)
        s.add_all([later, mouse, retired])
        await s.flush()
        kit = Bundle(name="Desktop Kit")
        s.add(kit)
        await s.flush()
        s.add_all([BundlePart(bundle_id=kit.id, name="CPU", item_id=laptop.id, category_id=w["it"], subcategory_id=w["lap"],
                              share_percent=80, sort_order=0),
                   BundlePart(bundle_id=kit.id, name="Mouse", item_id=mouse.id, category_id=w["it"], subcategory_id=w["lap"],
                              share_percent=20, sort_order=1)])
        await s.commit()
        w.update({"item_later": later.id, "item_mouse": mouse.id, "item_retired": retired.id, "kit": kit.id})
    return w


def body(w, **over):
    data = {"company_id": w["co"], "po_number": "MAN-1", "po_date": "2026-01-01", "cost_center_id": w["cc"],
            "vendor_id": w["vendor"], "delivery_asset_user_id": w["stock"],
            "lines": [{"item_id": w["item_it"], "quantity": 2, "purchase_cost": 50000, "tax_percent": 18}]}
    data.update(over)
    return data


async def units(po_id):
    async with SessionLocal() as s:
        return (await s.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id))).scalars().all()


async def po_count():
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(PurchaseOrder))).scalar_one()


async def test_a_whole_po_is_made_in_one_call_with_defaults_from_the_item(client):
    w = await world()
    h = await login(client, w, "op_it")
    resp = await client.post(URL, headers=h, json=body(w, lines=[
        {"item_id": w["item_it"], "quantity": 2, "purchase_cost": 50000, "tax_percent": 18},
        {"item_id": w["item_it"], "quantity": 1, "purchase_cost": 60000, "brand_id": w["brand"], "model": "Latitude 5440",
         "description": "  ", "barcode": "  ", "warranty_years": 1},
        {"item_id": w["item_later"], "quantity": 1, "purchase_cost": 900, "barcode": "AMP-1"},
        {"item_id": w["item_mouse"], "quantity": 3, "purchase_cost": 300},
    ]))
    assert resp.status_code == 201, resp.text
    po = resp.json()
    assert (po["po_number"], po["vendor_name"], po["company_name"], po["status"]) == ("MAN-1", "Good Vendor", "S0 Company A", "WAITING")
    assert (po["ordered_units"], po["waiting_units"], po["lines_created"], po["units_created"]) == (7, 7, 4, 7)
    rows = await units(po["id"])
    first, second, amp, mouse = rows[0], rows[2], rows[3], rows[4]
    assert (first.description, first.brand_id, first.warranty_years, first.barcode, first.model) == ("Laptop", w["brand"], 3, None, None)
    assert (first.category_id, first.subcategory_id, first.asset_domain, first.serial_required) == (w["it"], w["lap"], "IT", True)
    assert (second.description, second.warranty_years, second.barcode) == ("Laptop Dell Latitude 5440", 1, None)
    assert (amp.barcode, amp.serial_later, amp.brand_id, amp.warranty_years) == ("AMP-1", True, None, 0)
    assert (mouse.serial_required, mouse.description) == (False, "Mouse")
    assert [r.line_no for r in rows] == [1, 1, 2, 3, 4, 4, 4]
    assert (first.tax_percent, float(first.total_cost)) == (18, 59000)


async def test_lines_then_sets_get_line_numbers_and_a_set_needs_no_barcode(client):
    w = await world()
    h = await login(client, w, "admin")
    resp = await client.post(URL, headers=h, json=body(w, sets=[{"bundle_id": w["kit"], "quantity": 2, "price_per_set": 1000, "tax_percent": 18}]))
    assert resp.status_code == 201, resp.text
    assert (resp.json()["lines_created"], resp.json()["units_created"]) == (3, 6)
    groups = (await client.get(f"/api/purchase-orders/{resp.json()['id']}/line-groups", headers=h)).json()
    assert [(g["line_no"], g["description"], g["ordered"], g["rate"], g["bundle_label"], g["barcode"]) for g in groups] == [
        (1, "Laptop", 2, 50000.0, None, None), (2, "Desktop Kit - CPU", 2, 800.0, "Desktop Kit", None),
        (3, "Desktop Kit - Mouse", 2, 200.0, "Desktop Kit", None)]
    edited = await client.post(URL, headers=h, json=body(w, po_number="MAN-2", lines=[], sets=[{
        "bundle_id": w["kit"], "quantity": 1, "price_per_set": 1000, "description": "Reception desktop", "barcode": "KIT-9",
        "part_amounts": [{"part_id": p, "amount": a} for p, a in await _parts_with(w, 700, 300)]}]))
    assert edited.status_code == 201, edited.text
    rows = await units(edited.json()["id"])
    assert [(r.description, float(r.purchase_cost), r.barcode) for r in rows] == [
        ("Reception desktop - CPU", 700.0, "KIT-9"), ("Reception desktop - Mouse", 300.0, "KIT-9")]


async def _parts_with(w, *amounts):
    async with SessionLocal() as s:
        ids = (await s.execute(select(BundlePart.id).where(BundlePart.bundle_id == w["kit"]).order_by(BundlePart.sort_order))).scalars().all()
    return list(zip(ids, amounts))


async def test_any_bad_line_creates_nothing_and_the_message_names_the_line(client):
    w = await world()
    h = await login(client, w, "op_it")
    bad = await client.post(URL, headers=h, json=body(w, lines=[
        {"item_id": w["item_it"], "quantity": 2, "purchase_cost": 100},
        {"item_id": w["item_retired"], "quantity": 1, "purchase_cost": 100}]))
    assert bad.status_code == 422
    assert bad.json()["detail"] == "Line 2: The Item Old Printer is no longer active; choose another."
    bad_brand = await client.post(URL, headers=h, json=body(w, lines=[
        {"item_id": w["item_it"], "quantity": 1, "purchase_cost": 100},
        {"item_id": w["item_it"], "quantity": 1, "purchase_cost": 100, "brand_id": w["dead_brand"]}]))
    assert bad_brand.status_code == 422 and bad_brand.json()["detail"].startswith("Line 2: The brand Gone Brand is no longer active")
    bad_set = await client.post(URL, headers=h, json=body(w, sets=[{"bundle_id": 999999, "quantity": 1, "price_per_set": 10}]))
    assert bad_set.status_code == 422 and bad_set.json()["detail"].startswith("Set 1: ")
    assert await po_count() == 0
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count()).select_from(PendingAsset))).scalar_one() == 0


async def test_a_retired_default_brand_is_simply_not_used(client):
    w = await world()
    async with SessionLocal() as s:
        (await s.get(Brand, w["brand"])).is_active = False
        await s.commit()
    resp = await client.post(URL, headers=await login(client, w, "op_it"), json=body(w))
    assert resp.status_code == 201, resp.text
    assert {u.brand_id for u in await units(resp.json()["id"])} == {None}


async def test_company_work_area_and_inactive_header_refusals(client):
    w = await world()
    other = await client.post(URL, headers=await login(client, w, "op_b"), json=body(w))
    assert other.status_code == 403
    area = await client.post(URL, headers=await login(client, w, "op_it"), json=body(w, lines=[
        {"item_id": w["item_it"], "quantity": 1, "purchase_cost": 100}, {"item_id": w["item_nonit"], "quantity": 1, "purchase_cost": 100}]))
    assert area.status_code == 403 and area.json()["detail"].startswith("Line 2: ") and "outside your work area" in area.json()["detail"]
    h = await login(client, w, "admin")
    assert "no longer active" in (await client.post(URL, headers=h, json=body(w, cost_center_id=w["dead_cc"]))).json()["detail"]
    assert "no longer active" in (await client.post(URL, headers=h, json=body(w, vendor_id=w["dead_vendor"]))).json()["detail"]
    assert (await client.post(URL, headers=h, json=body(w, delivery_asset_user_id=w["dead_stock"]))).status_code == 422
    assert (await client.post(URL, headers=await login(client, w, "viewer_it"), json=body(w))).status_code == 403
    assert await po_count() == 0
    assert (await client.post(URL, headers=h, json=body(w))).status_code == 201
    dup = await client.post(URL, headers=h, json=body(w, po_number=" man-1 "))
    assert dup.status_code == 422 and "already exists" in dup.json()["detail"]


async def test_limits_per_line_and_per_request(client):
    w = await world()
    h = await login(client, w, "admin")
    too_many_units = await client.post(URL, headers=h, json=body(w, lines=[{"item_id": w["item_it"], "quantity": 1001, "purchase_cost": 1}]))
    assert too_many_units.status_code == 422
    entries = [{"item_id": w["item_it"], "quantity": 1, "purchase_cost": 1}] * 60
    sets = [{"bundle_id": w["kit"], "quantity": 1, "price_per_set": 10}] * 41
    too_many_lines = await client.post(URL, headers=h, json=body(w, lines=entries, sets=sets))
    assert too_many_lines.status_code == 422 and "at most 100 lines and sets" in too_many_lines.json()["detail"]
    empty = await client.post(URL, headers=h, json=body(w, lines=[]))
    assert empty.status_code == 422 and "Add at least one line or set." in empty.json()["detail"]
    assert (await client.post(URL, headers=h, json=body(w, lines=entries[:50], sets=sets[:50]))).status_code == 201


async def test_units_without_a_barcode_are_received_and_their_labels_print(client):
    w = await world()
    h = await login(client, w, "admin")
    po = (await client.post(URL, headers=h, json=body(w))).json()
    waiting = [u.id for u in await units(po["id"])]
    delivered = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json={
        "invoice_number": "INV-1", "invoice_date": "2026-01-05", "invoice_amount": 118000,
        "lines": [{"pending_asset_id": waiting[0], "serial_number": "SN-1", "initial_asset_user_id": w["stock"]},
                  {"pending_asset_id": waiting[1], "serial_pending": True, "initial_asset_user_id": w["stock"]}]})
    assert delivered.status_code == 200, delivered.text
    asset_ids = [u["delivered_asset_id"] for u in delivered.json()]
    for asset_id in asset_ids:
        asset = (await client.get(f"/api/assets/{asset_id}", headers=h)).json()
        assert asset["barcode"] is None and asset["asset_code"]
        for path in (f"/api/assets/{asset_id}/label.png", f"/api/assets/{asset_id}/label.png?symbol=qr", f"/api/assets/{asset_id}/qr.png"):
            label = await client.get(path, headers=h)
            assert label.status_code == 200 and label.headers["content-type"] == "image/png"
    groups = (await client.get(f"/api/purchase-orders/{po['id']}/line-groups", headers=h)).json()
    assert [(g["received"], g["waiting"], g["status"], g["barcode"]) for g in groups] == [(2, 0, "RECEIVED", None)]
