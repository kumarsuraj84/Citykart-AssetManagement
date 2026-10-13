"""S2.3: GET /api/purchase-orders gives every PO with its company and vendor
names, its ordered / received / waiting / cancelled unit counts and a status,
from one aggregated query, with optional filters (status, waiting, q) and
paging -- and still works unchanged for callers that send no parameters."""
from app.core.db import SessionLocal
from app.masters.models import Vendor
from tests.core.s0_world import add_line, build_world, login, make_po


async def _list(client, h, **params):
    resp = await client.get("/api/purchase-orders", headers=h, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _deliver(client, h, w, po_id, unit_ids, prefix):
    resp = await client.post(f"/api/purchase-orders/{po_id}/deliver", headers=h, json={
        "invoice_number": f"INV-{prefix}", "invoice_date": "2026-02-01", "invoice_amount": 100,
        "lines": [{"pending_asset_id": i, "serial_number": f"{prefix}-{i}", "initial_asset_user_id": w["stock"]} for i in unit_ids]})
    assert resp.status_code == 200, resp.text


async def _four_pos(client, w):
    """WAIT (3 waiting), PART (1 received, 1 waiting), DONE (2 received), GONE (2 cancelled), EMPTY (no lines)."""
    h = await login(client, w, "admin")
    pos = {}
    pos["WAIT"] = await make_po(client, h, w, number="PO-WAIT", vendor_id=w["vendor"])
    await add_line(client, h, w, pos["WAIT"]["id"], quantity=3)
    pos["PART"] = await make_po(client, h, w, number="PO-PART")
    part = (await add_line(client, h, w, pos["PART"]["id"], quantity=2)).json()
    await _deliver(client, h, w, pos["PART"]["id"], [part[0]["id"]], "P")
    pos["DONE"] = await make_po(client, h, w, number="PO-DONE")
    done = (await add_line(client, h, w, pos["DONE"]["id"], quantity=2)).json()
    await _deliver(client, h, w, pos["DONE"]["id"], [u["id"] for u in done], "D")
    pos["GONE"] = await make_po(client, h, w, number="PO-GONE")
    gone = (await add_line(client, h, w, pos["GONE"]["id"], quantity=2)).json()
    for u in gone:
        await client.post(f"/api/purchase-orders/lines/{u['id']}/cancel", headers=h)
    pos["EMPTY"] = await make_po(client, h, w, number="PO-EMPTY")
    return h, pos


async def test_each_po_carries_names_counts_and_a_status(client):
    w = await build_world()
    h, pos = await _four_pos(client, w)
    rows = {p["po_number"]: p for p in await _list(client, h)}
    assert set(rows) == {"PO-WAIT", "PO-PART", "PO-DONE", "PO-GONE", "PO-EMPTY"}
    wait = rows["PO-WAIT"]
    assert (wait["company_name"], wait["vendor_name"]) == ("S0 Company A", "Good Vendor")
    assert rows["PO-PART"]["vendor_name"] is None
    counts = {n: (r["ordered_units"], r["received_units"], r["waiting_units"], r["cancelled_units"], r["status"])
              for n, r in rows.items()}
    assert counts == {
        "PO-WAIT": (3, 0, 3, 0, "WAITING"), "PO-PART": (2, 1, 1, 0, "PARTLY_RECEIVED"),
        "PO-DONE": (2, 2, 0, 0, "RECEIVED"), "PO-GONE": (0, 0, 0, 2, "CANCELLED"), "PO-EMPTY": (0, 0, 0, 0, "WAITING"),
    }
    # the existing fields are still there
    assert {"id", "company_id", "po_number", "po_date", "vendor_id", "cost_center_id", "is_active", "pi_status"} <= set(wait)
    assert rows["PO-DONE"]["pi_status"] == "PENDING"


async def test_the_list_is_newest_first_and_leaves_out_deleted_pos(client):
    w = await build_world()
    h, pos = await _four_pos(client, w)
    assert (await client.delete(f"/api/purchase-orders/{pos['EMPTY']['id']}", headers=h)).status_code == 200
    numbers = [p["po_number"] for p in await _list(client, h)]
    assert numbers == ["PO-GONE", "PO-DONE", "PO-PART", "PO-WAIT"]


async def test_filters_by_status_and_waiting(client):
    w = await build_world()
    h, pos = await _four_pos(client, w)
    assert [p["po_number"] for p in await _list(client, h, status="RECEIVED")] == ["PO-DONE"]
    assert [p["po_number"] for p in await _list(client, h, status="partly_received")] == ["PO-PART"]
    assert {p["po_number"] for p in await _list(client, h, status="WAITING")} == {"PO-WAIT", "PO-EMPTY"}
    assert [p["po_number"] for p in await _list(client, h, status="CANCELLED")] == ["PO-GONE"]
    assert {p["po_number"] for p in await _list(client, h, waiting="true")} == {"PO-WAIT", "PO-PART"}
    assert {p["po_number"] for p in await _list(client, h, waiting="false")} == {"PO-DONE", "PO-GONE", "PO-EMPTY"}
    bad = await client.get("/api/purchase-orders", headers=h, params={"status": "LOST"})
    assert bad.status_code == 422 and "Choose a status" in bad.json()["detail"]


async def test_search_by_po_number_or_vendor_name_with_wildcards_taken_literally(client):
    w = await build_world()
    h, pos = await _four_pos(client, w)
    await make_po(client, h, w, number="PO_100%")
    assert [p["po_number"] for p in await _list(client, h, q="wait")] == ["PO-WAIT"]
    assert [p["po_number"] for p in await _list(client, h, q="good vend")] == ["PO-WAIT"]
    assert [p["po_number"] for p in await _list(client, h, q="100%")] == ["PO_100%"]
    assert [p["po_number"] for p in await _list(client, h, q="_1")] == ["PO_100%"]
    assert await _list(client, h, q="%%%") == []
    assert len(await _list(client, h, q="  ")) == 6
    too_long = await client.get("/api/purchase-orders", headers=h, params={"q": "x" * 201})
    assert too_long.status_code == 422


async def test_paging_with_limit_offset_and_a_total(client):
    w = await build_world()
    h, pos = await _four_pos(client, w)
    resp = await client.get("/api/purchase-orders", headers=h, params={"limit": 2})
    assert resp.headers["X-Total-Count"] == "5" and [p["po_number"] for p in resp.json()] == ["PO-EMPTY", "PO-GONE"]
    page2 = await client.get("/api/purchase-orders", headers=h, params={"limit": 2, "offset": 2})
    assert [p["po_number"] for p in page2.json()] == ["PO-DONE", "PO-PART"]
    filtered = await client.get("/api/purchase-orders", headers=h, params={"waiting": "true", "limit": 1})
    assert filtered.headers["X-Total-Count"] == "2" and len(filtered.json()) == 1
    assert (await client.get("/api/purchase-orders", headers=h, params={"limit": 501})).status_code == 422
    assert (await client.get("/api/purchase-orders", headers=h, params={"limit": 0})).status_code == 422
    assert (await client.get("/api/purchase-orders", headers=h, params={"offset": -1})).status_code == 422


async def test_counts_and_status_follow_the_callers_work_area(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    po = await make_po(client, owner, w, number="MIX")
    it_units = (await add_line(client, owner, w, po["id"], "it", quantity=2)).json()
    await add_line(client, owner, w, po["id"], "nonit", quantity=5)
    await _deliver(client, owner, w, po["id"], [u["id"] for u in it_units], "IT")
    nonit_only = await make_po(client, owner, w, number="NONIT")
    await add_line(client, owner, w, nonit_only["id"], "nonit")

    whole = {p["po_number"]: p for p in await _list(client, owner)}["MIX"]
    assert (whole["ordered_units"], whole["received_units"], whole["waiting_units"], whole["status"]) == (7, 2, 5, "PARTLY_RECEIVED")
    it = await login(client, w, "op_it")
    rows = {p["po_number"]: p for p in await _list(client, it)}
    assert set(rows) == {"MIX"}                                          # the Non-IT-only PO is not visible
    mine = rows["MIX"]
    assert (mine["ordered_units"], mine["received_units"], mine["waiting_units"], mine["status"]) == (2, 2, 0, "RECEIVED")
    assert await _list(client, it, waiting="true") == []                 # nothing of theirs is waiting
    single = (await client.get(f"/api/purchase-orders/{po['id']}", headers=it)).json()
    assert (single["ordered_units"], single["status"]) == (2, "RECEIVED")
    nonit = await login(client, w, "op_nonit")
    assert [p["po_number"] for p in await _list(client, nonit, waiting="true")] == ["NONIT", "MIX"]


async def test_one_po_and_a_new_po_carry_the_same_additive_fields(client):
    w = await build_world()
    h = await login(client, w, "admin")
    created = await make_po(client, h, w, number="NEW-1", vendor_id=w["vendor"])
    assert (created["company_name"], created["vendor_name"], created["status"], created["ordered_units"]) == (
        "S0 Company A", "Good Vendor", "WAITING", 0)
    await add_line(client, h, w, created["id"], quantity=4)
    one = (await client.get(f"/api/purchase-orders/{created['id']}", headers=h)).json()
    assert (one["ordered_units"], one["waiting_units"], one["status"]) == (4, 4, "WAITING")


async def test_a_renamed_vendor_shows_its_current_name(client):
    w = await build_world()
    h = await login(client, w, "admin")
    await make_po(client, h, w, number="V-1", vendor_id=w["vendor"])
    async with SessionLocal() as s:
        vendor = await s.get(Vendor, w["vendor"])
        vendor.name = "Better Vendor"
        await s.commit()
    assert (await _list(client, h))[0]["vendor_name"] == "Better Vendor"
