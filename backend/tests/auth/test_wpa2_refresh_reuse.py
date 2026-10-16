"""Security AU-06 (closure WP-A2): server-side session records and refresh-token REUSE detection.

A refresh token is accepted exactly once. The token that was JUST replaced coming back a moment later (several tabs
of one browser) is a harmless duplicate: a new access token, no new cookie. Any other old,
unknown or revoked token is reuse: 401, every session of that person ends, a SECURITY row says so, nobody else is
affected. Only hashes of token ids are stored -- never a token or a token id."""
import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select, update

from app.asset_users.models import AssetUser
from app.auth.models import AuthSession
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.deps import SESSION_ENDED_DETAIL
from app.main import app
from app.observability.models import AuditLog
from app.observability.retention import purge_old_logs
from tests.core.s0_world import PASSWORD, build_world
from tests.observability.helpers import as_text, audit, everything_logged, flush_logs

PROBE = "/api/auth/capabilities"


def _new_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _claims(token: str) -> dict:
    return jwt.get_unverified_claims(token)


def _set_cookie(resp) -> str | None:
    """The refresh cookie this answer set, or None when it set none."""
    return resp.cookies.get("refresh_token") if "refresh_token=" in resp.headers.get("set-cookie", "") else None


async def _sign_in(w, who, password=PASSWORD) -> tuple[dict, str]:
    async with _new_client() as c:
        resp = await c.post("/api/auth/login", json={"login_id": w["codes"][who], "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, resp.cookies["refresh_token"]


async def _refresh(cookie: str):
    async with _new_client() as c:
        c.cookies.set("refresh_token", cookie)
        return await c.post("/api/auth/refresh")


async def _works(headers) -> bool:
    async with _new_client() as c:
        status = (await c.get(PROBE, headers=headers)).status_code
    assert status in (200, 401), status
    return status == 200


async def _rows(asset_user_id: int) -> list[AuthSession]:
    async with SessionLocal() as s:
        return list((await s.execute(select(AuthSession).where(AuthSession.asset_user_id == asset_user_id)
                                     .order_by(AuthSession.id))).scalars().all())


async def _version(asset_user_id: int) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(AssetUser.token_version).where(AssetUser.id == asset_user_id))).scalar_one()


async def _set_row(sid: int, **values) -> None:
    async with SessionLocal() as s:
        await s.execute(update(AuthSession).where(AuthSession.id == sid).values(**values))
        await s.commit()


async def _reuse_rows() -> list[AuditLog]:
    return await audit(AuditLog.action == "REFRESH_REUSE")


# ------------------------------------------------------------------ the normal chain


async def test_a_normal_refresh_chain_keeps_one_session_with_one_current_hash():
    w = await build_world()
    _, cookie = await _sign_in(w, "op_it")
    sid = _claims(cookie)["sid"]
    chain = [cookie]
    for _ in range(3):
        resp = await _refresh(chain[-1])
        assert resp.status_code == 200, resp.text
        assert set(resp.json()) >= {"access_token", "must_change_password", "role", "company_id",
                                    "is_primary_owner", "asset_user_id"}
        assert await _works({"Authorization": f"Bearer {resp.json()['access_token']}"})
        new = _set_cookie(resp)
        assert new and _claims(new)["sid"] == sid
        chain.append(new)
    assert len({_claims(t)["jti"] for t in chain}) == 4
    [row] = await _rows(w["op_it"])
    assert row.id == sid and row.revoked_at is None
    assert row.current_jti_hash == _sha(_claims(chain[-1])["jti"])
    assert row.previous_jti_hash == _sha(_claims(chain[-2])["jti"])
    left = row.expires_at - datetime.now(timezone.utc)
    assert timedelta(hours=settings.jwt_refresh_hours) - timedelta(minutes=1) < left <= timedelta(
        hours=settings.jwt_refresh_hours)
    assert not await _reuse_rows()


# ------------------------------------------------------------------ reuse


