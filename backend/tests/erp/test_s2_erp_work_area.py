"""S0 leftover (fixed in S2): on a PO that mixes IT and Non-IT lines, the ERP
delivery reminders and the ERP-change views of someone limited to one work
area show only their own area's items, and applying an ERP change never
alters units outside the caller's work area (refused with a clear 403)."""
from datetime import date

from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.erp.source import ErpReceipt
from app.masters.models import AssetCategory, AssetSubcategory, Department, Location
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import add_pending_asset_line
from tests.erp.test_erp_api import _headers, _setup, desktop_po, erp, line  # noqa: F401  (erp is a fixture)
from tests.erp.test_erp_followup import PO_CODE, _create_desktop_po

CHAIR = "CT777001"


def _two_item_po(desktops=7, chairs=3, chairs_cancelled=0, status="OPEN", desktops_cancelled=0):
    return desktop_po(status=status, line_count=2, lines=[
        line(1, "CT324973", "DELL DESKTOP", desktops, 20000, cancelled=desktops_cancelled),
        line(2, CHAIR, "OFFICE CHAIR", chairs, 500, cancelled=chairs_cancelled),
    ])


async def _mixed_erp_po(client, ids, erp):
    """An ERP PO with 7 desktops (IT) and 3 chairs (Non-IT); CKAM holds both."""
    erp.pos[PO_CODE] = _two_item_po()
    owner = await _headers(client, "OWN")
    po_id = await _create_desktop_po(client, ids, owner)
    async with SessionLocal() as s:
        furniture = AssetCategory(code="FURN", name="Furniture", asset_domain="NON_IT")
        s.add(furniture)
        await s.flush()
        chair = AssetSubcategory(category_id=furniture.id, code="CHR", name="Chair")
        s.add(chair)
        await s.flush()
        po = await s.get(PurchaseOrder, po_id)
        actor = (await s.execute(select(AssetUser).where(AssetUser.code == "OWN"))).scalar_one()
        await add_pending_asset_line(s, po, {
            "description": "Office chair", "barcode": CHAIR, "category_id": furniture.id, "subcategory_id": chair.id,
            "purchase_cost": 500, "tax_percent": 18, "quantity": 3, "erp_item_code": CHAIR,
        }, actor)
        loc = (await s.execute(select(Location).where(Location.code == "SPL-HO"))).scalar_one()
        dept = (await s.execute(select(Department))).scalars().first()
        s.add(AssetUser(company_id=po.company_id, code="OPIT", name="IT Operator", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="OPERATOR", allowed_asset_domains="IT",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False))
        s.add(AssetUser(company_id=po.company_id, code="OPNI", name="Non-IT Operator", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="OPERATOR", allowed_asset_domains="NON_IT",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False))
        await s.commit()
    return po_id, owner


async def _statuses(po_id, code):
    async with SessionLocal() as s:
        rows = (await s.execute(select(PendingAsset).where(
            PendingAsset.purchase_order_id == po_id, PendingAsset.erp_item_code == code))).scalars().all()
    out: dict[str, int] = {}
    for r in rows:
        out[r.status] = out.get(r.status, 0) + 1
    return out


async def test_reminders_show_each_team_only_its_own_items(client, erp):
    ids = await _setup()
    po_id, owner = await _mixed_erp_po(client, ids, erp)
    erp.receipt_list = [
        ErpReceipt(po_code=PO_CODE, item_code="CT324973", grc_no="G1", grc_date=date(2026, 9, 20), received_qty=2),
        ErpReceipt(po_code=PO_CODE, item_code=CHAIR, grc_no="G2", grc_date=date(2026, 9, 21), received_qty=3),
    ]
    everything = (await client.get("/api/erp/reminders", headers=owner)).json()
    assert {i["item_code"] for i in everything[0]["items"]} == {"CT324973", CHAIR}
    it = (await client.get("/api/erp/reminders", headers=await _headers(client, "OPIT"))).json()
    assert [i["item_code"] for i in it[0]["items"]] == ["CT324973"] and it[0]["to_deliver"] == 2
    nonit = (await client.get("/api/erp/reminders", params={"po_id": po_id}, headers=await _headers(client, "OPNI"))).json()
    assert [i["item_code"] for i in nonit[0]["items"]] == [CHAIR] and nonit[0]["to_deliver"] == 3


