"""AM-01 closed-value integrity review.

CKAM has 8 columns whose values are conceptually a closed set (an enum), but
which are plain VARCHAR at the database level with no CHECK constraint or
Postgres ENUM type -- the allowed values live only as Python tuples:

  asset.status                    ASSET_STATUSES        (app.assets.models)
  asset_event.event_type          EVENT_TYPES            (app.lifecycle.models)
  asset_event.status_after        ASSET_STATUSES         (derived by transition())
  holder.holder_type              HOLDER_TYPES           (app.holders.models)
  holder.role                     ROLES                  (app.holders.models)
  asset_document.doc_type         DOC_TYPES               (app.documents.models)
  custom_field.field_type         (no tuple defined at all -- see below)

This file documents, per field, whether an API caller can currently submit an
unrecognized value and what happens. It intentionally does NOT add validation
where none exists -- per the AM-01 authorization, closing these gaps (Pydantic
Literal, router-level checks, or DB CHECK constraints) is proposed separately
in the AM-01 report, not silently applied here.

Findings, one test class per field:

- asset_document.doc_type: ALREADY VALIDATED (documents/router.py checks
  `doc_type not in DOC_TYPES` -> 422) with its own existing test,
  test_invalid_doc_type_is_rejected_cleanly in tests/documents/test_router.py.
  Not duplicated here.
- asset_event.event_type: INDIRECTLY protected -- transition() looks up
  `_ALLOWED_EVENTS.get(current_status, set())`; an unrecognized event_type is
  never a member of any status's allowed set, so it cleanly 422s via
  LifecycleError. Confirmed below (no prior test asserted this for a
  genuinely unknown string, only for known-event-wrong-state cases).
- holder.holder_type, holder.role: NOT validated anywhere -- HOLDER_TYPES/
  ROLES exist as tuples in app/holders/models.py but neither
  app/holders/router.py nor app/holders/service.py ever checks an incoming
  value against them. Confirmed as a real gap below.
- custom_field.field_type: NOT validated anywhere, and no tuple exists to
  validate against -- only a code comment (`# text|number|date|dropdown|
  checkbox`) documents the intended values. Confirmed as a real gap below.
- asset.status: never directly settable by any API request body (only
  written by lifecycle.service.apply_event, itself constrained to values
  transition() can return) -- there is no client-facing input surface to
  test here at all.
"""
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
        loc = Location(code=f"{code}-HO", name="HO")
        dept = Department(name=f"IT-{code}")
        session.add_all([co, loc, dept])
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


class TestHolderTypeNotValidated:
    async def test_an_unrecognized_holder_type_is_currently_accepted(self, client):
        """Documents the gap: HOLDER_TYPES = ("EMPLOYEE","STORE","INSTALLED","IT_STOCK")
        exists in app/holders/models.py but is never checked. This test asserts
        TODAY's actual (permissive) behavior -- if it starts failing because someone
        added real validation, that's the gap being closed, not a regression; update
        this test to assert the 422 at that point instead."""
        co_id, loc_id, dept_id = await _company_with_admin("CVI1")
        headers = await _headers(client, "ADM-CVI1")
        resp = await client.post("/api/holders", json={
            "company_id": co_id, "emp_code": "BADTYPE1", "name": "Bad Type Holder",
            "holder_type": "NOT_A_REAL_TYPE", "location_id": loc_id, "department_id": dept_id,
        }, headers=headers)
        assert resp.status_code == 201, (
            "holder_type is currently unvalidated at both the Pydantic and service "
            "layers -- if this now 422s, HOLDER_TYPES validation has been added; "
            "flip this assertion and remove the gap note in the AM-01 report."
        )
        assert resp.json()["holder_type"] == "NOT_A_REAL_TYPE"


class TestHolderRoleNotValidated:
    async def test_an_unrecognized_role_is_currently_accepted(self, client):
        """Same gap as holder_type: ROLES = ("ADMIN","IT_TEAM","VIEWER","HOLDER") is
        defined but never checked against an incoming value."""
        co_id, loc_id, dept_id = await _company_with_admin("CVI2")
        headers = await _headers(client, "ADM-CVI2")
        resp = await client.post("/api/holders", json={
            "company_id": co_id, "emp_code": "BADROLE1", "name": "Bad Role Holder",
            "holder_type": "EMPLOYEE", "location_id": loc_id, "department_id": dept_id,
            "role": "SUPER_ADMIN_GOD_MODE",
        }, headers=headers)
        assert resp.status_code == 201, (
            "role is currently unvalidated -- if this now 422s, ROLES validation "
            "has been added; flip this assertion and remove the gap note."
        )
        assert resp.json()["role"] == "SUPER_ADMIN_GOD_MODE"


class TestCustomFieldTypeNotValidated:
    async def test_an_unrecognized_field_type_is_currently_accepted(self, client):
        """No tuple of allowed field_type values even exists in code (only a comment:
        `# text|number|date|dropdown|checkbox` in app/masters/models.py) -- this is
        the least-protected of the closed-value fields."""
        co_id, _loc_id, _dept_id = await _company_with_admin("CVI3")
        headers = await _headers(client, "ADM-CVI3")
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "not_a_real_field_type", "label": "Bad Field Type",
            "field_type": "interpretive_dance", "is_required": False, "sort_order": 0,
        }, headers=headers)
        assert resp.status_code == 201, (
            "field_type is currently unvalidated, and no allowed-values list even "
            "exists to validate against -- if this now 422s, that has changed; "
            "flip this assertion and remove the gap note."
        )
        assert resp.json()["field_type"] == "interpretive_dance"


class TestEventTypeIsProtectedIndirectly:
    async def test_a_genuinely_unknown_event_type_422s_cleanly_not_500s(self, client):
        """Confirms the one closed-value field that IS effectively protected today,
        even though nothing validates it directly: transition() only ever looks up
        `_ALLOWED_EVENTS.get(current_status, set())`, so an event_type that isn't a
        member of ANY status's allowed set can never match -- it falls through to
        the same LifecycleError -> 422 path a legal-but-wrong-state event uses.
        No prior test asserted this for a value that isn't even a known EVENT_TYPES
        member (only for real event types used from the wrong status)."""
        async with SessionLocal() as session:
            co = Company(code="CVI4", name="CVI4 Co")
            cat = AssetCategory(code="IT-CVI4", name="IT")
            session.add_all([co, cat])
            await session.flush()
            sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
            cc = CostCenter(company_id=co.id, code="HO01", name="HO")
            loc = Location(code="HO-CVI4", name="HO")
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