@pytest.mark.parametrize("how", ["two_rotations_old", "previous_after_grace"])
async def test_an_old_token_ends_every_session_of_that_person_and_nobody_elses(how):
    w = await build_world()
    phone, phone_cookie = await _sign_in(w, "op_it")
    pc, pc_cookie = await _sign_in(w, "op_it")                         # the same person on a second device
    bystander, bystander_cookie = await _sign_in(w, "viewer_it")
    before = await _version(w["op_it"])
    first = _set_cookie(await _refresh(phone_cookie))
    second = _set_cookie(await _refresh(first))
    sid = _claims(phone_cookie)["sid"]
    if how == "two_rotations_old":
        stolen = phone_cookie                                          # older than the previous one
    else:
        stolen = first                                                 # the previous one, after the window
        await _set_row(sid, previous_valid_until=datetime.now(timezone.utc) - timedelta(seconds=1))

    resp = await _refresh(stolen)
    assert resp.status_code == 401 and resp.json()["detail"] == SESSION_ENDED_DETAIL
    assert _set_cookie(resp) is None
    assert await _version(w["op_it"]) == before + 1
    # every session of the person is over: the newest cookie, the other device, their access tokens
    assert (await _refresh(second)).status_code == 401
    assert (await _refresh(pc_cookie)).status_code == 401
    assert not await _works(phone) and not await _works(pc)
    rows = await _rows(w["op_it"])
    assert len(rows) == 2 and all(r.revoked_at is not None and r.revoked_reason == "refresh token reuse"
                                  for r in rows)
    # one SECURITY row: who, which session, no token material
    [row] = await _reuse_rows()
    assert (row.category, row.outcome, row.actor_id) == ("SECURITY", "DENIED", w["op_it"])
    assert row.changes["session"] == sid and row.changes["severity"] == "HIGH"
    for token in (phone_cookie, first, second, stolen):
        assert token not in as_text([row]) and _claims(token)["jti"] not in as_text([row])
    # nobody else is affected
    assert await _works(bystander)
    assert (await _refresh(bystander_cookie)).status_code == 200
    [other] = await _rows(w["viewer_it"])
    assert other.revoked_at is None
    # and the person can simply sign in again
    again, again_cookie = await _sign_in(w, "op_it")
    assert await _works(again) and (await _refresh(again_cookie)).status_code == 200


async def test_a_revoked_or_unknown_session_with_a_current_version_counts_as_reuse():
    w = await build_world()
    _, cookie = await _sign_in(w, "op_it")
    await _set_row(_claims(cookie)["sid"], revoked_at=datetime.now(timezone.utc), revoked_reason="test")
    assert (await _refresh(cookie)).status_code == 401
    assert len(await _reuse_rows()) == 1
    _, cookie2 = await _sign_in(w, "op_it")
    async with SessionLocal() as s:                                    # the record is gone (e.g. a restore)
        await s.execute(AuthSession.__table__.delete().where(AuthSession.id == _claims(cookie2)["sid"]))
        await s.commit()
    assert (await _refresh(cookie2)).status_code == 401
    assert len(await _reuse_rows()) == 2


# ------------------------------------------------------------------ duplicates (several tabs)


async def test_a_duplicate_inside_the_grace_window_gets_an_access_token_and_no_cookie():
    w = await build_world()
    _, cookie = await _sign_in(w, "op_it")
    winner = await _refresh(cookie)
    assert winner.status_code == 200 and _set_cookie(winner)
    twin = await _refresh(cookie)                                      # the other tab, a moment later
    assert twin.status_code == 200 and _set_cookie(twin) is None and "set-cookie" not in twin.headers
    assert twin.json()["asset_user_id"] == w["op_it"]
    assert await _works({"Authorization": f"Bearer {twin.json()['access_token']}"})
    [row] = await audit(AuditLog.action == "REFRESH_DUPLICATE")
    assert row.actor_id == w["op_it"] and row.changes == {"session": _claims(cookie)["sid"], "severity": "LOW"}
    # the winner's newer cookie still works, nothing was ended
    assert (await _refresh(_set_cookie(winner))).status_code == 200
    assert not await _reuse_rows()
    [session_row] = await _rows(w["op_it"])
    assert session_row.revoked_at is None


