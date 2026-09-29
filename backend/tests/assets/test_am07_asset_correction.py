"""AM-07: POST /api/assets/{id}/corrections -- a controlled, reason-required
correction of Category/Subcategory/Purchase Date, deliberately separate
from PUT /api/assets/{id}. See app/assets/correction_service.py for the
invariants this enforces and why."""
from datetime import date, timedelta
import pytest
from sqlalchemy import select, text
from app.assets.models import Asset, AssetFieldChange
from app.assets.service import procure_assets
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.lifecycle.models import AssetEvent
from app.lifecycle.service import apply_event
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule


async def _setup(code="AM07"):
    async with SessionLocal() as session:
        co = Company(code=f"{code}A", name=f"{code} Co A")
        co_b = Company(code=f"{code}B", name=f"{code} Co B")
        cat = AssetCategory(code=f"CAT-{code}", name="IT Equipment")
        other_cat = AssetCategory(code=f"OCAT-{code}", name="Furniture")
        inactive_cat = AssetCategory(code=f"ICAT-{code}", name="Retired Category", is_active=False)
        session.add_all([co, co_b, cat, other_cat, inactive_cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        other_sub = AssetSubcategory(category_id=other_cat.id, code="CHAIR", name="Chair")
        inactive_sub = AssetSubcategory(category_id=cat.id, code="OLD", name="Retired Sub", is_active=False)
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(company_id=co.id, code=f"HO-{code}", name="HO")
        dept = Department(name=f"IT-{code}")
        session.add_all([sub, other_sub, inactive_sub, cc, loc, dept])
        await session.flush()
        stock = AssetUser(company_id=co.id, emp_code=f"STK-{code}", name="IT Stock-HO", asset_user_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="ASSET_USER")
        admin = AssetUser(company_id=co.id, emp_code=f"ADM-{code}", name="Admin", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_a = AssetUser(company_id=co.id, emp_code=f"ITA-{code}", name="IT A", asset_user_type="EMPLOYEE",
                      location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                      password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_b = AssetUser(company_id=co_b.id, emp_code=f"ITB-{code}", name="IT B", asset_user_type="EMPLOYEE",
                      location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                      password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer = AssetUser(company_id=co.id, emp_code=f"VWR-{code}", name="Viewer", asset_user_type="EMPLOYEE",
                         location_id=loc.id, department_id=dept.id, role="VIEWER",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        asset_user_role = AssetUser(company_id=co.id, emp_code=f"HLD-{code}", name="AssetUser Role", asset_user_type="EMPLOYEE",
                              location_id=loc.id, department_id=dept.id, role="ASSET_USER",
                              password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template=f"FA/{code}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([stock, admin, it_a, it_b, viewer, asset_user_role, rule])
        await session.commit()
        return {
            "co": co, "co_b": co_b, "cat": cat, "other_cat": other_cat, "inactive_cat": inactive_cat,
            "sub": sub, "other_sub": other_sub, "inactive_sub": inactive_sub, "cc": cc, "stock": stock,
            "admin": admin, "it_a": it_a, "it_b": it_b, "viewer": viewer, "asset_user_role": asset_user_role,
        }


async def _headers(client, emp_code):
    resp = await client.post("/api/auth/login", json={"login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _make_asset(ids, purchase_date=date(2025, 6, 1), category=None, subcategory=None):
    async with SessionLocal() as session:
        [asset] = await procure_assets(session, {
            "company_id": ids["co"].id, "cost_center_id": ids["cc"].id,
            "category_id": (category or ids["cat"]).id,
            "subcategory_id": (subcategory or ids["sub"]).id if (subcategory or ids["sub"]) else None,
            "description": "Correction Test Laptop", "purchase_date": purchase_date,
            "initial_asset_user_id": ids["stock"].id,
        }, quantity=1, actor=ids["admin"])
        await session.commit()
        await session.refresh(asset)
        return asset


async def _reload(asset_id: int) -> Asset:
    async with SessionLocal() as session:
        return await session.get(Asset, asset_id)


async def _changes(asset_id: int) -> list[AssetFieldChange]:
    async with SessionLocal() as session:
        stmt = select(AssetFieldChange).where(AssetFieldChange.asset_id == asset_id).order_by(AssetFieldChange.id)
        return list((await session.execute(stmt)).scalars().all())


class TestAuthorization:
    async def test_admin_may_correct(self, client):
        ids = await _setup("AUTH1")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "subcategory_id": ids["other_sub"].id, "reason": "wrong category",
        }, headers=headers)
        assert resp.status_code == 200, resp.text

    async def test_it_team_may_correct_in_scope_asset(self, client):
        ids = await _setup("AUTH2")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["it_a"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "subcategory_id": ids["other_sub"].id, "reason": "wrong category",
        }, headers=headers)
        assert resp.status_code == 200, resp.text

    async def test_viewer_denied(self, client):
        ids = await _setup("AUTH3")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["viewer"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "reason": "wrong category",
        }, headers=headers)
        assert resp.status_code == 403

    async def test_asset_user_denied(self, client):
        ids = await _setup("AUTH4")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["asset_user_role"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "reason": "wrong category",
        }, headers=headers)
        assert resp.status_code == 403

    async def test_cross_company_correction_denied(self, client):
        ids = await _setup("AUTH5")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["it_b"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "reason": "wrong category",
        }, headers=headers)
        assert resp.status_code == 404


class TestCategoryCorrection:
    async def test_valid_category_correction_preserves_identity_status_and_asset_user(self, client):
        ids = await _setup("CAT1")
        asset = await _make_asset(ids)
        original_code, original_status, original_asset_user = asset.asset_code, asset.status, asset.current_asset_user_id
        headers = await _headers(client, ids["admin"].emp_code)

        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "subcategory_id": ids["other_sub"].id,
            "reason": "Wrong category selected during initial entry",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["category_id"] == ids["other_cat"].id
        assert body["subcategory_id"] == ids["other_sub"].id
        assert body["asset_code"] == original_code
        assert body["status"] == original_status
        assert body["current_asset_user_id"] == original_asset_user

        reloaded = await _reload(asset.id)
        assert reloaded.asset_code == original_code
        assert reloaded.category_id == ids["other_cat"].id

    async def test_inactive_category_rejected(self, client):
        ids = await _setup("CAT2")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["inactive_cat"].id, "reason": "typo fix",
        }, headers=headers)
        assert resp.status_code == 422
        assert "not found or inactive" in resp.json()["detail"]

    async def test_nonexistent_category_rejected(self, client):
        ids = await _setup("CAT3")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": 999999, "reason": "typo fix",
        }, headers=headers)
        assert resp.status_code == 422


