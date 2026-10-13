"""S3a-2: "Not an asset" from the PO review (ADMIN / OPERATOR, code / product name / Article, in the PO's
company, actor recorded); whole Department / Section / Division and undoing stay with the head-office admin;
and the rule engine's precedence is unchanged."""
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.items.models import ItemMap
from tests.erp.s3a2_world import bs_po, build_s3a2_world
from tests.erp.test_erp_api import _headers, erp, line  # noqa: F401  (erp is a fixture)

BS = 5001


def mixed():
    return bs_po(supplier="11338", name="VANSH ENTERPRISES", lines=[
        line(1, "CT500001", "48 PORT SWITCH", 2, 9000), line(2, "CT500002", "6U RACK", 4, 500), line(3, "CT324973", "DELL DESKTOP", 1, 20000)])


async def mark(client, who, icode, scope, code=BS):
    return await client.post(f"/api/erp/pos/{code}/not-tracked", headers=await _headers(client, who), json={"icode": icode, "scope": scope})


async def active_rules():
    async with SessionLocal() as s:
        return (await s.execute(select(ItemMap).where(ItemMap.is_active.is_(True)).order_by(ItemMap.id))).scalars().all()


def states(body):
    return {ln["item_code"]: ln["resolution"]["state"] for ln in body["lines"]}


