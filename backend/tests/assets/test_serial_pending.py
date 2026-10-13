"""Serial pending: an amplifier shows no serial on the box, it is read in the store.
Delivery can leave the serial "to be added", the asset joins a Serial Pending list,
and IT fills it in later -- never confused with N/A (genuinely none)."""
from sqlalchemy import select
from app.assets.models import Asset, AssetFieldChange
from app.core.db import SessionLocal
from tests.purchase_orders.test_router import _login, _setup


async def _item(client, headers, ctx, name, **over):
    resp = await client.post("/api/items", headers=headers, json={
        "name": name, "category_id": ctx["cat_id"], "subcategory_id": ctx["sub_id"], **over})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _po_with_lines(client, headers, ctx, item_id, quantity=2, po_number="PO-SP"):
    po_id = (await client.post("/api/purchase-orders", headers=headers, json={
        "company_id": ctx["co_id"], "po_number": po_number, "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    })).json()["id"]
    lines = (await client.post(f"/api/purchase-orders/{po_id}/lines", headers=headers, json={
        "description": "Amplifier", "item_id": item_id, "barcode": "AMP", "quantity": quantity, "purchase_cost": 500,
    })).json()
    return po_id, lines


def _deliver_body(ctx, lines, **over):
    return {"invoice_number": "INV-SP", "invoice_date": "2026-02-01", "invoice_amount": 1000, "lines": [
        {"pending_asset_id": l["id"], "initial_asset_user_id": ctx["stock_id"], **over} for l in lines]}


async def test_an_item_can_say_its_serial_is_read_later_but_only_if_it_has_a_serial(client):
    ctx = await _setup("SP1")
    h = await _login(client, ctx["admin_emp"])
    # the Admin in this fixture is not the Primary Owner, so make one through the DB flag
    async with SessionLocal() as session:
        from app.asset_users.models import AssetUser
        admin = (await session.execute(select(AssetUser).where(AssetUser.code == ctx["admin_emp"]))).scalar_one()
        admin.is_primary_owner = True
        await session.commit()
    later = await _item(client, h, ctx, "Amplifier", serial_later=True)
    assert later["serial_later"] is True and later["serial_required"] is True
    none = await _item(client, h, ctx, "Mouse", serial_required=False, serial_later=True)
    assert none["serial_later"] is False                        # nothing to read later on a thing with no serial
    plain = await _item(client, h, ctx, "Laptop")
    assert plain["serial_later"] is False


async def test_a_po_line_from_a_serial_later_item_starts_with_serial_later(client):
    ctx = await _setup("SP2")
    h = await _login(client, ctx["admin_emp"])
    async with SessionLocal() as session:
        from app.asset_users.models import AssetUser
        (await session.execute(select(AssetUser).where(AssetUser.code == ctx["admin_emp"]))).scalar_one().is_primary_owner = True
        await session.commit()
    amp = await _item(client, h, ctx, "Amplifier", serial_later=True)
    _, lines = await _po_with_lines(client, h, ctx, amp["id"])
    assert all(l["serial_later"] is True and l["serial_required"] is True for l in lines)


async def test_delivering_with_serial_pending_makes_assets_without_a_serial_that_are_listed_and_not_n_a(client):
    ctx = await _setup("SP3")
    h = await _login(client, ctx["admin_emp"])
    async with SessionLocal() as session:
        from app.asset_users.models import AssetUser
        (await session.execute(select(AssetUser).where(AssetUser.code == ctx["admin_emp"]))).scalar_one().is_primary_owner = True
        await session.commit()
    amp = await _item(client, h, ctx, "Amplifier", serial_later=True)
    po_id, lines = await _po_with_lines(client, h, ctx, amp["id"])

    resp = await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json=_deliver_body(ctx, lines, serial_pending=True))
    assert resp.status_code == 200, resp.text
    assert all(l["status"] == "DELIVERED" and l["serial_number"] is None for l in resp.json())     # the PO is done

    async with SessionLocal() as session:
        assets = (await session.execute(select(Asset))).scalars().all()
        mine = [a for a in assets if a.po_number == "PO-SP"]
        assert len(mine) == 2 and all(a.serial_pending and a.serial_number is None for a in mine)

    pending = (await client.get("/api/assets?serial_pending=true", headers=h)).json()
    assert pending["total"] == 2
    assert all(a["serial_pending"] is True and a["serial_number"] is None for a in pending["items"])
    # a delivery with a real serial or N/A is never pending
    # S0.5: a PO number is used once per company, so the second PO gets its own.
    po2, lines2 = await _po_with_lines(client, h, ctx, amp["id"], quantity=1, po_number="PO-SP-2")
    ok = await client.post(f"/api/purchase-orders/{po2}/deliver", headers=h, json=_deliver_body(ctx, lines2, serial_number="N/A"))
    assert ok.status_code == 200
    assert (await client.get("/api/assets?serial_pending=true", headers=h)).json()["total"] == 2


async def test_a_delivery_line_needs_a_serial_or_n_a_or_pending(client):
    ctx = await _setup("SP4")
    h = await _login(client, ctx["admin_emp"])
    po_id =(await client.post("/api/purchase-orders", headers=h, json={
        "company_id": ctx["co_id"], "po_number": "PO-SP4", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    })).json()["id"]
    lines = (await client.post(f"/api/purchase-orders/{po_id}/lines", headers=h, json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 1})).json()
    bad = await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json=_deliver_body(ctx, lines))
    assert bad.status_code == 422


