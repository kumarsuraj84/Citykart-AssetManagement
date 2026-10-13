"""S5: link existing assets (made before Items existed) to Items -- a list with suggestions only (ERP code
through the item rules, description words, the asset's own group), and an all-or-nothing link that changes
only the Item and leaves one audit row per asset."""
import pytest
from sqlalchemy import func, select

from app.assets.models import Asset, AssetFieldChange
from app.core.db import SessionLocal
from app.erp.source import get_erp_source
from app.items.models import Item, ItemMap
from app.lifecycle.models import AssetEvent
from app.main import app
from tests.core.s0_world import make_asset
from tests.erp.test_erp_api import FakeErp
from tests.purchase_orders.s4_world import build_s4_world, login


@pytest.fixture(autouse=True)
def fake_erp():
    """Never the real ERP: an in-memory stand-in whose item master does not know the codes used here (so the
    ERP-code suggestion comes from a CODE rule alone)."""
    fake = FakeErp()
    app.dependency_overrides[get_erp_source] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_erp_source, None)


async def old_asset(client, h, w, area="it", **over) -> dict:
    """An asset added the old way: a category and sub-category, no Item."""
    return await make_asset(client, h, w, area, **over)


async def unlinked(client, h, **params):
    resp = await client.get("/api/assets/unlinked-items", headers=h, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json(), int(resp.headers["X-Total-Count"])


async def link(client, h, entries):
    return await client.post("/api/assets/link-items", headers=h, json=entries)


async def test_the_list_suggests_items_by_erp_code_description_and_group(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    gate = await old_asset(client, h, w, description="Indoor camera at the gate", serial_number="OLD-CAM")
    coded = await old_asset(client, h, w, description="Something", serial_number="OLD-2")
    chair = await old_asset(client, h, w, "nonit", description="Old office chair")
    async with SessionLocal() as s:
        (await s.get(Asset, coded["id"])).erp_item_code = "CT777"
        s.add(ItemMap(item_id=w["item_ap"], match_type="CODE", erp_item_code="ct777", company_id=w["co"]))
        await s.commit()
    rows, total = await unlinked(client, h)
    assert total == 3
    by_id = {r["asset_id"]: r for r in rows}
    gate_s = by_id[gate["id"]]["suggestions"]
    assert gate_s[0] == {"item_id": w["item_camera"], "item_name": "Indoor Camera", "score": 0.95, "reason": "DESCRIPTION"}
    assert {s["reason"] for s in gate_s[1:]} == {"GROUP"}            # the other Items of the Laptop sub-category
    coded_s = by_id[coded["id"]]["suggestions"]
    assert coded_s[0] == {"item_id": w["item_ap"], "item_name": "Access Point", "score": 1.0, "reason": "ERP_CODE"}
    chair_s = by_id[chair["id"]]["suggestions"]
    assert chair_s[0]["item_id"] == w["item_chair"] and chair_s[0]["reason"] == "DESCRIPTION"
    assert all(s["item_id"] != w["item_chair"] for s in gate_s)       # never an Item of another group
    row = by_id[gate["id"]]
    assert (row["category_name"], row["subcategory_name"], row["holder_name"], row["work_area"]) == ("Computers", "Laptop", "Main Stock", "IT")
    # nothing was linked by itself
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count()).select_from(Asset).where(Asset.item_id.is_not(None)))).scalar_one() == 0


async def test_an_unreadable_erp_only_means_fewer_suggestions(client, fake_erp):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    coded = await old_asset(client, h, w, description="Zzz", serial_number="E-1")
    async with SessionLocal() as s:
        (await s.get(Asset, coded["id"])).erp_item_code = "CT324973"
        s.add(ItemMap(item_id=w["item_gangbox"], match_type="ARTICLE", article_key="02-I3 CORE[IT-01]", company_id=w["co"]))
        s.add(ItemMap(item_id=w["item_ap"], match_type="CODE", erp_item_code="CT324973", company_id=w["co_b"]))  # other company
        await s.commit()
    rows, _ = await unlinked(client, h)
    assert rows[0]["suggestions"][0] == {"item_id": w["item_gangbox"], "item_name": "Gang Box", "score": 1.0, "reason": "ERP_CODE"}
    fake_erp.down = "The ERP database could not be reached."
    rows, _ = await unlinked(client, h)
    assert all(s["reason"] == "GROUP" for s in rows[0]["suggestions"])      # the Article rule needs the ERP record


