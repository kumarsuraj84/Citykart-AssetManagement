"""AM-06: Import supports the full V1 asset data model -- every
procurement/descriptive field Add Asset supports, Quantity (multi-create
per row), and company-scoped Custom Fields via the `Custom:<field_key>`
column convention. See docs/ai/DECISIONS.md for the exact column contract
this reuses (app/imports/asset_import_service.py::ADD_TEMPLATE_COLUMNS).

AM-23: Subcategory Code/Vendor Code/Serial Number are now mandatory here
too (matching AssetCreateIn -- Add Asset's own contract), and Purchase
Date is no longer a column at all (derived from Invoice Date, else
today's date, exactly like Add Asset). `_base_row` below supplies a valid
Vendor Code and "N/A" Serial Number by default so every existing test that
doesn't care about either keeps working unchanged; tests that DO care
override them explicitly."""
import io
from datetime import date
import openpyxl
from sqlalchemy import select
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, CustomField, Department, Location, Vendor
from app.numbering.models import CodeRule

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

HEADER = [
    "Company Code", "Cost Centre Code", "Category Code", "Subcategory Code",
    "Description", "Legacy Asset Code",
    "Vendor Code", "PO Number", "PO Date", "Invoice Number", "Invoice Date", "Invoice Amount",
    "PI Number", "PI Date", "Purchase Cost", "Tax %",
    "Brand", "Model", "Serial Number", "Warranty Years",
    "Initial Holder Code", "Quantity",
]


