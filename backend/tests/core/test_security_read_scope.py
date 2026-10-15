"""AC-1 / AC-2 (security assurance): the setup lists are for staff roles only, and custom fields follow the company."""
import pytest
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CustomField, Department, Location

LISTS = ["/api/masters/vendors", "/api/masters/companies", "/api/masters/departments", "/api/masters/categories",
         "/api/masters/subcategories", "/api/masters/brands", "/api/masters/cost-centers", "/api/masters/custom-fields",
         "/api/code-rules", "/api/bundles"]
PW = "Passw0rd!"


async def _world():
    async with SessionLocal() as s:
        a = Company(code="RSA", name="Read Scope A")
        b = Company(code="RSB", name="Read Scope B")
        s.add_all([a, b, Department(name="IT-RS")])
        await s.flush()
        la = Location(company_id=a.id, code="HO-RSA", name="HO")
        s.add(la)
        await s.flush()
        dept = (await s.execute(select(Department).where(Department.name == "IT-RS"))).scalar_one()

        def user(code, role, owner=False, login=True):
            return AssetUser(company_id=a.id, code=code, name=code, asset_user_type="EMPLOYEE", location_id=la.id,
                             department_id=dept.id, role=role, is_primary_owner=owner, login_enabled=login,
                             password_hash=hash_password(PW), must_change_password=False)
        s.add_all([user("RS-OWN", "ADMIN", owner=True), user("RS-OP", "OPERATOR"), user("RS-VIEW", "VIEWER"),
                   user("RS-SELF", "SELF_SERVICE")])
        owner = (await s.execute(select(AssetUser).where(AssetUser.code == "RS-OWN"))).scalar_one()
        for key, company in (("rs_global", None), ("rs_a", a.id), ("rs_b", b.id)):
            s.add(CustomField(field_key=key, label=key, field_type="text", company_id=company, created_by=owner.id, updated_by=owner.id))
        await s.commit()


async def _h(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": PW})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.parametrize("path", LISTS)
async def test_a_self_service_login_cannot_read_the_setup_lists(client, path):
    await _world()
    assert (await client.get(path, headers=await _h(client, "RS-SELF"))).status_code == 403
    assert (await client.get(path)).status_code == 401


async def test_staff_roles_can_still_read_the_setup_lists(client):
    await _world()
    for code in ("RS-OWN", "RS-OP", "RS-VIEW"):
        h = await _h(client, code)
        for path in LISTS:
            assert (await client.get(path, headers=h)).status_code == 200, (code, path)


async def test_custom_fields_follow_the_company(client):
    await _world()
    seen = lambda resp: {f["field_key"] for f in resp.json()}
    op = await client.get("/api/masters/custom-fields", headers=await _h(client, "RS-OP"))
    assert seen(op) == {"rs_global", "rs_a"}                                   # own company + global, not company B's
    owner = await client.get("/api/masters/custom-fields", headers=await _h(client, "RS-OWN"))
    assert {"rs_global", "rs_a", "rs_b"} <= seen(owner)                        # head-office admin sees all
