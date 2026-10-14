"""S8: the automatic DATA audit (SQLAlchemy session events): one row per created / changed / deactivated
business record, only the changed fields, secrets masked, written in the same transaction."""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.bundles.models import Bundle, BundlePart
from app.core.db import SessionLocal
from app.items.models import Item, ItemMap
from app.lifecycle.models import AssetEvent
from app.masters.models import (
    AssetCategory, AssetSubcategory, Brand, Company, CostCenter, CustomField, Department, Location, Vendor, VendorErpLink,
)
from app.numbering.models import CodeRule
from app.observability import audit as obs_audit
from app.observability.models import AuditLog
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.core.s0_world import build_world, login, make_asset
from tests.observability.helpers import audit

# (model, kwargs from the world, field to change, new value, audit entity, label shown in the summary)
CASES = {
    "company": (Company, lambda w: {"code": "AUDCO", "name": "Audit Co"}, "name", "Audit Company", "company", "Audit Co"),
    "location": (Location, lambda w: {"company_id": w["co"], "code": "AUDL", "name": "Audit Place"}, "address",
                 "MG Road", "location", "Audit Place"),
    "department": (Department, lambda w: {"name": "Audit Dept"}, "name", "Audit Dept 2", "department", "Audit Dept"),
    "cost_center": (CostCenter, lambda w: {"company_id": w["co"], "code": "AUDCC", "name": "Audit CC"}, "name", "Audit CC 2",
                    "cost_center", "Audit CC"),
    "category": (AssetCategory, lambda w: {"code": "AUDCAT", "name": "Audit Cat", "asset_domain": "IT"}, "asset_domain",
                 "NON_IT", "category", "Audit Cat"),
    "subcategory": (AssetSubcategory, lambda w: {"category_id": w["it"], "code": "AUDSUB", "name": "Audit Sub"}, "name",
                    "Audit Sub 2", "subcategory", "Audit Sub"),
    "brand": (Brand, lambda w: {"code": "AUDBR", "name": "Audit Brand"}, "name", "Audit Brand 2", "brand", "Audit Brand"),
    "vendor": (Vendor, lambda w: {"code": "AUDV", "name": "ARIHANT INFOCOM LLP"}, "gstin", "27AAPFU0939F1ZV", "vendor",
               "ARIHANT INFOCOM LLP"),
    "custom_field": (CustomField, lambda w: {"field_key": "aud_key", "label": "Audit Field", "field_type": "text"}, "label",
                     "Audit Field 2", "custom_field", "Audit Field"),
    "code_rule": (CodeRule, lambda w: {"company_id": w["co"], "prefix_template": "AUD/", "suffix_template": "",
                                       "start_number": 1, "pad_width": 3}, "pad_width", 4, "code_rule", "AUD/"),
    "item": (Item, lambda w: {"name": "Audit Item", "category_id": w["it"]}, "serial_later", True, "item", "Audit Item"),
    "item_map": (ItemMap, lambda w: {"match_type": "CODE", "erp_item_code": "AUD-1", "not_tracked": True}, "note",
                 "cables", "item_map", "AUD-1"),
    "bundle": (Bundle, lambda w: {"name": "Audit Desktop"}, "name", "Audit Desktop 2", "bundle", "Audit Desktop"),
    "asset_user": (AssetUser, lambda w: {"company_id": w["co"], "code": "AUDU", "name": "Audit Person",
                                         "asset_user_type": "EMPLOYEE", "location_id": w["loc"]}, "phone", "98450",
                   "asset_user", "Audit Person (AUDU)"),
    "purchase_order": (PurchaseOrder, lambda w: {"company_id": w["co"], "po_number": "AUD-PO", "po_date": date(2026, 1, 1)},
                       "po_number", "AUD-PO-2", "purchase_order", "AUD-PO"),
}


async def _rows(entity: str, entity_id, *, changes_only: bool = False) -> list[AuditLog]:
    """The rows of one record; `changes_only` leaves out the CREATE row the test world itself wrote."""
    conditions = [AuditLog.entity == entity, AuditLog.entity_id == str(entity_id)]
    if changes_only:
        conditions.append(AuditLog.action != "CREATE")
    return await audit(*conditions)