def _xlsx(rows: list[dict], extra_headers: list[str] | None = None) -> bytes:
    header = HEADER + (extra_headers or [])
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(header)
    for row in rows:
        ws.append([row.get(h) for h in header])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _setup(code="AM06IMP"):
    async with SessionLocal() as session:
        co = Company(code=f"{code}A", name=f"{code} Co A")
        co_b = Company(code=f"{code}B", name=f"{code} Co B")
        cat = AssetCategory(code=f"CAT-{code}", name="IT")
        vendor = Vendor(code=f"VND-{code}", name="Acme Traders")
        session.add_all([co, co_b, cat, vendor])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        other_cat = AssetCategory(code=f"OTHERCAT-{code}", name="Furniture")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code=f"HO-{code}", name="HO")
        dept = Department(name=f"IT-{code}")
        session.add_all([sub, other_cat, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"STK-{code}", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        stock_b = Holder(company_id=co_b.id, emp_code=f"STKB-{code}", name="IT Stock B", holder_type="IT_STOCK",
                          location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"ADM-{code}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template=f"FA/{code}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([stock, stock_b, admin, rule])
        await session.commit()
        return {
            "a": co.id, "b": co_b.id, "a_code": co.code, "admin": f"ADM-{code}",
            "stock": f"STK-{code}", "stock_b": f"STKB-{code}",
            "cc": "HO01", "cat": cat.code, "other_cat": other_cat.code, "sub": sub.code, "vendor": vendor.code,
        }


async def _headers(client, emp_code):
    resp = await client.post("/api/auth/login", json={"login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _base_row(ids, **overrides):
    row = {
        "Company Code": ids["a_code"], "Cost Centre Code": ids["cc"], "Category Code": ids["cat"],
        "Subcategory Code": ids["sub"], "Description": "Import Test Laptop",
        # AM-23: Purchase Date is derived from Invoice Date (else today),
        # never a direct column -- rows that need a specific Purchase Date
        # for a test now set "Invoice Date" instead.
        "Invoice Date": "2025-06-01",
        "Vendor Code": ids["vendor"],
        # "N/A" (never a real value) so this default is always safe under a
        # Quantity>1 row too -- a real Serial Number can't repeat across
        # several units of the same row.
        "Serial Number": "N/A",
        "Initial Holder Code": ids["stock"],
    }
    row.update(overrides)
    return row


async def _post(client, path, content, headers):
    return await client.post(path, files={"file": ("a.xlsx", io.BytesIO(content), XLSX)}, headers=headers)


async def _assets_by_legacy(legacy_code: str) -> list[Asset]:
    async with SessionLocal() as session:
        return list((await session.execute(select(Asset).where(Asset.legacy_asset_code == legacy_code))).scalars().all())


class TestProcurementFieldSupport:
    async def test_full_procurement_row_succeeds_and_pi_number_round_trips(self, client):
        ids = await _setup("PROC1")
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{
            "Legacy Asset Code": "OLD-PROC1", "Vendor Code": ids["vendor"],
            "PO Number": "PO-1", "PO Date": "2025-05-01", "Invoice Number": "INV-1", "Invoice Date": "2025-05-02",
            "Invoice Amount": 70800,
            "PI Number": "PI-1", "PI Date": "2025-05-03", "Purchase Cost": 60000, "Tax %": 18,
            "Brand": "Dell", "Model": "Latitude 5440", "Serial Number": "SN-ABC", "Warranty Years": 3,
        })
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["imported"] == 1
        assert body["errors"] == []

        [asset] = await _assets_by_legacy("OLD-PROC1")
        assert asset.pi_number == "PI-1"
        assert asset.pi_date == date(2025, 5, 3)
        assert asset.po_number == "PO-1"
        assert asset.invoice_number == "INV-1"
        assert float(asset.invoice_amount) == 70800.0
        assert asset.brand == "Dell" and asset.model == "Latitude 5440" and asset.serial_number == "SN-ABC"
        assert asset.warranty_years == 3
        # AM-23: purchase_date is derived from Invoice Date (2025-05-02, this
        # row's own override) + 3 years, minus 1 day.
        assert asset.purchase_date == date(2025, 5, 2)
        assert asset.warranty_upto == date(2028, 5, 1)
        assert float(asset.purchase_cost) == 60000.0
        assert float(asset.tax_amount) == 10800.0
        assert float(asset.total_cost) == 70800.0
        assert asset.vendor_id is not None

    async def test_unknown_vendor_code_is_a_row_error(self, client):
        ids = await _setup("PROC2")
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-PROC2", "Vendor Code": "NOPE"})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "unknown Vendor Code" in body["errors"][0]["message"]

    async def test_po_invoice_pi_and_cost_fields_remain_optional(self, client):
        """AM-23: Vendor Code/Serial Number are now mandatory (base_row
        already supplies both), but PO/Invoice/PI Number+Date and Purchase
        Cost/Tax % stay optional -- ground reality is that paperwork often
        isn't in hand yet, same as Add Asset itself."""
        ids = await _setup("PROC3")
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-PROC3", "PO Number": None, "PI Number": None})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        assert resp.json()["imported"] == 1
        [asset] = await _assets_by_legacy("OLD-PROC3")
        assert asset.po_number is None
        assert asset.pi_number is None
        assert float(asset.purchase_cost) == 0.0


class TestCustomFieldImport:
    async def test_global_custom_field_imports(self, client):
        ids = await _setup("UDF1")
        async with SessionLocal() as session:
            session.add(CustomField(field_key="udf1_notes", label="Notes", field_type="text"))
            await session.commit()
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF1", "Custom:udf1_notes": "hello"})
        content = _xlsx([row], extra_headers=["Custom:udf1_notes"])

        resp = await _post(client, "/api/imports/assets/commit", content, headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["imported"] == 1
        [asset] = await _assets_by_legacy("OLD-UDF1")
        assert asset.custom_fields["udf1_notes"] == "hello"

    async def test_same_company_custom_field_imports(self, client):
        ids = await _setup("UDF2")
        async with SessionLocal() as session:
            session.add(CustomField(field_key="udf2_tag", label="Tag", field_type="text", company_id=ids["a"]))
            await session.commit()
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF2", "Custom:udf2_tag": "TAG-1"})
        content = _xlsx([row], extra_headers=["Custom:udf2_tag"])

        resp = await _post(client, "/api/imports/assets/commit", content, headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["imported"] == 1
        [asset] = await _assets_by_legacy("OLD-UDF2")
        assert asset.custom_fields["udf2_tag"] == "TAG-1"

    async def test_other_company_custom_field_value_is_rejected(self, client):
        ids = await _setup("UDF3")
        async with SessionLocal() as session:
            session.add(CustomField(field_key="udf3_tag", label="Tag", field_type="text", company_id=ids["b"]))
            await session.commit()
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF3", "Custom:udf3_tag": "nope"})
        content = _xlsx([row], extra_headers=["Custom:udf3_tag"])

        resp = await _post(client, "/api/imports/assets/commit", content, headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "udf3_tag" in body["errors"][0]["message"]
        assert await _assets_by_legacy("OLD-UDF3") == []

    async def test_required_global_udf_blocks_when_missing(self, client):
        ids = await _setup("UDF4")
        async with SessionLocal() as session:
            session.add(CustomField(field_key="udf4_tag", label="Tag", field_type="text", is_required=True))
            await session.commit()
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF4"})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "udf4_tag" in body["errors"][0]["message"]

    async def test_required_own_company_udf_blocks_when_missing(self, client):
        ids = await _setup("UDF5")
        async with SessionLocal() as session:
            session.add(CustomField(field_key="udf5_tag", label="Tag", field_type="text",
                                     is_required=True, company_id=ids["a"]))
            await session.commit()
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF5"})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "udf5_tag" in body["errors"][0]["message"]

    async def test_required_other_company_udf_never_blocks(self, client):
        ids = await _setup("UDF6")
        async with SessionLocal() as session:
            session.add(CustomField(field_key="udf6_tag", label="Tag", field_type="text",
                                     is_required=True, company_id=ids["b"]))
            await session.commit()
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF6"})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        assert resp.json()["imported"] == 1

    async def test_udf_type_validation_rejects_a_non_numeric_value_for_a_number_field(self, client):
        ids = await _setup("UDF7")
        async with SessionLocal() as session:
            session.add(CustomField(field_key="udf7_ram", label="RAM", field_type="number"))
            await session.commit()
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF7", "Custom:udf7_ram": "not-a-number"})
        content = _xlsx([row], extra_headers=["Custom:udf7_ram"])

        resp = await _post(client, "/api/imports/assets/commit", content, headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "udf7_ram" in body["errors"][0]["message"]

    async def test_unknown_field_key_column_is_rejected(self, client):
        ids = await _setup("UDF8")
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF8", "Custom:does_not_exist": "x"})
        content = _xlsx([row], extra_headers=["Custom:does_not_exist"])

        resp = await _post(client, "/api/imports/assets/commit", content, headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "does_not_exist" in body["errors"][0]["message"]

    async def test_inactive_field_key_column_is_rejected(self, client):
        ids = await _setup("UDF9")
        async with SessionLocal() as session:
            session.add(CustomField(field_key="udf9_tag", label="Tag", field_type="text", is_active=False))
            await session.commit()
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-UDF9", "Custom:udf9_tag": "x"})
        content = _xlsx([row], extra_headers=["Custom:udf9_tag"])

        resp = await _post(client, "/api/imports/assets/commit", content, headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "udf9_tag" in body["errors"][0]["message"]


class TestMasterLookupIntegrity:
    async def test_cross_company_holder_code_is_rejected(self, client):
        ids = await _setup("XCO1")
        headers = await _headers(client, ids["admin"])
        # stock_b belongs to company B, but the row targets company A.
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-XCO1", "Initial Holder Code": ids["stock_b"]})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "unknown Initial Holder Code" in body["errors"][0]["message"]

    async def test_subcategory_belonging_to_a_different_category_is_rejected(self, client):
        ids = await _setup("XCO2")
        headers = await _headers(client, ids["admin"])
        # "sub" belongs to ids["cat"], not ids["other_cat"].
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-XCO2", "Category Code": ids["other_cat"]})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "unknown Subcategory Code" in body["errors"][0]["message"]

    async def test_subcategory_code_is_required(self, client):
        """AM-23: Subcategory Code is now mandatory, matching
        AssetCreateIn.subcategory_id (Add Asset's own contract)."""
        ids = await _setup("XCO3")
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-XCO3", "Subcategory Code": None})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert "Subcategory Code is required" in body["errors"][0]["message"]
        assert await _assets_by_legacy("OLD-XCO3") == []


class TestQuantityAndTransactionSafety:
    async def test_quantity_creates_several_assets_with_sequential_codes(self, client):
        ids = await _setup("QTY1")
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-QTY1", "Quantity": 3})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["imported"] == 3
        assets = await _assets_by_legacy("OLD-QTY1")
        assert len(assets) == 3
        assert len({a.asset_code for a in assets}) == 3  # every code is unique

    async def test_a_quantity_rows_lifecycle_failure_rolls_back_every_unit_of_that_row(self, client):
        """A future-dated row's apply_event fails on every unit -- the whole
        row's Quantity is treated as one atomic commit unit: either all of it
        lands or none of it does, never a partial 2-of-3."""
        ids = await _setup("QTY2")
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{
            # AM-23: Purchase Date is derived from Invoice Date -- this row
            # forces a future purchase_date the same way Add Asset's own
            # Invoice Date field would.
            "Legacy Asset Code": "OLD-QTY2", "Quantity": 3, "Invoice Date": "2099-01-01",
        })
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 0
        assert len(body["errors"]) == 1
        assert "future" in body["errors"][0]["message"]
        assert await _assets_by_legacy("OLD-QTY2") == []

    async def test_preview_never_writes_to_the_database(self, client):
        ids = await _setup("PREV1")
        headers = await _headers(client, ids["admin"])
        row = _base_row(ids, **{"Legacy Asset Code": "OLD-PREV1", "Quantity": 5})
        resp = await _post(client, "/api/imports/assets/preview", _xlsx([row]), headers)
        assert resp.status_code == 200
        assert len(resp.json()["valid_rows"]) == 1
        assert await _assets_by_legacy("OLD-PREV1") == []

    async def test_two_rows_with_identical_legacy_code_po_invoice_pi_both_import_unchanged_duplicate_behavior(self, client):
        """AM-06 §14: no uniqueness rule exists for legacy code, PO/invoice/PI
        number -- confirms the pre-AM-06 lack of duplicate detection is still
        unchanged for these fields. Serial Number is the one exception now --
        see test_duplicate_serial_number_is_rejected_on_the_second_row below
        and docs/ai/DECISIONS.md."""
        ids = await _setup("DUP1")
        headers = await _headers(client, ids["admin"])
        row_a = _base_row(ids, **{
            "Legacy Asset Code": "SAME-CODE", "Serial Number": "SN-DUP1-A",
            "PO Number": "SAME-PO", "Invoice Number": "SAME-INV", "PI Number": "SAME-PI",
        })
        row_b = _base_row(ids, **{
            "Legacy Asset Code": "SAME-CODE", "Serial Number": "SN-DUP1-B",
            "PO Number": "SAME-PO", "Invoice Number": "SAME-INV", "PI Number": "SAME-PI",
        })
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row_a, row_b]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 2
        assert body["errors"] == []
        assert len(await _assets_by_legacy("SAME-CODE")) == 2

    async def test_duplicate_serial_number_is_rejected_on_the_second_row(self, client):
        """New rule (docs/ai/DECISIONS.md): Serial Number is unique across the
        whole system regardless of which path creates the asset -- Import
        included. The first row with a given real serial imports fine; a
        second row reusing it is rejected as a per-row error, leaving the
        first row's import intact (VALID-ROWS-ONLY per-row atomicity,
        unchanged)."""
        ids = await _setup("DUP2")
        headers = await _headers(client, ids["admin"])
        row_a = _base_row(ids, **{"Legacy Asset Code": "DUP2-A", "Serial Number": "SAME-SERIAL-DUP2"})
        row_b = _base_row(ids, **{"Legacy Asset Code": "DUP2-B", "Serial Number": "SAME-SERIAL-DUP2"})
        resp = await _post(client, "/api/imports/assets/commit", _xlsx([row_a, row_b]), headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["imported"] == 1
        assert len(body["errors"]) == 1
        assert "serial number" in body["errors"][0]["message"].lower()
        assert len(await _assets_by_legacy("DUP2-A")) == 1
        assert await _assets_by_legacy("DUP2-B") == []
