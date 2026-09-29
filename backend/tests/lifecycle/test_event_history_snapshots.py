"""AM-01 historical event snapshots: renaming a Holder must not retroactively
change how an already-recorded asset_event displays. Before this stage,
lifecycle/router.py::_with_labels and reports/router.py::export_movements both
live-joined to the *current* Holder row for the from/to name on every read --
so a rename silently rewrote the apparent meaning of every past event
involving that holder, even though the event row itself never changed (it
can't; the ledger is append-only). from_holder_name_snapshot/
to_holder_name_snapshot are populated once, at the moment apply_event writes
the row, and are what display code now prefers."""
from datetime import datetime, timezone
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.lifecycle.models import AssetEvent
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
from app.numbering.models import CodeRule
from sqlalchemy import select


async def _setup():
    async with SessionLocal() as session:
        co = Company(code="SNAP", name="Snapshot Co")
        cat = AssetCategory(code="IT-SNAP", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(company_id=co.id, code="SNAP-HO", name="HO")
        dept = Department(name="IT-SNAP")
        vendor = Vendor(code="VND-SNAP", name="Snapshot Vendor")
        session.add_all([sub, cc, loc, dept, vendor])
        await session.flush()

        def h(code, name, holder_type, role="HOLDER", **kw):
            return Holder(company_id=co.id, emp_code=code, name=name, holder_type=holder_type,
                          location_id=loc.id, department_id=dept.id, role=role, **kw)

        stock = h("STK-SNAP", "IT Stock-HO", "IT_STOCK")
        emp = h("EMP-SNAP", "Original Name", "EMPLOYEE")
        admin = h("ADM-SNAP", "Admin", "EMPLOYEE", role="ADMIN",
                  password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([stock, emp, admin,
                         CodeRule(company_id=None, prefix_template="FA/SNAP/", suffix_template="",
                                  start_number=1, pad_width=0)])
        await session.commit()
        return co.id, cc.id, cat.id, sub.id, stock.id, emp.id, admin.id, loc.id, vendor.id


async def test_renaming_a_holder_does_not_change_a_past_events_displayed_name(client):
    co_id, cc_id, cat_id, sub_id, stock_id, emp_id, admin_id, loc_id, vendor_id = await _setup()
    resp = await client.post("/api/auth/login", json={"login_id": "ADM-SNAP", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    [asset] = (await client.post("/api/assets", json={
        "company_id": co_id, "cost_center_id": cc_id, "category_id": cat_id, "subcategory_id": sub_id,
        "description": "Snapshot Laptop", "invoice_date": "2025-01-01", "initial_holder_id": stock_id,
        "vendor_id": vendor_id, "po_number": "PO-1", "po_date": "2024-12-20",
        "invoice_number": "INV-1", "pi_number": "PI-1", "pi_date": "2024-12-25",
        "serial_number": "SN-SNAP-1",
    }, headers=headers)).json()
    asset_id = asset["id"]

    # MOVED to emp while their name is still "Original Name" -- the snapshot must
    # capture this name at write time.
    move_resp = await client.post(f"/api/assets/{asset_id}/events", json={
        "event_type": "MOVED", "to_holder_id": emp_id,
    }, headers=headers)
    assert move_resp.status_code == 201
    moved_event_id = move_resp.json()["id"]

    # Confirm the raw DB column, not just the rendered label -- this is the actual
    # persisted evidence, independent of any display-layer fallback logic.
    async with SessionLocal() as session:
        row = (await session.execute(
            select(AssetEvent).where(AssetEvent.id == moved_event_id)
        )).scalar_one()
        assert row.to_holder_name_snapshot == "Original Name"

    # Now rename the holder.
    rename_resp = await client.put(f"/api/holders/{emp_id}", json={
        "company_id": co_id, "emp_code": "EMP-SNAP", "name": "Renamed Later",
        "holder_type": "EMPLOYEE", "location_id": loc_id, "department_id": None, "role": "HOLDER",
    }, headers=headers)
    assert rename_resp.status_code == 200
    assert rename_resp.json()["name"] == "Renamed Later"

    # The already-recorded MOVED event must still display the name that was true
    # when it happened -- not the holder's new, current name.
    timeline = (await client.get(f"/api/assets/{asset_id}/events", headers=headers)).json()
    moved = next(e for e in timeline if e["id"] == moved_event_id)
    assert "Original Name" in moved["label"]
    assert "Renamed Later" not in moved["label"]

    # A NEW event recorded after the rename, by contrast, correctly snapshots the
    # holder's current (renamed) name -- proving this isn't just stale caching.
    return_resp = await client.post(f"/api/assets/{asset_id}/events", json={
        "event_type": "MOVED", "to_holder_id": stock_id,
    }, headers=headers)
    assert return_resp.status_code == 201
    async with SessionLocal() as session:
        row = (await session.execute(
            select(AssetEvent).where(AssetEvent.id == return_resp.json()["id"])
        )).scalar_one()
        assert row.from_holder_name_snapshot == "Renamed Later"


async def test_pre_migration_rows_fall_back_to_a_live_holder_name_lookup(client):
    """A row written before this migration has NULL snapshot columns (no fabricated
    backfill, per the AM-01 authorization) -- display code must still show a real
    name for it, sourced from the live Holder join exactly as before this stage.

    The append-only trigger (correctly) refuses to UPDATE an existing event row to
    simulate this, so a pre-migration row is instead simulated the only way one
    could actually exist: a direct INSERT with the snapshot columns left NULL,
    exactly as a row written before these columns existed would be (INSERT is not
    blocked -- only UPDATE/DELETE are, per 0003_assets_and_events.py's trigger)."""
    co_id, cc_id, cat_id, sub_id, stock_id, emp_id, admin_id, loc_id, vendor_id = await _setup()
    resp = await client.post("/api/auth/login", json={"login_id": "ADM-SNAP", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    [asset] = (await client.post("/api/assets", json={
        "company_id": co_id, "cost_center_id": cc_id, "category_id": cat_id, "subcategory_id": sub_id,
        "description": "Legacy Row Laptop", "invoice_date": "2025-01-01", "initial_holder_id": stock_id,
        "vendor_id": vendor_id, "po_number": "PO-2", "po_date": "2024-12-20",
        "invoice_number": "INV-2", "pi_number": "PI-2", "pi_date": "2024-12-25",
        "serial_number": "SN-SNAP-2",
    }, headers=headers)).json()
    asset_id = asset["id"]

    async with SessionLocal() as session:
        legacy_style_event = AssetEvent(
            asset_id=asset_id, event_type="MOVED", event_date=datetime(2025, 6, 1, tzinfo=timezone.utc),
            from_holder_id=stock_id, to_holder_id=emp_id,
            from_holder_name_snapshot=None, to_holder_name_snapshot=None,  # pre-migration shape
            status_after="ALLOTTED", recorded_by=admin_id,
        )
        session.add(legacy_style_event)
        await session.commit()
        legacy_event_id = legacy_style_event.id

    timeline = (await client.get(f"/api/assets/{asset_id}/events", headers=headers)).json()
    legacy = next(e for e in timeline if e["id"] == legacy_event_id)
    assert legacy["label"] != ""
    assert "unknown holder" not in legacy["label"]
    assert "Original Name" in legacy["label"]  # falls back to the live Holder.name join
