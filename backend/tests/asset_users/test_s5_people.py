"""S5: People & Places -- typed creation over the one asset_user table: Employees (with an optional login,
role and work area in words), Stores (store + its Stock Room + its Install Point, idempotent, also from the
ERP store list and by a backfill), Install Points, and one list."""
from sqlalchemy import func, select

from app.asset_users.models import AssetUser, AssetUserCompanyAccess
from app.core.db import SessionLocal
from app.masters.models import Location
from tests.core.s0_world import build_world, login
from tests.erp.test_erp_api import _headers, _setup
from tests.erp.test_erp_stores import seed_sites


async def post(client, h, path, payload):
    return await client.post(f"/api/people/{path}", headers=h, json=payload)


async def users(company_id: int) -> dict[str, AssetUser]:
    async with SessionLocal() as s:
        rows = (await s.execute(select(AssetUser).where(AssetUser.company_id == company_id))).scalars().all()
    return {u.code: u for u in rows}


async def count_users() -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(AssetUser))).scalar_one()


# ---------------------------------------------------------------- employees

async def test_an_employee_without_a_login(client):
    w = await build_world()
    resp = await post(client, await login(client, w, "admin"), "employees", {
        "code": "E100", "name": "Asha Rani", "company_id": w["co"], "location_name": " ho ", "department_id": w["dept"],
        "phone": "98100 00000", "email": "asha@example.com"})
    assert resp.status_code == 201, resp.text
    row = resp.json()
    assert (row["kind"], row["kind_label"], row["code"], row["name"], row["location_id"], row["location_name"]) == (
        "EMPLOYEE", "Employee", "E100", "Asha Rani", w["loc"], "HO")
    assert (row["company_code"], row["department_name"], row["email"], row["phone"]) == ("S0A", "S0 Dept", "asha@example.com", "98100 00000")
    assert (row["login_enabled"], row["role"], row["role_label"], row["work_area"], row["has_password"]) == (
        False, "SELF_SERVICE", None, None, False)


