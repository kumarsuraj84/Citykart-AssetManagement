"""Add Assets can put new assets straight into a Store (they are then "With Store"), a site's Install Point
("Installed") or a Stock Room ("In Stock"), exactly as Give to Store / Install at a site do in Move."""
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.items.models import Item
from tests.core.s0_world import build_world, login


async def _place(w: dict, code: str, kind: str, name: str) -> int:
    async with SessionLocal() as s:
        place = AssetUser(company_id=w["co"], code=code, name=name, asset_user_type=kind, location_id=w["loc"],
                          department_id=w["dept"], role="SELF_SERVICE", login_enabled=False)
        s.add(place)
        await s.commit()
        return place.id


async def _item(w: dict) -> int:
    async with SessionLocal() as s:
        item = Item(name="Mouse", category_id=w["it"], subcategory_id=w["lap"], serial_required=False)
        s.add(item)
        await s.commit()
        return item.id


async def _add(client, h, w, item: int, place: int, quantity: int = 2):
    return await client.post("/api/assets/batch", headers=h, json={
        "item_id": item, "quantity": quantity, "received_into_asset_user_id": place, "cost_center_id": w["cc"]})


async def test_new_assets_go_with_a_store_install_at_a_site_or_stay_in_a_stock_room(client):
    w = await build_world()
    h = await login(client, w, "admin")
    item = await _item(w)
    store = await _place(w, "MMR", "STORE", "Mamura Store")
    site = await _place(w, "INS-HO", "INSTALLED", "Head Office Site")
    for place, status in ((store, "ALLOTTED"), (site, "INSTALLED"), (w["stock"], "IN_STOCK")):
        resp = await _add(client, h, w, item, place)
        assert resp.status_code == 201, resp.text
        async with SessionLocal() as s:
            rows = (await s.execute(select(Asset).where(Asset.current_asset_user_id == place))).scalars().all()
        assert len(rows) == 2 and {a.status for a in rows} == {status}, (place, status)


async def test_a_store_that_is_switched_off_cannot_receive_assets(client):
    w = await build_world()
    h = await login(client, w, "admin")
    item = await _item(w)
    store = await _place(w, "OLD", "STORE", "Closed Store")
    async with SessionLocal() as s:
        (await s.get(AssetUser, store)).is_active = False
        await s.commit()
    resp = await _add(client, h, w, item, store)
    assert resp.status_code in (403, 422) and "no longer active" in resp.text