async def test_strict_mode_treats_the_late_twin_as_reuse(monkeypatch):
    monkeypatch.setattr(settings, "refresh_reuse_grace_seconds", 0)
    w = await build_world()
    _, cookie = await _sign_in(w, "op_it")
    winner = await _refresh(cookie)
    assert winner.status_code == 200
    twin = await _refresh(cookie)
    assert twin.status_code == 401 and twin.json()["detail"] == SESSION_ENDED_DETAIL
    assert len(await _reuse_rows()) == 1
    assert (await _refresh(_set_cookie(winner))).status_code == 401    # everything of that person ended


@pytest.mark.parametrize("parallel", [2, 5, 20])
async def test_parallel_refreshes_with_one_token_rotate_exactly_once(parallel):
    w = await build_world()
    _, cookie = await _sign_in(w, "op_it")
    answers = await asyncio.gather(*(_refresh(cookie) for _ in range(parallel)))
    assert sorted(a.status_code for a in answers) == [200] * parallel        # no 500, no 401
    issued = [_set_cookie(a) for a in answers if _set_cookie(a)]
    assert len(issued) == 1                                                  # exactly one rotation
    [row] = await _rows(w["op_it"])
    assert row.current_jti_hash == _sha(_claims(issued[0])["jti"])
    assert row.previous_jti_hash == _sha(_claims(cookie)["jti"]) and row.revoked_at is None
    assert not await _reuse_rows()
    assert (await _refresh(issued[0])).status_code == 200


@pytest.mark.parametrize("parallel", [2, 10])
async def test_a_parallel_race_in_strict_mode_ends_cleanly(monkeypatch, parallel):
    monkeypatch.setattr(settings, "refresh_reuse_grace_seconds", 0)
    w = await build_world()
    _, cookie = await _sign_in(w, "op_it")
    answers = await asyncio.gather(*(_refresh(cookie) for _ in range(parallel)))
    codes = sorted(a.status_code for a in answers)
    assert codes == [200] + [401] * (parallel - 1)
    assert len([a for a in answers if _set_cookie(a)]) == 1
    assert 1 <= len(await _reuse_rows()) <= parallel - 1


async def test_renewals_reuse_and_sign_out_at_the_same_moment_never_fail_with_an_error():
    """Lock order: whatever ends sessions takes the person's row first and the session rows second; a renewal that
    waited for a parallel winner releases the session row before it ends anything. No deadlock, no 500."""
    w = await build_world()
    _, c0 = await _sign_in(w, "op_it")
    c1 = _set_cookie(await _refresh(c0))
    c2 = _set_cookie(await _refresh(c1))
    before = await _version(w["op_it"])

    async def sign_out():
        async with _new_client() as c:
            c.cookies.set("refresh_token", c2)
            return await c.post("/api/auth/logout")

    answers = await asyncio.gather(*(_refresh(c2) for _ in range(5)), *(_refresh(c0) for _ in range(5)), sign_out(),
                                   *(_refresh(c2) for _ in range(3)))
    assert all(a.status_code in (200, 204, 401) for a in answers), [a.status_code for a in answers]
    assert await _version(w["op_it"]) > before
    for cookie in (c0, c1, c2):
        assert (await _refresh(cookie)).status_code == 401
    assert all(r.revoked_at is not None for r in await _rows(w["op_it"]))


# ------------------------------------------------------------------ the other ways a session ends


async def test_sign_out_revokes_every_session_record_and_an_old_cookie_is_no_alarm():
    w = await build_world()
    _, phone_cookie = await _sign_in(w, "op_it")
    _, pc_cookie = await _sign_in(w, "op_it")
    async with _new_client() as c:
        c.cookies.set("refresh_token", phone_cookie)
        assert (await c.post("/api/auth/logout")).status_code == 204
    rows = await _rows(w["op_it"])
    assert len(rows) == 2 and all(r.revoked_reason == "signed out" for r in rows)
    assert (await _refresh(pc_cookie)).status_code == 401
    assert (await _refresh(phone_cookie)).status_code == 401
    assert not await _reuse_rows()                                     # an ended session is not "theft"


