"""The serial-number rule lives on the Item only (not on Category / Sub-Category).
It is just a default for PO lines: a serial can still be typed, N/A still saved."""
from datetime import date
from types import SimpleNamespace
from sqlalchemy import select
from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, Department, Location
from app.masters.serial_rule import serial_default
from app.purchase_orders.models import PendingAsset, PurchaseOrder


def test_the_item_decides_and_no_item_means_yes():
    assert serial_default(SimpleNamespace(serial_required=True)) is True
    assert serial_default(SimpleNamespace(serial_required=False)) is False
    assert serial_default(None) is True


async def _setup():
    async with SessionLocal() as session:
        co = Company(code="SRL", name="Serial Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code="SRL", name="HO")
        dept = Department(name="SRL")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        session.add_all([loc, dept, cc])
        await session.flush()

        def user(code, role, owner=False):
            return AssetUser(company_id=co.id, code=code, name=f"{code} person", asset_user_type="EMPLOYEE", location_id=loc.id,
                             department_id=dept.id, role=role, is_primary_owner=owner, login_enabled=True,
                             password_hash=hash_password("Passw0rd!"), must_change_password=False)
        owner, operator = user("OWN", "ADMIN", True), user("OPR", "OPERATOR")
        session.add_all([owner, operator])
        await session.flush()
        po = PurchaseOrder(company_id=co.id, po_number="PO-SRL", po_date=date(2026, 1, 1), cost_center_id=cc.id,
                           created_by=operator.id, updated_by=operator.id)
        session.add(po)
        await session.commit()
        return po.id


async def _headers(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _masters(client, h):
    cat = (await client.post("/api/masters/categories", headers=h, json={"code": "ITF", "name": "IT Fixed Assets", "asset_domain": "IT"})).json()
    other = (await client.post("/api/masters/categories", headers=h, json={"code": "ADM", "name": "Admin Fixed Assets", "asset_domain": "NON_IT"})).json()
    sw = (await client.post("/api/masters/subcategories", headers=h, json={"category_id": cat["id"], "code": "SWT", "name": "Network Switch"})).json()
    fan = (await client.post("/api/masters/subcategories", headers=h, json={"category_id": other["id"], "code": "FAN", "name": "Fan"})).json()
    return cat, other, sw, fan


async def test_categories_and_sub_categories_no_longer_carry_a_serial_setting(client):
    await _setup()
    h = await _headers(client, "OWN")
    cat, _, sw, _ = await _masters(client, h)
    assert "serial_required" not in cat and "serial_required" not in sw
    listed = (await client.get("/api/masters/categories", headers=h)).json()
    assert all("serial_required" not in c for c in listed)
    edited = await client.put(f"/api/masters/categories/{cat['id']}", headers=h, json={
        "name": "IT Fixed Assets", "asset_domain": "IT", "serial_required": False})
    assert edited.status_code == 200 and "serial_required" not in edited.json()          # a stray field is ignored, not stored


async def test_an_item_says_yes_by_default_and_can_say_no(client):
    await _setup()
    h = await _headers(client, "OWN")
    cat, _, sw, _ = await _masters(client, h)

    def body(name, **over):
        return {"name": name, "category_id": cat["id"], "subcategory_id": sw["id"], **over}

    plain = await client.post("/api/items", headers=h, json=body("PoE Switch"))
    assert plain.status_code == 201 and plain.json()["serial_required"] is True
    no = await client.post("/api/items", headers=h, json=body("Patch Cord", serial_required=False))
    assert no.json()["serial_required"] is False
    back = await client.put(f"/api/items/{no.json()['id']}", headers=h, json=body("Patch Cord", serial_required=True))
    assert back.json()["serial_required"] is True
    assert (await client.post("/api/items", headers=h, json={"name": "No sub", "category_id": cat["id"]})).status_code == 422   # sub-category is required


async def test_an_operator_may_add_an_item_but_not_change_its_rule_afterwards(client):
    # S3a-1: an OPERATOR may add an Item in the flow (own work area); changing
    # an existing Item's serial rule needs an admin of its work area.
    await _setup()
    owner, op = await _headers(client, "OWN"), await _headers(client, "OPR")
    cat, _, sw, _ = await _masters(client, owner)
    resp = await client.post("/api/items", headers=op, json={
        "name": "X", "category_id": cat["id"], "subcategory_id": sw["id"], "serial_required": False})
    assert resp.status_code == 201, resp.text
    changed = await client.put(f"/api/items/{resp.json()['id']}", headers=op, json={
        "name": "X", "category_id": cat["id"], "subcategory_id": sw["id"], "serial_required": True})
    assert changed.status_code == 403


async def test_a_po_line_takes_its_category_and_serial_default_from_the_item(client):
    po_id = await _setup()
    owner, op = await _headers(client, "OWN"), await _headers(client, "OPR")
    cat, other, sw, fan = await _masters(client, owner)
    poe = (await client.post("/api/items", headers=owner, json={"name": "PoE Switch", "category_id": cat["id"], "subcategory_id": sw["id"]})).json()
    ceiling = (await client.post("/api/items", headers=owner, json={
        "name": "Ceiling Fan", "category_id": other["id"], "subcategory_id": fan["id"], "serial_required": False})).json()

    async def add(description, item, **over):
        body = {"description": description, "barcode": "B", "item_id": item["id"], "purchase_cost": 100, "tax_percent": 18, "quantity": 1, **over}
        resp = await client.post(f"/api/purchase-orders/{po_id}/lines", headers=op, json=body)
        assert resp.status_code == 201, resp.text
        return resp.json()[0]

    switch = await add("poe switch", poe)
    assert switch["serial_required"] is True
    assert (switch["category_id"], switch["subcategory_id"], switch["item_id"]) == (cat["id"], sw["id"], poe["id"])
    fan_line = await add("fan", ceiling, category_id=cat["id"], subcategory_id=sw["id"])    # the client's category is ignored
    assert fan_line["serial_required"] is False
    assert (fan_line["category_id"], fan_line["subcategory_id"]) == (other["id"], fan["id"])

    # Choosing another Item on a pending line re-derives category and the default.
    resp = await client.put(f"/api/purchase-orders/lines/{switch['id']}", headers=op, json={
        "description": "fan", "barcode": "B", "item_id": ceiling["id"], "purchase_cost": 100, "tax_percent": 18})
    assert resp.status_code == 200 and resp.json()["serial_required"] is False
    assert resp.json()["category_id"] == other["id"] and resp.json()["item_id"] == ceiling["id"]
    async with SessionLocal() as session:
        stored = (await session.execute(select(PendingAsset).where(PendingAsset.id == switch["id"]))).scalar_one()
        assert stored.serial_required is False and stored.item_id == ceiling["id"]

    # No Item and no category: nothing to file the line under.
    bad = await client.post(f"/api/purchase-orders/{po_id}/lines", headers=op, json={"description": "x", "barcode": "B", "quantity": 1})
    assert bad.status_code == 422
    # A deactivated Item cannot be picked afresh.
    assert (await client.delete(f"/api/items/{poe['id']}", headers=owner)).status_code == 204
    gone = await client.post(f"/api/purchase-orders/{po_id}/lines", headers=op, json={
        "description": "x", "barcode": "B", "item_id": poe["id"], "quantity": 1})
    assert gone.status_code == 422
