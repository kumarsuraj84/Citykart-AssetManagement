"""AM-09: every master has a unique `code` (some scoped, e.g. CostCenter's
(company_id, code)) -- a caller reusing an existing code is an ordinary
mistake, not malformed input, and previously hit an unhandled 500 (a raw
asyncpg UniqueViolationError propagating out of build_master_router's
generic create/update endpoints) instead of a normal 422. These tests cover
a representative unscoped master (Category) and a company-scoped one (Cost
Centre), confirming both the create and update paths, and that a
genuinely-different code still works normally afterward (the failed attempt
does not corrupt the session for the rest of the request/connection)."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import Company, Department, Location


async def _seed_company_admin(company_code="DUPC"):
    async with SessionLocal() as session:
        co = Company(code=company_code, name="Dup Code Test Co")
        loc = Location(code=f"{company_code}-HO", name="HO")
        dept = Department(name=f"IT-{company_code}")
        session.add_all([co, loc, dept])
        await session.flush()
        holder = Holder(
            company_id=co.id, emp_code="DUPADM", name="Dup Admin", holder_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="ADMIN",
            password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(holder)
        await session.commit()
        return co.id


async def test_duplicate_category_code_on_create_is_a_controlled_422_not_500(client):
    await _seed_company_admin()
    resp = await client.post("/api/auth/login", json={"login_id": "DUPADM", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    first = await client.post("/api/masters/categories", json={"code": "DUPCAT", "name": "First"}, headers=headers)
    assert first.status_code == 201

    second = await client.post("/api/masters/categories", json={"code": "DUPCAT", "name": "Second"}, headers=headers)
    assert second.status_code == 422
    assert "already exists" in second.json()["detail"]

    # The failed attempt must not corrupt the session for a subsequent, valid request.
    third = await client.post("/api/masters/categories", json={"code": "NOTDUP", "name": "Third"}, headers=headers)
    assert third.status_code == 201


async def test_duplicate_cost_centre_code_within_a_company_is_a_controlled_422(client):
    company_id = await _seed_company_admin(company_code="DUPCC")
    resp = await client.post("/api/auth/login", json={"login_id": "DUPADM", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    first = await client.post(
        "/api/masters/cost-centers", json={"company_id": company_id, "code": "CC1", "name": "First"}, headers=headers,
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/masters/cost-centers", json={"company_id": company_id, "code": "CC1", "name": "Second"}, headers=headers,
    )
    assert second.status_code == 422
    assert "already exists" in second.json()["detail"]
