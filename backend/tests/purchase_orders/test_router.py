from datetime import date
from httpx import AsyncClient, ASGITransport
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.main import app
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule


async def _setup(suffix: str, second_company: bool = False):
    async with SessionLocal() as session:
        co = Company(code=f"PO-RTR-{suffix}", name=f"PO Router Test Co {suffix}")
        cat = AssetCategory(code=f"PO-RTR-{suffix}", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code=f"PO-RTR-{suffix}", name="HO")
        dept = Department(name=f"PO-RTR-{suffix}")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"STK-{suffix}", name="IT Stock", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"ADM-{suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_team = Holder(company_id=co.id, emp_code=f"ITT-{suffix}", name="IT Team", holder_type="EMPLOYEE",
                          location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer = Holder(company_id=co.id, emp_code=f"VWR-{suffix}", name="Viewer", holder_type="EMPLOYEE",
                         location_id=loc.id, department_id=dept.id, role="VIEWER",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        holder = Holder(company_id=co.id, emp_code=f"HLD-{suffix}", name="Holder", holder_type="EMPLOYEE",
                         location_id=loc.id, department_id=dept.id, role="HOLDER",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template="PORTR/{yyyy}/", suffix_template="",
                         start_number=1, pad_width=3)
        session.add_all([stock, admin, it_team, viewer, holder, rule])
        await session.commit()

        result = {
            "co_id": co.id, "cc_id": cc.id, "cat_id": cat.id, "sub_id": sub.id,
            "stock_id": stock.id, "admin_emp": f"ADM-{suffix}", "it_team_emp": f"ITT-{suffix}",
            "viewer_emp": f"VWR-{suffix}", "holder_emp": f"HLD-{suffix}",
        }
        if second_company:
            co_b = Company(code=f"PO-RTR-{suffix}B", name=f"PO Router Test Co {suffix}B")
            cat_b = AssetCategory(code=f"PO-RTR-{suffix}B", name="IT")
            session.add_all([co_b, cat_b])
            await session.flush()
            cc_b = CostCenter(company_id=co_b.id, code="HO", name="Head Office")
            loc_b = Location(company_id=co_b.id, code=f"PO-RTR-{suffix}B", name="HO B")
            session.add(loc_b)
            await session.flush()
            # IT_TEAM, not ADMIN: ADMIN is deliberately unrestricted across every
            # company (scoped_company_ids returns None for it), so an isolation
            # test needs a genuinely company-scoped role to prove anything --
            # same reasoning the existing dashboard/asset isolation tests use.
            it_team_b = Holder(company_id=co_b.id, emp_code=f"ITT-{suffix}B", name="IT Team B", holder_type="EMPLOYEE",
                                location_id=loc_b.id, department_id=dept.id, role="IT_TEAM",
                                password_hash=hash_password("Passw0rd!"), must_change_password=False)
            session.add_all([cc_b, it_team_b])
            await session.commit()
            result.update({"co_b_id": co_b.id, "cc_b_id": cc_b.id, "it_team_b_emp": f"ITT-{suffix}B"})
        return result


async def _login(client, login_id, company_id=None):
    payload = {"login_id": login_id, "password": "Passw0rd!"}
    if company_id is not None:
        payload["company_id"] = company_id
    resp = await client.post("/api/auth/login", json=payload)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_create_po_and_add_line_happy_path(client):
    ctx = await _setup("R1")
    headers = await _login(client, ctx["admin_emp"])

    po_resp = await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-1", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers)
    assert po_resp.status_code == 201, po_resp.text
    po_id = po_resp.json()["id"]

    lines_resp = await client.post(f"/api/purchase-orders/{po_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "subcategory_id": ctx["sub_id"],
        "barcode": "BC-SHARED", "purchase_cost": 1000, "tax_percent": 18, "quantity": 2,
    }, headers=headers)
    assert lines_resp.status_code == 201, lines_resp.text
    assert len(lines_resp.json()) == 2
    assert all(l["cost_center_id"] == ctx["cc_id"] for l in lines_resp.json())
    assert all(l["barcode"] == "BC-SHARED" for l in lines_resp.json())


async def test_create_po_rejects_cross_company_cost_centre(client):
    ctx = await _setup("R2", second_company=True)
    headers = await _login(client, ctx["admin_emp"])

    resp = await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-1", "po_date": "2026-01-01", "cost_center_id": ctx["cc_b_id"],
    }, headers=headers)
    assert resp.status_code == 422


