"""Asset User / RBAC rebuild: the Primary Owner is a fixed, company-less
bootstrap account (is_primary_owner=True, role="ADMIN"), distinct from the
ordinary ADMIN role -- see docs/ai/ASSET_USER_RBAC_REBUILD_PREFLIGHT.md §16
and CLAUDE.md's rebuild notes. These tests cover the behavior that is new
with this concept: login-by-name (no company/code/email of its own),
grant/revoke restricted to an existing Primary Owner, and the "never remove
the last one" continuity guard."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Location, Department
from app.asset_users.models import AssetUser


async def _seed_primary_owner(name="Admin", password="Passw0rd!"):
    async with SessionLocal() as session:
        owner = AssetUser(
            name=name, role="ADMIN", is_primary_owner=True, login_enabled=True,
            password_hash=hash_password(password), must_change_password=False,
        )
        session.add(owner)
        await session.commit()
        return owner.id


async def _seed_ordinary_admin(client, company_code="POWN1", code="ADM1"):
    async with SessionLocal() as session:
        co = Company(code=company_code, name="Primary Owner Test Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code=f"{company_code}-HO", name="HO")
        dept = Department(name=f"IT-{company_code}")
        session.add_all([loc, dept])
        await session.flush()
        asset_user = AssetUser(
            company_id=co.id, code=code, name="Ordinary Admin", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="ADMIN",
            login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(asset_user)
        await session.commit()
        asset_user_id = asset_user.id

    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, co.id, loc.id, dept.id, asset_user_id


async def test_primary_owner_logs_in_by_name_with_no_company_or_code(client):
    await _seed_primary_owner(name="Admin")
    resp = await client.post("/api/auth/login", json={"login_id": "Admin", "password": "Passw0rd!"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "ADMIN"
    assert body["company_id"] is None


async def test_primary_owner_login_is_case_insensitive_by_name(client):
    await _seed_primary_owner(name="Admin")
    resp = await client.post("/api/auth/login", json={"login_id": "admin", "password": "Passw0rd!"})
    assert resp.status_code == 200


async def test_ordinary_admin_cannot_grant_primary_owner_status(client):
    """Only an existing Primary Owner may create another one -- an ordinary
    ADMIN (even though ADMIN is otherwise unrestricted everywhere else) must
    not be able to self-escalate into this fixed, protected status."""
    headers, _co, _loc, _dept, other_id = await _seed_ordinary_admin(client, code="ADM2")
    resp = await client.post(f"/api/asset-users/{other_id}/primary-owner", headers=headers)
    assert resp.status_code == 403


async def test_primary_owner_can_grant_status_to_another_asset_user(client):
    await _seed_primary_owner(name="Admin")
    owner_resp = await client.post("/api/auth/login", json={"login_id": "Admin", "password": "Passw0rd!"})
    owner_headers = {"Authorization": f"Bearer {owner_resp.json()['access_token']}"}

    _headers, _co, _loc, _dept, target_id = await _seed_ordinary_admin(client, code="ADM3")
    grant_resp = await client.post(f"/api/asset-users/{target_id}/primary-owner", headers=owner_headers)
    assert grant_resp.status_code == 200
    assert grant_resp.json()["is_primary_owner"] is True


async def test_cannot_revoke_the_last_remaining_primary_owner(client):
    owner_id = await _seed_primary_owner(name="Admin")
    resp = await client.post("/api/auth/login", json={"login_id": "Admin", "password": "Passw0rd!"})
    owner_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    revoke_resp = await client.delete(f"/api/asset-users/{owner_id}/primary-owner", headers=owner_headers)
    assert revoke_resp.status_code == 422
    assert "last remaining" in revoke_resp.json()["detail"]


async def test_cannot_deactivate_the_last_remaining_primary_owner(client):
    owner_id = await _seed_primary_owner(name="Admin")
    resp = await client.post("/api/auth/login", json={"login_id": "Admin", "password": "Passw0rd!"})
    owner_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    deactivate_resp = await client.delete(f"/api/asset-users/{owner_id}", headers=owner_headers)
    assert deactivate_resp.status_code == 422
    assert "last remaining" in deactivate_resp.json()["detail"]


async def test_revoking_a_second_primary_owner_is_allowed(client):
    owner_id = await _seed_primary_owner(name="Admin")
    resp = await client.post("/api/auth/login", json={"login_id": "Admin", "password": "Passw0rd!"})
    owner_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    _headers, _co, _loc, _dept, target_id = await _seed_ordinary_admin(client, code="ADM4")
    await client.post(f"/api/asset-users/{target_id}/primary-owner", headers=owner_headers)

    revoke_resp = await client.delete(f"/api/asset-users/{target_id}/primary-owner", headers=owner_headers)
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["is_primary_owner"] is False
    # The original owner is untouched and still able to act.
    still_owner = await client.get("/api/asset-users", headers=owner_headers)
    assert still_owner.status_code == 200


async def test_ordinary_add_asset_user_form_cannot_set_is_primary_owner(client):
    """AssetUserIn has no is_primary_owner field at all -- posting one is
    simply ignored, never silently honored."""
    headers, company_id, location_id, department_id, _id = await _seed_ordinary_admin(client, code="ADM5")
    resp = await client.post("/api/asset-users", json={
        "company_id": company_id, "code": "SNEAK1", "name": "Sneaky",
        "asset_user_type": "EMPLOYEE", "location_id": location_id, "department_id": department_id,
        "role": "SELF_SERVICE", "is_primary_owner": True,
    }, headers=headers)
    assert resp.status_code == 201
    assert resp.json()["is_primary_owner"] is False
