"""Security N2 (closure WP-A1): the client address can never be chosen by the client.

* uvicorn itself must not rewrite the address from X-Forwarded-For: every launch command the repository controls
  carries `--no-proxy-headers` (uvicorn's default trusts X-Forwarded-For from 127.0.0.1, so a request from the
  server itself, or via a local tunnel, could otherwise pick any address).
* the app's own `client_ip` believes X-Forwarded-For only from a TRUSTED_PROXIES address (default: none);
* so the sign-in rate limit and the audit rows' address cannot be dodged with a forged header."""
import re
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.datastructures import Headers

from app.core import rate_limit
from app.core.config import settings
from app.main import app
from app.observability import middleware
from app.observability.middleware import client_ip
from app.observability.models import AuditLog
from tests.core.s0_world import PASSWORD, build_world
from tests.observability.helpers import audit

BACKEND = Path(__file__).resolve().parents[2]


def _scope(peer: str | None) -> dict:
    return {"type": "http", "client": (peer, 50000) if peer else None}


def _ip(peer, forwarded=None):
    headers = Headers({"x-forwarded-for": forwarded} if forwarded is not None else {})
    return client_ip(_scope(peer), headers)


@pytest.fixture
def proxies(monkeypatch):
    def set_to(value: str):
        monkeypatch.setattr(settings, "trusted_proxies", value)
        middleware._trusted_networks.cache_clear()
    yield set_to
    middleware._trusted_networks.cache_clear()


# ---------------------------------------------------------------- the launch command

def _uvicorn_lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if "uvicorn" in line and "app.main:app" in line
            and not line.lstrip().startswith("#")]


def test_the_docker_image_starts_uvicorn_without_proxy_headers():
    dockerfile = BACKEND / "Dockerfile"
    if not dockerfile.is_file():
        pytest.skip("backend/Dockerfile is not inside this image; the running-process test below covers the image")
    lines = _uvicorn_lines(dockerfile.read_text(encoding="utf-8"))
    assert len(lines) == 2, "expected the uvicorn CMD of both targets (dev and runtime) in backend/Dockerfile"
    for line in lines:
        assert "--no-proxy-headers" in line and "--proxy-headers" not in line.replace("--no-proxy-headers", ""), line
        # CL2-IF-OBS-05: no "server: uvicorn" product header.
        assert "--no-server-header" in line, line


def test_the_windows_reference_launcher_keeps_both_uvicorn_flags():
    """ops/windows/run_ckam_web.ps1.template (production's single-port launcher): N2 and CL2-IF-OBS-05."""
    template = next((p / "ops" / "windows" / "run_ckam_web.ps1.template" for p in (BACKEND, *BACKEND.parents)
                     if (p / "ops" / "windows" / "run_ckam_web.ps1.template").is_file()), None)
    if template is None:
        pytest.skip("ops/windows is not here (inside the api container: `docker compose cp ops api:/app/`)")
    lines = _uvicorn_lines(template.read_text(encoding="utf-8"))
    args = [line for line in lines if "$uvicornArgs =" in line]
    assert len(args) == 1, lines
    assert "--no-proxy-headers" in args[0] and "--no-server-header" in args[0], args[0]
    assert "--proxy-headers" not in args[0].replace("--no-proxy-headers", ""), args[0]


def test_every_launch_script_in_the_repository_keeps_proxy_headers_off():
    """Any launcher the repository carries (the Windows reference launcher once it exists, shell scripts)."""
    root = BACKEND.parent
    if not (root / "docker-compose.yml").is_file():
        pytest.skip("not run from a repository checkout")
    for pattern in ("*.ps1", "*.sh", "*.bat", "*.cmd", "docker-compose*.yml"):
        for path in root.rglob(pattern):
            if "node_modules" in path.parts or ".git" in path.parts:
                continue
            for line in _uvicorn_lines(path.read_text(encoding="utf-8", errors="replace")):
                assert "--no-proxy-headers" in line, f"{path}: {line.strip()}"


def test_the_running_api_process_in_docker_has_proxy_headers_off():
    """Inside the Docker image the server is PID 1; its real command line must carry the flag."""
    cmdline = Path("/proc/1/cmdline")
    if not cmdline.is_file():
        pytest.skip("not running inside the API container")
    args = cmdline.read_bytes().split(b"\x00")
    if not any(b"uvicorn" in a for a in args):
        pytest.skip("PID 1 is not uvicorn here")
    assert b"--no-proxy-headers" in args and b"--proxy-headers" not in args


def test_proxy_headers_are_not_switched_on_anywhere_in_the_app_code():
    for path in (BACKEND / "app").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"proxy_headers\s*=\s*True", text), path
        assert "ProxyHeadersMiddleware" not in text, path
        assert "uvicorn.run(" not in text, path


# ---------------------------------------------------------------- client_ip