class TestSubcategoryCorrection:
    async def test_valid_same_category_subcategory_correction(self, client):
        ids = await _setup("SUB1")
        async with SessionLocal() as session:
            other_sub_same_cat = AssetSubcategory(category_id=ids["cat"].id, code="DESK", name="Desktop")
            session.add(other_sub_same_cat)
            await session.commit()
            await session.refresh(other_sub_same_cat)
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "subcategory_id": other_sub_same_cat.id, "reason": "Subcategory entered incorrectly",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["subcategory_id"] == other_sub_same_cat.id
        assert resp.json()["category_id"] == ids["cat"].id  # unchanged

    async def test_wrong_category_subcategory_rejected(self, client):
        ids = await _setup("SUB2")
        asset = await _make_asset(ids)  # category = ids["cat"]
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "subcategory_id": ids["other_sub"].id,  # belongs to other_cat, not cat
            "reason": "typo fix",
        }, headers=headers)
        assert resp.status_code == 422
        assert "does not belong" in resp.json()["detail"]

    async def test_clear_subcategory(self, client):
        ids = await _setup("SUB3")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "subcategory_id": None, "reason": "No subcategory applies here",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["subcategory_id"] is None

    async def test_category_change_with_valid_replacement_subcategory(self, client):
        ids = await _setup("SUB4")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "subcategory_id": ids["other_sub"].id,
            "reason": "Reclassified as furniture",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["category_id"] == ids["other_cat"].id
        assert resp.json()["subcategory_id"] == ids["other_sub"].id

    async def test_category_change_without_replacement_leaves_invalid_pair_and_is_rejected(self, client):
        ids = await _setup("SUB5")
        asset = await _make_asset(ids)  # category=cat, subcategory=sub (belongs to cat)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id,  # sub does NOT belong to other_cat
            "reason": "Reclassified as furniture",
        }, headers=headers)
        assert resp.status_code == 422
        assert "does not belong to the new category" in resp.json()["detail"]
        # Nothing committed.
        reloaded = await _reload(asset.id)
        assert reloaded.category_id == ids["cat"].id

    async def test_category_change_clearing_the_old_invalid_subcategory_succeeds(self, client):
        ids = await _setup("SUB6")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "subcategory_id": None,
            "reason": "Reclassified as furniture, no subcategory yet",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["category_id"] == ids["other_cat"].id
        assert resp.json()["subcategory_id"] is None

    async def test_inactive_subcategory_rejected(self, client):
        ids = await _setup("SUB7")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "subcategory_id": ids["inactive_sub"].id, "reason": "typo fix",
        }, headers=headers)
        assert resp.status_code == 422
        assert "not found or inactive" in resp.json()["detail"]


