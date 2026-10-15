"""S3a-2: the PO review works for a supplier nobody has matched yet (suggestions by GSTIN / PAN / name, the
supplier's other registrations), and Create matches the vendor and remembers Item choices inside the same
all-or-nothing transaction as the PO."""
from sqlalchemy import func, select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.erp.source import ErpArticle
from app.items.models import ItemMap
from app.masters.models import Vendor, VendorErpLink
from app.purchase_orders.models import PurchaseOrder
from tests.erp.s3a2_world import BS_MP, BS_NOGST, BS_UP, BS_WB, PAN, add_vendor, bs_po, build_s3a2_world, create_body
from tests.erp.test_erp_api import _headers, erp, line  # noqa: F401  (erp is a fixture)

BS = 5001


async def draft(client, who="OPR", code=BS):
    resp = await client.get(f"/api/erp/pos/{code}/draft", headers=await _headers(client, who))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def counts():
    async with SessionLocal() as s:
        return ((await s.execute(select(func.count()).select_from(Vendor))).scalar_one(),
                (await s.execute(select(func.count()).select_from(VendorErpLink))).scalar_one(),
                (await s.execute(select(func.count()).select_from(PurchaseOrder))).scalar_one())


async def links(company_id):
    async with SessionLocal() as s:
        return dict((await s.execute(select(VendorErpLink.erp_vendor_code, VendorErpLink.vendor_id)
                                     .where(VendorErpLink.company_id == company_id))).all())


# ---------- the draft ----------

