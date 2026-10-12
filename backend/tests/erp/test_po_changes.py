"""The ERP changes a purchase order that CKAM made from it (cancelled, quantity or rate edited, a line
added): CKAM shows what is different and a person applies it or keeps the PO as it is. Delivered units
(real assets) are never touched. The ERP is an in-memory stand-in (see test_erp_api.FakeErp)."""
from datetime import datetime, timezone
from sqlalchemy import select
from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.purchase_orders.models import PendingAsset, PurchaseOrder, PurchaseOrderErpBaseline
from tests.erp.test_erp_api import _headers, _setup, desktop_po, erp, line  # noqa: F401  (erp is a fixture)
from tests.erp.test_erp_followup import PO_CODE, _create_desktop_po, _deliver


async def _statuses(po_id):
    async with SessionLocal() as session:
        rows = (await session.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po_id))).scalars().all()
    out: dict[str, int] = {}
    for r in rows:
        out[r.status] = out.get(r.status, 0) + 1
    return out


async def _changes(client, h, po_id):
    resp = await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=h)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _apply(client, h, po_id, *items):
    return await client.post(f"/api/erp/purchase-orders/{po_id}/changes/apply", headers=h,
                             json={"items": [{"id": i, "mode": m} for i, m in items]})


async def test_a_po_made_from_the_erp_starts_with_nothing_changed(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    r = await _changes(client, h, po_id)
    assert r["found"] and r["watching"] and r["changes"] == [] and r["erp_status"] == "OPEN"
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, po_id)
        base = (await session.execute(select(PurchaseOrderErpBaseline).where(PurchaseOrderErpBaseline.purchase_order_id == po_id))).scalars().all()
    assert po.erp_status == "OPEN" and po.erp_synced_at is not None
    assert [(b.item_code, float(b.qty), float(b.rate)) for b in base] == [("CT324973", 7.0, 20000.0)]


async def test_a_cancelled_erp_po_offers_to_cancel_what_is_still_pending_and_leaves_delivered_units(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)          # 7 desktops = 28 lines
    await _deliver(client, h, po_id, 2, ids)                    # 2 desktops delivered = 8 lines
    erp.pos[PO_CODE] = desktop_po(status="CANCELLED", lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000, cancelled=7)])

    r = await _changes(client, h, po_id)
    [cancelled] = [c for c in r["changes"] if c["kind"] == "PO_CANCELLED"]
    assert (cancelled["pending_units"], cancelled["delivered_units"]) == (5, 2)
    assert [c["kind"] for c in r["changes"]] == ["PO_CANCELLED"]        # not also a quantity change per line

    done = await _apply(client, h, po_id, ("PO_CANCELLED", "apply"))
    assert done.status_code == 200, done.text
    assert done.json()["changes"] == []
    assert await _statuses(po_id) == {"DELIVERED": 8, "CANCELLED": 20}  # delivered units are untouched
    assert any("cancelled 5 pending units" in e["summary"] for e in done.json()["log"])


async def test_keeping_a_cancelled_po_as_it_is_changes_nothing_and_stops_asking(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    erp.pos[PO_CODE] = desktop_po(status="CANCELLED", lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000, cancelled=7)])
    done = await _apply(client, h, po_id, ("PO_CANCELLED", "keep"))
    assert done.status_code == 200 and done.json()["changes"] == []
    assert await _statuses(po_id) == {"PENDING": 28}
    assert done.json()["log"][0]["kind"] == "KEEP_PO_CANCELLED"


async def test_a_reduced_quantity_cancels_only_pending_units_and_warns_when_more_was_already_delivered(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 2, ids)
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000, cancelled=3)])   # 7 -> 4

    [c] = (await _changes(client, h, po_id))["changes"]
    assert (c["kind"], c["was_units"], c["erp_units"], c["count"], c["over_delivered"]) == ("CANCEL_UNITS", 7, 4, 3, 0)
    done = await _apply(client, h, po_id, ("CANCEL_UNITS:CT324973", "apply"))
    assert done.status_code == 200 and done.json()["changes"] == []
    assert await _statuses(po_id) == {"DELIVERED": 8, "PENDING": 8, "CANCELLED": 12}   # 3 pending desktops x 4 parts cancelled

    # the ERP now says 1, but 2 were already delivered: say so, cancel the pending ones
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000, cancelled=6)])
    [c2] = (await _changes(client, h, po_id))["changes"]
    assert (c2["erp_units"], c2["over_delivered"], c2["count"]) == (1, 1, 2)   # only 2 pending are left to cancel


