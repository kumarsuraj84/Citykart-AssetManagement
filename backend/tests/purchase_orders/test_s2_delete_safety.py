"""S2 owner requirement: a purchase order that has ANY received unit must never
lose its received assets. Deleting it is refused for everyone (including the
head-office admin) with "Cancel the waiting items instead"; a PO with nothing
received can still be deleted (waiting units cancelled, PO deactivated)."""
from sqlalchemy import select

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.core.s0_world import add_line, build_world, login, make_po


async def _po_with_one_received(client, w):
    owner = await login(client, w, "owner")
    po = await make_po(client, owner, w)
    units = (await add_line(client, owner, w, po["id"], quantity=3)).json()
    resp = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=owner, json={
        "invoice_number": "INV-1", "invoice_date": "2026-02-01", "invoice_amount": 100,
        "lines": [{"pending_asset_id": units[0]["id"], "serial_number": "SN-DEL-1", "initial_asset_user_id": w["stock"]}]})
    assert resp.status_code == 200, resp.text
    return po, units, resp.json()[0]["delivered_asset_id"]


async def _state(po_id, asset_id):
    async with SessionLocal() as s:
        po = await s.get(PurchaseOrder, po_id)
        asset = await s.get(Asset, asset_id)
        statuses = sorted(u.status for u in (await s.execute(
            select(PendingAsset).where(PendingAsset.purchase_order_id == po_id))).scalars())
    return po.is_active, asset.deleted_at, statuses


async def test_nobody_can_delete_a_po_with_a_received_item(client):
    w = await build_world()
    po, units, asset_id = await _po_with_one_received(client, w)
    for who in ("owner", "owner2", "admin", "op_both"):
        resp = await client.delete(f"/api/purchase-orders/{po['id']}", headers=await login(client, w, who))
        assert resp.status_code == 409, (who, resp.text)
        assert resp.json()["detail"] == (
            "This purchase order already has received items, so it cannot be deleted; its received assets "
            "must stay in the register. Cancel the waiting items instead.")
    assert await _state(po["id"], asset_id) == (True, None, ["DELIVERED", "PENDING", "PENDING"])


async def test_cancel_the_waiting_items_instead_keeps_the_received_asset(client):
    w = await build_world()
    po, units, asset_id = await _po_with_one_received(client, w)
    owner = await login(client, w, "owner")
    resp = await client.post(f"/api/purchase-orders/{po['id']}/cancel-waiting", headers=owner)
    assert resp.json() == {"cancelled_units": 2, "status": "RECEIVED"}
    assert await _state(po["id"], asset_id) == (True, None, ["CANCELLED", "CANCELLED", "DELIVERED"])
    still = await client.delete(f"/api/purchase-orders/{po['id']}", headers=owner)
    assert still.status_code == 409
    assert (await client.get(f"/api/assets/{asset_id}", headers=owner)).status_code == 200


async def test_a_po_with_nothing_received_can_still_be_deleted_by_a_writer(client):
    w = await build_world()
    op = await login(client, w, "op_both")
    po = await make_po(client, op, w)
    units = (await add_line(client, op, w, po["id"], quantity=2)).json()
    await client.post(f"/api/purchase-orders/lines/{units[0]['id']}/cancel", headers=op)
    resp = await client.delete(f"/api/purchase-orders/{po['id']}", headers=op)
    assert resp.status_code == 200 and resp.json() == {"cancelled_lines": 1, "deleted_assets": 0}
    async with SessionLocal() as s:
        assert (await s.get(PurchaseOrder, po["id"])).is_active is False
    assert [p["po_number"] for p in (await client.get("/api/purchase-orders", headers=op)).json()] == []


async def test_delete_still_respects_the_work_area_before_anything_else(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    po = await make_po(client, owner, w)
    await add_line(client, owner, w, po["id"], "it")
    await add_line(client, owner, w, po["id"], "nonit")
    it = await login(client, w, "op_it")
    assert (await client.delete(f"/api/purchase-orders/{po['id']}", headers=it)).status_code == 403
    viewer = await login(client, w, "viewer_it")
    assert (await client.delete(f"/api/purchase-orders/{po['id']}", headers=viewer)).status_code == 403
