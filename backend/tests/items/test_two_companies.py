"""Two companies, two ERP masters: the same product (a mic) has different codes,
Sections, Departments and Articles in each, and the same Article NAME can mean
different things. Item rules therefore belong to a company; the Item itself is
shared."""
from sqlalchemy import select
from app.core.db import SessionLocal
from app.erp.source import ErpArticle, ErpItem
from app.items.models import Item, ItemMap
from tests.erp.test_erp_api import _headers, _setup, erp, line, desktop_po  # noqa: F401  (erp is a fixture)

PO_CODE = 1133610106


async def _two_company_setup(client, erp):
    ids = await _setup()
    h = await _headers(client, "OWN")                    # the Primary Owner sees every company
    async with SessionLocal() as session:
        mic = Item(name="Mic", category_id=ids["acc"], subcategory_id=ids["cables"])
        speaker = Item(name="Speaker", category_id=ids["acc"], subcategory_id=ids["cables"])
        session.add_all([mic, speaker])
        await session.commit()
        ids["mic"], ids["speaker"] = mic.id, speaker.id
    # CKSPL: the mic is Article FA_CE_MIC, code CT100.  CKVPL: a different master -- Article VT_MIC_STD,
    # code VM200 -- and in CKVPL's master the Article NAME FA_CE_MIC is something else entirely (a speaker).
    erp.erp_items |= {
        "CT100": ErpItem("CT100", "FA_CE_MIC", "FA_CE_MIC", "IT EQUIPMENTS", "FA_CE_MIC", cats=["WIRELESS MIC"]),
        "VM200": ErpItem("VM200", "VT_MIC_STD", "VT_MIC_STD", "ELECTRICALS", "VT_AUDIO", cats=["MIC STAND TYPE"]),
        "VM300": ErpItem("VM300", "FA_CE_MIC", "FA_CE_MIC", "ELECTRICALS", "VT_AUDIO", cats=["CEILING SPEAKER"]),
    }
    erp.company_articles = {
        "CKSPL": [ErpArticle("FA_CE_MIC", "FA_CE_MIC", "IT EQUIPMENTS", "FA_CE_MIC", codes=1, units=117, lines=9, samples=["WIRELESS MIC"])],
        "CKVPL": [ErpArticle("VT_MIC_STD", "VT_MIC_STD", "ELECTRICALS", "VT_AUDIO", codes=1, units=10, lines=2, samples=["MIC STAND TYPE"]),
                  ErpArticle("FA_CE_MIC", "FA_CE_MIC", "ELECTRICALS", "VT_AUDIO", codes=1, units=4, lines=1, samples=["CEILING SPEAKER"])],
    }
    erp.company_codes = {"CKSPL": {"CT100"}, "CKVPL": {"VM200", "VM300"}}
    return ids, h


