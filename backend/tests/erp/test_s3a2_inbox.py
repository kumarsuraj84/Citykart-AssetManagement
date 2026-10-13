"""S3a-2: the head-office admin's ERP inbox lists only what really waits for a decision (codes on open POs
with no decision, unlinked suppliers with open POs grouped by PAN, ready stores not created yet), and
resolves batches through the existing writers, one transaction per entry."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.db import SessionLocal
from app.erp.mirror_models import ErpSiteCopy
from app.items.models import Item, ItemMap
from app.masters.models import VendorErpLink
from tests.erp.s3a2_world import BS_MP, BS_NOGST, BS_UP, BS_WB, PAN, add_vendor, bs_po, build_s3a2_world, create_body
from tests.erp.test_erp_api import _headers, desktop_po, erp, line  # noqa: F401  (erp is a fixture)

NOW = datetime(2026, 10, 13, tzinfo=timezone.utc)


async def inbox(client, company_id=None, who="OWN"):
    params = {"company_id": company_id} if company_id is not None else {}
    resp = await client.get("/api/erp/inbox", params=params, headers=await _headers(client, who))
    assert resp.status_code == 200, resp.text
    return resp.json()


def site(code, status="ACTIVE", site_code=1, company="CKSPL"):
    return ErpSiteCopy(company_code=company, site_code=site_code, short_name=code, site_name=code, store_name=f"Store {code}",
                       site_kind="STORE", store_status=status, is_active_site=True, row_hash="x", first_seen_at=NOW,
                       last_seen_at=NOW, is_present=True)


async def world(erp):
    ids = await build_s3a2_world(erp)
    erp.pos[5001] = bs_po(lines=[line(1, "CT500001", "48 PORT SWITCH", 2, 9000), line(2, "CT500002", "6U RACK", 3, 500),
                                 line(3, "CT324973", "DELL DESKTOP", 1, 20000)])
    erp.pos[5002] = bs_po(po_code=5002, supplier=BS_UP, name="BLUE STAR LIMITED", lines=[line(1, "CT500001", "48 PORT SWITCH", 5, 9000)])
    # never on an OPEN PO: a closed PO's code, a fully cancelled line's code
    erp.pos[5003] = bs_po(po_code=5003, status="CLOSED", lines=[line(1, "CT999001", "LENOVO DESKTOP I3", 1, 100)])
    erp.pos[5004] = bs_po(po_code=5004, supplier="11338", name="VANSH ENTERPRISES",
                          lines=[line(1, "CT324973", "DELL DESKTOP", 1, 20000), line(2, "CT777", "GONE", 2, 10, cancelled=2)])
    return ids


async def test_only_the_head_office_admin_sees_the_inbox(client, erp):
    await world(erp)
    for who in ("OPR", "ADM", "VWR"):
        resp = await client.get("/api/erp/inbox", headers=await _headers(client, who))
        assert resp.status_code == 403 and resp.json()["detail"] == "Only the head-office admin can do this."
        assert (await client.post("/api/erp/inbox/items/resolve", headers=await _headers(client, who), json=[{
            "company_id": 1, "icode": "CT500001", "scope": "CODE", "not_tracked": True}])).status_code == 403
        assert (await client.post("/api/erp/inbox/vendors/resolve", headers=await _headers(client, who), json=[{
            "company_id": 1, "erp_vendor_codes": [BS_MP], "action": "CREATE"}])).status_code == 403
    assert (await client.get("/api/erp/inbox", params={"company_id": 99999}, headers=await _headers(client))).status_code == 404


async def test_new_items_are_only_undecided_codes_on_open_pos_grouped_by_article(client, erp):
    ids = await world(erp)
    body = await inbox(client, ids["spl"])
    [group] = body["items"]
    assert (group["company_id"], group["article_key"], group["article_name"], group["department"], group["section"]) == (
        ids["spl"], "FA_IT_OTHERS", "FA_IT_OTHERS", "FA_IT_OTHERS", "IT EQUIPMENTS")
    codes = {c["icode"]: c for c in group["codes"]}
    assert set(codes) == {"CT500001", "CT500002"}               # not the desktop (decided), not CT999001 (closed PO), not CT777 (cancelled)
    assert (codes["CT500001"]["units"], codes["CT500001"]["po_numbers"]) == (7, ["SPO/BS/5001", "SPO/BS/5002"])
    assert codes["CT500002"]["scopes"] == ["CODE", "NAME", "ARTICLE"]
    assert group["seen_on_pos"] == ["SPO/BS/5001", "SPO/BS/5002"] and group["po_count"] == 2
    assert group["suggested_scope"] == "ARTICLE"
    # S7 (P1-3, intended change): one of the two words of "Network Switch" is no longer a suggestion.
    assert (group["suggested_item_id"], group["suggested_item_name"]) == (None, None)
    assert body["counts"]["items"] == 1 and body["counts"]["item_codes"] == 2


async def test_a_po_already_created_here_and_a_not_tracked_code_are_not_in_the_inbox(client, erp):
    ids = await world(erp)
    async with SessionLocal() as s:
        s.add(ItemMap(match_type="CODE", erp_item_code="CT500002", not_tracked=True, company_id=ids["spl"]))
        await s.commit()
    del erp.pos[5002]
    h = await _headers(client, "OPR")
    body = create_body((await client.get("/api/erp/pos/5001/draft", headers=h)).json(), ids, vendor_choice={"action": "CREATE"})
    assert (await client.post("/api/erp/pos/create", headers=h, json=body)).status_code == 201
    inbox_now = await inbox(client, ids["spl"])
    assert inbox_now["items"] == [] and inbox_now["vendors"] == []


async def test_new_vendors_are_grouped_by_pan_with_the_unlinked_registrations_and_a_suggestion(client, erp):
    ids = await world(erp)
    blue = await add_vendor("Blue Star Limited")
    body = await inbox(client, ids["spl"])
    [group] = body["vendors"]
    assert (group["group_key"], group["pan"], group["company_id"]) == (f"CKSPL:{PAN}", PAN, ids["spl"])
    regs = {r["erp_code"]: r["open_pos"] for r in group["registrations"]}
    assert regs == {BS_MP: 1, BS_UP: 1, BS_WB: 0}               # the Kolkata one has no open PO but is the same business
    assert (group["suggested_vendor_id"], group["suggested_vendor_name"], group["suggestion_reason"]) == (blue, "Blue Star Limited", "NAME")
    assert body["counts"]["vendors"] == 1 and body["counts"]["vendor_registrations"] == 3
    # once one registration is linked, the group suggests that vendor (by PAN) and lists only the rest
    async with SessionLocal() as s:
        s.add(VendorErpLink(vendor_id=ids["oldco"], company_id=ids["spl"], erp_vendor_code=BS_UP))
        await s.commit()
    [group] = (await inbox(client, ids["spl"]))["vendors"]
    assert {r["erp_code"] for r in group["registrations"]} == {BS_MP, BS_WB}
    assert (group["suggested_vendor_id"], group["suggestion_reason"]) == (ids["oldco"], "PAN")


async def test_ready_stores_not_created_yet_are_listed(client, erp):
    ids = await world(erp)
    async with SessionLocal() as s:
        s.add_all([site("LAM", site_code=1), site("PTS", site_code=2), site("NEW", "UPCOMING_STORE", site_code=3),
                   site("UP-DUMMY", site_code=4)])
        await s.commit()
    h = await _headers(client)
    assert (await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["PTS"]})).status_code == 200
    body = await inbox(client, ids["spl"])
    assert [s["code"] for s in body["stores"]] == ["LAM"] and body["counts"]["stores"] == 1


async def test_the_inbox_covers_every_company_when_none_is_chosen(client, erp):
    ids = await world(erp)
    erp.pos[5009] = bs_po(po_code=5009, supplier="77", name="BLUE STAR LTD", company="CKVPL")
    body = await inbox(client)
    assert {(g["company_id"], g["article_key"]) for g in body["items"]} == {(ids["spl"], "FA_IT_OTHERS"), (ids["vpl"], "FA_IT_OTHERS")}
    assert {g["group_key"] for g in body["vendors"]} == {f"CKSPL:{PAN}", f"CKVPL:{PAN}"}


async def test_resolving_items_is_one_transaction_per_entry(client, erp):
    ids = await world(erp)
    async with SessionLocal() as s:
        (await s.get(Item, ids["item_cable"])).is_active = False
        await s.commit()
    resp = await client.post("/api/erp/inbox/items/resolve", headers=await _headers(client), json=[
        {"company_id": ids["spl"], "icode": "CT500001", "scope": "CODE", "item_id": ids["item_switch"]},
        {"company_id": ids["spl"], "icode": "CT500002", "scope": "CODE", "item_id": ids["item_cable"]},           # inactive Item
        {"company_id": ids["spl"], "icode": "CT500002", "scope": "NAME", "item_id": ids["item_switch"], "not_tracked": True},  # two choices
        {"company_id": ids["spl"], "article_key": "FA_IT_OTHERS", "scope": "NAME", "not_tracked": True},           # NAME needs a code
        {"company_id": ids["spl"], "icode": "CT500002", "scope": "NAME", "create_item": {"name": "Server Rack", "subcategory_id": ids["cpu_sub"],
                                                                                         "serial_mode": "NO_SERIAL"}},
    ])
    assert resp.status_code == 200, resp.text
    results = resp.json()
    assert [r["ok"] for r in results] == [True, False, False, False, True]
    assert results[0]["message"] == "The ERP code CT500001 is now Network Switch."
    assert "no longer active" in results[1]["message"]
    assert results[2]["message"] == "Choose one: an Item, a new Item, or not tracked."
    assert results[3]["message"] == "A decision for a product name or a single code needs the ERP code."
    assert results[4]["message"] == "The product 6U RACK (Article FA_IT_OTHERS) is now Server Rack."
    async with SessionLocal() as s:
        rack = (await s.execute(select(Item).where(Item.name == "Server Rack"))).scalar_one()
        assert (rack.serial_required, rack.serial_later) == (False, False)
        rules = {(m.match_type, m.item_id) for m in (await s.execute(select(ItemMap).where(ItemMap.is_active.is_(True),
                                                                                           ItemMap.company_id == ids["spl"]))).scalars().all()}
    assert rules == {("CODE", ids["item_switch"]), ("NAME", rack.id)}
    assert (await inbox(client, ids["spl"]))["items"] == []


async def test_resolving_a_whole_article_or_marking_it_not_tracked(client, erp):
    ids = await world(erp)
    resp = await client.post("/api/erp/inbox/items/resolve", headers=await _headers(client), json=[
        {"company_id": ids["spl"], "article_key": "FA_IT_OTHERS", "scope": "ARTICLE", "not_tracked": True},
        {"company_id": ids["spl"], "article_key": "NO SUCH ARTICLE", "scope": "ARTICLE", "item_id": ids["item_switch"]},
    ])
    assert [r["ok"] for r in resp.json()] == [True, False]
    assert resp.json()[0]["message"] == "Every code of the Article FA_IT_OTHERS is now not tracked."
    assert (await inbox(client, ids["spl"]))["counts"]["items"] == 0
    rows = (await client.get("/api/erp/pos", headers=await _headers(client, "OPR"))).json()
    assert {r["po_code"] for r in rows} == {1133610106, 5001, 5004}       # 5002 was only switches: now nothing tracked on it


async def test_resolving_vendors_links_or_creates_per_entry(client, erp):
    ids = await world(erp)
    blue = await add_vendor("Blue Star Limited")
    await add_vendor("Blue Star Kolkata", gstin=f"19{PAN}1ZX")              # the Kolkata registration's GSTIN is this vendor's
    refused = await client.post("/api/erp/inbox/vendors/resolve", headers=await _headers(client), json=[
        {"company_id": ids["spl"], "erp_vendor_codes": [BS_MP, BS_UP, BS_WB], "action": "LINK", "vendor_id": blue}])
    assert refused.json()[0]["ok"] is False and "same GSTIN as Blue Star Kolkata" in refused.json()[0]["message"]
    async with SessionLocal() as s:
        from app.masters.models import Vendor
        (await s.execute(select(Vendor).where(Vendor.name == "Blue Star Kolkata"))).scalar_one().gstin = None
        await s.commit()
    resp = await client.post("/api/erp/inbox/vendors/resolve", headers=await _headers(client), json=[
        {"company_id": ids["spl"], "erp_vendor_codes": [BS_MP, BS_UP, BS_WB], "action": "LINK", "vendor_id": blue},
        {"company_id": ids["spl"], "erp_vendor_codes": [BS_NOGST], "action": "LINK"},                            # no vendor chosen
        {"company_id": ids["spl"], "erp_vendor_codes": ["2264"], "action": "CREATE", "name": "Jagannath"},
        {"company_id": ids["spl"], "erp_vendor_codes": [BS_NOGST], "action": "CREATE"},
    ])
    results = resp.json()
    assert [r["ok"] for r in results] == [True, False, True, True], results
    assert results[0] == {"ok": True, "message": "Linked 3 ERP suppliers to Blue Star Limited.", "vendor_id": blue}
    assert results[1]["message"] == "Choose the vendor to link to."
    assert results[2]["message"] == "Vendor Jagannath created and linked to 1 ERP supplier."
    assert (await inbox(client, ids["spl"]))["vendors"] == []
