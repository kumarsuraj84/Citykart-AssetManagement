from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def test_create_code_rule(client):
    async with SessionLocal() as session:
        co = Company(code="CKS7", name="Numbering Test Co")
        loc = Location(code="CKS7-HO", name="HO")
        dept = Department(name="IT-CKS7")
        session.add_all([co, loc, dept])
        await session.flush()
        holder = Holder(company_id=co.id, emp_code="NADMIN", name="N Admin", holder_type="EMPLOYEE",
                         location_id=loc.id, department_id=dept.id, role="ADMIN",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add(holder)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "NADMIN", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    create_resp = await client.post("/api/code-rules", json={
        "company_id": None, "prefix_template": "FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
        "suffix_template": "", "start_number": 1, "pad_width": 0,
    }, headers=headers)
    assert create_resp.status_code == 201
    assert create_resp.json()["prefix_template"].startswith("FA/")


async def test_write_access_is_admin_only(client):
    async with SessionLocal() as session:
        co = Company(code="CKS8", name="Numbering Non-Admin Co")
        loc = Location(code="CKS8-HO", name="HO")
        dept = Department(name="IT-CKS8")
        session.add_all([co, loc, dept])
        await session.flush()
        holder = Holder(company_id=co.id, emp_code="NVIEWER", name="N Viewer", holder_type="EMPLOYEE",
                         location_id=loc.id, department_id=dept.id, role="VIEWER",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add(holder)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "NVIEWER", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    create_resp = await client.post("/api/code-rules", json={
        "company_id": None, "prefix_template": "FA/{cost_center.code}/CK_",
        "suffix_template": "", "start_number": 1, "pad_width": 0,
    }, headers=headers)
    assert create_resp.status_code == 403

    list_resp = await client.get("/api/code-rules", headers=headers)
    assert list_resp.status_code == 200
