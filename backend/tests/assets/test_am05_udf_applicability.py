"""AM-05: asset create/edit only ever sees the Custom Field definitions
"applicable" to the asset's own company -- GLOBAL (company_id IS NULL) plus
that company's own scoped fields. A field scoped to a different company must
behave as if it doesn't exist for this asset: it can't be set, can't be
required, can't block creation. See app/assets/custom_field_values.py."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, CustomField, Department, Location, Vendor
from app.numbering.models import CodeRule


async def _setup(code="AM05UDF"):
    async with SessionLocal() as session:
        a = Company(code=f"{code}A", name=f"{code} Co A")
        b = Company(code=f"{code}B", name=f"{code} Co B")
        session.add_all([a, b])
        await session.flush()
        loc = Location(company_id=a.id, code=f"{code}-HO", name="HO")
        dept = Department(name=f"IT-{code}")
        session.add_all([loc, dept])
        await session.flush()
        admin = AssetUser(company_id=a.id, code=f"ADM-{code}", name="Admin", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        stock_a = AssetUser(company_id=a.id, code=f"STK-{code}", name="IT Stock A", asset_user_type="STOCK_POINT",
                          location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
        cc_a = CostCenter(company_id=a.id, code=f"CC-{code}", name="Cost Centre A")
        cat = AssetCategory(code=f"CAT-{code}", name="Category", asset_domain="IT")
        vendor = Vendor(code=f"VND-{code}", name="Test Vendor")
        rule = CodeRule(company_id=None, prefix_template=f"FA/{code}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([admin, stock_a, cc_a, cat, vendor, rule])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        session.add(sub)
        await session.commit()
        return {
            "a": a.id, "b": b.id, "admin": f"ADM-{code}", "stock_a": stock_a.id,
            "cc_a": cc_a.id, "cat": cat.id, "sub": sub.id, "vendor": vendor.id,
        }


async def _headers(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _asset_body(ids, **overrides):
    body = {
        "company_id": ids["a"], "cost_center_id": ids["cc_a"], "category_id": ids["cat"],
        "subcategory_id": ids["sub"], "description": "AM-05 UDF Applicability Test Laptop",
        "initial_asset_user_id": ids["stock_a"], "vendor_id": ids["vendor"],
        "po_number": "PO-1", "po_date": "2025-05-20",
        "invoice_number": "INV-1", "invoice_date": "2025-06-01",
        "pi_number": "PI-1", "pi_date": "2025-05-22", "serial_number": "SN-AM05UDF",
    }
    body.update(overrides)
    return body


class TestApplicabilityOnCreate:
    async def test_global_field_is_applicable_and_accepted(self, client):
        ids = await _setup("APP1")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="app1_notes", label="Notes", field_type="text"))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(
            ids, custom_fields={"app1_notes": "hello"},
        ), headers=headers)
        assert resp.status_code == 201
        assert resp.json()[0]["custom_fields"]["app1_notes"] == "hello"

    async def test_same_company_field_is_applicable_and_accepted(self, client):
        ids = await _setup("APP2")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="app2_tag", label="Tag", field_type="text", company_id=ids["a"]))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(
            ids, custom_fields={"app2_tag": "TAG-1"},
        ), headers=headers)
        assert resp.status_code == 201
        assert resp.json()[0]["custom_fields"]["app2_tag"] == "TAG-1"

    async def test_other_company_field_is_not_applicable_and_rejected(self, client):
        ids = await _setup("APP3")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="app3_tag", label="Tag", field_type="text", company_id=ids["b"]))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(
            ids, custom_fields={"app3_tag": "TAG-1"},
        ), headers=headers)
        assert resp.status_code == 422
        assert "app3_tag" in resp.json()["detail"]

    async def test_other_company_required_field_does_not_block_creation(self, client):
        ids = await _setup("APP4")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            session.add(CustomField(
                field_key="app4_required_for_b", label="Required For B", field_type="text",
                is_required=True, company_id=ids["b"],
            ))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(ids), headers=headers)
        assert resp.status_code == 201

    async def test_global_required_field_blocks_creation_when_absent(self, client):
        ids = await _setup("APP5")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            session.add(CustomField(
                field_key="app5_required_global", label="Required Global", field_type="text", is_required=True,
            ))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(ids), headers=headers)
        assert resp.status_code == 422
        assert "app5_required_global" in resp.json()["detail"]

    async def test_same_company_required_field_blocks_creation_when_absent(self, client):
        ids = await _setup("APP6")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            session.add(CustomField(
                field_key="app6_required_a", label="Required A", field_type="text",
                is_required=True, company_id=ids["a"],
            ))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(ids), headers=headers)
        assert resp.status_code == 422
        assert "app6_required_a" in resp.json()["detail"]


class TestApplicabilityOnEdit:
    async def test_retained_value_for_a_now_other_company_field_remains_visible(self, client):
        """Mirrors the AM-04 retired-field precedent: a value entered while a
        field was applicable to this asset's company must survive even if the
        field's scope is later moved elsewhere -- an edit that doesn't touch
        custom_fields at all must not silently drop it."""
        ids = await _setup("APP7")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            field = CustomField(field_key="app7_tag", label="Tag", field_type="text")
            session.add(field)
            await session.commit()
            field_id = field.id

        [created] = (await client.post("/api/assets", json=_asset_body(
            ids, custom_fields={"app7_tag": "ORIGINAL"},
        ), headers=headers)).json()

        # Scope the field away to another company now that the asset holds a
        # value for it -- app/masters/custom_fields_router.py's
        # any_asset_has_value_for check should have already prevented this if
        # exercised through the API, but simulate the retired-field state
        # directly (mirrors how AM-04 tests an inactive-field precedent).
        async with SessionLocal() as session:
            db_field = await session.get(CustomField, field_id)
            db_field.company_id = ids["b"]
            await session.commit()

        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": "unrelated edit, custom_fields not resubmitted",
        }, headers=headers)
        assert resp.status_code == 200

        got = (await client.get(f"/api/assets/{created['id']}", headers=headers)).json()
        assert got["custom_fields"]["app7_tag"] == "ORIGINAL"

    async def test_edit_resubmitting_custom_fields_cannot_set_an_other_company_field(self, client):
        ids = await _setup("APP8")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="app8_tag", label="Tag", field_type="text", company_id=ids["b"]))
            await session.commit()
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=headers)).json()

        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": created["description"], "custom_fields": {"app8_tag": "nope"},
        }, headers=headers)
        assert resp.status_code == 422
        assert "app8_tag" in resp.json()["detail"]

    async def test_inactive_field_behavior_from_am04_remains_intact(self, client):
        """AM-04 precedent: a retired (is_active=False) field's stored value
        remains visible but the field can no longer be set to a new value or
        counted toward requiredness -- still true after AM-05's scope filter
        is layered on top of the active-field filter."""
        ids = await _setup("APP9")
        headers = await _headers(client, ids["admin"])
        async with SessionLocal() as session:
            field = CustomField(field_key="app9_tag", label="Tag", field_type="text")
            session.add(field)
            await session.commit()
            field_id = field.id

        [created] = (await client.post("/api/assets", json=_asset_body(
            ids, custom_fields={"app9_tag": "KEEP"},
        ), headers=headers)).json()

        async with SessionLocal() as session:
            db_field = await session.get(CustomField, field_id)
            db_field.is_active = False
            await session.commit()

        # Unrelated edit -- retired value still visible.
        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": "unrelated edit",
        }, headers=headers)
        assert resp.status_code == 200
        got = (await client.get(f"/api/assets/{created['id']}", headers=headers)).json()
        assert got["custom_fields"]["app9_tag"] == "KEEP"

        # Resubmitting custom_fields with a new value for the retired field is rejected.
        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": created["description"], "custom_fields": {"app9_tag": "CHANGED"},
        }, headers=headers)
        assert resp.status_code == 422
        assert "app9_tag" in resp.json()["detail"]