class TestPurchaseDateCorrection:
    async def test_valid_earlier_correction(self, client):
        ids = await _setup("PD1")
        asset = await _make_asset(ids, purchase_date=date(2025, 6, 5))
        original_code = asset.asset_code
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "purchase_date": "2025-06-01", "reason": "Purchase invoice date was mistakenly used",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["purchase_date"] == "2025-06-01"
        assert resp.json()["asset_code"] == original_code

    async def test_date_after_earliest_event_is_rejected(self, client):
        ids = await _setup("PD2")
        asset = await _make_asset(ids, purchase_date=date(2025, 6, 1))
        # The PROCURED event's event_date == 2025-06-01 (the original purchase_date).
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "purchase_date": "2025-06-10", "reason": "trying to move it later",
        }, headers=headers)
        assert resp.status_code == 422
        assert "earliest recorded event" in resp.json()["detail"]

    async def test_future_date_is_rejected(self, client):
        ids = await _setup("PD3")
        asset = await _make_asset(ids, purchase_date=date(2025, 6, 1))
        headers = await _headers(client, ids["admin"].emp_code)
        future = (date.today() + timedelta(days=30)).isoformat()
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "purchase_date": future, "reason": "typo",
        }, headers=headers)
        assert resp.status_code == 422
        assert "future" in resp.json()["detail"]

    async def test_no_historical_event_timestamps_are_changed(self, client):
        ids = await _setup("PD4")
        asset = await _make_asset(ids, purchase_date=date(2025, 6, 5))
        async with SessionLocal() as session:
            await apply_event(session, asset, "MOVED", to_asset_user_id=ids["stock"].id, actor=ids["admin"])
            await session.commit()

        async with SessionLocal() as session:
            before_events = {
                e.id: e.event_date
                for e in (await session.execute(select(AssetEvent).where(AssetEvent.asset_id == asset.id))).scalars().all()
            }

        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "purchase_date": "2025-06-01", "reason": "corrected date",
        }, headers=headers)
        assert resp.status_code == 200, resp.text

        async with SessionLocal() as session:
            after_events = {
                e.id: e.event_date
                for e in (await session.execute(select(AssetEvent).where(AssetEvent.asset_id == asset.id))).scalars().all()
            }
        assert before_events == after_events


class TestRequestValidation:
    async def test_reason_required_by_schema(self, client):
        ids = await _setup("REQ1")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id,
        }, headers=headers)
        assert resp.status_code == 422

    async def test_whitespace_only_reason_rejected(self, client):
        ids = await _setup("REQ2")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "reason": "   ",
        }, headers=headers)
        assert resp.status_code == 422
        assert "reason is required" in resp.json()["detail"]

    async def test_no_op_correction_rejected(self, client):
        ids = await _setup("REQ3")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["cat"].id, "reason": "no real change",
        }, headers=headers)
        assert resp.status_code == 422
        assert "no changes" in resp.json()["detail"]

    async def test_at_least_one_field_required(self, client):
        ids = await _setup("REQ4")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "reason": "nothing to correct",
        }, headers=headers)
        assert resp.status_code == 422
        assert "at least one" in resp.json()["detail"]


