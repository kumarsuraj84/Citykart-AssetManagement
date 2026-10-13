"""Master data (company-owned like Cost Centres/Companies, or global like
Categories) may only be written by the Primary Owner -- not by an ordinary
ADMIN or OPERATOR, regardless of company scope. See
docs/ai/ASSET_USER_RBAC_REBUILD_PREFLIGHT.md §16 / the rebuild's "no master
involvement" rule for ordinary ADMIN."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
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
        for code, role in (("ADM", "ADMIN"), ("ITA", "OPERATOR")):
            session.add(AssetUser(company_id=a.id, code=code, name=code, asset_user_type="EMPLOYEE",
                               location_id=loc.id, department_id=dept.id, role=role,
                               login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False))
        # The Primary Owner is a company-less bootstrap account -- no
        # company_id/code of its own, logs in by name (see AssetUser.is_primary_owner).
        session.add(AssetUser(name="Owner", role="ADMIN", is_primary_owner=True,
                           login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False))
        session.add_all([cc_a, cc_b])
        await session.commit()
        return a.id, b.id, cc_a.id, cc_b.id


async def _headers(client, company_id, code):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _owner_headers(client):
    resp = await client.post("/api/auth/login", json={"login_id": "Owner", "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_operator_adds_cost_centres_only_in_own_company_and_never_edits_them(client):
    # S3a-1: an OPERATOR may ADD a cost centre in the flow, inside their own
    # company scope; editing / removing stays with the head-office admin.
    a, b, cc_a, cc_b = await _setup()
    h = await _headers(client, a, "ITA")

    assert (await client.post("/api/masters/cost-centers", json={"company_id": b, "code": "X", "name": "X"}, headers=h)).status_code == 403
    assert (await client.post("/api/masters/cost-centers", json={"company_id": a, "code": "X", "name": "X"}, headers=h)).status_code == 201
    assert (await client.put(f"/api/masters/cost-centers/{cc_a}", json={"name": "hacked"}, headers=h)).status_code == 403
    assert (await client.delete(f"/api/masters/cost-centers/{cc_b}", headers=h)).status_code == 403


async def test_ordinary_admin_adds_small_records_but_never_edits_or_does_heavy_setup(client):
    """S3a-1: an ordinary ADMIN (both work areas, every company) may ADD a cost
    centre and a category of their work area; removing a cost centre and
    creating a company stay with the head-office admin."""
    a, b, _, cc_b = await _setup()
    admin = await _headers(client, a, "ADM")

    assert (await client.post("/api/masters/cost-centers", json={"company_id": b, "code": "Y", "name": "Y"}, headers=admin)).status_code == 201
    assert (await client.delete(f"/api/masters/cost-centers/{cc_b}", headers=admin)).status_code == 403
    assert (
        await client.post("/api/masters/categories", json={"code": "IT", "name": "IT", "asset_domain": "IT"}, headers=admin)
    ).status_code == 201
    assert (await client.post("/api/masters/companies", json={"code": "NEW", "name": "New"}, headers=admin)).status_code == 403


async def test_primary_owner_writes_masters_unrestricted_by_company(client):
    a, b, cc_a, cc_b = await _setup()
    owner = await _owner_headers(client)

    assert (await client.post("/api/masters/cost-centers", json={"company_id": b, "code": "Y", "name": "Y"}, headers=owner)).status_code == 201
    assert (await client.delete(f"/api/masters/cost-centers/{cc_b}", headers=owner)).status_code == 204
    assert (
        await client.post("/api/masters/categories", json={"code": "IT", "name": "IT", "asset_domain": "IT"}, headers=owner)
    ).status_code == 201
    assert (await client.put(f"/api/masters/companies/{a}", json={"code": "MSA", "name": "MSA Renamed"}, headers=owner)).status_code == 200

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
        headers=owner,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "renamed"
    assert body["company_id"] == a  # unchanged, despite the request body
    assert body["code"] == "A01"    # unchanged, despite the request body
