"""AM-19: PI Number/Date arrive from Finance per Invoice, not per PO -- a PO
delivered across several partial deliveries gets one Invoice (and later one
PI) per delivery. POST /api/purchase-orders/{id}/record-pi applies PI
Number/Date to every asset delivered under a given (PO, Invoice Number)
pair, never the whole PO."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule


async def _setup(suffix: str):
    async with SessionLocal() as session:
        company = Company(code=f"AM19-{suffix}", name=f"AM19 Co {suffix}")
        cat = AssetCategory(code=f"AM19-{suffix}", name="IT")
        session.add_all([company, cat])
        await session.flush()
        cc = CostCenter(company_id=company.id, code="HO", name="Head Office")
        loc = Location(code=f"AM19-{suffix}", name="HO")
        dept = Department(name=f"AM19-{suffix}")
        session.add_all([cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=company.id, emp_code=f"STK-{suffix}", name="IT Stock", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=company.id, emp_code=f"ADM-{suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer = Holder(company_id=company.id, emp_code=f"VWR-{suffix}", name="Viewer", holder_type="EMPLOYEE",
                         location_id=loc.id, department_id=dept.id, role="VIEWER",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=company.id, prefix_template=f"AM19/{suffix}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([stock, admin, viewer, rule])
        await session.commit()
        return {
            "co_id": company.id, "cc_id": cc.id, "cat_id": cat.id, "stock_id": stock.id,
            "admin_emp": f"ADM-{suffix}", "viewer_emp": f"VWR-{suffix}",
        }


async def _login(client, login_id):
    resp = await client.post("/api/auth/login", json={"login_id": login_id, "password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _po_with_delivery(client, headers, ctx, po_number, invoice_number, qty, serial_prefix):
    po_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": po_number, "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers)).json()["id"]
    lines = (await client.post(f"/api/purchase-orders/{po_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": qty,
    }, headers=headers)).json()
    deliver_resp = await client.post(f"/api/purchase-orders/{po_id}/deliver", json={
        "invoice_number": invoice_number, "invoice_date": "2026-02-01", "invoice_amount": 1000 * qty,
        "lines": [
            {"pending_asset_id": line["id"], "serial_number": f"{serial_prefix}-{i}", "initial_holder_id": ctx["stock_id"]}
            for i, line in enumerate(lines)
        ],
    }, headers=headers)
    assert deliver_resp.status_code == 200, deliver_resp.text
    delivered = deliver_resp.json()
    asset_ids = [line["delivered_asset_id"] for line in delivered]
    return po_id, asset_ids


async def _asset_pi(client, headers, asset_id):
    resp = await client.get(f"/api/assets/{asset_id}", headers=headers)
    return resp.json()["pi_number"], resp.json()["pi_date"]


async def test_record_pi_fills_blank_pi_on_every_asset_from_that_invoice(client):
    ctx = await _setup("PI1")
    headers = await _login(client, ctx["admin_emp"])
    po_id, asset_ids = await _po_with_delivery(client, headers, ctx, "PO-1", "INV-1", 3, "SN-PI1")

    resp = await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-1", "pi_number": "PI-1001", "pi_date": "2026-02-15",
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["updated"]) == 3
    assert body["skipped"] == []

    for asset_id in asset_ids:
        pi_number, pi_date = await _asset_pi(client, headers, asset_id)
        assert pi_number == "PI-1001"
        assert pi_date == "2026-02-15"


async def test_record_pi_default_skips_assets_that_already_have_a_pi(client):
    ctx = await _setup("PI2")
    headers = await _login(client, ctx["admin_emp"])
    po_id, asset_ids = await _po_with_delivery(client, headers, ctx, "PO-1", "INV-1", 2, "SN-PI2")

    await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-1", "pi_number": "PI-FIRST", "pi_date": "2026-02-15",
    }, headers=headers)

    # Fixing a typo without overwrite=True: the already-set asset must be skipped.
    resp = await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-1", "pi_number": "PI-TYPO-FIX", "pi_date": "2026-02-16",
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["skipped"]) == 2
    assert body["updated"] == []

    for asset_id in asset_ids:
        pi_number, _ = await _asset_pi(client, headers, asset_id)
        assert pi_number == "PI-FIRST"  # untouched


async def test_record_pi_overwrite_true_fixes_a_typo_across_every_asset(client):
    ctx = await _setup("PI3")
    headers = await _login(client, ctx["admin_emp"])
    po_id, asset_ids = await _po_with_delivery(client, headers, ctx, "PO-1", "INV-1", 2, "SN-PI3")

    await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-1", "pi_number": "PI-TYPOED", "pi_date": "2026-02-15",
    }, headers=headers)

    resp = await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-1", "pi_number": "PI-CORRECTED", "pi_date": "2026-02-15", "overwrite": True,
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["updated"]) == 2

    for asset_id in asset_ids:
        pi_number, _ = await _asset_pi(client, headers, asset_id)
        assert pi_number == "PI-CORRECTED"


async def test_record_pi_is_scoped_to_the_exact_po_and_invoice_never_a_different_invoice_on_the_same_po(client):
    """The core AM-19 scenario: one PO delivered across two partial
    deliveries on two different invoices, each getting its own PI."""
    ctx = await _setup("PI4")
    headers = await _login(client, ctx["admin_emp"])

    po_id = (await client.post("/api/purchase-orders", json={
        "company_id": ctx["co_id"], "po_number": "PO-SPLIT", "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    }, headers=headers)).json()["id"]
    lines_batch1 = (await client.post(f"/api/purchase-orders/{po_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 2,
    }, headers=headers)).json()
    lines_batch2 = (await client.post(f"/api/purchase-orders/{po_id}/lines", json={
        "description": "Laptop", "category_id": ctx["cat_id"], "quantity": 1,
    }, headers=headers)).json()

    deliver1 = await client.post(f"/api/purchase-orders/{po_id}/deliver", json={
        "invoice_number": "INV-BATCH-1", "invoice_date": "2026-02-01", "invoice_amount": 2000,
        "lines": [
            {"pending_asset_id": l["id"], "serial_number": f"SN-B1-{i}", "initial_holder_id": ctx["stock_id"]}
            for i, l in enumerate(lines_batch1)
        ],
    }, headers=headers)
    deliver2 = await client.post(f"/api/purchase-orders/{po_id}/deliver", json={
        "invoice_number": "INV-BATCH-2", "invoice_date": "2026-02-10", "invoice_amount": 1000,
        "lines": [
            {"pending_asset_id": l["id"], "serial_number": "SN-B2-0", "initial_holder_id": ctx["stock_id"]}
            for l in lines_batch2
        ],
    }, headers=headers)
    batch1_asset_ids = [l["delivered_asset_id"] for l in deliver1.json()]
    batch2_asset_ids = [l["delivered_asset_id"] for l in deliver2.json()]

    # Record PI only for the first invoice.
    resp = await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-BATCH-1", "pi_number": "PI-BATCH-1", "pi_date": "2026-02-20",
    }, headers=headers)
    assert len(resp.json()["updated"]) == 2

    for asset_id in batch1_asset_ids:
        pi_number, _ = await _asset_pi(client, headers, asset_id)
        assert pi_number == "PI-BATCH-1"
    # The second batch's asset must be completely untouched.
    pi_number, pi_date = await _asset_pi(client, headers, batch2_asset_ids[0])
    assert pi_number is None
    assert pi_date is None


async def test_record_pi_422_for_an_unknown_invoice_number_on_this_po(client):
    ctx = await _setup("PI5")
    headers = await _login(client, ctx["admin_emp"])
    po_id, _ = await _po_with_delivery(client, headers, ctx, "PO-1", "INV-1", 1, "SN-PI5")

    resp = await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-DOES-NOT-EXIST", "pi_number": "PI-X", "pi_date": "2026-02-15",
    }, headers=headers)
    assert resp.status_code == 422


async def test_record_pi_is_blocked_for_viewer(client):
    ctx = await _setup("PI6")
    headers = await _login(client, ctx["admin_emp"])
    po_id, _ = await _po_with_delivery(client, headers, ctx, "PO-1", "INV-1", 1, "SN-PI6")

    viewer_headers = await _login(client, ctx["viewer_emp"])
    resp = await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-1", "pi_number": "PI-X", "pi_date": "2026-02-15",
    }, headers=viewer_headers)
    assert resp.status_code == 403


async def test_record_pi_writes_an_ordinary_audit_row_per_field(client):
    ctx = await _setup("PI7")
    headers = await _login(client, ctx["admin_emp"])
    po_id, asset_ids = await _po_with_delivery(client, headers, ctx, "PO-1", "INV-1", 1, "SN-PI7")

    await client.post(f"/api/purchase-orders/{po_id}/record-pi", json={
        "invoice_number": "INV-1", "pi_number": "PI-1001", "pi_date": "2026-02-15",
    }, headers=headers)

    changes = (await client.get(f"/api/assets/{asset_ids[0]}/changes", headers=headers)).json()
    fields_changed = {c["field_name"] for c in changes}
    assert "pi_number" in fields_changed
    assert "pi_date" in fields_changed
    # An ordinary bulk-fill, not a controlled correction -- reason stays NULL.
    assert all(c["reason"] is None for c in changes if c["field_name"] in ("pi_number", "pi_date"))
