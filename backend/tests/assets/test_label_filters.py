"""Two small list filters the label screens use: assets of one Item (a dispatcher picks
"7 mice" with no serials) and a known set of assets by id (print the labels of a delivery)."""
from sqlalchemy import select
from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from tests.purchase_orders.test_router import _login, _setup


async def _deliver(client, h, ctx, item_id, po_number, quantity):
    po_id = (await client.post("/api/purchase-orders", headers=h, json={
        "company_id": ctx["co_id"], "po_number": po_number, "po_date": "2026-01-01", "cost_center_id": ctx["cc_id"],
    })).json()["id"]
    lines = (await client.post(f"/api/purchase-orders/{po_id}/lines", headers=h, json={
        "description": "Thing", "item_id": item_id, "barcode": "B", "quantity": quantity, "purchase_cost": 10,
    })).json()
    resp = await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json={
        "invoice_number": f"INV-{po_number}", "invoice_date": "2026-02-01", "invoice_amount": 100,
        "lines": [{"pending_asset_id": l["id"], "serial_number": "N/A", "initial_asset_user_id": ctx["stock_id"]} for l in lines]})
    assert resp.status_code == 200, resp.text
    return [l["delivered_asset_id"] for l in resp.json()]


async def _owner_headers(client, ctx):
    h = await _login(client, ctx["admin_emp"])
    async with SessionLocal() as session:
        (await session.execute(select(AssetUser).where(AssetUser.code == ctx["admin_emp"]))).scalar_one().is_primary_owner = True
        await session.commit()
    return h


async def test_assets_can_be_listed_for_one_item_and_for_a_known_set_of_ids(client):
    ctx = await _setup("LF1")
    h = await _owner_headers(client, ctx)
    mouse = (await client.post("/api/items", headers=h, json={
        "name": "Mouse", "category_id": ctx["cat_id"], "subcategory_id": ctx["sub_id"], "serial_required": False})).json()
    keyboard = (await client.post("/api/items", headers=h, json={
        "name": "Keyboard", "category_id": ctx["cat_id"], "subcategory_id": ctx["sub_id"], "serial_required": False})).json()
    mice = await _deliver(client, h, ctx, mouse["id"], "PO-M", 7)
    keys = await _deliver(client, h, ctx, keyboard["id"], "PO-K", 3)

    only_mice = (await client.get(f"/api/assets?item_id={mouse['id']}&status=IN_STOCK&asset_user_id={ctx['stock_id']}&limit=7", headers=h)).json()
    assert only_mice["total"] == 7 and {a["id"] for a in only_mice["items"]} == set(mice)
    assert all(a["item_name"] == "Mouse" for a in only_mice["items"])

    some = (await client.get(f"/api/assets?ids={keys[0]},{keys[2]},{mice[0]}", headers=h)).json()
    assert {a["id"] for a in some["items"]} == {keys[0], keys[2], mice[0]}

    assert (await client.get("/api/assets?ids=1,x", headers=h)).status_code == 422
    assert (await client.get("/api/assets?ids=" + ",".join(str(i) for i in range(201)), headers=h)).status_code == 422


async def test_ids_never_widen_the_callers_company_scope(client):
    ctx = await _setup("LF2", second_company=True)
    h = await _owner_headers(client, ctx)
    item = (await client.post("/api/items", headers=h, json={
        "name": "Mouse2", "category_id": ctx["cat_id"], "subcategory_id": ctx["sub_id"], "serial_required": False})).json()
    ids = await _deliver(client, h, ctx, item["id"], "PO-S", 2)
    other = await _login(client, ctx["it_team_b_emp"], ctx["co_b_id"])        # company B's IT person
    seen = (await client.get(f"/api/assets?ids={ids[0]},{ids[1]}", headers=other)).json()
    assert seen["total"] == 0