async def test_the_change_views_show_each_team_only_its_own_items(client, erp):
    ids = await _setup()
    po_id, owner = await _mixed_erp_po(client, ids, erp)
    erp.pos[PO_CODE] = _two_item_po(desktops_cancelled=2, chairs_cancelled=1)      # both items reduced
    all_kinds = {c["id"] for c in (await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=owner)).json()["changes"]}
    assert all_kinds == {"CANCEL_UNITS:CT324973", f"CANCEL_UNITS:{CHAIR}"}
    it_h = await _headers(client, "OPIT")
    mine = (await client.get(f"/api/erp/purchase-orders/{po_id}/changes", headers=it_h)).json()["changes"]
    assert [c["id"] for c in mine] == ["CANCEL_UNITS:CT324973"]
    summary = (await client.get("/api/erp/changes/summary", headers=it_h)).json()
    assert summary["available"] is True and summary["items"][0]["changes"] == 1
    owner_summary = (await client.get("/api/erp/changes/summary", headers=owner)).json()
    assert owner_summary["items"][0]["changes"] == 2


async def test_a_change_to_the_other_areas_items_cannot_be_applied_or_kept(client, erp):
    ids = await _setup()
    po_id, owner = await _mixed_erp_po(client, ids, erp)
    erp.pos[PO_CODE] = _two_item_po(chairs_cancelled=2)
    it_h = await _headers(client, "OPIT")
    for mode in ("apply", "keep"):
        resp = await client.post(f"/api/erp/purchase-orders/{po_id}/changes/apply", headers=it_h,
                                 json={"items": [{"id": f"CANCEL_UNITS:{CHAIR}", "mode": mode}]})
        assert resp.status_code == 403, resp.text
        assert "Non-IT items of this purchase order, which are outside your work area" in resp.json()["detail"]
    assert await _statuses(po_id, CHAIR) == {"PENDING": 3}
    ok = await client.post(f"/api/erp/purchase-orders/{po_id}/changes/apply", headers=await _headers(client, "OPNI"),
                           json={"items": [{"id": f"CANCEL_UNITS:{CHAIR}", "mode": "apply"}]})
    assert ok.status_code == 200, ok.text
    assert await _statuses(po_id, CHAIR) == {"PENDING": 1, "CANCELLED": 2}


async def test_applying_the_erps_cancellation_of_a_mixed_po_needs_someone_who_handles_both(client, erp):
    ids = await _setup()
    po_id, owner = await _mixed_erp_po(client, ids, erp)
    erp.pos[PO_CODE] = _two_item_po(status="CANCELLED", desktops_cancelled=7, chairs_cancelled=3)
    it_h = await _headers(client, "OPIT")
    refused = await client.post(f"/api/erp/purchase-orders/{po_id}/changes/apply", headers=it_h,
                                json={"items": [{"id": "PO_CANCELLED", "mode": "apply"}]})
    assert refused.status_code == 403 and "Non-IT" in refused.json()["detail"]
    assert await _statuses(po_id, CHAIR) == {"PENDING": 3}
    assert await _statuses(po_id, "CT324973") == {"PENDING": 28}
    done = await client.post(f"/api/erp/purchase-orders/{po_id}/changes/apply", headers=owner,
                             json={"items": [{"id": "PO_CANCELLED", "mode": "apply"}]})
    assert done.status_code == 200, done.text
    assert await _statuses(po_id, CHAIR) == {"CANCELLED": 3}


async def test_the_own_areas_change_is_applied_and_never_touches_the_other_area(client, erp):
    ids = await _setup()
    po_id, owner = await _mixed_erp_po(client, ids, erp)
    erp.pos[PO_CODE] = _two_item_po(desktops_cancelled=1)
    resp = await client.post(f"/api/erp/purchase-orders/{po_id}/changes/apply", headers=await _headers(client, "OPIT"),
                             json={"items": [{"id": "CANCEL_UNITS:CT324973", "mode": "apply"}]})
    assert resp.status_code == 200, resp.text
    assert await _statuses(po_id, "CT324973") == {"PENDING": 24, "CANCELLED": 4}
    assert await _statuses(po_id, CHAIR) == {"PENDING": 3}
