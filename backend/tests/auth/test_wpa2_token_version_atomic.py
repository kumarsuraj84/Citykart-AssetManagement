"""Security OBS-TV (closure WP-A2): raising asset_user.token_version is ONE atomic statement, so session ends that
happen at the same moment never collapse into one -- every token issued before any of them stops working."""
import asyncio

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import end_all_sessions
from app.main import app
from tests.core.s0_world import PASSWORD, build_world

PROBE = "/api/auth/capabilities"
NEW_PASSWORD = "Fresh#Ladder2026"


def _new_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _version(uid: int) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(AssetUser.token_version).where(AssetUser.id == uid))).scalar_one()


async def _sign_in(login_id: str, password: str = PASSWORD):
    async with _new_client() as c:
        return await c.post("/api/auth/login", json={"login_id": login_id, "password": password})


async def test_twenty_concurrent_bumps_end_at_start_plus_twenty():
    w = await build_world()
    start = await _version(w["op_it"])

    async def bump() -> int:
        async with SessionLocal() as s:
            user = await s.get(AssetUser, w["op_it"])
            new = await end_all_sessions(s, user, reason="test")
            assert user.token_version == new                     # the in-memory object has the returned value
            await s.commit()
            return new

    values = await asyncio.gather(*(bump() for _ in range(20)))
    assert sorted(values) == list(range(start + 1, start + 21))  # each bump saw its own, distinct result
    assert await _version(w["op_it"]) == start + 20


async def test_a_bump_leaves_no_pending_write_of_the_old_value():
    """The object gets the new value as its committed state: a later flush of the same object (another field
    changed) does not write a stale token_version back over a parallel bump."""
    w = await build_world()
    start = await _version(w["op_it"])
    async with SessionLocal() as s:
        user = await s.get(AssetUser, w["op_it"])
        await end_all_sessions(s, user)
        await s.commit()
        async with SessionLocal() as other:                       # a parallel bump commits in between
            await end_all_sessions(other, await other.get(AssetUser, w["op_it"]))
            await other.commit()
        user.phone = "9000000001"                                 # an unrelated change to the stale object
        await s.commit()
    assert await _version(w["op_it"]) == start + 2


async def test_sessions_ended_at_the_same_moment_all_stay_ended():
    """Sign-out, an admin reset, an access change, a role change and the person's own password change, all at the
    same moment: every access and refresh token issued before is invalid afterwards; a token issued after the last
    one works."""
    w = await build_world()
    uid, login_id = w["op_both"], w["codes"]["op_both"]
    start = await _version(uid)
    old = [(await _sign_in(login_id)) for _ in range(3)]
    old_access = [{"Authorization": f"Bearer {r.json()['access_token']}"} for r in old]
    old_cookies = [r.cookies["refresh_token"] for r in old]
    owner_resp = await _sign_in(w["codes"]["owner"])
    owner = {"Authorization": f"Bearer {owner_resp.json()['access_token']}"}

    async def sign_out():
        async with _new_client() as c:
            c.cookies.set("refresh_token", old_cookies[0])
            return await c.post("/api/auth/logout")

    async def reset():
        async with _new_client() as c:
            return await c.post(f"/api/asset-users/{uid}/reset-password", headers=owner)

    async def access_change():
        async with _new_client() as c:
            return await c.post(f"/api/asset-users/{uid}/company-access", headers=owner,
                                json={"company_ids": [w["co_b"]]})

    async def role_change():
        async with _new_client() as c:
            return await c.put(f"/api/asset-users/{uid}", headers=owner, json={"role": "VIEWER"})

    async def own_password_change():
        async with _new_client() as c:
            return await c.post("/api/auth/change-password", headers=old_access[1],
                                json={"old_password": PASSWORD, "new_password": NEW_PASSWORD})

    out, rst, acc, role, pwd = await asyncio.gather(sign_out(), reset(), access_change(), role_change(),
                                                    own_password_change())
    assert (out.status_code, rst.status_code, acc.status_code, role.status_code) == (204, 200, 204, 200)
    assert pwd.status_code in (204, 400, 401), pwd.text            # it may lose the race; never a 500
    # the three admin changes always end the sessions; sign-out and the password change only when they still
    # held a current token at their own check
    assert start + 3 <= await _version(uid) <= start + 5
    async with _new_client() as c:
        for headers in old_access:
            assert (await c.get(PROBE, headers=headers)).status_code == 401
        for cookie in old_cookies:
            c.cookies.clear()
            c.cookies.set("refresh_token", cookie)
            assert (await c.post("/api/auth/refresh")).status_code == 401
    # a sign-in after the last change works (whichever password was saved last)
    temp = rst.json()["temp_password"]
    fresh = await _sign_in(login_id, NEW_PASSWORD)
    if fresh.status_code != 200:
        fresh = await _sign_in(login_id, temp)
    assert fresh.status_code == 200, fresh.text
    async with _new_client() as c:
        assert (await c.get(PROBE, headers={"Authorization": f"Bearer {fresh.json()['access_token']}"})).status_code != 401
        c.cookies.set("refresh_token", fresh.cookies["refresh_token"])
        assert (await c.post("/api/auth/refresh")).status_code == 200
