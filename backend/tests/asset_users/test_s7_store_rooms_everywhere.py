"""S7 fix round: a store made through the general Asset User form (POST / PUT /api/asset-users) or the
people Excel import gets its Stock Room (STK-<code>) and Install Point (INS-<code>) exactly like
POST /api/people/stores -- the one shared app.asset_users.store_rooms.ensure_store_rooms."""
import io

import openpyxl
from sqlalchemy import func, select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from tests.purchase_orders.s4_world import build_s4_world, login

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
HEADER = ["Company Code", "Code", "Name", "Type", "Location Code", "Department", "Email", "Phone", "Role"]


def store_body(w, code="LKO", **over):
    body = {"company_id": w["co"], "code": code, "name": f"Store {code}", "asset_user_type": "STORE", "location_id": w["loc"],
            "role": "SELF_SERVICE"}
    body.update(over)
    return body


async def by_code(company_id: int, code: str) -> AssetUser | None:
    async with SessionLocal() as s:
        return (await s.execute(select(AssetUser).where(AssetUser.company_id == company_id, AssetUser.code == code))).scalars().first()


async def count_people() -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(AssetUser))).scalar_one()


async def test_a_store_made_on_the_general_form_gets_its_two_rooms(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    resp = await client.post("/api/asset-users", headers=h, json=store_body(w))
    assert resp.status_code == 201, resp.text
    assert resp.json()["rooms_created"] == ["stock_room", "install_point"]
    store = await by_code(w["co"], "LKO")
    stock, install = await by_code(w["co"], "STK-LKO"), await by_code(w["co"], "INS-LKO")
    assert (stock.asset_user_type, stock.name, stock.location_id, stock.login_enabled) == ("STOCK_POINT", "Store LKO Stock Room", store.location_id, False)
    assert (install.asset_user_type, install.name) == ("INSTALLED", "Store LKO Install Point")


async def test_the_rooms_are_the_same_as_add_store_makes(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    assert (await client.post("/api/asset-users", headers=h, json=store_body(w, "AAA"))).status_code == 201
    assert (await client.post("/api/people/stores", headers=h, json={"company_id": w["co"], "code": "BBB", "name": "Store BBB",
                                                                      "location_id": w["loc"]})).status_code == 201
    for code in ("AAA", "BBB"):
        stock, install = await by_code(w["co"], f"STK-{code}"), await by_code(w["co"], f"INS-{code}")
        assert (stock.asset_user_type, stock.name, stock.role) == ("STOCK_POINT", f"Store {code} Stock Room", "SELF_SERVICE")
        assert (install.asset_user_type, install.name, install.role) == ("INSTALLED", f"Store {code} Install Point", "SELF_SERVICE")


async def test_rooms_that_already_exist_are_reused(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    made = await client.post("/api/asset-users", headers=h, json={**store_body(w, "STK-PNP"), "name": "Panipat Stock Room",
                                                                  "asset_user_type": "STOCK_POINT"})
    assert made.status_code == 201 and made.json()["rooms_created"] == []
    resp = await client.post("/api/asset-users", headers=h, json=store_body(w, "PNP"))
    assert resp.status_code == 201 and resp.json()["rooms_created"] == ["install_point"]
    assert (await by_code(w["co"], "STK-PNP")).name == "Panipat Stock Room"                 # never changed


async def test_a_room_code_used_by_something_else_refuses_the_store_and_saves_nothing(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    assert (await client.post("/api/asset-users", headers=h, json={**store_body(w, "STK-AGR"), "name": "Agra Person",
                                                                   "asset_user_type": "EMPLOYEE"})).status_code == 201
    before = await count_people()
    resp = await client.post("/api/asset-users", headers=h, json=store_body(w, "AGR"))
    assert resp.status_code == 422
    assert resp.json()["detail"] == "The code STK-AGR is already used by Agra Person, so the stock room of store AGR was not made."
    assert await count_people() == before and await by_code(w["co"], "AGR") is None


async def test_a_store_code_too_long_for_its_room_codes_is_a_sentence_not_an_error(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    long_code = "S" * 48
    resp = await client.post("/api/asset-users", headers=h, json=store_body(w, long_code))
    assert resp.status_code == 422 and "is too long to make the stock room code" in resp.json()["detail"]
    assert await by_code(w["co"], long_code) is None


async def test_people_who_are_not_stores_get_no_rooms(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    before = await count_people()
    resp = await client.post("/api/asset-users", headers=h, json={**store_body(w, "EMP77"), "asset_user_type": "EMPLOYEE"})
    assert resp.status_code == 201 and resp.json()["rooms_created"] == []
    assert await count_people() == before + 1


async def test_turning_a_record_into_a_store_gives_it_its_rooms_once(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    made = await client.post("/api/asset-users", headers=h, json={**store_body(w, "MRT"), "asset_user_type": "EMPLOYEE"})
    assert made.status_code == 201
    uid = made.json()["id"]
    changed = await client.put(f"/api/asset-users/{uid}", headers=h, json={"asset_user_type": "STORE"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["asset_user_type"] == "STORE" and changed.json()["rooms_created"] == ["stock_room", "install_point"]
    again = await client.put(f"/api/asset-users/{uid}", headers=h, json={"phone": "9999999999"})
    assert again.status_code == 200 and again.json()["rooms_created"] == []
    assert await by_code(w["co"], "STK-MRT") is not None and await by_code(w["co"], "INS-MRT") is not None


async def test_turning_into_a_store_whose_room_code_is_taken_changes_nothing(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    assert (await client.post("/api/asset-users", headers=h, json={**store_body(w, "INS-BRL"), "name": "Someone",
                                                                   "asset_user_type": "EMPLOYEE"})).status_code == 201
    made = await client.post("/api/asset-users", headers=h, json={**store_body(w, "BRL"), "asset_user_type": "EMPLOYEE"})
    resp = await client.put(f"/api/asset-users/{made.json()['id']}", headers=h, json={"asset_user_type": "STORE"})
    assert resp.status_code == 422 and "INS-BRL is already used by Someone" in resp.json()["detail"]
    assert (await by_code(w["co"], "BRL")).asset_user_type == "EMPLOYEE" and await by_code(w["co"], "STK-BRL") is None


async def test_stores_imported_from_excel_get_their_rooms(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    assert (await client.post("/api/asset-users", headers=h, json={**store_body(w, "STK-BAD"), "name": "Taken",
                                                                   "asset_user_type": "EMPLOYEE"})).status_code == 201
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(HEADER)
    ws.append(["S0A", "XL1", "Excel Store One", "STORE", "S0-HO", None, None, None, "SELF_SERVICE"])
    ws.append(["S0A", "BAD", "Excel Store Two", "STORE", "S0-HO", None, None, None, "SELF_SERVICE"])
    ws.append(["S0A", "XLEMP", "Excel Employee", "EMPLOYEE", "S0-HO", None, None, None, "SELF_SERVICE"])
    buf = io.BytesIO()
    wb.save(buf)
    resp = await client.post("/api/asset-users/import/commit", headers=h,
                             files={"file": ("people.xlsx", io.BytesIO(buf.getvalue()), XLSX)})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 2
    assert body["errors"] == [{"row": 3, "message": "The code STK-BAD is already used by Taken, so the stock room of store BAD was not made."}]
    assert await by_code(w["co"], "STK-XL1") is not None and await by_code(w["co"], "INS-XL1") is not None
    assert await by_code(w["co"], "BAD") is None and await by_code(w["co"], "INS-BAD") is None      # that row undone whole
    assert await by_code(w["co"], "STK-XLEMP") is None
