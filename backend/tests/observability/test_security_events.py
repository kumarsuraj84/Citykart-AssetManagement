"""S8: security and access events -- written in their own session (they survive a refused request), with
throttling where a flood is possible, and never a password, token or hash."""
import uuid

from app.observability.models import AuditLog
from tests.core.s0_world import PASSWORD, build_world, login, make_asset
from tests.observability.helpers import audit, everything_logged


async def _for(resp) -> list[AuditLog]:
    return await audit(AuditLog.request_id == resp.headers["x-request-id"])


async def _security(action: str) -> list[AuditLog]:
    return await audit(AuditLog.action == action)


async def test_a_successful_sign_in(client):
    w = await build_world()
    resp = await client.post("/api/auth/login", json={"login_id": "S0OPIT", "password": PASSWORD})
    assert resp.status_code == 200
    [row] = await _for(resp)
    assert (row.category, row.action, row.outcome, row.actor_id) == ("SECURITY", "LOGIN", "OK", w["op_it"])
    assert row.summary == "IT Operator signed in." and row.ip


async def test_a_failed_sign_in_keeps_the_login_id_but_never_the_password(client):
    await build_world()
    resp = await client.post("/api/auth/login", json={"login_id": "nobody@example.com", "password": "Sup3rSecret!"})
    assert resp.status_code == 401
    [row] = await _for(resp)
    assert (row.action, row.outcome, row.actor_id) == ("LOGIN_FAILED", "FAILED", None)
    assert row.changes["login_id"] == "nobody@example.com"
    assert "Sup3rSecret!" not in await everything_logged()


async def test_wrong_passwords_lock_the_account_and_each_step_is_recorded(client):
    w = await build_world()
    for _ in range(5):
        resp = await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "Wrong-1"})
        assert resp.status_code == 401
    locked = await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": PASSWORD})
    assert locked.status_code == 423
    failed = await _security("LOGIN_FAILED")
    assert [r.changes.get("attempt") for r in failed[:5]] == [1, 2, 3, 4, 5]
    assert failed[-1].changes["reason"] == "locked" and failed[-1].outcome == "DENIED"
    [lock] = await _security("LOCKED")
    assert lock.actor_id == w["admin"] and lock.changes == {"attempts": 5, "minutes": 15}
    assert "Wrong-1" not in await everything_logged()


async def test_a_failed_sign_in_row_survives_although_the_request_failed(client):
    await build_world()
    resp = await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "nope"})
    assert resp.status_code == 401
    assert len(await _for(resp)) == 1


async def test_sign_out_names_the_person_from_the_refresh_cookie(client):
    w = await build_world()
    await login(client, w, "viewer_it")
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 204
    [row] = await _for(resp)
    assert (row.action, row.actor_id) == ("LOGOUT", w["viewer_it"])


async def test_refresh_failures_are_recorded_at_most_once_a_minute_per_address(client):
    await build_world()
    first = await client.post("/api/auth/refresh")
    second = await client.post("/api/auth/refresh", cookies={"refresh_token": "garbage"})
    assert first.status_code == second.status_code == 401
    rows = await _security("TOKEN_REFRESH_FAILED")
    assert len(rows) == 1 and rows[0].changes["reason"] == "no refresh cookie"


async def test_bad_tokens_are_throttled_and_never_stored(client):
    await build_world()
    token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ"
    for _ in range(3):
        resp = await client.get("/api/assets", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
    rows = await _security("INVALID_TOKEN")
    assert len(rows) == 1 and rows[0].outcome == "DENIED"
    text = await everything_logged()
    assert token not in text and "c2lnbmF0dXJlLXNpZ25hdHVyZQ" not in text


async def test_a_permission_denial_is_recorded_once_per_person_route_and_minute(client):
    w = await build_world()
    h = await login(client, w, "viewer_it")
    for _ in range(3):
        resp = await client.post("/api/purchase-orders", headers=h, json={
            "company_id": w["co"], "po_number": "X", "po_date": "2026-01-01", "cost_center_id": w["cc"]})
        assert resp.status_code == 403
    rows = await _security("PERMISSION_DENIED")
    assert len(rows) == 1
    assert rows[0].summary == "IT Viewer was refused POST /api/purchase-orders: Not permitted for this action"
    assert rows[0].changes["role"] == "VIEWER" and rows[0].actor_id == w["viewer_it"]
    other = await client.get("/api/asset-users", headers=await login(client, w, "op_it"))
    assert other.status_code in (200, 403)


async def test_password_change_success_and_failure(client):
    w = await build_world()
    h = await login(client, w, "op_it")
    bad = await client.post("/api/auth/change-password", headers=h,
                            json={"old_password": "not-it", "new_password": "BrandNew#2026"})
    assert bad.status_code == 400
    good = await client.post("/api/auth/change-password", headers=h,
                             json={"old_password": PASSWORD, "new_password": "BrandNew#2026"})
    assert good.status_code == 204
    assert [r.action for r in await _for(bad)] == ["PASSWORD_CHANGE_FAILED"]
    actions = sorted((r.category, r.action) for r in await _for(good))
    assert actions == [("DATA", "UPDATE"), ("SECURITY", "PASSWORD_CHANGED")]
    text = await everything_logged()
    assert "BrandNew#2026" not in text and PASSWORD not in text


async def test_a_password_reset_never_contains_the_temporary_password(client):
    w = await build_world()
    resp = await client.post(f"/api/asset-users/{w['op_it']}/reset-password", headers=await login(client, w, "admin"))
    assert resp.status_code == 200
    temp = resp.json()["temp_password"]
    security = [r for r in await _for(resp) if r.category == "SECURITY"]
    assert [r.action for r in security] == ["PASSWORD_RESET"] and security[0].entity_id == str(w["op_it"])
    assert temp not in await everything_logged()


async def test_access_changes_are_security_rows_besides_the_data_row(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"role": "VIEWER"})
    assert resp.status_code == 200, resp.text
    rows = await _for(resp)
    data = [r for r in rows if r.category == "DATA"]
    [sec] = [r for r in rows if r.category == "SECURITY"]
    assert data[0].changes["role"] == {"old": "OPERATOR", "new": "VIEWER"}
    assert sec.action == "ACCESS_CHANGED" and "access level can only view" in sec.summary
    access = await client.post(f"/api/asset-users/{w['op_it']}/company-access", headers=h,
                               json={"company_ids": [w["co_b"]]})
    assert access.status_code == 204
    rows = await _for(access)
    assert sorted((r.category, r.action) for r in rows) == [("DATA", "UPDATE"), ("SECURITY", "ACCESS_CHANGED")]
    assert rows[0].changes["companies"] == {"old": [], "new": ["S0B"]}