async def test_it_fills_the_serial_later_or_marks_it_as_having_none(client):
    ctx = await _setup("SP5")
    h = await _login(client, ctx["admin_emp"])
    async with SessionLocal() as session:
        from app.asset_users.models import AssetUser
        (await session.execute(select(AssetUser).where(AssetUser.code == ctx["admin_emp"]))).scalar_one().is_primary_owner = True
        await session.commit()
    amp = await _item(client, h, ctx, "Amplifier", serial_later=True)
    po_id, lines = await _po_with_lines(client, h, ctx, amp["id"], quantity=3)
    await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json=_deliver_body(ctx, lines, serial_pending=True))
    ids = [a["id"] for a in (await client.get("/api/assets?serial_pending=true", headers=h)).json()["items"]]
    assert len(ids) == 3

    it = await _login(client, ctx["it_team_emp"])                      # an IT person (OPERATOR)
    first = await client.put(f"/api/assets/{ids[0]}/serial", headers=it, json={"serial_number": "  AMP-0001 "})
    assert first.status_code == 200 and first.json()["serial_number"] == "AMP-0001" and first.json()["serial_pending"] is False
    dup = await client.put(f"/api/assets/{ids[1]}/serial", headers=it, json={"serial_number": "amp-0001"})
    assert dup.status_code == 422 and "already used" in dup.json()["detail"]
    none = await client.put(f"/api/assets/{ids[1]}/serial", headers=it, json={"no_serial": True})
    assert none.status_code == 200 and none.json()["serial_number"] == "N/A" and none.json()["serial_pending"] is False
    assert (await client.put(f"/api/assets/{ids[2]}/serial", headers=it, json={})).status_code == 422     # nothing entered
    again = await client.put(f"/api/assets/{ids[0]}/serial", headers=it, json={"serial_number": "X"})
    assert again.status_code == 422 and "not pending" in again.json()["detail"]                              # only a pending one

    assert (await client.get("/api/assets?serial_pending=true", headers=it)).json()["total"] == 1
    async with SessionLocal() as session:                                 # the change is in the audit trail
        changes = (await session.execute(select(AssetFieldChange).where(AssetFieldChange.asset_id == ids[0]))).scalars().all()
        assert any(c.field_name == "serial_number" and c.new_value == "AMP-0001" for c in changes)


