"""Add Assets with a SET Item (POST /api/assets/batch): a Desktop or a Mouse+Keyboard combo is added as its
parts -- `quantity` assets of each part's own Item, as a PO does with a set -- and each part follows ITS Item's
serial rule (a mouse with no serial needs none; a CPU with one needs one per set)."""
from sqlalchemy import func, select

from app.assets.models import Asset
from app.bundles.models import Bundle, BundlePart
from app.core.db import SessionLocal
from app.items.models import Item
from app.lifecycle.models import AssetEvent
from tests.purchase_orders.s4_world import build_s4_world, login


async def make_set(w: dict, name: str, parts: list[tuple[str, str, bool, float]], **item_over) -> dict:
    """A set Item `name` made of parts [(part name, Item name, has serial, share %)]; returns ids by part name."""
    ids: dict = {}
    async with SessionLocal() as s:
        bundle = Bundle(name=name)
        s.add(bundle)
        await s.flush()
        for order, (part_name, item_name, has_serial, share) in enumerate(parts):
            part_item = Item(name=item_name, category_id=w["it"], subcategory_id=w["lap"], serial_required=has_serial)
            s.add(part_item)
            await s.flush()
            part = BundlePart(bundle_id=bundle.id, name=part_name, item_id=part_item.id, category_id=w["it"],
                              subcategory_id=w["lap"], share_percent=share, sort_order=order)
            s.add(part)
            await s.flush()
            ids[part_name] = {"item": part_item.id, "part": part.id}
        whole = Item(name=name, category_id=w["it"], subcategory_id=w["lap"], bundle_id=bundle.id, **item_over)
        s.add(whole)
        await s.flush()
        ids["_set"] = whole.id
        await s.commit()
    return ids


def body(w, set_item: int, quantity=1, **over) -> dict:
    out = {"item_id": set_item, "quantity": quantity, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]}
    out.update(over)
    return out


async def all_assets() -> list[Asset]:
    async with SessionLocal() as s:
        return list((await s.execute(select(Asset).order_by(Asset.id))).scalars().all())


async def count_assets() -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(Asset))).scalar_one()


async def test_a_mouse_keyboard_combo_becomes_one_mouse_and_one_keyboard_with_no_serials(client):
    w = await build_s4_world()
    ids = await make_set(w, "Mouse Keyboard Combo", [("Keyboard", "Keyboard", False, 60), ("Mouse", "Mouse", False, 40)])
    h = await login(client, w, "admin")
    resp = await client.post("/api/assets/batch", headers=h, json=body(w, ids["_set"], 1))
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert out["assets_created"] == 2 and out["serial_pending"] == 0 and out["set_name"] == "Mouse Keyboard Combo"
    rows = await all_assets()
    assert [a.item_id for a in rows] == [ids["Keyboard"]["item"], ids["Mouse"]["item"]]
    assert {a.serial_number for a in rows} == {"N/A"}
    assert [a.description for a in rows] == ["Keyboard", "Mouse"]
    assert not any(a.item_id == ids["_set"] for a in rows)
    async with SessionLocal() as s:
        events = (await s.execute(select(AssetEvent))).scalars().all()
    assert len(events) == 2 and {e.event_type for e in events} == {"PROCURED"}


async def test_three_combos_are_six_assets_three_of_each(client):
    w = await build_s4_world()
    ids = await make_set(w, "Combo", [("Keyboard", "Keyboard", False, 50), ("Mouse", "Mouse", False, 50)])
    resp = await client.post("/api/assets/batch", headers=await login(client, w, "admin"), json=body(w, ids["_set"], 3))
    assert resp.status_code == 201, resp.text
    rows = await all_assets()
    assert len(rows) == 6
    assert sum(a.item_id == ids["Keyboard"]["item"] for a in rows) == 3 and sum(a.item_id == ids["Mouse"]["item"] for a in rows) == 3


