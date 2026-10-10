"""Items (CityKart's own names for what an asset is) and the rules that link ERP
item codes to them: by code, by product name inside an Article, or by Article."""
from sqlalchemy import select
from app.core.db import SessionLocal
from app.items.models import Item, ItemMap
from tests.erp.test_erp_api import _headers, _setup, erp, line, desktop_po  # noqa: F401  (erp is a fixture)


async def _make_ids(client):
    ids = await _setup()
    ids["owner"] = await _headers(client, "OWN")
    ids["op"] = await _headers(client, "OPR")
    ids["viewer"] = await _headers(client, "VWR")
    return ids


def body(ids, **over):
    base = {"name": "UPS", "category_id": ids["acc"], "subcategory_id": ids["cables"]}
    base.update(over)
    return base


# ---------- items ----------

async def test_only_the_primary_owner_changes_items_and_operators_can_read_them(client):
    ids = await _make_ids(client)
    made = await client.post("/api/items", headers=ids["owner"], json=body(ids))
    assert made.status_code == 201, made.text
    assert (await client.post("/api/items", headers=ids["op"], json=body(ids, name="Other"))).status_code == 403
    assert (await client.get("/api/items", headers=ids["viewer"])).status_code == 403
    names = [i["name"] for i in (await client.get("/api/items", headers=ids["op"])).json()]
    assert names == ["Cable", "Desktop", "UPS"]
    assert (await client.put(f"/api/items/{made.json()['id']}", headers=ids["op"], json=body(ids))).status_code == 403
    assert (await client.delete(f"/api/items/{made.json()['id']}", headers=ids["op"])).status_code == 403


async def test_an_item_needs_a_unique_name_and_a_sub_category_of_its_own_category(client):
    ids = await _make_ids(client)
    h = ids["owner"]
    dup = await client.post("/api/items", headers=h, json=body(ids, name="  cable "))
    assert dup.status_code == 422 and "already exists" in dup.json()["detail"]
    async with SessionLocal() as session:
        cpu_sub = (await session.execute(select(Item.subcategory_id).where(Item.name == "Desktop"))).scalar_one()
    wrong = await client.post("/api/items", headers=h, json=body(ids, name="Mixed up", subcategory_id=cpu_sub))   # CPU belongs to Computers, not Accessories
    assert wrong.status_code == 422 and "does not belong" in wrong.json()["detail"]
    assert (await client.post("/api/items", headers=h, json=body(ids, name="x", bundle_id=999999))).status_code == 422
    assert (await client.post("/api/items", headers=h, json=body(ids, name=""))).status_code == 422


async def test_the_serial_default_follows_item_then_sub_category_then_category(client):
    ids = await _make_ids(client)
    h = ids["owner"]
    plain = await client.post("/api/items", headers=h, json=body(ids, name="Plain"))
    assert plain.json()["serial_required"] is None and plain.json()["effective_serial_required"] is True
    no = await client.post("/api/items", headers=h, json=body(ids, name="Mouse", serial_required=False))
    assert no.json()["effective_serial_required"] is False
    back = await client.put(f"/api/items/{no.json()['id']}", headers=h, json=body(ids, name="Mouse", serial_required=None))
    assert back.json()["effective_serial_required"] is True


async def test_a_deactivated_item_leaves_the_list_and_its_rules_stop_applying(client, erp):
    ids = await _make_ids(client)
    h, op = ids["owner"], ids["op"]
    erp.pos[1133610106] = desktop_po()
    before = (await client.get("/api/erp/pos/1133610106/draft", headers=op)).json()["lines"][0]
    assert before["item_name"] == "Desktop"
    assert (await client.delete(f"/api/items/{before['item_id']}", headers=h)).status_code == 204
    after = (await client.get("/api/erp/pos/1133610106/draft", headers=op)).json()["lines"][0]
    assert after["item_id"] is None and any("No Item is linked" in w for w in after["warnings"])
    assert [i["name"] for i in (await client.get("/api/items", headers=op)).json()] == ["Cable"]


async def test_one_click_creates_an_item_for_every_sub_category_that_has_none(client):
    ids = await _make_ids(client)
    h = ids["owner"]
    first = await client.post("/api/items/seed-from-subcategories", headers=h)
    # TFT, Keyboard and Mouse get one; CPU already has "Desktop" and Cable already has "Cable".
    assert first.status_code == 200 and first.json() == {"created": 3}
    names = {i["name"] for i in (await client.get("/api/items", headers=ids["op"])).json()}
    assert names == {"Cable", "Desktop", "Keyboard", "Mouse", "TFT"}
    assert (await client.post("/api/items/seed-from-subcategories", headers=h)).json() == {"created": 0}    # nothing twice
    assert (await client.post("/api/items/seed-from-subcategories", headers=ids["op"])).status_code == 403


# ---------- mapping rules ----------

