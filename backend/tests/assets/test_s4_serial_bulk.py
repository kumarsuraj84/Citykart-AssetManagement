"""S4: PUT /api/assets/serials -- fill many pending serials at once, all or nothing, with the same rules
and audit as PUT /api/assets/{id}/serial."""
from sqlalchemy import select

from app.assets.models import Asset, AssetFieldChange
from app.core.db import SessionLocal
from tests.purchase_orders.s4_world import build_s4_world, login, make_po, receipt, receive


async def _pending(client, h, w, n: int = 3, number: str = "PO-SP", item: str = "ap") -> list[dict]:
    po = await make_po(client, h, w, [(item, n)], number=number)
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": n, "serial_mode": "SERIAL_LATER"}],
                                                       invoice_number=f"INV-{number}"))
    assert resp.status_code == 200, resp.text
    return resp.json()["assets"]


async def _put(client, h, entries):
    return await client.put("/api/assets/serials", headers=h, json={"entries": entries})


async def _asset(asset_id: int) -> Asset:
    async with SessionLocal() as s:
        return await s.get(Asset, asset_id)


async def test_many_pending_serials_are_filled_at_once_and_audited(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a, b, c = await _pending(client, h, w)
    it = await login(client, w, "op_it")
    resp = await _put(client, it, [{"asset_id": a["asset_id"], "serial_number": "  AMP-1 "},
                                   {"asset_id": b["asset_id"], "serial_number": "AMP-2"},
                                   {"asset_id": c["asset_id"], "no_serial": True}])
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 3, "results": [
        {"asset_id": a["asset_id"], "asset_code": a["asset_code"], "serial_number": "AMP-1"},
        {"asset_id": b["asset_id"], "asset_code": b["asset_code"], "serial_number": "AMP-2"},
        {"asset_id": c["asset_id"], "asset_code": c["asset_code"], "serial_number": "N/A"}]}
    for entry, serial in ((a, "AMP-1"), (b, "AMP-2"), (c, "N/A")):
        asset = await _asset(entry["asset_id"])
        assert (asset.serial_number, asset.serial_pending, asset.updated_by) == (serial, False, w["op_it"])
    async with SessionLocal() as s:
        audit = (await s.execute(select(AssetFieldChange).order_by(AssetFieldChange.id))).scalars().all()
    assert [(r.asset_id, r.field_name, r.old_value, r.new_value, r.actor_id) for r in audit] == [
        (a["asset_id"], "serial_number", None, "AMP-1", w["op_it"]),
        (b["asset_id"], "serial_number", None, "AMP-2", w["op_it"]),
        (c["asset_id"], "serial_number", None, "N/A", w["op_it"])]
    listed = await client.get("/api/assets?serial_pending=true", headers=h)
    assert listed.json()["total"] == 0


async def test_duplicates_inside_the_batch_refuse_everything(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a, b, c = await _pending(client, h, w)
    resp = await _put(client, h, [{"asset_id": a["asset_id"], "serial_number": "dup-1"},
                                  {"asset_id": b["asset_id"], "serial_number": "OK-1"},
                                  {"asset_id": c["asset_id"], "serial_number": "DUP-1"}])
    assert resp.status_code == 422
    assert resp.json()["problems"] == [{"entry_index": 3, "asset_id": c["asset_id"], "serial": "DUP-1",
                                        "message": "Serial number DUP-1 is typed more than once (entries 1 and 3)."}]
    assert resp.json()["detail"] == "Entry 3: Serial number DUP-1 is typed more than once (entries 1 and 3)."
    for x in (a, b, c):
        assert (await _asset(x["asset_id"])).serial_pending is True
    async with SessionLocal() as s:
        assert (await s.execute(select(AssetFieldChange))).first() is None


async def test_a_serial_already_used_is_refused_with_the_asset_named(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 1)], number="CAM")
    used = (await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["TAKEN-1"]}]))).json()
    [a] = await _pending(client, h, w, 1)
    resp = await _put(client, h, [{"asset_id": a["asset_id"], "serial_number": "taken-1"}])
    assert resp.status_code == 422
    assert resp.json()["problems"][0]["message"] == f"Serial number taken-1 is already used by asset {used['assets'][0]['asset_code']}."


async def test_n_a_may_repeat_in_the_batch(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a, b = await _pending(client, h, w, 2)
    resp = await _put(client, h, [{"asset_id": a["asset_id"], "serial_number": "N/A"}, {"asset_id": b["asset_id"], "no_serial": True}])
    assert resp.status_code == 200 and resp.json()["updated"] == 2


async def test_each_entry_is_checked_and_every_problem_is_listed(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a, b = await _pending(client, h, w, 2)
    po = await make_po(client, h, w, [("camera", 1)], number="CAM")
    [settled] = (await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["X-1"]}]))).json()["assets"]
    resp = await _put(client, h, [
        {"asset_id": a["asset_id"], "serial_number": "   "},
        {"asset_id": a["asset_id"], "serial_number": "AGAIN"},
        {"asset_id": settled["asset_id"], "serial_number": "X-2"},
        {"asset_id": 99999999, "serial_number": "X-3"},
        {"asset_id": b["asset_id"], "serial_number": "FINE"},
    ])
    assert resp.status_code == 422
    assert [(p["entry_index"], p["message"]) for p in resp.json()["problems"]] == [
        (1, f"Enter the serial number of {a['asset_code']}, or choose no serial number."),
        (2, "This asset appears more than once; enter it once."),
        (3, f"The serial number of {settled['asset_code']} is not waiting to be entered."),
        (4, "This asset was not found."),
    ]
    assert resp.json()["detail"].startswith("Nothing was saved: 4 problems need fixing. Entry 1:")
    assert (await _asset(b["asset_id"])).serial_pending is True


async def test_assets_outside_the_callers_scope_are_not_found_and_viewers_are_refused(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    [chair] = await _pending(client, h, w, 1, number="CH", item="chair")
    it = await login(client, w, "op_it")
    resp = await _put(client, it, [{"asset_id": chair["asset_id"], "serial_number": "CH-1"}])
    assert resp.status_code == 422 and resp.json()["problems"][0]["message"] == "This asset was not found."
    viewer = await _put(client, await login(client, w, "viewer_it"), [{"asset_id": chair["asset_id"], "serial_number": "CH-1"}])
    assert viewer.status_code == 403
    nonit = await _put(client, await login(client, w, "op_nonit"), [{"asset_id": chair["asset_id"], "serial_number": "CH-1"}])
    assert nonit.status_code == 200


async def test_the_batch_size_is_limited(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    too_many = await _put(client, h, [{"asset_id": n, "serial_number": f"S{n}"} for n in range(1, 1002)])
    assert too_many.status_code == 422 and too_many.json()["detail"] == "Entries can have at most 1,000 entries."
    empty = await _put(client, h, [])
    assert empty.status_code == 422
