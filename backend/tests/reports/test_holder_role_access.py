"""Spec §6: a ASSET_USER sees ONLY the assets they currently hold. Company-wide KPIs,
the company movement log (other people's names) and the asset_user directory (other
people's email/phone) are staff-only (ADMIN / IT_TEAM / VIEWER)."""
from datetime import date

from app.assets.service import procure_assets
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.lifecycle.service import apply_event
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule


async def _setup():
    async with SessionLocal() as session:
        co = Company(code="HRA", name="HRA Co")
        cat = AssetCategory(code="IT", name="IT", asset_domain="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(company_id=co.id, code="HRA-HO", name="HO")
        dept = Department(name="IT-HRA")
        session.add_all([sub, cc, loc, dept])
        await session.flush()

        def person(code, role, asset_user_type="EMPLOYEE"):
            return AssetUser(company_id=co.id, code=code, name=f"Person {code}", asset_user_type=asset_user_type,
                          location_id=loc.id, department_id=dept.id, role=role, email=f"{code.lower()}@example.com",
                          phone="99999", login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)

        stock = person("STOCK", "SELF_SERVICE", "STOCK_POINT")
        admin, it_team, viewer, asset_user, other = (person("ADM", "ADMIN"), person("ITT", "OPERATOR"),
                                                 person("VWR", "VIEWER"), person("HLD", "SELF_SERVICE"), person("OTH", "SELF_SERVICE"))
        session.add_all([stock, admin, it_team, viewer, asset_user, other,
                         CodeRule(company_id=None, prefix_template="FA/", suffix_template="", start_number=1, pad_width=0)])
        await session.commit()

        base = {"company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
                "description": "Laptop", "purchase_date": date(2025, 1, 1), "initial_asset_user_id": stock.id}
        [mine] = await procure_assets(session, base, quantity=1, actor=admin)
        [theirs] = await procure_assets(session, base, quantity=1, actor=admin)
        await apply_event(session, mine, "MOVED", to_asset_user_id=asset_user.id, actor=admin)
        await apply_event(session, theirs, "MOVED", to_asset_user_id=other.id, actor=admin)
        await session.commit()
        return co.id, mine.id, theirs.id


async def _headers(client, company_id, code):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


STAFF_ONLY = (
    "/api/reports/dashboard",
    "/api/reports/export/movements?from_date=2020-01-01&to_date=2099-01-01",
    "/api/asset-users",
)


async def test_asset_user_gets_403_on_staff_only_endpoints(client):
    co_id, _, _ = await _setup()
    headers = await _headers(client, co_id, "HLD")
    for path in STAFF_ONLY:
        resp = await client.get(path, headers=headers)
        assert resp.status_code == 403, path


async def test_staff_roles_still_reach_those_endpoints(client):
    co_id, _, _ = await _setup()
    for code in ("ADM", "ITT", "VWR"):
        headers = await _headers(client, co_id, code)
        for path in STAFF_ONLY:
            resp = await client.get(path, headers=headers)
            assert resp.status_code == 200, (code, path)


async def test_asset_user_asset_list_still_scoped_to_own_held_assets(client):
    co_id, mine, theirs = await _setup()
    headers = await _headers(client, co_id, "HLD")
    resp = await client.get("/api/assets", headers=headers)
    assert resp.status_code == 200
    assert [a["id"] for a in resp.json()["items"]] == [mine]
    assert resp.json()["total"] == 1
    assert (await client.get(f"/api/assets/{theirs}", headers=headers)).status_code == 404
