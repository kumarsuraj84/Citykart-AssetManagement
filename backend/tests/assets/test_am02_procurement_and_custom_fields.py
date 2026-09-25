"""AM-02: procurement field round-trip through AssetOut, the new PUT
/api/assets/{id} edit surface, and custom-field value validation.

Procurement columns (vendor_id/po_number/po_date/invoice_number/
invoice_date/pi_number/pi_date/...) and Asset.custom_fields already existed
in the model, the database, and AssetCreateIn from the original build -- AM-02
found the real gap was AssetOut never returning them, and nothing validating
values written to custom_fields against the CustomField master. This file
proves both are now fixed, and that the new PUT endpoint only ever touches
the editable descriptive subset -- never identity or lifecycle fields."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, CustomField, Department, Location, Vendor
from app.numbering.models import CodeRule


async def _setup(code="AM02"):
    async with SessionLocal() as session:
        co = Company(code=code, name=f"{code} Co")
        cat = AssetCategory(code=f"IT-{code}", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code=f"{code}-HO", name="HO")
        dept = Department(name=f"IT-{code}")
        vendor = Vendor(code=f"VND-{code}", name="Test Vendor")
        session.add_all([sub, cc, loc, dept, vendor])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"STK-{code}", name="IT Stock-HO",
                        holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        other_stock = Holder(company_id=co.id, emp_code=f"STK2-{code}", name="IT Stock-WH",
                              holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"ADM-{code}", name="Admin",
                        holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer = Holder(company_id=co.id, emp_code=f"VWR-{code}", name="Viewer",
                         holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="VIEWER",
                         password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_team = Holder(company_id=co.id, emp_code=f"ITT-{code}", name="IT Team",
                          holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                          password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([stock, other_stock, admin, viewer, it_team,
                         CodeRule(company_id=None, prefix_template=f"FA/{code}/", suffix_template="",
                                  start_number=1, pad_width=0)])
        await session.commit()
        return {
            "co": co.id, "cc": cc.id, "cat": cat.id, "sub": sub.id, "vendor": vendor.id,
            "stock": stock.id, "other_stock": other_stock.id, "admin_code": f"ADM-{code}",
            "viewer_code": f"VWR-{code}", "it_team_code": f"ITT-{code}",
        }


async def _headers(client, emp_code):
    resp = await client.post("/api/auth/login", json={"login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _asset_body(ids, **overrides):
    body = {
        "company_id": ids["co"], "cost_center_id": ids["cc"], "category_id": ids["cat"],
        "subcategory_id": ids["sub"], "description": "Procurement Test Laptop",
        "purchase_date": "2025-06-01", "initial_holder_id": ids["stock"],
        "vendor_id": ids["vendor"], "po_number": "PO-1001", "po_date": "2025-05-20",
        "invoice_number": "INV-2001", "invoice_date": "2025-05-25",
        "pi_number": "PI-3001", "pi_date": "2025-05-22",
        "brand": "Dell", "model": "Latitude 5440", "serial_number": "SN-ABC123",
        "purchase_cost": 60000, "tax_percent": 18, "warranty_upto": "2027-06-01",
    }
    body.update(overrides)
    return body


class TestProcurementFieldsRoundTrip:
    async def test_all_procurement_fields_including_pi_number_are_returned(self, client):
        ids = await _setup("PRC1")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=headers)).json()
        asset_id = created["id"]

        got = (await client.get(f"/api/assets/{asset_id}", headers=headers)).json()
        assert got["pi_number"] == "PI-3001"
        assert got["pi_date"] == "2025-05-22"
        assert got["invoice_number"] == "INV-2001"
        assert got["invoice_date"] == "2025-05-25"
        assert got["po_number"] == "PO-1001"
        assert got["po_date"] == "2025-05-20"
        assert got["vendor_id"] == ids["vendor"]
        assert got["brand"] == "Dell"
        assert got["model"] == "Latitude 5440"
        assert got["serial_number"] == "SN-ABC123"
        assert got["warranty_upto"] == "2027-06-01"
        assert got["category_id"] == ids["cat"]
        assert got["cost_center_id"] == ids["cc"]
        assert got["subcategory_id"] == ids["sub"]
        # Purchase Date is always derived from Invoice Date now (never from
        # the client-sent "purchase_date", which _asset_body still sends but
        # which the router silently ignores) -- so status_since mirrors the
        # invoice date sent above, not the inert purchase_date value.
        assert got["status_since"] == "2025-05-25"
        assert got["custom_fields"] == {}
        # Also present on the register listing, not just single-asset GET.
        listed = (await client.get("/api/assets", headers=headers)).json()
        assert listed["items"][0]["pi_number"] == "PI-3001"

    async def test_descriptive_fields_are_optional_the_procurement_identity_fields_are_not(self, client):
        """Category/Sub-Category/Vendor/PO No+Date/Invoice No+Date/PI No+Date
        are mandatory on direct creation (see AssetCreateIn's docstring /
        DECISIONS.md); the still-optional subset is the purely descriptive
        extras -- brand/model/serial_number/purchase_cost/tax_percent/
        warranty_upto/legacy_asset_code/custom_fields."""
        ids = await _setup("PRC2")
        headers = await _headers(client, ids["admin_code"])
        minimal = {
            "company_id": ids["co"], "cost_center_id": ids["cc"], "category_id": ids["cat"],
            "subcategory_id": ids["sub"], "description": "Bare Minimum Asset",
            "initial_holder_id": ids["stock"], "vendor_id": ids["vendor"],
            "po_number": "PO-2001", "po_date": "2025-05-20",
            "invoice_number": "INV-2002", "invoice_date": "2025-06-01",
            "pi_number": "PI-3002", "pi_date": "2025-05-22",
        }
        resp = await client.post("/api/assets", json=minimal, headers=headers)
        assert resp.status_code == 201
        assert resp.json()[0]["brand"] is None


class TestAssetUpdate:
    async def test_put_updates_only_the_editable_descriptive_subset(self, client):
        ids = await _setup("UPD1")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=headers)).json()
        asset_id = created["id"]

        resp = await client.put(f"/api/assets/{asset_id}", json={
            "description": "Updated Description", "brand": "HP", "model": "EliteBook",
            "serial_number": "SN-NEW999", "barcode": "BC-NEW999", "pi_number": "PI-9999", "pi_date": "2025-07-01",
            "invoice_number": "INV-9999", "invoice_date": "2025-07-02",
            "po_number": "PO-9999", "po_date": "2025-06-30",
            "vendor_id": ids["vendor"], "purchase_cost": 70000, "tax_percent": 18,
            "warranty_upto": "2028-01-01", "custom_fields": {},
        }, headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["description"] == "Updated Description"
        assert body["brand"] == "HP"
        assert body["barcode"] == "BC-NEW999"
        assert body["pi_number"] == "PI-9999"
        assert body["purchase_cost"] == 70000
        assert body["tax_amount"] == 12600.0  # 70000 * 18%
        assert body["total_cost"] == 82600.0

    async def test_put_cannot_change_identity_or_lifecycle_fields(self, client):
        """asset_code/company_id/cost_center_id/category_id/status/current_holder_id
        aren't in AssetUpdateIn at all -- sending them is simply ignored (Pydantic's
        default behaviour for a field it doesn't declare), not partially honoured."""
        ids = await _setup("UPD2")
        headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=headers)).json()
        asset_id = created["id"]
        original_code = created["asset_code"]

        resp = await client.put(f"/api/assets/{asset_id}", json={
            "description": "Still just a description update",
            "asset_code": "HACKED-CODE", "company_id": 999999, "cost_center_id": 999999,
            "category_id": 999999, "status": "DISPOSED", "current_holder_id": ids["other_stock"],
        }, headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["asset_code"] == original_code
        assert body["company_id"] == ids["co"]
        assert body["cost_center_id"] == ids["cc"]
        assert body["category_id"] == ids["cat"]
        assert body["status"] == "IN_STOCK"
        assert body["current_holder_id"] == ids["stock"]

    async def test_viewer_cannot_update_an_asset(self, client):
        ids = await _setup("UPD3")
        admin_headers = await _headers(client, ids["admin_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=admin_headers)).json()
        viewer_headers = await _headers(client, ids["viewer_code"])
        resp = await client.put(f"/api/assets/{created['id']}", json={"description": "nope"}, headers=viewer_headers)
        assert resp.status_code == 403

    async def test_updating_an_asset_from_another_company_is_404_not_leaked(self, client):
        """ADMIN is a global role in this system (unrestricted across every
        company by design -- scoped_company_ids returns None for ADMIN), so
        this specifically needs IT_TEAM, which IS company-scoped, to actually
        exercise the cross-company check."""
        ids_a = await _setup("UPD4A")
        ids_b = await _setup("UPD4B")
        headers_a = await _headers(client, ids_a["admin_code"])
        headers_b_it = await _headers(client, ids_b["it_team_code"])
        [created] = (await client.post("/api/assets", json=_asset_body(ids_a), headers=headers_a)).json()
        resp = await client.put(f"/api/assets/{created['id']}", json={"description": "cross-company edit"}, headers=headers_b_it)
        assert resp.status_code == 404


class TestCustomFieldValueValidation:
    async def test_valid_values_of_every_supported_type_are_accepted(self, client):
        ids = await _setup("CFV1")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            session.add_all([
                CustomField(field_key="cfv1_notes", label="Notes", field_type="text"),
                CustomField(field_key="cfv1_ram_gb", label="RAM (GB)", field_type="number"),
                CustomField(field_key="cfv1_delivered_on", label="Delivered On", field_type="date"),
                CustomField(field_key="cfv1_is_refurbished", label="Refurbished?", field_type="checkbox"),
                CustomField(field_key="cfv1_color", label="Color", field_type="dropdown",
                            options={"choices": ["Black", "Silver"]}),
            ])
            await session.commit()

        resp = await client.post("/api/assets", json=_asset_body(ids, custom_fields={
            "cfv1_notes": "Handle with care", "cfv1_ram_gb": 16, "cfv1_delivered_on": "2025-06-05",
            "cfv1_is_refurbished": False, "cfv1_color": "Black",
        }), headers=headers)
        assert resp.status_code == 201
        assert resp.json()[0]["custom_fields"]["cfv1_color"] == "Black"

    async def test_unknown_field_key_is_rejected(self, client):
        ids = await _setup("CFV2")
        headers = await _headers(client, ids["admin_code"])
        resp = await client.post("/api/assets", json=_asset_body(ids, custom_fields={
            "no_such_field": "whatever",
        }), headers=headers)
        assert resp.status_code == 422
        assert "no_such_field" in resp.json()["detail"]

    async def test_wrong_type_for_a_number_field_is_rejected(self, client):
        ids = await _setup("CFV3")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="cfv3_ram_gb", label="RAM (GB)", field_type="number"))
            await session.commit()
        resp = await client.post("/api/assets", json=_asset_body(ids, custom_fields={
            "cfv3_ram_gb": "sixteen",
        }), headers=headers)
        assert resp.status_code == 422
        assert "cfv3_ram_gb" in resp.json()["detail"]

    async def test_dropdown_value_outside_its_options_is_rejected(self, client):
        ids = await _setup("CFV4")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="cfv4_color", label="Color", field_type="dropdown",
                                     options={"choices": ["Black", "Silver"]}))
            await session.commit()
        resp = await client.post("/api/assets", json=_asset_body(ids, custom_fields={
            "cfv4_color": "Paisley",
        }), headers=headers)
        assert resp.status_code == 422
        assert "cfv4_color" in resp.json()["detail"]

    async def test_an_inactive_field_definition_rejects_new_values(self, client):
        ids = await _setup("CFV5")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            field = CustomField(field_key="cfv5_notes", label="Notes", field_type="text")
            session.add(field)
            await session.commit()
            field_id = field.id
        deactivate = await client.delete(f"/api/masters/custom-fields/{field_id}", headers=headers)
        assert deactivate.status_code == 204

        resp = await client.post("/api/assets", json=_asset_body(ids, custom_fields={
            "cfv5_notes": "should not be allowed on a deactivated field",
        }), headers=headers)
        assert resp.status_code == 422

    async def test_put_also_validates_custom_field_values(self, client):
        ids = await _setup("CFV6")
        headers = await _headers(client, ids["admin_code"])
        async with SessionLocal() as session:
            session.add(CustomField(field_key="cfv6_ram_gb", label="RAM (GB)", field_type="number"))
            await session.commit()
        [created] = (await client.post("/api/assets", json=_asset_body(ids), headers=headers)).json()

        resp = await client.put(f"/api/assets/{created['id']}", json={
            "description": "still valid", "custom_fields": {"cfv6_ram_gb": "not-a-number"},
        }, headers=headers)
        assert resp.status_code == 422
