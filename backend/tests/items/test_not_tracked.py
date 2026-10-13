"""ERP codes CKAM does not track (cables, hangers, sensor tags): a rule can say "not tracked" instead of naming an
Item, at the level of a code, a product name, an Article, or a whole Department, Section or Division."""
from sqlalchemy import select

from app.core.db import SessionLocal
from app.items.models import ItemMap
from tests.erp.test_erp_api import _headers, _setup, erp  # noqa: F401  (erp is a fixture)

ART = {"article_key": "FA_IT_OTHERS", "article_name": "FA_IT_OTHERS", "section": "IT EQUIPMENTS", "department": "FA_IT_OTHERS"}


async def _ids(client):
    ids = await _setup()
    ids["owner"] = await _headers(client, "OWN")
    ids["op"] = await _headers(client, "OPR")
    return ids


def level_rule(level, key, **over):
    return {"match_type": level, "level_key": key, "not_tracked": True, **over}


async def codes(client, h, article="FA_IT_OTHERS", company_id=None):
    url = f"/api/items/articles/codes?article_key={article}" + (f"&company_id={company_id}" if company_id else "")
    return {c["icode"]: c for c in (await client.get(url, headers=h)).json()}


async def article_row(client, h, key, company_id=None):
    url = "/api/items/articles" + (f"?company_id={company_id}" if company_id else "")
    return next(r for r in (await client.get(url, headers=h)).json() if r["article_key"] == key)


