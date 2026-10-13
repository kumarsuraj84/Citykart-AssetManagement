"""S5: report previews -- the asset register and movement log on screen, the same query, scope and row
values as the Excel exports, one page at a time, with totals and a summary."""
from io import BytesIO

import openpyxl
from sqlalchemy import update

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import CustomField
from tests.purchase_orders.s4_world import build_s4_world, login, serials


async def batch(client, h, w, item, quantity, **over) -> list[dict]:
    resp = await client.post("/api/assets/batch", headers=h, json={
        "item_id": w[f"item_{item}"], "quantity": quantity, "received_into_asset_user_id": w["stock"],
        "cost_center_id": w["cc"], **over})
    assert resp.status_code == 201, resp.text
    return resp.json()["assets"]


def sheet_rows(content: bytes) -> list[dict]:
    ws = openpyxl.load_workbook(BytesIO(content)).active
    values = list(ws.values)
    return [dict(zip(values[0], row)) for row in values[1:]]


async def world(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    async with SessionLocal() as s:
        s.add(CustomField(field_key="tag_no", label="Tag number", field_type="text"))
        await s.commit()
    cams = await batch(client, h, w, "camera", 3, serial_numbers=serials("C", 3), vendor_id=w["vendor"], po_number="PO-1",
                       invoice_date="2026-01-10", purchase_cost=1000, tax_percent=18)
    boxes = await batch(client, h, w, "gangbox", 4, invoice_date="2026-03-01", custom_fields={"tag_no": "T-1"})
    chairs = await batch(client, h, w, "chair", 2, brand_id=w["brand"])
    move = await client.post(f"/api/assets/{boxes[0]['asset_id']}/events", headers=h,
                             json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    assert move.status_code in (200, 201), move.text
    return w, h, cams, boxes, chairs


async def test_the_first_page_holds_exactly_the_rows_of_the_excel_file(client):
    w, h, cams, boxes, chairs = await world(client)
    preview = (await client.get("/api/reports/assets/preview", headers=h, params={"limit": 5})).json()
    exported = sheet_rows((await client.get("/api/reports/export/assets", headers=h)).content)
    assert preview["total"] == len(exported) == 9
    assert preview["columns"] == list(exported[0].keys()) and "Custom:tag_no" in preview["columns"]
    assert preview["rows"] == exported[:5]
    assert len(preview["asset_ids"]) == 5
    page2 = (await client.get("/api/reports/assets/preview", headers=h, params={"limit": 5, "offset": 5})).json()
    assert page2["rows"] == exported[5:] and page2["total"] == 9


async def test_the_summary_counts_everything_the_filters_match(client):
    w, h, cams, boxes, chairs = await world(client)
    summary = (await client.get("/api/reports/assets/preview", headers=h, params={"limit": 1})).json()["summary"]
    assert summary["by_status"] == [{"status": "IN_STOCK", "status_label": "In stock", "count": 8},
                                    {"status": "ALLOTTED", "status_label": "Allotted", "count": 1}]
    assert {(c["category_name"], c["count"]) for c in summary["by_category"]} == {("Computers", 7), ("Furniture", 2)}
    assert summary["by_item"][0] == {"item_id": w["item_gangbox"], "item_name": "Gang Box", "count": 4}
    assert [i["count"] for i in summary["by_item"]] == [4, 3, 2]


async def test_the_new_filters_mean_the_same_in_the_preview_and_the_file(client):
    w, h, cams, boxes, chairs = await world(client)
    cases = [
        ({"vendor_id": w["vendor"]}, 3), ({"po_number": "po-1"}, 3), ({"item_id": w["item_gangbox"]}, 4),
        ({"holder_id": w["employee"]}, 1), ({"work_area": "NON_IT"}, 2), ({"status": "ALLOTTED"}, 1),
        ({"category_id": w["nonit"]}, 2), ({"purchase_from": "2026-02-01", "purchase_to": "2026-03-31"}, 4),
        ({"company_id": w["co_b"]}, 0),
    ]
    for params, expected in cases:
        preview = (await client.get("/api/reports/assets/preview", headers=h, params=params)).json()
        exported = sheet_rows((await client.get("/api/reports/export/assets", headers=h, params=params)).content)
        assert preview["total"] == len(exported) == expected, params
        assert preview["rows"] == exported[:50], params
    bad = await client.get("/api/reports/assets/preview", headers=h, params={"purchase_from": "2026-05-01", "purchase_to": "2026-01-01"})
    assert bad.status_code == 422 and bad.json()["detail"] == "The 'to' date cannot be before the 'from' date."


async def test_the_preview_follows_company_work_area_and_custody(client):
    w, h, cams, boxes, chairs = await world(client)
    await batch(client, h, w, "gangbox", 2, cost_center_id=w["cc_b"], received_into_asset_user_id=w["stock_b"])
    it_op = (await client.get("/api/reports/assets/preview", headers=await login(client, w, "op_it"))).json()
    assert it_op["total"] == 7 and {r["Category"] for r in it_op["rows"]} == {"Computers"}
    assert it_op["summary"]["by_category"] == [{"category_id": w["it"], "category_name": "Computers", "count": 7}]
    viewer = (await client.get("/api/reports/assets/preview", headers=await login(client, w, "viewer_it"))).json()
    assert viewer["total"] == 7
    async with SessionLocal() as s:
        ravi = await s.get(AssetUser, w["employee"])
        ravi.login_enabled, ravi.must_change_password, ravi.password_hash = True, False, hash_password("Passw0rd!")
        await s.commit()
    mine = (await client.get("/api/reports/assets/preview", headers=await login(client, w, "employee"),
                             params={"holder_id": w["stock"]})).json()
    assert mine["total"] == 1 and mine["rows"][0]["Current AssetUser"] == "Ravi Kumar"
    assert (await client.get("/api/reports/assets/preview", headers=h, params={"limit": 201})).status_code == 422


async def test_the_movement_log_preview_matches_the_file(client):
    w, h, cams, boxes, chairs = await world(client)
    params = {"from_date": "2026-01-01", "to_date": "2099-12-31"}
    preview = (await client.get("/api/reports/movements/preview", headers=h, params={**params, "limit": 4})).json()
    exported = sheet_rows((await client.get("/api/reports/export/movements", headers=h, params=params)).content)
    assert preview["total"] == len(exported) == 10                      # 9 PROCURED + 1 MOVED
    assert preview["columns"] == list(exported[0].keys())
    assert preview["rows"] == exported[:4]
    last = (await client.get("/api/reports/movements/preview", headers=h, params={**params, "limit": 4, "offset": 8})).json()
    assert last["rows"] == exported[8:]
    it_op = (await client.get("/api/reports/movements/preview", headers=await login(client, w, "op_it"), params=params)).json()
    assert it_op["total"] == 8
    bad = await client.get("/api/reports/movements/preview", headers=h, params={"from_date": "2026-05-01", "to_date": "2026-01-01"})
    assert bad.status_code == 422


async def test_self_service_cannot_read_the_movement_log_preview(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        await s.execute(update(AssetUser).where(AssetUser.id == w["employee"]).values(
            login_enabled=True, must_change_password=False, password_hash=hash_password("Passw0rd!")))
        await s.commit()
    me = await login(client, w, "employee")
    resp = await client.get("/api/reports/movements/preview", headers=me, params={"from_date": "2026-01-01", "to_date": "2026-12-31"})
    assert resp.status_code == 403
