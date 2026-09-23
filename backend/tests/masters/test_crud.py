from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def _admin_headers(client, company_code="CKM7"):
    async with SessionLocal() as session:
        co = Company(code=company_code, name="Masters Test Co")
        loc = Location(code=f"{company_code}-HO", name="HO")
        dept = Department(name=f"IT-{company_code}")
        session.add_all([co, loc, dept])
        await session.flush()
        holder = Holder(
            company_id=co.id, emp_code="MADMIN", name="Master Admin",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="ADMIN", password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(holder)
        await session.commit()

    resp = await client.post("/api/auth/login", json={
        "company_id": co.id, "emp_code": "MADMIN", "password": "Passw0rd!",
    })
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_create_list_and_deactivate_vendor(client):
    headers = await _admin_headers(client)

    create_resp = await client.post("/api/masters/vendors", json={
        "code": "VEND1", "name": "Test Vendor", "gstin": None,
        "contact_name": None, "contact_phone": None, "contact_email": None,
    }, headers=headers)
    assert create_resp.status_code == 201
    vendor_id = create_resp.json()["id"]

    list_resp = await client.get("/api/masters/vendors", headers=headers)
    assert any(v["id"] == vendor_id for v in list_resp.json())

    deact_resp = await client.delete(f"/api/masters/vendors/{vendor_id}", headers=headers)
    assert deact_resp.status_code == 204

    list_resp_after = await client.get("/api/masters/vendors", headers=headers)
    assert all(v["id"] != vendor_id for v in list_resp_after.json())