async def test_only_people_who_may_edit_assets_can_fill_it_and_the_ordinary_edit_settles_it_too(client):
    ctx = await _setup("SP6")
    h = await _login(client, ctx["admin_emp"])
    async with SessionLocal() as session:
        from app.asset_users.models import AssetUser
        (await session.execute(select(AssetUser).where(AssetUser.code == ctx["admin_emp"]))).scalar_one().is_primary_owner = True
        await session.commit()
    amp = await _item(client, h, ctx, "Amplifier", serial_later=True)
    po_id, lines = await _po_with_lines(client, h, ctx, amp["id"], quantity=2)
    await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json=_deliver_body(ctx, lines, serial_pending=True))
    ids = [a["id"] for a in (await client.get("/api/assets?serial_pending=true", headers=h)).json()["items"]]

    viewer = await _login(client, ctx["viewer_emp"])
    assert (await client.put(f"/api/assets/{ids[0]}/serial", headers=viewer, json={"serial_number": "V-1"})).status_code == 403

    detail = (await client.get(f"/api/assets/{ids[0]}", headers=h)).json()
    edit = await client.put(f"/api/assets/{ids[0]}", headers=h, json={
        "description": detail["description"], "serial_number": "ED-1", "barcode": detail["barcode"]})
    assert edit.status_code == 200, edit.text
    assert edit.json()["serial_pending"] is False                       # typing a serial in the full edit settles it
    other = await client.put(f"/api/assets/{ids[1]}", headers=h, json={"description": "renamed", "barcode": "AMP"})
    assert other.json()["serial_pending"] is True                       # an unrelated edit leaves it pending


async def test_add_asset_can_leave_the_serial_for_later(client):
    ctx = await _setup("SP7")
    h = await _login(client, ctx["admin_emp"])
    async with SessionLocal() as session:
        from app.asset_users.models import AssetUser
        from app.masters.models import Vendor
        (await session.execute(select(AssetUser).where(AssetUser.code == ctx["admin_emp"]))).scalar_one().is_primary_owner = True
        session.add(Vendor(code="SPV", name="SP Vendor"))
        await session.commit()
        vendor_id = (await session.execute(select(Vendor.id).where(Vendor.code == "SPV"))).scalar_one()
    body = {"company_id": ctx["co_id"], "cost_center_id": ctx["cc_id"], "category_id": ctx["cat_id"], "subcategory_id": ctx["sub_id"],
            "description": "Old amplifier", "barcode": "OLD", "vendor_id": vendor_id, "initial_asset_user_id": ctx["stock_id"]}
    missing = await client.post("/api/assets", headers=h, json=body)
    assert missing.status_code == 422                                   # still needs a serial, N/A or "later"
    ok = await client.post("/api/assets", headers=h, json={**body, "serial_pending": True, "serial_number": "ignored"})
    assert ok.status_code == 201, ok.text
    assert ok.json()[0]["serial_pending"] is True and ok.json()[0]["serial_number"] is None


async def test_the_dashboard_counts_pending_serials_still_in_use(client):
    ctx = await _setup("SP8")
    h = await _login(client, ctx["admin_emp"])
    async with SessionLocal() as session:
        from app.asset_users.models import AssetUser
        (await session.execute(select(AssetUser).where(AssetUser.code == ctx["admin_emp"]))).scalar_one().is_primary_owner = True
        await session.commit()
    assert (await client.get("/api/reports/dashboard", headers=h)).json()["serial_pending_count"] == 0
    amp = await _item(client, h, ctx, "Amplifier", serial_later=True)
    po_id, lines = await _po_with_lines(client, h, ctx, amp["id"], quantity=2)
    await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json=_deliver_body(ctx, lines, serial_pending=True))
    assert (await client.get("/api/reports/dashboard", headers=h)).json()["serial_pending_count"] == 2
    ids = [a["id"] for a in (await client.get("/api/assets?serial_pending=true", headers=h)).json()["items"]]
    await client.put(f"/api/assets/{ids[0]}/serial", headers=h, json={"serial_number": "DASH-1"})
    assert (await client.get("/api/reports/dashboard", headers=h)).json()["serial_pending_count"] == 1
