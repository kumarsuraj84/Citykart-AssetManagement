"""AM-05: CustomField.company_id (Global vs. company-specific scope),
scope-mutation authorization, and field_key/field_type/scope immutability.
Asset-side applicability (which definitions actually apply when creating/
editing an asset) is covered separately in
tests/assets/test_am05_udf_applicability.py."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Location, Department, Vendor
from app.numbering.models import CodeRule


async def _setup(code="AM05CF"):
    async with SessionLocal() as session:
        a = Company(code=f"{code}A", name=f"{code} Co A")
        b = Company(code=f"{code}B", name=f"{code} Co B")
        session.add_all([a, b])
        await session.flush()
        loc = Location(company_id=a.id, code=f"{code}-HO", name="HO")
        loc_b = Location(company_id=b.id, code=f"{code}-HOB", name="HO B")
        dept = Department(name=f"IT-{code}")
        session.add_all([loc, loc_b, dept])
        await session.flush()
        admin = AssetUser(company_id=a.id, emp_code=f"ADM-{code}", name="Admin", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_a = AssetUser(company_id=a.id, emp_code=f"ITA-{code}", name="IT A", asset_user_type="EMPLOYEE",
                       location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                       password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_b = AssetUser(company_id=b.id, emp_code=f"ITB-{code}", name="IT B", asset_user_type="EMPLOYEE",
                       location_id=loc_b.id, department_id=dept.id, role="IT_TEAM",
                       password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer_a = AssetUser(company_id=a.id, emp_code=f"VWA-{code}", name="Viewer A", asset_user_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="VIEWER",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        stock_a = AssetUser(company_id=a.id, emp_code=f"STK-{code}", name="IT Stock", asset_user_type="IT_STOCK",
                          location_id=loc.id, department_id=dept.id, role="ASSET_USER")
        cc = CostCenter(company_id=a.id, code=f"CC-{code}", name="Cost Centre")
        cat = AssetCategory(code=f"CAT-{code}", name="Category")
        vendor = Vendor(code=f"VND-{code}", name="Test Vendor")
        rule = CodeRule(company_id=None, prefix_template=f"FA/{code}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([admin, it_a, it_b, viewer_a, stock_a, cc, cat, vendor, rule])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        session.add(sub)
        await session.commit()
        return {
            "a": a.id, "b": b.id, "admin": f"ADM-{code}", "it_a": f"ITA-{code}",
            "it_b": f"ITB-{code}", "viewer_a": f"VWA-{code}", "stock_a": stock_a.id,
            "cc": cc.id, "cat": cat.id, "sub": sub.id, "vendor": vendor.id,
        }


async def _headers(client, emp_code):
    resp = await client.post("/api/auth/login", json={"login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestScopeCreationAuthorization:
    async def test_admin_may_create_a_global_field(self, client):
        ids = await _setup("CRG1")
        headers = await _headers(client, ids["admin"])
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "crg1_notes", "label": "Notes", "field_type": "text",
        }, headers=headers)
        assert resp.status_code == 201
        assert resp.json()["company_id"] is None

    async def test_admin_may_create_a_company_specific_field(self, client):
        ids = await _setup("CRG2")
        headers = await _headers(client, ids["admin"])
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "crg2_notes", "label": "Notes", "field_type": "text", "company_id": ids["a"],
        }, headers=headers)
        assert resp.status_code == 201
        assert resp.json()["company_id"] == ids["a"]

    async def test_it_team_cannot_create_a_global_field(self, client):
        ids = await _setup("CRG3")
        headers = await _headers(client, ids["it_a"])
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "crg3_notes", "label": "Notes", "field_type": "text",
        }, headers=headers)
        assert resp.status_code == 403

    async def test_it_team_may_create_a_field_for_its_own_company(self, client):
        ids = await _setup("CRG4")
        headers = await _headers(client, ids["it_a"])
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "crg4_notes", "label": "Notes", "field_type": "text", "company_id": ids["a"],
        }, headers=headers)
        assert resp.status_code == 201

    async def test_it_team_cannot_create_a_field_for_another_company(self, client):
        ids = await _setup("CRG5")
        headers = await _headers(client, ids["it_a"])
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "crg5_notes", "label": "Notes", "field_type": "text", "company_id": ids["b"],
        }, headers=headers)
        assert resp.status_code == 403

    async def test_viewer_cannot_create_any_custom_field(self, client):
        ids = await _setup("CRG6")
        headers = await _headers(client, ids["viewer_a"])
        resp = await client.post("/api/masters/custom-fields", json={
            "field_key": "crg6_notes", "label": "Notes", "field_type": "text",
        }, headers=headers)
        assert resp.status_code == 403

    async def test_duplicate_field_key_is_rejected_cleanly(self, client):
        ids = await _setup("CRG7")
        headers = await _headers(client, ids["admin"])
        body = {"field_key": "crg7_notes", "label": "Notes", "field_type": "text"}
        assert (await client.post("/api/masters/custom-fields", json=body, headers=headers)).status_code == 201
        dup = await client.post("/api/masters/custom-fields", json=body, headers=headers)
        assert dup.status_code == 422
        assert "crg7_notes" in dup.json()["detail"]


class TestImmutability:
    async def test_field_key_cannot_be_changed_via_edit(self, client):
        ids = await _setup("IMM1")
        headers = await _headers(client, ids["admin"])
        created = (await client.post("/api/masters/custom-fields", json={
            "field_key": "imm1_notes", "label": "Notes", "field_type": "text",
        }, headers=headers)).json()

        # AssetUpdateIn-style: field_key isn't declared in CustomFieldEditIn at
        # all, so sending it is simply ignored, not partially honoured.
        resp = await client.put(f"/api/masters/custom-fields/{created['id']}", json={
            "field_key": "hacked_key", "label": "New Label", "is_required": False, "sort_order": 0,
        }, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["field_key"] == "imm1_notes"
        assert resp.json()["label"] == "New Label"

    async def test_field_type_cannot_be_changed_via_edit(self, client):
        ids = await _setup("IMM2")
        headers = await _headers(client, ids["admin"])
        created = (await client.post("/api/masters/custom-fields", json={
            "field_key": "imm2_ram", "label": "RAM", "field_type": "number",
        }, headers=headers)).json()

        resp = await client.put(f"/api/masters/custom-fields/{created['id']}", json={
            "field_type": "text", "label": "RAM", "is_required": False, "sort_order": 0,
        }, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["field_type"] == "number"

    async def test_label_required_flag_and_sort_order_are_editable(self, client):
        ids = await _setup("IMM3")
        headers = await _headers(client, ids["admin"])
        created = (await client.post("/api/masters/custom-fields", json={
            "field_key": "imm3_notes", "label": "Notes", "field_type": "text",
        }, headers=headers)).json()

        resp = await client.put(f"/api/masters/custom-fields/{created['id']}", json={
            "label": "Internal Notes", "is_required": True, "sort_order": 5,
        }, headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["label"] == "Internal Notes"
        assert body["is_required"] is True
        assert body["sort_order"] == 5


class TestScopeMutationRules:
    async def test_scope_can_be_changed_while_no_asset_has_a_value_for_it(self, client):
        ids = await _setup("SCM1")
        headers = await _headers(client, ids["admin"])
        created = (await client.post("/api/masters/custom-fields", json={
            "field_key": "scm1_notes", "label": "Notes", "field_type": "text",
        }, headers=headers)).json()

        resp = await client.put(f"/api/masters/custom-fields/{created['id']}", json={
            "label": "Notes", "is_required": False, "sort_order": 0, "company_id": ids["a"],
        }, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["company_id"] == ids["a"]

    async def test_scope_cannot_be_changed_once_an_asset_has_a_value_for_it(self, client):
        ids = await _setup("SCM2")
        headers = await _headers(client, ids["admin"])
        field = (await client.post("/api/masters/custom-fields", json={
            "field_key": "scm2_notes", "label": "Notes", "field_type": "text",
        }, headers=headers)).json()

        create_resp = await client.post("/api/assets", json={
            "company_id": ids["a"], "cost_center_id": ids["cc"], "category_id": ids["cat"],
            "subcategory_id": ids["sub"], "description": "Scoped UDF Test Laptop",
            "invoice_date": "2025-06-01",
            "initial_asset_user_id": ids["stock_a"], "custom_fields": {"scm2_notes": "has a value"},
            "vendor_id": ids["vendor"], "po_number": "PO-1", "po_date": "2025-05-20",
            "invoice_number": "INV-1", "pi_number": "PI-1", "pi_date": "2025-05-22",
            "serial_number": "SN-SCM2",
        }, headers=headers)
        assert create_resp.status_code == 201

        resp = await client.put(f"/api/masters/custom-fields/{field['id']}", json={
            "label": "Notes", "is_required": False, "sort_order": 0, "company_id": ids["a"],
        }, headers=headers)
        assert resp.status_code == 422
        assert "scm2_notes" in resp.json()["detail"]

    async def test_it_team_cannot_move_a_field_to_another_company_even_if_scope_is_otherwise_free(self, client):
        ids = await _setup("SCM3")
        admin_headers = await _headers(client, ids["admin"])
        it_a_headers = await _headers(client, ids["it_a"])
        created = (await client.post("/api/masters/custom-fields", json={
            "field_key": "scm3_notes", "label": "Notes", "field_type": "text", "company_id": ids["a"],
        }, headers=admin_headers)).json()

        resp = await client.put(f"/api/masters/custom-fields/{created['id']}", json={
            "label": "Notes", "is_required": False, "sort_order": 0, "company_id": ids["b"],
        }, headers=it_a_headers)
        assert resp.status_code == 403

    async def test_it_team_cannot_manage_a_global_field_at_all(self, client):
        ids = await _setup("SCM4")
        admin_headers = await _headers(client, ids["admin"])
        it_a_headers = await _headers(client, ids["it_a"])
        created = (await client.post("/api/masters/custom-fields", json={
            "field_key": "scm4_notes", "label": "Notes", "field_type": "text",
        }, headers=admin_headers)).json()

        resp = await client.put(f"/api/masters/custom-fields/{created['id']}", json={
            "label": "changed", "is_required": False, "sort_order": 0,
        }, headers=it_a_headers)
        assert resp.status_code == 403

        deactivate = await client.delete(f"/api/masters/custom-fields/{created['id']}", headers=it_a_headers)
        assert deactivate.status_code == 403

    async def test_it_team_cannot_manage_another_companys_field(self, client):
        ids = await _setup("SCM5")
        admin_headers = await _headers(client, ids["admin"])
        it_b_headers = await _headers(client, ids["it_b"])
        created = (await client.post("/api/masters/custom-fields", json={
            "field_key": "scm5_notes", "label": "Notes", "field_type": "text", "company_id": ids["a"],
        }, headers=admin_headers)).json()

        resp = await client.put(f"/api/masters/custom-fields/{created['id']}", json={
            "label": "changed", "is_required": False, "sort_order": 0, "company_id": ids["a"],
        }, headers=it_b_headers)
        assert resp.status_code == 403
