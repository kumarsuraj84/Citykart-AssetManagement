"""Server-side enforcement of `must_change_password` (spec §7.1: "Forced password
change on first login"). Client-side routing alone is bypassable with curl, so
`get_current_holder` itself refuses every authenticated route except the
change-password endpoint until the holder has actually changed it."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import Company, Department, Location


async def _make_holder(session, must_change: bool, code="CKSM1"):
    co = Company(code=code, name="Must Change Co")
    loc = Location(code=f"{code}-HO", name="HO")
    dept = Department(name=f"IT-{code}")
    session.add_all([co, loc, dept])
    await session.flush()
    holder = Holder(
        company_id=co.id, emp_code=f"EMP-{code}", name="New Joiner",
        holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
        role="ADMIN", password_hash=hash_password("TempPassw0rd!"), must_change_password=must_change,
    )
    session.add(holder)
    await session.commit()
    return co, holder


async def _login(client, co, holder, password="TempPassw0rd!"):
    resp = await client.post("/api/auth/login", json={
        "login_id": holder.emp_code, "password": password,
    })
    assert resp.status_code == 200
    return resp.json()


async def test_must_change_password_blocks_other_routes_with_403(client):
    async with SessionLocal() as session:
        co, holder = await _make_holder(session, must_change=True)

    body = await _login(client, co, holder)
    assert body["must_change_password"] is True
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    for path in ("/api/assets", "/api/holders", "/api/code-rules", "/api/masters/companies", "/api/reports/dashboard"):
        resp = await client.get(path, headers=headers)
        assert resp.status_code == 403, path
        assert "password" in resp.json()["detail"].lower()


async def test_change_password_is_allowed_and_then_unblocks_everything(client):
    async with SessionLocal() as session:
        co, holder = await _make_holder(session, must_change=True, code="CKSM2")

    body = await _login(client, co, holder)
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": "TempPassw0rd!", "new_password": "Brand-New-Passw0rd"},
        headers=headers,
    )
    assert resp.status_code == 204

    # Same access token now works -- get_current_holder re-reads the holder row.
    assert (await client.get("/api/assets", headers=headers)).status_code == 200

    # And a fresh login with the new password reports the flag cleared.
    body2 = await _login(client, co, holder, password="Brand-New-Passw0rd")
    assert body2["must_change_password"] is False


async def test_holder_without_flag_is_not_blocked(client):
    async with SessionLocal() as session:
        co, holder = await _make_holder(session, must_change=False, code="CKSM3")

    body = await _login(client, co, holder)
    resp = await client.get("/api/assets", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert resp.status_code == 200


async def test_change_password_wrong_old_password_is_400_not_401(client):
    """401 means "your session is invalid" to the frontend's api-client (it
    triggers a token refresh and, failing that, a logout). A mistyped old
    password is a validation failure of an otherwise-valid session."""
    async with SessionLocal() as session:
        co, holder = await _make_holder(session, must_change=True, code="CKSM4")

    body = await _login(client, co, holder)
    resp = await client.post(
        "/api/auth/change-password",
        json={"old_password": "wrong", "new_password": "Brand-New-Passw0rd"},
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert resp.status_code == 400


async def test_change_password_rejects_short_or_unchanged_password(client):
    async with SessionLocal() as session:
        co, holder = await _make_holder(session, must_change=True, code="CKSM5")

    body = await _login(client, co, holder)
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    short = await client.post(
        "/api/auth/change-password", json={"old_password": "TempPassw0rd!", "new_password": "short"}, headers=headers,
    )
    assert short.status_code == 422

    same = await client.post(
        "/api/auth/change-password", json={"old_password": "TempPassw0rd!", "new_password": "TempPassw0rd!"}, headers=headers,
    )
    assert same.status_code == 422
