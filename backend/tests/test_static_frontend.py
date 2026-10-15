from app.core.config import settings


async def test_unmatched_path_404s_when_frontend_dist_dir_unset(client):
    settings.frontend_dist_dir = None
    resp = await client.get("/some/spa/route")
    assert resp.status_code == 404


async def test_api_routes_unaffected_when_frontend_dist_dir_unset(client):
    settings.frontend_dist_dir = None
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_security_headers_present_on_every_response(client):
    settings.frontend_dist_dir = None
    resp = await client.get("/api/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


async def test_api_responses_are_never_cached(client):
    settings.frontend_dist_dir = None
    resp = await client.get("/api/health")
    assert resp.headers["Cache-Control"] == "no-store"


async def test_serves_hashed_asset_from_assets_directory(client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "assets" / "index-abc123.js").write_text("console.log('hi');")
    (dist / "index.html").write_text("<html>shell</html>")
    settings.frontend_dist_dir = str(dist)
    try:
        resp = await client.get("/assets/index-abc123.js")
        assert resp.status_code == 200
        assert resp.text == "console.log('hi');"
    finally:
        settings.frontend_dist_dir = None


async def test_unknown_asset_404s_instead_of_falling_back_to_shell(client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>shell</html>")
    settings.frontend_dist_dir = str(dist)
    try:
        resp = await client.get("/assets/does-not-exist.js")
        assert resp.status_code == 404
    finally:
        settings.frontend_dist_dir = None


async def test_assets_route_cannot_read_files_outside_the_assets_folder(client, tmp_path):
    """IF-01: `..`, encoded `..`, an absolute path or a sibling folder must never leave <dist>/assets."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "assets" / "ok.js").write_text("ok")
    (dist / "index.html").write_text("<html>shell</html>")
    (dist / "secret-in-dist.txt").write_text("TOP-SECRET-DIST")
    (tmp_path / "shared").mkdir()
    secret = tmp_path / "shared" / ".env"
    secret.write_text("JWT_SECRET=TOP-SECRET-ENV")
    sibling = tmp_path / "dist-evil"
    sibling.mkdir()
    (sibling / "x.txt").write_text("TOP-SECRET-SIBLING")
    settings.frontend_dist_dir = str(dist)
    try:
        attacks = [
            "/assets/%2e%2e/secret-in-dist.txt",
            "/assets/..%2fsecret-in-dist.txt",
            "/assets/%2e%2e%2f%2e%2e%2fshared%2f.env",
            "/assets/..%5c..%5cshared%5c.env",
            "/assets/../../shared/.env",
            "/assets/%2e%2e/%2e%2e/dist-evil/x.txt",
            "/assets/" + str(secret).replace("\\", "/"),          # absolute path (leading slash after /assets/)
            "/assets//" + str(secret).replace("\\", "/").lstrip("/"),
            "/assets/" + str(secret).replace("\\", "%5c"),
            "/assets/ok.js%00.txt",
        ]
        for url in attacks:
            resp = await client.get(url)
            assert "TOP-SECRET" not in resp.text, url
            assert resp.status_code in (404, 400, 200), url
            if resp.status_code == 200:
                # a normalising client may land on the SPA shell, never on a secret
                assert resp.text == "<html>shell</html>", url
        assert (await client.get("/assets/ok.js")).text == "ok"
    finally:
        settings.frontend_dist_dir = None


async def test_root_level_static_file_served_directly(client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>shell</html>")
    (dist / "favicon.svg").write_text("<svg/>")
    settings.frontend_dist_dir = str(dist)
    try:
        resp = await client.get("/favicon.svg")
        assert resp.status_code == 200
        assert resp.text == "<svg/>"
    finally:
        settings.frontend_dist_dir = None


async def test_spa_route_falls_back_to_index_html_with_no_cache(client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>shell</html>")
    settings.frontend_dist_dir = str(dist)
    try:
        resp = await client.get("/some/client/route")
        assert resp.status_code == 200
        assert resp.text == "<html>shell</html>"
        assert resp.headers["Cache-Control"] == "no-cache"
    finally:
        settings.frontend_dist_dir = None


async def test_root_path_falls_back_to_index_html(client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>shell</html>")
    settings.frontend_dist_dir = str(dist)
    try:
        resp = await client.get("/")
        assert resp.status_code == 200
        assert resp.text == "<html>shell</html>"
    finally:
        settings.frontend_dist_dir = None
