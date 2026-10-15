"""IN-02: an import file is read in pieces and refused (413, plain words) once it passes the limit, before openpyxl sees it."""
import io

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.core.uploads import IMPORT_MAX_BYTES
from app.masters.models import Company, Department, Location

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


async def _owner_headers(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-UPL", name="Upload Test Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code="HO-UPL", name="HO")
        dept = Department(name="IT-UPL")
        session.add_all([loc, dept])
        await session.flush()
        session.add(AssetUser(company_id=co.id, code="OWN-UPL", name="Owner", asset_user_type="EMPLOYEE", location_id=loc.id,
                              department_id=dept.id, role="ADMIN", is_primary_owner=True, login_enabled=True,
                              password_hash=hash_password("Passw0rd!"), must_change_password=False))
        await session.commit()
    resp = await client.post("/api/auth/login", json={"login_id": "OWN-UPL", "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_an_oversized_import_file_is_refused_with_413(client):
    headers = await _owner_headers(client)
    big = io.BytesIO(b"\0" * (IMPORT_MAX_BYTES + 1024 * 1024))
    resp = await client.post("/api/imports/assets/preview", headers=headers, files={"file": ("big.xlsx", big, XLSX)})
    assert resp.status_code == 413, resp.text
    assert "larger than" in resp.json()["detail"] and "MB" in resp.json()["detail"]


async def test_a_small_bad_file_is_still_a_normal_validation_error_not_413(client):
    headers = await _owner_headers(client)
    resp = await client.post("/api/imports/assets/preview", headers=headers,
                             files={"file": ("bad.xlsx", io.BytesIO(b"not an excel file"), XLSX)})
    assert resp.status_code in (400, 422), resp.text
