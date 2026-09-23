from app.core.db import SessionLocal
from app.core.security import hash_password, verify_password
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def _admin_headers(client, company_code="CKS6"):
    async with SessionLocal() as session:
        co = Company(code=company_code, name="Holder Test Co")
        loc = Location(code=f"{company_code}-HO", name="HO")
        dept = Department(name=f"IT-{company_code}")
        session.add_all([co, loc, dept])
        await session.flush()
        holder = Holder(
            company_id=co.id, emp_code="HADMIN", name="Holder Admin",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="ADMIN", password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(holder)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "HADMIN", "password": "Passw0rd!"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, co.id, loc.id, dept.id


async def _login_as(client, company_id, location_id, department_id, emp_code, role, password="Passw0rd!"):
    async with SessionLocal() as session:
        holder = Holder(
            company_id=company_id, emp_code=emp_code, name=f"{role} {emp_code}",
            holder_type="EMPLOYEE", location_id=location_id, department_id=department_id,
            role=role, password_hash=hash_password(password), must_change_password=False,
        )
        session.add(holder)
        await session.commit()
        holder_id = holder.id

    resp = await client.post("/api/auth/login", json={"company_id": company_id, "emp_code": emp_code, "password": password})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, holder_id


async def test_create_holder_and_reset_password(client):
    headers, company_id, location_id, department_id = await _admin_headers(client)

    create_resp = await client.post("/api/holders", json={
        "company_id": company_id, "emp_code": "CS6872", "name": "Ankur",
        "holder_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "HOLDER",
    }, headers=headers)
    assert create_resp.status_code == 201
    holder_id = create_resp.json()["id"]

    reset_resp = await client.post(f"/api/holders/{holder_id}/reset-password", headers=headers)
    assert reset_resp.status_code == 200
    temp_password = reset_resp.json()["temp_password"]

    async with SessionLocal() as session:
        holder = await session.get(Holder, holder_id)
        assert verify_password(temp_password, holder.password_hash)
        assert holder.must_change_password is True


async def test_it_team_cannot_create_holder(client):
    """Finding 1 fix: IT_TEAM must not be able to create (or self-escalate
    via) a holder -- only ADMIN may grant roles. Regression guard for the
    self-escalation path where IT_TEAM could POST a new holder with
    role=ADMIN."""
    headers, company_id, location_id, department_id = await _admin_headers(client, company_code="CKS9A")
    it_headers, _ = await _login_as(
        client, company_id, location_id, department_id, emp_code="ITUSER", role="IT_TEAM",
    )

    resp = await client.post("/api/holders", json={
        "company_id": company_id, "emp_code": "ESCALATE", "name": "Escalate Me",
        "holder_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "ADMIN",
    }, headers=it_headers)
    assert resp.status_code == 403


async def test_non_admin_holder_list_scoped_to_own_company(client):
    """Finding 2 fix: GET /api/holders must never leak another company's
    holders to a non-ADMIN caller, even when they explicitly request a
    foreign company_id via the query string."""
    headers_a, company_a, location_a, department_a = await _admin_headers(client, company_code="CKS9B")
    headers_b, company_b, location_b, department_b = await _admin_headers(client, company_code="CKS9C")

    # A holder that exists only in company B -- would leak if scoping is broken.
    create_resp = await client.post("/api/holders", json={
        "company_id": company_b, "emp_code": "SECRETB", "name": "Secret B Holder",
        "holder_type": "EMPLOYEE", "location_id": location_b, "department_id": department_b,
        "email": None, "phone": None, "role": "HOLDER",
    }, headers=headers_b)
    assert create_resp.status_code == 201

    # A plain, non-ADMIN caller in company A.
    viewer_headers, _ = await _login_as(
        client, company_a, location_a, department_a, emp_code="VIEWERA", role="HOLDER",
    )

    resp = await client.get(f"/api/holders?company_id={company_b}", headers=viewer_headers)
    assert resp.status_code == 200
    returned_company_ids = {row["company_id"] for row in resp.json()}
    assert company_b not in returned_company_ids
    assert returned_company_ids <= {company_a}
