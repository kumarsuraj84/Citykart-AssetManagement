"""Security AU-01 / AU-02 / AU-16 (VAPT 2026-10): sign-in must not tell which login ids exist or are locked --
by status or by time -- and parallel wrong guesses must not get past the lock-out threshold."""
import asyncio
from datetime import datetime, timedelta, timezone

import argon2
import pytest
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Department, Location
from app.observability.models import AuditLog
from tests.observability.helpers import audit

PW = "Right#Horse2026"


async def _people(**extra_users) -> dict:
    async with SessionLocal() as s:
        co = Company(code="VAPT-L", name="VAPT Login Co")
        s.add(co)
        await s.flush()
        loc = Location(company_id=co.id, code="VAPT-L-HO", name="HO")
        dept = Department(name="VAPT-L-DEPT")
        s.add_all([loc, dept])
        await s.flush()
        h = hash_password(PW)

        def user(code, **kw):
            base = dict(company_id=co.id, code=code, name=f"Person {code}", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="VIEWER", login_enabled=True,
                        password_hash=h, must_change_password=False)
            base.update(kw)
            return AssetUser(**base)

        users = {
            "ok": user("VLOK"),
            "disabled": user("VLDIS", is_active=False),
            "nologin": user("VLNOLOG", login_enabled=False),
            "locked": user("VLLOCK", failed_login_count=5,
                           locked_until=datetime.now(timezone.utc) + timedelta(minutes=15)),
            "race": user("VLRACE"),
        }
        s.add_all(users.values())
        await s.commit()
        return {k: (u.id, u.code) for k, u in users.items()}


async def _login(client, login_id, password=PW):
    return await client.post("/api/auth/login", json={"login_id": login_id, "password": password})


async def _user(user_id) -> AssetUser:
    async with SessionLocal() as s:
        return await s.get(AssetUser, user_id)


@pytest.fixture
def argon2_calls(monkeypatch):
    """Counts every Argon2 verification (the ~40 ms step whose absence used to give the answer away)."""
    calls = []
    original = argon2.PasswordHasher.verify

    def counting(self, hash_, password):
        calls.append(1)
        return original(self, hash_, password)

    monkeypatch.setattr(argon2.PasswordHasher, "verify", counting)
    return calls


@pytest.mark.parametrize("who", ["unknown", "disabled", "nologin"])
async def test_every_refused_sign_in_does_the_same_password_work(client, argon2_calls, who):
    ids = await _people()
    login_id = "nobody-here" if who == "unknown" else ids[who][1]
    resp = await _login(client, login_id, "Wrong#Guess2026")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"
    assert len(argon2_calls) == 1


async def test_an_ambiguous_login_id_also_does_the_password_work(client, argon2_calls):
    await _people()
    async with SessionLocal() as s:
        co2 = Company(code="VAPT-L2", name="VAPT Login Co 2")
        s.add(co2)
        await s.flush()
        loc2 = Location(company_id=co2.id, code="VAPT-L2-HO", name="HO")
        s.add(loc2)
        await s.flush()
        s.add(AssetUser(company_id=co2.id, code="VLOK", name="Twin", asset_user_type="EMPLOYEE", location_id=loc2.id,
                        role="VIEWER", login_enabled=True, password_hash=hash_password(PW), must_change_password=False))
        await s.commit()
    resp = await _login(client, "VLOK")
    assert resp.status_code == 401 and len(argon2_calls) == 1


async def test_a_locked_account_says_locked_for_any_password_so_the_lock_is_no_guessing_oracle(client, argon2_calls):
    """Lead decision (AU-02 accepted as LOW): wrong and right passwords get the SAME answer on a locked account,
    and the same amount of work. Answering 'locked' only to the right password would let an attacker recognise a
    correct guess while the account is locked and make the lock useless against guessing."""
    ids = await _people()
    before = await _user(ids["locked"][0])
    wrong = await _login(client, ids["locked"][1], "Wrong#Guess2026")
    right = await _login(client, ids["locked"][1])
    assert (wrong.status_code, wrong.json()["detail"]) == (right.status_code, right.json()["detail"]) == (423, "Account locked, try again later")
    assert len(argon2_calls) == 2                                     # one password check per attempt, either way
    after = await _user(ids["locked"][0])
    assert (after.failed_login_count, after.locked_until) == (before.failed_login_count, before.locked_until)
    rows = await audit(AuditLog.action == "LOGIN_FAILED")
    assert [r.changes["reason"] for r in rows] == ["locked", "locked"]


async def test_a_locked_account_and_the_right_password_still_says_locked(client):
    ids = await _people()
    resp = await _login(client, ids["locked"][1])
    assert resp.status_code == 423 and resp.json()["detail"] == "Account locked, try again later"
    [row] = await audit(AuditLog.action == "LOGIN_FAILED")
    assert row.changes["reason"] == "locked"


async def test_once_the_lock_has_run_out_the_right_password_signs_in(client):
    ids = await _people()
    async with SessionLocal() as s:
        u = await s.get(AssetUser, ids["locked"][0])
        u.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)
        await s.commit()
    resp = await _login(client, ids["locked"][1])
    assert resp.status_code == 200
    u = await _user(ids["locked"][0])
    assert (u.failed_login_count, u.locked_until) == (0, None)


async def test_twenty_parallel_wrong_guesses_stop_at_the_threshold(client):
    ids = await _people()
    race_id, race_code = ids["race"]
    results = await asyncio.gather(*(_login(client, race_code, f"Wrong#Guess{i:02d}") for i in range(20)))
    assert all(r.status_code in (401, 423) for r in results)   # 423 for guesses that arrive after the lock engaged
    u = await _user(race_id)
    assert u.failed_login_count == 5                                      # exactly the threshold, not 20
    assert u.locked_until is not None and u.locked_until > datetime.now(timezone.utc)
    counted = [r for r in await audit(AuditLog.action == "LOGIN_FAILED") if r.changes.get("reason") == "wrong password"]
    assert sorted(r.changes["attempt"] for r in counted) == [1, 2, 3, 4, 5]
    assert len(await audit(AuditLog.action == "LOCKED")) == 1
    # and the right password is now refused as "locked"
    assert (await _login(client, race_code)).status_code == 423


async def test_the_lock_threshold_is_the_same_one_by_one(client):
    ids = await _people()
    for i in range(5):
        assert (await _login(client, ids["race"][1], f"Wrong#{i}")).status_code == 401
    assert (await _login(client, ids["race"][1], "Wrong#again")).status_code == 423       # a lock is a lock for any password
    assert (await _login(client, ids["race"][1])).status_code == 423
    async with SessionLocal() as s:
        assert (await s.execute(select(AssetUser.failed_login_count).where(AssetUser.id == ids["race"][0]))).scalar_one() == 5
