"""S1 backend requests delivered in S2, and the S0 leftover on account
management:
  (a) login and refresh say who is signed in (asset_user_id);
  (b) the people list carries the location's name and the company's code;
  (c) editing a person keeps every field the request leaves out (the work
      area used to be reset by an edit form that did not send it);
  S0: an ADMIN limited to one work area cannot give anyone a wider one."""
from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from tests.core.s0_world import PASSWORD, build_world, login


async def _user(uid: int) -> AssetUser:
    async with SessionLocal() as s:
        return await s.get(AssetUser, uid)


async def test_login_and_refresh_say_who_is_signed_in(client):
    w = await build_world()
    resp = await client.post("/api/auth/login", json={"login_id": w["codes"]["op_it"], "password": PASSWORD})
    assert resp.status_code == 200 and resp.json()["asset_user_id"] == w["op_it"]
    refreshed = await client.post("/api/auth/refresh")
    assert refreshed.status_code == 200 and refreshed.json()["asset_user_id"] == w["op_it"]
    owner = await client.post("/api/auth/login", json={"login_id": w["codes"]["owner"], "password": PASSWORD})
    assert owner.json()["asset_user_id"] == w["owner"] and owner.json()["is_primary_owner"] is True


async def test_the_people_list_carries_location_name_and_company_code(client):
    w = await build_world()
    h = await login(client, w, "admin")
    rows = {r["id"]: r for r in (await client.get("/api/asset-users", headers=h)).json()}
    assert (rows[w["stock"]]["location_name"], rows[w["stock"]]["company_code"]) == ("HO", "S0A")
    assert (rows[w["stock_b"]]["location_name"], rows[w["stock_b"]]["company_code"]) == ("HO B", "S0B")
    assert rows[w["stock"]]["location_id"] is not None and rows[w["stock"]]["company_id"] == w["co"]   # ids stay


async def test_an_edit_that_leaves_out_the_work_area_keeps_it(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"name": "IT Operator Renamed"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["name"], body["allowed_asset_domains"], body["role"], body["login_enabled"]) == (
        "IT Operator Renamed", "IT", "OPERATOR", True)
    stored = await _user(w["op_it"])
    assert stored.allowed_asset_domains == "IT" and stored.code == "S0OPIT" and stored.location_id == w["loc"]


async def test_an_edit_keeps_role_login_email_and_department_when_left_out(client):
    w = await build_world()
    h = await login(client, w, "admin")
    first = await client.put(f"/api/asset-users/{w['op_both']}", headers=h, json={"email": "both@example.com", "phone": "98765"})
    assert first.status_code == 200, first.text
    second = await client.put(f"/api/asset-users/{w['op_both']}", headers=h, json={"phone": "11111"})
    stored = await _user(w["op_both"])
    assert second.status_code == 200
    assert (stored.email, stored.phone, stored.role, stored.login_enabled, stored.department_id) == (
        "both@example.com", "11111", "OPERATOR", True, w["dept"])


async def test_an_explicit_null_or_blank_clears_what_may_be_cleared(client):
    w = await build_world()
    h = await login(client, w, "admin")
    await client.put(f"/api/asset-users/{w['op_both']}", headers=h, json={"email": "x@example.com"})
    resp = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"allowed_asset_domains": None})
    assert resp.status_code == 200 and resp.json()["allowed_asset_domains"] is None
    cleared = await client.put(f"/api/asset-users/{w['op_both']}", headers=h, json={"email": "  ", "department_id": None})
    assert cleared.status_code == 200
    stored = await _user(w["op_both"])
    assert (stored.email, stored.department_id) == (None, None)


async def test_required_fields_cannot_be_cleared(client):
    w = await build_world()
    h = await login(client, w, "admin")
    for body, word in (({"company_id": None}, "Choose the company"), ({"location_id": None}, "Choose the location"),
                       ({"asset_user_type": None}, "Choose a type"), ({"code": " "}, "Code cannot be blank"),
                       ({"name": None}, "Name cannot be blank"), ({"role": None}, "Choose an access level")):
        resp = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json=body)
        assert resp.status_code == 422 and word in resp.json()["detail"], (body, resp.text)
    assert (await _user(w["op_it"])).name == "IT Operator"