async def test_a_raised_quantity_adds_units_like_the_existing_lines_at_the_new_rate_of_the_erp(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 9, 20000)])             # 7 -> 9

    [c] = (await _changes(client, h, po_id))["changes"]
    assert (c["kind"], c["count"], c["can_add"]) == ("ADD_UNITS", 2, True)
    done = await _apply(client, h, po_id, ("ADD_UNITS:CT324973", "apply"))
    assert done.status_code == 200, done.text
    assert done.json()["changes"] == []
    assert await _statuses(po_id) == {"PENDING": 36}                                                   # 9 desktops x 4 parts
    async with SessionLocal() as session:
        lines = (await session.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po_id))).scalars().all()
    assert {l.erp_item_code for l in lines} == {"CT324973"} and {l.bundle_label for l in lines} == {"Desktop"}
    assert round(sum(float(l.purchase_cost) for l in lines), 2) == 9 * 20000


async def test_a_changed_rate_or_tax_updates_pending_units_only_and_splits_a_bundle_by_its_shares(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids)
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 7, 25000, tax=12.0)])

    [c] = (await _changes(client, h, po_id))["changes"]
    assert (c["kind"], c["was_rate"], c["now_rate"], c["was_tax"], c["now_tax"], c["pending_units"], c["delivered_units"]) == (
        "COST_CHANGED", 20000.0, 25000.0, 18.0, 12.0, 6, 1)
    done = await _apply(client, h, po_id, ("COST_CHANGED:CT324973", "apply"))
    assert done.status_code == 200 and done.json()["changes"] == []
    async with SessionLocal() as session:
        lines = (await session.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po_id))).scalars().all()
    pending = [l for l in lines if l.status == "PENDING"]
    delivered = [l for l in lines if l.status == "DELIVERED"]
    cpu = next(l for l in pending if l.description.endswith("- CPU"))
    assert float(cpu.purchase_cost) == 17500.0 and float(cpu.tax_percent) == 12.0          # 70% of 25000
    one_desktop = {l.description.rsplit(" - ", 1)[1]: float(l.purchase_cost) for l in reversed(pending)}
    assert round(sum(one_desktop.values()), 2) == 25000.0                                   # the four parts add up to the new rate
    assert all(float(l.purchase_cost) in (14000.0, 5200.0, 400.0) for l in delivered)       # delivered units keep what they were delivered with


async def test_the_quantity_and_the_cost_are_separate_questions(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 5, 25000)])             # fewer AND dearer
    kinds = sorted(c["kind"] for c in (await _changes(client, h, po_id))["changes"])
    assert kinds == ["CANCEL_UNITS", "COST_CHANGED"]
    await _apply(client, h, po_id, ("CANCEL_UNITS:CT324973", "apply"))
    [left] = (await _changes(client, h, po_id))["changes"]
    assert left["kind"] == "COST_CHANGED"                                                              # still waiting, not lost


async def test_a_new_line_in_the_erp_is_shown_and_must_be_added_by_hand(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000), line(2, "CT500001", "48 PORT SWITCH", 2, 9000)])
    [c] = (await _changes(client, h, po_id))["changes"]
    assert (c["kind"], c["item_code"], c["qty"]) == ("NEW_ITEM", "CT500001", 2)
    refused = await _apply(client, h, po_id, ("NEW_ITEM:CT500001", "apply"))
    assert refused.status_code == 422 and "+ Add Line" in refused.json()["detail"]
    kept = await _apply(client, h, po_id, ("NEW_ITEM:CT500001", "keep"))
    assert kept.status_code == 200 and kept.json()["changes"] == []


