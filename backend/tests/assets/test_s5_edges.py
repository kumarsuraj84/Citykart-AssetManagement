"""S5: edge cases across the stage -- batch add destinations and limits, people & places checks, password
issuing filters, search corners, link-tool corners and report-preview columns."""
from datetime import datetime, timedelta, timezone
from io import BytesIO

import openpyxl
from sqlalchemy import select, update

from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.erp.source import get_erp_source
from app.lifecycle.models import AssetEvent
from app.main import app
from app.masters.models import CustomField, Department, Location
from tests.core.s0_world import make_asset
from tests.erp.test_erp_api import FakeErp
from tests.purchase_orders.s4_world import build_s4_world, login, serials


async def batch(client, h, w, item, quantity, **over):
    return await client.post("/api/assets/batch", headers=h, json={
        "item_id": w[f"item_{item}"], "quantity": quantity, "received_into_asset_user_id": w["stock"],
        "cost_center_id": w["cc"], **over})


async def install_point(w) -> int:
    async with SessionLocal() as s:
        point = AssetUser(company_id=w["co"], code="INS-GATE", name="Gate", asset_user_type="INSTALLED", location_id=w["loc"],
                          role="SELF_SERVICE")
        s.add(point)
        await s.commit()
        return point.id


# ---------------------------------------------------------------- batch add

async def test_batch_straight_to_an_install_point_is_recorded_installed(client):
    w = await build_s4_world()
    point = await install_point(w)
    resp = await batch(client, await login(client, w, "admin"), w, "gangbox", 2, received_into_asset_user_id=point)
    assert resp.status_code == 201, resp.text
    async with SessionLocal() as s:
        rows = (await s.execute(select(Asset.status, Asset.current_asset_user_id))).all()
        events = (await s.execute(select(AssetEvent.status_after, AssetEvent.to_asset_user_name_snapshot))).all()
    assert set(rows) == {("INSTALLED", point)} and set(events) == {("INSTALLED", "Gate")}


