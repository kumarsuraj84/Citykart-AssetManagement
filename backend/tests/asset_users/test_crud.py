from app.core.db import SessionLocal
from app.core.security import hash_password, verify_password
from app.masters.models import Company, Location, Department
from app.asset_users.models import AssetUser


async def _admin_headers(client, company_code="CKS6", code="HADMIN"):
    # code defaults to "HADMIN" for the common single-company-per-test case,
    # but login no longer takes a company_id (the login screen doesn't ask for
    # one -- see app/auth/router.py::login), so a test that calls this twice to
    # set up two DIFFERENT companies must pass distinct emp_codes, or the second
    # login becomes ambiguous across companies and correctly gets refused.
    async with SessionLocal() as session:
        co = Company(code=company_code, name="AssetUser Test Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code=f"{company_code}-HO", name="HO")
        dept = Department(name=f"IT-{company_code}")
        session.add_all([loc, dept])
        await session.flush()
        asset_user = AssetUser(
            company_id=co.id, code=code, name="AssetUser Admin",
            asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="ADMIN", login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(asset_user)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, co.id, loc.id, dept.id


async def _login_as(client, company_id, location_id, department_id, code, role, password="Passw0rd!"):
    async with SessionLocal() as session:
        asset_user = AssetUser(
            company_id=company_id, code=code, name=f"{role} {code}",
            asset_user_type="EMPLOYEE", location_id=location_id, department_id=department_id,
            role=role, login_enabled=True, password_hash=hash_password(password), must_change_password=False,
        )
        session.add(asset_user)
        await session.commit()
        asset_user_id = asset_user.id

    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": code, "password": password})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, asset_user_id


async def test_create_asset_user_and_reset_password(client):
    headers, company_id, location_id, department_id = await _admin_headers(client)

    create_resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "CS6872", "name": "Ankur",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE", "login_enabled": True,
    }, headers=headers)
    assert create_resp.status_code == 201
    asset_user_id = create_resp.json()["id"]

    reset_resp = await client.post(f"/api/asset-users/{asset_user_id}/reset-password", headers=headers)
    assert reset_resp.status_code == 200
    temp_password = reset_resp.json()["temp_password"]

    async with SessionLocal() as session:
        asset_user = await session.get(AssetUser, asset_user_id)
        assert verify_password(temp_password, asset_user.password_hash)
        assert asset_user.must_change_password is True


async def test_it_team_cannot_create_asset_user(client):
    """Finding 1 fix: IT_TEAM must not be able to create (or self-escalate
    via) a asset_user -- only ADMIN may grant roles. Regression guard for the
    self-escalation path where IT_TEAM could POST a new asset_user with
    role=ADMIN."""
    headers, company_id, location_id, department_id = await _admin_headers(client, company_code="CKS9A")
    it_headers, _ = await _login_as(
        client, company_id, location_id, department_id, code="ITUSER", role="OPERATOR",
    )

    resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "ESCALATE", "name": "Escalate Me",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "ADMIN",
    }, headers=it_headers)
    assert resp.status_code == 403


async def test_it_team_cannot_update_a_asset_user(client):
    """AM-05 §16: AssetUser.role is security-sensitive -- only ADMIN may change
    it, and since PUT /api/asset-users/{id} is a full-replace body that always
    includes role, IT_TEAM must not be able to call this endpoint at all
    (there's no "role-less" edit path to carve out from it)."""
    headers, company_id, location_id, department_id = await _admin_headers(client, company_code="CKS9D")
    it_headers, _ = await _login_as(
        client, company_id, location_id, department_id, code="ITUSERD", role="OPERATOR",
    )
    create_resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "TARGETD", "name": "Target AssetUser",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    asset_user_id = create_resp.json()["id"]

    resp = await client.put(f"/api/asset-users/{asset_user_id}", json={
        "company_id": company_id, "code": "TARGETD", "name": "Target AssetUser Renamed",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "ADMIN",
    }, headers=it_headers)
    assert resp.status_code == 403

    async with SessionLocal() as session:
        row = await session.get(AssetUser, asset_user_id)
        assert row.role == "SELF_SERVICE"
        assert row.name == "Target AssetUser"


async def test_it_team_cannot_deactivate_or_reset_password_for_a_asset_user(client):
    headers, company_id, location_id, department_id = await _admin_headers(client, company_code="CKS9E")
    it_headers, _ = await _login_as(
        client, company_id, location_id, department_id, code="ITUSERE", role="OPERATOR",
    )
    create_resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "TARGETE", "name": "Target AssetUser",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    asset_user_id = create_resp.json()["id"]

    assert (await client.delete(f"/api/asset-users/{asset_user_id}", headers=it_headers)).status_code == 403
    assert (await client.post(f"/api/asset-users/{asset_user_id}/reset-password", headers=it_headers)).status_code == 403


async def test_admin_can_change_a_asset_users_role(client):
    """The mirror positive case: ADMIN legitimately changing role is the one
    path that must keep working."""
    headers, company_id, location_id, department_id = await _admin_headers(client, company_code="CKS9F")
    create_resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "TARGETF", "name": "Target AssetUser",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    asset_user_id = create_resp.json()["id"]

    resp = await client.put(f"/api/asset-users/{asset_user_id}", json={
        "company_id": company_id, "code": "TARGETF", "name": "Target AssetUser",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "VIEWER",
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["role"] == "VIEWER"


async def test_non_admin_asset_user_list_scoped_to_own_company(client):
    """Finding 2 fix: GET /api/asset-users must never leak another company's
    asset_users to a non-ADMIN caller, even when they explicitly request a
    foreign company_id via the query string."""
    headers_a, company_a, location_a, department_a = await _admin_headers(client, company_code="CKS9B", code="HADMINB")
    headers_b, company_b, location_b, department_b = await _admin_headers(client, company_code="CKS9C", code="HADMINC")

    # A asset_user that exists only in company B -- would leak if scoping is broken.
    create_resp = await client.post("/api/asset-users", json={
        "company_id": company_b, "code": "SECRETB", "name": "Secret B AssetUser",
        "asset_user_type": "EMPLOYEE", "location_id": location_b, "department_id": department_b,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers_b)
    assert create_resp.status_code == 201

    # A plain, non-ADMIN caller in company A. VIEWER, not ASSET_USER: a ASSET_USER may not
    # list asset_users at all (403, see tests/reports/test_asset_user_role_access.py).
    viewer_headers, _ = await _login_as(
        client, company_a, location_a, department_a, code="VIEWERA", role="VIEWER",
    )

    resp = await client.get(f"/api/asset-users?company_id={company_b}", headers=viewer_headers)
    assert resp.status_code == 200
    returned_company_ids = {row["company_id"] for row in resp.json()}
    assert company_b not in returned_company_ids
    assert returned_company_ids <= {company_a}
