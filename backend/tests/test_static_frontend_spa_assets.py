"""CL2-IF-04 (closure WP-F): in single-port production the frontend's own pages under /assets/ -- Asset 360
`/assets/<id>`, the address every printed QR label encodes, and `/assets/new` -- must open the SPA shell, not a
JSON 404, WITHOUT weakening IF-01 / IF-01-WIN: every traversal / UNC / drive / stream / device / over-long name and
every missing built file (a dot in the name: `.js`, `.css`, `.map`, fonts) is still the same plain 404, and a
refused name still never reaches the filesystem.

The route-table test reads the real frontend/src/router.tsx. Inside the dev api container only backend/ is
present: copy it first (`docker compose cp frontend/src/router.tsx api:/app/frontend-router.tsx`) or set
CKAM_FRONTEND_ROUTER; without it that one test is skipped and says why (the fixed list below always runs)."""
import os
import re
from pathlib import Path

import pytest

from app.core import static_safety
from app.core.config import settings
from tests.test_static_frontend_windows import REFUSED, SHELL, _dist, _raw_get, _without_request_id

APP_ROUTES = ["/assets/123", "/assets/42", "/assets/1", "/assets/new", "/assets/123/edit", "/assets/abc_DEF-9",
              "/assets/a/b/c"]
STILL_404 = ["/assets/does-not-exist.js", "/assets/index-AbC_123-x.js.map", "/assets/missing.css", "/assets/x.map",
             "/assets/fonts/missing.woff2", "/assets/a/b/c/d", "/assets/" + "a" * 65, "/assets/1.5", "/assets/new.",
             "/assets/123/", "/assets//123", "/assets/", "/assets/12 3", "/assets/12%253", "/assets/1:2"]


@pytest.fixture
def dist(tmp_path):
    folder = _dist(tmp_path)
    settings.frontend_dist_dir = str(folder)
    yield folder
    settings.frontend_dist_dir = None


@pytest.mark.parametrize("path", APP_ROUTES)
async def test_an_application_address_under_assets_is_the_spa_shell(client, dist, path):
    resp = await client.get(path)
    assert resp.status_code == 200 and resp.text == SHELL, path
    assert resp.headers["cache-control"] == "no-cache"
    assert resp.headers["content-type"].startswith("text/html")
    assert resp.headers["x-request-id"] and resp.headers["content-security-policy"]


async def test_a_scanned_label_with_a_query_string_opens_the_shell(client, dist):
    resp = await client.get("/assets/123?from=qr")
    assert resp.status_code == 200 and resp.text == SHELL


@pytest.mark.parametrize("path", STILL_404)
async def test_a_missing_built_file_or_a_non_route_name_stays_the_plain_404(dist, path):
    status, _h, body = await _raw_get(path)
    assert status == 404, (path, status)
    assert b"shell" not in body


async def test_every_refused_and_every_404_name_is_still_the_identical_plain_404(dist):
    bodies = set()
    for payload in REFUSED:
        status, _h, body = await _raw_get("/assets/" + payload)
        assert status == 404, payload
        assert b"TOP-SECRET" not in body and b"shell" not in body, payload
        bodies.add(_without_request_id(body))
    for path in STILL_404:
        status, _h, body = await _raw_get(path)
        assert status == 404, path
        bodies.add(_without_request_id(body))
    assert len(bodies) == 1, bodies


async def test_device_names_that_look_like_routes_are_still_refused_before_the_shell(dist):
    """`CON`, `nul`, `Com1`, `lpt9` match the route pattern; the lexical Windows check runs first and refuses them."""
    for name in ("CON", "con", "nul", "Com1", "lpt9", "AUX", "sub/CON", "PRN/x"):
        status, _h, body = await _raw_get("/assets/" + name)
        assert status == 404 and b"shell" not in body, name


async def test_legitimate_hashed_assets_are_still_files_with_their_content_type(client, dist):
    js = await client.get("/assets/index-AbC_123-x.js")
    assert js.status_code == 200 and js.text == "console.log('hashed');"
    assert js.headers["content-type"].startswith(("text/javascript", "application/javascript"))
    css = await client.get("/assets/index-AbC_123-x.css")
    assert css.status_code == 200 and css.headers["content-type"].startswith("text/css")
    font = await client.get("/assets/fonts/inter-AbC_9.woff2")
    assert font.status_code == 200 and font.content == b"wOF2"
    assert (await client.get("/assets/ok.js")).text == "ok"


async def test_head_on_an_application_address_behaves_like_the_shell_route(client, dist):
    """HEAD is answered exactly like HEAD on any other SPA page (same status), never with a file or a secret."""
    shell_head = await client.head("/some/client/route")
    for path in ("/assets/123", "/assets/new"):
        resp = await client.head(path)
        assert resp.status_code == shell_head.status_code, (path, resp.status_code, shell_head.status_code)
        assert "TOP-SECRET" not in resp.text