async def test_each_part_takes_serials_only_if_its_own_item_has_them(client):
    w = await build_s4_world()
    ids = await make_set(w, "Desktop", [("CPU", "CPU", True, 70), ("TFT", "TFT", True, 20), ("Mouse", "Mouse", False, 10)])
    h = await login(client, w, "admin")
    parts = {str(ids["CPU"]["part"]): ["CPU-1", "CPU-2"], str(ids["TFT"]["part"]): ["TFT-1", "TFT-2"]}
    resp = await client.post("/api/assets/batch", headers=h, json=body(w, ids["_set"], 2, part_serials=parts))
    assert resp.status_code == 201, resp.text
    rows = await all_assets()
    assert len(rows) == 6
    by_item = {}
    for a in rows:
        by_item.setdefault(a.item_id, []).append(a.serial_number)
    assert by_item == {ids["CPU"]["item"]: ["CPU-1", "CPU-2"], ids["TFT"]["item"]: ["TFT-1", "TFT-2"],
                       ids["Mouse"]["item"]: ["N/A", "N/A"]}


async def test_a_part_missing_its_serials_refuses_everything_and_names_the_part(client):
    w = await build_s4_world()
    ids = await make_set(w, "Desktop", [("CPU", "CPU", True, 70), ("TFT", "TFT", True, 30)])
    h = await login(client, w, "admin")
    parts = {str(ids["CPU"]["part"]): ["CPU-1"], str(ids["TFT"]["part"]): ["TFT-1", "TFT-2"]}
    resp = await client.post("/api/assets/batch", headers=h, json=body(w, ids["_set"], 2, part_serials=parts))
    assert resp.status_code == 422, resp.text
    problems = resp.json()["problems"]
    assert problems == [{"part_id": ids["CPU"]["part"], "message": "CPU: 2 serial numbers are needed, 1 was typed."}]
    assert await count_assets() == 0


async def test_serials_for_a_part_without_a_serial_are_refused(client):
    w = await build_s4_world()
    ids = await make_set(w, "Combo", [("Keyboard", "Keyboard", False, 50), ("Mouse", "Mouse", False, 50)])
    resp = await client.post("/api/assets/batch", headers=await login(client, w, "admin"),
                             json=body(w, ids["_set"], 1, part_serials={str(ids["Mouse"]["part"]): ["M-1"]}))
    assert resp.status_code == 422
    assert "Mouse: Its Item says no serial number" in resp.json()["detail"]
    assert await count_assets() == 0


async def test_one_serial_typed_under_two_parts_is_refused(client):
    w = await build_s4_world()
    ids = await make_set(w, "Desktop", [("CPU", "CPU", True, 50), ("TFT", "TFT", True, 50)])
    parts = {str(ids["CPU"]["part"]): ["SAME"], str(ids["TFT"]["part"]): ["same"]}
    resp = await client.post("/api/assets/batch", headers=await login(client, w, "admin"), json=body(w, ids["_set"], 1, part_serials=parts))
    assert resp.status_code == 422
    assert "typed more than once (CPU unit 1 and TFT unit 1)" in resp.json()["detail"]
    assert await count_assets() == 0


async def test_a_serial_already_in_ckam_is_refused_for_the_part_that_has_it(client):
    w = await build_s4_world()
    ids = await make_set(w, "Desktop", [("CPU", "CPU", True, 50), ("TFT", "TFT", True, 50)])
    h = await login(client, w, "admin")
    first = {str(ids["CPU"]["part"]): ["C-1"], str(ids["TFT"]["part"]): ["T-1"]}
    assert (await client.post("/api/assets/batch", headers=h, json=body(w, ids["_set"], 1, part_serials=first))).status_code == 201
    again = {str(ids["CPU"]["part"]): ["C-2"], str(ids["TFT"]["part"]): ["T-1"]}
    resp = await client.post("/api/assets/batch", headers=h, json=body(w, ids["_set"], 1, part_serials=again))
    assert resp.status_code == 422
    problem = resp.json()["problems"][0]
    assert problem["part_id"] == ids["TFT"]["part"] and problem["unit_index"] == 1 and "already used" in problem["message"]
    assert await count_assets() == 2


