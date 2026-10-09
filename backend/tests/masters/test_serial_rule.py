"""Serial-number rule on Categories and Sub-Categories: a sub-category's own
yes/no wins, otherwise its category's; it is only a default for PO lines."""
from datetime import date
from types import SimpleNamespace
from sqlalchemy import select
from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.masters.serial_rule import effective_serial_required
from app.purchase_orders.models import PendingAsset, PurchaseOrder


def cat(required):
    return SimpleNamespace(serial_required=required)


def test_the_sub_category_setting_wins_and_null_means_same_as_the_category():
    assert effective_serial_required(cat(True), None) is True
    assert effective_serial_required(cat(False), None) is False
    assert effective_serial_required(cat(True), cat(None)) is True
    assert effective_serial_required(cat(False), cat(None)) is False
    assert effective_serial_required(cat(True), cat(False)) is False      # Mouse under Accessories
    assert effective_serial_required(cat(False), cat(True)) is True       # a serial-bearing item under a no-serial category


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


async def test_categories_default_to_serial_yes_and_the_setting_can_be_created_and_edited(client):
    await _setup()
    h = await _headers(client, "OWN")
    plain = await client.post("/api/masters/categories", headers=h, json={"code": "CPU", "name": "Computers", "asset_domain": "IT"})
    assert plain.status_code == 201 and plain.json()["serial_required"] is True
    none = await client.post("/api/masters/categories", headers=h, json={
        "code": "CAB", "name": "Cables", "asset_domain": "IT", "serial_required": False})
    assert none.status_code == 201 and none.json()["serial_required"] is False

    edited = await client.put(f"/api/masters/categories/{none.json()['id']}", headers=h, json={
        "name": "Cables", "asset_domain": "IT", "serial_required": True})
    assert edited.status_code == 200 and edited.json()["serial_required"] is True
    listed = {c["code"]: c["serial_required"] for c in (await client.get("/api/masters/categories", headers=h)).json()}
    assert listed == {"CPU": True, "CAB": True}


async def test_a_sub_category_can_follow_its_category_or_override_it(client):
    await _setup()
    h = await _headers(client, "OWN")
    category = (await client.post("/api/masters/categories", headers=h, json={"code": "ACC", "name": "Accessories", "asset_domain": "IT"})).json()
    same = await client.post("/api/masters/subcategories", headers=h, json={"category_id": category["id"], "code": "HUB", "name": "Hub"})
    assert same.status_code == 201 and same.json()["serial_required"] is None
    mouse = await client.post("/api/masters/subcategories", headers=h, json={
        "category_id": category["id"], "code": "MS", "name": "Mouse", "serial_required": False})
    assert mouse.status_code == 201 and mouse.json()["serial_required"] is False
    back = await client.put(f"/api/masters/subcategories/{mouse.json()['id']}", headers=h, json={"name": "Mouse", "serial_required": None})
    assert back.status_code == 200 and back.json()["serial_required"] is None


async def test_only_the_primary_owner_can_change_the_rule(client):
    await _setup()
    op = await _headers(client, "OPR")
    resp = await client.post("/api/masters/categories", headers=op, json={
        "code": "X", "name": "X", "asset_domain": "IT", "serial_required": False})
    assert resp.status_code == 403


async def test_a_po_line_starts_with_the_serial_default_of_its_category_or_sub_category(client):
    po_id = await _setup()
    owner, op = await _headers(client, "OWN"), await _headers(client, "OPR")
    cables = (await client.post("/api/masters/categories", headers=owner, json={
        "code": "CAB", "name": "Cables", "asset_domain": "IT", "serial_required": False})).json()
    patch = (await client.post("/api/masters/subcategories", headers=owner, json={"category_id": cables["id"], "code": "PCH", "name": "Patch cord"})).json()
    switch = (await client.post("/api/masters/subcategories", headers=owner, json={
        "category_id": cables["id"], "code": "SW", "name": "Switch", "serial_required": True})).json()
    comp = (await client.post("/api/masters/categories", headers=owner, json={"code": "CPU", "name": "Computers", "asset_domain": "IT"})).json()
    mouse = (await client.post("/api/masters/subcategories", headers=owner, json={
        "category_id": comp["id"], "code": "MS", "name": "Mouse", "serial_required": False})).json()

    async def add(description, category, sub):
        body = {"description": description, "barcode": "B", "category_id": category["id"], "subcategory_id": sub["id"] if sub else None,
                "purchase_cost": 100, "tax_percent": 18, "quantity": 1}
        resp = await client.post(f"/api/purchase-orders/{po_id}/lines", headers=op, json=body)
        assert resp.status_code == 201, resp.text
        return resp.json()[0]

    assert (await add("patch cord", cables, patch))["serial_required"] is False     # inherits the no-serial category
    assert (await add("switch", cables, switch))["serial_required"] is True         # sub-category says yes
    assert (await add("mouse", comp, mouse))["serial_required"] is False            # sub-category says no
    line = await add("pc", comp, None)
    assert line["serial_required"] is True                                          # category default yes

    # Changing the category of a pending line re-derives the default.
    resp = await client.put(f"/api/purchase-orders/lines/{line['id']}", headers=op, json={
        "description": "pc", "barcode": "B", "category_id": cables["id"], "subcategory_id": patch["id"],
        "purchase_cost": 100, "tax_percent": 18})
    assert resp.status_code == 200 and resp.json()["serial_required"] is False
    async with SessionLocal() as session:
        stored = (await session.execute(select(PendingAsset).where(PendingAsset.id == line["id"]))).scalar_one()
        assert stored.serial_required is False
