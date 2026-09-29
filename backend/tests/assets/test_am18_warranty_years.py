"""AM-18: Warranty Years becomes the real input on every asset-creation
path; Warranty Upto is always server-computed from it, never typed
directly. See app.assets.service.compute_warranty_upto for the formula."""
from datetime import date
from app.assets.service import compute_warranty_upto, procure_assets
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
from app.numbering.models import CodeRule


def test_zero_warranty_years_means_warranty_upto_equals_purchase_date():
    assert compute_warranty_upto(date(2026, 4, 10), 0) == date(2026, 4, 10)


def test_positive_warranty_years_is_purchase_date_plus_years_minus_one_day():
    # The user's own worked example: 10-Apr-2026 + 3 years -> 09-Apr-2029.
    assert compute_warranty_upto(date(2026, 4, 10), 3) == date(2029, 4, 9)


def test_one_warranty_year():
    assert compute_warranty_upto(date(2025, 1, 15), 1) == date(2026, 1, 14)


def test_leap_day_purchase_date_falls_back_to_feb_28_on_a_non_leap_target_year():
    # 2024 is a leap year; 2024 + 1 = 2025 is not, so Feb 29 has no exact
    # anniversary that year -- fall back to Feb 28, then subtract a day.
    assert compute_warranty_upto(date(2024, 2, 29), 1) == date(2025, 2, 27)


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"AM18-{suffix}", name=f"AM18 Co {suffix}")
        cat = AssetCategory(code=f"AM18-{suffix}", name="IT")
        vendor = Vendor(code=f"AM18-{suffix}", name="AM18 Test Vendor")
        session.add_all([co, cat, vendor])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(code=f"AM18-{suffix}", name="HO")
        dept = Department(name=f"AM18-{suffix}")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"STK-{suffix}", name="IT Stock", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"ADM-{suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template=f"AM18/{suffix}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([stock, admin, rule])
        await session.commit()
        return {"co": co, "cc": cc, "cat": cat, "sub": sub, "vendor": vendor, "stock": stock, "admin": admin}