async def test_a_serial_later_part_waits_on_the_serial_pending_list(client):
    w = await build_s4_world()
    ids = await make_set(w, "Kit", [("Box", "Box", True, 50), ("Mouse", "Mouse", False, 50)])
    async with SessionLocal() as s:
        (await s.get(Item, ids["Box"]["item"])).serial_later = True
        await s.commit()
    resp = await client.post("/api/assets/batch", headers=await login(client, w, "admin"), json=body(w, ids["_set"], 2))
    assert resp.status_code == 201, resp.text
    assert resp.json()["assets_created"] == 4 and resp.json()["serial_pending"] == 2


async def test_the_cost_of_a_set_is_split_over_its_parts_by_share(client):
    w = await build_s4_world()
    ids = await make_set(w, "Combo", [("Keyboard", "Keyboard", False, 70), ("Mouse", "Mouse", False, 30)])
    resp = await client.post("/api/assets/batch", headers=await login(client, w, "admin"),
                             json=body(w, ids["_set"], 2, purchase_cost=1000, tax_percent=18))
    assert resp.status_code == 201, resp.text
    rows = await all_assets()
    costs = {a.item_id: (float(a.purchase_cost), float(a.total_cost)) for a in rows}
    assert costs == {ids["Keyboard"]["item"]: (700.0, 826.0), ids["Mouse"]["item"]: (300.0, 354.0)}


async def test_a_typed_description_gets_the_part_name_and_brand_and_warranty_come_from_the_part_item(client):
    w = await build_s4_world()
    ids = await make_set(w, "Combo", [("Keyboard", "Keyboard", False, 50), ("Mouse", "Mouse", False, 50)])
    async with SessionLocal() as s:
        mouse = await s.get(Item, ids["Mouse"]["item"])
        mouse.default_brand_id, mouse.default_warranty_years = w["brand"], 2
        await s.commit()
    h = await login(client, w, "admin")
    resp = await client.post("/api/assets/batch", headers=h, json=body(w, ids["_set"], 1))
    assert resp.status_code == 201, resp.text
    rows = {a.item_id: a for a in await all_assets()}
    mouse_asset = rows[ids["Mouse"]["item"]]
    assert (mouse_asset.brand_id, mouse_asset.warranty_years) == (w["brand"], 2)
    assert rows[ids["Keyboard"]["item"]].brand_id is None
    resp = await client.post("/api/assets/batch", headers=h, json=body(w, ids["_set"], 1, description="Front desk"))
    assert resp.status_code == 201, resp.text
    assert {a.description for a in (await all_assets())[2:]} == {"Front desk - Keyboard", "Front desk - Mouse"}


async def test_things_that_only_make_sense_for_one_item_are_refused_for_a_set(client):
    w = await build_s4_world()
    ids = await make_set(w, "Combo", [("Keyboard", "Keyboard", False, 50), ("Mouse", "Mouse", False, 50)])
    h = await login(client, w, "admin")
    for extra in ({"serial_numbers": ["A", "B"]}, {"serial_mode": "HAS_SERIAL"}, {"brand_id": w["brand"]}, {"model": "X"},
                  {"legacy_asset_code": "OLD-1"}, {"unit_custom_fields": [{"a": "b"}]}):
        resp = await client.post("/api/assets/batch", headers=h, json=body(w, ids["_set"], 1, **extra))
        assert resp.status_code == 422, (extra, resp.text)
    assert await count_assets() == 0


async def test_the_item_list_tells_add_assets_what_a_set_is_made_of(client):
    w = await build_s4_world()
    ids = await make_set(w, "Desktop", [("CPU", "CPU", True, 80), ("Mouse", "Mouse", False, 20)])
    h = await login(client, w, "admin")
    rows = {i["name"]: i for i in (await client.get("/api/items", headers=h)).json()}
    assert rows["Desktop"]["set_parts"] == [
        {"part_id": ids["CPU"]["part"], "name": "CPU", "item_id": ids["CPU"]["item"], "item_name": "CPU",
         "serial_mode": "HAS_SERIAL", "share_percent": 80.0},
        {"part_id": ids["Mouse"]["part"], "name": "Mouse", "item_id": ids["Mouse"]["item"], "item_name": "Mouse",
         "serial_mode": "NO_SERIAL", "share_percent": 20.0},
    ]
    assert rows["Indoor Camera"]["set_parts"] == []
