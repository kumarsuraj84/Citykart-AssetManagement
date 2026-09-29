"""AM-25: generic bulk Import/Export, wired into every master via
build_master_router(import_fields=...). Exercises the three distinct
company-scope shapes (SCOPE_SELF for Companies, SCOPE_COMPANY_ID for Cost
Centres and Locations, SCOPE_NONE for Vendors/Categories/Subcategories/
Departments) plus the FK-by-code lookup + export round-trip."""
import io
import openpyxl
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Department, Location, Vendor

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
        co = Company(code=f"AM25-{suffix}", name=f"AM25 Co {suffix}")
        co_b = Company(code=f"AM25B-{suffix}", name=f"AM25 Co B {suffix}")
        session.add_all([co, co_b])
        await session.flush()
        loc = Location(company_id=co.id, code=f"AM25L-{suffix}", name="HO")
        dept = Department(name=f"AM25D-{suffix}")
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
        return {"co": co, "co_b": co_b, "admin": f"ADM-{suffix}", "ita": f"ITA-{suffix}"}


async def _login(client, login_id):
    resp = await client.post("/api/auth/login", json={"login_id": login_id, "password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _post_file(client, path, content, headers):
    return await client.post(path, files={"file": ("a.xlsx", io.BytesIO(content), XLSX)}, headers=headers)


# --- Vendors: SCOPE_NONE, optional fields ---

async def test_vendor_template_and_commit(client):
    ids = await _setup("VND1")
    headers = await _login(client, ids["admin"])

    tpl_resp = await client.get("/api/masters/vendors/import/template", headers=headers)
    assert tpl_resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(tpl_resp.content))
    header = [c.value for c in next(wb.active.iter_rows(min_row=1, max_row=1))]
    assert header == ["Code", "Name", "GSTIN", "Contact Name", "Contact Phone", "Contact Email"]

    content = _xlsx(header, [["VND-AM25", "Acme Traders", "22GSTIN", "Raj", "9999999999", "raj@acme.test"]])
    preview_resp = await _post_file(client, "/api/masters/vendors/import/preview", content, headers)
    assert preview_resp.status_code == 200, preview_resp.text
    assert len(preview_resp.json()["valid_rows"]) == 1
    assert preview_resp.json()["errors"] == []

    commit_resp = await _post_file(client, "/api/masters/vendors/import/commit", content, headers)
    assert commit_resp.status_code == 200, commit_resp.text
    assert commit_resp.json() == {"imported": 1, "errors": []}

    vendors_resp = await client.get("/api/masters/vendors", headers=headers)
    codes = [v["code"] for v in vendors_resp.json()]
    assert "VND-AM25" in codes


async def test_vendor_duplicate_code_is_a_row_error_not_a_500(client):
    ids = await _setup("VND2")
    headers = await _login(client, ids["admin"])
    header = ["Code", "Name", "GSTIN", "Contact Name", "Contact Phone", "Contact Email"]
    content = _xlsx(header, [["VND-DUP", "First", None, None, None, None], ["VND-DUP", "Second", None, None, None, None]])

    resp = await _post_file(client, "/api/masters/vendors/import/commit", content, headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported"] == 1
    assert len(body["errors"]) == 1
    assert "already exists" in body["errors"][0]["message"]


async def test_vendor_code_over_the_column_limit_is_a_row_error_not_a_500(client):
    ids = await _setup("VND4")
    headers = await _login(client, ids["admin"])
    header = ["Code", "Name", "GSTIN", "Contact Name", "Contact Phone", "Contact Email"]
    # Vendor.code is varchar(100) -- wider than every other master's Code
    # (20) precisely so a real registered company name usually fits; this
    # one is still 111 chars, over even that wider limit.
    too_long_code = "VASPS INFOTECH PRIVATE LIMITED " * 4
    content = _xlsx(header, [
        [too_long_code, "Vasps Infotech Private Limited", None, None, None, None],
        ["VND-OK", "A Fine Vendor", None, None, None, None],
    ])

    preview_resp = await _post_file(client, "/api/masters/vendors/import/preview", content, headers)
    assert preview_resp.status_code == 200, preview_resp.text
    preview = preview_resp.json()
    assert len(preview["valid_rows"]) == 1
    assert preview["valid_rows"][0]["values"]["Code"] == "VND-OK"
    assert len(preview["errors"]) == 1
    assert "100 characters or fewer" in preview["errors"][0]["message"]

    # The whole commit must not 500 -- the oversized row becomes a row error,
    # and the other valid row in the same file still gets imported.
    commit_resp = await _post_file(client, "/api/masters/vendors/import/commit", content, headers)
    assert commit_resp.status_code == 200, commit_resp.text
    body = commit_resp.json()
    assert body["imported"] == 1
    assert len(body["errors"]) == 1
    assert "100 characters or fewer" in body["errors"][0]["message"]

    vendors_resp = await client.get("/api/masters/vendors", headers=headers)
    codes = [v["code"] for v in vendors_resp.json()]
    assert "VND-OK" in codes
    assert too_long_code not in codes


async def test_vendor_missing_required_column_is_a_template_error(client):
    ids = await _setup("VND3")
    headers = await _login(client, ids["admin"])
    content = _xlsx(["Code"], [["VND-X"]])  # missing required "Name"
    resp = await _post_file(client, "/api/masters/vendors/import/preview", content, headers)
    assert resp.status_code == 422
    assert "Name" in resp.text


# --- Locations: SCOPE_COMPANY_ID + Company Code FK lookup (Location moved
# from SCOPE_NONE to company-scoped -- same shape as Cost Centre) ---

async def test_location_import_resolves_company_code_and_scopes_it_team(client):
    ids = await _setup("LOC1")
    header = ["Company Code", "Code", "Name", "Address"]

    admin_headers = await _login(client, ids["admin"])
    content = _xlsx(header, [[ids["co"].code, "WH1", "Warehouse 1", "123 Main St"]])
    resp = await _post_file(client, "/api/masters/locations/import/commit", content, admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"imported": 1, "errors": []}

    # IT_TEAM (scoped to ids["co"] only) importing a row for co_b is refused whole-file, 403.
    ita_headers = await _login(client, ids["ita"])
    other_content = _xlsx(header, [[ids["co_b"].code, "WH2", "Warehouse 2", None]])
    resp2 = await _post_file(client, "/api/masters/locations/import/commit", other_content, ita_headers)
    assert resp2.status_code == 403


async def test_location_export_round_trips_company_code(client):
    ids = await _setup("LOC2")
    headers = await _login(client, ids["admin"])

    export_resp = await client.get("/api/masters/locations/export", headers=headers)
    assert export_resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(export_resp.content))
    ws = wb.active
    header = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    assert header == ["Company Code", "Code", "Name", "Address"]

    content = _xlsx(header, [[ids["co"].code, "EXP-LOC", "Export Location", None]])
    resp = await _post_file(client, "/api/masters/locations/import/commit", content, headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"imported": 1, "errors": []}


# --- Brands: SCOPE_NONE, same shape as Categories (added for the Brand
# master itself, since it's newly wired into build_master_router) ---

async def test_brand_template_and_commit(client):
    ids = await _setup("BRD1")
    headers = await _login(client, ids["admin"])

    tpl_resp = await client.get("/api/masters/brands/import/template", headers=headers)
    assert tpl_resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(tpl_resp.content))
    header = [c.value for c in next(wb.active.iter_rows(min_row=1, max_row=1))]
    assert header == ["Code", "Name"]

    content = _xlsx(header, [["DELL-AM25", "Dell"]])
    commit_resp = await _post_file(client, "/api/masters/brands/import/commit", content, headers)
    assert commit_resp.status_code == 200, commit_resp.text
    assert commit_resp.json() == {"imported": 1, "errors": []}

    brands_resp = await client.get("/api/masters/brands", headers=headers)
    codes = [b["code"] for b in brands_resp.json()]
    assert "DELL-AM25" in codes


