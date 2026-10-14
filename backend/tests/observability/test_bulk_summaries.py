"""S8: a bulk action is ONE explicit audit row with counts and ids -- never one row per unit."""
import io

import openpyxl
from sqlalchemy import select

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.observability.models import AuditLog
from tests.core.s0_world import make_asset
from tests.observability.helpers import audit, everything_logged
from tests.purchase_orders.s4_world import build_s4_world, login, make_po, receipt, receive, serials


async def _for(resp) -> list[AuditLog]:
    return await audit(AuditLog.request_id == resp.headers["x-request-id"])


async def test_receiving_100_units_is_one_receive_row(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 100)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 100,
                                                           "serial_numbers": serials("RX", 100)}]))
    assert resp.status_code == 200, resp.text
    [row] = await _for(resp)
    assert (row.category, row.action, row.entity, row.entity_id) == ("DATA", "RECEIVE", "purchase_order", str(po["id"]))
    assert row.changes["assets_created"] == 100 and row.changes["total"] == 100 and len(row.changes["ids"]) == 100
    assert row.summary.startswith("Purchase order PO-S4: 100 units received on invoice INV-1 (")
    assert row.company_id == w["co"] and row.actor_code == "S0ADM"


async def test_a_large_receipt_lists_at_most_200_ids_and_the_total(client):
    from app.observability.writer import ids_preview

    preview = ids_preview(range(450))
    assert len(preview["ids"]) == 200 and preview["total"] == 450


async def test_the_old_delivery_is_one_receive_row_too(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 3)])
    ids = [u["id"] for u in (await client.get(f"/api/purchase-orders/{po['id']}/lines", headers=h)).json()]
    resp = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=h, json={
        "invoice_number": "INV-D", "invoice_date": "2026-02-01", "invoice_amount": 10, "lines": [
            {"pending_asset_id": i, "serial_number": s, "initial_asset_user_id": w["stock"]}
            for i, s in zip(ids, serials("DV", 3))]})
    assert resp.status_code == 200, resp.text
    [row] = await _for(resp)
    assert row.action == "RECEIVE" and row.changes["units"] == 3 and row.changes["total"] == 3


async def test_adding_50_assets_in_a_batch_is_one_row(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    resp = await client.post("/api/assets/batch", headers=h, json={
        "item_id": w["item_gangbox"], "quantity": 50, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]})
    assert resp.status_code == 201, resp.text
    [row] = await _for(resp)
    assert (row.action, row.entity, row.entity_id) == ("BATCH_ADD", "item", str(w["item_gangbox"]))
    assert row.changes["quantity"] == 50 and row.changes["total"] == 50
    assert row.summary.startswith("Ordinary Admin added 50 assets of Gang Box (")


async def test_a_bulk_move_and_a_bulk_action_are_one_lifecycle_row_each(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    ids = [(await make_asset(client, h, w))["id"] for _ in range(4)]
    moved = await client.post("/api/assets/bulk-move", headers=h, json={
        "asset_ids": ids + [999999], "to_asset_user_id": w["stock2"], "reference_no": "GP-7"})
    assert moved.status_code == 200, moved.text
    [row] = await _for(moved)
    assert (row.category, row.action) == ("LIFECYCLE", "MOVE")
    assert row.summary == "Ordinary Admin moved 4 assets to Second Stock; 1 asset could not be."
    assert row.changes["total"] == 4 and row.changes["failed_total"] == 1 and row.changes["reference_no"] == "GP-7"
    repair = await client.post("/api/assets/bulk-action", headers=h, json={
        "asset_ids": ids[:2], "event_type": "SENT_FOR_REPAIR", "remarks": "screen"})
    assert repair.status_code == 200, repair.text
    [row] = await _for(repair)
    assert (row.category, row.action, row.changes["total"]) == ("LIFECYCLE", "SENT_FOR_REPAIR", 2)
    assert row.summary == "Ordinary Admin recorded 2 assets as sent for repair."


async def test_linking_assets_to_items_is_one_link_row(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    ids = [(await make_asset(client, h, w))["id"] for _ in range(3)]
    resp = await client.post("/api/assets/link-items", headers=h,
                             json=[{"asset_id": i, "item_id": w["item_camera"]} for i in ids])
    assert resp.status_code == 200, resp.text
    [row] = await _for(resp)
    assert row.action == "LINK" and row.changes["linked"] == 3 and len(row.changes["links"]) == 3


async def test_filling_pending_serials_in_bulk_is_one_row(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("ap", 3)])
    got = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 3}]))
    assert got.status_code == 200, got.text
    ids = got.json()["label_asset_ids"]
    resp = await client.put("/api/assets/serials", headers=h, json={"entries": [
        {"asset_id": i, "serial_number": f"AP-{n}"} for n, i in enumerate(ids)]})
    assert resp.status_code == 200, resp.text
    [row] = await _for(resp)
    assert row.action == "SERIALS_FILLED" and row.changes["total"] == 3


