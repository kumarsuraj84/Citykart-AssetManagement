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