async def test_an_employee_who_can_sign_in_with_a_role_work_area_and_extra_company(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await post(client, h, "employees", {
        "code": "E200", "name": "Mohit", "company_id": w["co"], "location_id": w["loc"], "email": "mohit@example.com",
        "login": {"enabled": True, "role": "operator", "work_area": "it", "extra_company_ids": [w["co_b"], w["co"]]}})
    assert resp.status_code == 201, resp.text
    row = resp.json()
    assert (row["login_enabled"], row["role"], row["role_label"], row["work_area"], row["work_area_label"]) == (
        True, "OPERATOR", "Can Add & Move Assets", "IT", "IT")
    assert row["has_password"] is False and row["must_change_password"] is True
    async with SessionLocal() as s:
        grants = (await s.execute(select(AssetUserCompanyAccess.company_id).where(
            AssetUserCompanyAccess.asset_user_id == row["id"]))).scalars().all()
    assert grants == [w["co_b"]]
    issued = await client.post("/api/asset-users/issue-passwords", headers=h, json={"asset_user_ids": [row["id"]]})
    login_resp = await client.post("/api/auth/login", json={"login_id": "mohit@example.com", "password": issued.json()[0]["temp_password"]})
    assert login_resp.status_code == 200 and login_resp.json()["must_change_password"] is True


async def test_role_and_work_area_values_are_checked_in_words(client):
    w = await build_world()
    h = await login(client, w, "admin")
    base = {"code": "E300", "name": "X", "company_id": w["co"], "location_id": w["loc"]}
    bad_role = await post(client, h, "employees", {**base, "login": {"enabled": True, "role": "boss"}})
    assert bad_role.status_code == 422 and bad_role.json()["detail"].startswith("Choose an access level")
    bad_area = await post(client, h, "employees", {**base, "login": {"enabled": True, "role": "VIEWER", "work_area": "HR"}})
    assert bad_area.json()["detail"] == "Choose a work area: IT, Non-IT or both."
    no_login = await post(client, h, "employees", {**base, "login": {"enabled": False, "work_area": "IT"}})
    assert no_login.json()["detail"] == "A work area and extra companies can only be given to someone who can log in."
    bad_company = await post(client, h, "employees", {**base, "login": {"enabled": True, "extra_company_ids": [999]}})
    assert bad_company.json()["detail"] == "One of the companies you chose does not exist or is no longer active."
    nowhere = await post(client, h, "employees", {"code": "E301", "name": "Y", "company_id": w["co"]})
    assert nowhere.json()["detail"] == "Choose where the employee sits, or type the name of the place."
    other_place = await post(client, h, "employees", {**base, "location_id": w["loc"], "company_id": w["co_b"]})
    assert other_place.json()["detail"] == "The location must belong to the same company as the employee."
    bad_email = await post(client, h, "employees", {**base, "email": "not-an-email"})
    assert bad_email.json()["detail"] == "Email is not a valid email address."
    duplicate = await post(client, h, "employees", {**base, "code": " s0emp "})
    assert duplicate.status_code == 422 and duplicate.json()["detail"] == "A person or place with the code s0emp already exists in this company."


async def test_an_admin_limited_to_one_work_area_cannot_give_a_wider_one(client):
    w = await build_world()
    h = await login(client, w, "admin_it")
    base = {"name": "X", "company_id": w["co"], "location_id": w["loc"]}
    wider = await post(client, h, "employees", {**base, "code": "E400", "login": {"enabled": True, "role": "OPERATOR", "work_area": "BOTH"}})
    assert wider.status_code == 403 and wider.json()["detail"].startswith("You handle only IT work")
    unset = await post(client, h, "employees", {**base, "code": "E401", "login": {"enabled": True, "role": "VIEWER"}})
    assert unset.status_code == 403                                  # unset = both
    same = await post(client, h, "employees", {**base, "code": "E402", "login": {"enabled": True, "role": "OPERATOR", "work_area": "IT"}})
    assert same.status_code == 201, same.text


async def test_only_admins_add_people_and_places(client):
    w = await build_world()
    for who in ("op_both", "op_it", "viewer_it"):
        h = await login(client, w, who)
        for path, payload in (("employees", {"code": "E9", "name": "X", "company_id": w["co"], "location_id": w["loc"]}),
                              ("stores", {"code": "ABC", "name": "X", "company_id": w["co"]}),
                              ("install-points", {"name": "X", "company_id": w["co"], "location_id": w["loc"]})):
            resp = await post(client, h, path, payload)
            assert resp.status_code == 403 and resp.json()["detail"] == "Only an admin can add people and places. Ask an admin or the head-office admin."
    owner = await post(client, await login(client, w, "owner"), "employees",
                       {"code": "E10", "name": "X", "company_id": w["co"], "location_id": w["loc"]})
    assert owner.status_code == 201


# ---------------------------------------------------------------- stores

async def test_a_store_comes_with_its_stock_room_and_install_point(client):
    w = await build_world()
    resp = await post(client, await login(client, w, "admin"), "stores", {"code": "lam", "name": "Lucknow Aminabad", "company_id": w["co"]})
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert out["created"] == ["store", "stock_room", "install_point"] and out["reused"] == []
    store, room, point = out["store"], out["stock_room"], out["install_point"]
    assert (store["kind"], store["code"], store["email"], store["login_enabled"], store["has_password"]) == (
        "STORE", "LAM", "sm.lam@citykartstores.com", True, False)
    assert (room["kind_label"], room["code"], room["name"], room["login_enabled"]) == ("Stock Room", "STK-LAM", "Lucknow Aminabad Stock Room", False)
    assert (point["kind_label"], point["code"], point["name"]) == ("Install Point", "INS-LAM", "Lucknow Aminabad Install Point")
    assert store["location_id"] == room["location_id"] == point["location_id"]
    async with SessionLocal() as s:
        loc = await s.get(Location, store["location_id"])
    assert (loc.code, loc.name, loc.company_id) == ("LAM", "Lucknow Aminabad", w["co"])


async def test_running_it_twice_creates_nothing_new(client):
    w = await build_world()
    h = await login(client, w, "admin")
    first = await post(client, h, "stores", {"code": "SPR2", "name": "Sitapur Road", "company_id": w["co"], "location_name": "Sitapur"})
    assert first.status_code == 201
    before = await count_users()
    again = await post(client, h, "stores", {"code": "spr2", "name": "Anything", "company_id": w["co"]})
    assert again.status_code == 200, again.text
    assert again.json()["created"] == [] and again.json()["reused"] == ["store", "stock_room", "install_point"]
    assert again.json()["store"]["id"] == first.json()["store"]["id"] and await count_users() == before


async def test_rooms_that_exist_are_reused_and_a_clash_is_refused(client):
    w = await build_world()
    h = await login(client, w, "admin")
    async with SessionLocal() as s:
        s.add(AssetUser(company_id=w["co"], code="STK-LAD", name="Old LAD room", asset_user_type="STOCK_POINT",
                        location_id=w["loc"], role="SELF_SERVICE"))
        s.add(AssetUser(company_id=w["co"], code="INS-XYZ", name="Someone odd", asset_user_type="EMPLOYEE",
                        location_id=w["loc"], role="SELF_SERVICE"))
        await s.commit()
    lad = await post(client, h, "stores", {"code": "LAD", "name": "Lalbagh", "company_id": w["co"]})
    assert lad.json()["created"] == ["store", "install_point"] and lad.json()["reused"] == ["stock_room"]
    assert lad.json()["stock_room"]["name"] == "Old LAD room"
    before = await count_users()
    clash = await post(client, h, "stores", {"code": "XYZ", "name": "Xyz", "company_id": w["co"]})
    assert clash.status_code == 422
    assert clash.json()["detail"] == "The code INS-XYZ is already used by Someone odd, so the install point of store XYZ was not made."
    assert await count_users() == before                                          # the store itself was not kept either


async def test_store_codes_and_logins_are_checked(client):
    w = await build_world()
    h = await login(client, w, "admin")
    for bad in ("LA", "LAMXY", "L4M", "LA-M"):
        resp = await post(client, h, "stores", {"code": bad, "name": "X", "company_id": w["co"]})
        assert resp.status_code == 422 and "three letters" in resp.json()["detail"], bad
    async with SessionLocal() as s:
        s.add(AssetUser(company_id=w["co"], code="EMP", name="Not a store", asset_user_type="EMPLOYEE", location_id=w["loc"],
                        role="SELF_SERVICE", email="sm.qrs@citykartstores.com"))
        await s.commit()
    taken_code = await post(client, h, "stores", {"code": "emp", "name": "X", "company_id": w["co"]})
    assert taken_code.json()["detail"] == "A person or place with the code EMP already exists in this company."
    taken_email = await post(client, h, "stores", {"code": "QRS", "name": "X", "company_id": w["co"]})
    assert taken_email.json()["detail"] == "The login email sm.qrs@citykartstores.com is already used by someone else in this company."


async def test_stores_made_from_the_erp_get_their_rooms_too_and_again_creates_nothing(client):
    ids = await _setup()
    await seed_sites()
    h = await _headers(client)
    resp = await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["LAM", "SPR2"]})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert sorted(out["created"]) == ["LAM", "SPR2"] and (out["stock_rooms_created"], out["install_points_created"]) == (2, 2)
    lam = next(r for r in out["rooms"] if r["code"] == "LAM")
    assert lam == {"code": "LAM", "stock_room_code": "STK-LAM", "stock_room_created": True, "install_point_code": "INS-LAM",
                   "install_point_created": True, "problems": []}
    made = await users(ids["spl"])
    assert (made["STK-LAM"].asset_user_type, made["INS-LAM"].asset_user_type) == ("STOCK_POINT", "INSTALLED")
    assert made["STK-LAM"].location_id == made["LAM"].location_id
    before = await count_users()
    again = await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["LAM", "LAD"]})
    assert again.json()["created"] == ["LAD"] and (again.json()["stock_rooms_created"], again.json()["install_points_created"]) == (1, 1)
    assert next(r for r in again.json()["rooms"] if r["code"] == "LAM")["stock_room_created"] is False
    assert await count_users() == before + 3