async def test_rules_are_validated_and_mapping_again_just_changes_the_item(client):
    ids = await _make_ids(client)
    h = ids["owner"]
    base = {"item_id": ids["item_cable"], "match_type": "ARTICLE", "article_key": "FA_CE_UPS", "article_name": "FA_CE_UPS",
            "section": "COMPUTER EQUIPMENT", "department": "FA_CE_UPS"}
    first = await client.post("/api/items/maps", headers=h, json=base)
    assert first.status_code == 201 and first.json()["article_key"] == "FA_CE_UPS" and first.json()["section"] == "COMPUTER EQUIPMENT"
    again = await client.post("/api/items/maps", headers=h, json=base | {"item_id": ids["item_desktop"]})
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"] and again.json()["item_id"] == ids["item_desktop"]

    assert (await client.post("/api/items/maps", headers=h, json={"item_id": ids["item_cable"], "match_type": "CODE"})).status_code == 422
    assert (await client.post("/api/items/maps", headers=h, json={"item_id": ids["item_cable"], "match_type": "NAME", "article_key": "A"})).status_code == 422
    assert (await client.post("/api/items/maps", headers=h, json={"item_id": ids["item_cable"], "match_type": "ARTICLE"})).status_code == 422
    assert (await client.post("/api/items/maps", headers=h, json={"item_id": ids["item_cable"], "match_type": "BOGUS", "article_key": "A"})).status_code == 422
    assert (await client.post("/api/items/maps", headers=h, json=base | {"item_id": 999999})).status_code == 422
    assert (await client.post("/api/items/maps", headers=ids["op"], json=base)).status_code == 403

    listed = (await client.get(f"/api/items/maps?item_id={ids['item_desktop']}", headers=h)).json()
    assert {m["article_key"] for m in listed} == {"02-I3 CORE[IT-01]", "FA_CE_UPS"}
    assert (await client.delete(f"/api/items/maps/{first.json()['id']}", headers=h)).status_code == 204
    assert (await client.delete(f"/api/items/maps/{first.json()['id']}", headers=h)).status_code == 404


async def test_the_most_specific_rule_wins_code_then_product_name_then_article(client, erp):
    ids = await _make_ids(client)
    h = ids["owner"]
    art = {"article_key": "FA_IT_OTHERS", "article_name": "FA_IT_OTHERS", "section": "IT EQUIPMENTS", "department": "FA_IT_OTHERS"}
    # the whole catch-all Article -> Cable, but the 48 port switch by name -> Desktop, and the rack by its own code -> Desktop
    for rule in (
        {"item_id": ids["item_cable"], "match_type": "ARTICLE", **art},
        {"item_id": ids["item_desktop"], "match_type": "NAME", "name_key": "48 PORT SWITCH", **art},
        {"item_id": ids["item_desktop"], "match_type": "CODE", "erp_item_code": "ct500002", **art},
    ):
        assert (await client.post("/api/items/maps", headers=h, json=rule)).status_code == 201
    codes = {c["icode"]: c for c in (await client.get("/api/items/articles/codes?article_key=FA_IT_OTHERS", headers=h)).json()}
    assert (codes["CT500001"]["matched_by"], codes["CT500001"]["item_name"]) == ("NAME", "Desktop")
    assert (codes["CT500002"]["matched_by"], codes["CT500002"]["item_name"]) == ("CODE", "Desktop")   # case does not matter
    erp.erp_items["CT500003"] = type(erp.erp_items["CT500001"])("CT500003", "FA_IT_OTHERS", "FA_IT_OTHERS", "IT EQUIPMENTS", "FA_IT_OTHERS", cats=["PATCH PANEL"])
    codes = {c["icode"]: c for c in (await client.get("/api/items/articles/codes?article_key=FA_IT_OTHERS", headers=h)).json()}
    assert (codes["CT500003"]["matched_by"], codes["CT500003"]["item_name"]) == ("ARTICLE", "Cable")   # everything else in the Article


async def test_the_article_screen_shows_status_and_suggests_an_existing_item_by_its_words(client, erp):
    ids = await _make_ids(client)
    h = ids["owner"]
    await client.post("/api/items", headers=h, json=body(ids, name="UPS"))
    await client.post("/api/items/maps", headers=h, json={
        "item_id": ids["item_cable"], "match_type": "NAME", "article_key": "FA_IT_OTHERS", "name_key": "6U Rack"})
    rows = {r["article_key"]: r for r in (await client.get("/api/items/articles", headers=h)).json()}
    assert rows["02-I3 CORE[IT-01]"]["item_name"] == "Desktop" and rows["02-I3 CORE[IT-01]"]["suggested_item_id"] is None   # already mapped
    ups = rows["FA_CE_UPS"]
    assert ups["item_id"] is None and ups["suggested_item_name"] == "UPS"                  # "ups" appears in the Article name
    others = rows["FA_IT_OTHERS"]
    assert others["item_id"] is None and others["name_rules"] == 1 and others["codes"] == 2
    assert (await client.get("/api/items/articles", headers=ids["op"])).status_code == 403
    erp.down = "The ERP database could not be reached (OSError)."
    down = await client.get("/api/items/articles", headers=h)
    assert down.status_code == 503 and "could not be reached" in down.json()["detail"]