@pytest.mark.parametrize("name", sorted(CASES))
async def test_create_update_and_deactivate_are_each_one_row(name):
    model, kwargs, field, value, entity, label = CASES[name]
    w = await build_world()
    async with SessionLocal() as s:
        obj = model(**kwargs(w))
        s.add(obj)
        await s.commit()
        obj_id = obj.id
    [created] = await _rows(entity, obj_id)
    assert created.category == "DATA" and created.action == "CREATE" and created.source == "script"
    assert created.summary.startswith(f"{created.summary.split(' ')[0]}") and f"'{label}'" in created.summary
    assert created.summary.endswith("created.")
    assert "created_at" not in (created.changes or {}) and "id" not in (created.changes or {})

    async with SessionLocal() as s:
        obj = await s.get(model, obj_id)
        old = getattr(obj, field)
        setattr(obj, field, value)
        await s.commit()
    rows = await _rows(entity, obj_id)
    assert [r.action for r in rows] == ["CREATE", "UPDATE"]
    update = rows[1]
    assert update.changes == {field: {"old": old, "new": value}}
    assert update.summary.endswith(f"updated: {field}.")

    async with SessionLocal() as s:
        obj = await s.get(model, obj_id)
        obj.is_active = False
        await s.commit()
    rows = await _rows(entity, obj_id)
    assert rows[-1].action == "DEACTIVATE" and rows[-1].summary.rstrip(".").endswith("deactivated")
    assert rows[-1].changes == {"is_active": {"old": True, "new": False}}


async def test_the_summary_names_the_record_and_the_changed_fields_through_the_api(client):
    w = await build_world()
    h = await login(client, w, "owner")
    resp = await client.put(f"/api/masters/vendors/{w['vendor']}", headers=h,
                            json={"name": "ARIHANT INFOCOM LLP", "gstin": "27AAPFU0939F1ZV"})
    assert resp.status_code == 200, resp.text
    [row] = await audit(AuditLog.request_id == resp.headers["x-request-id"], AuditLog.category == "DATA")
    assert row.summary == "Vendor 'ARIHANT INFOCOM LLP' updated: name, gstin."
    assert row.changes == {"name": {"old": "Good Vendor", "new": "ARIHANT INFOCOM LLP"},
                           "gstin": {"old": None, "new": "27AAPFU0939F1ZV"}}
    assert (row.actor_id, row.actor_code, row.actor_role, row.is_head_office_admin, row.source) == (
        w["owner"], "S0OWN", "ADMIN", True, "api")
    assert row.ip and row.entity == "vendor" and row.entity_id == str(w["vendor"])


async def test_a_password_hash_is_never_shown(client):
    w = await build_world()
    async with SessionLocal() as s:
        user = await s.get(AssetUser, w["employee"])
        user.password_hash = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2g"
        user.must_change_password = True
        await s.commit()
    [row] = await _rows("asset_user", w["employee"], changes_only=True)
    assert row.changes["password_hash"] == "***"
    assert "argon2" not in str(row.changes) and "aGFzaGhhc2g" not in row.summary


async def test_failed_login_counters_do_not_make_data_rows(client):
    w = await build_world()
    await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "wrong-password"})
    await client.post("/api/auth/login", json={"login_id": "S0ADM", "password": "Passw0rd!"})   # resets the counter
    assert await audit(AuditLog.category == "DATA", AuditLog.entity == "asset_user", AuditLog.action != "CREATE") == []


async def test_long_text_is_cut(client):
    w = await build_world()
    async with SessionLocal() as s:
        place = await s.get(Location, w["loc"])
        place.address = "A" * 480
        await s.commit()
    [row] = await _rows("location", w["loc"], changes_only=True)
    assert len(row.changes["address"]["new"]) < 400 and "cut" in row.changes["address"]["new"]


async def test_bookkeeping_fields_alone_make_no_row():
    w = await build_world()
    async with SessionLocal() as s:
        vendor = await s.get(Vendor, w["vendor"])
        vendor.updated_by = w["owner"]
        await s.commit()
    assert await _rows("vendor", w["vendor"], changes_only=True) == []


