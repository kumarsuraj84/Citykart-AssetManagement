"""Company-owned master data (cost centers, and the company rows themselves) may
only be written by a non-ADMIN actor inside their own company scope."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import Company, CostCenter, Department, Location


async def _setup():
    async with SessionLocal() as session:
        a = Company(code="MSA", name="MSA Co")
        b = Company(code="MSB", name="MSB Co")
        session.add_all([a, b])
        await session.flush()
        loc = Location(company_id=a.id, code="MS-HO", name="HO")
        dept = Department(name="IT-MS")
        session.add_all([loc, dept])
        await session.flush()
        cc_a = CostCenter(company_id=a.id, code="A01", name="A cc")
        cc_b = CostCenter(company_id=b.id, code="B01", name="B cc")
        for emp_code, role in (("ADM", "ADMIN"), ("ITA", "IT_TEAM")):
            session.add(Holder(company_id=a.id, emp_code=emp_code, name=emp_code, holder_type="EMPLOYEE",
                               location_id=loc.id, department_id=dept.id, role=role,
                               password_hash=hash_password("Passw0rd!"), must_change_password=False))
        session.add_all([cc_a, cc_b])
        await session.commit()
        return a.id, b.id, cc_a.id, cc_b.id


async def _headers(client, company_id, emp_code):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_it_team_cost_center_writes_are_company_scoped(client):
    a, b, cc_a, cc_b = await _setup()
    h = await _headers(client, a, "ITA")

    assert (await client.post("/api/masters/cost-centers", json={"company_id": b, "code": "X", "name": "X"}, headers=h)).status_code == 403
    assert (await client.post("/api/masters/cost-centers", json={"company_id": a, "code": "X", "name": "X"}, headers=h)).status_code == 201

    # Editing another company's row is still rejected outright.
    assert (await client.put(f"/api/masters/cost-centers/{cc_b}", json={"name": "hacked"}, headers=h)).status_code == 403

    # AM-05: company_id/code are no longer part of the edit schema at all
    # (CostCenterEditIn), so a cost centre can never be moved to another
    # company or have its code changed via this endpoint -- by ANY role,
    # not just a scoped one. Sending them is silently ignored (Pydantic's
    # behaviour for an undeclared field), the same convention
    # AssetUpdateIn established for asset_code/company_id. Only `name`
    # actually changes.
    resp = await client.put(
        f"/api/masters/cost-centers/{cc_a}",
        json={"company_id": b, "code": "HACKED-CODE", "name": "renamed"},
        headers=h,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "renamed"
    assert body["company_id"] == a  # unchanged, despite the request body
    assert body["code"] == "A01"    # unchanged, despite the request body

    assert (await client.delete(f"/api/masters/cost-centers/{cc_b}", headers=h)).status_code == 403

    async with SessionLocal() as session:
        row_b = await session.get(CostCenter, cc_b)
        assert row_b.name == "B cc" and row_b.is_active is True


async def test_it_team_company_writes_are_scoped_to_own_company(client):
    a, b, _, _ = await _setup()
    h = await _headers(client, a, "ITA")

    assert (await client.post("/api/masters/companies", json={"code": "NEW", "name": "New"}, headers=h)).status_code == 403
    assert (await client.put(f"/api/masters/companies/{b}", json={"code": "MSB", "name": "hacked"}, headers=h)).status_code == 403
    assert (await client.delete(f"/api/masters/companies/{b}", headers=h)).status_code == 403
    assert (await client.put(f"/api/masters/companies/{a}", json={"code": "MSA", "name": "MSA Renamed"}, headers=h)).status_code == 200


async def test_admin_is_unrestricted_and_global_masters_unaffected(client):
    a, b, _, cc_b = await _setup()
    admin = await _headers(client, a, "ADM")
    it = await _headers(client, a, "ITA")

    assert (await client.post("/api/masters/cost-centers", json={"company_id": b, "code": "Y", "name": "Y"}, headers=admin)).status_code == 201
    assert (await client.delete(f"/api/masters/cost-centers/{cc_b}", headers=admin)).status_code == 204
    # Categories are global (no company_id) -- IT_TEAM may still manage them.
    assert (await client.post("/api/masters/categories", json={"code": "IT", "name": "IT"}, headers=it)).status_code == 201
