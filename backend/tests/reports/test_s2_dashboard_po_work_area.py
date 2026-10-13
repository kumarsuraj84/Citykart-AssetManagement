"""S0 leftover (fixed in S2): the dashboard's purchase-order block counts only
the waiting units of the caller's work area (and of POs that are not
deleted), so a mixed PO shows each team its own part."""
from tests.core.s0_world import add_line, build_world, login, make_po


async def _dashboard(client, h, **params):
    resp = await client.get("/api/reports/dashboard", headers=h, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_the_po_block_follows_the_work_area(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    mixed = await make_po(client, owner, w, number="MIX")
    await add_line(client, owner, w, mixed["id"], "it", quantity=2)                 # 2 x 1180
    await add_line(client, owner, w, mixed["id"], "nonit", quantity=3)              # 3 x 1180
    nonit_only = await make_po(client, owner, w, number="NONIT")
    await add_line(client, owner, w, nonit_only["id"], "nonit", quantity=1)

    everything = await _dashboard(client, owner)
    assert everything["pending_po_summary"] == {"count": 6, "value": 7080.0}
    assert {(p["po_number"], p["pending_line_count"]) for p in everything["open_purchase_orders"]} == {("MIX", 5), ("NONIT", 1)}

    it = await _dashboard(client, await login(client, w, "op_it"))
    assert it["pending_po_summary"] == {"count": 2, "value": 2360.0}
    assert [(p["po_number"], p["pending_line_count"]) for p in it["open_purchase_orders"]] == [("MIX", 2)]

    admin_it = await _dashboard(client, await login(client, w, "admin_it"))
    assert admin_it["pending_po_summary"]["count"] == 2

    narrowed = await _dashboard(client, owner, domain="NON_IT")
    assert narrowed["pending_po_summary"] == {"count": 4, "value": 4720.0}
    assert {(p["po_number"], p["pending_line_count"]) for p in narrowed["open_purchase_orders"]} == {("MIX", 3), ("NONIT", 1)}


async def test_a_deleted_po_and_a_viewer_get_nothing_in_the_po_block(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    po = await make_po(client, owner, w)
    await add_line(client, owner, w, po["id"], "it")
    viewer = await _dashboard(client, await login(client, w, "viewer_it"))
    assert viewer["pending_po_summary"] == {"count": 0, "value": 0.0} and viewer["open_purchase_orders"] == []
    assert (await client.delete(f"/api/purchase-orders/{po['id']}", headers=owner)).status_code == 200
    after = await _dashboard(client, owner)
    assert after["pending_po_summary"]["count"] == 0 and after["open_purchase_orders"] == []
