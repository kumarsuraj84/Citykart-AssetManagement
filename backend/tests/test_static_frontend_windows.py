"""Security IF-01-WIN and N6 (closure WP-A1).

IF-01-WIN: production serves the built frontend from ONE uvicorn process on WINDOWS. These tests run on Linux, so
Windows path behaviour is EMULATED: Windows-style inputs (backslashes, UNC, drive letters, alternate data streams,
device names, trailing dots / spaces, 8.3 short names) go through the pure lexical check (also cross-checked with
`PureWindowsPath`, i.e. Windows' own parsing rules) and through the real HTTP route, and every refusal must happen
before ANY filesystem call (on Windows a mere stat of `\\\\host\\share` contacts that host over SMB).

N6: in single-port mode an /api address that no API route serves is a JSON 404 in the usual envelope, never the
SPA shell with 200."""
import ntpath
import os
from pathlib import Path, PureWindowsPath

import pytest

from app.core import static_safety
from app.core.config import settings
from app.core.errors import NO_SUCH_API
from app.core.static_safety import is_safe_relative_name, safe_asset_path
from app.main import app

SHELL = "<html>shell</html>"

# Decoded path texts (what the route receives after Starlette's single percent-decoding).
REFUSED = [
    "..\\secret.txt", "..\\..\\shared\\.env", "..%5csecret.txt", "%2e%2e%5csecret.txt", "..\\", "a/..\\b",
    "..%2fsecret.txt", "%2e%2e/secret.txt", "../secret-in-dist.txt", "../../shared/.env", "./ok.js", "a/./ok.js",
    "a//ok.js", "ok.js/", "/etc/passwd", "//server/share/x", "\\\\server\\share\\x", "%5c%5cserver%5cshare",
    "\\\\?\\C:\\Windows\\win.ini", "\\\\.\\PhysicalDrive0", "C:/Windows/win.ini", "C:\\Windows\\win.ini",
    "C:%2fWindows%2fwin.ini", "C:%5cWindows%5cwin.ini", "C:foo", "c:", "C:", "%252e%252e%252f", "%255c",
    "%2e%2e%2fsecret.txt", "ok.js::$DATA", "ok.js:stream", "ok.js.", "ok.js ", "ok.js..", " ok.js", "CON", "con",
    "PRN", "AUX", "NUL", "nul.txt", "AUX.js", "CON.tar.gz", "Com1", "COM9.js", "lpt1", "LPT9.log", "CONIN$",
    "sub/CON", "sub/nul.txt", "PROGRA~1", "PROGRA~1/x.js", "ok.js\x00.txt", "\x00", "", ".", "..", "...", ".env",
    "a" * 5000, "a" * 201, "../dist-evil/x.txt", "../dist/assets/ok.js", "ok js", "ok.js?x", "ok.js#x", "ok%00.js",
    "ok*.js", "ok<.js", "ok>.js", 'ok".js', "ok|.js", "\u00e9t\u00e9.js", "ok.js\u200b", "\uff0e\uff0e/x",
]

ACCEPTED = ["index-AbC_123-x.js", "index-abc123.css", "fonts/inter-latin-400-AbC_9.woff2", "logo.png",
            "vendor~chunk-1a2B.js", "a" * 200]


@pytest.mark.parametrize("payload", REFUSED)
def test_the_lexical_check_refuses_every_dangerous_form(payload):
    assert is_safe_relative_name(payload) is False


@pytest.mark.parametrize("payload", ACCEPTED)
def test_the_lexical_check_lets_real_vite_asset_names_through(payload):
    assert is_safe_relative_name(payload) is True


@pytest.mark.parametrize("payload", ACCEPTED)
def test_every_accepted_name_is_also_a_harmless_relative_name_under_windows_rules(payload):
    """Emulated Windows semantics: what passes has no drive, no root, no `..` and no device name for Windows."""
    win = PureWindowsPath(payload)
    assert not win.drive and not win.root and not win.anchor and ".." not in win.parts
    assert not win.is_absolute() and not ntpath.isreserved(payload)


