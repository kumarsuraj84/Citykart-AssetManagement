"""S7 fix round (P1-3): "Link existing assets to Items" uses the same name scoring as the ERP screens -- a
generic word in common (BOX) is no suggestion; a written-apart name (HOP BOX) is."""
from app.core.db import SessionLocal
from app.items.models import Item
from tests.core.s0_world import make_asset
from tests.purchase_orders.s4_world import build_s4_world, login


async def _items(w) -> dict:
    async with SessionLocal() as s:
        made = {"ai_box": Item(name="AI BOX", category_id=w["it"], subcategory_id=w["lap"]),
                "hopbox": Item(name="HOPBOX", category_id=w["it"], subcategory_id=w["lap"])}
        s.add_all(made.values())
        await s.commit()
        return {k: v.id for k, v in made.items()}


async def suggestions(client, h, asset_id) -> list[dict]:
    rows = (await client.get("/api/assets/unlinked-items", headers=h, params={"limit": 200})).json()
    return next(r["suggestions"] for r in rows if r["asset_id"] == asset_id)


async def test_a_gang_box_is_not_an_ai_box(client):
    w = await build_s4_world()
    ids = await _items(w)
    h = await login(client, w, "owner")
    gang = await make_asset(client, h, w, "it", description="GANG BOX PVC 4X4", serial_number="G-1")
    found = await suggestions(client, h, gang["id"])
    assert ids["ai_box"] not in [s["item_id"] for s in found]
    assert [s["item_name"] for s in found if s["reason"] == "DESCRIPTION"] == ["Gang Box"]


async def test_a_hop_box_is_the_hopbox(client):
    w = await build_s4_world()
    ids = await _items(w)
    h = await login(client, w, "owner")
    hop = await make_asset(client, h, w, "it", description="R-51 HOP BOX", serial_number="H-1")
    found = [s for s in await suggestions(client, h, hop["id"]) if s["reason"] == "DESCRIPTION"]
    assert found[0] == {"item_id": ids["hopbox"], "item_name": "HOPBOX", "score": 0.95, "reason": "DESCRIPTION"}
    assert ids["ai_box"] not in [s["item_id"] for s in found]
