"""Security AU-05 / AU-06 / AU-07 (VAPT 2026-10): a session really ends -- sign-out, a password change or reset,
deactivation, sign-in switched off and any access change make every earlier access AND refresh token of that
account stop working at once; other people stay signed in; signing in again works."""
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from app.asset_users.models import AssetUser
from app.core.config import settings
from app.core.db import SessionLocal
from tests.core.s0_world import PASSWORD, build_world

PROBE = "/api/auth/capabilities"          # any signed-in person may call it


async def _sign_in(client, w, who, password=PASSWORD) -> tuple[dict, str]:
    resp = await client.post("/api/auth/login", json={"login_id": w["codes"][who], "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, resp.cookies["refresh_token"]


async def _refresh_with(client, cookie):
    client.cookies.clear()
    client.cookies.set("refresh_token", cookie)
    return await client.post("/api/auth/refresh")


async def _works(client, headers) -> bool:
    status = (await client.get(PROBE, headers=headers)).status_code
    assert status in (200, 401), status
    return status == 200


async def _ended(client, headers, cookie) -> bool:
    return not await _works(client, headers) and (await _refresh_with(client, cookie)).status_code == 401


async def test_sign_out_ends_every_token_of_that_account_but_nobody_elses(client):
    w = await build_world()
    mine, my_cookie = await _sign_in(client, w, "op_it")
    other, other_cookie = await _sign_in(client, w, "viewer_it")
    client.cookies.clear()
    client.cookies.set("refresh_token", my_cookie)
    assert (await client.post("/api/auth/logout")).status_code == 204
    assert await _ended(client, mine, my_cookie)
    assert await _works(client, other)
    assert (await _refresh_with(client, other_cookie)).status_code == 200
    again, _ = await _sign_in(client, w, "op_it")
    assert await _works(client, again)


async def test_a_stale_cookie_at_sign_out_cannot_sign_anyone_out(client):
    w = await build_world()
    first, first_cookie = await _sign_in(client, w, "op_it")
    client.cookies.clear()
    client.cookies.set("refresh_token", first_cookie)
    await client.post("/api/auth/logout")                                    # ends session 1
    second, _ = await _sign_in(client, w, "op_it")
    client.cookies.clear()
    client.cookies.set("refresh_token", first_cookie)
    assert (await client.post("/api/auth/logout")).status_code == 204        # replaying the old cookie...
    assert await _works(client, second)                                      # ...does not end the new session


async def test_a_password_change_ends_old_tokens_and_hands_the_browser_a_working_new_session(client):
    """Exactly what the frontend does: POST change-password with its access token (204, no body), then its next
    request 401s, it calls /auth/refresh once with the cookie the change-password answer set, and carries on."""
    w = await build_world()
    headers, old_cookie = await _sign_in(client, w, "op_it")
    resp = await client.post("/api/auth/change-password", headers=headers,
                             json={"old_password": PASSWORD, "new_password": "Brand-New#Pass26"})
    assert resp.status_code == 204 and resp.content == b""
    new_cookie = resp.cookies["refresh_token"]
    assert new_cookie != old_cookie
    assert not await _works(client, headers)                                 # the old access token
    assert (await _refresh_with(client, old_cookie)).status_code == 401      # the old refresh token
    renewed = await _refresh_with(client, new_cookie)
    assert renewed.status_code == 200 and renewed.json()["must_change_password"] is False
    assert await _works(client, {"Authorization": f"Bearer {renewed.json()['access_token']}"})
    assert (await client.post("/api/auth/login", json={"login_id": "S0OPIT", "password": "Brand-New#Pass26"})).status_code == 200


async def _reset_password(client, w, owner):
    resp = await client.post(f"/api/asset-users/{w['op_both']}/reset-password", headers=owner)
    assert resp.status_code == 200, resp.text


async def _issue_password(client, w, owner):
    resp = await client.post("/api/asset-users/issue-passwords", headers=owner,
                             json={"asset_user_ids": [w["op_both"]], "only_without_password": False})
    assert resp.status_code == 200 and len(resp.json()) == 1, resp.text


async def _deactivate(client, w, owner):
    assert (await client.delete(f"/api/asset-users/{w['op_both']}", headers=owner)).status_code == 204


async def _switch_sign_in_off(client, w, owner):
    resp = await client.put(f"/api/asset-users/{w['op_both']}", headers=owner, json={"login_enabled": False})
    assert resp.status_code == 200, resp.text


async def _new_role(client, w, owner):
    resp = await client.put(f"/api/asset-users/{w['op_both']}", headers=owner, json={"role": "VIEWER"})
    assert resp.status_code == 200, resp.text


async def _narrower_work_area(client, w, owner):
    resp = await client.put(f"/api/asset-users/{w['op_both']}", headers=owner, json={"allowed_asset_domains": "IT"})
    assert resp.status_code == 200, resp.text


async def _company_access(client, w, owner):
    resp = await client.post(f"/api/asset-users/{w['op_both']}/company-access", headers=owner,
                             json={"company_ids": [w["co_b"]]})
    assert resp.status_code == 204, resp.text


@pytest.mark.parametrize("event", [_reset_password, _issue_password, _deactivate, _switch_sign_in_off, _new_role,
                                   _narrower_work_area, _company_access])
async def test_an_admin_change_ends_the_persons_sessions_and_nobody_elses(client, event):
    w = await build_world()
    theirs, their_cookie = await _sign_in(client, w, "op_both")
    bystander, bystander_cookie = await _sign_in(client, w, "op_it")
    owner, _ = await _sign_in(client, w, "owner")
    await event(client, w, owner)
    assert await _ended(client, theirs, their_cookie)
    assert await _works(client, bystander) and await _works(client, owner)
    assert (await _refresh_with(client, bystander_cookie)).status_code == 200
    if event in (_new_role, _narrower_work_area, _company_access):          # still allowed to sign in: works again
        again, _ = await _sign_in(client, w, "op_both")
        assert await _works(client, again)


async def test_an_ordinary_edit_keeps_the_person_signed_in(client):
    w = await build_world()
    theirs, their_cookie = await _sign_in(client, w, "op_both")
    owner, _ = await _sign_in(client, w, "owner")
    resp = await client.put(f"/api/asset-users/{w['op_both']}", headers=owner, json={"phone": "9876543210"})
    assert resp.status_code == 200, resp.text
    assert await _works(client, theirs)
    assert (await _refresh_with(client, their_cookie)).status_code == 200


async def test_taking_head_office_rights_away_ends_that_admins_sessions(client):
    w = await build_world()
    theirs, their_cookie = await _sign_in(client, w, "owner2")
    owner, _ = await _sign_in(client, w, "owner")
    assert (await client.delete(f"/api/asset-users/{w['owner2']}/primary-owner", headers=owner)).status_code == 200
    assert await _ended(client, theirs, their_cookie)


async def test_sign_in_switched_off_ends_a_live_access_token_at_once(client):
    """AU-07: whatever path switches sign-in off, the 15-minute access token stops at the next request."""
    w = await build_world()
    headers, _ = await _sign_in(client, w, "viewer_it")
    async with SessionLocal() as s:
        u = await s.get(AssetUser, w["viewer_it"])
        u.login_enabled = False
        await s.commit()
    resp = await client.get(PROBE, headers=headers)
    assert resp.status_code == 401 and "sign in again" in resp.json()["detail"]


async def test_every_refresh_hands_out_a_new_unique_token(client):
    w = await build_world()
    _, cookie = await _sign_in(client, w, "op_it")
    first = await _refresh_with(client, cookie)
    # Closure WP-A2 / AU-06 (intended change): the second renewal uses the NEW cookie. The same cookie twice is
    # now a duplicate (no new cookie) or, outside the grace window, reuse (test_wpa2_refresh_reuse.py).
    second = await _refresh_with(client, first.cookies["refresh_token"])
    assert first.status_code == second.status_code == 200
    a, b = first.cookies["refresh_token"], second.cookies["refresh_token"]
    assert a != b != cookie
    claims = [jwt.get_unverified_claims(t) for t in (cookie, a, b)]
    assert len({c["jti"] for c in claims}) == 3 and {c["tv"] for c in claims} == {0}
    assert len({c["sid"] for c in claims}) == 1                      # one sign-in = one session record
    access = jwt.get_unverified_claims(first.json()["access_token"])
    assert access["type"] == "access" and access["tv"] == 0 and access["jti"]


async def test_a_token_from_before_this_release_keeps_working_until_the_version_changes(client):
    """No `tv` claim (issued before the upgrade) counts as version 0 -- nobody is thrown out by the deploy."""
    w = await build_world()
    exp = datetime.now(timezone.utc) + timedelta(minutes=5)
    old_access = jwt.encode({"sub": str(w["op_it"]), "role": "OPERATOR", "company_scope": w["co"], "type": "access",
                             "exp": exp}, settings.jwt_secret, algorithm="HS256")
    old_refresh = jwt.encode({"sub": str(w["op_it"]), "type": "refresh", "exp": exp}, settings.jwt_secret,
                             algorithm="HS256")
    headers = {"Authorization": f"Bearer {old_access}"}
    assert await _works(client, headers)
    assert (await _refresh_with(client, old_refresh)).status_code == 200
    client.cookies.clear()
    client.cookies.set("refresh_token", old_refresh)
    assert (await client.post("/api/auth/logout")).status_code == 204
    assert await _ended(client, headers, old_refresh)