async def test_a_whole_department_can_be_marked_not_tracked(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    made = await client.post("/api/items/maps", headers=h, json=level_rule("DEPARTMENT", "FA_IT_OTHERS"))
    assert made.status_code == 201, made.text
    assert (made.json()["not_tracked"], made.json()["item_id"], made.json()["level_key"]) == (True, None, "FA_IT_OTHERS")
    c = await codes(client, h)
    for code in ("CT500001", "CT500002"):
        assert (c[code]["not_tracked"], c[code]["item_id"], c[code]["matched_by"], c[code]["not_tracked_by"]) == (True, None, "DEPARTMENT", "Department FA_IT_OTHERS")
    other = await codes(client, h, "02-I3 CORE[IT-01]")
    assert all(not v["not_tracked"] for v in other.values())                      # another department is untouched


async def test_a_section_and_a_division_work_the_same_way_and_case_does_not_matter(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    await client.post("/api/items/maps", headers=h, json=level_rule("SECTION", "it equipments"))
    c = await codes(client, h)
    assert (c["CT500001"]["matched_by"], c["CT500001"]["not_tracked_by"]) == ("SECTION", "Section it equipments")
    await client.post("/api/items/maps", headers=h, json=level_rule("DIVISION", "fixed assets"))
    assert (await codes(client, h, "FA_CE_UPS")).get("CT1") is None                  # (no codes of that Article in the fake ERP)
    row = await article_row(client, h, "FA_CE_UPS")                                  # COMPUTER EQUIPMENT: only the Division covers it
    assert (row["decision"], row["not_tracked_level"], row["not_tracked_by"]) == ("NOT_TRACKED", "DIVISION", "Division fixed assets")


async def test_the_more_specific_rule_wins_so_one_article_can_stay_tracked_inside_a_department_that_is_not(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    await client.post("/api/items/maps", headers=h, json=level_rule("DEPARTMENT", "FA_IT_OTHERS"))
    await client.post("/api/items/maps", headers=h, json={"item_id": ids["item_cable"], "match_type": "NAME", "name_key": "48 PORT SWITCH", **ART})
    c = await codes(client, h)
    assert (c["CT500001"]["matched_by"], c["CT500001"]["item_name"], c["CT500001"]["not_tracked"]) == ("NAME", "Cable", False)
    assert (c["CT500002"]["matched_by"], c["CT500002"]["not_tracked"]) == ("DEPARTMENT", True)
    # and one code inside a tracked Article can be not tracked (the CAT-6 cable among the cameras)
    await client.post("/api/items/maps", headers=h, json={"item_id": ids["item_desktop"], "match_type": "ARTICLE", **ART})
    await client.post("/api/items/maps", headers=h, json={"not_tracked": True, "match_type": "CODE", "erp_item_code": "CT500002", **ART})
    c = await codes(client, h)
    assert (c["CT500002"]["matched_by"], c["CT500002"]["not_tracked"]) == ("CODE", True)
    assert (c["CT500001"]["matched_by"], c["CT500001"]["item_name"]) == ("NAME", "Cable")
    row = await article_row(client, h, "FA_IT_OTHERS")
    assert (row["decision"], row["item_name"], row["untracked_rules"]) == ("ITEM", "Desktop", 1)


async def test_a_rule_can_be_turned_into_not_tracked_and_back_without_making_a_second_rule(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    item = {"item_id": ids["item_desktop"], "match_type": "ARTICLE", **ART}
    first = (await client.post("/api/items/maps", headers=h, json=item)).json()
    off = (await client.post("/api/items/maps", headers=h, json={**item, "item_id": None, "not_tracked": True})).json()
    assert off["id"] == first["id"] and (off["not_tracked"], off["item_id"]) == (True, None)
    assert (await article_row(client, h, "FA_IT_OTHERS"))["decision"] == "NOT_TRACKED"
    back = (await client.post("/api/items/maps", headers=h, json=item)).json()
    assert back["id"] == first["id"] and (back["not_tracked"], back["item_id"]) == (False, ids["item_desktop"])
    assert (await article_row(client, h, "FA_IT_OTHERS"))["decision"] == "ITEM"


async def test_undoing_a_not_tracked_rule_makes_the_codes_undecided_again(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    rule = (await client.post("/api/items/maps", headers=h, json=level_rule("DEPARTMENT", "FA_IT_OTHERS"))).json()
    assert (await client.delete(f"/api/items/maps/{rule['id']}", headers=h)).status_code == 204
    c = await codes(client, h)
    assert (c["CT500001"]["not_tracked"], c["CT500001"]["matched_by"], c["CT500001"]["item_id"]) == (False, None, None)
    assert (await article_row(client, h, "FA_IT_OTHERS"))["decision"] is None


async def test_the_broad_levels_can_only_say_not_tracked_and_need_a_name(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    refused = await client.post("/api/items/maps", headers=h, json={"item_id": ids["item_cable"], "match_type": "DEPARTMENT", "level_key": "FA_IT_OTHERS"})
    assert refused.status_code == 422 and "can only say" in refused.json()["detail"]
    nameless = await client.post("/api/items/maps", headers=h, json={"not_tracked": True, "match_type": "SECTION"})
    assert nameless.status_code == 422 and "needs the Section name" in nameless.json()["detail"]
    no_item = await client.post("/api/items/maps", headers=h, json={"match_type": "ARTICLE", **ART})
    assert no_item.status_code == 422 and "Item not found" in no_item.json()["detail"]
    assert (await client.post("/api/items/maps", headers=ids["op"], json=level_rule("DEPARTMENT", "X"))).status_code == 403


async def test_a_companys_own_rule_beats_the_every_company_rule_and_the_other_company_never_sees_it(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    await client.post("/api/items/maps", headers=h, json={"item_id": ids["item_desktop"], "match_type": "ARTICLE", **ART})                 # every company
    await client.post("/api/items/maps", headers=h, json={"not_tracked": True, "match_type": "ARTICLE", "company_id": ids["spl"], **ART})   # CKSPL: not tracked
    spl = await codes(client, h, company_id=ids["spl"])
    vpl = await codes(client, h, company_id=ids["vpl"])
    assert spl["CT500001"]["not_tracked"] is True
    assert (vpl["CT500001"]["not_tracked"], vpl["CT500001"]["item_name"]) == (False, "Desktop")


async def test_one_item_can_be_linked_from_articles_of_both_companies(client, erp):
    """The Item "Cable" is shared; each company links its own Articles to it (its codes never overlap)."""
    ids = await _ids(client)
    h = ids["owner"]
    erp.company_articles["CKVPL"] = [type(erp.articles[0])("VPL_CAMERA_INDOOR", "VPL_CAMERA_INDOOR", "IT EQUIPMENTS", "FA_CE_CCTV", codes=1, units=5, lines=2)]
    for company, article in ((ids["spl"], "FA_IT_OTHERS"), (ids["vpl"], "VPL_CAMERA_INDOOR")):
        resp = await client.post("/api/items/maps", headers=h, json={
            "item_id": ids["item_cable"], "match_type": "ARTICLE", "company_id": company, "article_key": article, "article_name": article})
        assert resp.status_code == 201, resp.text
    spl = await article_row(client, h, "FA_IT_OTHERS", ids["spl"])
    vpl = await article_row(client, h, "VPL_CAMERA_INDOOR", ids["vpl"])
    assert (spl["item_name"], vpl["item_name"]) == ("Cable", "Cable")
    items = (await client.get("/api/items", headers=h)).json()
    assert next(i for i in items if i["id"] == ids["item_cable"])["map_count"] == 2


async def test_the_article_list_says_where_a_not_tracked_decision_comes_from(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    await client.post("/api/items/maps", headers=h, json=level_rule("DEPARTMENT", "FA_IT_OTHERS"))
    row = await article_row(client, h, "FA_IT_OTHERS")
    assert (row["decision"], row["not_tracked_level"], row["not_tracked_by"], row["division"]) == ("NOT_TRACKED", "DEPARTMENT", "Department FA_IT_OTHERS", "FIXED ASSETS")
    assert row["decision_map_id"] is not None and row["item_id"] is None and row["suggested_item_id"] is None
    plain = await article_row(client, h, "FA_CE_UPS")
    assert plain["decision"] is None and plain["not_tracked_by"] is None


async def test_the_groups_list_counts_each_department_section_or_division_and_its_decision(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    await client.post("/api/items/maps", headers=h, json=level_rule("DEPARTMENT", "FA_IT_OTHERS"))
    groups = {g["value"]: g for g in (await client.get("/api/items/articles/groups?level=department", headers=h)).json()}
    assert set(groups) == {"FA_CE_DESKTOP", "FA_IT_OTHERS", "FA_CE_UPS"}
    others = groups["FA_IT_OTHERS"]
    assert (others["not_tracked"], others["articles"], others["codes"], others["level"]) == (True, 1, 2, "DEPARTMENT")
    assert groups["FA_CE_UPS"]["not_tracked"] is False and groups["FA_CE_UPS"]["map_id"] is None
    sections = {g["value"]: g for g in (await client.get("/api/items/articles/groups?level=SECTION", headers=h)).json()}
    assert sections["IT EQUIPMENTS"]["articles"] == 2 and sections["IT EQUIPMENTS"]["codes"] == 4
    divisions = (await client.get("/api/items/articles/groups?level=DIVISION", headers=h)).json()
    assert [(g["value"], g["articles"]) for g in divisions] == [("FIXED ASSETS", 3)]
    assert (await client.get("/api/items/articles/groups?level=ARTICLE", headers=h)).status_code == 422
    assert (await client.get("/api/items/articles/groups?level=DEPARTMENT", headers=ids["op"])).status_code == 403


async def test_not_tracked_rules_are_not_an_items_rules_and_deactivating_items_does_not_switch_them_off(client, erp):
    ids = await _ids(client)
    h = ids["owner"]
    await client.post("/api/items/maps", headers=h, json=level_rule("DEPARTMENT", "FA_IT_OTHERS"))
    counts = {i["name"]: i["map_count"] for i in (await client.get("/api/items", headers=h)).json()}
    assert (counts["Desktop"], counts["Cable"], sum(counts.values())) == (1, 0, 1)    # Desktop's own Article rule from the setup; the department rule is nobody's
    async with SessionLocal() as s:
        rows = (await s.execute(select(ItemMap).where(ItemMap.not_tracked.is_(True)))).scalars().all()
    assert len(rows) == 1 and rows[0].item_id is None
    for item_id in (ids["item_desktop"], ids["item_cable"]):
        assert (await client.delete(f"/api/items/{item_id}", headers=h)).status_code == 204
    assert (await codes(client, h))["CT500001"]["not_tracked"] is True