async def test_linking_sets_only_the_item_and_writes_one_audit_row_each(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    one = await old_asset(client, h, w, serial_number="L-1")
    two = await old_asset(client, h, w, serial_number="L-2")
    async with SessionLocal() as s:
        before = {a.id: (a.category_id, a.subcategory_id, a.status, a.current_asset_user_id, a.status_since)
                  for a in (await s.execute(select(Asset))).scalars().all()}
        events_before = (await s.execute(select(func.count()).select_from(AssetEvent))).scalar_one()
    resp = await link(client, h, [{"asset_id": one["id"], "item_id": w["item_camera"]}, {"asset_id": two["id"], "item_id": w["item_gangbox"]}])
    assert resp.status_code == 200, resp.text
    assert resp.json()["linked"] == 2 and [r["item_name"] for r in resp.json()["results"]] == ["Indoor Camera", "Gang Box"]
    async with SessionLocal() as s:
        rows = {a.id: a for a in (await s.execute(select(Asset))).scalars().all()}
        changes = (await s.execute(select(AssetFieldChange).order_by(AssetFieldChange.id))).scalars().all()
        events_after = (await s.execute(select(func.count()).select_from(AssetEvent))).scalar_one()
    assert (rows[one["id"]].item_id, rows[two["id"]].item_id) == (w["item_camera"], w["item_gangbox"])
    for asset_id, (cat, sub, status, holder, since) in before.items():
        a = rows[asset_id]
        assert (a.category_id, a.subcategory_id, a.status, a.current_asset_user_id, a.status_since) == (cat, sub, status, holder, since)
    assert [(c.asset_id, c.field_name, c.old_value, c.new_value) for c in changes] == [
        (one["id"], "item_id", None, f"Indoor Camera (#{w['item_camera']})"),
        (two["id"], "item_id", None, f"Gang Box (#{w['item_gangbox']})")]
    assert events_after == events_before
    history = (await client.get(f"/api/assets/{one['id']}/changes", headers=h)).json()
    assert history[-1]["field_name"] == "item_id" and history[-1]["actor_name"] == "Ordinary Admin"
    assert (await unlinked(client, h))[1] == 0


async def test_one_bad_entry_refuses_the_whole_link_with_a_sentence_each(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    good = await old_asset(client, h, w, serial_number="G-1")
    other_group = await old_asset(client, h, w, serial_number="G-2")
    third = await old_asset(client, h, w, serial_number="G-3")
    async with SessionLocal() as s:
        dead = Item(name="Retired Thing", category_id=w["it"], subcategory_id=w["lap"], is_active=False)
        s.add(dead)
        await s.commit()
        dead_id = dead.id
    resp = await link(client, h, [
        {"asset_id": good["id"], "item_id": w["item_camera"]},
        {"asset_id": other_group["id"], "item_id": w["item_chair"]},
        {"asset_id": good["id"], "item_id": w["item_camera"]},
        {"asset_id": 999999, "item_id": w["item_camera"]},
        {"asset_id": third["id"], "item_id": dead_id},
    ])
    assert resp.status_code == 422
    assert [(p["entry_index"], p["message"]) for p in resp.json()["problems"]] == [
        (2, "This Item belongs to a different asset group; use Correct Classification first."),
        (3, "This asset appears more than once; enter it once."),
        (4, "This asset was not found."),
        (5, "The Item Retired Thing is no longer active; choose another."),
    ]
    assert resp.json()["detail"].startswith("Nothing was linked: 4 problems need fixing. Entry 2: ")
    async with SessionLocal() as s:
        assert (await s.get(Asset, good["id"])).item_id is None
        assert (await s.execute(select(func.count()).select_from(AssetFieldChange))).scalar_one() == 0


async def test_already_linked_assets_and_the_work_area(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    first = await old_asset(client, h, w, serial_number="W-1")
    assert (await link(client, h, [{"asset_id": first["id"], "item_id": w["item_camera"]}])).status_code == 200
    same = await link(client, h, [{"asset_id": first["id"], "item_id": w["item_camera"]}])
    assert same.status_code == 200 and same.json()["linked"] == 0 and same.json()["results"][0]["changed"] is False
    other = await link(client, h, [{"asset_id": first["id"], "item_id": w["item_gangbox"]}])
    assert other.json()["detail"] == "Entry 1: S0/S0IT/001 is already linked to the Item Indoor Camera."
    chair = await old_asset(client, h, w, "nonit")
    it_admin = await login(client, w, "admin_it")
    hidden = await link(client, it_admin, [{"asset_id": chair["id"], "item_id": w["item_chair"]}])
    assert hidden.json()["problems"][0]["message"] == "This asset was not found."
    rows, total = await unlinked(client, it_admin)
    assert total == 0 and rows == []                                  # the Non-IT chair is not theirs


async def test_who_may_use_the_link_tool_and_paging(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    for n in range(3):
        await old_asset(client, h, w, serial_number=f"P-{n}", description=f"Thing {n}")
    for who in ("op_it", "op_both", "viewer_it"):
        other = await login(client, w, who)
        assert (await client.get("/api/assets/unlinked-items", headers=other)).status_code == 403
        assert (await link(client, other, [{"asset_id": 1, "item_id": w["item_camera"]}])).status_code == 403
    owner = await login(client, w, "owner")
    rows, total = await unlinked(client, owner, limit=2, offset=1)
    assert total == 3 and [r["description"] for r in rows] == ["Thing 1", "Thing 2"]
    found, count = await unlinked(client, owner, q="thing 2")
    assert count == 1 and found[0]["description"] == "Thing 2"
    assert (await link(client, owner, [])).status_code == 422
    assert (await link(client, owner, [{"asset_id": 1, "item_id": 1}] * 501)).status_code == 422
