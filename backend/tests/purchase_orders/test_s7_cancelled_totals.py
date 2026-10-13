"""S7 fix round (P3-7): a cancelled PO keeps showing what was ordered ("15 ordered · 15 cancelled").

Decision: `ordered_units` / a line's `ordered` stay received + waiting -- the line quantity edit is defined
on them (the new ordered total; fewer cancels waiting units) -- and the additive `originally_ordered_units` /
`originally_ordered` (= received + waiting + cancelled) and `cancelled_value` carry the cancelled part."""
from tests.purchase_orders.s4_world import build_s4_world, groups, login, make_po, receipt, receive


async def test_a_fully_cancelled_po_still_says_how_many_were_ordered(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await make_po(client, h, w, [("chair", 15)], number="PO-CXL")
    assert (await client.post(f"/api/purchase-orders/{po['id']}/cancel-waiting", headers=h)).status_code == 200
    detail = (await client.get(f"/api/purchase-orders/{po['id']}", headers=h)).json()
    assert detail["status"] == "CANCELLED"
    assert (detail["originally_ordered_units"], detail["cancelled_units"], detail["ordered_units"]) == (15, 15, 0)
    [listed] = (await client.get("/api/purchase-orders", headers=h, params={"status": "CANCELLED"})).json()
    assert (listed["originally_ordered_units"], listed["cancelled_units"]) == (15, 15)
    line = (await groups(client, h, po["id"]))[1]
    assert (line["originally_ordered"], line["cancelled"], line["ordered"], line["line_value"]) == (15, 15, 0, 0)
    assert line["cancelled_value"] == 17700.0                                     # 15 x 1000 + 18% tax


async def test_a_partly_received_and_partly_cancelled_po_adds_up(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await make_po(client, h, w, [("chair", 10)], number="PO-MIX")
    assert (await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 4}]))).status_code == 200
    assert (await client.post(f"/api/purchase-orders/{po['id']}/line-groups/1/cancel-waiting", headers=h,
                              json={"quantity": 2})).status_code == 200
    detail = (await client.get(f"/api/purchase-orders/{po['id']}", headers=h)).json()
    assert (detail["received_units"], detail["waiting_units"], detail["cancelled_units"]) == (4, 4, 2)
    assert (detail["ordered_units"], detail["originally_ordered_units"]) == (8, 10)
    line = (await groups(client, h, po["id"]))[1]
    assert (line["ordered"], line["originally_ordered"], line["cancelled_value"]) == (8, 10, 2360.0)


async def test_the_quantity_edit_still_means_the_new_ordered_total(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po = await make_po(client, h, w, [("chair", 10)], number="PO-QTY")
    await client.post(f"/api/purchase-orders/{po['id']}/line-groups/1/cancel-waiting", headers=h, json={"quantity": 3})
    edited = await client.put(f"/api/purchase-orders/{po['id']}/line-groups/1", headers=h, json={"quantity": 5})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["ordered"], edited.json()["cancelled"], edited.json()["originally_ordered"]) == (5, 5, 10)