async def rule(client, h, ids, company, item, article_key, **extra):
    body = {"item_id": item, "company_id": company, "match_type": "ARTICLE", "article_key": article_key, "article_name": article_key} | extra
    resp = await client.post("/api/items/maps", headers=h, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def draft_item(client, erp, h, company_code, code):
    erp.pos[PO_CODE] = desktop_po(company_code=company_code, delivery_location=f"{company_code}-WH-X", lines=[line(1, code, "x", 1, 100)])
    return (await client.get(f"/api/erp/pos/{PO_CODE}/draft", headers=h)).json()["lines"][0]


async def test_the_same_product_with_different_codes_and_articles_in_two_companies_is_one_item(client, erp):
    ids, h = await _two_company_setup(client, erp)
    await rule(client, h, ids, ids["spl"], ids["mic"], "FA_CE_MIC")
    await rule(client, h, ids, ids["vpl"], ids["mic"], "VT_MIC_STD")
    ckspl = await draft_item(client, erp, h, "CKSPL", "CT100")
    ckvpl = await draft_item(client, erp, h, "CKVPL", "VM200")
    assert (ckspl["item_name"], ckspl["matched_by"], ckspl["article_name"]) == ("Mic", "ARTICLE", "FA_CE_MIC")
    assert (ckvpl["item_name"], ckvpl["matched_by"], ckvpl["article_name"], ckvpl["department"]) == ("Mic", "ARTICLE", "VT_MIC_STD", "VT_AUDIO")
    assert ckspl["item_id"] == ckvpl["item_id"] == ids["mic"]                           # one CKAM Item, two ERP masters


async def test_a_rule_made_for_one_company_never_applies_to_another(client, erp):
    ids, h = await _two_company_setup(client, erp)
    await rule(client, h, ids, ids["spl"], ids["mic"], "FA_CE_MIC")                 # CKSPL: FA_CE_MIC is the mic
    in_ckvpl = await draft_item(client, erp, h, "CKVPL", "VM300")                    # but CKVPL's FA_CE_MIC is a speaker
    assert in_ckvpl["item_id"] is None and any("No Item is linked" in w for w in in_ckvpl["warnings"])
    await rule(client, h, ids, ids["vpl"], ids["speaker"], "FA_CE_MIC")             # CKVPL links the same Article name to its own Item
    assert (await draft_item(client, erp, h, "CKVPL", "VM300"))["item_name"] == "Speaker"
    assert (await draft_item(client, erp, h, "CKSPL", "CT100"))["item_name"] == "Mic"      # CKSPL is untouched


async def test_a_company_rule_beats_an_every_company_rule(client, erp):
    ids, h = await _two_company_setup(client, erp)
    await rule(client, h, ids, None, ids["mic"], "FA_CE_MIC")                       # for every company (two companies sharing one master)
    assert (await draft_item(client, erp, h, "CKSPL", "CT100"))["item_name"] == "Mic"
    assert (await draft_item(client, erp, h, "CKVPL", "VM300"))["item_name"] == "Mic"      # inherited
    await rule(client, h, ids, ids["vpl"], ids["speaker"], "FA_CE_MIC")             # CKVPL's own rule wins for CKVPL only
    assert (await draft_item(client, erp, h, "CKVPL", "VM300"))["item_name"] == "Speaker"
    assert (await draft_item(client, erp, h, "CKSPL", "CT100"))["item_name"] == "Mic"


async def test_the_article_screen_is_per_company(client, erp):
    ids, h = await _two_company_setup(client, erp)
    await rule(client, h, ids, ids["spl"], ids["mic"], "FA_CE_MIC")
    spl = {a["article_key"]: a for a in (await client.get(f"/api/items/articles?company_id={ids['spl']}", headers=h)).json()}
    vpl = {a["article_key"]: a for a in (await client.get(f"/api/items/articles?company_id={ids['vpl']}", headers=h)).json()}
    assert set(spl) == {"FA_CE_MIC"} and spl["FA_CE_MIC"]["item_name"] == "Mic"
    assert set(vpl) == {"VT_MIC_STD", "FA_CE_MIC"}
    assert vpl["FA_CE_MIC"]["item_id"] is None and vpl["FA_CE_MIC"]["samples"] == ["CEILING SPEAKER"]     # CKSPL's link is not CKVPL's
    codes = (await client.get(f"/api/items/articles/codes?article_key=FA_CE_MIC&company_id={ids['vpl']}", headers=h)).json()
    assert [c["icode"] for c in codes] == ["VM300"] and codes[0]["item_id"] is None


async def test_the_same_rule_can_exist_once_per_company(client, erp):
    ids, h = await _two_company_setup(client, erp)
    a = await rule(client, h, ids, ids["spl"], ids["mic"], "FA_CE_MIC")
    b = await rule(client, h, ids, ids["vpl"], ids["speaker"], "FA_CE_MIC")
    again = await rule(client, h, ids, ids["spl"], ids["speaker"], "FA_CE_MIC")           # re-pointing CKSPL's rule only changes CKSPL's
    assert a["id"] == again["id"] and b["id"] != a["id"] and again["item_id"] == ids["speaker"]
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(ItemMap.company_id, ItemMap.item_id).where(ItemMap.is_active.is_(True), ItemMap.article_key == "FA_CE_MIC")
        )).all()
    assert sorted(rows) == sorted([(ids["spl"], ids["speaker"]), (ids["vpl"], ids["speaker"])])
    bad = await client.post("/api/items/maps", headers=h, json={"item_id": ids["mic"], "company_id": 999999, "match_type": "ARTICLE", "article_key": "X"})
    assert bad.status_code == 422 and "company not found" in bad.json()["detail"]


async def test_choosing_an_item_on_a_po_remembers_it_for_that_pos_company_only(client, erp):
    ids, h = await _two_company_setup(client, erp)
    e = erp.erp_items["VM200"]
    body = {"company_id": ids["vpl"], "po_number": "VPO-1", "po_date": "2026-09-18", "vendor_id": ids["vansh"],
            "cost_center_id": ids["cost_vpl"], "lines": [{
                "item_code": "VM200", "description": "MIC STAND TYPE", "barcode": "VM200", "quantity": 1, "rate": 100, "tax_percent": 18,
                "item_id": ids["mic"], "map_scope": "ARTICLE", "article_key": e.article_key, "article_name": e.article_name,
                "section": e.section, "department": e.department, "name_key": e.name}]}
    resp = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert resp.status_code == 201, resp.text
    async with SessionLocal() as session:
        [m] = (await session.execute(select(ItemMap).where(ItemMap.is_active.is_(True), ItemMap.article_key == "VT_MIC_STD"))).scalars().all()
    assert (m.company_id, m.match_type, m.article_key, m.item_id, m.section, m.department) == (
        ids["vpl"], "ARTICLE", "VT_MIC_STD", ids["mic"], "ELECTRICALS", "VT_AUDIO")