@pytest.mark.parametrize("payload", [p for p in REFUSED if p and "\x00" not in p])
def test_whatever_windows_would_make_of_a_refused_name_it_is_refused(payload):
    """Cross-check: every name Windows itself would read as absolute / drive / UNC / parent / device is refused."""
    win = PureWindowsPath(payload)
    if win.drive or win.root or ".." in win.parts or ntpath.isreserved(payload):
        assert is_safe_relative_name(payload) is False


@pytest.fixture
def no_filesystem(monkeypatch):
    """Any filesystem call fails the test."""
    def boom(*_a, **_k):
        raise AssertionError("filesystem touched before the lexical check refused the name")
    for name in ("resolve", "is_file", "exists", "stat", "lstat", "is_symlink", "is_dir", "absolute"):
        monkeypatch.setattr(Path, name, boom)
    monkeypatch.setattr(static_safety.os.path, "realpath", boom)
    monkeypatch.setattr(static_safety.os, "stat", boom)
    monkeypatch.setattr(static_safety.os, "lstat", boom)


@pytest.mark.parametrize("payload", REFUSED)
def test_a_refused_name_never_reaches_the_filesystem(no_filesystem, payload):
    assert safe_asset_path(Path("/nonexistent-ckam/dist/assets"), payload) is None


def _dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets" / "fonts").mkdir(parents=True)
    (dist / "assets" / "ok.js").write_text("ok")
    (dist / "assets" / "index-AbC_123-x.js").write_text("console.log('hashed');")
    (dist / "assets" / "index-AbC_123-x.css").write_text("body{}")
    (dist / "assets" / "fonts" / "inter-AbC_9.woff2").write_bytes(b"wOF2")
    (dist / "index.html").write_text(SHELL)
    (dist / "favicon.svg").write_text("<svg/>")
    (dist / "secret-in-dist.txt").write_text("TOP-SECRET-DIST")
    (tmp_path / "shared").mkdir()
    (tmp_path / "shared" / ".env").write_text("JWT_SECRET=TOP-SECRET-ENV")
    (tmp_path / "dist-evil").mkdir()
    (tmp_path / "dist-evil" / "x.txt").write_text("TOP-SECRET-SIBLING")
    return dist


@pytest.fixture
def dist(tmp_path):
    folder = _dist(tmp_path)
    settings.frontend_dist_dir = str(folder)
    yield folder
    settings.frontend_dist_dir = None


def test_the_pure_function_serves_real_files_and_refuses_a_symlink_that_leaves_the_folder(tmp_path):
    folder = _dist(tmp_path)
    assets = folder / "assets"
    assert safe_asset_path(assets, "index-AbC_123-x.js") == (assets / "index-AbC_123-x.js").resolve()
    assert safe_asset_path(assets, "fonts/inter-AbC_9.woff2") is not None
    assert safe_asset_path(assets, "missing.js") is None
    assert safe_asset_path(assets, "fonts") is None                         # a folder is not a file
    os.symlink(tmp_path / "shared" / ".env", assets / "leak.js")
    os.symlink(tmp_path / "shared", assets / "linkdir")
    os.symlink(assets / "ok.js", assets / "inside-link.js")
    assert safe_asset_path(assets, "leak.js") is None
    assert safe_asset_path(assets, "linkdir/x.js") is None
    assert safe_asset_path(assets, "inside-link.js") is not None            # a link that stays inside is harmless


async def _raw_get(path: str, method: str = "GET") -> tuple[int, dict, bytes]:
    """Calls the app with an exact, already-decoded path (no client-side normalisation of `..` or `\\`)."""
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
             "path": path, "raw_path": path.encode("utf-8", "surrogatepass"), "root_path": "", "query_string": b"",
             "headers": [(b"host", b"test")], "client": ("127.0.0.1", 50000), "server": ("test", 80)}
    sent: list[dict] = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    start = next(m for m in sent if m["type"] == "http.response.start")
    headers = {k.decode().lower(): v.decode() for k, v in start["headers"]}
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], headers, body


