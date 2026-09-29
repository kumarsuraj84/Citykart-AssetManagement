from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import create_access_token, create_refresh_token, hash_password
from app.asset_users.models import AssetUser
from app.masters.models import Company, Department, Location


async def _make_admin(session, company_code="CKSR1", emp_code="ADMINR1"):
    co = Company(code=company_code, name="Refresh Test Co")
    session.add(co)
    await session.flush()
    loc = Location(company_id=co.id, code=f"{company_code}-HO", name="HO")
    dept = Department(name=f"IT-{company_code}")
    session.add_all([loc, dept])
    await session.flush()
    asset_user = AssetUser(
        company_id=co.id, emp_code=emp_code, name="Admin",
        asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
        role="ADMIN", password_hash=hash_password("Passw0rd!"), must_change_password=False,
    )
    session.add(asset_user)
    await session.commit()
    return co, asset_user


async def _login(client, co, asset_user):
    resp = await client.post("/api/auth/login", json={
        "login_id": asset_user.emp_code, "password": "Passw0rd!",
    })
    assert resp.status_code == 200
    return resp


async def test_refresh_with_valid_refresh_cookie_issues_working_access_token(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_admin(session)

    await _login(client, co, asset_user)
    # The login response set the httpOnly refresh cookie; the client's cookie jar
    # sends it back automatically (only possible because the cookie is NOT
    # `Secure` by default -- see test_refresh_cookie_is_not_secure_by_default).
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "ADMIN"
    assert body["company_id"] == co.id
    assert body["must_change_password"] is False

    new_access = body["access_token"]
    me = await client.get("/api/code-rules", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200
    # Sliding 8h idle window (spec §8): every refresh rotates the refresh cookie.
    assert "refresh_token" in resp.cookies


async def test_refresh_rejects_an_access_token_in_the_cookie(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_admin(session, "CKSR2", "ADMINR2")

    access = create_access_token(asset_user.id, "ADMIN", None)
    client.cookies.set("refresh_token", access)
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_rejects_missing_cookie(client):
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_rejects_garbage_cookie(client):
    client.cookies.set("refresh_token", "not-a-jwt")
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_rejects_expired_refresh_token(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_admin(session, "CKSR3", "ADMINR3")

    expired = jwt.encode(
        {"sub": str(asset_user.id), "type": "refresh", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        settings.jwt_secret, algorithm="HS256",
    )
    client.cookies.set("refresh_token", expired)
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_rejects_inactive_asset_user(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_admin(session, "CKSR4", "ADMINR4")

    client.cookies.set("refresh_token", create_refresh_token(asset_user.id))
    async with SessionLocal() as session:
        db_asset_user = await session.get(AssetUser, asset_user.id)
        db_asset_user.is_active = False
        await session.commit()

    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_cookie_is_not_secure_by_default(client):
    """This app is deployed over plain HTTP on a LAN (docs/deployment.md): a
    `Secure` cookie would never be sent back by the browser, silently breaking
    refresh. The flag is configurable and defaults to off."""
    async with SessionLocal() as session:
        co, asset_user = await _make_admin(session, "CKSR5", "ADMINR5")

    resp = await _login(client, co, asset_user)
    set_cookie = resp.headers["set-cookie"].lower()
    assert "refresh_token=" in set_cookie
    assert "httponly" in set_cookie
    assert "secure" not in set_cookie


async def test_refresh_cookie_secure_when_configured(client, monkeypatch):
    async with SessionLocal() as session:
        co, asset_user = await _make_admin(session, "CKSR6", "ADMINR6")

    monkeypatch.setattr(settings, "cookie_secure", True)
    resp = await _login(client, co, asset_user)
    assert "secure" in resp.headers["set-cookie"].lower()


async def test_logout_clears_refresh_cookie(client):
    async with SessionLocal() as session:
        co, asset_user = await _make_admin(session, "CKSR7", "ADMINR7")

    await _login(client, co, asset_user)
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 204
    assert (await client.post("/api/auth/refresh")).status_code == 401
