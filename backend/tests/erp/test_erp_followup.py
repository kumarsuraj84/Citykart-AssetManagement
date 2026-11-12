"""After a PO is created from the ERP: delivery reminders (goods the ERP shows
received but CKAM has not delivered) and PI numbers from the ERP."""
from datetime import date
from sqlalchemy import select
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.erp.source import ErpReceipt
from app.purchase_orders.models import PendingAsset
from tests.erp.pi_helpers import copy_pi
from tests.erp.test_erp_api import _headers, _setup, desktop_po, erp, line  # noqa: F401  (erp is a fixture)

PO_CODE = 1133610106


async def _create_desktop_po(client, ids, h):
    """7 Desktops (CPU/TFT/Keyboard/Mouse) from the ERP PO -> 28 pending lines."""
    draft = (await client.get(f"/api/erp/pos/{PO_CODE}/draft", headers=h)).json()
    body = {k: draft[k] for k in ("erp_po_code", "po_number", "po_date", "company_id", "vendor_id", "cost_center_id",
                                  "delivery_asset_user_id", "warehouse_code")}
    ln = draft["lines"][0]
    body["lines"] = [{k: ln[k] for k in ("item_code", "description", "barcode", "quantity", "rate", "tax_percent",
                                         "warranty_years", "item_id")}]
    resp = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()["po_id"]


async def _deliver(client, h, po_id, units, ids, invoice="INV-1", serial_prefix="S"):
    """Delivers `units` of each of the 4 parts (serials for CPU/TFT, N/A for the others)."""
    lines = (await client.get(f"/api/purchase-orders/{po_id}/lines", headers=h)).json()
    chosen = []
    for part in ("CPU", "TFT", "Keyboard", "Mouse"):
        pending = [l for l in lines if l["status"] == "PENDING" and l["description"].endswith(f"- {part}")]
        chosen += [(part, l) for l in pending[:units]]
    payload = {"invoice_number": invoice, "invoice_date": "2026-09-20", "invoice_amount": 1000, "lines": [
        {"pending_asset_id": l["id"],
         "serial_number": f"{serial_prefix}-{part}-{l['id']}" if part in ("CPU", "TFT") else "N/A",
         "initial_asset_user_id": ids["taj"]}
        for part, l in chosen]}
    resp = await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json=payload)
    assert resp.status_code == 200, resp.text


def receipt(qty, grc="GRC-1", day=20):
    return ErpReceipt(po_code=PO_CODE, item_code="CT324973", grc_no=grc, grc_date=date(2026, 9, day), received_qty=qty)


# ---------- the Item and the ERP code reach the asset ----------

async def test_a_delivered_asset_knows_its_item_and_the_erp_code_it_was_bought_under(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    # S0.8: the line must be on the ERP purchase order it is created from.
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT500001", "48 PORT SWITCH", 1, 9000)])
    body = {"erp_po_code": PO_CODE, "company_id": ids["spl"], "po_number": "SPO/CBL", "po_date": "2026-09-18", "vendor_id": ids["vansh"],
            "cost_center_id": ids["cost_spl"], "delivery_asset_user_id": ids["taj"], "lines": [
                {"item_code": "CT500001", "description": "48 PORT SWITCH", "barcode": "CT500001", "quantity": 1, "rate": 9000,
                 "tax_percent": 18, "item_id": ids["item_cable"]}]}
    po_id = (await client.post("/api/erp/pos/create", headers=h, json=body)).json()["po_id"]
    [pending] = (await client.get(f"/api/purchase-orders/{po_id}/lines", headers=h)).json()
    assert (pending["item_id"], pending["erp_item_code"]) == (ids["item_cable"], "CT500001")

    deliver = await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json={
        "invoice_number": "INV-9", "invoice_date": "2026-09-20", "invoice_amount": 9000,
        "lines": [{"pending_asset_id": pending["id"], "serial_number": "SW-1", "initial_asset_user_id": ids["taj"]}]})
    assert deliver.status_code == 200, deliver.text
    [asset] = (await client.get("/api/assets", headers=h)).json()["items"]
    assert (asset["item_id"], asset["item_name"], asset["erp_item_code"]) == (ids["item_cable"], "Cable", "CT500001")
    detail = (await client.get(f"/api/assets/{asset['id']}", headers=h)).json()
    assert (detail["item_name"], detail["erp_item_code"]) == ("Cable", "CT500001")