async def _headers(client, emp_code):
    resp = await client.post("/api/auth/login", json={"login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestProcureAssetsWarrantyComputation:
    async def test_procure_assets_computes_warranty_upto_from_warranty_years(self):
        ids = await _setup("PROC1")
        async with SessionLocal() as session:
            [asset] = await procure_assets(session, {
                "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
                "description": "Warranty Test Asset", "purchase_date": date(2026, 4, 10),
                "initial_holder_id": ids["stock"].id, "warranty_years": 3,
            }, quantity=1, actor=ids["admin"])
            await session.commit()
            assert asset.warranty_years == 3
            assert asset.warranty_upto == date(2029, 4, 9)

    async def test_procure_assets_with_zero_warranty_years(self):
        ids = await _setup("PROC2")
        async with SessionLocal() as session:
            [asset] = await procure_assets(session, {
                "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
                "description": "No Warranty Asset", "purchase_date": date(2026, 1, 1),
                "initial_holder_id": ids["stock"].id, "warranty_years": 0,
            }, quantity=1, actor=ids["admin"])
            await session.commit()
            assert asset.warranty_years == 0
            assert asset.warranty_upto == date(2026, 1, 1)

    async def test_procure_assets_without_warranty_years_key_falls_back_to_raw_warranty_upto(self):
        """Backward-compat for internal/service-level callers that predate
        this feature (existing tests building `data` directly)."""
        ids = await _setup("PROC3")
        async with SessionLocal() as session:
            [asset] = await procure_assets(session, {
                "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
                "description": "Legacy-Style Call", "purchase_date": date(2026, 1, 1),
                "initial_holder_id": ids["stock"].id, "warranty_upto": date(2030, 6, 1),
            }, quantity=1, actor=ids["admin"])
            await session.commit()
            assert asset.warranty_years is None
            assert asset.warranty_upto == date(2030, 6, 1)


class TestAddAssetApiWarrantyYears:
    async def test_add_asset_defaults_warranty_years_to_zero(self, client):
        ids = await _setup("API1")
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post("/api/assets", json={
            "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
            "subcategory_id": ids["sub"].id, "description": "No Warranty Field Sent",
            "serial_number": "AM18-API1-SN", "vendor_id": ids["vendor"].id,
            "po_number": "PO-1", "po_date": "2026-01-01",
            "invoice_number": "INV-1", "invoice_date": "2026-01-05",
            "pi_number": "PI-1", "pi_date": "2026-01-02",
            "initial_holder_id": ids["stock"].id,
        }, headers=headers)
        assert resp.status_code == 201, resp.text
        [created] = resp.json()
        assert created["warranty_years"] == 0
        assert created["warranty_upto"] == "2026-01-05"  # == invoice_date == purchase_date

    async def test_add_asset_explicit_warranty_years(self, client):
        ids = await _setup("API2")
        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.post("/api/assets", json={
            "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
            "subcategory_id": ids["sub"].id, "description": "Two Year Warranty",
            "serial_number": "AM18-API2-SN", "vendor_id": ids["vendor"].id,
            "po_number": "PO-1", "po_date": "2026-01-01",
            "invoice_number": "INV-1", "invoice_date": "2026-04-10",
            "pi_number": "PI-1", "pi_date": "2026-01-02",
            "initial_holder_id": ids["stock"].id, "warranty_years": 2,
        }, headers=headers)
        assert resp.status_code == 201, resp.text
        [created] = resp.json()
        assert created["warranty_years"] == 2
        assert created["warranty_upto"] == "2028-04-09"


class TestOrdinaryEditWarrantyYears:
    async def test_editing_without_touching_warranty_years_never_recomputes_it(self, client):
        """The legacy-safety guarantee: an asset with warranty_years=None
        (created before this feature, or via a raw internal call) must have
        its existing warranty_upto left exactly as-is by an edit that omits
        warranty (sends warranty_years=None), never silently overwritten."""
        ids = await _setup("EDIT1")
        async with SessionLocal() as session:
            [asset] = await procure_assets(session, {
                "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
                "description": "Pre-AM18 Asset", "purchase_date": date(2020, 1, 1),
                "initial_holder_id": ids["stock"].id, "warranty_upto": date(2025, 12, 31),
            }, quantity=1, actor=ids["admin"])
            await session.commit()
            asset_id = asset.id
            assert asset.warranty_years is None

        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.put(f"/api/assets/{asset_id}", json={
            "description": "Pre-AM18 Asset, description only edit",
            "warranty_years": None,
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["warranty_years"] is None
        assert body["warranty_upto"] == "2025-12-31"  # untouched

    async def test_editing_with_an_explicit_warranty_years_recomputes_warranty_upto(self, client):
        ids = await _setup("EDIT2")
        async with SessionLocal() as session:
            [asset] = await procure_assets(session, {
                "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
                "description": "To Be Warrantied", "purchase_date": date(2026, 4, 10),
                "initial_holder_id": ids["stock"].id,
            }, quantity=1, actor=ids["admin"])
            await session.commit()
            asset_id = asset.id

        headers = await _headers(client, ids["admin"].emp_code)
        resp = await client.put(f"/api/assets/{asset_id}", json={
            "description": "Now Warrantied", "warranty_years": 3,
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["warranty_years"] == 3
        assert body["warranty_upto"] == "2029-04-09"

    async def test_no_op_warranty_edit_produces_no_audit_row(self, client):
        ids = await _setup("EDIT3")
        async with SessionLocal() as session:
            [asset] = await procure_assets(session, {
                "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
                "description": "Same Warranty Twice", "purchase_date": date(2026, 4, 10),
                "initial_holder_id": ids["stock"].id, "warranty_years": 2,
            }, quantity=1, actor=ids["admin"])
            await session.commit()
            asset_id = asset.id

        headers = await _headers(client, ids["admin"].emp_code)
        await client.put(f"/api/assets/{asset_id}", json={
            "description": "Same Warranty Twice", "warranty_years": 2,
        }, headers=headers)
        changes = (await client.get(f"/api/assets/{asset_id}/changes", headers=headers)).json()
        assert not any(c["field_name"] == "warranty_years" for c in changes)
