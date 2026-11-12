"""Brands know where they are used (IT / Non-IT / both): creating and changing that, the list, and the server
refusing a brand that is not set up for the work area of the thing it is given to."""
from sqlalchemy import select

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.items.models import Item
from app.masters.models import Brand
from tests.core.s0_world import add_line, build_world, login


async def _brand(code: str, name: str, areas: list[str] | None = None, active: bool = True) -> int:
    async with SessionLocal() as s:
        b = Brand(code=code, name=name, is_active=active, **({"work_areas": areas} if areas is not None else {}))
        s.add(b)
        await s.commit()
        return b.id


async def _item(w: dict, name: str, area: str = "it", brand_id: int | None = None, serial: bool = False) -> int:
    async with SessionLocal() as s:
        item = Item(name=name, category_id=w["it"] if area == "it" else w["nonit"],
                    subcategory_id=w["lap"] if area == "it" else w["chair"], serial_required=serial, default_brand_id=brand_id)
        s.add(item)
        await s.commit()
        return item.id


async def _areas_of(brand_id: int) -> list[str]:
    async with SessionLocal() as s:
        return list((await s.get(Brand, brand_id)).work_areas)


async def test_the_migration_fills_each_brand_from_where_it_is_already_used_and_leaves_unused_brands_in_both(client):
    """Runs the migration's own backfill statement on brands used in different ways: nothing is lost."""
    import importlib.util
    import pathlib
    from sqlalchemy import text
    path = next(pathlib.Path("app/alembic/versions").glob("b3d5f7a9c1e4_*.py"))
    spec = importlib.util.spec_from_file_location("brand_areas_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    w = await build_world()
    it_only, nonit_only, both, unused = (await _brand("M1", "OnlyIT"), await _brand("M2", "OnlyNonIT"),
                                         await _brand("M3", "Both"), await _brand("M4", "Unused"))
    await _item(w, "Laptop", "it", brand_id=it_only)
    await _item(w, "Chair", "nonit", brand_id=nonit_only)
    await _item(w, "Laptop 2", "it", brand_id=both)
    await _item(w, "Chair 2", "nonit", brand_id=both)
    async with SessionLocal() as s:
        await s.execute(text("UPDATE brand SET work_areas = ARRAY['IT','NON_IT']::varchar[]"))      # as the new column starts
        await s.execute(text(module.BACKFILL_SQL))
        await s.commit()
    assert await _areas_of(it_only) == ["IT"]
    assert await _areas_of(nonit_only) == ["NON_IT"]
    assert await _areas_of(both) == ["IT", "NON_IT"]
    assert await _areas_of(unused) == ["IT", "NON_IT"]                                  # used nowhere yet: still in every list
    assert await _areas_of(w["brand"]) == ["IT", "NON_IT"]
    async with SessionLocal() as s:                                                      # no brand, name or code changed
        names = {b.name: b.code for b in (await s.execute(select(Brand))).scalars()}
    assert names["OnlyIT"] == "M1" and names["Unused"] == "M4" and names["Dell"] == "S0BR"


async def test_an_existing_brand_without_a_choice_is_used_for_both_areas_and_the_list_says_so(client):
    w = await build_world()
    h = await login(client, w, "op_it")
    rows = (await client.get("/api/masters/brands", headers=h)).json()
    dell = next(r for r in rows if r["name"] == "Dell")
    assert dell["work_areas"] == ["IT", "NON_IT"]


async def test_a_new_brand_starts_as_its_creators_work_areas_and_can_be_chosen(client):
    w = await build_world()
    owner, op_it = await login(client, w, "owner"), await login(client, w, "op_it")
    made = (await client.post("/api/masters/brands", headers=owner, json={"name": "Samsung"})).json()
    assert made["work_areas"] == ["IT", "NON_IT"]                                      # the head-office admin: both
    made = (await client.post("/api/masters/brands", headers=op_it, json={"name": "Acer"})).json()
    assert made["work_areas"] == ["IT"]                                                # an IT operator: IT
    made = (await client.post("/api/masters/brands", headers=owner, json={"name": "Godrej", "work_areas": ["non-it"]})).json()
    assert made["work_areas"] == ["NON_IT"]                                            # any spelling of the code, kept in order
    made = (await client.post("/api/masters/brands", headers=owner, json={"name": "Philips", "work_areas": ["NON_IT", "IT"]})).json()
    assert made["work_areas"] == ["IT", "NON_IT"]


async def test_someone_limited_to_one_work_area_cannot_make_a_brand_for_the_other(client):
    w = await build_world()
    op_it = await login(client, w, "op_it")
    resp = await client.post("/api/masters/brands", headers=op_it, json={"name": "Godrej", "work_areas": ["NON_IT"]})
    assert resp.status_code == 403
    both = await client.post("/api/masters/brands", headers=op_it, json={"name": "Philips", "work_areas": ["IT", "NON_IT"]})
    assert both.status_code == 403


async def test_a_brand_needs_a_known_work_area(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    for bad in ([], ["HR"], ["IT", "HR"]):
        resp = await client.post("/api/masters/brands", headers=owner, json={"name": "Odd", "work_areas": bad})
        assert resp.status_code == 422, bad


async def test_editing_a_brand_changes_where_it_is_used_and_leaving_it_out_changes_nothing(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    resp = await client.put(f"/api/masters/brands/{w['brand']}", headers=owner, json={"name": "Dell Inc", "work_areas": ["IT"]})
    assert resp.status_code == 200 and resp.json()["work_areas"] == ["IT"] and resp.json()["name"] == "Dell Inc"
    resp = await client.put(f"/api/masters/brands/{w['brand']}", headers=owner, json={"name": "Dell"})
    assert resp.status_code == 200 and resp.json()["work_areas"] == ["IT"]            # not sent: untouched
    assert (await client.put(f"/api/masters/brands/{w['brand']}", headers=await login(client, w, "admin"),
                             json={"name": "Dell", "work_areas": ["IT"]})).status_code == 403     # head-office admin only


async def test_an_area_cannot_be_taken_off_a_brand_an_active_item_defaults_to(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    await _item(w, "Laptop", "it", brand_id=w["brand"])
    await _item(w, "Chair", "nonit", brand_id=w["brand"])
    resp = await client.put(f"/api/masters/brands/{w['brand']}", headers=owner, json={"name": "Dell", "work_areas": ["NON_IT"]})
    assert resp.status_code == 422
    assert "default brand of 1 IT Item (Laptop)" in resp.json()["detail"] and "IT cannot be taken off it" in resp.json()["detail"]
    assert await _areas_of(w["brand"]) == ["IT", "NON_IT"]                              # nothing changed
    # an Item that is no longer active does not hold the area in place
    async with SessionLocal() as s:
        for item in (await s.execute(select(Item).where(Item.name == "Laptop"))).scalars():
            item.is_active = False
        await s.commit()
    resp = await client.put(f"/api/masters/brands/{w['brand']}", headers=owner, json={"name": "Dell", "work_areas": ["NON_IT"]})
    assert resp.status_code == 200 and resp.json()["work_areas"] == ["NON_IT"]


async def test_setting_many_brands_at_once_is_all_or_nothing_and_head_office_only(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    a, b = await _brand("BA", "Acer"), await _brand("BB", "Asus")
    ok = await client.post("/api/masters/brands/work-areas", headers=owner, json={"ids": [a, b], "work_areas": ["IT"]})
    assert ok.status_code == 200 and ok.json() == {"updated": 2, "unchanged": 0}
    assert await _areas_of(a) == await _areas_of(b) == ["IT"]
    again = await client.post("/api/masters/brands/work-areas", headers=owner, json={"ids": [a, b], "work_areas": ["IT"]})
    assert again.json() == {"updated": 0, "unchanged": 2}
    await _item(w, "Laptop", "it", brand_id=a)
    blocked = await client.post("/api/masters/brands/work-areas", headers=owner, json={"ids": [a, b], "work_areas": ["NON_IT"]})
    assert blocked.status_code == 422 and "Acer" in blocked.json()["detail"]
    assert await _areas_of(a) == await _areas_of(b) == ["IT"]                           # all or nothing
    assert (await client.post("/api/masters/brands/work-areas", headers=owner, json={"ids": [a, 999999], "work_areas": ["IT"]})).status_code == 404
    for who in ("admin", "op_it"):
        resp = await client.post("/api/masters/brands/work-areas", headers=await login(client, w, who), json={"ids": [a], "work_areas": ["IT"]})
        assert resp.status_code == 403


async def test_an_items_default_brand_must_be_used_for_its_work_area(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    nonit_only = await _brand("GOD", "Godrej", ["NON_IT"])
    body = {"name": "Laptop", "category_id": w["it"], "subcategory_id": w["lap"], "default_brand_id": nonit_only}
    refused = await client.post("/api/items", headers=owner, json=body)
    assert refused.status_code == 422 and "Godrej is not set up for IT things" in refused.json()["detail"]
    assert (await client.post("/api/items", headers=owner, json={**body, "default_brand_id": w["brand"]})).status_code == 201
    chair = {"name": "Chair", "category_id": w["nonit"], "subcategory_id": w["chair"], "default_brand_id": nonit_only}
    assert (await client.post("/api/items", headers=owner, json=chair)).status_code == 201


async def test_add_assets_refuses_a_brand_that_is_not_used_for_the_items_work_area(client):
    w = await build_world()
    h = await login(client, w, "admin")
    it_only = await _brand("ACR", "Acer", ["IT"])
    chair = await _item(w, "Office Chair", "nonit")
    body = {"item_id": chair, "quantity": 1, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]}
    refused = await client.post("/api/assets/batch", headers=h, json={**body, "brand_id": it_only})
    assert refused.status_code == 422, refused.text
    assert "Acer is not set up for Non-IT things" in refused.text
    async with SessionLocal() as s:
        assert (await s.execute(select(Asset))).first() is None                          # nothing was added
    assert (await client.post("/api/assets/batch", headers=h, json={**body, "brand_id": w["brand"]})).status_code == 201


async def test_a_po_line_refuses_a_brand_that_is_not_used_for_its_work_area_and_keeps_an_old_one(client):
    w = await build_world()
    h = await login(client, w, "admin")
    it_only = await _brand("ACR", "Acer", ["IT"])
    from tests.core.s0_world import make_po
    po = await make_po(client, h, w)
    refused = await add_line(client, h, w, po["id"], area="nonit", brand_id=it_only)
    assert refused.status_code == 422 and "Acer is not set up for Non-IT things" in refused.text
    assert (await add_line(client, h, w, po["id"], area="it", brand_id=it_only)).status_code == 201
    assert (await add_line(client, h, w, po["id"], area="nonit", brand_id=w["brand"])).status_code == 201


async def test_changing_an_assets_brand_is_checked_but_an_old_brand_never_blocks_an_edit(client):
    from tests.core.s0_world import make_asset
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w, "it", brand_id=w["brand"])
    nonit_only = await _brand("GOD", "Godrej", ["NON_IT"])
    full = {"description": "Dell laptop", "vendor_id": w["vendor"], "brand_id": nonit_only}
    refused = await client.put(f"/api/assets/{asset['id']}", headers=h, json=full)
    assert refused.status_code in (403, 422) and "Godrej is not set up for IT things" in refused.text
    # the brand it has now is narrowed to Non-IT: an edit that leaves the brand alone still works
    async with SessionLocal() as s:
        (await s.get(Brand, w["brand"])).work_areas = ["NON_IT"]
        await s.commit()
    ok = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "Dell laptop 14", "vendor_id": w["vendor"], "brand_id": w["brand"]})
    assert ok.status_code == 200, ok.text
