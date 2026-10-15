"""Security AU-03 / AU-04 (VAPT 2026-10): sign-in, session renewal and password change are rate limited per client
address (and sign-in also per login id), with a plain 429 answer, a Retry-After header and a security row."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import rate_limit
from app.core.config import settings
from app.main import app
from app.observability.models import AuditLog
from tests.core.s0_world import PASSWORD, build_world, login
from tests.observability.helpers import audit, everything_logged

TOO_MANY = "Too many sign-in attempts. Wait a minute and try again."


@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    rate_limit.reset()
    yield
    rate_limit.reset()


def _from(ip: str) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app, client=(ip, 50000)), base_url="http://test")


async def test_the_twenty_first_sign_in_from_one_address_in_a_minute_is_refused(client, limits_on):
    await build_world()
    for i in range(20):
        resp = await client.post("/api/auth/login", json={"login_id": f"nobody{i}", "password": "Wrong#Guess1"})
        assert resp.status_code == 401
    refused = await client.post("/api/auth/login", json={"login_id": "S0OPIT", "password": PASSWORD})
    assert refused.status_code == 429
    body = refused.json()
    assert body["detail"] == TOO_MANY and body["errors"] == [TOO_MANY] and body["request_id"]
    assert 1 <= int(refused.headers["retry-after"]) <= 60
    [row] = await audit(AuditLog.action == "RATE_LIMITED")
    assert (row.category, row.outcome) == ("SECURITY", "DENIED")
    assert row.changes["endpoint"] == "login" and row.changes["limited_by"] == "from one address"
    assert "Wrong#Guess1" not in await everything_logged() and PASSWORD not in await everything_logged()


async def test_one_login_id_is_limited_whatever_address_the_guesses_come_from(client, limits_on):
    await build_world()
    for i in range(10):
        async with _from(f"10.9.0.{i + 1}") as c:
            assert (await c.post("/api/auth/login", json={"login_id": "S0ADM", "password": f"Wrong#{i}"})).status_code in (401, 423)   # 423 once the lock engaged (5 wrong guesses)
    async with _from("10.9.0.99") as c:
        resp = await c.post("/api/auth/login", json={"login_id": " s0adm ", "password": PASSWORD})
    assert resp.status_code == 429 and resp.json()["detail"] == TOO_MANY
    [row] = await audit(AuditLog.action == "RATE_LIMITED")
    assert row.changes["limited_by"] == "for one login id" and row.changes["login_id"] == "s0adm"
    async with _from("10.9.0.100") as c:                         # other people are not affected
        assert (await c.post("/api/auth/login", json={"login_id": "S0OPIT", "password": PASSWORD})).status_code == 200


async def test_a_forged_forwarded_for_header_does_not_buy_new_attempts(client, limits_on):
    await build_world()
    for i in range(20):
        await client.post("/api/auth/login", json={"login_id": f"x{i}", "password": "nope-nope"},
                          headers={"X-Forwarded-For": f"203.0.113.{i}"})
    resp = await client.post("/api/auth/login", json={"login_id": "S0OPIT", "password": PASSWORD},
                             headers={"X-Forwarded-For": "198.51.100.7"})
    assert resp.status_code == 429


async def test_the_window_slides_and_old_requests_stop_counting(limits_on):
    for _ in range(3):
        assert rate_limit.hit("k", 3, 60, now=1000.0) is None
    assert rate_limit.hit("k", 3, 60, now=1010.0) == 50
    assert rate_limit.hit("k", 3, 60, now=1060.5) is None


async def test_memory_stays_bounded(limits_on, monkeypatch):
    monkeypatch.setattr(rate_limit, "MAX_KEYS", 100)
    for i in range(1000):
        rate_limit.hit(f"ip:{i}", 5, 60, now=2000.0 + i * 0.001)
    assert len(rate_limit._hits) <= 101
    rate_limit.hit("late", 5, 60, now=5000.0)                    # everything older than the window is swept
    assert list(rate_limit._hits) == ["late"]


async def test_refresh_and_change_password_have_their_own_limits(client, limits_on, monkeypatch):
    w = await build_world()
    monkeypatch.setattr(settings, "rate_limit_refresh_per_ip", 2)
    monkeypatch.setattr(settings, "rate_limit_change_password_per_ip", 2)
    h = await login(client, w, "op_it")
    assert (await client.post("/api/auth/refresh")).status_code == 200
    assert (await client.post("/api/auth/refresh")).status_code == 200
    third = await client.post("/api/auth/refresh")
    assert third.status_code == 429 and "retry-after" in third.headers
    for _ in range(2):
        assert (await client.post("/api/auth/change-password", headers=h,
                                  json={"old_password": "wrong", "new_password": "Green#Ladder2026"})).status_code == 400
    blocked = await client.post("/api/auth/change-password", headers=h,
                                json={"old_password": PASSWORD, "new_password": "Green#Ladder2026"})
    assert blocked.status_code == 429


async def test_switched_off_means_no_limit(client):
    await build_world()
    assert settings.rate_limit_enabled is False                   # the suite default (tests/conftest.py)
    for i in range(30):
        assert (await client.post("/api/auth/login", json={"login_id": f"n{i}", "password": "x"})).status_code == 401
