"""AM-12 G03: Dashboard operational exception visibility (Repair/Lost/Closed)
and a small, scoped, snapshot-correct Recent Activity feed."""
from datetime import date, timedelta
from httpx import AsyncClient, ASGITransport
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.service import procure_assets
from app.holders.service import HolderService
from app.lifecycle.service import apply_event
from app.main import app
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def _setup(code_suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"CKS-{code_suffix}", name=f"Dashboard Exceptions Co {code_suffix}")
        cat = AssetCategory(code=f"IT-{code_suffix}", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code=f"HO-{code_suffix}", name="HO")
        dept = Department(name=f"IT-{code_suffix}")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"STK-{code_suffix}", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"ADM-{code_suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template=f"FA/{{cost_center.code}}/{{category.code}}/{{subcategory.code}}/{code_suffix}_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, admin, rule])
        await session.commit()
        return {"co": co, "cat": cat, "sub": sub, "cc": cc, "stock": stock, "admin": admin}


async def _login(client, company_id, login_id):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": login_id, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_am12_exception_counts_cover_repair_lost_and_every_closed_state(client):
    ids = await _setup("EX1")
    async with SessionLocal() as session:
        admin = await session.get(Holder, ids["admin"].id)
        make = lambda desc: procure_assets(session, {
            "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
            "subcategory_id": ids["sub"].id, "description": desc, "purchase_date": date(2025, 1, 1),
            "initial_holder_id": ids["stock"].id,
        }, quantity=1, actor=admin)

        [repair_asset] = await make("Repair Asset")
        await apply_event(session, repair_asset, "SENT_FOR_REPAIR", to_holder_id=None, actor=admin)

        [lost_asset] = await make("Lost Asset")
        await apply_event(session, lost_asset, "LOST", to_holder_id=None, actor=admin)

        [disposed_asset] = await make("Disposed Asset")
        await apply_event(session, disposed_asset, "DISPOSED", to_holder_id=None, actor=admin)

        [sold_asset] = await make("Sold Asset")
        await apply_event(session, sold_asset, "SOLD", to_holder_id=None, actor=admin)

        [scrapped_asset] = await make("Scrapped Asset")
        await apply_event(session, scrapped_asset, "SCRAPPED", to_holder_id=None, actor=admin)

        await make("Healthy In-Stock Asset")  # never touched -- stays IN_STOCK
        await session.commit()

    headers = await _login(client, ids["co"].id, f"ADM-EX1")
    body = (await client.get("/api/reports/dashboard", headers=headers)).json()
    assert body["exception_counts"] == {
        "UNDER_REPAIR": 1, "LOST": 1, "DISPOSED": 1, "SOLD": 1, "SCRAPPED": 1,
    }


async def test_am12_exception_counts_are_explicit_zero_not_omitted(client):
    """A status with zero matching assets must still appear as 0, not be missing
    from the response entirely -- the frontend must be able to render "Repair: 0"
    without special-casing an absent key."""
    ids = await _setup("EX2")
    headers = await _login(client, ids["co"].id, "ADM-EX2")
    body = (await client.get("/api/reports/dashboard", headers=headers)).json()
    assert body["exception_counts"] == {"UNDER_REPAIR": 0, "LOST": 0, "DISPOSED": 0, "SOLD": 0, "SCRAPPED": 0}


