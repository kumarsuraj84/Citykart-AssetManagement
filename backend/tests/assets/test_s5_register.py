"""S5: the register's richer rows (Item, who holds it in words, company code, work area...) from one label
query, the one search box (code, serial, barcode, ERP code, Item, vendor, PO, text, brand, holder) with exact
-> starts-with -> contains ranking, the new filters, and "take N of an Item from a stock room" (pick)."""
from sqlalchemy import select, update

from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Brand, Vendor
from tests.purchase_orders.s4_world import Statements, build_s4_world, login, serials


async def batch(client, h, w, item, quantity, **over) -> list[dict]:
    payload = {"item_id": w[f"item_{item}"], "quantity": quantity, "received_into_asset_user_id": w["stock"],
               "cost_center_id": w["cc"], **over}
    resp = await client.post("/api/assets/batch", headers=h, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["assets"]


async def set_fields(asset_id: int, **values) -> None:
    async with SessionLocal() as s:
        await s.execute(update(Asset).where(Asset.id == asset_id).values(**values))
        await s.commit()


async def move(client, h, asset_id, to):
    resp = await client.post(f"/api/assets/{asset_id}/events", headers=h, json={"event_type": "MOVED", "to_asset_user_id": to})
    assert resp.status_code in (200, 201), resp.text


async def search(client, h, **params) -> list[str]:
    resp = await client.get("/api/assets", headers=h, params=params)
    assert resp.status_code == 200, resp.text
    return [a["asset_code"] for a in resp.json()["items"]]


async def world_with_assets(client):
    """Cameras 001-003 (serials CAM-0001..3), a gang box 004 (moved to Ravi Kumar), a chair (Non-IT) 001."""
    w = await build_s4_world()
    h = await login(client, w, "admin")
    cams = await batch(client, h, w, "camera", 3, serial_numbers=serials("CAM", 3), vendor_id=w["vendor"], po_number="PO-CAM",
                       description="CCTV unit")
    box = (await batch(client, h, w, "gangbox", 1))[0]
    chair = (await batch(client, h, w, "chair", 1, brand_id=w["brand"], model="Ergo 5"))[0]
    await set_fields(cams[0]["asset_id"], erp_item_code="CT324973", barcode="BC-77")
    await move(client, h, box["asset_id"], w["employee"])
    async with SessionLocal() as s:
        s.add(Vendor(code="OTHERV", name="Spare Parts House"))
        await s.commit()
    return w, h, cams, box, chair


async def test_rows_carry_item_holder_company_and_work_area_in_words(client):
    w, h, cams, box, chair = await world_with_assets(client)
    rows = {a["asset_code"]: a for a in (await client.get("/api/assets", headers=h)).json()["items"]}
    cam = rows[cams[0]["asset_code"]]
    assert (cam["item_id"], cam["item_name"], cam["erp_item_code"], cam["vendor_name"], cam["po_number"]) == (
        w["item_camera"], "Indoor Camera", "CT324973", "Good Vendor", "PO-CAM")
    assert (cam["holder_type"], cam["holder_kind_label"], cam["holder_name"], cam["holder_code"], cam["holder_location_name"]) == (
        "STOCK_POINT", "Stock Room", "Main Stock", "S0STK", "HO")
    assert (cam["company_code"], cam["company_name"], cam["work_area"], cam["work_area_label"]) == ("S0A", "S0 Company A", "IT", "IT")
    moved = rows[box["asset_code"]]
    assert (moved["holder_type"], moved["holder_kind_label"], moved["holder_name"]) == ("EMPLOYEE", "Employee", "Ravi Kumar")
    assert (moved["current_asset_user_name"], moved["current_asset_user_type"]) == ("Ravi Kumar", "EMPLOYEE")   # older names kept
    seat = rows[chair["asset_code"]]
    assert (seat["work_area"], seat["work_area_label"], seat["brand_name"], seat["category_name"], seat["subcategory_name"]) == (
        "NON_IT", "Non-IT", "Dell", "Furniture", "Chair")
    detail = (await client.get(f"/api/assets/{cams[0]['asset_id']}", headers=h)).json()
    for key in ("item_name", "holder_kind_label", "holder_name", "holder_code", "company_code", "work_area", "vendor_name"):
        assert detail[key] == cam[key]
    assert detail["location_name"] == "HO" and detail["department_name"] == "S0 Dept"


async def test_a_page_of_100_costs_the_same_statements_as_a_page_of_5(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    await batch(client, h, w, "gangbox", 5)
    with Statements() as few:
        assert (await client.get("/api/assets", headers=h, params={"limit": 200})).json()["total"] == 5
    await batch(client, h, w, "camera", 95, serial_numbers=serials("N", 95))
    await batch(client, h, w, "chair", 5)
    with Statements() as many:
        assert len((await client.get("/api/assets", headers=h, params={"limit": 200})).json()["items"]) == 105
    assert many.count == few.count
    with Statements() as one:
        await client.get(f"/api/assets/{1}", headers=h)
    assert one.count <= few.count


async def test_one_search_box_finds_every_kind_of_value(client):
    w, h, cams, box, chair = await world_with_assets(client)
    first = cams[0]["asset_code"]
    assert await search(client, h, q=first) == [first]                              # asset code
    assert await search(client, h, q="cam-0002") == [cams[1]["asset_code"]]         # serial, any case
    assert await search(client, h, q="bc-77") == [first]                            # barcode
    assert await search(client, h, q="CT324973") == [first]                         # ERP item code
    assert set(await search(client, h, q="indoor cam")) == {c["asset_code"] for c in cams}   # Item name
    assert set(await search(client, h, q="good vendor")) == {c["asset_code"] for c in cams}  # vendor name
    assert set(await search(client, h, q="PO-CAM")) == {c["asset_code"] for c in cams}       # PO number
    assert await search(client, h, q="gang") == [box["asset_code"]]                 # description (Item name default)
    assert await search(client, h, q="dell") == [chair["asset_code"]]               # brand
    assert await search(client, h, q="ergo") == [chair["asset_code"]]              # model
    assert await search(client, h, q="ravi kumar") == [box["asset_code"]]          # holder name
    assert await search(client, h, q="S0EMP") == [box["asset_code"]]               # holder code
    assert await search(client, h, q="spare parts") == []                           # a vendor nobody bought from


async def test_exact_matches_come_first_then_starting_with_then_containing(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = await batch(client, h, w, "gangbox", 3)
    a, b, c = (m["asset_id"] for m in made)
    await set_fields(a, description="Box with LAP-9 inside")      # contains
    await set_fields(b, barcode="LAP-9X")                         # starts with
    await set_fields(c, serial_number="lap-9")                    # exact (any case)
    codes = {m["asset_id"]: m["asset_code"] for m in made}
    assert await search(client, h, q="LAP-9") == [codes[c], codes[b], codes[a]]
    # an explicit sort still wins; exact=true keeps only the exact one
    assert await search(client, h, q="LAP-9", sort_by="asset_code", sort_dir="asc") == [codes[a], codes[b], codes[c]]
    assert await search(client, h, q="lap-9", exact="true") == [codes[c]]


async def test_typed_wildcards_match_themselves_and_long_text_is_refused(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = await batch(client, h, w, "gangbox", 2)
    await set_fields(made[0]["asset_id"], description="100% cotton_cover")
    assert await search(client, h, q="100%") == [made[0]["asset_code"]]
    assert await search(client, h, q="n_c") == [made[0]["asset_code"]]
    assert await search(client, h, q="%") == [made[0]["asset_code"]]
    assert (await client.get("/api/assets", headers=h, params={"q": "x" * 201})).status_code == 422


async def test_new_filters_holder_kind_vendor_po_holder_and_work_area(client):
    w, h, cams, box, chair = await world_with_assets(client)
    all_cams = {c["asset_code"] for c in cams}
    assert await search(client, h, holder_type="employee") == [box["asset_code"]]
    assert set(await search(client, h, holder_type="Stock Room")) == all_cams | {chair["asset_code"]}
    assert set(await search(client, h, vendor_id=w["vendor"])) == all_cams
    assert set(await search(client, h, po_number=" po-cam ")) == all_cams
    assert await search(client, h, po_number="PO-CA") == []                       # a whole PO number, not part of one
    assert await search(client, h, holder_id=w["employee"]) == [box["asset_code"]]
    assert await search(client, h, work_area="non-it") == [chair["asset_code"]]
    bad = await client.get("/api/assets", headers=h, params={"holder_type": "holder"})
    assert bad.status_code == 422 and bad.json()["detail"] == "Choose who holds it: an employee, a store, a stock room or an install point."
    bad_area = await client.get("/api/assets", headers=h, params={"work_area": "HR"})
    assert bad_area.status_code == 422 and bad_area.json()["detail"] == "Choose a work area: IT or Non-IT."


async def test_search_never_reaches_past_the_callers_companies_or_work_area(client):
    w, h, cams, box, chair = await world_with_assets(client)
    b_asset = (await batch(client, h, w, "gangbox", 1, cost_center_id=w["cc_b"], received_into_asset_user_id=w["stock_b"]))[0]
    op = await login(client, w, "op_it")
    assert await search(client, op, q="dell") == []                       # the chair is Non-IT
    assert await search(client, op, q="B Stock") == []                    # the company-B asset's holder
    # a work-area filter outside the caller's own cannot widen it (it is ignored, as `domain` always was)
    assert chair["asset_code"] not in await search(client, op, work_area="NON_IT")
    assert b_asset["asset_code"] in await search(client, h, q="B Stock")
    # a self-service login only ever sees what it holds, whatever holder it asks for
    async with SessionLocal() as s:
        ravi = await s.get(AssetUser, w["employee"])
        ravi.role, ravi.login_enabled, ravi.must_change_password = "SELF_SERVICE", True, False
        ravi.password_hash = hash_password("Passw0rd!")
        await s.commit()
    me = await login(client, w, "employee")
    assert await search(client, me, holder_id=w["stock"]) == [box["asset_code"]]


async def test_pick_takes_the_oldest_in_stock_assets_of_an_item_from_a_stock_room(client):
    w = await build_s4_world()
    h = await login(client, w, "op_it")
    made = await batch(client, h, w, "camera", 5, serial_numbers=serials("PK", 5))
    await batch(client, h, w, "gangbox", 2)                                    # another Item
    await move(client, h, made[0]["asset_id"], w["employee"])                 # no longer in stock
    other_room = await batch(client, h, w, "camera", 1, serial_numbers=["PK-OTHER"], received_into_asset_user_id=w["stock2"])
    resp = await client.get("/api/assets/pick", headers=h,
                            params={"item_id": w["item_camera"], "asset_user_id": w["stock"], "quantity": 3})
    assert resp.status_code == 200, resp.text
    assert resp.json() == [{"asset_id": m["asset_id"], "asset_code": m["asset_code"], "serial_number": m["serial_number"]}
                           for m in made[1:4]]
    assert resp.headers["X-Total-Count"] == "4"
    more = await client.get("/api/assets/pick", headers=h, params={"item_id": w["item_camera"], "asset_user_id": w["stock"], "quantity": 10})
    assert len(more.json()) == 4
    assert other_room[0]["asset_id"] not in [r["asset_id"] for r in more.json()]


async def test_pick_scope_roles_and_limits(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    await batch(client, admin, w, "chair", 2)
    params = {"item_id": w["item_chair"], "asset_user_id": w["stock"], "quantity": 2}
    assert (await client.get("/api/assets/pick", headers=await login(client, w, "op_it"), params=params)).json() == []   # Non-IT
    assert len((await client.get("/api/assets/pick", headers=await login(client, w, "op_nonit"), params=params)).json()) == 2
    other = await client.get("/api/assets/pick", headers=await login(client, w, "op_it"),
                             params={**params, "asset_user_id": w["stock_b"]})
    assert other.status_code == 404 and other.json()["detail"] == "This stock room was not found."
    assert (await client.get("/api/assets/pick", headers=await login(client, w, "viewer_it"), params=params)).status_code == 403
    assert (await client.get("/api/assets/pick", headers=admin, params={**params, "quantity": 0})).status_code == 422
    assert (await client.get("/api/assets/pick", headers=admin, params={**params, "quantity": 1001})).status_code == 422


async def test_the_fixed_asset_paths_do_not_clash_with_asset_ids(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = await batch(client, h, w, "gangbox", 1)
    assert (await client.get(f"/api/assets/{made[0]['asset_id']}", headers=h)).status_code == 200
    assert (await client.get("/api/assets/unlinked-items", headers=h)).status_code == 200
    async with SessionLocal() as s:
        brand = (await s.execute(select(Brand).where(Brand.id == w["brand"]))).scalar_one()
    assert brand.name == "Dell"
