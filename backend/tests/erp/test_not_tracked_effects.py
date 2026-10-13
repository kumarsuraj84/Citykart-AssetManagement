"""Things CKAM does not track never reach a CKAM purchase order, and nothing else asks about them either:
the draft leaves them out, the picker hides a PO made only of them, the change check and reminders ignore them."""
from sqlalchemy import select

from app.core.db import SessionLocal
from app.purchase_orders.models import PendingAsset
from tests.erp.test_erp_api import _headers, _setup, desktop_po, erp, line  # noqa: F401  (erp is a fixture)
from tests.erp.test_erp_followup import PO_CODE, _create_desktop_po, receipt

DEPT = {"match_type": "DEPARTMENT", "level_key": "FA_IT_OTHERS", "not_tracked": True}      # CT500001 / CT500002 live in FA_IT_OTHERS


def mixed_po(cable_qty=10, **over):
    """7 desktops (tracked) and some cable (a code in a department we will mark not tracked)."""
    return desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000), line(2, "CT500002", "6U RACK", cable_qty, 500)], **over)


async def mark_not_tracked(client):
    resp = await client.post("/api/items/maps", headers=await _headers(client), json=DEPT)
    assert resp.status_code == 201, resp.text


async def draft(client, code=PO_CODE):
    resp = await client.get(f"/api/erp/pos/{code}/draft", headers=await _headers(client, "OPR"))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_the_draft_leaves_out_what_is_not_tracked_and_says_what_it_left_out(client, erp):
    await _setup()
    erp.pos[PO_CODE] = mixed_po()
    await mark_not_tracked(client)
    d = await draft(client)
    assert [ln["item_code"] for ln in d["lines"]] == ["CT324973"]
    [left] = d["untracked_lines"]
    assert (left["item_code"], left["quantity"], left["rate"], left["why"]) == ("CT500002", 10, 500.0, "Department FA_IT_OTHERS")
    assert not any("tracked" in w for w in d["warnings"])


async def test_before_the_decision_the_same_line_is_still_a_line_that_asks_for_an_item(client, erp):
    await _setup()
    erp.pos[PO_CODE] = mixed_po()
    d = await draft(client)
    assert [ln["item_code"] for ln in d["lines"]] == ["CT324973", "CT500002"] and d["untracked_lines"] == []
    assert next(ln for ln in d["lines"] if ln["item_code"] == "CT500002")["item_id"] is None


async def test_a_po_with_nothing_tracked_says_so(client, erp):
    await _setup()
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT500002", "6U RACK", 10, 500), line(2, "CT500001", "48 PORT SWITCH", 2, 9000)])
    await mark_not_tracked(client)
    d = await draft(client)
    assert d["lines"] == [] and len(d["untracked_lines"]) == 2
    assert any("None of the lines of this purchase order are tracked" in w for w in d["warnings"])


async def test_the_picker_hides_a_po_made_only_of_untracked_things_and_counts_the_rest(client, erp):
    await _setup()
    erp.pos[PO_CODE] = mixed_po()
    erp.pos[2] = desktop_po(po_code=2, po_number="SPO/ONLY-CABLE", lines=[line(1, "CT500002", "6U RACK", 10, 500)])
    h = await _headers(client, "OPR")
    before = {p["po_number"] for p in (await client.get("/api/erp/pos", headers=h)).json()}
    assert before == {"SPO/012994/26-27", "SPO/ONLY-CABLE"}
    await mark_not_tracked(client)
    rows = (await client.get("/api/erp/pos", headers=h)).json()
    assert [p["po_number"] for p in rows] == ["SPO/012994/26-27"]
    assert (rows[0]["tracked_lines"], rows[0]["untracked_lines"]) == (1, 1)


async def test_a_po_made_from_a_mixed_erp_po_has_only_the_tracked_lines_and_the_ERP_changing_the_rest_is_no_change(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = mixed_po()
    await mark_not_tracked(client)
    h = await _headers(client, "OPR")
    d = await draft(client)
    body = {k: d[k] for k in ("erp_po_code", "po_number", "po_date", "company_id", "vendor_id", "cost_center_id", "delivery_asset_user_id", "warehouse_code")}
    ln = d["lines"][0]
    body["lines"] = [{k: ln[k] for k in ("item_code", "description", "barcode", "quantity", "rate", "tax_percent", "warranty_years", "item_id")}]
    made = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert made.status_code == 201, made.text
    po_id = made.json()["po_id"]
    async with SessionLocal() as s:
        codes = {l.erp_item_code for l in (await s.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po_id))).scalars().all()}
    assert codes == {"CT324973"}
    # the ERP now cancels the cable and adds another cable line: nothing for CKAM to do about either
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000), line(2, "CT500002", "6U RACK", 10, 500, cancelled=10),
                                         line(3, "CT500001", "48 PORT SWITCH", 4, 9000)])
    report = (await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=h)).json()
    assert report["watching"] is True and report["changes"] == []
    assert (await client.get("/api/erp/changes/summary", headers=h)).json()["items"] == []


async def test_marking_a_code_not_tracked_later_does_not_look_like_the_erp_cancelled_it(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = mixed_po()
    h = await _headers(client, "OPR")
    body = {"erp_po_code": PO_CODE, "company_id": ids["spl"], "po_number": "SPO/012994/26-27", "po_date": "2026-09-18", "vendor_id": ids["vansh"],
            "cost_center_id": ids["cost_spl"], "delivery_asset_user_id": ids["taj"], "lines": [
                {"item_code": "CT500002", "description": "6U RACK", "barcode": "CT500002", "quantity": 10, "rate": 500, "tax_percent": 18, "item_id": ids["item_cable"]}]}
    po_id = (await client.post("/api/erp/pos/create", headers=h, json=body)).json()["po_id"]
    assert (await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=h)).json()["changes"] == []
    await mark_not_tracked(client)                                         # the owner decides later that racks are not tracked
    report = (await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=h)).json()
    assert report["changes"] == []                                         # not "the ERP removed this line"


async def test_tracked_changes_are_still_found_next_to_untracked_lines(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = mixed_po()
    await mark_not_tracked(client)
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)                    # the desktops only (its draft picks the first line)
    erp.pos[PO_CODE] = mixed_po(cable_qty=3)
    erp.pos[PO_CODE].lines[0] = line(1, "CT324973", "DELL DESKTOP", 7, 20000, cancelled=2)
    kinds = [c["kind"] for c in (await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=h)).json()["changes"]]
    assert kinds == ["CANCEL_UNITS"]


async def test_receipts_of_untracked_codes_never_make_a_delivery_reminder(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = mixed_po()
    await mark_not_tracked(client)
    h = await _headers(client, "OPR")
    await _create_desktop_po(client, ids, h)
    erp.receipt_list.append(receipt(10, grc="GRC-9"))
    erp.receipt_list[-1].item_code = "CT500002"                         # goods received for the cable only
    assert (await client.get("/api/erp/reminders", headers=h)).json() == []
