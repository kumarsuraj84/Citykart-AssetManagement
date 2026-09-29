"""Closed-value integrity: 8 columns whose values are conceptually a closed
set (an enum), but are plain VARCHAR at the database level:

  asset.status                    ASSET_STATUSES   (app.assets.models)
  asset_event.event_type          EVENT_TYPES      (app.lifecycle.models)
  asset_event.status_after        ASSET_STATUSES   (derived by transition())
  holder.holder_type              HOLDER_TYPES     (app.holders.models)
  holder.role                     ROLES            (app.holders.models)
  asset_document.doc_type         DOC_TYPES        (app.documents.models)
  custom_field.field_type         FIELD_TYPES      (app.masters.models)

AM-01 found holder.holder_type, holder.role and custom_field.field_type
accepted ANY string with no validation at all (and custom_field.field_type
had no allowed-values tuple even defined). AM-02 closed all three gaps with
router-level checks, same pattern as the already-existing asset_document
.doc_type check. This file now confirms the fix (it originally documented
the gap and said "flip this assertion once fixed" -- that's what happened).

asset.status/asset_event.status_after are still never directly settable by
any API request body (only written by lifecycle.service.apply_event) -- no
client-facing input surface to test. asset_event.event_type remains only
indirectly protected (an unrecognized value can't match any status's allowed
event set, so it 422s via LifecycleError) -- also confirmed below, unchanged
from AM-01.

CHECK constraints for holder_type/role/field_type were added in AM-02
(migration 0007) once these API-level checks made 100% conformance
guaranteed going forward -- see docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md.
asset.status/event_type/status_after deliberately do NOT have CHECK
constraints -- they're the surface most likely to gain new values if a
future stage adds e.g. an approval workflow, and a same-migration CHECK
there would just have to be dropped again later."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule
from app.assets.service import procure_assets
from datetime import date


async def _company_with_admin(code):
    async with SessionLocal() as session:
        co = Company(code=code, name=f"{code} Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code=f"{code}-HO", name="HO")
        dept = Department(name=f"IT-{code}")
        session.add_all([loc, dept])
        await session.flush()
        admin = Holder(
            company_id=co.id, emp_code=f"ADM-{code}", name="Admin",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="ADMIN", password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(admin)
        await session.commit()
        return co.id, loc.id, dept.id


async def _headers(client, emp_code):
    resp = await client.post("/api/auth/login", json={"login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestHolderTypeValidated:
    async def test_an_unrecognized_holder_type_is_rejected_cleanly(self, client):
        co_id, loc_id, dept_id = await _company_with_admin("CVI1")
        headers = await _headers(client, "ADM-CVI1")
        resp = await client.post("/api/holders", json={
            "company_id": co_id, "emp_code": "BADTYPE1", "name": "Bad Type Holder",
            "holder_type": "NOT_A_REAL_TYPE", "location_id": loc_id, "department_id": dept_id,
        }, headers=headers)
        assert resp.status_code == 422
        assert "holder_type" in resp.json()["detail"]

    async def test_a_valid_holder_type_still_works(self, client):
        co_id, loc_id, dept_id = await _company_with_admin("CVI1B")
        headers = await _headers(client, "ADM-CVI1B")
        resp = await client.post("/api/holders", json={
            "company_id": co_id, "emp_code": "GOODTYPE1", "name": "Good Type Holder",
            "holder_type": "IT_STOCK", "location_id": loc_id, "department_id": dept_id,
        }, headers=headers)
        assert resp.status_code == 201


class TestHolderRoleValidated:
    async def test_an_unrecognized_role_is_rejected_cleanly(self, client):
        co_id, loc_id, dept_id = await _company_with_admin("CVI2")
        headers = await _headers(client, "ADM-CVI2")
        resp = await client.post("/api/holders", json={
            "company_id": co_id, "emp_code": "BADROLE1", "name": "Bad Role Holder",
            "holder_type": "EMPLOYEE", "location_id": loc_id, "department_id": dept_id,
            "role": "SUPER_ADMIN_GOD_MODE",
        }, headers=headers)
        assert resp.status_code == 422
        assert "role" in resp.json()["detail"]


class TestCustomFieldTypeValidated:
    async def test_an_unrecognized_field_type_is_rejected_cleanly(self, client):
        co_id, _loc_id, _dept_id = await _company_with_admin("CVI3")
        headers = await _headers(client, "ADM-CVI3")
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "not_a_real_field_type", "label": "Bad Field Type",
            "field_type": "interpretive_dance", "is_required": False, "sort_order": 0,
        }, headers=headers)
        assert resp.status_code == 422
        assert "field_type" in resp.json()["detail"]

    async def test_a_valid_field_type_still_works(self, client):
        co_id, _loc_id, _dept_id = await _company_with_admin("CVI3B")
        headers = await _headers(client, "ADM-CVI3B")
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "cvi3b_asset_tag_color", "label": "Tag Color",
            "field_type": "text", "is_required": False, "sort_order": 0,
        }, headers=headers)
        assert resp.status_code == 201


class TestEventTypeIsProtectedIndirectly:
    async def test_a_genuinely_unknown_event_type_422s_cleanly_not_500s(self, client):
        """Confirms the one closed-value field that IS effectively protected today,
        even though nothing validates it directly: transition() only ever looks up
        `_ALLOWED_EVENTS.get(current_status, set())`, so an event_type that isn't a
        member of ANY status's allowed set can never match -- it falls through to
        the same LifecycleError -> 422 path a legal-but-wrong-state event uses."""
        async with SessionLocal() as session:
            co = Company(code="CVI4", name="CVI4 Co")
            cat = AssetCategory(code="IT-CVI4", name="IT")
            session.add_all([co, cat])
            await session.flush()
            sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
            cc = CostCenter(company_id=co.id, code="HO01", name="HO")
            loc = Location(company_id=co.id, code="HO-CVI4", name="HO")
            dept = Department(name="IT-CVI4")
            session.add_all([sub, cc, loc, dept])
            await session.flush()
            stock = Holder(company_id=co.id, emp_code="STOCK-CVI4", name="IT Stock-HO",
                            holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
            admin = Holder(company_id=co.id, emp_code="ADM-CVI4", name="Admin",
                            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                            password_hash=hash_password("Passw0rd!"), must_change_password=False)
            rule = CodeRule(company_id=None, prefix_template="FA/CVI4/", suffix_template="",
                             start_number=1, pad_width=0)
            session.add_all([stock, admin, rule])
            await session.commit()
            assets = await procure_assets(session, {
                "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
                "description": "Closed-value test laptop", "purchase_date": date(2025, 1, 1),
                "initial_holder_id": stock.id,
            }, quantity=1, actor=admin)
            await session.commit()
            asset_id = assets[0].id

        headers = await _headers(client, "ADM-CVI4")
        resp = await client.post(f"/api/assets/{asset_id}/events", json={
            "event_type": "TELEPORTED",
        }, headers=headers)
        assert resp.status_code == 422
        assert resp.status_code != 500