async def test_batch_serial_length_later_mode_and_matching_company(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    long = await batch(client, h, w, "camera", 2, serial_numbers=["OK-1", "X" * 201])
    assert long.status_code == 422
    assert long.json()["problems"] == [{"unit_index": 2, "serial": "X" * 50, "message": "This serial number is too long (max 200 characters)."}]
    later = await batch(client, h, w, "ap", 1, serial_numbers=["AP-1"])
    assert later.json()["detail"].startswith("These assets are set to serial number later")
    same_company = await batch(client, h, w, "gangbox", 1, company_id=w["co"])
    assert same_company.status_code == 201


async def test_batch_roles_head_office_and_one_area_admins(client):
    w = await build_s4_world()
    assert (await batch(client, await login(client, w, "owner"), w, "chair", 1)).status_code == 201
    assert (await batch(client, await login(client, w, "owner"), w, "gangbox", 1)).status_code == 201
    assert (await batch(client, await login(client, w, "admin_it"), w, "chair", 1)).status_code == 403
    async with SessionLocal() as s:
        await s.execute(update(AssetUser).where(AssetUser.id == w["employee"]).values(
            login_enabled=True, must_change_password=False, password_hash=hash_password("Passw0rd!")))
        await s.commit()
    assert (await batch(client, await login(client, w, "employee"), w, "gangbox", 1)).status_code == 403


# ---------------------------------------------------------------- people & places

async def test_the_head_office_admin_can_make_a_full_admin_for_both_areas(client):
    w = await build_s4_world()
    resp = await client.post("/api/people/employees", headers=await login(client, w, "owner"), json={
        "code": "BOSS", "name": "New Admin", "company_id": w["co"], "location_id": w["loc"],
        "login": {"enabled": True, "role": "ADMIN", "work_area": "both"}})
    assert resp.status_code == 201, resp.text
    assert (resp.json()["role_label"], resp.json()["work_area"], resp.json()["work_area_label"]) == ("Full Admin", "BOTH", "IT and Non-IT")


async def test_inactive_company_department_and_wrong_places_are_refused(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    async with SessionLocal() as s:
        dept = Department(name="Closed Dept", is_active=False)
        s.add(dept)
        await s.commit()
        dept_id = dept.id
        loc_b = (await s.execute(select(Location.id).where(Location.company_id == w["co_b"]))).scalars().first()
    base = {"code": "E1", "name": "X", "company_id": w["co"], "location_id": w["loc"]}
    gone = await client.post("/api/people/employees", headers=h, json={**base, "department_id": dept_id})
    assert gone.json()["detail"] == "The department you chose does not exist or is no longer active."
    no_company = await client.post("/api/people/employees", headers=h, json={**base, "company_id": 999999})
    assert no_company.status_code == 422 and no_company.json()["detail"] == "The company you chose does not exist or is no longer active."
    store_wrong = await client.post("/api/people/stores", headers=h, json={"code": "QQQ", "name": "Q", "company_id": w["co"], "location_id": loc_b})
    assert store_wrong.json()["detail"] == "The location must belong to the same company as the store."
    store_named = await client.post("/api/people/stores", headers=h, json={"code": "PPP", "name": "P", "company_id": w["co_b"], "location_name": "Patna"})
    assert store_named.status_code == 201 and store_named.json()["store"]["location_name"] == "Patna"
    point_wrong = await client.post("/api/people/install-points", headers=h, json={"name": "Gate", "company_id": w["co"], "location_id": loc_b})
    assert point_wrong.json()["detail"] == "The location must belong to the same company as the install point."
    point_nowhere = await client.post("/api/people/install-points", headers=h, json={"name": "Gate", "company_id": w["co"]})
    assert point_nowhere.json()["detail"] == "Choose where the install point is, or type the name of the place."


async def test_the_list_shows_every_kind_without_inactive_ones_and_searches_email(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    await client.post("/api/people/stores", headers=h, json={"code": "LAM", "name": "Lucknow", "company_id": w["co"]})
    rows = (await client.get("/api/people", headers=h, params={"limit": 1000})).json()
    assert {r["kind_label"] for r in rows} == {"Employee", "Store", "Stock Room", "Install Point"}
    assert "S0STKX" not in {r["code"] for r in rows}                              # deactivated
    found = (await client.get("/api/people", headers=h, params={"q": "citykartstores"})).json()
    assert [r["code"] for r in found] == ["LAM"]


# ---------------------------------------------------------------- issuing passwords

async def test_issuing_unlocks_a_locked_account_and_filters_by_company(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        loc_b = (await s.execute(select(Location.id).where(Location.company_id == w["co_b"]))).scalars().first()
        s.add(AssetUser(company_id=w["co"], code="LAM", name="Lam", asset_user_type="STORE", location_id=w["loc"], role="SELF_SERVICE",
                        login_enabled=True, email="sm.lam@citykartstores.com", failed_login_count=5,
                        locked_until=datetime.now(timezone.utc) + timedelta(minutes=10)))
        s.add(AssetUser(company_id=w["co_b"], code="BBB", name="Bbb", asset_user_type="STORE", location_id=loc_b, role="SELF_SERVICE",
                        login_enabled=True, email="sm.bbb@citykartstores.com"))
        await s.commit()
    h = await login(client, w, "admin")
    only_b = await client.post("/api/asset-users/issue-passwords", headers=h, json={"kind": "stores", "company_id": w["co_b"]})
    assert [r["code"] for r in only_b.json()] == ["BBB"]
    lam = await client.post("/api/asset-users/issue-passwords", headers=h, json={"kind": "stores"})
    assert [r["code"] for r in lam.json()] == ["LAM"]
    async with SessionLocal() as s:
        row = (await s.execute(select(AssetUser).where(AssetUser.code == "LAM"))).scalar_one()
    assert (row.failed_login_count, row.locked_until, row.must_change_password) == (0, None, True)
    signed = await client.post("/api/auth/login", json={"login_id": "LAM", "password": lam.json()[0]["temp_password"]})
    assert signed.status_code == 200


async def test_ids_and_kind_narrow_each_other(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    resp = await client.post("/api/asset-users/issue-passwords", headers=h,
                             json={"asset_user_ids": [w["op_it"]], "kind": "stores", "only_without_password": False})
    assert resp.status_code == 200 and resp.json() == []


# ---------------------------------------------------------------- search corners

async def test_search_with_a_holder_kind_and_exact_erp_or_code_ending(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = (await batch(client, h, w, "camera", 2, serial_numbers=serials("Q", 2), description="Lobby cam")).json()["assets"]
    async with SessionLocal() as s:
        await s.execute(update(Asset).where(Asset.id == made[0]["asset_id"]).values(erp_item_code="CT1001"))
        await s.execute(update(Asset).where(Asset.id == made[1]["asset_id"]).values(erp_item_code="CT10011"))
        await s.commit()
    codes = lambda r: [a["asset_code"] for a in r.json()["items"]]   # noqa: E731
    assert codes(await client.get("/api/assets", headers=h, params={"q": "ct1001", "exact": "true"})) == [made[0]["asset_code"]]
    assert codes(await client.get("/api/assets", headers=h, params={"q": "ct1001"})) == [made[0]["asset_code"], made[1]["asset_code"]]
    assert codes(await client.get("/api/assets", headers=h, params={"q": "002", "exact": "true"})) == [made[1]["asset_code"]]
    assert codes(await client.get("/api/assets", headers=h, params={"q": "lobby", "holder_type": "EMPLOYEE"})) == []
    assert len(codes(await client.get("/api/assets", headers=h, params={"q": "lobby", "holder_type": "STOCK_POINT"}))) == 2


async def test_an_asset_held_by_a_store_says_store(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    async with SessionLocal() as s:
        store = AssetUser(company_id=w["co"], code="LAM", name="Lucknow store", asset_user_type="STORE", location_id=w["loc"], role="SELF_SERVICE")
        s.add(store)
        await s.commit()
        store_id = store.id
    made = (await batch(client, h, w, "gangbox", 1, received_into_asset_user_id=store_id)).json()["assets"][0]
    detail = (await client.get(f"/api/assets/{made['asset_id']}", headers=h)).json()
    assert (detail["holder_kind_label"], detail["holder_name"], detail["holder_code"], detail["status"]) == (
        "Store", "Lucknow store", "LAM", "ALLOTTED")


# ---------------------------------------------------------------- link-tool corners

async def test_one_item_in_the_group_is_a_stronger_hint_and_an_asset_without_sub_category_fits_its_category(client):
    w = await build_s4_world()
    fake = FakeErp()
    app.dependency_overrides[get_erp_source] = lambda: fake
    try:
        h = await login(client, w, "admin")
        chair = await make_asset(client, h, w, "nonit", description="Wooden thing")
        loose = await make_asset(client, h, w, description="Gang box spare", serial_number="LOOSE-1")
        async with SessionLocal() as s:
            await s.execute(update(Asset).where(Asset.id == loose["id"]).values(subcategory_id=None))
            await s.commit()
        rows = {r["asset_id"]: r for r in (await client.get("/api/assets/unlinked-items", headers=h)).json()}
        assert rows[chair["id"]]["suggestions"] == [{"item_id": w["item_chair"], "item_name": "Office Chair", "score": 0.4, "reason": "GROUP"}]
        assert rows[loose["id"]]["suggestions"][0] == {"item_id": w["item_gangbox"], "item_name": "Gang Box", "score": 0.85, "reason": "DESCRIPTION"}  # S7 fix 2: non-exact capped at 0.85
        linked = await client.post("/api/assets/link-items", headers=h, json=[{"asset_id": loose["id"], "item_id": w["item_camera"]}])
        assert linked.status_code == 200                                     # any Item of its Category fits
        async with SessionLocal() as s:
            assert (await s.get(Asset, loose["id"])).subcategory_id is None
    finally:
        app.dependency_overrides.pop(get_erp_source, None)


async def test_linking_to_an_item_of_another_work_area_is_refused_for_a_one_area_admin(client):
    w = await build_s4_world()
    owner = await login(client, w, "owner")
    asset = await make_asset(client, owner, w, serial_number="ODD-1")
    async with SessionLocal() as s:
        await s.execute(update(Asset).where(Asset.id == asset["id"]).values(asset_domain="NON_IT"))   # corrected to Non-IT earlier
        await s.commit()
    it_admin = await login(client, w, "admin_it")
    resp = await client.post("/api/assets/link-items", headers=it_admin, json=[{"asset_id": asset["id"], "item_id": w["item_camera"]}])
    assert resp.json()["problems"][0]["message"] == "This asset was not found."           # its work area is not theirs


# ---------------------------------------------------------------- more corners

async def test_a_search_page_costs_the_same_statements_however_many_rows(client):
    from tests.purchase_orders.s4_world import Statements
    w = await build_s4_world()
    h = await login(client, w, "admin")
    await batch(client, h, w, "gangbox", 3)
    with Statements() as few:
        await client.get("/api/assets", headers=h, params={"q": "gang", "limit": 200})
    await batch(client, h, w, "gangbox", 120)
    with Statements() as many:
        resp = await client.get("/api/assets", headers=h, params={"q": "gang", "limit": 200})
    assert resp.json()["total"] == 123 and many.count == few.count


async def test_hidden_control_characters_in_a_batch_are_refused(client):
    w = await build_s4_world()
    resp = await batch(client, await login(client, w, "admin"), w, "camera", 1, serial_numbers=["A\x00B"])
    assert resp.status_code == 422 and "hidden control characters" in resp.json()["detail"]


async def test_an_erp_store_whose_room_code_is_taken_is_still_created_and_the_problem_reported(client):
    from tests.erp.test_erp_api import _headers, _setup
    from tests.erp.test_erp_stores import seed_sites
    ids = await _setup()
    await seed_sites()
    async with SessionLocal() as s:
        loc = (await s.execute(select(Location).where(Location.company_id == ids["spl"]))).scalars().first()
        s.add(AssetUser(company_id=ids["spl"], code="INS-LAM", name="Someone", asset_user_type="EMPLOYEE", location_id=loc.id,
                        role="SELF_SERVICE"))
        await s.commit()
    resp = await client.post("/api/erp/stores/create", headers=await _headers(client), json={"company_id": ids["spl"], "codes": ["LAM"]})
    out = resp.json()
    assert out["created"] == ["LAM"] and (out["stock_rooms_created"], out["install_points_created"]) == (1, 0)
    assert out["rooms"][0]["problems"] == ["The code INS-LAM is already used by Someone, so the install point of store LAM was not made."]


async def test_the_backfill_can_be_limited_to_one_company(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        loc_b = (await s.execute(select(Location.id).where(Location.company_id == w["co_b"]))).scalars().first()
        s.add(AssetUser(company_id=w["co"], code="AAA", name="A", asset_user_type="STORE", location_id=w["loc"], role="SELF_SERVICE"))
        s.add(AssetUser(company_id=w["co_b"], code="BBB", name="B", asset_user_type="STORE", location_id=loc_b, role="SELF_SERVICE"))
        await s.commit()
    out = (await client.post("/api/people/stores/ensure-rooms", headers=await login(client, w, "owner"),
                             params={"company_id": w["co_b"]})).json()
    assert (out["stores_checked"], out["stock_rooms_created"], out["install_points_created"]) == (1, 1, 1)


async def test_pick_leaves_out_assets_deleted_as_mistakes(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = (await batch(client, h, w, "gangbox", 2)).json()["assets"]
    assert (await client.delete(f"/api/assets/{made[0]['asset_id']}", headers=h)).status_code == 204
    resp = await client.get("/api/assets/pick", headers=h, params={"item_id": w["item_gangbox"], "asset_user_id": w["stock"], "quantity": 5})
    assert [r["asset_id"] for r in resp.json()] == [made[1]["asset_id"]] and resp.headers["X-Total-Count"] == "1"


async def test_paging_past_the_end_of_the_people_list_is_empty(client):
    w = await build_s4_world()
    resp = await client.get("/api/people", headers=await login(client, w, "admin"), params={"kind": "stock-rooms", "offset": 50})
    assert resp.json() == [] and int(resp.headers["X-Total-Count"]) == 3


async def test_capabilities_leave_out_inactive_companies_and_items_mine_is_everything_for_a_both_area_admin(client):
    w = await build_s4_world()
    from app.masters.models import Company
    async with SessionLocal() as s:
        s.add(Company(code="OLDC", name="Old company", is_active=False))
        await s.commit()
    admin = await login(client, w, "admin")
    caps = (await client.get("/api/auth/capabilities", headers=admin)).json()
    assert [c["code"] for c in caps["companies"]] == ["S0A", "S0B"]
    assert len((await client.get("/api/items", headers=admin, params={"work_area": "mine"})).json()) == 4


async def test_the_register_search_still_refuses_a_bad_ids_list_and_keeps_its_old_filters(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = (await batch(client, h, w, "gangbox", 2)).json()["assets"]
    by_ids = await client.get("/api/assets", headers=h, params={"ids": f"{made[0]['asset_id']}"})
    assert [a["id"] for a in by_ids.json()["items"]] == [made[0]["asset_id"]]
    assert (await client.get("/api/assets", headers=h, params={"ids": "x"})).status_code == 422
    holder = await client.get("/api/assets", headers=h, params={"asset_user_id": w["stock"], "domain": "IT"})
    assert holder.json()["total"] == 2


# ---------------------------------------------------------------- preview columns

async def test_preview_columns_include_extra_fields_held_only_off_the_page_and_q_means_the_same(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    async with SessionLocal() as s:
        s.add(CustomField(field_key="rack", label="Rack", field_type="text", company_id=w["co_b"]))
        await s.commit()
    assert (await batch(client, h, w, "gangbox", 1, cost_center_id=w["cc_b"], received_into_asset_user_id=w["stock_b"],
                        custom_fields={"rack": "R1"})).status_code == 201
    assert (await batch(client, h, w, "gangbox", 3)).status_code == 201
    preview = (await client.get("/api/reports/assets/preview", headers=h, params={"limit": 1})).json()
    assert "Custom:rack" in preview["columns"] and preview["rows"][0]["Custom:rack"] is None
    ws = openpyxl.load_workbook(BytesIO((await client.get("/api/reports/export/assets", headers=h)).content)).active
    assert list(next(ws.values)) == preview["columns"]
    q = (await client.get("/api/reports/assets/preview", headers=h, params={"q": "B Stock"})).json()
    assert q["total"] == 1 and q["rows"][0]["Current AssetUser"] == "B Stock"
    bad = await client.get("/api/reports/assets/preview", headers=h, params={"work_area": "HR"})
    assert bad.status_code == 422
