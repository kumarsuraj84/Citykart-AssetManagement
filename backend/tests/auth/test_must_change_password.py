"""Server-side enforcement of `must_change_password` (spec §7.1: "Forced password
change on first login"). Client-side routing alone is bypassable with curl, so
`get_current_asset_user` itself refuses every authenticated route except the
change-password endpoint until the asset_user has actually changed it."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import Company, Department, Location


async def _make_asset_user(session, must_change: bool, code="CKSM1"):
    co = Company(code=code, name="Must Change Co")
    session.add(co)
    await session.flush()
    loc = Location(company_id=co.id, code=f"{code}-HO", name="HO")
    dept = Department(name=f"IT-{code}")
    session.add_all([loc, dept])
    await session.flush()
    asset_user = AssetUser(
        company_id=co.id, code=f"EMP-{code}", name="New Joiner",
        asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
        role="ADMIN", login_enabled=True, password_hash=hash_password("TempPassw0rd!"), must_change_password=must_change,
    )
    session.add(asset_user)
    await session.commit()
    return co, asset_user


async def _login(client, co, asset_user, password="TempPassw0rd!"):
    resp = await client.post("/api/auth/login", json={
        "login_id": asset_user.code, "password": password,
    })
    assert resp.status_code == 200
    return resp.json()


async def test_must_change_password_blocks_other_routes_with_403(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_asset_user(session, must_change=True)

    body = await _login(client, co, asset_user)
    assert body["must_change_password"] is True
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    for path in ("/api/assets", "/api/asset-users", "/api/code-rules", "/api/masters/companies", "/api/reports/dashboard"):
        resp = await client.get(path, headers=headers)
        assert resp.status_code == 403, path
        assert "password" in resp.json()["detail"].lower()


async def test_change_password_is_allowed_and_then_unblocks_everything(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_asset_user(session, must_change=True, code="CKSM2")

    body = await _login(client, co, asset_user)
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": "TempPassw0rd!", "new_password": "Brand-New-Passw0rd"},
        headers=headers,
    )
    assert resp.status_code == 204

    # Same access token now works -- get_current_asset_user re-reads the asset_user row.
    assert (await client.get("/api/assets", headers=headers)).status_code == 200

    # And a fresh login with the new password reports the flag cleared.
    body2 = await _login(client, co, asset_user, password="Brand-New-Passw0rd")
    assert body2["must_change_password"] is False


async def test_asset_user_without_flag_is_not_blocked(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_asset_user(session, must_change=False, code="CKSM3")

    body = await _login(client, co, asset_user)
    resp = await client.get("/api/assets", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert resp.status_code == 200


async def test_change_password_wrong_old_password_is_400_not_401(client):
    """401 means "your session is invalid" to the frontend's api-client (it
    triggers a token refresh and, failing that, a logout). A mistyped old
    password is a validation failure of an otherwise-valid session."""
    async with SessionLocal() as session:
        co, asset_user = await _make_asset_user(session, must_change=True, code="CKSM4")

    body = await _login(client, co, asset_user)
    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": "wrong", "new_password": "Brand-New-Passw0rd"},
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert resp.status_code == 400


async def test_change_password_rejects_short_or_unchanged_password(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_asset_user(session, must_change=True, code="CKSM5")

    body = await _login(client, co, asset_user)
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    short = await client.post(
        "/api/auth/change-password", json={"old_password": "TempPassw0rd!", "new_password": "short"}, headers=headers,
    )
    assert short.status_code == 422

    same = await client.post(
        "/api/auth/change-password", json={"old_password": "TempPassw0rd!", "new_password": "TempPassw0rd!"}, headers=headers,
    )
    assert same.status_code == 422