async def test_head_office_admin_grant_and_revoke(client):
    w = await build_world()
    h = await login(client, w, "owner")
    granted = await client.post(f"/api/asset-users/{w['admin']}/primary-owner", headers=h)
    revoked = await client.delete(f"/api/asset-users/{w['admin']}/primary-owner", headers=h)
    assert granted.status_code == revoked.status_code == 200
    assert "PRIMARY_OWNER_GRANTED" in [r.action for r in await _for(granted)]
    assert "PRIMARY_OWNER_REVOKED" in [r.action for r in await _for(revoked)]


async def test_a_code_rule_change_is_a_security_row(client):
    w = await build_world()
    resp = await client.put(f"/api/code-rules/{w['rule']}", headers=await login(client, w, "owner"), json={
        "company_id": None, "prefix_template": "S1/{category.code}/", "suffix_template": "", "start_number": 1,
        "pad_width": 4})
    assert resp.status_code == 200, resp.text
    rows = await _for(resp)
    assert {(r.category, r.action) for r in rows} >= {("DATA", "UPDATE"), ("SECURITY", "CODE_RULE_CHANGED")}


async def test_exports_record_who_what_and_how_many_rows(client):
    w = await build_world()
    h = await login(client, w, "admin")
    await make_asset(client, h, w)
    resp = await client.get("/api/reports/export/assets", headers=h, params={"status": "IN_STOCK"})
    assert resp.status_code == 200
    [row] = await _for(resp)
    assert (row.category, row.action) == ("EXPORT", "EXPORT")
    assert row.changes["rows"] == 1 and row.changes["filters"] == {"status": "IN_STOCK"}
    assert row.summary == "Ordinary Admin exported the asset register (1 rows)."
    moves = await client.get("/api/reports/export/movements", headers=h,
                             params={"from_date": "2026-01-01", "to_date": "2026-12-31"})
    changes = await client.get("/api/reports/export/field-changes", headers=h)
    people = await client.get("/api/asset-users/export", headers=h)
    for r in (moves, changes, people):
        assert r.status_code == 200
        assert [x.action for x in await _for(r)] == ["EXPORT"]


async def test_document_upload_and_download_are_access_rows(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    up = await client.post(f"/api/assets/{asset['id']}/documents", headers=h, data={"doc_type": "invoice"},
                           files={"file": ("bill.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert up.status_code == 201, up.text
    assert sorted(r.action for r in await _for(up)) == ["CREATE", "DOCUMENT_UPLOADED"]
    down = await client.get(f"/api/documents/{up.json()['id']}/download", headers=h)
    assert down.status_code == 200
    [row] = await _for(down)
    assert row.action == "DOCUMENT_DOWNLOADED" and row.entity_id == str(asset["id"])


async def test_an_idempotency_conflict_is_an_access_row(client):
    from tests.purchase_orders.s4_world import build_s4_world

    w = await build_s4_world()
    h = {**await login(client, w, "owner"), "Idempotency-Key": str(uuid.uuid4())}
    body = {"item_id": w["item_gangbox"], "quantity": 1, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]}
    assert (await client.post("/api/assets/batch", headers=h, json=body)).status_code == 201
    other = await client.post("/api/assets/batch", headers=h, json={**body, "quantity": 2})
    assert other.status_code == 422
    [row] = await _for(other)
    assert (row.category, row.action, row.outcome) == ("ACCESS", "IDEMPOTENT_CONFLICT", "DENIED")


async def test_a_nul_character_is_a_suspicious_input_row(client):
    w = await build_world()
    resp = await client.post("/api/masters/vendors", headers=await login(client, w, "owner"),
                             json={"name": "Bad\u0000Vendor"})
    assert resp.status_code == 422
    [row] = await _for(resp)
    assert (row.category, row.action, row.outcome) == ("SECURITY", "SUSPICIOUS_INPUT", "DENIED")
