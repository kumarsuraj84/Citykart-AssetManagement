"""Round-1 review fixes for Task 23 (asset Excel import):

1. (Critical) commit_import used to precompute the bootstrap Asset.status from the
   target holder's type (e.g. ALLOTTED for an EMPLOYEE) *before* calling apply_event.
   Since apply_event's IMPORTED transition is only defined FROM IN_STOCK, any row whose
   holder wasn't IT_STOCK made apply_event raise immediately -- import only ever worked
   when every row's holder happened to be IT_STOCK. Fixed by always bootstrapping
   status="IN_STOCK" (exactly like procure_assets) and letting apply_event derive the
   real post-import status from the holder's type.
2. (Important) a LifecycleError from apply_event used to propagate out of commit_import
   uncaught, 500-ing the whole request instead of reporting a per-row error and letting
   the rest of the batch continue -- unlike every other apply_event call site in this
   codebase (e.g. app.assets.router.bulk_move). Fixed with a per-row SAVEPOINT
   (session.begin_nested()) + try/except LifecycleError.
3. (Important) a malformed purchase_date used to pass preview as "valid" and then raise
   an uncaught ValueError inside commit_import's loop. Fixed by moving date parsing into
   _validate_rows, shared by both preview_import and commit_import.
"""
import io
from datetime import date
import openpyxl
from sqlalchemy import select
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule
from app.assets.models import Asset


def _build_workbook(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["legacy_asset_code", "company_code", "cost_center_code", "category_code", "subcategory_code",
               "description", "purchase_date", "holder_emp_code"])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _seed_company(code_suffix: str):
    """Creates the shared masters + an ADMIN actor + an IT_STOCK holder for a fresh,
    uniquely-suffixed company, and returns (company, admin_holder, stock_holder)."""
    async with SessionLocal() as session:
        co = Company(code=f"CKS-{code_suffix}", name=f"Import Fix Test Co {code_suffix}")
        cat = AssetCategory(code=f"IT-{code_suffix}", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code=f"HO-{code_suffix}", name="HO")
        dept = Department(name=f"IT-{code_suffix}")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"ITSTOCK-{code_suffix}", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code=f"ITA-{code_suffix}", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        await session.refresh(co)
        await session.refresh(it_admin)
        await session.refresh(stock)
    return co, it_admin, stock


async def test_import_to_non_stock_holder_succeeds_with_allotted_status(client):
    """Finding 1: a row whose holder is EMPLOYEE (not IT_STOCK) must import
    successfully, with the resulting asset ending up ALLOTTED to that employee --
    not raise a LifecycleError from a mis-set bootstrap status."""
    co, it_admin, _stock = await _seed_company("F1")

    async with SessionLocal() as session:
        loc = (await session.execute(select(Location).where(Location.code == "HO-F1"))).scalars().first()
        dept = (await session.execute(select(Department).where(Department.name == "IT-F1"))).scalars().first()
        employee = Holder(company_id=co.id, emp_code="EMP-F1", name="Jane Employee", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="HOLDER")
        session.add(employee)
        await session.commit()
        await session.refresh(employee)

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-F1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    xlsx = _build_workbook([
        ["OLD-EMP-1", "CKS-F1", "HO01", "IT-F1", "LAP", "Legacy Laptop for Jane", "2020-01-15", "EMP-F1"],
    ])

    preview_resp = await client.post("/api/imports/assets/preview",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert preview_resp.status_code == 200
    assert len(preview_resp.json()["valid_rows"]) == 1
    assert preview_resp.json()["errors"] == []

    commit_resp = await client.post("/api/imports/assets/commit",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert commit_resp.status_code == 200
    body = commit_resp.json()
    assert body["imported"] == 1
    assert body["errors"] == []

    async with SessionLocal() as session:
        asset = (await session.execute(select(Asset).where(Asset.legacy_asset_code == "OLD-EMP-1"))).scalars().first()
        assert asset is not None
        assert asset.status == "ALLOTTED"
        assert asset.current_holder_id == employee.id
        assert asset.legacy_asset_code == "OLD-EMP-1"
        assert asset.asset_code and asset.asset_code != "OLD-EMP-1"


async def test_apply_event_failure_mid_batch_is_reported_not_500(client):
    """Finding 2: a row that fails apply_event's own validation (here: a future-dated
    row, which apply_event rejects with LifecycleError('event date cannot be in the
    future')) must show up as a per-row commit error, not crash the whole request --
    and the rest of the batch must still import."""
    co, it_admin, stock = await _seed_company("F2")

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-F2", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    xlsx = _build_workbook([
        ["OLD-FUT-1", "CKS-F2", "HO01", "IT-F2", "LAP", "Future dated laptop", "2099-01-01", "ITSTOCK-F2"],
        ["OLD-OK-1", "CKS-F2", "HO01", "IT-F2", "LAP", "Ordinary laptop", "2020-01-15", "ITSTOCK-F2"],
    ])

    preview_resp = await client.post("/api/imports/assets/preview",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert preview_resp.status_code == 200
    # Both rows are syntactically/referentially valid -- the future-date business rule
    # only surfaces once apply_event actually runs, at commit time.
    assert len(preview_resp.json()["valid_rows"]) == 2
    assert preview_resp.json()["errors"] == []

    commit_resp = await client.post("/api/imports/assets/commit",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert commit_resp.status_code == 200
    body = commit_resp.json()
    assert body["imported"] == 1
    assert len(body["errors"]) == 1
    assert body["errors"][0]["row"] == 2  # header=1, first data row=2 (the future-dated one)
    assert "future" in body["errors"][0]["message"]

    async with SessionLocal() as session:
        failed = (await session.execute(select(Asset).where(Asset.legacy_asset_code == "OLD-FUT-1"))).scalars().first()
        assert failed is None  # the savepoint rolled back the failed row's insert entirely
        ok = (await session.execute(select(Asset).where(Asset.legacy_asset_code == "OLD-OK-1"))).scalars().first()
        assert ok is not None
        assert ok.status == "IN_STOCK"


async def test_malformed_purchase_date_is_a_preview_time_row_error_not_a_commit_crash(client):
    """Finding 3: a garbage purchase_date must be reported as a row-level validation
    error at preview time (same as any other bad cell), and commit must re-report the
    same error rather than raising an uncaught ValueError / 500."""
    co, it_admin, stock = await _seed_company("F3")

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-F3", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    xlsx = _build_workbook([
        ["OLD-BADDATE-1", "CKS-F3", "HO01", "IT-F3", "LAP", "Bad date laptop", "not-a-date", "ITSTOCK-F3"],
    ])

    preview_resp = await client.post("/api/imports/assets/preview",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert preview_resp.status_code == 200
    body = preview_resp.json()
    assert body["valid_rows"] == []
    assert len(body["errors"]) == 1
    assert body["errors"][0]["row"] == 2
    assert "purchase_date" in body["errors"][0]["message"]

    commit_resp = await client.post("/api/imports/assets/commit",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert commit_resp.status_code == 200
    commit_body = commit_resp.json()
    assert commit_body["imported"] == 0
    assert len(commit_body["errors"]) == 1
    assert commit_body["errors"][0]["row"] == 2
    assert "purchase_date" in commit_body["errors"][0]["message"]

    async with SessionLocal() as session:
        asset = (await session.execute(select(Asset).where(Asset.legacy_asset_code == "OLD-BADDATE-1"))).scalars().first()
        assert asset is None
