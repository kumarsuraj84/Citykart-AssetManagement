"""S0.2 / S0.5 / S0.6 / S0.7 on purchase orders (audit B-2, B-6, B-7, B-8):
bounded quantities, sane values, no new work on deleted POs or with
deactivated masters, and friendly answers instead of 500s."""
from datetime import date, timedelta

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.purchase_orders.models import PendingAsset
from tests.core.s0_world import add_line, build_world, login, make_po


async def _pending_count() -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(PendingAsset))).scalar_one()


async def test_quantity_must_be_between_1_and_1000(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    for bad in (0, -3, 1001, 1_099_511_627_776):
        resp = await add_line(client, h, w, po["id"], quantity=bad)
        assert resp.status_code == 422, (bad, resp.text)
        assert isinstance(resp.json()["detail"], str) and "Quantity" in resp.json()["detail"]
    assert await _pending_count() == 0
    ok = await add_line(client, h, w, po["id"], quantity=1000)
    assert ok.status_code == 201 and len(ok.json()) == 1000


def test_excel_quantity_is_bounded_too():
    import pytest
    from app.imports.asset_import_service import _parse_quantity
    assert _parse_quantity(1000) == 1000
    for bad in (0, -1, 1001):
        with pytest.raises(ValueError):
            _parse_quantity(bad)


async def test_bundle_quantity_and_bulk_id_lists_are_bounded(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    bundle = await client.post(f"/api/purchase-orders/{po['id']}/bundle-lines", headers=h, json={
        "bundle_id": 1, "description": "Desktop", "barcode": "B", "quantity": 5000, "price": 100})
    assert bundle.status_code == 422 and "Quantity must be at most 1,000" in bundle.json()["detail"]
    too_many = list(range(1, 1002))
    move = await client.post("/api/assets/bulk-move", headers=h, json={"asset_ids": too_many, "to_asset_user_id": w["stock"]})
    assert move.status_code == 422 and move.json()["detail"] == "You can choose at most 1,000 assets at a time."
    action = await client.post("/api/assets/bulk-action", headers=h, json={"asset_ids": too_many, "event_type": "LOST"})
    assert action.status_code == 422


async def test_po_number_must_be_real_and_unique_per_company_ignoring_case(client):
    w = await build_world()
    h = await login(client, w, "admin")
    blank = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co"], "po_number": "   ", "po_date": "2026-01-01", "cost_center_id": w["cc"]})
    assert blank.status_code == 422 and blank.json()["detail"] == "PO number cannot be blank."
    await make_po(client, h, w, number="SPO/001")
    dup = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co"], "po_number": " spo/001 ", "po_date": "2026-01-01", "cost_center_id": w["cc"]})
    assert dup.status_code == 422 and "already exists for this company" in dup.json()["detail"]
    future = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co"], "po_number": "SPO/FUT", "po_date": "2099-01-01", "cost_center_id": w["cc"]})
    assert future.status_code == 422 and future.json()["detail"] == "PO date cannot be in the future."


async def test_line_values_must_be_sane(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    cases = [
        ({"description": "  "}, "Description cannot be blank."),
        ({"purchase_cost": -1}, "Purchase cost must be at least 0."),
        ({"tax_percent": 101}, "Tax % must be at most 100."),
        ({"warranty_years": -1}, "Warranty years must be at least 0."),
        ({"warranty_years": 500}, "Warranty years must be at most 100."),
        ({"description": "x" * 501}, "Description is too long (max 500 characters)."),
        ({"model": "bad\u0000text"}, "Text cannot contain hidden control characters."),
    ]
    for over, message in cases:
        resp = await add_line(client, h, w, po["id"], **over)
        assert resp.status_code == 422, (over, resp.text)
        assert message in resp.json()["detail"], (over, resp.json())
        assert resp.json()["errors"], "the sentences are also given as a list"
    assert await _pending_count() == 0


async def test_new_work_refuses_deactivated_masters_but_history_stays_readable(client):
    w = await build_world()
    h = await login(client, w, "admin")
    dead_cc = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co"], "po_number": "P-DCC", "po_date": "2026-01-01", "cost_center_id": w["dead_cc"]})
    assert dead_cc.status_code == 422 and "Closed office is no longer active" in dead_cc.json()["detail"]
    dead_vendor = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co"], "po_number": "P-DV", "po_date": "2026-01-01", "cost_center_id": w["cc"], "vendor_id": w["dead_vendor"]})
    assert dead_vendor.status_code == 422 and "Closed Vendor is no longer active" in dead_vendor.json()["detail"]
    no_vendor = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": w["co"], "po_number": "P-NV", "po_date": "2026-01-01", "cost_center_id": w["cc"], "vendor_id": 999999})
    assert no_vendor.status_code == 422 and no_vendor.json()["detail"] == "The vendor you chose does not exist."
    po = await make_po(client, h, w)
    for over, word in (({"category_id": w["dead_cat"], "subcategory_id": None}, "Old category"),
                       ({"subcategory_id": w["dead_sub"]}, "Old sub"),
                       ({"brand_id": w["dead_brand"]}, "Gone Brand")):
        resp = await add_line(client, h, w, po["id"], **over)
        assert resp.status_code == 422 and f"{word} is no longer active" in resp.json()["detail"], resp.text
    nonexistent_brand = await add_line(client, h, w, po["id"], brand_id=999999)
    assert nonexistent_brand.status_code == 422 and nonexistent_brand.json()["detail"] == "The brand you chose does not exist."


async def test_a_deleted_po_takes_no_new_lines_delivery_or_pi(client):
    w = await build_world()
    h = await login(client, w, "owner")
    po = await make_po(client, h, w)
    line = (await add_line(client, h, w, po["id"])).json()[0]
    assert (await client.delete(f"/api/purchase-orders/{po['id']}", headers=h)).status_code == 200
    add = await add_line(client, h, w, po["id"])
    assert add.status_code == 422 and "has been deleted" in add.json()["detail"]
    deliver = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json={
        "invoice_number": "INV-1", "invoice_date": "2026-02-01", "invoice_amount": 100,
        "lines": [{"pending_asset_id": line["id"], "serial_number": "SN-DEL", "initial_asset_user_id": w["stock"]}]})
    assert deliver.status_code == 422 and "has been deleted" in deliver.json()["detail"]
    pi = await client.post(f"/api/purchase-orders/{po['id']}/record-pi", headers=h, json={
        "invoice_number": "INV-1", "pi_number": "PI-1", "pi_date": "2026-02-02"})
    assert pi.status_code == 422 and "has been deleted" in pi.json()["detail"]
    # the deleted PO itself is still readable
    assert (await client.get(f"/api/purchase-orders/{po['id']}", headers=h)).status_code == 200


async def test_delivery_values_are_checked(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, po_date="2026-03-01")
    [line] = (await add_line(client, h, w, po["id"])).json()

    def body(**over):
        b = {"invoice_number": "INV-1", "invoice_date": "2026-03-05", "invoice_amount": 1180,
             "lines": [{"pending_asset_id": line["id"], "serial_number": "SN-1", "initial_asset_user_id": w["stock"]}]}
        b.update(over)
        return b

    cases = [
        (body(invoice_number="  "), "Invoice number cannot be blank."),
        (body(invoice_amount=-5), "Invoice amount must be at least 0."),
        (body(invoice_date="2026-02-01"), "The invoice date cannot be before the PO date (01-03-2026)."),
        (body(invoice_date=(date.today() + timedelta(days=3)).isoformat()), "Invoice date cannot be in the future."),
        (body(lines=[]), "Add at least one line."),
        (body(lines=[{"pending_asset_id": line["id"], "serial_number": "   ", "initial_asset_user_id": w["stock"]}]),
         "A serial number (or N/A, or 'add it later') is needed"),
        (body(lines=[{"pending_asset_id": line["id"], "serial_number": "SN-2", "initial_asset_user_id": w["dead_stock"]}]),
         "Closed Stock is no longer active"),
    ]
    for payload, message in cases:
        resp = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json=payload)
        assert resp.status_code == 422, (payload, resp.text)
        assert message in resp.json()["detail"], resp.json()
    ok = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json=body())
    assert ok.status_code == 200, ok.text


async def test_a_lifecycle_refusal_during_delivery_is_a_422_not_a_500(client, monkeypatch):
    """B-8: the deliver route only caught ValueError; a LifecycleError escaped as a 500."""
    from app.lifecycle import state_machine
    from app.purchase_orders import service as po_service

    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    [line] = (await add_line(client, h, w, po["id"])).json()

    async def refuse(*_args, **_kwargs):
        raise state_machine.LifecycleError("The date cannot be in the future.")
    monkeypatch.setattr(po_service, "procure_assets", refuse)
    resp = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json={
        "invoice_number": "INV-1", "invoice_date": "2026-02-01", "invoice_amount": 100,
        "lines": [{"pending_asset_id": line["id"], "serial_number": "SN-1", "initial_asset_user_id": w["stock"]}]})
    assert resp.status_code == 422 and resp.json()["detail"] == "The date cannot be in the future."
