"""S4: the ERP PO list follows the work area (a one-area login does not see an ERP PO whose lines are all
decided and all belong to the other team; a PO with an undecided line stays visible, its work area being
unknown until an Item is chosen), and the ERP create answers lines AND units created."""
from app.core.db import SessionLocal
from app.erp.source import ErpItem
from app.items.models import ItemMap
from tests.erp.s3a2_world import bs_po, build_s3a2_world
from tests.erp.test_erp_api import _headers, desktop_po, erp, line  # noqa: F401  (erp is a fixture)

READY_PO = "SPO/012994/26-27"          # the Dell desktop PO: one line, decided (Desktop, IT)


async def _numbers(client, who):
    resp = await client.get("/api/erp/pos", params={"envelope": "true"}, headers=await _headers(client, who))
    assert resp.status_code == 200, resp.text
    return sorted(r["po_number"] for r in resp.json()["pos"]), resp.json()["counts"]


async def _chair_code(erp, ids) -> None:
    """CT600001 is decided: an Office Chair (Non-IT)."""
    erp.erp_items["CT600001"] = ErpItem("CT600001", "FA_FURNITURE", "FA_FURNITURE", "FURNITURE", "FA_FURNITURE", cats=["OFFICE CHAIR"])
    async with SessionLocal() as s:
        s.add(ItemMap(match_type="CODE", erp_item_code="CT600001", item_id=ids["item_chair"], company_id=ids["spl"]))
        await s.commit()


async def test_a_one_area_login_does_not_see_pos_wholly_of_the_other_team(client, erp):
    ids = await build_s3a2_world(erp)
    await _chair_code(erp, ids)
    erp.pos[7001] = desktop_po(po_code=7001, po_number="SPO/CHAIRS", lines=[line(1, "CT600001", "OFFICE CHAIR", 10, 3000)])
    erp.pos[7002] = desktop_po(po_code=7002, po_number="SPO/MIXED", lines=[
        line(1, "CT324973", "DELL DESKTOP", 1, 20000), line(2, "CT600001", "OFFICE CHAIR", 2, 3000)])
    erp.pos[5001] = bs_po()            # one undecided line: nobody knows its work area yet
    it, it_counts = await _numbers(client, "OPIT")
    assert it == sorted([READY_PO, "SPO/MIXED", "SPO/BS/5001"])
    assert it_counts["all"] == 3
    nonit, _ = await _numbers(client, "OPNI")
    assert nonit == sorted(["SPO/CHAIRS", "SPO/MIXED", "SPO/BS/5001"])
    both, _ = await _numbers(client, "OPR")              # an operator of both areas sees everything
    assert both == sorted([READY_PO, "SPO/CHAIRS", "SPO/MIXED", "SPO/BS/5001"])
    owner, _ = await _numbers(client, "OWN")
    assert owner == both


async def test_not_tracked_lines_do_not_decide_the_work_area(client, erp):
    ids = await build_s3a2_world(erp)
    await _chair_code(erp, ids)
    async with SessionLocal() as s:
        s.add(ItemMap(match_type="CODE", erp_item_code="CT500002", not_tracked=True, company_id=ids["spl"]))
        await s.commit()
    erp.pos[7003] = desktop_po(po_code=7003, po_number="SPO/CHAIR-AND-RACK", lines=[
        line(1, "CT600001", "OFFICE CHAIR", 1, 3000), line(2, "CT500002", "6U RACK", 1, 500)])
    assert "SPO/CHAIR-AND-RACK" not in (await _numbers(client, "OPIT"))[0]
    assert "SPO/CHAIR-AND-RACK" in (await _numbers(client, "OPNI"))[0]


async def test_the_erp_create_answers_lines_and_units(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[7004] = desktop_po(po_code=7004, po_number="SPO/CABLES", lines=[
        line(1, "CT324973", "DELL DESKTOP", 2, 20000), line(2, "CT500001", "48 PORT SWITCH", 3, 9000)])
    h = await _headers(client, "OPR")
    draft = (await client.get("/api/erp/pos/7004/draft", headers=h)).json()
    body = {k: draft[k] for k in ("erp_po_code", "po_number", "po_date", "company_id", "vendor_id", "cost_center_id",
                                  "delivery_asset_user_id", "warehouse_code")}
    body["lines"] = []
    for ln, item_id in zip(draft["lines"], (ids["item_desktop"], ids["item_switch"])):
        body["lines"].append({**{k: ln[k] for k in ("item_code", "description", "barcode", "quantity", "rate", "tax_percent",
                                                    "warranty_years")}, "item_id": item_id})
    resp = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert resp.status_code == 201, resp.text
    # the Desktop set is 4 lines (one per part) x 2 units, the switch 1 line x 3 units
    assert (resp.json()["lines_created"], resp.json()["units_created"]) == (5, 11)