def _without_request_id(body: bytes) -> bytes:
    import json
    data = json.loads(body)
    data.pop("request_id", None)
    return json.dumps(data, sort_keys=True).encode()


async def test_every_refused_name_is_the_same_plain_404_through_the_route(dist):
    bodies = set()
    for payload in REFUSED:
        status, _headers, body = await _raw_get("/assets/" + payload)
        assert status == 404, (payload, status)
        assert b"TOP-SECRET" not in body and b"shell" not in body, payload
        bodies.add(_without_request_id(body))
    status, _h, body = await _raw_get("/assets/does-not-exist.js")      # a missing real name: the same answer
    assert status == 404
    bodies.add(_without_request_id(body))
    assert len(bodies) == 1, bodies


@pytest.mark.parametrize("url", [
    "/assets/..%5csecret-in-dist.txt", "/assets/%2e%2e%5csecret-in-dist.txt", "/assets/..%5c..%5cshared%5c.env",
    "/assets/C:%2fWindows%2fwin.ini", "/assets/C:%5cWindows%5cwin.ini", "/assets/%5c%5cserver%5cshare",
    "/assets/%5c%5cserver%5cshare%5cx", "/assets/C:foo", "/assets/%252e%252e%252fsecret-in-dist.txt", "/assets/%255c",
    "/assets/ok.js::$DATA", "/assets/ok.js.", "/assets/ok.js%20", "/assets/CON", "/assets/nul.txt", "/assets/AUX.js",
    "/assets/PROGRA~1", "/assets/ok.js%00", "/assets/" + "a" * 5000,
    "/assets/%2e%2e%2fdist-evil%2fx.txt",
])
async def test_the_http_route_refuses_the_encoded_payloads(client, dist, url):
    resp = await client.get(url)
    assert "TOP-SECRET" not in resp.text
    assert resp.status_code == 404, (url, resp.status_code)


async def test_a_symlink_inside_assets_that_points_outside_is_404_through_the_route(client, dist, tmp_path):
    os.symlink(tmp_path / "shared" / ".env", dist / "assets" / "leak.js")
    resp = await client.get("/assets/leak.js")
    assert resp.status_code == 404 and "TOP-SECRET" not in resp.text


async def test_the_route_does_not_touch_the_filesystem_for_a_refused_name(dist, monkeypatch):
    """Only the configured folder itself may be looked at; never a path built from the refused URL text."""
    allowed = {str(dist), str(dist / "assets")}
    real_stat, real_realpath, real_is_dir = os.stat, os.path.realpath, Path.is_dir

    def guard(path):
        text = os.fspath(path)
        if str(dist) in text and text not in allowed:
            raise AssertionError(f"filesystem touched for {text!r}")

    def guarded_stat(path, *a, **k):
        guard(path)
        return real_stat(path, *a, **k)

    def guarded_realpath(path, *a, **k):
        guard(path)
        return real_realpath(path, *a, **k)

    def boom(self, *a, **k):
        raise AssertionError(f"filesystem touched for {self!s}")

    monkeypatch.setattr(os, "stat", guarded_stat)
    monkeypatch.setattr(static_safety.os.path, "realpath", guarded_realpath)
    for name in ("resolve", "is_file", "exists", "lstat", "is_symlink"):
        monkeypatch.setattr(Path, name, boom)
    monkeypatch.setattr(Path, "is_dir", lambda self, **k: real_is_dir(self, **k) if str(self) in allowed else boom(self))
    for payload in ["..\\..\\shared\\.env", "\\\\server\\share\\x", "C:\\Windows\\win.ini", "C:foo", "ok.js::$DATA",
                    "CON", "nul.txt", "ok.js.", "PROGRA~1", "../dist-evil/x.txt", "a" * 5000]:
        status, _h, body = await _raw_get("/assets/" + payload)
        assert status == 404, payload