async def test_an_operator_marks_one_code_not_tracked_and_gets_the_lines_back(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    resp = await mark(client, "OPR", "ct500002", "CODE")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert states(body) == {"CT500001": "NEEDS_ITEM", "CT500002": "NOT_TRACKED", "CT324973": "MATCHED"}
    assert body["undecided_item_count"] == 1 and body["readiness"] == "NEEDS_INPUT"
    rule = (await active_rules())[-1]
    async with SessionLocal() as s:
        opr = (await s.execute(select(AssetUser.id).where(AssetUser.code == "OPR"))).scalar_one()
    assert (rule.match_type, rule.erp_item_code, rule.not_tracked, rule.company_id, rule.item_id, rule.created_by) == (
        "CODE", "CT500002", True, ids["spl"], None, opr)
    # the draft now leaves the line out, like every other "not tracked" line
    draft = (await client.get(f"/api/erp/pos/{BS}/draft", headers=await _headers(client, "OPR"))).json()
    assert [u["item_code"] for u in draft["untracked_lines"]] == ["CT500002"]
    assert draft["untracked_lines"][0]["resolution"]["state"] == "NOT_TRACKED"


async def test_product_name_and_article_are_allowed_to_admins_and_operators(client, erp):
    await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    name = await mark(client, "ADM", "CT500001", "NAME")
    assert name.status_code == 200 and states(name.json())["CT500001"] == "NOT_TRACKED"
    assert states(name.json())["CT500002"] == "NEEDS_ITEM"                 # only that product name
    article = await mark(client, "OPIT", "CT500002", "ARTICLE")
    assert article.status_code == 200 and states(article.json())["CT500002"] == "NOT_TRACKED"
    assert {(r.match_type, r.article_key, r.name_key) for r in await active_rules() if r.not_tracked} == {
        ("NAME", "FA_IT_OTHERS", "48 port switch"), ("ARTICLE", "FA_IT_OTHERS", None)}
    # making the whole PO "nothing tracked but the desktop" makes it ready (the vendor is linked)
    assert article.json()["readiness"] == "READY"


async def test_whole_departments_stay_with_the_head_office_admin(client, erp):
    await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    for scope in ("DEPARTMENT", "SECTION", "DIVISION"):
        refused = await mark(client, "OPR", "CT500001", scope)
        assert refused.status_code == 403
        assert refused.json()["detail"] == "Ask the head-office admin to mark whole departments as not tracked."
    assert [r for r in await active_rules() if r.not_tracked] == []
    owner = await mark(client, "OWN", "CT500001", "DEPARTMENT")
    assert owner.status_code == 200 and states(owner.json())["CT500002"] == "NOT_TRACKED"   # same department
    assert [(r.match_type, r.level_key) for r in await active_rules() if r.not_tracked] == [("DEPARTMENT", "FA_IT_OTHERS")]


async def test_undo_stays_with_the_head_office_admin(client, erp):
    await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    await mark(client, "OPR", "CT500001", "CODE")
    rule = (await active_rules())[-1]
    assert (await client.delete(f"/api/items/maps/{rule.id}", headers=await _headers(client, "OPR"))).status_code == 403
    assert (await client.delete(f"/api/items/maps/{rule.id}", headers=await _headers(client, "ADM"))).status_code == 403
    assert (await client.delete(f"/api/items/maps/{rule.id}", headers=await _headers(client, "OWN"))).status_code == 204


async def test_refusals_decided_lines_codes_not_on_the_po_other_companies_and_viewers(client, erp):
    await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    decided = await mark(client, "OPR", "CT324973", "CODE")
    assert decided.status_code == 422
    assert decided.json()["detail"] == "This line is already linked to the Item Desktop. Ask the head-office admin to change it."
    not_on_po = await mark(client, "OPR", "CT999001", "CODE")
    assert not_on_po.status_code == 422 and "is not on the purchase order" in not_on_po.json()["detail"]
    other = await mark(client, "OPV", "CT500001", "CODE")
    assert other.status_code == 403 and "your own company" in other.json()["detail"]
    assert (await mark(client, "VWR", "CT500001", "CODE")).status_code == 403
    assert (await mark(client, "OPR", "CT500001", "CODE", code=999)).status_code == 404
    bad_scope = await client.post(f"/api/erp/pos/{BS}/not-tracked", headers=await _headers(client, "OPR"), json={"icode": "CT500001", "scope": "PO"})
    assert bad_scope.status_code == 422
    assert [r for r in await active_rules() if r.not_tracked] == []
    # marking again what is already not tracked changes nothing
    await mark(client, "OPR", "CT500001", "CODE")
    again = await mark(client, "OPR", "CT500001", "ARTICLE")
    assert again.status_code == 200 and len([r for r in await active_rules() if r.not_tracked]) == 1


# ---------- the engine's precedence is unchanged (regression) ----------

async def test_precedence_code_beats_name_beats_article_beats_levels_and_an_item_beats_a_broader_not_tracked(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    h = await _headers(client)
    # the whole department not tracked, but one code of it linked to an Item: the Item wins for that code
    assert (await client.post("/api/items/maps", headers=h, json={"match_type": "DEPARTMENT", "level_key": "FA_IT_OTHERS",
                                                                 "not_tracked": True, "company_id": ids["spl"]})).status_code == 201
    assert (await client.post("/api/items/maps", headers=h, json={"match_type": "CODE", "erp_item_code": "CT500001",
                                                                 "item_id": ids["item_switch"], "company_id": ids["spl"]})).status_code == 201
    draft = (await client.get(f"/api/erp/pos/{BS}/draft", headers=await _headers(client, "OPR"))).json()
    by = {ln["item_code"]: ln["resolution"] for ln in draft["lines"]}
    assert by["CT500001"] == {"state": "MATCHED", "item_id": ids["item_switch"], "item_name": "Network Switch", "via": "CODE"}
    assert [u["item_code"] for u in draft["untracked_lines"]] == ["CT500002"]
    assert draft["untracked_lines"][0]["resolution"]["via"] == "DEPARTMENT"
    # an Article rule for the rack's Article, then a product-name rule beating it for the rack only
    assert (await client.post("/api/items/maps", headers=h, json={"match_type": "ARTICLE", "article_key": "FA_IT_OTHERS",
                                                                 "item_id": ids["item_cable"], "company_id": ids["spl"]})).status_code == 201
    assert (await client.post("/api/items/maps", headers=h, json={"match_type": "NAME", "article_key": "FA_IT_OTHERS", "name_key": "6U RACK",
                                                                 "item_id": ids["item_chair"], "company_id": ids["spl"]})).status_code == 201
    rows = (await client.get("/api/erp/pos", headers=await _headers(client, "OPR"))).json()
    assert next(r for r in rows if r["po_code"] == BS)["readiness"] == "READY"
    draft = (await client.get(f"/api/erp/pos/{BS}/draft", headers=await _headers(client, "OPR"))).json()
    by = {ln["item_code"]: ln["resolution"] for ln in draft["lines"]}
    assert (by["CT500001"]["via"], by["CT500002"]["via"], by["CT500002"]["item_id"]) == ("CODE", "NAME", ids["item_chair"])


async def test_a_companys_own_rule_beats_an_every_company_rule_and_never_reaches_the_other_company(client, erp):
    ids = await build_s3a2_world(erp)
    h = await _headers(client)
    erp.pos[BS] = mixed()
    erp.pos[5002] = bs_po(po_code=5002, supplier="77", name="BLUE STAR LTD", company="CKVPL",
                          lines=[line(1, "CT500001", "48 PORT SWITCH", 1, 9000)])
    await client.post("/api/items/maps", headers=h, json={"match_type": "ARTICLE", "article_key": "FA_IT_OTHERS", "item_id": ids["item_cable"]})
    await client.post("/api/items/maps", headers=h, json={"match_type": "ARTICLE", "article_key": "FA_IT_OTHERS",
                                                          "item_id": ids["item_switch"], "company_id": ids["spl"]})
    spl = {ln["item_code"]: ln["resolution"]["item_id"] for ln in (await client.get(f"/api/erp/pos/{BS}/draft", headers=h)).json()["lines"]}
    vpl = {ln["item_code"]: ln["resolution"]["item_id"] for ln in (await client.get("/api/erp/pos/5002/draft", headers=h)).json()["lines"]}
    assert spl["CT500001"] == ids["item_switch"] and vpl["CT500001"] == ids["item_cable"]
    # an operator's "not tracked" in CKSPL never touches CKVPL
    await client.post("/api/items/maps", headers=h, json={"match_type": "CODE", "erp_item_code": "CT500001", "not_tracked": True,
                                                          "company_id": ids["spl"]})
    vpl = (await client.get("/api/erp/pos/5002/draft", headers=h)).json()
    assert vpl["lines"][0]["resolution"]["state"] == "MATCHED"