FORGED = ["1.2.3.4", "1.2.3.4, 5.6.7.8", "  9.9.9.9 ,10.0.0.1", "2001:db8::1", "2001:db8::1, ::1", "garbage",
          "1.2.3.4, garbage", "", ",,,", "127.0.0.1", "unknown, 203.0.113.9", ("1.2.3.4," * 5000) + "8.8.8.8",
          "999.999.999.999", "1.2.3.4\r\nX-Evil: 1", "[::1]:443"]


@pytest.mark.parametrize("forwarded", FORGED)
@pytest.mark.parametrize("peer", ["198.51.100.20", "127.0.0.1", "::1", "10.0.1.98"])
def test_without_trusted_proxies_the_header_never_changes_the_address(proxies, peer, forwarded):
    proxies("")
    assert _ip(peer, forwarded) == peer


@pytest.mark.parametrize("forwarded", FORGED)
def test_with_a_trusted_proxy_only_that_proxy_may_name_the_client(proxies, forwarded):
    proxies("10.0.0.5, 192.168.10.0/24")
    assert _ip("198.51.100.20", forwarded) == "198.51.100.20"          # not a proxy: header ignored
    assert _ip("127.0.0.1", forwarded) == "127.0.0.1"                  # loopback is not trusted unless listed


def test_a_trusted_proxy_names_the_right_most_untrusted_address(proxies):
    proxies("10.0.0.5, 192.168.10.0/24")
    assert _ip("10.0.0.5", "1.2.3.4") == "1.2.3.4"
    assert _ip("192.168.10.77", "1.2.3.4, 5.6.7.8") == "5.6.7.8"        # the client cannot prepend itself
    assert _ip("10.0.0.5", "5.6.7.8, 192.168.10.3") == "5.6.7.8"       # skips the proxy chain
    assert _ip("10.0.0.5", "2001:db8::1") == "2001:db8::1"
    assert _ip("10.0.0.5", "garbage") == "10.0.0.5"                    # garbage: the proxy's own address
    assert _ip("10.0.0.5", "1.2.3.4, garbage") == "10.0.0.5"
    assert _ip("10.0.0.5", "") == "10.0.0.5"
    assert _ip("10.0.0.5", None) == "10.0.0.5"
    assert _ip("10.0.0.5", "10.0.0.5, 192.168.10.9") == "10.0.0.5"     # only proxies: the connecting one


def test_a_bad_trusted_proxies_entry_is_ignored_not_trusted(proxies):
    proxies("not-an-ip, ")
    assert _ip("198.51.100.20", "1.2.3.4") == "198.51.100.20"


def test_no_connection_address_stays_none(proxies):
    proxies("")
    assert _ip(None, "1.2.3.4") is None


# ---------------------------------------------------------------- the rate limit and the audit rows

@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    rate_limit.reset()
    yield
    rate_limit.reset()


def _from(ip: str) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app, client=(ip, 50000)), base_url="http://test")


@pytest.mark.parametrize("peer", ["127.0.0.1", "198.51.100.20"])
async def test_a_forged_header_from_loopback_or_outside_cannot_buy_fresh_sign_in_attempts(proxies, limits_on, peer):
    proxies("")
    await build_world()
    async with _from(peer) as c:
        for i in range(20):
            resp = await c.post("/api/auth/login", json={"login_id": f"nobody{i}", "password": "Wrong#Guess1"},
                                headers={"X-Forwarded-For": f"203.0.113.{i}, 198.18.0.{i}"})
            assert resp.status_code == 401
        refused = await c.post("/api/auth/login", json={"login_id": "S0OPIT", "password": PASSWORD},
                               headers={"X-Forwarded-For": "2001:db8::77"})
    assert refused.status_code == 429
    assert {k for k in rate_limit._hits if ":ip:" in k} == {f"login:ip:{peer}"}     # one key: the real peer
    rows = await audit(AuditLog.action == "LOGIN_FAILED")
    assert rows and {r.ip for r in rows} == {peer}
    [limited] = await audit(AuditLog.action == "RATE_LIMITED")
    assert limited.ip == peer


async def test_a_trusted_proxy_keeps_separate_limits_per_real_client(proxies, limits_on, monkeypatch):
    proxies("10.0.0.5")
    monkeypatch.setattr(settings, "rate_limit_login_per_ip", 2)
    await build_world()
    async with _from("10.0.0.5") as c:
        for _ in range(2):
            assert (await c.post("/api/auth/login", json={"login_id": "nobody", "password": "x"},
                                 headers={"X-Forwarded-For": "203.0.113.1"})).status_code == 401
        assert (await c.post("/api/auth/login", json={"login_id": "nobody2", "password": "x"},
                             headers={"X-Forwarded-For": "203.0.113.1"})).status_code == 429
        other = await c.post("/api/auth/login", json={"login_id": "S0OPIT", "password": PASSWORD},
                             headers={"X-Forwarded-For": "203.0.113.2"})
    assert other.status_code == 200