async def test_the_parts_of_a_bundle_keep_the_erp_code_but_are_not_themselves_the_bundle_item(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    lines = (await client.get(f"/api/purchase-orders/{po_id}/lines", headers=h)).json()
    assert {l["erp_item_code"] for l in lines} == {"CT324973"}
    # each part is its own Item (CPU, TFT, Keyboard, Mouse); none of them is the "Desktop" Item
    assert len({l["item_id"] for l in lines}) == 4 and ids["item_desktop"] not in {l["item_id"] for l in lines}


# ---------- delivery reminders ----------

async def test_a_reminder_appears_when_the_erp_shows_goods_received_that_are_not_delivered_here(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    assert (await client.get("/api/erp/reminders", headers=h)).json() == []          # nothing received yet

    erp.receipt_list = [receipt(7, "GRC-9", 25)]
    [rem] = (await client.get("/api/erp/reminders", headers=h)).json()
    assert (rem["po_id"], rem["po_number"], rem["to_deliver"], rem["last_received"]) == (po_id, "SPO/012994/26-27", 7, "2026-09-25")
    [item] = rem["items"]
    assert (item["item_code"], item["erp_received"], item["delivered"], item["ordered"], item["to_deliver"]) == ("CT324973", 7, 0, 7, 7)
    assert item["grc_numbers"] == ["GRC-9"] and "(Desktop)" in item["description"]    # the bundle shows once, not per part


async def test_the_reminder_counts_only_what_is_left_to_deliver_and_goes_away_when_done(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    erp.receipt_list = [receipt(4, "GRC-1", 18), receipt(3, "GRC-2", 22)]            # 7 received in two GRCs
    await _deliver(client, h, po_id, 4, ids)                                          # 4 desktops delivered here
    [rem] = (await client.get("/api/erp/reminders", headers=h)).json()
    assert rem["to_deliver"] == 3 and rem["items"][0]["delivered"] == 4
    assert rem["items"][0]["grc_numbers"] == ["GRC-1", "GRC-2"]

    await _deliver(client, h, po_id, 3, ids, invoice="INV-2", serial_prefix="T")
    assert (await client.get("/api/erp/reminders", headers=h)).json() == []


async def test_received_in_the_erp_but_more_than_ordered_never_asks_for_more_than_is_pending(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    await _create_desktop_po(client, ids, h)
    erp.receipt_list = [receipt(9)]                                                    # ERP over-received
    [rem] = (await client.get("/api/erp/reminders", headers=h)).json()
    assert rem["to_deliver"] == 7


async def test_reminders_are_only_for_pos_made_from_the_erp_and_respect_roles_and_a_down_erp(client, erp):
    ids = await _setup()
    op = await _headers(client, "OPR")
    await _create_desktop_po(client, ids, op)
    erp.receipt_list = [receipt(7)]
    assert (await client.get("/api/erp/reminders", headers=await _headers(client, "VWR"))).status_code == 403
    erp.down = "The ERP database could not be reached (OSError)."
    resp = await client.get("/api/erp/reminders", headers=op)
    # S7 (P1-1, intended change): no 503 any more -- an empty list, and the reason in the headers.
    assert resp.status_code == 200 and resp.json() == []
    assert resp.headers["X-ERP-Available"] == "false" and "could not be reached" in resp.headers["X-ERP-Message"]




# ---------- PI from the ERP: found by the vendor's bill number, in CKAM's copy of the ERP's purchase invoices ----------

async def _pi_numbers(po_id):
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(Asset.pi_number, Asset.pi_date).join(PendingAsset, PendingAsset.delivered_asset_id == Asset.id)
            .where(PendingAsset.purchase_order_id == po_id))).all()
    return rows


async def _preview(client, h, po_id):
    return (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=h)).json()


async def test_the_pi_preview_finds_posted_pis_by_the_vendor_bill_number_and_checks_the_vendor(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 2, ids, invoice="INV/1")                      # 8 assets, invoice amount 1000
    await copy_pi(pi_code=1, pi_number="PI-100", bill="inv-1", amount=1000.0)         # same bill (case and punctuation ignored), the PO's vendor
    await copy_pi(pi_code=2, pi_number="PI-200", bill="OTHER-9")                      # another bill: not this invoice
    await copy_pi(pi_code=3, pi_number="PI-300", bill="INV/1", vendor_code="999", vendor_name="SOME OTHER SUPPLIER")  # same bill, a different linked-vendor world: ignored
    await copy_pi(pi_code=4, pi_number="PI-400", bill="INV/1", company="CKVPL")      # same bill in the OTHER company: ignored

    pv = await _preview(client, h, po_id)
    assert pv["available"] is True and pv["not_booked"] == 0 and pv["ckam_invoices"] == ["INV/1"] and pv["delivered_assets"] == 8
    [row] = pv["rows"]
    assert (row["pi_number"], row["ckam_invoice_number"], row["match"], row["status"], row["assets"], row["posted"]) == ("PI-100", "INV/1", "invoice", "ready", 8, True)
    assert (row["amount_check"], row["vendor_note"], row["pi_date"]) == ("matches", None, "2026-09-28")
    assert all(pi is None for pi, _ in await _pi_numbers(po_id))                      # a preview records nothing


async def test_a_pi_booked_under_the_catch_all_vendor_other_is_offered_with_a_note_and_a_wrong_amount_is_flagged(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids, invoice="INV-1")                      # 4 assets, invoice amount 1000
    await copy_pi(pi_code=1, pi_number="PI-100", bill="INV-1", vendor_code="146", vendor_name="OTHER", amount=1234.0)
    [row] = (await _preview(client, h, po_id))["rows"]
    assert row["status"] == "ready" and "OTHER" in row["vendor_note"] and row["amount_check"] == "differs"


async def test_a_pi_that_is_not_posted_yet_is_shown_but_never_recorded_and_no_pi_means_waiting(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids, invoice="INV-1")
    await copy_pi(pi_code=1, pi_number="PI-100", bill="INV-9")                         # copy has PIs, none for INV-1
    waiting = await _preview(client, h, po_id)
    assert waiting["rows"] == [] and waiting["not_booked"] == 1 and waiting["available"] is True

    await copy_pi(pi_code=2, pi_number="PI-101", bill="INV-1", status="U")
    [row] = (await _preview(client, h, po_id))["rows"]
    assert (row["status"], row["posted"]) == ("not_posted", False)
    refused = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={
        "items": [{"pi_number": "PI-101", "ckam_invoice_number": "INV-1"}]})
    assert refused.status_code == 422 and "not posted in the ERP yet" in refused.json()["detail"]
    assert all(pi is None for pi, _ in await _pi_numbers(po_id))


