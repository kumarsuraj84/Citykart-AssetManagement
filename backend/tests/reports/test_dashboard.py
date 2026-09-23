from datetime import date, timedelta
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.service import procure_assets
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_dashboard_counts_and_warranty_alert(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-DB1", name="Dashboard Test Co")
        cat = AssetCategory(code="IT-DB1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-DB1", name="HO")
        dept = Department(name="IT-DB1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-DB1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-DB1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Dashboard Laptop", "purchase_date": date(2025, 12, 10),
            "warranty_upto": date.today() + timedelta(days=10), "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-DB1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    dash_resp = await client.get("/api/reports/dashboard", headers=headers)
    assert dash_resp.status_code == 200
    body = dash_resp.json()
    assert body["status_counts"]["IN_STOCK"] >= 1
    assert any(a["warranty_upto"] for a in body["warranty_alerts"])


async def test_dashboard_scopes_by_company_and_long_allocation_alert():
    """A non-ADMIN in Company A must never see Company B's KPI numbers, and an asset
    ALLOTTED for over LONG_ALLOCATION_ALERT_DAYS days must surface in
    long_allocation_alerts while a freshly allotted asset must not."""
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    from app.lifecycle.service import apply_event

    async with SessionLocal() as session:
        co_a = Company(code="CKS-DB2A", name="Dashboard Co A")
        co_b = Company(code="CKS-DB2B", name="Dashboard Co B")
        cat = AssetCategory(code="IT-DB2", name="IT")
        session.add_all([co_a, co_b, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc_a = CostCenter(company_id=co_a.id, code="HO01", name="HO")
        cc_b = CostCenter(company_id=co_b.id, code="HO01", name="HO")
        loc = Location(code="HO-DB2", name="HO")
        dept = Department(name="IT-DB2")
        session.add_all([sub, cc_a, cc_b, loc, dept])
        await session.flush()

        stock_a = Holder(company_id=co_a.id, emp_code="ITSTOCK-DB2A", name="IT Stock A", holder_type="IT_STOCK",
                          location_id=loc.id, department_id=dept.id, role="HOLDER")
        # role=IT_TEAM (not ADMIN) so this holder is genuinely scoped to its own company --
        # scoped_company_ids(holder) returns None (unrestricted, sees everything) for
        # ADMIN by design, so proving per-company scoping requires a non-ADMIN caller.
        admin_a = Holder(company_id=co_a.id, emp_code="ITA-DB2A", name="IT Team A", holder_type="EMPLOYEE",
                          location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        holder_a = Holder(company_id=co_a.id, emp_code="EMP-DB2A", name="Employee A", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="HOLDER",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        stock_b = Holder(company_id=co_b.id, emp_code="ITSTOCK-DB2B", name="IT Stock B", holder_type="IT_STOCK",
                          location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin_b = Holder(company_id=co_b.id, emp_code="ITA-DB2B", name="IT Admin B", holder_type="EMPLOYEE",
                          location_id=loc.id, department_id=dept.id, role="ADMIN",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock_a, admin_a, holder_a, stock_b, admin_b, rule])
        await session.commit()

        # Company A: one asset allotted 200 days ago (over the 180-day threshold) and one
        # allotted just now (must not alert).
        [old_asset] = await procure_assets(session, {
            "company_id": co_a.id, "cost_center_id": cc_a.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Old allotment", "purchase_date": date(2024, 1, 1), "initial_holder_id": stock_a.id,
        }, quantity=1, actor=admin_a)
        await apply_event(session, old_asset, "MOVED", to_holder_id=holder_a.id, actor=admin_a)
        # apply_event stamps status_since with "now" (and rejects a backdated event_date
        # here since it would precede the PROCURED event) -- backdate it directly to
        # simulate an asset that has genuinely sat ALLOTTED for 200 days.
        old_asset.status_since = date.today() - timedelta(days=200)

        [recent_asset] = await procure_assets(session, {
            "company_id": co_a.id, "cost_center_id": cc_a.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Recent allotment", "purchase_date": date(2024, 1, 1), "initial_holder_id": stock_a.id,
        }, quantity=1, actor=admin_a)
        await apply_event(session, recent_asset, "MOVED", to_holder_id=holder_a.id, actor=admin_a)

        # Company B: an unrelated asset that Company A's IT_TEAM caller must never see.
        await procure_assets(session, {
            "company_id": co_b.id, "cost_center_id": cc_b.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Company B asset", "purchase_date": date(2024, 1, 1), "initial_holder_id": stock_b.id,
        }, quantity=1, actor=admin_b)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp_a = await client.post("/api/auth/login", json={"company_id": co_a.id, "emp_code": "ITA-DB2A", "password": "Passw0rd!"})
        headers_a = {"Authorization": f"Bearer {resp_a.json()['access_token']}"}

        dash_a = (await client.get("/api/reports/dashboard", headers=headers_a)).json()

        # Company A's IT_TEAM caller sees exactly Company A's 2 assets -- and never
        # Company B's (a per-test-function truncated DB means nothing from the module's
        # other test leaks in either).
        assert sum(dash_a["status_counts"].values()) == 2

        alerted_ids = {a["asset_id"] for a in dash_a["long_allocation_alerts"]}
        assert old_asset.id in alerted_ids
        assert recent_asset.id not in alerted_ids
        for alert in dash_a["long_allocation_alerts"]:
            assert alert["days_allotted"] > 180