async def test_lifecycle_fields_of_an_asset_are_left_to_the_ledger_but_its_details_are_audited(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    moved = await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                              json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    assert moved.status_code == 201, moved.text
    rows = await audit(AuditLog.request_id == moved.headers["x-request-id"])
    assert [(r.category, r.action) for r in rows] == [("LIFECYCLE", "MOVE")]     # no DATA row for status / holder
    assert rows[0].summary == f"Ordinary Admin moved asset '{asset['asset_code']}' to Ravi Kumar."
    edit = await client.put(f"/api/assets/{asset['id']}", headers=h, json={"description": "Dell laptop 14 inch"})
    assert edit.status_code == 200, edit.text
    [row] = await audit(AuditLog.request_id == edit.headers["x-request-id"])
    assert row.action == "UPDATE" and row.changes["description"] == {"old": "Dell laptop", "new": "Dell laptop 14 inch"}


async def test_a_soft_deleted_asset_is_a_delete_row(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    resp = await client.delete(f"/api/assets/{asset['id']}", headers=h)
    assert resp.status_code == 204
    [row] = await audit(AuditLog.request_id == resp.headers["x-request-id"])
    assert row.action == "DELETE" and row.entity == "asset" and "deleted" in row.summary
    assert row.changes["deleted_at"]["old"] is None and row.changes["deleted_at"]["new"]


async def test_a_single_new_asset_is_one_create_row_with_its_key_columns(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.post("/api/assets", headers=h, json={
        "company_id": w["co"], "cost_center_id": w["cc"], "category_id": w["it"], "subcategory_id": w["lap"],
        "description": "Dell laptop", "serial_number": "SN-AUD-1", "initial_asset_user_id": w["stock"],
        "vendor_id": w["vendor"]})
    assert resp.status_code == 201, resp.text
    [row] = await audit(AuditLog.request_id == resp.headers["x-request-id"])
    assert (row.category, row.action, row.entity, row.entity_id) == ("DATA", "CREATE", "asset", str(resp.json()[0]["id"]))
    assert row.changes["serial_number"] == "SN-AUD-1" and row.changes["asset_code"] == resp.json()[0]["asset_code"]


async def test_a_rolled_back_change_leaves_no_audit_row():
    w = await build_world()
    async with SessionLocal() as s:
        s.add(Vendor(code="ROLLV", name="Rolled Back Traders"))
        await s.flush()
        await s.execute(select(1))          # the pending audit row is flushed too
        await s.rollback()
    assert await audit(AuditLog.summary.contains("Rolled Back")) == []


async def test_a_refused_request_leaves_no_data_row(client):
    w = await build_world()
    h = await login(client, w, "owner")
    resp = await client.post("/api/masters/vendors", headers=h, json={"name": "Good Vendor"})   # duplicate name
    assert resp.status_code == 422
    assert await audit(AuditLog.request_id == resp.headers["x-request-id"], AuditLog.category == "DATA") == []


async def test_suppressed_and_disabled_sessions_write_no_automatic_rows():
    await build_world()
    async with SessionLocal() as s:
        obs_audit.suppress(s, "vendor")
        s.add(Vendor(code="SUPV", name="Quiet Vendor"))
        s.add(Brand(code="SUPB", name="Loud Brand"))
        await s.commit()
    async with SessionLocal() as s:
        obs_audit.disable(s)
        s.add(Brand(code="SUPB2", name="Silent Brand"))
        await s.commit()
    rows = await audit(AuditLog.summary.in_(["Vendor 'Quiet Vendor' created.", "Brand 'Loud Brand' created.",
                                             "Brand 'Silent Brand' created."]))
    assert [r.summary for r in rows] == ["Brand 'Loud Brand' created."]


async def test_ledgers_units_and_the_log_tables_are_never_audited_automatically(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    async with SessionLocal() as s:
        s.add(AssetEvent(asset_id=asset["id"], event_type="CORRECTION", event_date=datetime.now(timezone.utc),
                         status_after="IN_STOCK", recorded_by=w["admin"], from_asset_user_id=w["stock"]))
        po = PurchaseOrder(company_id=w["co"], po_number="UNIT-PO", po_date=date(2026, 1, 1))
        s.add(po)
        await s.flush()
        s.add(PendingAsset(purchase_order_id=po.id, company_id=w["co"], description="x", category_id=w["it"],
                           cost_center_id=w["cc"]))
        await s.commit()
    entities = {r.entity for r in await audit(AuditLog.source == "script")}
    assert "purchase_order" in entities
    assert not entities & {"asset_event", "pending_asset", "audit_log", "asset_field_change"}


async def test_removing_a_vendor_erp_link_is_a_delete_row():
    w = await build_world()
    async with SessionLocal() as s:
        link = VendorErpLink(vendor_id=w["vendor"], company_id=w["co"], erp_vendor_code="61")
        s.add(link)
        await s.commit()
        link_id = link.id
    async with SessionLocal() as s:
        await s.delete(await s.get(VendorErpLink, link_id))
        await s.commit()
    rows = await audit(AuditLog.entity == "vendor_erp_link")
    assert [r.action for r in rows] == ["CREATE", "DELETE"]
    assert rows[1].summary == "Vendor ERP link '61' removed."


async def test_a_bundle_part_is_audited_with_its_parent_bundle():
    w = await build_world()
    async with SessionLocal() as s:
        bundle = Bundle(name="Desk Set")
        s.add(bundle)
        await s.flush()
        s.add(BundlePart(bundle_id=bundle.id, name="Desk", category_id=w["nonit"], share_percent=100))
        await s.commit()
    assert {r.entity for r in await audit()} >= {"bundle", "bundle_part"}


async def test_audit_rows_are_also_written_to_audit_jsonl_after_commit_only():
    from tests.observability.helpers import flush_logs, log_lines

    await build_world()
    async with SessionLocal() as s:
        s.add(Vendor(code="FILEV", name="File Vendor"))
        await s.commit()
    async with SessionLocal() as s:
        s.add(Vendor(code="GONEV", name="Never Saved Vendor"))
        await s.flush()
        await s.rollback()
    flush_logs()
    lines = [line.get("summary", "") for line in log_lines("audit.jsonl")]
    assert "Vendor 'File Vendor' created." in lines
    assert not any("Never Saved Vendor" in line for line in lines)