async def test_brand_ordinary_crud(client):
    ids = await _setup("BRD2")
    headers = await _login(client, ids["admin"])

    create_resp = await client.post("/api/masters/brands", json={"code": "HP-BRD2", "name": "HP"}, headers=headers)
    assert create_resp.status_code == 201, create_resp.text
    brand_id = create_resp.json()["id"]

    update_resp = await client.put(f"/api/masters/brands/{brand_id}", json={"name": "HP Inc."}, headers=headers)
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "HP Inc."

    deact_resp = await client.delete(f"/api/masters/brands/{brand_id}", headers=headers)
    assert deact_resp.status_code == 204
    codes = [b["code"] for b in (await client.get("/api/masters/brands", headers=headers)).json()]
    assert "HP-BRD2" not in codes


# --- Cost Centres: SCOPE_COMPANY_ID + Company Code FK lookup ---

async def test_cost_centre_import_resolves_company_code_and_scopes_it_team(client):
    ids = await _setup("CC1")
    header = ["Company Code", "Code", "Name"]

    admin_headers = await _login(client, ids["admin"])
    content = _xlsx(header, [[ids["co"].code, "HO", "Head Office"]])
    resp = await _post_file(client, "/api/masters/cost-centers/import/commit", content, admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"imported": 1, "errors": []}

    # IT_TEAM (scoped to ids["co"] only) importing a row for co_b is refused whole-file, 403.
    ita_headers = await _login(client, ids["ita"])
    other_content = _xlsx(header, [[ids["co_b"].code, "HO2", "B Head Office"]])
    resp2 = await _post_file(client, "/api/masters/cost-centers/import/commit", other_content, ita_headers)
    assert resp2.status_code == 403


