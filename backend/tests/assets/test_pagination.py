"""GET /api/assets honours limit/offset with an accurate total (the Asset Register
pages through it), and the Excel export never silently truncates."""
from datetime import date
from io import BytesIO

import openpyxl

from app.assets.service import procure_assets
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule
from app.reports import router as reports_router


async def _setup(n_assets=5, other_company_assets=2):
    async with SessionLocal() as session:
        cos = [Company(code="PGA", name="PGA Co"), Company(code="PGB", name="PGB Co")]
        cat = AssetCategory(code="IT", name="IT")
        session.add_all([*cos, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        loc = Location(code="PG-HO", name="HO")
        dept = Department(name="IT-PG")
        ccs = [CostCenter(company_id=c.id, code="HO01", name="HO") for c in cos]
        session.add_all([sub, loc, dept, *ccs])
        await session.flush()
        stocks = [Holder(company_id=c.id, emp_code=f"STK-{c.code}", name="Stock", holder_type="IT_STOCK",
                         location_id=loc.id, department_id=dept.id, role="HOLDER") for c in cos]
        it_a = Holder(company_id=cos[0].id, emp_code="ITA", name="IT A", holder_type="EMPLOYEE",
                      location_id=loc.id, department_id=dept.id, role="IT_TEAM",
                      password_hash=hash_password("Passw0rd!"), must_change_password=False)
        admin = Holder(company_id=cos[1].id, emp_code="ADM", name="Admin", holder_type="EMPLOYEE",
                       location_id=loc.id, department_id=dept.id, role="ADMIN",
                       password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([*stocks, it_a, admin,
                         CodeRule(company_id=None, prefix_template="{company.code}/", suffix_template="",
                                  start_number=1, pad_width=0)])
        await session.commit()
        for idx, count in ((0, n_assets), (1, other_company_assets)):
            await procure_assets(session, {
                "company_id": cos[idx].id, "cost_center_id": ccs[idx].id, "category_id": cat.id,
                "subcategory_id": sub.id, "description": "Laptop", "purchase_date": date(2025, 1, 1),
                "initial_holder_id": stocks[idx].id,
            }, quantity=count, actor=admin)
        await session.commit()
        return cos[0].id


async def _headers(client, company_id, emp_code="ITA"):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_limit_offset_pages_with_accurate_scoped_total(client):
    co_a = await _setup()
    headers = await _headers(client, co_a)

    pages = []
    for offset in (0, 2, 4):
        resp = await client.get(f"/api/assets?limit=2&offset={offset}", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        # Total is the full in-scope count (company A only: 5), not the page size
        # and not including company B's 2 assets.
        assert body["total"] == 5
        pages.append([a["asset_code"] for a in body["items"]])

    assert [len(p) for p in pages] == [2, 2, 1]
    flat = [code for page in pages for code in page]
    assert len(set(flat)) == 5  # no overlap between pages, nothing skipped
    assert flat == [f"PGA/{n}" for n in (5, 4, 3, 2, 1)]  # newest first

    beyond = (await client.get("/api/assets?limit=2&offset=10", headers=headers)).json()
    assert beyond == {"items": [], "total": 5}


async def test_total_respects_filters(client):
    co_a = await _setup()
    headers = await _headers(client, co_a)
    body = (await client.get("/api/assets?limit=1&q=PGA/1", headers=headers)).json()
    assert body["total"] == 1
    assert [a["asset_code"] for a in body["items"]] == ["PGA/1"]


async def test_invalid_paging_params_are_422(client):
    co_a = await _setup(n_assets=1, other_company_assets=0)
    headers = await _headers(client, co_a)
    assert (await client.get("/api/assets?offset=-1", headers=headers)).status_code == 422
    assert (await client.get("/api/assets?limit=0", headers=headers)).status_code == 422
    assert (await client.get("/api/assets?limit=201", headers=headers)).status_code == 422


async def test_export_includes_every_row_up_to_the_cap(client, monkeypatch):
    co_a = await _setup(n_assets=3, other_company_assets=0)
    headers = await _headers(client, co_a)
    monkeypatch.setattr(reports_router, "EXPORT_MAX_ROWS", 3)

    resp = await client.get("/api/reports/export/assets", headers=headers)
    assert resp.status_code == 200
    rows = list(openpyxl.load_workbook(BytesIO(resp.content)).active.iter_rows(min_row=2, values_only=True))
    assert len(rows) == 3


async def test_export_over_the_cap_is_refused_not_silently_truncated(client, monkeypatch):
    co_a = await _setup(n_assets=3, other_company_assets=0)
    headers = await _headers(client, co_a)
    monkeypatch.setattr(reports_router, "EXPORT_MAX_ROWS", 2)

    resp = await client.get("/api/reports/export/assets", headers=headers)
    assert resp.status_code == 422
    assert "3" in resp.json()["detail"] and "2" in resp.json()["detail"]


def test_export_cap_covers_the_design_target():
    # Spec §8 performance target: 20,000 assets.
    assert reports_router.EXPORT_MAX_ROWS >= 20_000