class TestAudit:
    async def test_one_row_per_changed_field_with_correct_old_new_values(self, client):
        ids = await _setup("AUD1")
        asset = await _make_asset(ids, purchase_date=date(2025, 6, 5))
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "subcategory_id": ids["other_sub"].id,
            "purchase_date": "2025-06-01", "reason": "full reclassification",
        }, headers=headers)
        assert resp.status_code == 200, resp.text

        changes = await _changes(asset.id)
        assert len(changes) == 3
        by_field = {c.field_name: c for c in changes}
        assert set(by_field) == {"category_id", "subcategory_id", "purchase_date"}
        assert ids["cat"].code in by_field["category_id"].old_value
        assert ids["other_cat"].code in by_field["category_id"].new_value
        assert ids["sub"].code in by_field["subcategory_id"].old_value
        assert ids["other_sub"].code in by_field["subcategory_id"].new_value
        assert by_field["purchase_date"].old_value == "2025-06-05"
        assert by_field["purchase_date"].new_value == "2025-06-01"
        for c in changes:
            assert c.actor_id == ids["admin"].id
            assert c.reason == "full reclassification"
        assert len({c.request_id for c in changes}) == 1

    async def test_only_actually_changed_fields_produce_rows(self, client):
        ids = await _setup("AUD2")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["cat"].id,  # same as current -- no-op for this field
            "purchase_date": "2025-05-15",  # earlier, no events yet at that exact boundary -- valid
            "reason": "only fixing the date",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        changes = await _changes(asset.id)
        assert len(changes) == 1
        assert changes[0].field_name == "purchase_date"

    async def test_ordinary_edit_rows_never_carry_a_reason(self, client):
        ids = await _setup("AUD3")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        await client.put(f"/api/assets/{asset.id}", json={"description": "edited via ordinary PUT", "brand": "Dell"}, headers=headers)
        changes = await _changes(asset.id)
        assert len(changes) >= 1
        assert all(c.reason is None for c in changes)

    async def test_failed_correction_leaves_no_audit_row_and_no_asset_change(self, client):
        ids = await _setup("AUD4")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["inactive_cat"].id, "reason": "bad category",
        }, headers=headers)
        assert resp.status_code == 422
        assert await _changes(asset.id) == []
        reloaded = await _reload(asset.id)
        assert reloaded.category_id == ids["cat"].id

    async def test_field_change_append_only_protection_still_holds(self, client):
        """AM-07 touched no trigger -- reconfirms migration a409768dc2cf's
        append-only enforcement still rejects a direct UPDATE, including on
        a row this stage's own correction endpoint wrote."""
        ids = await _setup("AUD5")
        asset = await _make_asset(ids)
        headers = await _headers(client, ids["admin"].emp_code)
        commit_resp = await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "subcategory_id": ids["other_sub"].id, "reason": "reclassify",
        }, headers=headers)
        assert commit_resp.status_code == 200, commit_resp.text
        changes = await _changes(asset.id)
        assert len(changes) == 2

        async with SessionLocal() as session:
            with pytest.raises(Exception):
                await session.execute(
                    text("UPDATE asset_field_change SET new_value = 'tampered' WHERE id = :id"),
                    {"id": changes[0].id},
                )
                await session.commit()


class TestRegression:
    async def test_ordinary_put_still_cannot_modify_category_subcategory_purchase_date(self, client):
        ids = await _setup("REG1")
        asset = await _make_asset(ids, purchase_date=date(2025, 6, 1))
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.put(f"/api/assets/{asset.id}", json={
            "description": "still just an ordinary edit",
            "category_id": ids["other_cat"].id, "subcategory_id": ids["other_sub"].id,
            "purchase_date": "2099-01-01",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        reloaded = await _reload(asset.id)
        assert reloaded.category_id == ids["cat"].id
        assert reloaded.subcategory_id == ids["sub"].id
        assert reloaded.purchase_date == date(2025, 6, 1)

    async def test_asset_code_company_cost_centre_never_change_across_several_corrections(self, client):
        ids = await _setup("REG2")
        asset = await _make_asset(ids, purchase_date=date(2025, 6, 5))
        original_code, original_company, original_cc = asset.asset_code, asset.company_id, asset.cost_center_id
        headers = await _headers(client, ids["admin"].emp_code)

        await client.post(f"/api/assets/{asset.id}/corrections", json={
            "category_id": ids["other_cat"].id, "subcategory_id": ids["other_sub"].id, "reason": "r1",
        }, headers=headers)
        await client.post(f"/api/assets/{asset.id}/corrections", json={
            "purchase_date": "2025-06-01", "reason": "r2",
        }, headers=headers)

        reloaded = await _reload(asset.id)
        assert reloaded.asset_code == original_code
        assert reloaded.company_id == original_company
        assert reloaded.cost_center_id == original_cc
