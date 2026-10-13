"""S6: Asset Groups -- `item_count` (active Items) on Category / Sub-category rows from one aggregate query,
and deactivating a group that still has active Items or active sub-categories is refused in plain words."""
from sqlalchemy import select, update

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.items.models import Item
from app.masters.models import AssetCategory, AssetSubcategory, MasterAudit
from tests.core.s0_world import make_asset
from tests.core.s3a1_world import build_s3_world, login
from tests.purchase_orders.s4_world import Statements


async def _add_items(w: dict, names: list[str], category: str = "it", sub: str = "lap", active: bool = True) -> None:
    async with SessionLocal() as s:
        s.add_all([Item(name=n, category_id=w[category], subcategory_id=w[sub], is_active=active) for n in names])
        await s.commit()


async def test_category_and_sub_category_rows_count_their_active_items(client):
    w = await build_s3_world()
    await _add_items(w, ["Mouse", "Keyboard"])
    await _add_items(w, ["Retired"], active=False)
    h = await login(client, w, "op_it")
    cats = {c["id"]: c for c in (await client.get("/api/masters/categories", headers=h)).json()}
    assert cats[w["it"]]["item_count"] == 3 and cats[w["nonit"]]["item_count"] == 1      # Laptop, Mouse, Keyboard / Chair
    assert set(cats[w["it"]]) == {"id", "is_active", "code", "name", "asset_domain", "item_count"}
    subs = {s["id"]: s for s in (await client.get("/api/masters/subcategories", headers=h)).json()}
    assert subs[w["lap"]]["item_count"] == 3 and subs[w["chair"]]["item_count"] == 1


async def test_counts_come_from_one_query_however_many_groups(client):
    w = await build_s3_world()
    h = await login(client, w, "owner")

    async def statements() -> int:
        with Statements() as st:
            assert (await client.get("/api/masters/categories", headers=h)).status_code == 200
        return st.count

    few = await statements()
    async with SessionLocal() as s:
        cats = [AssetCategory(code=f"G{i}", name=f"Group {i}", asset_domain="IT") for i in range(20)]
        s.add_all(cats)
        await s.flush()
        s.add_all([Item(name=f"Thing {i}", category_id=c.id) for i, c in enumerate(cats)])
        await s.commit()
    assert await statements() == few


async def test_a_category_with_active_sub_categories_or_items_is_not_deactivated(client):
    w = await build_s3_world()
    h = await login(client, w, "admin_it")
    resp = await client.delete(f"/api/masters/categories/{w['it']}", headers=h)
    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "Computers cannot be deactivated because it still has 1 active sub-category (Laptop) and 1 active Item (Laptop). "
        "Deactivate them or move them to another group first. Assets already in the register keep their group.")
    async with SessionLocal() as s:
        assert (await s.get(AssetCategory, w["it"])).is_active is True
        assert (await s.execute(select(MasterAudit).where(MasterAudit.entity == "category"))).first() is None


async def test_a_sub_category_with_active_items_is_not_deactivated_until_they_are(client):
    w = await build_s3_world()
    await _add_items(w, ["Mouse", "Keyboard", "Monitor", "Webcam"])
    h = await login(client, w, "owner")
    resp = await client.delete(f"/api/masters/subcategories/{w['lap']}", headers=h)
    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "Laptop cannot be deactivated because it still has 5 active Items (Keyboard, Laptop, Monitor and 2 more). "
        "Deactivate them or move them to another sub-category first. Assets already in the register keep their group.")
    async with SessionLocal() as s:
        await s.execute(update(Item).where(Item.subcategory_id == w["lap"]).values(is_active=False))
        await s.commit()
    assert (await client.delete(f"/api/masters/subcategories/{w['lap']}", headers=h)).status_code == 204


async def test_assets_keep_their_group_when_it_is_deactivated(client):
    w = await build_s3_world()
    owner = await login(client, w, "owner")
    chair = await make_asset(client, owner, w, "nonit")
    async with SessionLocal() as s:
        await s.execute(update(Item).where(Item.category_id == w["nonit"]).values(is_active=False))
        await s.commit()
    assert (await client.delete(f"/api/masters/subcategories/{w['chair']}", headers=owner)).status_code == 204
    assert (await client.delete(f"/api/masters/categories/{w['nonit']}", headers=owner)).status_code == 204
    async with SessionLocal() as s:
        asset = await s.get(Asset, chair["id"])
        assert (asset.category_id, asset.subcategory_id) == (w["nonit"], w["chair"])
        assert (await s.get(AssetSubcategory, w["chair"])).is_active is False
    still = (await client.get(f"/api/assets/{chair['id']}", headers=owner)).json()
    assert still["category_id"] == w["nonit"]


async def test_the_refusal_still_comes_after_the_work_area_check(client):
    w = await build_s3_world()
    other_area = await client.delete(f"/api/masters/categories/{w['it']}", headers=await login(client, w, "admin_nonit"))
    assert other_area.status_code == 403
    operator = await client.delete(f"/api/masters/categories/{w['it']}", headers=await login(client, w, "op_it"))
    assert operator.status_code == 403


async def test_saving_a_group_answers_as_before_without_a_count(client):
    w = await build_s3_world()
    h = await login(client, w, "admin_it")
    made = await client.post("/api/masters/categories", headers=h, json={"name": "Printers", "asset_domain": "IT"})
    assert made.status_code == 201 and made.json()["item_count"] is None
    sub = await client.post("/api/masters/subcategories", headers=h, json={"category_id": made.json()["id"], "name": "Laser"})
    assert sub.status_code == 201 and sub.json()["item_count"] is None
    assert (await client.delete(f"/api/masters/subcategories/{sub.json()['id']}", headers=h)).status_code == 204
    assert (await client.delete(f"/api/masters/categories/{made.json()['id']}", headers=h)).status_code == 204   # nothing left in it