async def test_switching_login_off_keeps_a_stored_work_area_but_a_sent_one_needs_login(client):
    w = await build_world()
    h = await login(client, w, "admin")
    off = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"login_enabled": False})
    assert off.status_code == 200, off.text
    stored = await _user(w["op_it"])
    assert (stored.login_enabled, stored.allowed_asset_domains) == (False, "IT")
    sent = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"allowed_asset_domains": "NON_IT"})
    assert sent.status_code == 422 and "only be set for someone who can log in" in sent.json()["detail"]
    on = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"login_enabled": True})
    assert on.status_code == 200 and on.json()["allowed_asset_domains"] == "IT"     # back on, still limited to IT


async def test_the_full_body_edit_still_works_as_before(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.put(f"/api/asset-users/{w['employee']}", headers=h, json={
        "company_id": w["co"], "code": "S0EMP", "name": "Ravi K", "asset_user_type": "EMPLOYEE", "location_id": w["loc"],
        "department_id": None, "email": None, "phone": None, "role": "SELF_SERVICE", "login_enabled": False,
        "primary_asset_domain": None, "allowed_asset_domains": None})
    assert resp.status_code == 200 and resp.json()["name"] == "Ravi K" and resp.json()["department_id"] is None


def _new_person(w, code, role="OPERATOR", domains=None, login_enabled=True):
    return {"company_id": w["co"], "code": code, "name": code, "asset_user_type": "EMPLOYEE", "location_id": w["loc"],
            "role": role, "login_enabled": login_enabled, "allowed_asset_domains": domains}


async def test_an_admin_limited_to_one_work_area_cannot_create_someone_with_a_wider_one(client):
    w = await build_world()
    h = await login(client, w, "admin_it")
    for body in (_new_person(w, "N1", domains="BOTH"), _new_person(w, "N2", domains=None),
                 _new_person(w, "N3", domains="NON_IT"), _new_person(w, "N4", role="ADMIN", domains=None)):
        resp = await client.post("/api/asset-users", headers=h, json=body)
        assert resp.status_code == 403, (body, resp.text)
        assert "cannot give anyone a wider work area than your own" in resp.json()["detail"]
        assert "Set their work area to IT" in resp.json()["detail"]
    for body in (_new_person(w, "OK1", domains="IT"), _new_person(w, "OK2", role="ADMIN", domains="IT"),
                 _new_person(w, "OK3", role="SELF_SERVICE"), _new_person(w, "OK4", login_enabled=False)):
        resp = await client.post("/api/asset-users", headers=h, json=body)
        assert resp.status_code == 201, (body, resp.text)


async def test_an_admin_limited_to_one_work_area_cannot_widen_someone_but_can_edit_other_details(client):
    w = await build_world()
    h = await login(client, w, "admin_it")
    widen = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"allowed_asset_domains": "BOTH"})
    assert widen.status_code == 403
    cleared = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"allowed_asset_domains": None})
    assert cleared.status_code == 403                                           # unset means both
    enable = await client.put(f"/api/asset-users/{w['employee']}", headers=h, json={"role": "OPERATOR", "login_enabled": True})
    assert enable.status_code == 403                                            # a new login with both areas
    assert (await _user(w["op_it"])).allowed_asset_domains == "IT"
    phone = await client.put(f"/api/asset-users/{w['op_both']}", headers=h, json={"phone": "12345"})
    assert phone.status_code == 200                                             # already had both; not widened
    # S6: someone whose current work area is wider than the editor's own keeps their login, access level
    # and work area -- narrowing them is refused too (only the head-office admin or a both-area admin may).
    narrow = await client.put(f"/api/asset-users/{w['op_both']}", headers=h, json={"allowed_asset_domains": "IT"})
    assert narrow.status_code == 403
    assert (await _user(w["op_both"])).allowed_asset_domains is None


async def test_an_admin_with_both_work_areas_may_give_both(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.put(f"/api/asset-users/{w['op_it']}", headers=h, json={"allowed_asset_domains": "BOTH"})
    assert resp.status_code == 200 and resp.json()["allowed_asset_domains"] == "BOTH"
    created = await client.post("/api/asset-users", headers=h, json=_new_person(w, "WIDE", role="ADMIN"))
    assert created.status_code == 201
