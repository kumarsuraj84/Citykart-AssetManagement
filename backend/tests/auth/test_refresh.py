from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import create_access_token, create_refresh_token, hash_password
from app.holders.models import Holder
from app.masters.models import Company, Department, Location


async def _make_admin(session, company_code="CKSR1", emp_code="ADMINR1"):
    co = Company(code=company_code, name="Refresh Test Co")
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


async def _login(client, co, holder):
    resp = await client.post("/api/auth/login", json={
        "company_id": co.id, "login_id": holder.emp_code, "password": "Passw0rd!",
    })
    assert resp.status_code == 200
    return resp


async def test_refresh_with_valid_refresh_cookie_issues_working_access_token(client):
    async with SessionLocal() as session:
        co, holder = await _make_admin(session)

    await _login(client, co, holder)
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
        co, holder = await _make_admin(session, "CKSR2", "ADMINR2")

    access = create_access_token(holder.id, "ADMIN", None)
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
        co, holder = await _make_admin(session, "CKSR3", "ADMINR3")

    expired = jwt.encode(
        {"sub": str(holder.id), "type": "refresh", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        settings.jwt_secret, algorithm="HS256",
    )
    client.cookies.set("refresh_token", expired)
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_rejects_inactive_holder(client):
    async with SessionLocal() as session:
        co, holder = await _make_admin(session, "CKSR4", "ADMINR4")

    client.cookies.set("refresh_token", create_refresh_token(holder.id))
    async with SessionLocal() as session:
        db_holder = await session.get(Holder, holder.id)
        db_holder.is_active = False
        await session.commit()

    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_refresh_cookie_is_not_secure_by_default(client):
    """This app is deployed over plain HTTP on a LAN (docs/deployment.md): a
    `Secure` cookie would never be sent back by the browser, silently breaking
    refresh. The flag is configurable and defaults to off."""
    async with SessionLocal() as session:
        co, holder = await _make_admin(session, "CKSR5", "ADMINR5")

    resp = await _login(client, co, holder)
    set_cookie = resp.headers["set-cookie"].lower()
    assert "refresh_token=" in set_cookie
    assert "httponly" in set_cookie
    assert "secure" not in set_cookie


async def test_refresh_cookie_secure_when_configured(client, monkeypatch):
    async with SessionLocal() as session:
        co, holder = await _make_admin(session, "CKSR6", "ADMINR6")

    monkeypatch.setattr(settings, "cookie_secure", True)
    resp = await _login(client, co, holder)
    assert "secure" in resp.headers["set-cookie"].lower()


async def test_logout_clears_refresh_cookie(client):
    async with SessionLocal() as session:
        co, holder = await _make_admin(session, "CKSR7", "ADMINR7")

    await _login(client, co, holder)
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 204
    assert (await client.post("/api/auth/refresh")).status_code == 401
