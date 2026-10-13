"""S0.5 / S0.6 / S0.10 on assets (audit B-6, B-7, B-15): no blank serial or
description, no negative amounts or absurd warranty, no future dates, no
deactivated masters for a new asset, a serial can never be cleared by an
edit, correction dates are sane, and LIKE wildcards in search match
themselves."""
from datetime import date, timedelta

from tests.core.s0_world import asset_body, build_world, login, make_asset


async def test_add_asset_refuses_bad_values(client):
    w = await build_world()
    h = await login(client, w, "admin")
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    cases = [
        ({"serial_number": "   "}, "Serial Number is required"),
        ({"description": " "}, "Description cannot be blank."),
        ({"purchase_cost": -10}, "Purchase cost must be at least 0."),
        ({"invoice_amount": -1}, "Invoice amount must be at least 0."),
        ({"purchase_cost": 1e20}, "Purchase cost must be at most 9,999,999,999."),
        ({"tax_percent": 250}, "Tax % must be at most 100."),
        ({"warranty_years": -2}, "Warranty years must be at least 0."),
        ({"warranty_years": 1000}, "Warranty years must be at most 100."),
        ({"po_date": "2099-01-01"}, "PO date cannot be in the future."),
        ({"invoice_date": tomorrow}, "Invoice date cannot be in the future."),
        ({"po_date": "2026-03-01", "invoice_date": "2026-02-01"}, "The invoice date cannot be before the PO date."),
        ({"model": "m" * 201}, "Model is too long (max 200 characters)."),
        ({"vendor_id": 999999}, "The vendor you chose does not exist."),
        ({"brand_id": 999999}, "The brand you chose does not exist."),
    ]
    for over, message in cases:
        resp = await client.post("/api/assets", headers=h, json=asset_body(w, **over))
        assert resp.status_code == 422, (over, resp.text)
        assert message in resp.json()["detail"], (over, resp.json())
    assert (await client.get("/api/assets", headers=h)).json()["total"] == 0


async def test_add_asset_refuses_deactivated_masters(client):
    w = await build_world()
    h = await login(client, w, "admin")
    cases = [
        ({"cost_center_id": w["dead_cc"]}, "Closed office is no longer active"),
        ({"category_id": w["dead_cat"], "subcategory_id": w["dead_sub"]}, "Old category is no longer active"),
        ({"subcategory_id": w["dead_sub"]}, "Old sub is no longer active"),
        ({"vendor_id": w["dead_vendor"]}, "Closed Vendor is no longer active"),
        ({"brand_id": w["dead_brand"]}, "Gone Brand is no longer active"),
        ({"initial_asset_user_id": w["dead_stock"]}, "Closed Stock is no longer active"),
    ]
    for over, message in cases:
        resp = await client.post("/api/assets", headers=h, json=asset_body(w, **over))
        assert resp.status_code == 422, (over, resp.text)
        assert message in resp.json()["detail"], (over, resp.json())


async def test_an_edit_can_never_clear_the_serial(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w, serial_number="SN-KEEP")
    for serial in (None, "", "   "):
        resp = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "x", "serial_number": serial})
        assert resp.status_code == 422 and resp.json()["detail"] == "The serial number cannot be removed. Type N/A if the asset has none."
    # leaving it out keeps it; changing it to another value or N/A is fine
    kept = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "kept"})
    assert kept.status_code == 200 and kept.json()["serial_number"] == "SN-KEEP"
    na = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "kept", "serial_number": "N/A"})
    assert na.status_code == 200 and na.json()["serial_number"] == "N/A"


async def test_an_edit_checks_only_values_it_changes(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w, purchase_cost=500)
    neg = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "x", "serial_number": "N/A", "purchase_cost": -5})
    assert neg.status_code == 422 and "Purchase cost must be between 0" in neg.json()["detail"]
    blank = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "  ", "serial_number": "N/A"})
    assert blank.status_code == 422 and blank.json()["detail"] == "Description cannot be blank."
    dead = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "x", "serial_number": "N/A", "vendor_id": w["dead_vendor"]})
    assert dead.status_code == 422 and "Closed Vendor is no longer active" in dead.json()["detail"]
    ok = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "fine", "serial_number": "N/A", "purchase_cost": 500})
    assert ok.status_code == 200


async def test_a_corrected_purchase_date_must_be_sane(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    old = await client.post(f"/api/assets/{asset['id']}/corrections", headers=h, json={"purchase_date": "1900-01-01", "reason": "typo"})
    assert old.status_code == 422 and old.json()["detail"] == "The purchase date cannot be before 01-01-1990."
    ok = await client.post(f"/api/assets/{asset['id']}/corrections", headers=h, json={"purchase_date": "2026-01-15", "reason": "typo"})
    assert ok.status_code == 200


async def test_search_wildcards_match_themselves(client):
    w = await build_world()
    h = await login(client, w, "admin")
    await make_asset(client, h, w, description="Dell laptop", serial_number="AB-1")
    await make_asset(client, h, w, description="Chair 100% leather", serial_number="AB_2")
    for q, expected in (("%", 1), ("_", 1), ("\\", 0), ("dell", 1)):
        total = (await client.get("/api/assets", headers=h, params={"q": q})).json()["total"]
        assert total == expected, (q, total)
