"""Dashboard "Purchase Orders" card (2026-09-25): open POs still awaiting
delivery -- pending_po_summary (count/value) and open_purchase_orders
(a small, capped list), both scoped exactly like the rest of the dashboard."""
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, Company, CostCenter, Department, Location
from app.purchase_orders.service import add_pending_asset_line, cancel_pending_asset_line, create_purchase_order


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"DASH-PO-{suffix}", name=f"Dashboard PO Co {suffix}")
        cat = AssetCategory(code=f"DASH-PO-{suffix}", name="IT")
        session.add_all([co, cat])
        await session.flush()
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code=f"DASH-PO-{suffix}", name="HO")
        dept = Department(name=f"DASH-PO-{suffix}")
        session.add_all([cc, loc, dept])
        await session.flush()
        admin = Holder(company_id=co.id, emp_code=f"ADM-{suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add(admin)
        await session.commit()
        return {"co": co, "cc": cc, "cat": cat, "admin": admin}


async def _login(client, company_id, login_id):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": login_id, "password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_pending_po_summary_counts_only_pending_lines_and_sums_value(client):
    ctx = await _setup("D1")
    async with SessionLocal() as session:
        admin = await session.get(Holder, ctx["admin"].id)
        po = await create_purchase_order(session, {
            "company_id": ctx["co"].id, "po_number": "PO-1", "po_date": date(2026, 1, 1), "cost_center_id": ctx["cc"].id,
        }, admin)
        await session.commit()
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "purchase_cost": 1000, "tax_percent": 18, "quantity": 3,
        }, admin)
        await session.commit()
        # Cancel one of the three -- must not count toward pending count/value.
        await cancel_pending_asset_line(session, lines[0], admin)
        await session.commit()

    headers = await _login(client, ctx["co"].id, "ADM-D1")
    body = (await client.get("/api/reports/dashboard", headers=headers)).json()
    assert body["pending_po_summary"] == {"count": 2, "value": 2 * 1180.0}


async def test_pending_po_summary_is_explicit_zero_when_nothing_pending(client):
    ctx = await _setup("D2")
    headers = await _login(client, ctx["co"].id, "ADM-D2")
    body = (await client.get("/api/reports/dashboard", headers=headers)).json()
    assert body["pending_po_summary"] == {"count": 0, "value": 0.0}


async def test_viewer_sees_dashboard_but_never_po_data(client):
    """The Purchase Orders module itself is ADMIN/IT_TEAM only
    (app.purchase_orders.router) -- a VIEWER can load the dashboard (STAFF_ROLES)
    but must never see PO data through this side channel either, since /api/
    purchase-orders itself would 403 them."""
    ctx = await _setup("D2B")
    async with SessionLocal() as session:
        admin = await session.get(Holder, ctx["admin"].id)
        viewer = Holder(company_id=ctx["co"].id, emp_code="VWR-D2B", name="Viewer", holder_type="EMPLOYEE",
                         location_id=admin.location_id, department_id=admin.department_id, role="VIEWER",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add(viewer)
        await session.commit()
        po = await create_purchase_order(session, {
            "company_id": ctx["co"].id, "po_number": "PO-1", "po_date": date(2026, 1, 1), "cost_center_id": ctx["cc"].id,
        }, admin)
        await session.commit()
        await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "purchase_cost": 1000, "tax_percent": 18, "quantity": 1,
        }, admin)
        await session.commit()

    headers = await _login(client, ctx["co"].id, "VWR-D2B")
    body = (await client.get("/api/reports/dashboard", headers=headers)).json()
    assert body["pending_po_summary"] == {"count": 0, "value": 0.0}
    assert body["open_purchase_orders"] == []