async def test_edit_and_cancel_line(client):
    ctx = await _setup("R3")
    headers = await _login(client, ctx["admin_emp"])
    po_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-1", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers)).json()["id"]
    line = (await client.post(f"/api/purchase-orders/{po_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 1,
    }, headers=headers)).json()[0]

    edit_resp = await client.put(f"/api/purchase-orders/lines/{line['id']}", json={
        "description": "Laptop Pro", "category_id": ctx["cat_id"],
    }, headers=headers)
    assert edit_resp.status_code == 200
    assert edit_resp.json()["description"] == "Laptop Pro"

    cancel_resp = await client.post(f"/api/purchase-orders/lines/{line['id']}/cancel", headers=headers)
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "CANCELLED"

    second_cancel = await client.post(f"/api/purchase-orders/lines/{line['id']}/cancel", headers=headers)
    assert second_cancel.status_code == 422


async def test_deliver_endpoint_creates_real_assets(client):
    ctx = await _setup("R4")
    headers = await _login(client, ctx["admin_emp"])
    po_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-1", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers)).json()["id"]
    lines = (await client.post(f"/api/purchase-orders/{po_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 2,
    }, headers=headers)).json()

    deliver_resp = await client.post(f"/api/purchase-orders/{po_id}/deliver", json={
        "invoice_number": "INV-1", "invoice_date": "2026-02-01", "invoice_amount": 2000,
        "lines": [
            {"pending_asset_id": lines[0]["id"], "serial_number": "SN-A", "initial_holder_id": ctx["stock_id"]},
            {"pending_asset_id": lines[1]["id"], "serial_number": "SN-B", "initial_holder_id": ctx["stock_id"]},
        ],
    }, headers=headers)
    assert deliver_resp.status_code == 200, deliver_resp.text
    assert all(l["status"] == "DELIVERED" for l in deliver_resp.json())

    assets_resp = await client.get(f"/api/assets?company_id={ctx['co_id']}", headers=headers)
    assert assets_resp.json()["total"] == 2


async def test_deliver_rejects_a_line_from_a_different_po(client):
    ctx = await _setup("R5")
    headers = await _login(client, ctx["admin_emp"])
    po1_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-1", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers)).json()["id"]
    po2_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-2", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers)).json()["id"]
    line_po2 = (await client.post(f"/api/purchase-orders/{po2_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 1,
    }, headers=headers)).json()[0]

    resp = await client.post(f"/api/purchase-orders/{po1_id}/deliver", json={
        "invoice_number": "INV-1", "invoice_date": "2026-02-01", "invoice_amount": 1000,
        "lines": [{"pending_asset_id": line_po2["id"], "serial_number": "SN-X", "initial_holder_id": ctx["stock_id"]}],
    }, headers=headers)
    assert resp.status_code == 422


async def test_company_isolation_on_po_read_and_write(client):
    ctx = await _setup("R6", second_company=True)
    headers_a = await _login(client, ctx["admin_emp"])
    po_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-1", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers_a)).json()["id"]

    headers_b = await _login(client, ctx["it_team_b_emp"])
    get_resp = await client.get(f"/api/purchase-orders/{po_id}", headers=headers_b)
    assert get_resp.status_code == 404

    add_resp = await client.post(f"/api/purchase-orders/{po_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 1,
    }, headers=headers_b)
    assert add_resp.status_code == 404


async def test_viewer_and_holder_cannot_write(client):
    ctx = await _setup("R7")
    admin_headers = await _login(client, ctx["admin_emp"])
    po_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-1", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=admin_headers)).json()["id"]

    viewer_headers = await _login(client, ctx["viewer_emp"])
    holder_headers = await _login(client, ctx["holder_emp"])

    for headers in (viewer_headers, holder_headers):
        assert (await client.get("/api/purchase-orders", headers=headers)).status_code == 403
        assert (await client.post("/api/purchase-orders", json={
            "company_id": ctx["co_id"], "po_number": "PO-X", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
        }, headers=headers)).status_code == 403
        assert (await client.post(f"/api/purchase-orders/{po_id}/lines", json={
            "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 1,
        }, headers=headers)).status_code == 403


async def test_pending_assets_never_appear_in_asset_register(client):
    ctx = await _setup("R8")
    headers = await _login(client, ctx["admin_emp"])
    before = (await client.get(f"/api/assets?company_id={ctx['co_id']}", headers=headers)).json()["total"]

    po_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-1", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers)).json()["id"]
    await client.post(f"/api/purchase-orders/{po_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 3,
    }, headers=headers)

    after = (await client.get(f"/api/assets?company_id={ctx['co_id']}", headers=headers)).json()["total"]
    assert after == before
