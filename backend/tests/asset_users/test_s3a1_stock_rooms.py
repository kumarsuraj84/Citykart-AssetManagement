"""S3a-1: a stock room (STOCK_POINT asset user) can be added in the flow by ADMIN
and OPERATOR for a company they work in, from a name and a place (an existing
Location, or a place name that is reused or created). Adding the same name
again returns the one that exists."""
import pytest
from sqlalchemy import func, select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.masters.models import Location
from tests.core.s3a1_world import ROLES, build_s3_world, login

CAN_ADD = {"owner", "admin", "admin_it", "admin_nonit", "op_it", "op_nonit"}


@pytest.mark.parametrize("who", ROLES)
async def test_who_may_add_a_stock_room(client, who):
    w = await build_s3_world()
    resp = await client.post("/api/stock-rooms", headers=await login(client, w, who),
                             json={"name": "Spare Room", "company_id": w["co"], "location_id": w["loc"]})
    assert resp.status_code == (201 if who in CAN_ADD else 403), resp.text


async def test_a_new_stock_room_looks_like_a_row_of_the_people_and_places_list(client):
    w = await build_s3_world()
    h = await login(client, w, "op_it")
    resp = await client.post("/api/stock-rooms", headers=h, json={"name": "  HO Stock Room ", "company_id": w["co"], "location_id": w["loc"]})
    assert resp.status_code == 201, resp.text
    room = resp.json()
    assert room["name"] == "HO Stock Room" and room["code"] == "STK-HOSTOCKROOM"
    assert room["asset_user_type"] == "STOCK_POINT" and room["login_enabled"] is False
    assert room["location_name"] == "HO" and room["company_code"] == "S0A" and room["company_id"] == w["co"]
    listed = (await client.get("/api/asset-users", headers=await login(client, w, "admin"))).json()
    same = next(r for r in listed if r["id"] == room["id"])
    # S5: the stock-room answer adds `created` (true here: a new room was made)
    assert set(same) | {"created"} == set(room) and room["created"] is True


async def test_the_same_name_again_returns_the_existing_stock_room(client):
    w = await build_s3_world()
    h = await login(client, w, "op_it")
    first = await client.post("/api/stock-rooms", headers=h, json={"name": "Farukhnagar", "company_id": w["co"], "location_name": "Farukhnagar"})
    again = await client.post("/api/stock-rooms", headers=h, json={"name": " farukhnagar ", "company_id": w["co"], "location_name": "Elsewhere"})
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    async with SessionLocal() as s:
        rooms = (await s.execute(select(func.count()).select_from(AssetUser).where(
            func.lower(AssetUser.name) == "farukhnagar", AssetUser.asset_user_type == "STOCK_POINT",
            AssetUser.company_id == w["co"]))).scalar_one()
        places = (await s.execute(select(func.count()).select_from(Location).where(Location.name == "Elsewhere"))).scalar_one()
    assert rooms == 1 and places == 0
    # the same name in ANOTHER company is a different stock room
    other = await client.post("/api/stock-rooms", headers=await login(client, w, "admin"),
                              json={"name": "Farukhnagar", "company_id": w["co_b"], "location_name": "Farukhnagar"})
    assert other.status_code == 201 and other.json()["id"] != first.json()["id"]
    assert other.json()["code"] == "STK-FARUKHNAGAR"


async def test_a_place_name_reuses_or_creates_a_location_of_that_company(client):
    w = await build_s3_world()
    h = await login(client, w, "op_nonit")
    reused = await client.post("/api/stock-rooms", headers=h, json={"name": "HO Store", "company_id": w["co"], "location_name": " ho "})
    assert reused.status_code == 201 and reused.json()["location_id"] == w["loc"]
    created = await client.post("/api/stock-rooms", headers=h, json={"name": "Tajnagar W/H", "company_id": w["co"], "location_name": "Tajnagar Warehouse"})
    assert created.status_code == 201
    async with SessionLocal() as s:
        location = await s.get(Location, created.json()["location_id"])
    assert location.company_id == w["co"] and location.name == "Tajnagar Warehouse" and location.code == "TAJNAGARWAREHOUSE"
    assert location.created_by == w["op_nonit"]
    # a location code that is taken (any case) gets a number
    async with SessionLocal() as s:
        s.add(Location(company_id=w["co"], code="patna", name="Old Patna code"))
        await s.commit()
    numbered = await client.post("/api/stock-rooms", headers=h, json={"name": "Patna Room", "company_id": w["co"], "location_name": "Patna"})
    async with SessionLocal() as s:
        assert (await s.get(Location, numbered.json()["location_id"])).code == "PATNA-2"


async def test_stock_room_codes_never_clash(client):
    w = await build_s3_world()
    async with SessionLocal() as s:
        s.add(AssetUser(company_id=w["co"], code="stk-main", name="Older main", asset_user_type="EMPLOYEE", location_id=w["loc"]))
        await s.commit()
    h = await login(client, w, "admin")
    main = await client.post("/api/stock-rooms", headers=h, json={"name": "Main", "company_id": w["co"], "location_id": w["loc"]})
    assert main.status_code == 201 and main.json()["code"] == "STK-MAIN-2"
    long = await client.post("/api/stock-rooms", headers=h, json={"name": "A very long warehouse name indeed", "company_id": w["co"], "location_id": w["loc"]})
    assert long.json()["code"] == "STK-AVERYLONGWAREHOU" and len(long.json()["code"]) <= 20


async def test_company_scope_and_location_checks(client):
    w = await build_s3_world()
    op = await login(client, w, "op_it")
    other = await client.post("/api/stock-rooms", headers=op, json={"name": "B Room", "company_id": w["co_b"], "location_name": "B"})
    assert other.status_code == 403 and other.json()["detail"].startswith("You can only add a stock room for your own company.")
    wrong_place = await client.post("/api/stock-rooms", headers=await login(client, w, "admin"),
                                    json={"name": "Mixed", "company_id": w["co_b"], "location_id": w["loc"]})
    assert wrong_place.status_code == 422 and wrong_place.json()["detail"] == "The location must belong to the same company as the stock room."
    nowhere = await client.post("/api/stock-rooms", headers=op, json={"name": "Nowhere", "company_id": w["co"]})
    assert nowhere.status_code == 422 and nowhere.json()["detail"] == "Choose where the stock room is, or type the name of the place."
    blank = await client.post("/api/stock-rooms", headers=op, json={"name": "  ", "company_id": w["co"], "location_id": w["loc"]})
    assert blank.status_code == 422 and blank.json()["detail"] == "Name cannot be blank."


async def test_the_stock_room_picker_lists_active_rooms_of_the_callers_companies(client):
    w = await build_s3_world()
    op = await login(client, w, "op_it")
    rows = (await client.get("/api/stock-rooms", headers=op)).json()
    names = [r["name"] for r in rows]
    assert names == ["Main Stock", "Second Stock"]                      # not the closed one, not company B's
    assert {r["location_name"] for r in rows} == {"HO"} and {r["company_code"] for r in rows} == {"S0A"}
    assert (await client.get("/api/stock-rooms", headers=op, params={"company_id": w["co_b"]})).json() == []
    admin = await login(client, w, "admin")
    b_rows = (await client.get("/api/stock-rooms", headers=admin, params={"company_id": w["co_b"]})).json()
    assert [r["name"] for r in b_rows] == ["B Stock"]
    assert (await client.get("/api/stock-rooms", headers=await login(client, w, "viewer_it"))).status_code == 403
