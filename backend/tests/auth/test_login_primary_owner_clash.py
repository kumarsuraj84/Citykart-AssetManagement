"""Security: nobody who can add an employee may lock the head-office admin out by giving that employee the admin's
name as code, and the same row matched twice is one account, not two."""
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Department, Location

PW = "Passw0rd!"


async def _world(*, owner_has_company: bool):
    async with SessionLocal() as s:
        co = Company(code="POC", name="Clash Co")
        dept = Department(name="IT-POC")
        s.add_all([co, dept])
        await s.flush()
        loc = Location(company_id=co.id, code="HO-POC", name="HO")
        s.add(loc)
        await s.flush()
        s.add(AssetUser(company_id=co.id if owner_has_company else None, code="HEAD" if owner_has_company else None, name="Admin",
                        asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                        is_primary_owner=True, login_enabled=True, password_hash=hash_password(PW), must_change_password=False))
        # an employee whose CODE is the head-office admin's name, with a password of its own
        s.add(AssetUser(company_id=co.id, code="Admin", name="Imposter", asset_user_type="EMPLOYEE", location_id=loc.id,
                        department_id=dept.id, role="OPERATOR", login_enabled=True, password_hash=hash_password("Other#Pass99"),
                        must_change_password=False))
        await s.commit()


async def test_an_employee_coded_like_the_head_office_admin_cannot_lock_the_admin_out(client):
    await _world(owner_has_company=False)
    ok = await client.post("/api/auth/login", json={"login_id": "Admin", "password": PW})
    assert ok.status_code == 200, ok.text
    # the imposter's own password does NOT sign in as anyone through that id
    assert (await client.post("/api/auth/login", json={"login_id": "Admin", "password": "Other#Pass99"})).status_code == 401
    me = await client.get("/api/auth/capabilities", headers={"Authorization": f"Bearer {ok.json()['access_token']}"})
    assert me.status_code == 200


async def test_a_primary_owner_matched_by_both_code_and_name_is_one_account(client):
    async with SessionLocal() as s:
        pass
    await _world(owner_has_company=True)
    # the owner now also has company code "HEAD"; sign in by that code still resolves exactly one account
    assert (await client.post("/api/auth/login", json={"login_id": "HEAD", "password": PW})).status_code == 200