async def test_open_purchase_orders_lists_only_pos_with_a_pending_line(client):
    ctx = await _setup("D3")
    async with SessionLocal() as session:
        admin = await session.get(Holder, ctx["admin"].id)
        po_open = await create_purchase_order(session, {
            "company_id": ctx["co"].id, "po_number": "PO-OPEN", "po_date": date(2026, 1, 1), "cost_center_id": ctx["cc"].id,
        }, admin)
        po_all_cancelled = await create_purchase_order(session, {
            "company_id": ctx["co"].id, "po_number": "PO-EMPTY", "po_date": date(2026, 1, 1), "cost_center_id": ctx["cc"].id,
        }, admin)
        await session.commit()
        [open_line] = await add_pending_asset_line(session, po_open, {
            "description": "Laptop", "category_id": ctx["cat"].id, "quantity": 1,
        }, admin)
        [cancelled_line] = await add_pending_asset_line(session, po_all_cancelled, {
            "description": "Mouse", "category_id": ctx["cat"].id, "quantity": 1,
        }, admin)
        await cancel_pending_asset_line(session, cancelled_line, admin)
        await session.commit()

    headers = await _login(client, ctx["co"].id, "ADM-D3")
    body = (await client.get("/api/reports/dashboard", headers=headers)).json()
    po_numbers = {row["po_number"] for row in body["open_purchase_orders"]}
    assert po_numbers == {"PO-OPEN"}
    row = next(r for r in body["open_purchase_orders"] if r["po_number"] == "PO-OPEN")
    assert row["pending_line_count"] == 1


async def test_open_purchase_orders_is_capped_and_company_scoped():
    from httpx import AsyncClient, ASGITransport
    from app.main import app

    async with SessionLocal() as session:
        co_a = Company(code="DASH-PO-D4A", name="Dashboard PO Co A")
        co_b = Company(code="DASH-PO-D4B", name="Dashboard PO Co B")
        cat = AssetCategory(code="DASH-PO-D4", name="IT")
        session.add_all([co_a, co_b, cat])
        await session.flush()
        cc_a = CostCenter(company_id=co_a.id, code="HO", name="Head Office")
        cc_b = CostCenter(company_id=co_b.id, code="HO", name="Head Office")
        loc_a = Location(company_id=co_a.id, code="DASH-PO-D4A", name="HO")
        loc_b = Location(company_id=co_b.id, code="DASH-PO-D4B", name="HO")
        dept = Department(name="DASH-PO-D4")
        session.add_all([cc_a, cc_b, loc_a, loc_b, dept])
        await session.flush()
        admin_a = Holder(company_id=co_a.id, emp_code="ADM-D4A", name="Admin A", holder_type="EMPLOYEE",
                          location_id=loc_a.id, department_id=dept.id, role="IT_TEAM",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        admin_b = Holder(company_id=co_b.id, emp_code="ADM-D4B", name="Admin B", holder_type="EMPLOYEE",
                          location_id=loc_b.id, department_id=dept.id, role="IT_TEAM",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([admin_a, admin_b])
        await session.commit()

        # 6 open POs in Company A (one more than OPEN_PURCHASE_ORDERS_LIMIT=5).
        for i in range(6):
            po = await create_purchase_order(session, {
                "company_id": co_a.id, "po_number": f"PO-A-{i}", "po_date": date(2026, 1, i + 1), "cost_center_id": cc_a.id,
            }, admin_a)
            await session.commit()
            await add_pending_asset_line(session, po, {
                "description": "Laptop", "category_id": cat.id, "quantity": 1,
            }, admin_a)
            await session.commit()

        po_b = await create_purchase_order(session, {
            "company_id": co_b.id, "po_number": "PO-B-1", "po_date": date(2026, 1, 1), "cost_center_id": cc_b.id,
        }, admin_b)
        await session.commit()
        await add_pending_asset_line(session, po_b, {
            "description": "Mouse", "category_id": cat.id, "quantity": 1,
        }, admin_b)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers_a = await _login(client, co_a.id, "ADM-D4A")
        body_a = (await client.get("/api/reports/dashboard", headers=headers_a)).json()
        assert len(body_a["open_purchase_orders"]) == 5  # capped, not all 6
        assert all(not row["po_number"].startswith("PO-B") for row in body_a["open_purchase_orders"])
