"""AM-20: the Asset Movement console -- scan a batch of assets, apply one
lifecycle action (Move/Send for Repair/Report Lost/Dispose/Sell/Scrap/
Receive from Repair/Mark Found) to all of them at once via
POST /api/assets/bulk-action. Reuses app.lifecycle.state_machine.transition
as the real authority on eligibility -- exactly as the single-asset action
buttons already do -- so an ineligible asset in the batch fails that one
item and reports why, without aborting the rest."""
from datetime import date
from app.assets.service import procure_assets
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.lifecycle.service import apply_event
from app.masters.models import AssetCategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"AM20-{suffix}", name=f"AM20 Co {suffix}")
        cat = AssetCategory(code=f"AM20-{suffix}", name="IT")
        session.add_all([co, cat])
        await session.flush()
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code=f"AM20-{suffix}", name="HO")
        dept = Department(name=f"AM20-{suffix}")
        session.add_all([cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"STK-{suffix}", name="IT Stock", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        store = Holder(company_id=co.id, emp_code=f"STR-{suffix}", name="Store", holder_type="STORE",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"ADM-{suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer = Holder(company_id=co.id, emp_code=f"VWR-{suffix}", name="Viewer", holder_type="EMPLOYEE",
                         location_id=loc.id, department_id=dept.id, role="VIEWER",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template=f"AM20/{suffix}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([stock, store, admin, viewer, rule])
        await session.commit()
        return {
            "co": co, "cc": cc, "cat": cat, "stock": stock, "store": store,
            "admin": admin, "admin_emp": f"ADM-{suffix}", "viewer_emp": f"VWR-{suffix}",
        }


async def _make_assets(ids, n, serial_prefix, status_setup=None):
    """Creates n IN_STOCK assets, optionally driving each through `status_setup`
    (an async callable given (session, asset, admin)) to reach a different
    starting status before the bulk action under test."""
    asset_ids = []
    async with SessionLocal() as session:
        admin = await session.get(Holder, ids["admin"].id)
        for i in range(n):
            [asset] = await procure_assets(session, {
                "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
                "description": "Bulk Action Laptop", "purchase_date": date(2026, 1, 1),
                "serial_number": f"{serial_prefix}-{i}", "initial_holder_id": ids["stock"].id,
            }, quantity=1, actor=admin)
            await session.commit()
            if status_setup:
                await status_setup(session, asset, admin)
                await session.commit()
            asset_ids.append(asset.id)
    return asset_ids


async def _login(client, login_id):
    resp = await client.post("/api/auth/login", json={"login_id": login_id, "password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_bulk_action_moves_several_assets_to_one_holder(client):
    ids = await _setup("BA1")
    headers = await _login(client, ids["admin_emp"])
    asset_ids = await _make_assets(ids, 3, "SN-BA1")

    resp = await client.post("/api/assets/bulk-action", json={
        "asset_ids": asset_ids, "event_type": "MOVED", "to_holder_id": ids["store"].id,
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"done": 3, "failed": []}

    for asset_id in asset_ids:
        got = (await client.get(f"/api/assets/{asset_id}", headers=headers)).json()
        assert got["current_holder_id"] == ids["store"].id
        assert got["status"] == "ALLOTTED"


async def test_bulk_action_sends_several_assets_for_repair_no_holder_needed(client):
    ids = await _setup("BA2")
    headers = await _login(client, ids["admin_emp"])
    asset_ids = await _make_assets(ids, 2, "SN-BA2")

    resp = await client.post("/api/assets/bulk-action", json={
        "asset_ids": asset_ids, "event_type": "SENT_FOR_REPAIR", "remarks": "Bulk repair batch",
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"done": 2, "failed": []}

    for asset_id in asset_ids:
        got = (await client.get(f"/api/assets/{asset_id}", headers=headers)).json()
        assert got["status"] == "UNDER_REPAIR"
        events = (await client.get(f"/api/assets/{asset_id}/events", headers=headers)).json()
        assert events[-1]["remarks"] == "Bulk repair batch"


async def test_bulk_action_reports_lost(client):
    ids = await _setup("BA3")
    headers = await _login(client, ids["admin_emp"])
    asset_ids = await _make_assets(ids, 2, "SN-BA3")

    resp = await client.post("/api/assets/bulk-action", json={
        "asset_ids": asset_ids, "event_type": "LOST",
    }, headers=headers)
    assert resp.json() == {"done": 2, "failed": []}
    for asset_id in asset_ids:
        got = (await client.get(f"/api/assets/{asset_id}", headers=headers)).json()
        assert got["status"] == "LOST"


async def test_bulk_action_partial_failure_reports_the_ineligible_asset_and_still_applies_to_the_rest(client):
    """One asset already SCRAPPED (terminal) mixed in with two eligible
    ones -- the batch must not abort, and the ineligible one's reason must
    be reported, matching the existing bulk-move's own partial-failure
    contract."""
    ids = await _setup("BA4")
    headers = await _login(client, ids["admin_emp"])
    eligible_ids = await _make_assets(ids, 2, "SN-BA4-OK")

    async def _scrap(session, asset, admin):
        await apply_event(session, asset, "SCRAPPED", to_holder_id=None, actor=admin)

    [scrapped_id] = await _make_assets(ids, 1, "SN-BA4-SCRAPPED", status_setup=_scrap)

    resp = await client.post("/api/assets/bulk-action", json={
        "asset_ids": [*eligible_ids, scrapped_id], "event_type": "LOST",
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["done"] == 2
    assert len(body["failed"]) == 1
    assert body["failed"][0]["asset_id"] == scrapped_id
    assert "terminal" in body["failed"][0]["reason"]

    for asset_id in eligible_ids:
        got = (await client.get(f"/api/assets/{asset_id}", headers=headers)).json()
        assert got["status"] == "LOST"
    still_scrapped = (await client.get(f"/api/assets/{scrapped_id}", headers=headers)).json()
    assert still_scrapped["status"] == "SCRAPPED"


async def test_bulk_action_is_blocked_for_viewer(client):
    ids = await _setup("BA5")
    headers = await _login(client, ids["admin_emp"])
    asset_ids = await _make_assets(ids, 1, "SN-BA5")

    viewer_headers = await _login(client, ids["viewer_emp"])
    resp = await client.post("/api/assets/bulk-action", json={
        "asset_ids": asset_ids, "event_type": "LOST",
    }, headers=viewer_headers)
    assert resp.status_code == 403


async def test_bulk_move_endpoint_still_works_unchanged_after_the_am20_refactor(client):
    """Regression guard: /bulk-move (Asset Register's existing bulk-move)
    shares its per-item loop with the new /bulk-action now -- confirm its
    own response shape (moved/failed, not done/failed) is untouched."""
    ids = await _setup("BA6")
    headers = await _login(client, ids["admin_emp"])
    asset_ids = await _make_assets(ids, 2, "SN-BA6")

    resp = await client.post("/api/assets/bulk-move", json={
        "asset_ids": asset_ids, "to_holder_id": ids["store"].id,
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"moved": 2, "failed": []}