async def test_legitimate_hashed_assets_are_served_with_their_content_type(client, dist):
    js = await client.get("/assets/index-AbC_123-x.js")
    assert js.status_code == 200 and js.text == "console.log('hashed');"
    assert js.headers["content-type"].startswith(("text/javascript", "application/javascript"))
    css = await client.get("/assets/index-AbC_123-x.css")
    assert css.status_code == 200 and css.headers["content-type"].startswith("text/css")
    font = await client.get("/assets/fonts/inter-AbC_9.woff2")
    assert font.status_code == 200 and font.content == b"wOF2"


async def test_the_spa_shell_and_root_files_are_unchanged(client, dist):
    for path in ("/", "/assets-overview", "/some/client/route", "/apis", "/api-docs", "/x/api/y", "/CON", "/..%5c"):
        resp = await client.get(path)
        assert resp.status_code == 200 and resp.text == SHELL, path
        assert resp.headers["cache-control"] == "no-cache"
    fav = await client.get("/favicon.svg")
    assert fav.status_code == 200 and fav.text == "<svg/>"


# ---------------------------------------------------------------- N6

def _assert_api_404(resp_status, headers, body_json):
    assert resp_status == 404
    assert headers["content-type"].startswith("application/json")
    assert body_json["detail"] == NO_SUCH_API and body_json["errors"] == [NO_SUCH_API]
    assert body_json["request_id"] == headers["x-request-id"]


@pytest.mark.parametrize("path", ["/api", "/api/", "/api/nope", "/api/assets/5/no-such-thing", "/api/admin/x/y/z",
                                  "/api/health/extra", "/api/auth"])
async def test_an_unknown_api_address_is_a_json_404_never_the_shell(client, dist, path):
    resp = await client.get(path)
    assert "shell" not in resp.text
    _assert_api_404(resp.status_code, resp.headers, resp.json())


async def test_an_unknown_api_address_is_a_json_404_without_the_frontend_too(client):
    settings.frontend_dist_dir = None
    resp = await client.get("/api/nope")
    _assert_api_404(resp.status_code, resp.headers, resp.json())


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def test_other_methods_on_an_unknown_api_address_are_404_too(client, dist, method):
    resp = await client.request(method, "/api/nope")
    assert resp.status_code == 404, (method, resp.status_code)
    if method != "HEAD":
        _assert_api_404(resp.status_code, resp.headers, resp.json())


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/docs/", "/docs/oauth2-redirect"])
async def test_where_the_docs_are_off_they_are_a_json_404_not_the_shell(client, dist, monkeypatch, path):
    """Closure (AU-11): in single-port production the documentation paths answer the same JSON 404 as any unknown
    API address -- before this they returned the SPA shell with 200 (no documentation, but it looked present)."""
    # In a production process the documentation routes are never registered (docs_urls), so these paths reach the
    # catch-all; here the dev-built app has them registered, so the catch-all handler is called directly.
    from app.main import _serve_frontend_shell
    monkeypatch.setattr(app, "docs_url", None)
    resp = await _serve_frontend_shell(path.lstrip("/"))
    assert resp.status_code == 404 and resp.headers["content-type"].startswith("application/json")
    assert NO_SUCH_API in resp.body.decode()
    monkeypatch.setattr(app, "docs_url", "/docs")                       # docs on (development): the shell is unchanged
    assert (await _serve_frontend_shell(path.lstrip("/"))).status_code == 200


async def test_real_api_routes_are_unchanged(client, dist):
    assert (await client.get("/api/health")).json() == {"status": "ok"}
    wrong_method = await client.delete("/api/health")              # a real route with the wrong method stays 405
    assert wrong_method.status_code == 405
    assert (await client.get("/api/masters/vendors")).status_code == 401
    assert (await client.head("/")).status_code in (200, 405)       # the SPA's own HEAD handling is not changed here