async def test_until_the_erp_copy_has_any_purchase_invoice_the_dialog_says_not_copied_yet(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids, invoice="INV-1")
    pv = await _preview(client, h, po_id)
    assert pv["available"] is False and "have not been copied yet" in pv["message"] and pv["rows"] == []


async def test_applying_a_confirmed_pi_records_it_on_every_asset_of_that_invoice_and_keeps_existing_ones(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 2, ids, invoice="INV-1")
    await copy_pi(pi_code=1, pi_number="PI-100", bill="INV-1", pi_day=28)

    resp = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={
        "items": [{"pi_number": "PI-100", "ckam_invoice_number": "INV-1"}]})
    assert resp.status_code == 200, resp.text
    assert len(resp.json()[0]["updated"]) == 8 and resp.json()[0]["skipped"] == []
    assert set(await _pi_numbers(po_id)) == {("PI-100", date(2026, 9, 28))}
    assert (await _preview(client, h, po_id))["rows"][0]["status"] == "done"

    # The ERP later shows a second, different PI for the same bill: shown as different, not overwritten unless asked.
    await copy_pi(pi_code=2, pi_number="PI-101", bill="INV-1", pi_day=29)
    rows = {r["pi_number"]: r for r in (await _preview(client, h, po_id))["rows"]}
    assert rows["PI-101"]["status"] == "different" and rows["PI-100"]["status"] == "done"
    kept = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={
        "items": [{"pi_number": "PI-101", "ckam_invoice_number": "INV-1"}]})
    assert len(kept.json()[0]["skipped"]) == 8 and set(await _pi_numbers(po_id)) == {("PI-100", date(2026, 9, 28))}
    forced = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={
        "items": [{"pi_number": "PI-101", "ckam_invoice_number": "INV-1", "overwrite": True}]})
    assert len(forced.json()[0]["updated"]) == 8 and set(await _pi_numbers(po_id)) == {("PI-101", date(2026, 9, 29))}