async def test_the_draft_of_an_unmatched_supplier_carries_what_is_needed_to_match_it(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po()
    by_gstin = await add_vendor("Blue Star MP Office", gstin=f"23{PAN}1Z0")
    by_pan = await add_vendor("Blue Star Mumbai", gstin=f"27{PAN}1Z5")
    by_name = await add_vendor("Blue Star")
    sibling = await add_vendor("Blue Star Limited")
    async with SessionLocal() as s:
        s.add(VendorErpLink(vendor_id=sibling, company_id=ids["spl"], erp_vendor_code=BS_UP))
        await s.commit()
    d = await draft(client)
    assert d["vendor"] is None and d["vendor_linked"] is False and d["vendor_id"] is None
    assert d["erp_vendor"] == {"code": BS_MP, "name": "BLUE STAR LTD (MP)", "gstin": f"23{PAN}1Z0", "pan": PAN, "group_key": f"CKSPL:{PAN}"}
    # the vendor the other registrations are linked to comes first, then GSTIN, PAN, name
    assert [(v["vendor_id"], v["reason"]) for v in d["vendor_suggestions"]] == [
        (sibling, "PAN"), (by_gstin, "GSTIN"), (by_pan, "PAN"), (by_name, "NAME")]
    regs = {r["erp_code"]: r for r in d["vendor_registrations"]}
    assert set(regs) == {BS_UP, BS_WB}                       # same PAN only (BS4 has no GSTIN; the CKVPL one is another company)
    assert (regs[BS_UP]["linked"], regs[BS_UP]["linked_vendor_id"]) == (True, sibling)
    assert (regs[BS_WB]["linked"], regs[BS_WB]["linked_vendor_id"]) == (False, None)
    assert any("not linked to a CKAM vendor" in w for w in d["warnings"])
    assert d["readiness"] == "NEEDS_INPUT" and [p["kind"] for p in d["problems"]] == ["VENDOR_UNMATCHED", "ITEMS_UNDECIDED"]


async def test_each_draft_line_says_its_decision_suggestion_and_default_reach(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po(lines=[line(1, "CT500001", "48 PORT SWITCH", 2, 9000), line(2, "CT324973", "DELL DESKTOP", 1, 20000),
                               line(3, "CT777", "NOT IN THE MASTER", 1, 100)])
    switch, desktop, unknown = (await draft(client))["lines"]
    assert switch["resolution"] == {"state": "NEEDS_ITEM", "item_id": None, "item_name": None, "via": None}
    # S7 (P1-3, intended change): "48 PORT SWITCH" has only one of the two words of "Network Switch" (a 50% overlap)
    # -- below the safe threshold now, so no suggestion (tests/erp/test_s7_item_suggestions.py has the positive cases).
    assert (switch["suggested_item_id"], switch["suggested_item_name"], switch["suggestion_score"]) == (None, None, None)
    assert switch["suggested_scope"] == "ARTICLE"            # FA_IT_OTHERS has only 2 product names so far
    assert desktop["resolution"] == {"state": "MATCHED", "item_id": ids["item_desktop"], "item_name": "Desktop", "via": "ARTICLE"}
    assert desktop["suggested_item_id"] is None
    assert unknown["resolution"]["state"] == "NEEDS_ITEM" and unknown["suggested_scope"] == "CODE"


async def test_a_catch_all_article_defaults_to_remembering_the_product_name(client, erp):
    await build_s3a2_world(erp)
    erp.articles = [ErpArticle("FA_IT_OTHERS", "FA_IT_OTHERS", "IT EQUIPMENTS", "FA_IT_OTHERS", codes=7, units=40, lines=9,
                               names=["48 PORT SWITCH", "6U RACK", "PATCH CORD", "KVM", "CABLE TESTER", "CRIMPER", "IO BOX"])]
    erp.pos[BS] = bs_po()
    [ln] = (await draft(client))["lines"]
    assert ln["suggested_scope"] == "NAME"


async def test_the_draft_of_a_linked_supplier_has_no_suggestions(client, erp):
    ids = await build_s3a2_world(erp)
    d = await draft(client, code=1133610106)
    assert d["vendor"] == {"id": ids["vansh"], "name": "Vansh Enterprises"} and d["vendor_suggestions"] == []
    assert d["readiness"] == "READY" and d["problems"] == []


async def test_another_companys_supplier_details_are_not_shown(client, erp):
    await build_s3a2_world(erp)
    erp.pos[5002] = bs_po(po_code=5002, supplier="77", name="BLUE STAR LTD", company="CKVPL")
    # a CKSPL operator looking at a CKVPL PO: security fix IF-03 (intended change) -- the draft is no longer shown
    # at all (it used to come back with the supplier details blanked, but with rates, warehouse and lines).
    resp = await client.get("/api/erp/pos/5002/draft", headers=await _headers(client, "OPR"))
    assert resp.status_code == 404 and "BLUE STAR" not in resp.text


# ---------- create with the vendor matched in the flow ----------

async def test_create_links_the_supplier_and_its_registrations_in_the_same_transaction(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po()
    blue = await add_vendor("Blue Star Limited")
    h = await _headers(client, "OPR")
    body = create_body(await draft(client), ids, vendor_choice={"action": "LINK", "vendor_id": blue, "also_link_codes": [BS_UP, BS_WB]})
    resp = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert resp.status_code == 201, resp.text
    po = (await client.get(f"/api/purchase-orders/{resp.json()['po_id']}", headers=h)).json()
    assert po["vendor_id"] == blue
    assert {c: v for c, v in (await links(ids["spl"])).items() if c.startswith("BS")} == {BS_MP: blue, BS_UP: blue, BS_WB: blue}


async def test_create_makes_a_new_vendor_from_the_erp_supplier(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po()
    h = await _headers(client, "OPR")
    resp = await client.post("/api/erp/pos/create", headers=h, json=create_body(await draft(client), ids, vendor_choice={"action": "CREATE"}))
    assert resp.status_code == 201, resp.text
    async with SessionLocal() as s:
        vendor = (await s.execute(select(Vendor).where(Vendor.name == "BLUE STAR LTD (MP)"))).scalar_one()
        opr = (await s.execute(select(AssetUser.id).where(AssetUser.code == "OPR"))).scalar_one()
        po = await s.get(PurchaseOrder, resp.json()["po_id"])
    assert (vendor.gstin, vendor.code, vendor.created_by, po.vendor_id) == (f"23{PAN}1Z0", "BLUESTARLTDMP", opr, vendor.id)
    assert (await links(ids["spl"]))[BS_MP] == vendor.id
    # the next PO of this supplier is matched by itself
    erp.pos[5004] = bs_po(po_code=5004)
    assert (await draft(client, code=5004))["vendor_linked"] is True


async def test_a_failure_later_in_the_create_rolls_the_new_vendor_back_too(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po()
    before = await counts()
    body = create_body(await draft(client), ids, vendor_choice={"action": "CREATE", "name": "Blue Star"})
    body["lines"][0]["rate"] = 1                                         # far below the ERP rate: refused
    resp = await client.post("/api/erp/pos/create", headers=await _headers(client, "OPR"), json=body)
    assert resp.status_code == 422 and "too far from the ERP rate" in resp.json()["detail"]
    assert await counts() == before
    link_body = create_body(await draft(client), ids, vendor_choice={"action": "LINK", "vendor_id": ids["oldco"], "also_link_codes": [BS_UP]})
    link_body["lines"][0]["item_id"] = 999999
    assert (await client.post("/api/erp/pos/create", headers=await _headers(client, "OPR"), json=link_body)).status_code == 422
    assert await counts() == before and BS_MP not in await links(ids["spl"])


async def test_create_refuses_a_gstin_twin_and_registrations_of_another_supplier(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po()
    h = await _headers(client, "OPR")
    other_pan = await client.post("/api/erp/pos/create", headers=h, json=create_body(
        await draft(client), ids, vendor_choice={"action": "LINK", "vendor_id": ids["oldco"], "also_link_codes": ["2264"]}))
    assert other_pan.status_code == 422 and "not a registration of the same supplier" in other_pan.json()["detail"]
    await add_vendor("Blue Star MP Office", gstin=f"23{PAN}1Z0")
    twin = await client.post("/api/erp/pos/create", headers=h, json=create_body(await draft(client), ids, vendor_choice={"action": "CREATE"}))
    assert twin.status_code == 422
    assert twin.json()["detail"] == "BLUE STAR LTD (MP) is already a vendor here (same GSTIN as Blue Star MP Office). Link it instead."
    # linking it to a vendor other than the one holding its GSTIN is refused too
    wrong = await client.post("/api/erp/pos/create", headers=h, json=create_body(
        await draft(client), ids, vendor_choice={"action": "LINK", "vendor_id": ids["oldco"]}))
    assert wrong.status_code == 422 and "Link it to Blue Star MP Office instead." in wrong.json()["detail"]
    assert BS_MP not in await links(ids["spl"])


async def test_without_a_vendor_choice_the_plain_sentence_is_given(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po()
    resp = await client.post("/api/erp/pos/create", headers=await _headers(client, "OPR"), json=create_body(await draft(client), ids))
    assert resp.status_code == 422
    assert "Match the vendor first (Link to an existing vendor or Create a new one)." in resp.json()["detail"]


async def test_vendor_choice_rules_scope_inactive_vendor_and_already_matched(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po()
    d = await draft(client)
    # an operator of the other company cannot create this PO (and so cannot link its supplier)
    other = await client.post("/api/erp/pos/create", headers=await _headers(client, "OPV"),
                              json=create_body(d, ids, vendor_choice={"action": "CREATE"}))
    assert other.status_code == 403
    async with SessionLocal() as s:
        (await s.get(Vendor, ids["oldco"])).is_active = False
        await s.commit()
    h = await _headers(client, "OPR")
    inactive = await client.post("/api/erp/pos/create", headers=h, json=create_body(d, ids, vendor_choice={"action": "LINK", "vendor_id": ids["oldco"]}))
    assert inactive.status_code == 422 and "no longer active" in inactive.json()["detail"]
    missing = await client.post("/api/erp/pos/create", headers=h, json=create_body(d, ids, vendor_choice={"action": "LINK"}))
    assert missing.status_code == 422 and "Choose the vendor to link to." in missing.json()["detail"]
    # the desktop PO's supplier is already VANSH: linking it to someone else is refused
    linked = await draft(client, code=1133610106)
    clash = await client.post("/api/erp/pos/create", headers=h, json=create_body(
        linked, ids, vendor_choice={"action": "LINK", "vendor_id": ids["harshit"]}))
    assert clash.status_code == 422 and "already matched to the vendor Vansh Enterprises" in clash.json()["detail"]
    assert await counts() == (3, 1, 0)


# ---------- remembering Item choices ----------

async def _rules(item_id):
    async with SessionLocal() as s:
        return [(m.match_type, m.company_id, m.erp_item_code, m.article_key, m.name_key, m.created_by)
                for m in (await s.execute(select(ItemMap).where(ItemMap.item_id == item_id, ItemMap.is_active.is_(True)))).scalars().all()]


async def _opr_id():
    async with SessionLocal() as s:
        return (await s.execute(select(AssetUser.id).where(AssetUser.code == "OPR"))).scalar_one()


async def test_remember_without_a_reach_uses_the_lines_suggested_reach(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[BS] = bs_po()
    body = create_body(await draft(client), ids, vendor_choice={"action": "CREATE"})
    body["lines"][0] |= {"item_id": ids["item_switch"], "remember": True,
                         "article_key": "SOMETHING ELSE", "article_name": "FAKE"}          # browser values are not trusted
    resp = await client.post("/api/erp/pos/create", headers=await _headers(client, "OPR"), json=body)
    assert resp.status_code == 201, resp.text
    assert await _rules(ids["item_switch"]) == [("ARTICLE", ids["spl"], None, "FA_IT_OTHERS", None, await _opr_id())]
    # the next PO with the rack (same Article) needs nothing
    erp.pos[5004] = bs_po(po_code=5004, lines=[line(1, "CT500002", "6U RACK", 1, 500)])
    [rack] = (await draft(client, code=5004))["lines"]
    assert rack["resolution"]["state"] == "MATCHED" and rack["resolution"]["via"] == "ARTICLE"


async def test_remember_in_a_catch_all_article_stores_the_product_name(client, erp):
    ids = await build_s3a2_world(erp)
    erp.articles = [ErpArticle("FA_IT_OTHERS", "FA_IT_OTHERS", "IT EQUIPMENTS", "FA_IT_OTHERS", codes=7, units=40, lines=9,
                               names=["48 PORT SWITCH", "6U RACK", "PATCH CORD", "KVM", "CABLE TESTER", "CRIMPER", "IO BOX"])]
    erp.pos[BS] = bs_po()
    body = create_body(await draft(client), ids, vendor_choice={"action": "CREATE"})
    body["lines"][0] |= {"item_id": ids["item_switch"], "remember": True}
    assert (await client.post("/api/erp/pos/create", headers=await _headers(client, "OPR"), json=body)).status_code == 201
    assert await _rules(ids["item_switch"]) == [("NAME", ids["spl"], None, "FA_IT_OTHERS", "48 port switch", await _opr_id())]


async def test_operators_and_admins_remember_code_name_and_article(client, erp):
    ids = await build_s3a2_world(erp)
    for po_code, scope, who in ((6001, "CODE", "OPR"), (6002, "NAME", "ADM"), (6003, "ARTICLE", "OPIT")):
        erp.pos[po_code] = bs_po(po_code=po_code, supplier="11338", name="VANSH ENTERPRISES",
                                 lines=[line(1, "CT500001", "48 PORT SWITCH", 1, 9000)])
        body = create_body(await draft(client, who, po_code), ids)
        body["lines"][0] |= {"item_id": ids["item_switch"], "map_scope": scope}
        resp = await client.post("/api/erp/pos/create", headers=await _headers(client, who), json=body)
        assert resp.status_code == 201, (scope, resp.text)
    assert sorted(r[0] for r in await _rules(ids["item_switch"])) == ["ARTICLE", "CODE", "NAME"]


async def test_an_operator_cannot_repoint_an_existing_decision_but_can_narrow_it_and_the_owner_can_change_it(client, erp):
    ids = await build_s3a2_world(erp)

    async def create(po_code, who, scope):
        erp.pos[po_code] = bs_po(po_code=po_code, supplier="11338", name="VANSH ENTERPRISES",
                                 lines=[line(1, "CT324973", "DELL DESKTOP", 1, 20000)])
        body = create_body(await draft(client, who, po_code), ids)
        body["lines"][0] |= {"item_id": ids["item_switch"], "map_scope": scope}
        return await client.post("/api/erp/pos/create", headers=await _headers(client, who), json=body)

    refused = await create(6001, "OPR", "ARTICLE")
    assert refused.status_code == 422
    assert refused.json()["detail"] == ("Line 1 (CT324973): the whole Article 02-I3 CORE[IT-01] is already linked to Desktop. "
                                        "Remember this choice for this code only, or ask the head-office admin to change it.")
    assert await counts() == (3, 1, 0)                                  # nothing was created
    narrow = await create(6002, "OPR", "CODE")                          # this one code is different: allowed
    assert narrow.status_code == 201, narrow.text
    owner = await create(6003, "OWN", "ARTICLE")                        # rule management: the head-office admin may
    assert owner.status_code == 201, owner.text
    async with SessionLocal() as s:
        article = (await s.execute(select(ItemMap).where(ItemMap.match_type == "ARTICLE", ItemMap.article_key == "02-I3 CORE[IT-01]",
                                                         ItemMap.is_active.is_(True)))).scalars().all()
    assert [(m.company_id, m.item_id) for m in article] == [(None, ids["item_desktop"]), (ids["spl"], ids["item_switch"])]
