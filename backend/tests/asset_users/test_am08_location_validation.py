"""AM-08 Bug 2: `asset_user.location_id`/`company_id` are NOT NULL foreign keys
(location_id was never actually optional -- see DECISIONS.md). Before AM-08 a
nonexistent id (most commonly the frontend's old `0` "nothing selected"
sentinel) reached the database unchecked and surfaced as a raw, unhandled
IntegrityError/500. These tests confirm a controlled 422 instead, and that a
valid request -- including one that legitimately omits the optional
department_id -- still succeeds."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import Company, Department, Location


async def _admin_headers(client, company_code="LOCA"):
    async with SessionLocal() as session:
        co = Company(code=company_code, name="Location Test Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code=f"{company_code}-HO", name="HO")
        dept = Department(name=f"IT-{company_code}")
        session.add_all([loc, dept])
        await session.flush()
        asset_user = AssetUser(
            company_id=co.id, code="LOCADM", name="Loc Admin", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="ADMIN",
            login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(asset_user)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"login_id": "LOCADM", "password": "Passw0rd!"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, co.id, loc.id, dept.id


async def test_location_id_zero_is_rejected_with_a_controlled_422_not_500(client):
    """The exact defect found live during AM-07 UAT: a blank Location Select
    serialized to `location_id: 0` client-side. This must never reach the
    database as an unhandled ForeignKeyViolationError."""
    headers, company_id, _location_id, department_id = await _admin_headers(client)

    resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "NOLOC", "name": "No Location",
        "asset_user_type": "EMPLOYEE", "location_id": 0, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert resp.status_code == 422
    assert "location" in resp.json()["detail"].lower()


async def test_nonexistent_location_id_is_rejected_with_a_controlled_422(client):
    headers, company_id, _location_id, department_id = await _admin_headers(client)

    resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "BADLOC", "name": "Bad Location",
        "asset_user_type": "EMPLOYEE", "location_id": 999999, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert resp.status_code == 422
    assert "location" in resp.json()["detail"].lower()


async def test_company_id_zero_is_rejected_with_a_controlled_422_not_500(client):
    """The same `Number("") === 0` sentinel risk applies to Company -- guarded
    the same way, for the same reason."""
    headers, _company_id, location_id, department_id = await _admin_headers(client)

    resp = await client.post("/api/asset-users", json={
        "company_id": 0, "code": "NOCOMP", "name": "No Company",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert resp.status_code == 422
    assert "company" in resp.json()["detail"].lower()


async def test_nonexistent_department_id_is_rejected_with_a_controlled_422(client):
    headers, company_id, location_id, _department_id = await _admin_headers(client)

    resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "BADDEPT", "name": "Bad Department",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": 999999,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert resp.status_code == 422
    assert "department" in resp.json()["detail"].lower()


async def test_location_from_a_different_company_is_rejected_with_a_controlled_422(client):
    """Location became a company-scoped master -- a asset_user's location must
    belong to that same asset_user's own company, the same rule Cost Centre
    already enforces. Prevents e.g. accidentally pointing a Stores asset_user
    at one of Ventures' locations."""
    headers, company_id, _location_id, department_id = await _admin_headers(client)
    async with SessionLocal() as session:
        other_co = Company(code="LOCB", name="Other Location Co")
        session.add(other_co)
        await session.flush()
        other_loc = Location(company_id=other_co.id, code="LOCB-HO", name="Other HO")
        session.add(other_loc)
        await session.commit()
        other_location_id = other_loc.id

    resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "WRONGLOC", "name": "Wrong Location",
        "asset_user_type": "EMPLOYEE", "location_id": other_location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert resp.status_code == 422
    assert "same company" in resp.json()["detail"].lower()


async def test_valid_location_and_omitted_optional_department_succeed(client):
    """Department is genuinely optional (`department_id: int | None`); a
    request that omits it entirely must succeed, distinguishing "genuinely
    optional and omitted" from "required and missing."""
    headers, company_id, location_id, _department_id = await _admin_headers(client)

    resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "NODEPT", "name": "No Department",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": None,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert resp.status_code == 201
    assert resp.json()["department_id"] is None


async def test_am09_duplicate_emp_code_within_a_company_is_a_controlled_422_not_500(client):
    """AM-09: `code` is unique per company (AssetUser.__table_args__) -- a
    caller reusing an existing code is an ordinary mistake, not malformed
    input, and previously hit an unhandled 500 (a raw asyncpg
    UniqueViolationError) instead of a normal 422."""
    headers, company_id, location_id, department_id = await _admin_headers(client)

    first = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "DUPHOLD", "name": "First", "asset_user_type": "EMPLOYEE",
        "location_id": location_id, "department_id": department_id, "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert first.status_code == 201

    second = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "DUPHOLD", "name": "Second", "asset_user_type": "EMPLOYEE",
        "location_id": location_id, "department_id": department_id, "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert second.status_code == 422
    assert "already exists" in second.json()["detail"]

    # The failed attempt must not corrupt the session for a subsequent, valid request.
    third = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "NOTDUPHOLD", "name": "Third", "asset_user_type": "EMPLOYEE",
        "location_id": location_id, "department_id": department_id, "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert third.status_code == 201


async def test_update_asset_user_also_validates_location_references(client):
    """The same defensive check applies to PUT, not just POST."""
    headers, company_id, location_id, department_id = await _admin_headers(client)
    create_resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "EDITME", "name": "Edit Me",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    asset_user_id = create_resp.json()["id"]

    resp = await client.put(f"/api/asset-users/{asset_user_id}", json={
        "company_id": company_id, "code": "EDITME", "name": "Edit Me",
        "asset_user_type": "EMPLOYEE", "location_id": 0, "department_id": department_id,
        "email": None, "phone": None, "role": "SELF_SERVICE",
    }, headers=headers)
    assert resp.status_code == 422

    async with SessionLocal() as session:
        row = await session.get(AssetUser, asset_user_id)
        assert row.location_id == location_id  # unchanged -- the bad PUT never committed