async def test_an_erp_store_made_before_s5_gets_its_rooms_when_its_code_is_sent_again(client):
    ids = await _setup()
    await seed_sites()
    async with SessionLocal() as s:
        loc = Location(company_id=ids["spl"], code="LAM", name="LAM")
        s.add(loc)
        await s.flush()
        s.add(AssetUser(company_id=ids["spl"], code="LAM", name="LAM", asset_user_type="STORE", location_id=loc.id,
                        role="SELF_SERVICE", login_enabled=True, email="sm.lam@citykartstores.com"))
        await s.commit()
    resp = await client.post("/api/erp/stores/create", headers=await _headers(client), json={"company_id": ids["spl"], "codes": ["LAM"]})
    assert resp.json()["created"] == [] and resp.json()["skipped"][0]["reason"] == "A user with this code already exists."
    assert resp.json()["stock_rooms_created"] == 1 and {"STK-LAM", "INS-LAM"} <= set(await users(ids["spl"]))


async def test_the_backfill_gives_every_store_its_rooms_once(client):
    w = await build_world()
    async with SessionLocal() as s:
        for code in ("AAA", "BBB"):
            s.add(AssetUser(company_id=w["co"], code=code, name=f"Store {code}", asset_user_type="STORE", location_id=w["loc"], role="SELF_SERVICE"))
        s.add(AssetUser(company_id=w["co"], code="STK-BBB", name="BBB room", asset_user_type="STOCK_POINT", location_id=w["loc"], role="SELF_SERVICE"))
        s.add(AssetUser(company_id=w["co"], code="CCC", name="Store CCC", asset_user_type="STORE", location_id=w["loc"], role="SELF_SERVICE"))
        s.add(AssetUser(company_id=w["co"], code="INS-CCC", name="Wrong kind", asset_user_type="EMPLOYEE", location_id=w["loc"], role="SELF_SERVICE"))
        await s.commit()
    assert (await client.post("/api/people/stores/ensure-rooms", headers=await login(client, w, "admin"))).status_code == 403
    h = await login(client, w, "owner")
    first = (await client.post("/api/people/stores/ensure-rooms", headers=h)).json()
    assert {k: first[k] for k in ("stores_checked", "stores_completed", "already_complete", "stock_rooms_created", "install_points_created")} == {
        "stores_checked": 3, "stores_completed": 3, "already_complete": 0, "stock_rooms_created": 2, "install_points_created": 2}
    assert first["problems"] == [{"store_code": "CCC", "company_code": "S0A",
                                  "message": "The code INS-CCC is already used by Wrong kind, so the install point of store CCC was not made."}]
    second = (await client.post("/api/people/stores/ensure-rooms", headers=h)).json()
    assert (second["stores_completed"], second["already_complete"], second["stock_rooms_created"], second["install_points_created"]) == (0, 2, 0, 0)


