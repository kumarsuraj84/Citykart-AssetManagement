"""S4 reads for the PO / Receive screens: GET /receive-info, GET /invoices, `delivered_asset_code` on unit
rows, and the PO list search `q` matching invoice and PI numbers."""
from sqlalchemy import update

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.masters.models import CustomField
from app.numbering.models import CodeRule
from tests.purchase_orders.s4_world import build_s4_world, login, make_po, receipt, receive


# ---- receive-info --------------------------------------------------------------

async def test_receive_info_has_the_header_the_lines_and_their_serial_rules(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 3), ("gangbox", 2), ("ap", 1)])
    await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["C-1"]}]))
    resp = await client.get(f"/api/purchase-orders/{po['id']}/receive-info", headers=h)
    assert resp.status_code == 200, resp.text
    info = resp.json()
    assert (info["po_id"], info["po_number"], info["po_date"], info["is_active"]) == (po["id"], "PO-S4", "2026-01-01", True)
    assert (info["company_id"], info["company_name"], info["company_code"]) == (w["co"], "S0 Company A", "S0A")
    assert (info["vendor_id"], info["vendor_name"]) == (w["vendor"], "Good Vendor")
    assert (info["received_into_asset_user_id"], info["received_into_name"]) == (w["stock"], "Main Stock")
    assert (info["ordered_units"], info["received_units"], info["waiting_units"]) == (6, 1, 5)
    assert info["blockers"] == [] and info["required_custom_fields"] == []
    l1, l2, l3 = info["lines"]
    assert {k: l1[k] for k in ("line_no", "item_id", "item_name", "description", "ordered", "received_before", "waiting",
                               "serial_mode", "work_area", "rate", "status")} == {
        "line_no": 1, "item_id": w["item_camera"], "item_name": "Indoor Camera", "description": "Indoor Camera",
        "ordered": 3, "received_before": 1, "waiting": 2, "serial_mode": "HAS_SERIAL", "work_area": "IT",
        "rate": 1000.0, "status": "PARTLY_RECEIVED"}
    assert (l2["serial_mode"], l2["waiting"], l3["serial_mode"], l3["waiting"]) == ("NO_SERIAL", 2, "SERIAL_LATER", 1)


async def test_receive_info_lists_the_required_extra_fields_of_the_pos_company_only(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        s.add_all([
            CustomField(field_key="tag_colour", label="Tag colour", field_type="dropdown", is_required=True,
                        options={"choices": ["Red", "Blue"]}, sort_order=2),
            CustomField(field_key="warranty_card", label="Warranty card number", field_type="text", is_required=True, sort_order=1),
            CustomField(field_key="notes", label="Notes", field_type="text", is_required=False),
            CustomField(field_key="b_only", label="Company B field", field_type="text", is_required=True, company_id=w["co_b"]),
            CustomField(field_key="retired", label="Retired field", field_type="text", is_required=True, is_active=False),
        ])
        await s.commit()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    info = (await client.get(f"/api/purchase-orders/{po['id']}/receive-info", headers=h)).json()
    assert [(f["key"], f["label"], f["type"]) for f in info["required_custom_fields"]] == [
        ("warranty_card", "Warranty card number", "text"), ("tag_colour", "Tag colour", "dropdown")]
    assert info["required_custom_fields"][1]["options"] == {"choices": ["Red", "Blue"]}
    assert isinstance(info["required_custom_fields"][0]["id"], int)


async def test_receive_info_says_why_nothing_can_be_received(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    async with SessionLocal() as s:
        await s.execute(update(CodeRule).values(is_active=False))
        await s.commit()
    await client.post(f"/api/purchase-orders/{po['id']}/cancel-waiting", headers=h)
    await client.delete(f"/api/purchase-orders/{po['id']}", headers=h)
    info = (await client.get(f"/api/purchase-orders/{po['id']}/receive-info", headers=h)).json()
    assert info["is_active"] is False
    assert info["blockers"][:2] == ["This purchase order has been deleted, so nothing new can be recorded on it.",
                                    "Nothing on this purchase order is still waiting."]
    assert info["blockers"][2].startswith("No code rule (asset code format) is set up")


async def test_receive_info_follows_work_area_and_company_scope(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    po = await make_po(client, admin, w, [("gangbox", 2), ("chair", 3)], delivery_asset_user_id=w["stock2"])
    async with SessionLocal() as s:          # the delivery place was closed after the PO was made
        await s.execute(update(AssetUser).where(AssetUser.id == w["stock2"]).values(is_active=False))
        await s.commit()
    it =(await client.get(f"/api/purchase-orders/{po['id']}/receive-info", headers=await login(client, w, "op_it"))).json()
    assert [(l["line_no"], l["work_area"]) for l in it["lines"]] == [(1, "IT")] and it["waiting_units"] == 2
    assert it["received_into_asset_user_id"] is None       # the delivery place is no longer active
    nonit = (await client.get(f"/api/purchase-orders/{po['id']}/receive-info", headers=await login(client, w, "op_nonit"))).json()
    assert [l["line_no"] for l in nonit["lines"]] == [2]
    viewer = await client.get(f"/api/purchase-orders/{po['id']}/receive-info", headers=await login(client, w, "viewer_it"))
    assert viewer.status_code == 403
    assert (await client.get("/api/purchase-orders/999999/receive-info", headers=admin)).status_code == 404


# ---- invoices ----------------------------------------------------------------------

async def test_invoices_summarise_each_receipt_with_its_assets_and_pi(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 3), ("gangbox", 2)])
    first = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 2, "serial_numbers": ["C1", "C2"]}],
                                                        invoice_number="INV-A", invoice_amount=2360))
    await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["C3"]},
                                                   {"line_no": 2, "quantity": 2}],
                                                invoice_number="INV-B", invoice_date="2026-03-01", invoice_amount=3540))
    assert (await client.post(f"/api/purchase-orders/{po['id']}/record-pi", headers=h, json={
        "invoice_number": "INV-A", "pi_number": "PI-9", "pi_date": "2026-03-05"})).status_code == 200
    resp = await client.get(f"/api/purchase-orders/{po['id']}/invoices", headers=h)
    assert resp.status_code == 200, resp.text
    a, b = resp.json()
    assert (a["invoice_number"], a["invoice_date"], a["invoice_amount"], a["units"], a["asset_count"]) == (
        "INV-A", "2026-02-01", 2360.0, 2, 2)
    assert a["asset_ids"] == [x["asset_id"] for x in first.json()["assets"]]
    assert (a["pi_status"], a["pi_number"], a["pi_date"], a["asset_ids_truncated"]) == ("RECORDED", "PI-9", "2026-03-05", False)
    assert (b["invoice_number"], b["units"], b["pi_status"], b["pi_number"]) == ("INV-B", 3, "PENDING", None)


