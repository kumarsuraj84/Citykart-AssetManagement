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
