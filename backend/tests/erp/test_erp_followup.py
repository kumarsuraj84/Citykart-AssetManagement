"""After a PO is created from the ERP: delivery reminders (goods the ERP shows
received but CKAM has not delivered) and PI numbers from the ERP."""
from datetime import date
from sqlalchemy import select
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.erp.source import ErpInvoice, ErpReceipt
from app.purchase_orders.models import PendingAsset
from tests.erp.test_erp_api import _headers, _setup, erp  # noqa: F401  (erp is a fixture)

PO_CODE = 1133610106


async def _create_desktop_po(client, ids, h):
    """7 Desktops (CPU/TFT/Keyboard/Mouse) from the ERP PO -> 28 pending lines."""
    draft = (await client.get(f"/api/erp/pos/{PO_CODE}/draft", headers=h)).json()
    body = {k: draft[k] for k in ("erp_po_code", "po_number", "po_date", "company_id", "vendor_id", "cost_center_id",
                                  "delivery_asset_user_id", "warehouse_code")}
    ln = draft["lines"][0]
    body["lines"] = [{k: ln[k] for k in ("item_code", "group_code", "description", "barcode", "quantity", "rate",
                                         "tax_percent", "warranty_years", "bundle_id")}]
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
    assert resp.status_code == 503 and "could not be reached" in resp.json()["detail"]


# ---------- PI from the ERP ----------

def invoice(vendor_no="INV-1", pi="PI-100", pi_day=28, amount=1000.0):
    return ErpInvoice(po_code=PO_CODE, vendor_invoice_no=vendor_no, vendor_invoice_date=date(2026, 9, 20),
                      pi_number=pi, pi_date=date(2026, 9, pi_day) if pi else None, pi_amount=amount)


async def _pi_numbers(po_id):
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(Asset.pi_number, Asset.pi_date).join(PendingAsset, PendingAsset.delivered_asset_id == Asset.id)
            .where(PendingAsset.purchase_order_id == po_id))).all()
    return rows


async def test_the_pi_preview_matches_erp_pis_to_delivered_invoices_by_the_vendor_invoice_number(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 2, ids, invoice="INV/1")
    erp.invoice_list = [invoice(vendor_no="inv-1", pi="PI-100"), invoice(vendor_no="OTHER-9", pi="PI-200"), invoice(pi=None)]

    pv = (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=h)).json()
    assert pv["not_booked"] == 1 and pv["ckam_invoices"] == ["INV/1"] and pv["delivered_assets"] == 8
    by_pi = {r["pi_number"]: r for r in pv["rows"]}
    assert (by_pi["PI-100"]["ckam_invoice_number"], by_pi["PI-100"]["match"], by_pi["PI-100"]["status"], by_pi["PI-100"]["assets"]) == ("INV/1", "invoice", "ready", 8)
    assert (by_pi["PI-200"]["ckam_invoice_number"], by_pi["PI-200"]["match"], by_pi["PI-200"]["status"]) == (None, "none", "no_match")
    assert all(pi is None for pi, _ in await _pi_numbers(po_id))                      # a preview records nothing


async def test_with_one_delivered_invoice_and_one_erp_pi_they_are_paired_even_if_the_numbers_differ(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids, invoice="OUR-NUMBER")
    erp.invoice_list = [invoice(vendor_no="THEIRS-77", pi="PI-300")]
    [row] = (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=h)).json()["rows"]
    assert (row["match"], row["ckam_invoice_number"], row["status"]) == ("single", "OUR-NUMBER", "ready")


async def test_applying_a_confirmed_pi_records_it_on_every_asset_of_that_invoice_and_keeps_existing_ones(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 2, ids, invoice="INV-1")
    erp.invoice_list = [invoice(vendor_no="INV-1", pi="PI-100", pi_day=28)]

    resp = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={
        "items": [{"pi_number": "PI-100", "ckam_invoice_number": "INV-1"}]})
    assert resp.status_code == 200, resp.text
    assert len(resp.json()[0]["updated"]) == 8 and resp.json()[0]["skipped"] == []
    assert set(await _pi_numbers(po_id)) == {("PI-100", date(2026, 9, 28))}

    again = (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=h)).json()["rows"][0]
    assert again["status"] == "done" and again["recorded"] == 8

    # The ERP later shows a different PI: shown as different, and not overwritten unless asked.
    erp.invoice_list = [invoice(vendor_no="INV-1", pi="PI-101", pi_day=29)]
    assert (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=h)).json()["rows"][0]["status"] == "different"
    kept = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={
        "items": [{"pi_number": "PI-101", "ckam_invoice_number": "INV-1"}]})
    assert len(kept.json()[0]["skipped"]) == 8 and set(await _pi_numbers(po_id)) == {("PI-100", date(2026, 9, 28))}
    forced = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={
        "items": [{"pi_number": "PI-101", "ckam_invoice_number": "INV-1", "overwrite": True}]})
    assert len(forced.json()[0]["updated"]) == 8 and set(await _pi_numbers(po_id)) == {("PI-101", date(2026, 9, 29))}


async def test_a_pi_the_erp_does_not_hold_for_this_po_cannot_be_recorded(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    await _deliver(client, h, po_id, 1, ids, invoice="INV-1")
    erp.invoice_list = [invoice(vendor_no="INV-1", pi="PI-100")]
    for item in ({"pi_number": "PI-FAKE", "ckam_invoice_number": "INV-1"}, {"pi_number": "PI-100", "ckam_invoice_number": "WRONG"}):
        resp = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h, json={"items": [item]})
        assert resp.status_code == 422 and "is not an ERP PI" in resp.json()["detail"]
    assert all(pi is None for pi, _ in await _pi_numbers(po_id))


async def test_pi_needs_an_erp_po_a_known_po_the_right_role_and_a_reachable_erp(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)
    from app.purchase_orders.models import PurchaseOrder
    async with SessionLocal() as session:
        manual = PurchaseOrder(company_id=ids["spl"], po_number="MANUAL-1", po_date=date(2026, 1, 1), cost_center_id=ids["cost_spl"])
        session.add(manual)
        await session.commit()
        manual_id = manual.id
    plain = await client.get(f"/api/erp/purchase-orders/{manual_id}/pi", headers=h)
    assert plain.status_code == 422 and "not created from the ERP" in plain.json()["detail"]
    assert (await client.get("/api/erp/purchase-orders/99999/pi", headers=h)).status_code == 404
    assert (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=await _headers(client, "VWR"))).status_code == 403
    erp.down = "The ERP database could not be reached (OSError)."
    assert (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=h)).status_code == 503
