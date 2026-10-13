"""S0.1 (audit B-1): an ordinary ADMIN must not be able to take over a
head-office admin (Primary Owner) account. Also S0.6/S0.10 on asset users:
nobody holding assets can be deactivated; email format and case-insensitive
codes for new records."""
from tests.core.s0_world import PASSWORD, build_world, login, make_asset

HEAD_OFFICE_ONLY = "Only a head-office admin can change a head-office admin account."


def _user_body(world, **over):
    body = {"company_id": world["co"], "code": "S0NEW", "name": "New Person", "asset_user_type": "EMPLOYEE",
            "location_id": world["loc"], "department_id": world["dept"]}
    body.update(over)
    return body


async def test_an_ordinary_admin_cannot_reset_the_password_of_a_primary_owner(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.post(f"/api/asset-users/{w['owner']}/reset-password", headers=h)
    assert resp.status_code == 403 and resp.json()["detail"] == HEAD_OFFICE_ONLY
    # the owner's own password still works
    ok = await client.post("/api/auth/login", json={"login_id": w["codes"]["owner"], "password": PASSWORD})
    assert ok.status_code == 200


async def test_an_ordinary_admin_cannot_edit_deactivate_or_change_access_of_a_primary_owner(client):
    w = await build_world()
    h = await login(client, w, "admin")
    put = await client.put(f"/api/asset-users/{w['owner']}", headers=h, json=_user_body(
        w, code="S0OWN", name="Demoted", role="VIEWER", login_enabled=True))
    assert put.status_code == 403 and put.json()["detail"] == HEAD_OFFICE_ONLY
    delete = await client.delete(f"/api/asset-users/{w['owner']}", headers=h)
    assert delete.status_code == 403 and delete.json()["detail"] == HEAD_OFFICE_ONLY
    access = await client.post(f"/api/asset-users/{w['owner']}/company-access", headers=h, json={"company_ids": [w["co_b"]]})
    assert access.status_code == 403
    # and granting/revoking stays head-office only
    revoke = await client.delete(f"/api/asset-users/{w['owner']}/primary-owner", headers=h)
    assert revoke.status_code == 403
    owner_h = await login(client, w, "owner")
    owner_row = next(u for u in (await client.get("/api/asset-users", headers=owner_h)).json() if u["id"] == w["owner"])
    assert owner_row["role"] == "ADMIN" and owner_row["is_active"] and owner_row["is_primary_owner"]


async def test_a_primary_owner_may_change_another_primary_owner_and_their_own_record(client):
    w = await build_world()
    h = await login(client, w, "owner")
    reset = await client.post(f"/api/asset-users/{w['owner2']}/reset-password", headers=h)
    assert reset.status_code == 200 and reset.json()["temp_password"]
    own = await client.put(f"/api/asset-users/{w['owner']}", headers=h, json=_user_body(
        w, code="S0OWN", name="Head Office Admin (renamed)", role="ADMIN", login_enabled=True))
    assert own.status_code == 200 and own.json()["name"] == "Head Office Admin (renamed)"


async def test_the_last_primary_owner_is_still_protected(client):
    w = await build_world()
    h = await login(client, w, "owner")
    assert (await client.delete(f"/api/asset-users/{w['owner2']}", headers=h)).status_code == 204
    last = await client.delete(f"/api/asset-users/{w['owner']}", headers=h)
    assert last.status_code == 422 and "last remaining" in last.json()["detail"]


async def test_an_ordinary_admin_still_manages_ordinary_accounts(client):
    w = await build_world()
    h = await login(client, w, "admin")
    assert (await client.post(f"/api/asset-users/{w['op_it']}/reset-password", headers=h)).status_code == 200


async def test_someone_holding_assets_cannot_be_deactivated(client):
    w = await build_world()
    h = await login(client, w, "owner")
    asset = await make_asset(client, h, w)
    moved = await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                              json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    assert moved.status_code == 201, moved.text
    resp = await client.delete(f"/api/asset-users/{w['employee']}", headers=h)
    assert resp.status_code == 422
    assert resp.json()["detail"].startswith("Ravi Kumar still holds 1 asset.")
    # once the asset is back in stock, deactivation works
    back = await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                             json={"event_type": "MOVED", "to_asset_user_id": w["stock"]})
    assert back.status_code == 201
    assert (await client.delete(f"/api/asset-users/{w['employee']}", headers=h)).status_code == 204


async def test_a_new_code_is_unique_ignoring_case_and_spaces_and_email_must_look_like_one(client):
    w = await build_world()
    h = await login(client, w, "admin")
    clash = await client.post("/api/asset-users", headers=h, json=_user_body(w, code=" s0emp "))
    assert clash.status_code == 422 and "already exists" in clash.json()["detail"]
    bad_email = await client.post("/api/asset-users", headers=h, json=_user_body(w, email="not-an-email"))
    assert bad_email.status_code == 422 and bad_email.json()["detail"] == "Email is not a valid email address."
    blank = await client.post("/api/asset-users", headers=h, json=_user_body(w, code="   "))
    assert blank.status_code == 422 and blank.json()["detail"] == "Code cannot be blank."
    ok = await client.post("/api/asset-users", headers=h, json=_user_body(w, code=" S0NEW1 ", email="ravi@citykart.org"))
    assert ok.status_code == 201 and ok.json()["code"] == "S0NEW1"


async def test_company_access_refuses_a_company_that_does_not_exist(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.post(f"/api/asset-users/{w['op_it']}/company-access", headers=h, json={"company_ids": [999999]})
    assert resp.status_code == 422 and "does not exist" in resp.json()["detail"]
