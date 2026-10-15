"""N1: oversized request bodies are refused (413, plain words, request id) before they are read in full."""
import io

from app.core.body_limit import AUTH_MAX_BYTES, JSON_MAX_BYTES, UPLOAD_MAX_BYTES, limit_for


def test_limits_by_kind_of_request():
    assert limit_for("/api/auth/login", "application/json") == AUTH_MAX_BYTES
    assert limit_for("/api/auth/change-password", "application/json") == AUTH_MAX_BYTES
    assert limit_for("/api/assets/1/documents", "multipart/form-data; boundary=x") == UPLOAD_MAX_BYTES
    assert limit_for("/api/purchase-orders/with-lines", "application/json") == JSON_MAX_BYTES
    assert AUTH_MAX_BYTES < JSON_MAX_BYTES < UPLOAD_MAX_BYTES


async def test_a_big_sign_in_body_is_refused_with_413_and_the_envelope(client):
    resp = await client.post("/api/auth/login", content=b"x" * (AUTH_MAX_BYTES + 1), headers={"Content-Type": "application/json"})
    assert resp.status_code == 413
    body = resp.json()
    assert "larger than" in body["detail"] and body["errors"][0]["message"] == body["detail"] and body["request_id"]
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Request-ID"] == body["request_id"]


async def test_a_chunked_body_with_no_length_is_stopped_while_it_streams(client):
    async def chunks():
        for _ in range(20):
            yield b"x" * 8192                      # 160 KB in pieces, no Content-Length

    resp = await client.post("/api/auth/login", content=chunks(), headers={"Content-Type": "application/json"})
    assert resp.status_code == 413


async def test_an_ordinary_sign_in_and_a_normal_json_post_are_unaffected(client):
    bad = await client.post("/api/auth/login", json={"login_id": "nobody", "password": "x" * 100})
    assert bad.status_code == 401
    big_but_allowed = await client.post("/api/auth/login", json={"login_id": "nobody", "password": "x" * 50_000})
    assert big_but_allowed.status_code in (401, 422)          # under 64 KB: reaches the normal validation


async def test_a_16_mb_plus_upload_is_refused_before_the_endpoint(client):
    big = io.BytesIO(b"\0" * (UPLOAD_MAX_BYTES + 1024))
    resp = await client.post("/api/imports/assets/preview", files={"file": ("big.xlsx", big, "application/octet-stream")})
    assert resp.status_code == 413
