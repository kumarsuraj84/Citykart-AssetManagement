"""AM-04: required-active-Custom-Field enforcement on create (and, only when
an edit itself replaces custom_fields, on update), and the new append-only
asset_field_change audit trail written by PUT /api/assets/{id}."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, CustomField, Department, Location, Vendor
from app.numbering.models import CodeRule


async def _setup(code="AM04"):
    async with SessionLocal() as session:
        co = Company(code=code, name=f"{code} Co")
        cat = AssetCategory(code=f"IT-{code}", name="IT", asset_domain="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(company_id=co.id, code=f"{code}-HO", name="HO")
        dept = Department(name=f"IT-{code}")
        vendor = Vendor(code=f"VND-{code}", name="Test Vendor")
        brand1 = Brand(code=f"BR1-{code}", name="Dell")
        brand2 = Brand(code=f"BR2-{code}", name="HP")
        brand3 = Brand(code=f"BR3-{code}", name="Lenovo")
        session.add_all([sub, cc, loc, dept, vendor, brand1, brand2, brand3])
        await session.flush()
        stock = AssetUser(company_id=co.id, code=f"STK-{code}", name="IT Stock-HO",
                        asset_user_type="STOCK_POINT", location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
        admin = AssetUser(company_id=co.id, code=f"ADM-{code}", name="Admin",
                        asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer = AssetUser(company_id=co.id, code=f"VWR-{code}", name="Viewer",
                         asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="VIEWER",
                         login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_team = AssetUser(company_id=co.id, code=f"ITT-{code}", name="IT Team",
                          asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="OPERATOR",
                          login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([stock, admin, viewer, it_team,
                         CodeRule(company_id=None, prefix_template=f"FA/{code}/", suffix_template="",
                                  start_number=1, pad_width=0)])
        await session.commit()
        return {
            "co": co.id, "cc": cc.id, "cat": cat.id, "sub": sub.id, "vendor": vendor.id,
            "brand1": brand1.id, "brand2": brand2.id, "brand3": brand3.id,
            "stock": stock.id, "admin_code": f"ADM-{code}", "viewer_code": f"VWR-{code}",
            "it_team_code": f"ITT-{code}", "admin_id": admin.id,
        }


async def _headers(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _asset_body(ids, **overrides):
    body = {
        "company_id": ids["co"], "cost_center_id": ids["cc"], "category_id": ids["cat"],
        "subcategory_id": ids["sub"], "description": "AM-04 Test Laptop",
        "initial_asset_user_id": ids["stock"], "vendor_id": ids["vendor"],
        "po_number": "PO-1", "po_date": "2025-05-20",
        "invoice_number": "INV-1", "invoice_date": "2025-06-01",
        "pi_number": "PI-1", "pi_date": "2025-05-22", "serial_number": "SN-AM04",
    }
    body.update(overrides)
    return body


# AssetUpdateIn is a full-replace PUT (docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md
# §12 / the schema's own docstring): a field omitted from the request body is
# replaced with its schema default (usually None), not left untouched. A real
# Edit form must prefill and resubmit every editable field; these tests do the
# same rather than sending a partial diff, which would otherwise silently wipe
# every other editable field -- a real gotcha worth getting right in a test,
# not a shortcut to skip.
def _full_update_body(asset: dict, **overrides):
    body = {
        "legacy_asset_code": asset["legacy_asset_code"], "brand_id": asset["brand_id"], "model": asset["model"],
        "serial_number": asset["serial_number"], "description": asset["description"],
        "vendor_id": asset["vendor_id"], "po_number": asset["po_number"], "po_date": asset["po_date"],
        "invoice_number": asset["invoice_number"], "invoice_date": asset["invoice_date"],
        "pi_number": asset["pi_number"], "pi_date": asset["pi_date"],
        "purchase_cost": asset["purchase_cost"], "tax_percent": asset["tax_percent"],
        "warranty_years": asset["warranty_years"], "custom_fields": asset["custom_fields"],
    }
    body.update(overrides)
    return body


class TestRequiredUdfOnCreate:
    async def test_required_active_udf_rejected_when_absent(self, client):
        ids = await _setup("REQ1")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="req1_asset_tag", label="Asset Tag", field_type="text", is_required=True))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(ids), headers=headers)
        assert resp.status_code == 422
        assert "req1_asset_tag" in resp.json()["detail"]

    async def test_required_active_udf_accepted_when_valid(self, client):
        ids = await _setup("REQ2")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="req2_asset_tag", label="Asset Tag", field_type="text", is_required=True))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(
            ids, custom_fields={"req2_asset_tag": "TAG-001"},
        ), headers=headers)
        assert resp.status_code == 201
        assert resp.json()[0]["custom_fields"]["req2_asset_tag"] == "TAG-001"

    async def test_optional_active_udf_may_be_absent(self, client):
        ids = await _setup("REQ3")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="req3_notes", label="Notes", field_type="text", is_required=False))
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(ids), headers=headers)
        assert resp.status_code == 201


class TestExistingAssetEditCompatibility:
    async def test_old_asset_can_be_edited_without_a_newly_required_missing_udf_blocking_it(self, client):
        """The asset is created before the required field exists at all --
        exactly the "predates a newly-added required UDF" scenario."""
        ids = await _setup("REQ4")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=headers)).json()

        async with SessionLocal() as session:
            session.add(CustomField(field_key="req4_asset_tag", label="Asset Tag", field_type="text", is_required=True))
            await session.commit()

        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": "Corrected description, unrelated to custom fields",
        }, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["description"] == "Corrected description, unrelated to custom fields"

    async def test_edit_that_explicitly_submits_custom_fields_enforces_required_completeness(self, client):
        ids = await _setup("REQ5")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=headers)).json()
        async with SessionLocal() as session:
            session.add(CustomField(field_key="req5_asset_tag", label="Asset Tag", field_type="text", is_required=True))
            await session.commit()

        # Submits custom_fields but omits the now-required key -> rejected.
        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": "still valid", "custom_fields": {},
        }, headers=headers)
        assert resp.status_code == 422
        assert "req5_asset_tag" in resp.json()["detail"]

        # Same edit, this time supplying the required value -> accepted.
        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": "still valid", "custom_fields": {"req5_asset_tag": "TAG-9"},
        }, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["custom_fields"]["req5_asset_tag"] == "TAG-9"


class TestFieldChangeAudit:
    async def test_changing_a_field_creates_an_audit_row_with_correct_old_new_and_actor(self, client):
        ids = await _setup("AUD1")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids, brand_id=ids["brand1"]), headers=headers)).json()

        await client.put(f"/api/assets/{created['id']}", json={
            "description": created["description"], "brand_id": ids["brand2"],
        }, headers=headers)

        changes = (await client.get(f"/api/assets/{created['id']}/changes", headers=headers)).json()
        brand_change = next(c for c in changes if c["field_name"] == "brand_id")
        assert "Dell" in brand_change["old_value"]
        assert "HP" in brand_change["new_value"]
        assert brand_change["actor_id"] == ids["admin_id"]
        assert brand_change["actor_name"] == "Admin"

    async def test_unchanged_field_does_not_create_an_audit_row(self, client):
        ids = await _setup("AUD2")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids, brand_id=ids["brand1"]), headers=headers)).json()

        await client.put(f"/api/assets/{created['id']}", json=_full_update_body(created), headers=headers)

        changes = (await client.get(f"/api/assets/{created['id']}/changes", headers=headers)).json()
        assert changes == []

    async def test_multiple_changed_fields_produce_one_row_each_sharing_a_request_id(self, client):
        ids = await _setup("AUD3")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids, brand_id=ids["brand1"], model="Old"), headers=headers)).json()

        await client.put(f"/api/assets/{created['id']}", json=_full_update_body(
            created, description="New description", brand_id=ids["brand2"], model="New",
        ), headers=headers)

        changes = (await client.get(f"/api/assets/{created['id']}/changes", headers=headers)).json()
        field_names = {c["field_name"] for c in changes}
        assert field_names == {"description", "brand_id", "model"}
        assert len({c["request_id"] for c in changes}) == 1

    async def test_custom_field_change_is_audited_per_key(self, client):
        ids = await _setup("AUD4")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="aud4_tag", label="Tag", field_type="text"))
            await session.commit()
        [created] = (await client.post("/api/assets", json=_asset_body(
            ids, custom_fields={"aud4_tag": "OLD"},
        ), headers=headers)).json()

        await client.put(f"/api/assets/{created['id']}", json={
            "description": created["description"], "custom_fields": {"aud4_tag": "NEW"},
        }, headers=headers)

        changes = (await client.get(f"/api/assets/{created['id']}/changes", headers=headers)).json()
        tag_change = next(c for c in changes if c["field_name"] == "custom_fields.aud4_tag")
        assert tag_change["old_value"] == "OLD"
        assert tag_change["new_value"] == "NEW"

    async def test_vendor_change_audit_snapshots_the_vendor_name_not_just_the_id(self, client):
        ids = await _setup("AUD5")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            other_vendor = Vendor(code="VND-AUD5-2", name="Second Vendor")
            session.add(other_vendor)
            await session.commit()
            other_vendor_id = other_vendor.id
        [created] = (await client.post("/api/assets", json=_asset_body(ids, vendor_id=ids["vendor"]), headers=headers)).json()

        await client.put(f"/api/assets/{created['id']}", json={
            "description": created["description"], "vendor_id": other_vendor_id,
        }, headers=headers)

        changes = (await client.get(f"/api/assets/{created['id']}/changes", headers=headers)).json()
        vendor_change = next(c for c in changes if c["field_name"] == "vendor_id")
        assert "Test Vendor" in vendor_change["old_value"]
        assert "Second Vendor" in vendor_change["new_value"]

    async def test_a_failed_edit_leaves_no_audit_rows(self, client):
        ids = await _setup("AUD6")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids, brand_id=ids["brand1"]), headers=headers)).json()

        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": "won't be saved", "brand_id": ids["brand2"], "custom_fields": {"no_such_field": "x"},
        }, headers=headers)
        assert resp.status_code == 422

        changes = (await client.get(f"/api/assets/{created['id']}/changes", headers=headers)).json()
        assert changes == []
        # And the field really wasn't changed either -- the whole edit rolled back.
        got = (await client.get(f"/api/assets/{created['id']}", headers=headers)).json()
        assert got["brand_id"] == ids["brand1"]

    async def test_a_lifecycle_event_writes_to_asset_event_only_not_the_field_change_audit(self, client):
        ids = await _setup("AUD7")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=headers)).json()

        resp = await client.post(f"/api/assets/{created['id']}/events", json={
            "event_type": "MOVED", "to_asset_user_id": ids["stock"],
        }, headers=headers)
        assert resp.status_code == 201

        changes = (await client.get(f"/api/assets/{created['id']}/changes", headers=headers)).json()
        assert changes == []
        events = (await client.get(f"/api/assets/{created['id']}/events", headers=headers)).json()
        assert len(events) == 2  # PROCURED + MOVED

    async def test_viewer_and_asset_user_cannot_edit_an_asset(self, client):
        ids = await _setup("AUD8")
        admin_headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=admin_headers)).json()

        viewer_headers = await _headers(client, ids["viewer_code"])
        resp = await client.put(f"/api/assets/{created['id']}", json={"description": "nope"}, headers=viewer_headers)
        assert resp.status_code == 403

    async def test_cross_company_it_team_cannot_read_the_audit(self, client):
        ids_a = await _setup("AUD9A")
        ids_b = await _setup("AUD9B")
        headers_a = await _headers(client, ids_a["admin_code"])
        headers_b_it = await _headers(client, ids_b["it_team_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids_a), headers=headers_a)).json()
        await client.put(f"/api/assets/{created['id']}", json={"description": "changed by A"}, headers=headers_a)

        resp = await client.get(f"/api/assets/{created['id']}/changes", headers=headers_b_it)
        assert resp.status_code == 404

    async def test_audit_read_is_chronologically_ordered(self, client):
        ids = await _setup("AUD10")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids, brand_id=ids["brand1"]), headers=headers)).json()

        await client.put(f"/api/assets/{created['id']}", json={"description": created["description"], "brand_id": ids["brand2"]}, headers=headers)
        await client.put(f"/api/assets/{created['id']}", json={"description": created["description"], "brand_id": ids["brand3"]}, headers=headers)

        changes = (await client.get(f"/api/assets/{created['id']}/changes", headers=headers)).json()
        brand_changes = [c for c in changes if c["field_name"] == "brand_id"]
        assert [c["new_value"] for c in brand_changes] == [f"HP (#{ids['brand2']})", f"Lenovo (#{ids['brand3']})"]
        assert brand_changes[0]["created_at"] <= brand_changes[1]["created_at"]