async def test_a_password_change_revokes_the_old_records_and_opens_one_for_this_device():
    w = await build_world()
    headers, old_cookie = await _sign_in(w, "op_it")
    _, other_device = await _sign_in(w, "op_it")
    async with _new_client() as c:
        answer = await c.post("/api/auth/change-password", headers=headers,
                              json={"old_password": PASSWORD, "new_password": "Brand-New#Pass26"})
    assert answer.status_code == 204 and answer.content == b""
    new_cookie = answer.cookies["refresh_token"]
    rows = await _rows(w["op_it"])
    assert [r.revoked_reason for r in rows] == ["password changed", "password changed", None]
    assert _claims(new_cookie)["sid"] == rows[-1].id
    assert (await _refresh(old_cookie)).status_code == 401
    assert (await _refresh(other_device)).status_code == 401
    assert (await _refresh(new_cookie)).status_code == 200
    assert not await _reuse_rows()


async def _reset(c, w, owner):
    assert (await c.post(f"/api/asset-users/{w['op_both']}/reset-password", headers=owner)).status_code == 200


async def _role(c, w, owner):
    assert (await c.put(f"/api/asset-users/{w['op_both']}", headers=owner, json={"role": "VIEWER"})).status_code == 200


async def _work_area(c, w, owner):
    resp = await c.put(f"/api/asset-users/{w['op_both']}", headers=owner, json={"allowed_asset_domains": "IT"})
    assert resp.status_code == 200


async def _company_access(c, w, owner):
    resp = await c.post(f"/api/asset-users/{w['op_both']}/company-access", headers=owner, json={"company_ids": [w["co_b"]]})
    assert resp.status_code == 204


@pytest.mark.parametrize("event", [_reset, _role, _work_area, _company_access])
async def test_an_admin_change_revokes_the_records_without_a_reuse_alarm(event):
    w = await build_world()
    _, cookie = await _sign_in(w, "op_both")
    owner, _ = await _sign_in(w, "owner")
    async with _new_client() as c:
        await event(c, w, owner)
    [row] = await _rows(w["op_both"])
    assert row.revoked_at is not None and row.revoked_reason
    assert (await _refresh(cookie)).status_code == 401
    assert not await _reuse_rows()