async def test_closed_and_header_changes_are_information_only(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    erp.pos[PO_CODE] = desktop_po(status="CLOSED", delivery_location="CKSPL-WH-FARUKHNAGAR", supplier_code="2264", supplier_name="JAGANNATH ENTERPRISES")
    [c] = (await _changes(client, h, po_id))["changes"]
    assert c["kind"] == "HEADER" and len(c["messages"]) == 3
    assert any("closed" in m for m in c["messages"])
    assert await _statuses(po_id) == {"PENDING": 28}                                                  # nothing was changed
    assert (await _apply(client, h, po_id, ("HEADER", "keep"))).json()["changes"] == []


async def test_only_changes_that_are_still_there_can_be_applied(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    gone = await _apply(client, h, po_id, ("CANCEL_UNITS:CT324973", "apply"))
    assert gone.status_code == 422 and "not there any more" in gone.json()["detail"]
    assert await _statuses(po_id) == {"PENDING": 28}


async def test_a_po_made_before_this_check_existed_is_watched_from_now_on(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    async with SessionLocal() as session:                               # as if made before baselines existed
        po = await session.get(PurchaseOrder, po_id)
        po.erp_synced_at = None
        for b in (await session.execute(select(PurchaseOrderErpBaseline).where(PurchaseOrderErpBaseline.purchase_order_id == po_id))).scalars().all():
            await session.delete(b)
        await session.commit()
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000, cancelled=2)])
    r = await _changes(client, h, po_id)
    assert r["watching"] is False and r["changes"] == []                 # nothing can be said to have changed yet
    started = await _apply(client, h, po_id, ("WATCH", "apply"))
    assert started.status_code == 200 and started.json()["watching"] is True and started.json()["changes"] == []
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000, cancelled=4)])
    [c] = (await _changes(client, h, po_id))["changes"]
    assert (c["kind"], c["was_units"], c["erp_units"]) == ("CANCEL_UNITS", 5, 3)


async def test_the_summary_lists_changed_pos_with_pending_units_for_the_list_and_the_dashboard(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    assert (await client.get("/api/erp/changes/summary", headers=h)).json() == {"available": True, "items": []}
    erp.pos[PO_CODE] = desktop_po(status="CANCELLED", lines=[line(1, "CT324973", "DELL DESKTOP", 7, 20000, cancelled=7)])
    s = (await client.get("/api/erp/changes/summary", headers=h)).json()
    assert s["available"] and s["items"] == [{"po_id": po_id, "po_number": "SPO/012994/26-27", "changes": 1, "cancelled": True}]
    await _apply(client, h, po_id, ("PO_CANCELLED", "apply"))                      # nothing pending is left and it is dealt with
    assert (await client.get("/api/erp/changes/summary", headers=h)).json()["items"] == []


async def test_the_summary_is_just_not_available_when_the_erp_cannot_be_read(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    await _create_desktop_po(client, ids, h)
    erp.down = "The ERP database could not be reached (OSError)."
    assert (await client.get("/api/erp/changes/summary", headers=h)).json() == {"available": False, "items": []}


async def test_a_down_erp_is_a_clear_503_for_one_po_and_a_po_not_from_the_erp_has_nothing_to_check(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    plain = (await client.post("/api/purchase-orders", headers=h, json={
        "company_id": ids["spl"], "po_number": "PLAIN-1", "po_date": "2026-01-01", "cost_center_id": ids["cost_spl"]})).json()["id"]
    assert (await client.get(f"/api/erp/purchase-orders/{plain}/changes", headers=h)).status_code == 404
    erp.down = "The ERP database could not be reached (OSError)."
    down = await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=h)
    assert down.status_code == 503 and "could not be reached" in down.json()["detail"]


async def test_roles_and_company_scope_apply(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    viewer = await _headers(client, "VWR")
    assert (await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=viewer)).status_code == 403
    assert (await _apply(client, viewer, po_id, ("HEADER", "keep"))).status_code == 403
    assert (await client.get("/api/erp/changes/summary", headers=viewer)).status_code == 403
    assert (await client.get("/api/erp/purchase-orders/999999/changes", headers=h)).status_code == 404
