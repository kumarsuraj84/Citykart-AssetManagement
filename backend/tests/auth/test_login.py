from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def _make_admin(session, company_code="CKS3", emp_code="ADMIN1"):
    co = Company(code=company_code, name="Auth Test Co")
    loc = Location(code=f"{company_code}-HO", name="HO")
    dept = Department(name=f"IT-{company_code}")
    session.add_all([co, loc, dept])
    await session.flush()
    holder = Holder(
        company_id=co.id, emp_code=emp_code, name="Admin",
        holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
        role="ADMIN", password_hash=hash_password("Passw0rd!"), must_change_password=False,
    )
    session.add(holder)
    await session.commit()
    return co, holder


async def test_login_success(client):
    async with SessionLocal() as session:
        co, holder = await _make_admin(session)

    resp = await client.post("/api/auth/login", json={
        "company_id": co.id, "emp_code": holder.emp_code, "password": "Passw0rd!",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["must_change_password"] is False
    assert "refresh_token" in resp.cookies


async def test_login_wrong_password_locks_after_five_attempts(client):
    async with SessionLocal() as session:
        co, holder = await _make_admin(session, company_code="CKS4", emp_code="ADMIN2")

    for _ in range(5):
        resp = await client.post("/api/auth/login", json={
            "company_id": co.id, "emp_code": holder.emp_code, "password": "wrong",
        })
        assert resp.status_code == 401

    resp = await client.post("/api/auth/login", json={
        "company_id": co.id, "emp_code": holder.emp_code, "password": "Passw0rd!",
    })
    assert resp.status_code == 423  # locked