@pytest.fixture
def filesystem_guard(dist, monkeypatch):
    """Records every filesystem path the route looks at; nothing but the folder and index.html may appear for an
    application address, and nothing built from the URL text for a refused name."""
    seen: list[str] = []
    real_stat, real_realpath = os.stat, os.path.realpath

    def guarded_stat(path, *a, **k):
        seen.append(os.fspath(path))
        return real_stat(path, *a, **k)

    def guarded_realpath(path, *a, **k):
        seen.append(os.fspath(path))
        return real_realpath(path, *a, **k)

    def boom(self, *a, **k):
        raise AssertionError(f"filesystem touched for {self!s}")

    monkeypatch.setattr(os, "stat", guarded_stat)
    monkeypatch.setattr(static_safety.os.path, "realpath", guarded_realpath)
    for name in ("resolve", "is_file", "exists", "lstat", "is_symlink"):
        monkeypatch.setattr(Path, name, boom)
    return seen


async def test_the_shell_branch_reads_only_index_html(dist, filesystem_guard):
    allowed = {str(dist), str(dist / "index.html")}
    for path in APP_ROUTES:
        filesystem_guard.clear()
        status, _h, body = await _raw_get(path)
        assert status == 200 and body == SHELL.encode(), path
        assert set(filesystem_guard) <= allowed, (path, filesystem_guard)


async def test_a_refused_name_still_never_reaches_the_filesystem(dist, filesystem_guard):
    allowed = {str(dist), str(dist / "assets")}
    for payload in ["..\\..\\shared\\.env", "\\\\server\\share\\x", "C:\\Windows\\win.ini", "C:foo", "ok.js::$DATA",
                    "CON", "nul.txt", "ok.js.", "PROGRA~1", "../dist-evil/x.txt", "a" * 5000, "Com1", "sub/CON",
                    "%2e%2e%2fsecret", "12%3", "x\x00"]:
        filesystem_guard.clear()
        status, _h, _body = await _raw_get("/assets/" + payload)
        assert status == 404, payload
        assert not [p for p in filesystem_guard if str(dist) in p and p not in allowed], (payload, filesystem_guard)


async def test_without_a_built_frontend_the_assets_addresses_stay_404(client):
    settings.frontend_dist_dir = None
    for path in ("/assets/123", "/assets/new", "/assets/x.js"):
        assert (await client.get(path)).status_code == 404


# ---------------------------------------------------------------- the frontend's real route table

def _find_router() -> Path | None:
    candidates = [Path(os.environ["CKAM_FRONTEND_ROUTER"])] if os.environ.get("CKAM_FRONTEND_ROUTER") else []
    candidates += [parent / "frontend" / "src" / "router.tsx" for parent in Path(__file__).resolve().parents]
    candidates.append(Path(__file__).resolve().parents[1] / "frontend-router.tsx")    # the api container's copy
    return next((c for c in candidates if c.is_file()), None)


def _route_paths(text: str) -> list[str]:
    return sorted(set(re.findall(r'\bpath:\s*"(/[^"]*)"', text)))


def _example(path: str) -> str:
    """A concrete address for a route pattern: `$id` / `$poId` become ids."""
    return re.sub(r"\$[A-Za-z_][A-Za-z0-9_]*", "123", path)


async def test_every_route_of_the_real_frontend_router_opens_the_shell(client, dist):
    router = _find_router()
    if router is None:
        pytest.skip("frontend/src/router.tsx not found: `docker compose cp frontend/src/router.tsx "
                    "api:/app/frontend-router.tsx` or set CKAM_FRONTEND_ROUTER")
    paths = _route_paths(router.read_text(encoding="utf-8"))
    assert "/assets/$id" in paths and "/assets/new" in paths and len(paths) > 20, paths
    under_assets = [p for p in paths if p.startswith("/assets/")]
    assert under_assets, paths
    for pattern in paths:
        for example in {_example(pattern), re.sub(r"\$[A-Za-z_][A-Za-z0-9_]*", "abc_DEF-9", pattern)}:
            resp = await client.get(example)
            assert resp.status_code == 200 and resp.text == SHELL, (pattern, example, resp.status_code)
            assert resp.headers["cache-control"] == "no-cache", example
    # No top-level frontend prefix may collide with an address the backend keeps for itself.
    backend_reserved = {"api", "docs", "redoc", "openapi.json"}
    prefixes = {p.strip("/").split("/")[0] for p in paths if p != "/"}
    assert not prefixes & backend_reserved, prefixes & backend_reserved