async def test_recording_a_pi_is_one_row_without_per_asset_rows(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 5)])
    assert (await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 5}]))).status_code == 200
    resp = await client.post(f"/api/purchase-orders/{po['id']}/record-pi", headers=h,
                             json={"invoice_number": "INV-1", "pi_number": "PI-9", "pi_date": "2026-02-02"})
    assert resp.status_code == 200, resp.text
    [row] = await _for(resp)
    assert row.action == "PI_RECORDED" and len(row.changes["updated"]) == 5


async def test_cancelling_waiting_units_and_deleting_a_po_are_one_row_each(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 5), ("camera", 2)])
    cancel = await client.post(f"/api/purchase-orders/{po['id']}/line-groups/1/cancel-waiting", headers=h,
                               json={"quantity": 2})
    assert cancel.status_code == 200, cancel.text
    [row] = await _for(cancel)
    assert row.action == "CANCEL_WAITING" and row.changes["cancelled_units"] == 2
    gone = await client.delete(f"/api/purchase-orders/{po['id']}", headers=h)
    assert gone.status_code == 200, gone.text
    [row] = await _for(gone)
    assert (row.action, row.entity, row.entity_id) == ("DELETE_PO", "purchase_order", str(po["id"]))


async def test_issuing_passwords_is_one_security_row_and_never_contains_a_password(client):
    w = await build_s4_world()
    from tests.asset_users.test_s5_issue_passwords import make_stores

    await make_stores(w, ["LAM", "LAD", "LAS"])
    resp = await client.post("/api/asset-users/issue-passwords", headers=await login(client, w, "admin"),
                             json={"kind": "stores"})
    assert resp.status_code == 200, resp.text
    temps = [r["temp_password"] for r in resp.json()]
    [row] = await _for(resp)
    assert (row.category, row.action, row.changes["total"]) == ("SECURITY", "PASSWORD_RESET", 3)
    assert sorted(row.changes["codes"]) == ["LAD", "LAM", "LAS"]
    text = await everything_logged()
    assert not any(t in text for t in temps)
    assert "$argon2" not in text


async def test_giving_every_store_its_rooms_is_one_row(client):
    w = await build_s4_world()
    from tests.asset_users.test_s5_issue_passwords import make_stores

    await make_stores(w, ["LAM", "LAD"])
    resp = await client.post("/api/people/stores/ensure-rooms", headers=await login(client, w, "owner"))
    assert resp.status_code == 200, resp.text
    [row] = await _for(resp)
    assert row.action == "BATCH_ADD" and row.changes["stores_completed"] == 2
    assert row.changes["stock_rooms_created"] == 2 and row.changes["install_points_created"] == 2


async def test_an_import_commit_is_one_import_row_beside_the_records_it_made(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.append(["Code", "Name", "GSTIN"])
    sheet.append(["IMPV1", "Imported One", None])
    sheet.append(["IMPV2", "Imported Two", None])
    buf = io.BytesIO()
    book.save(buf)
    files = {"file": ("vendors.xlsx", buf.getvalue(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    preview = await client.post("/api/masters/vendors/import/preview", headers=h, files=files)
    assert preview.status_code == 200, preview.text
    [checked] = await _for(preview)
    assert (checked.category, checked.action, checked.changes["valid_rows"]) == ("IMPORT", "IMPORT_PREVIEW", 2)
    resp = await client.post("/api/masters/vendors/import/commit", headers=h, files=files)
    assert resp.status_code == 200, resp.text
    rows = await _for(resp)
    assert sorted((r.category, r.action) for r in rows) == [("DATA", "CREATE"), ("DATA", "CREATE"),
                                                            ("IMPORT", "IMPORT_COMMIT")]
    [summary] = [r for r in rows if r.category == "IMPORT"]
    assert summary.changes["imported"] == 2 and summary.changes["file"] == "vendors.xlsx"
