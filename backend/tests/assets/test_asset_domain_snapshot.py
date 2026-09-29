"""Asset User / RBAC / Responsibility rebuild: spec §18/§43 -- Asset.asset_domain
is derived server-side from Category.asset_domain at creation and snapshotted;
a later Category reclassification must never silently rewrite an existing
Asset's own recorded Responsibility."""
from app.core.db import SessionLocal
from app.masters.models import AssetCategory
from tests.assets.test_router import _setup, _login


async def test_add_asset_derives_asset_domain_from_category_server_side(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur, vendor = await _setup(session, "DS1")

    admin_headers = await _login(client, co.id, it_admin.code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Domain Snapshot Laptop", "invoice_date": "2025-12-10",
        "initial_asset_user_id": stock.id, "quantity": 1,
        "vendor_id": vendor.id, "po_number": "PO-DS1", "po_date": "2025-12-01",
        "invoice_number": "INV-DS1", "pi_number": "PI-DS1", "pi_date": "2025-12-05",
        "serial_number": "SN-DS1",
    }, headers=admin_headers)
    assert create_resp.status_code == 201
    assert create_resp.json()[0]["asset_domain"] == "IT"


async def test_reclassifying_a_category_does_not_rewrite_an_existing_assets_domain(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur, vendor = await _setup(session, "DS2")

    admin_headers = await _login(client, co.id, it_admin.code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Pre-Reclassification Laptop", "invoice_date": "2025-12-10",
        "initial_asset_user_id": stock.id, "quantity": 1,
        "vendor_id": vendor.id, "po_number": "PO-DS2", "po_date": "2025-12-01",
        "invoice_number": "INV-DS2", "pi_number": "PI-DS2", "pi_date": "2025-12-05",
        "serial_number": "SN-DS2",
    }, headers=admin_headers)
    asset_id = create_resp.json()[0]["id"]
    assert create_resp.json()[0]["asset_domain"] == "IT"

    async with SessionLocal() as session:
        category = await session.get(AssetCategory, cat.id)
        category.asset_domain = "NON_IT"
        await session.commit()

    get_resp = await client.get(f"/api/assets/{asset_id}", headers=admin_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["asset_domain"] == "IT"


async def test_admin_only_can_correct_an_assets_domain_with_a_reason(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur, vendor = await _setup(session, "DS3")

    admin_headers = await _login(client, co.id, it_admin.code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Correction Target Laptop", "invoice_date": "2025-12-10",
        "initial_asset_user_id": stock.id, "quantity": 1,
        "vendor_id": vendor.id, "po_number": "PO-DS3", "po_date": "2025-12-01",
        "invoice_number": "INV-DS3", "pi_number": "PI-DS3", "pi_date": "2025-12-05",
        "serial_number": "SN-DS3",
    }, headers=admin_headers)
    asset_id = create_resp.json()[0]["id"]

    correction_resp = await client.post(f"/api/assets/{asset_id}/corrections", json={
        "asset_domain": "NON_IT", "reason": "Miscategorized at entry -- this is a facility asset",
    }, headers=admin_headers)
    assert correction_resp.status_code == 200
    assert correction_resp.json()["asset_domain"] == "NON_IT"
