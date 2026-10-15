"""Security AU-11 / AU-14 / AU-15 (VAPT 2026-10): no API map in production; a Content-Security-Policy and a
Permissions-Policy on every response of the app (API JSON, refusals, the SPA shell, its files)."""
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.main import docs_urls

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; "
       "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")
PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"


def _assert_headers(resp):
    assert resp.headers["Content-Security-Policy"] == CSP
    assert resp.headers["Permissions-Policy"] == PERMISSIONS
    assert resp.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert "Strict-Transport-Security" not in resp.headers


async def test_health_carries_the_policies(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    _assert_headers(resp)


async def test_a_refusal_carries_the_policies(client):
    resp = await client.get("/api/assets")
    assert resp.status_code == 401
    _assert_headers(resp)


async def test_the_spa_shell_and_its_files_carry_the_policies(client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "assets" / "index-abc.js").write_text("console.log(1);")
    (dist / "index.html").write_text("<html>shell</html>")
    settings.frontend_dist_dir = str(dist)
    try:
        shell = await client.get("/assets-list/123")
        assert shell.status_code == 200 and shell.text == "<html>shell</html>"
        _assert_headers(shell)
        _assert_headers(await client.get("/assets/index-abc.js"))
    finally:
        settings.frontend_dist_dir = None


@pytest.mark.parametrize("name", ["production", "prod", " Production "])
def test_production_has_no_api_docs(name):
    assert docs_urls(name) == {"docs_url": None, "redoc_url": None, "openapi_url": None}


@pytest.mark.parametrize("name", ["development", "uat", "", None])
def test_other_environments_keep_the_defaults(name):
    assert docs_urls(name) == {}


async def test_a_production_app_answers_404_for_the_docs():
    prod = FastAPI(**docs_urls("production"))
    async with AsyncClient(transport=ASGITransport(app=prod), base_url="http://test") as c:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await c.get(path)).status_code == 404


async def test_development_still_serves_the_openapi_document(client):
    assert (await client.get("/openapi.json")).status_code == 200
