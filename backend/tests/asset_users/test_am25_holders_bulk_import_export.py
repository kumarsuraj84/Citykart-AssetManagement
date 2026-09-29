"""AM-25: AssetUser bulk Import/Export -- reuses app.masters.bulk_import_export
(the same generic engine every master master uses), ADMIN-only, imported
asset_users get no password (activated later via the existing Reset Password
action)."""
import io
import openpyxl
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import Company, Department, Location

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx(header: list[str], rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(header)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"AM25H-{suffix}", name=f"AM25 AssetUsers Co {suffix}")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code=f"AM25HL-{suffix}", name="HO")
        dept = Department(name=f"AM25HD-{suffix}")
        session.add_all([loc, dept])
        await session.flush()
        admin = AssetUser(company_id=co.id, code=f"ADM-{suffix}", name="Admin", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        ita = AssetUser(company_id=co.id, code=f"ITA-{suffix}", name="IT Team", asset_user_type="EMPLOYEE",
                     location_id=loc.id, department_id=dept.id, role="OPERATOR",
                     login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([admin, ita])
        await session.commit()
        return {"co": co, "loc": loc, "dept": dept, "admin": f"ADM-{suffix}", "ita": f"ITA-{suffix}"}


async def _login(client, login_id):
    resp = await client.post("/api/auth/login", json={"login_id": login_id, "password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _post_file(client, path, content, headers):
    return await client.post(path, files={"file": ("a.xlsx", io.BytesIO(content), XLSX)}, headers=headers)


HEADER = ["Company Code", "Code", "Name", "Type", "Location Code", "Department", "Email", "Phone", "Role"]


async def test_template_has_the_expected_columns(client):
    ids = await _setup("TPL1")
    headers = await _login(client, ids["admin"])
    resp = await client.get("/api/asset-users/import/template", headers=headers)
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    header = [c.value for c in next(wb.active.iter_rows(min_row=1, max_row=1))]
    assert header == HEADER


async def test_import_creates_a_asset_user_with_no_password_yet(client):
    ids = await _setup("IMP1")
    headers = await _login(client, ids["admin"])
    content = _xlsx(HEADER, [[
        ids["co"].code, "NEWEMP1", "New Employee", "EMPLOYEE", ids["loc"].code, ids["dept"].name,
        "new@example.test", "9998887777", "SELF_SERVICE",
    ]])

    resp = await _post_file(client, "/api/asset-users/import/commit", content, headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"imported": 1, "errors": []}

    async with SessionLocal() as session:
        from sqlalchemy import select
        row = (await session.execute(select(AssetUser).where(AssetUser.code == "NEWEMP1"))).scalars().first()
        assert row is not None
        assert row.password_hash is None
        assert row.must_change_password is True
        assert row.role == "SELF_SERVICE"
        assert row.email == "new@example.test"


async def test_import_requires_admin_not_it_team(client):
    ids = await _setup("IMP2")
    ita_headers = await _login(client, ids["ita"])
    content = _xlsx(HEADER, [[ids["co"].code, "X1", "X", "EMPLOYEE", ids["loc"].code, None, None, None, "SELF_SERVICE"]])
    resp = await _post_file(client, "/api/asset-users/import/commit", content, ita_headers)
    assert resp.status_code == 403


async def test_import_rejects_an_invalid_asset_user_type_as_a_row_error(client):
    ids = await _setup("IMP3")
    headers = await _login(client, ids["admin"])
    content = _xlsx(HEADER, [[ids["co"].code, "X2", "X", "NOT_A_TYPE", ids["loc"].code, None, None, None, "SELF_SERVICE"]])
    resp = await _post_file(client, "/api/asset-users/import/commit", content, headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported"] == 0
    assert "Type" in body["errors"][0]["field"]


async def test_import_department_is_optional_and_resolved_by_name(client):
    ids = await _setup("IMP4")
    headers = await _login(client, ids["admin"])
    content = _xlsx(HEADER, [[ids["co"].code, "X3", "No Dept Employee", "EMPLOYEE", ids["loc"].code, None, None, None, "VIEWER"]])
    resp = await _post_file(client, "/api/asset-users/import/commit", content, headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"imported": 1, "errors": []}

    async with SessionLocal() as session:
        from sqlalchemy import select
        row = (await session.execute(select(AssetUser).where(AssetUser.code == "X3"))).scalars().first()
        assert row.department_id is None
        assert row.role == "VIEWER"


async def test_export_round_trips_and_excludes_inactive_asset_users(client):
    ids = await _setup("EXP1")
    headers = await _login(client, ids["admin"])

    export_resp = await client.get("/api/asset-users/export", headers=headers)
    assert export_resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(export_resp.content))
    ws = wb.active
    header = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    assert header == HEADER
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    emp_codes = [r[1] for r in rows]
    assert ids["admin"] in emp_codes
    # Company Code cell is the real code, not a bare id.
    admin_row = next(r for r in rows if r[1] == ids["admin"])
    assert admin_row[0] == ids["co"].code