async def test_an_expired_session_is_refused_without_ending_anything_else():
    w = await build_world()
    _, cookie = await _sign_in(w, "op_it")
    _, other = await _sign_in(w, "op_it")
    before = await _version(w["op_it"])
    await _set_row(_claims(cookie)["sid"], expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    resp = await _refresh(cookie)
    assert resp.status_code == 401
    assert await _version(w["op_it"]) == before and not await _reuse_rows()
    [failed] = await audit(AuditLog.action == "TOKEN_REFRESH_FAILED")
    assert failed.changes["reason"] == "the session has expired"
    assert (await _refresh(other)).status_code == 200                  # the other device carries on


# ------------------------------------------------------------------ before this release / several devices


def _legacy(user_id: int, *, with_jti: bool) -> str:
    payload = {"sub": str(user_id), "type": "refresh", "tv": 0,
               "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    if with_jti:
        payload["jti"] = "legacy-jti-value-1234"
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@pytest.mark.parametrize("with_jti", [False, True])
async def test_a_token_from_before_this_release_upgrades_once(with_jti):
    w = await build_world()
    legacy = _legacy(w["op_it"], with_jti=with_jti)
    first = await _refresh(legacy)
    assert first.status_code == 200
    upgraded = _set_cookie(first)
    assert upgraded and "sid" in _claims(upgraded)
    [row] = await _rows(w["op_it"])
    assert row.id == _claims(upgraded)["sid"] and row.legacy_token_hash and row.revoked_at is None
    twin = await _refresh(legacy)                                      # a second tab at the deploy moment
    assert twin.status_code == 200 and _set_cookie(twin) is None
    assert (await _refresh(upgraded)).status_code == 200               # the upgraded session carries on
    # the old token coming back later is reuse
    await _set_row(row.id, previous_valid_until=datetime.now(timezone.utc) - timedelta(seconds=1))
    assert (await _refresh(legacy)).status_code == 401
    [reuse] = await _reuse_rows()
    assert reuse.changes["legacy"] is True and reuse.changes["session"] == row.id


async def test_parallel_first_uses_of_one_old_token_make_one_session():
    w = await build_world()
    legacy = _legacy(w["op_it"], with_jti=False)
    answers = await asyncio.gather(*(_refresh(legacy) for _ in range(5)))
    assert [a.status_code for a in answers] == [200] * 5
    assert len([a for a in answers if _set_cookie(a)]) == 1
    assert len(await _rows(w["op_it"])) == 1


async def test_two_sign_ins_are_two_independent_sessions():
    w = await build_world()
    _, phone = await _sign_in(w, "op_it")
    _, pc = await _sign_in(w, "op_it")
    assert _claims(phone)["sid"] != _claims(pc)["sid"]
    newest = phone
    for _ in range(3):
        newest = _set_cookie(await _refresh(newest))
    pc_resp = await _refresh(pc)                                       # untouched by the phone's renewals
    assert pc_resp.status_code == 200 and _set_cookie(pc_resp)
    rows = await _rows(w["op_it"])
    assert len(rows) == 2 and all(r.revoked_at is None for r in rows)
    assert not await _reuse_rows()


# ------------------------------------------------------------------ no token material anywhere


async def test_no_token_or_token_id_is_stored_logged_or_in_the_diagnostics_bundle():
    w = await build_world()
    owner, owner_cookie = await _sign_in(w, "owner")
    headers, cookie = await _sign_in(w, "op_it")
    issued = [owner_cookie, cookie, headers["Authorization"].split()[1]]
    r1 = await _refresh(cookie)
    issued += [_set_cookie(r1), r1.json()["access_token"]]
    twin = await _refresh(cookie)                                      # duplicate
    issued.append(twin.json()["access_token"])
    r2 = await _refresh(_set_cookie(r1))
    issued += [_set_cookie(r2), r2.json()["access_token"]]
    assert (await _refresh(cookie)).status_code == 401                 # reuse
    legacy = _legacy(w["viewer_it"], with_jti=True)
    issued += [legacy, _set_cookie(await _refresh(legacy))]
    async with _new_client() as c:
        bundle = await c.get("/api/admin/diagnostics/bundle", headers=owner, params={"hours": 2})
    assert bundle.status_code == 200, bundle.text
    flush_logs()
    async with SessionLocal() as s:
        stored = as_text((await s.execute(select(AuthSession))).scalars().all())
    places = {"auth_session": stored, "logs": await everything_logged(), "bundle": json.dumps(bundle.json())}
    secrets_ = [t for t in issued if t] + [_claims(t)["jti"] for t in issued if t and "jti" in _claims(t)]
    for where, text in places.items():
        for secret in secrets_:
            assert secret not in text, (where, secret[:12])
    assert {"REFRESH_DUPLICATE", "REFRESH_REUSE"} <= {r.action for r in await audit()}


async def test_long_expired_session_records_are_removed_by_the_daily_job():
    w = await build_world()
    _, old = await _sign_in(w, "op_it")
    _, recent = await _sign_in(w, "op_it")
    now = datetime.now(timezone.utc)
    await _set_row(_claims(old)["sid"], expires_at=now - timedelta(days=31))
    await _set_row(_claims(recent)["sid"], expires_at=now - timedelta(days=1))
    result = await purge_old_logs(now=now)
    assert result["auth_session"] == 1
    assert [r.id for r in await _rows(w["op_it"])] == [_claims(recent)["sid"]]