# ---------------------------------------------------------------- install points

async def test_an_install_point_is_made_once_per_name(client):
    w = await build_world()
    h = await login(client, w, "admin")
    first = await post(client, h, "install-points", {"name": "HO Server Room", "company_id": w["co"], "location_id": w["loc"]})
    assert first.status_code == 201, first.text
    assert (first.json()["code"], first.json()["kind_label"], first.json()["created"]) == ("INS-HOSERVERROOM", "Install Point", True)
    again = await post(client, h, "install-points", {"name": " ho server room ", "company_id": w["co"], "location_name": "Elsewhere"})
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"] and again.json()["created"] is False
    other = await post(client, h, "install-points", {"name": "HO Server Room", "company_id": w["co_b"], "location_name": "B HO"})
    assert other.status_code == 201 and other.json()["company_code"] == "S0B"


# ---------------------------------------------------------------- the list

async def test_the_list_by_kind_search_paging_and_scope(client):
    w = await build_world()
    admin = await login(client, w, "admin")
    await post(client, admin, "stores", {"code": "LAM", "name": "Lucknow", "company_id": w["co"]})
    await post(client, admin, "install-points", {"name": "Gate", "company_id": w["co_b"], "location_name": "B HO"})
    stores = await client.get("/api/people", headers=admin, params={"kind": "stores"})
    assert [r["code"] for r in stores.json()] == ["LAM"] and stores.headers["X-Total-Count"] == "1"
    rooms = await client.get("/api/people", headers=admin, params={"kind": "stock-rooms"})
    assert {r["code"] for r in rooms.json()} == {"S0STK", "S0STK2", "S0STKB", "STK-LAM"} and {r["kind_label"] for r in rooms.json()} == {"Stock Room"}
    found = await client.get("/api/people", headers=admin, params={"q": "lucknow"})
    assert {r["code"] for r in found.json()} == {"LAM", "STK-LAM", "INS-LAM"}
    page = await client.get("/api/people", headers=admin, params={"kind": "employees", "limit": 2, "offset": 1})
    assert len(page.json()) == 2 and int(page.headers["X-Total-Count"]) >= 8
    admin_row = next(r for r in (await client.get("/api/people", headers=admin, params={"q": "S0ADMIT"})).json())
    assert (admin_row["role_label"], admin_row["work_area"], admin_row["work_area_label"], admin_row["has_password"]) == (
        "Full Admin", "IT", "IT", True)
    owner_row = next(r for r in (await client.get("/api/people", headers=admin, params={"q": "S0OWN2"})).json())
    assert (owner_row["role_label"], owner_row["work_area"]) == ("Head-office Admin", "BOTH")
    # an operator of company A sees company A only; another company -> empty; a viewer may read; bad kind -> 422
    op = await login(client, w, "op_it")
    assert {r["company_code"] for r in (await client.get("/api/people", headers=op)).json()} == {"S0A"}
    other = await client.get("/api/people", headers=op, params={"company_id": w["co_b"]})
    assert other.json() == [] and other.headers["X-Total-Count"] == "0"
    assert (await client.get("/api/people", headers=await login(client, w, "viewer_it"))).status_code == 200
    bad = await client.get("/api/people", headers=admin, params={"kind": "holders"})
    assert bad.status_code == 422 and bad.json()["detail"] == "Choose what to list: employees, stores, stock rooms or install points."
    assert "password_hash" not in stores.json()[0]