async def test_a_pi_the_erp_copy_does_not_hold_for_this_invoice_cannot_be_recorded(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids, invoice="INV-1")
    await copy_pi(pi_code=1, pi_number="PI-100", bill="INV-1")
    for item in ({"pi_number": "PI-FAKE", "ckam_invoice_number": "INV-1"}, {"pi_number": "PI-100", "ckam_invoice_number": "WRONG"}):
        resp = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={"items": [item]})
        assert resp.status_code == 422 and "is not an ERP PI" in resp.json()["detail"]
    assert all(pi is None for pi, _ in await _pi_numbers(po_id))


async def test_pi_needs_a_known_po_and_the_right_role_and_a_manual_po_works_too(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await copy_pi(pi_code=1, pi_number="PI-100", bill="INV-1")
    from app.purchase_orders.models import PurchaseOrder
    async with SessionLocal() as session:
        manual = PurchaseOrder(company_id=ids["spl"], po_number="MANUAL-1", po_date=date(2026, 1, 1), cost_center_id=ids["cost_spl"])
        session.add(manual)
        await session.commit()
        manual_id = manual.id
    plain = await client.get(f"/api/erp/purchase-orders/{manual_id}/pi", headers=h)         # found by bill number: no ERP PO needed
    assert plain.status_code == 200 and plain.json()["rows"] == [] and plain.json()["available"] is True
    assert (await client.get("/api/erp/purchase-orders/99999/pi", headers=h)).status_code == 404
    assert (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=await _headers(client, "VWR"))).status_code == 403


# ---------- the PI worklist: every received invoice and what the ERP says about its PI ----------

async def test_the_worklist_counts_ready_not_posted_and_waiting_invoices_and_the_po_list_shows_ready(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids, invoice="INV-READY")
    await _deliver(client, h, po_id, 1, ids, invoice="INV-DRAFT", serial_prefix="T")
    await _deliver(client, h, po_id, 1, ids, invoice="INV-WAIT", serial_prefix="U")
    await copy_pi(pi_code=1, pi_number="PI-1", bill="INV-READY")
    await copy_pi(pi_code=2, pi_number="PI-2", bill="INV-DRAFT", status="U")

    data = (await client.get("/api/erp/pi/ready", headers=h)).json()
    assert data["copied"] is True and data["counts"] == {"ready": 1, "not_posted": 1, "waiting": 1, "ready_pos": 1}
    assert [(r["invoice_number"], r["state"]) for r in data["rows"]] == [("INV-READY", "ready"), ("INV-DRAFT", "not_posted")]
    [ready, _] = data["rows"]
    assert ready["po_id"] == po_id and ready["assets"] == 4 and ready["candidates"][0]["pi_number"] == "PI-1"

    listed = {p["id"]: p for p in (await client.get("/api/purchase-orders", headers=h)).json()}
    assert listed[po_id]["pi_status"] == "PENDING" and listed[po_id]["pi_ready_invoices"] == 1
    assert (await client.get("/api/erp/pi/ready", headers=await _headers(client, "VWR"))).status_code == 403


async def test_adding_ready_pis_from_the_worklist_each_entry_on_its_own(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids, invoice="INV-A")
    await _deliver(client, h, po_id, 1, ids, invoice="INV-B", serial_prefix="T")
    await copy_pi(pi_code=1, pi_number="PI-A", bill="INV-A", pi_day=10)
    await copy_pi(pi_code=2, pi_number="PI-B", bill="INV-B", status="U")

    resp = await client.post("/api/erp/pi/apply", headers=h, json={"items": [
        {"po_id": po_id, "pi_number": "PI-A", "ckam_invoice_number": "INV-A"},
        {"po_id": po_id, "pi_number": "PI-B", "ckam_invoice_number": "INV-B"},          # not posted: refused, the first still goes through
        {"po_id": 99999, "pi_number": "PI-X", "ckam_invoice_number": "INV-X"}]})
    assert resp.status_code == 200, resp.text
    first, second, third = resp.json()
    assert (first["ok"], first["updated"]) == (True, 4)
    assert second["ok"] is False and "not posted" in second["message"]
    assert third["ok"] is False and "not found" in third["message"]
    pis = {pi for pi, _ in await _pi_numbers(po_id)}
    assert pis == {"PI-A", None}

    after = (await client.get("/api/erp/pi/ready", headers=h)).json()
    assert after["counts"]["ready"] == 0 and after["counts"]["not_posted"] == 1
    assert (await client.post("/api/erp/pi/apply", headers=await _headers(client, "VWR"), json={"items": [
        {"po_id": po_id, "pi_number": "PI-A", "ckam_invoice_number": "INV-A"}]})).status_code == 403