async def test_invoices_follow_the_work_area_and_cap_the_asset_ids(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    po = await make_po(client, admin, w, [("gangbox", 205), ("chair", 1)])
    await receive(client, admin, po["id"], receipt(w, [{"line_no": 1, "quantity": 205}, {"line_no": 2, "quantity": 1}]))
    [both] = (await client.get(f"/api/purchase-orders/{po['id']}/invoices", headers=admin)).json()
    assert (both["units"], both["asset_count"], len(both["asset_ids"]), both["asset_ids_truncated"]) == (206, 206, 200, True)
    [nonit] = (await client.get(f"/api/purchase-orders/{po['id']}/invoices", headers=await login(client, w, "op_nonit"))).json()
    assert (nonit["units"], len(nonit["asset_ids"])) == (1, 1)
    empty = await make_po(client, admin, w, [("gangbox", 1)], number="EMPTY")
    assert (await client.get(f"/api/purchase-orders/{empty['id']}/invoices", headers=admin)).json() == []


# ---- delivered_asset_code -----------------------------------------------------------

async def test_received_units_carry_their_asset_code(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 2)])
    await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}]))
    units = (await client.get(f"/api/purchase-orders/{po['id']}/line-groups/1/units", headers=h)).json()
    assert [(u["status"], u["delivered_asset_code"]) for u in units] == [("DELIVERED", "S0/S0IT/001"), ("PENDING", None)]
    lines = (await client.get(f"/api/purchase-orders/{po['id']}/lines", headers=h)).json()
    assert [u["delivered_asset_code"] for u in lines] == ["S0/S0IT/001", None]
    delivered = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json={
        "invoice_number": "INV-2", "invoice_date": "2026-02-02", "invoice_amount": 10,
        "lines": [{"pending_asset_id": units[1]["id"], "serial_number": "N/A", "initial_asset_user_id": w["stock"]}]})
    assert delivered.status_code == 200, delivered.text
    assert [(u["status"], u["delivered_asset_code"]) for u in delivered.json()] == [("DELIVERED", "S0/S0IT/002")]


# ---- PO list search ---------------------------------------------------------------

async def test_the_po_list_search_also_finds_invoice_and_pi_numbers(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 2)], number="PO-ALPHA")
    await make_po(client, h, w, [("gangbox", 1)], number="PO-BETA")
    await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 2}], invoice_number="HARSHIT/INV/771"))
    await client.post(f"/api/purchase-orders/{po['id']}/record-pi", headers=h, json={
        "invoice_number": "HARSHIT/INV/771", "pi_number": "PI-55501", "pi_date": "2026-02-10"})

    async def found(q):
        resp = await client.get("/api/purchase-orders", params={"q": q}, headers=h)
        assert resp.status_code == 200, resp.text
        return [r["po_number"] for r in resp.json()]

    assert await found("inv/771") == ["PO-ALPHA"]
    assert await found("55501") == ["PO-ALPHA"]
    assert await found("beta") == ["PO-BETA"]
    assert sorted(await found("good vendor")) == ["PO-ALPHA", "PO-BETA"]
    assert await found("%") == []