async def test_cost_centre_import_unknown_company_code_is_a_row_error(client):
    ids = await _setup("CC2")
    headers = await _login(client, ids["admin"])
    content = _xlsx(["Company Code", "Code", "Name"], [["NOPE-CO", "HO", "Head Office"]])
    resp = await _post_file(client, "/api/masters/cost-centers/import/commit", content, headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported"] == 0
    assert "unknown Company Code" in body["errors"][0]["message"]


# --- Subcategories: SCOPE_NONE + Category Code FK lookup ---

async def test_subcategory_import_resolves_category_code(client):
    ids = await _setup("SUB1")
    headers = await _login(client, ids["admin"])
    async with SessionLocal() as session:
        cat = AssetCategory(code="AM25-CAT1", name="IT", asset_domain="IT")
        session.add(cat)
        await session.commit()

    content = _xlsx(["Category Code", "Code", "Name"], [["AM25-CAT1", "LAP", "Laptop"]])
    resp = await _post_file(client, "/api/masters/subcategories/import/commit", content, headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"imported": 1, "errors": []}


# --- Companies: SCOPE_SELF -- import requires ADMIN, IT_TEAM refused ---

async def test_company_import_requires_admin_not_just_it_team(client):
    ids = await _setup("COIMP1")
    ita_headers = await _login(client, ids["ita"])
    content = _xlsx(["Code", "Name"], [["NEWCO", "New Co"]])
    resp = await _post_file(client, "/api/masters/companies/import/commit", content, ita_headers)
    assert resp.status_code == 403

    admin_headers = await _login(client, ids["admin"])
    resp2 = await _post_file(client, "/api/masters/companies/import/commit", content, admin_headers)
    assert resp2.status_code == 200
    assert resp2.json() == {"imported": 1, "errors": []}


# --- Export round-trip ---

async def test_export_then_reimport_round_trips_cleanly(client):
    ids = await _setup("EXP1")
    headers = await _login(client, ids["admin"])
    async with SessionLocal() as session:
        cc = CostCenter(company_id=ids["co"].id, code="EXP-CC", name="Export Cost Centre")
        session.add(cc)
        await session.commit()

    export_resp = await client.get("/api/masters/cost-centers/export", headers=headers)
    assert export_resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(export_resp.content))
    ws = wb.active
    header = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    assert header == ["Company Code", "Code", "Name"]
    exported_rows = list(ws.iter_rows(min_row=2, values_only=True))
    assert (ids["co"].code, "EXP-CC", "Export Cost Centre") in exported_rows

    # Re-importing the exported file as a NEW cost centre (different code) succeeds --
    # confirms the exported "Company Code" cell is a real, re-importable value.
    content = _xlsx(header, [[ids["co"].code, "EXP-CC-2", "Export Cost Centre 2"]])
    resp = await _post_file(client, "/api/masters/cost-centers/import/commit", content, headers)
    assert resp.status_code == 200
    assert resp.json() == {"imported": 1, "errors": []}


async def test_export_only_returns_active_rows(client):
    ids = await _setup("EXP2")
    headers = await _login(client, ids["admin"])
    async with SessionLocal() as session:
        v = Vendor(code="EXP-INACTIVE", name="Inactive Vendor")
        session.add(v)
        await session.commit()
        v.is_active = False
        await session.commit()

    export_resp = await client.get("/api/masters/vendors/export", headers=headers)
    assert export_resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(export_resp.content))
    codes = [row[0] for row in wb.active.iter_rows(min_row=2, values_only=True)]
    assert "EXP-INACTIVE" not in codes