async def test_am12_exception_counts_are_company_scoped():
    """A non-ADMIN caller must never see another company's exception counts; ADMIN
    sees every company's combined."""
    async with SessionLocal() as session:
        co_a = Company(code="CKS-EX3A", name="Exceptions Co A")
        co_b = Company(code="CKS-EX3B", name="Exceptions Co B")
        cat = AssetCategory(code="IT-EX3", name="IT")
        session.add_all([co_a, co_b, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc_a = CostCenter(company_id=co_a.id, code="HO01", name="HO")
        cc_b = CostCenter(company_id=co_b.id, code="HO01", name="HO")
        loc = Location(code="HO-EX3", name="HO")
        dept = Department(name="IT-EX3")
        session.add_all([sub, cc_a, cc_b, loc, dept])
        await session.flush()
        stock_a = Holder(company_id=co_a.id, emp_code="STK-EX3A", name="Stock A", holder_type="IT_STOCK",
                          location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_team_a = Holder(company_id=co_a.id, emp_code="ITT-EX3A", name="IT Team A", holder_type="EMPLOYEE",
                            location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                            password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer_a = Holder(company_id=co_a.id, emp_code="VWR-EX3A", name="Viewer A", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="VIEWER",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        stock_b = Holder(company_id=co_b.id, emp_code="STK-EX3B", name="Stock B", holder_type="IT_STOCK",
                          location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin_b = Holder(company_id=co_b.id, emp_code="ADM-EX3B", name="Admin B", holder_type="EMPLOYEE",
                          location_id=loc.id, department_id=dept.id, role="ADMIN",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        admin_global = Holder(company_id=co_a.id, emp_code="SUPERADM-EX3", name="Super Admin", holder_type="EMPLOYEE",
                               location_id=loc.id, department_id=dept.id, role="ADMIN",
                               password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/EX3_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock_a, it_team_a, viewer_a, stock_b, admin_b, admin_global, rule])
        await session.commit()

        [asset_a] = await procure_assets(session, {
            "company_id": co_a.id, "cost_center_id": cc_a.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Company A Repair Asset", "purchase_date": date(2025, 1, 1), "initial_holder_id": stock_a.id,
        }, quantity=1, actor=it_team_a)
        await apply_event(session, asset_a, "SENT_FOR_REPAIR", to_holder_id=None, actor=it_team_a)

        [asset_b] = await procure_assets(session, {
            "company_id": co_b.id, "cost_center_id": cc_b.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Company B Lost Asset", "purchase_date": date(2025, 1, 1), "initial_holder_id": stock_b.id,
        }, quantity=1, actor=admin_b)
        await apply_event(session, asset_b, "LOST", to_holder_id=None, actor=admin_b)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # IT_TEAM in Company A: sees only Company A's own repair count, never Company B's lost asset.
        headers_it = await _login(client, co_a.id, "ITT-EX3A")
        body_it = (await client.get("/api/reports/dashboard", headers=headers_it)).json()
        assert body_it["exception_counts"]["UNDER_REPAIR"] == 1
        assert body_it["exception_counts"]["LOST"] == 0

        # VIEWER in Company A: identically scoped -- read-only, but never broadened.
        headers_viewer = await _login(client, co_a.id, "VWR-EX3A")
        body_viewer = (await client.get("/api/reports/dashboard", headers=headers_viewer)).json()
        assert body_viewer["exception_counts"]["UNDER_REPAIR"] == 1
        assert body_viewer["exception_counts"]["LOST"] == 0

        # ADMIN: unrestricted, sees both companies' exceptions combined.
        headers_admin = await _login(client, co_a.id, "SUPERADM-EX3")
        body_admin = (await client.get("/api/reports/dashboard", headers=headers_admin)).json()
        assert body_admin["exception_counts"]["UNDER_REPAIR"] == 1
        assert body_admin["exception_counts"]["LOST"] == 1


async def test_am12_recent_activity_ordering_limit_and_scoping():
    """Newest-first, capped at 5, company-scoped exactly like the rest of the dashboard."""
    async with SessionLocal() as session:
        co_a = Company(code="CKS-RA1A", name="Recent Activity Co A")
        co_b = Company(code="CKS-RA1B", name="Recent Activity Co B")
        cat = AssetCategory(code="IT-RA1", name="IT")
        session.add_all([co_a, co_b, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc_a = CostCenter(company_id=co_a.id, code="HO01", name="HO")
        cc_b = CostCenter(company_id=co_b.id, code="HO01", name="HO")
        loc = Location(code="HO-RA1", name="HO")
        dept = Department(name="IT-RA1")
        session.add_all([sub, cc_a, cc_b, loc, dept])
        await session.flush()
        stock_a = Holder(company_id=co_a.id, emp_code="STK-RA1A", name="Stock A", holder_type="IT_STOCK",
                          location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin_a = Holder(company_id=co_a.id, emp_code="ADM-RA1A", name="Admin A", holder_type="EMPLOYEE",
                          location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        emp_a = Holder(company_id=co_a.id, emp_code="EMP-RA1A", name="Employee A", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="HOLDER",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        stock_b = Holder(company_id=co_b.id, emp_code="STK-RA1B", name="Stock B", holder_type="IT_STOCK",
                          location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin_b = Holder(company_id=co_b.id, emp_code="ADM-RA1B", name="Admin B", holder_type="EMPLOYEE",
                          location_id=loc.id, department_id=dept.id, role="ADMIN",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/RA1_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock_a, admin_a, emp_a, stock_b, admin_b, rule])
        await session.commit()

        # 6 MOVED events in Company A (one more than RECENT_ACTIVITY_LIMIT=5), each with a
        # distinct, strictly increasing event_date so ordering is unambiguous.
        events_a = []
        for i in range(6):
            [asset] = await procure_assets(session, {
                "company_id": co_a.id, "cost_center_id": cc_a.id, "category_id": cat.id, "subcategory_id": sub.id,
                "description": f"Activity Asset {i}", "purchase_date": date(2025, 1, 1), "initial_holder_id": stock_a.id,
            }, quantity=1, actor=admin_a)
            from datetime import datetime, timezone
            ev = await apply_event(
                session, asset, "MOVED", to_holder_id=emp_a.id, actor=admin_a,
                event_date=datetime(2025, 6, 1, 12, i, 0, tzinfo=timezone.utc),
            )
            events_a.append((asset, ev))

        # One event in Company B, after every Company A event -- must never appear for A's caller.
        [asset_b] = await procure_assets(session, {
            "company_id": co_b.id, "cost_center_id": cc_b.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Company B Activity Asset", "purchase_date": date(2025, 1, 1), "initial_holder_id": stock_b.id,
        }, quantity=1, actor=admin_b)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers_a = await _login(client, co_a.id, "ADM-RA1A")
        body_a = (await client.get("/api/reports/dashboard", headers=headers_a)).json()

        activity = body_a["recent_activity"]
        assert len(activity) == 5  # capped, not all 6

        # Newest-first: the 6th (last-created, latest event_date) asset's event comes first.
        newest_asset, newest_event = events_a[-1]
        assert activity[0]["asset_id"] == newest_asset.id
        assert activity[0]["id"] == newest_event.id

        # Strictly descending event_date across the returned page.
        dates = [a["event_date"] for a in activity]
        assert dates == sorted(dates, reverse=True)

        # Never Company B's event, and every row carries the label/asset_code/actor context.
        company_b_asset_ids = {asset_b.id}
        assert all(a["asset_id"] not in company_b_asset_ids for a in activity)
        for row in activity:
            assert row["label"]
            assert row["asset_code"]
            assert row["recorded_by_name"] == "Admin A"


async def test_am12_recent_activity_uses_point_in_time_holder_name_snapshots(client):
    """A holder rename after an event was recorded must not retroactively change how
    that event reads in Recent Activity -- same AM-01 guarantee the History tab has."""
    ids = await _setup("RA2")
    async with SessionLocal() as session:
        admin = await session.get(Holder, ids["admin"].id)
        emp = Holder(company_id=ids["co"].id, emp_code="EMP-RA2", name="Original Name", holder_type="EMPLOYEE",
                     location_id=ids["stock"].location_id, department_id=ids["stock"].department_id, role="HOLDER")
        session.add(emp)
        await session.flush()
        [asset] = await procure_assets(session, {
            "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
            "subcategory_id": ids["sub"].id, "description": "Snapshot Asset", "purchase_date": date(2025, 1, 1),
            "initial_holder_id": ids["stock"].id,
        }, quantity=1, actor=admin)
        await apply_event(session, asset, "MOVED", to_holder_id=emp.id, actor=admin)
        await session.commit()

        # Rename the holder *after* the event was recorded.
        await HolderService(session).update(emp.id, {
            "company_id": ids["co"].id, "emp_code": "EMP-RA2", "name": "Renamed After The Fact",
            "holder_type": "EMPLOYEE", "location_id": ids["stock"].location_id,
            "department_id": ids["stock"].department_id, "role": "HOLDER",
        }, actor_id=admin.id)
        await session.commit()

    headers = await _login(client, ids["co"].id, "ADM-RA2")
    body = (await client.get("/api/reports/dashboard", headers=headers)).json()
    labels = [a["label"] for a in body["recent_activity"]]
    assert any("Original Name" in label for label in labels)
    assert not any("Renamed After The Fact" in label for label in labels)
