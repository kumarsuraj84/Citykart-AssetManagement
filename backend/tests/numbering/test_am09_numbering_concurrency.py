"""AM-09 §16: the atomic UPSERT numbering (app.numbering.service.generate_code)
is the one place a race condition would be genuinely dangerous -- two
concurrent asset-creation requests resolving to the same prefix must never
receive the same Asset Code. `client` uses an in-process ASGITransport over
the app's real pooled asyncpg engine, so N concurrent `client.post(...)`
calls via `asyncio.gather` genuinely exercise Postgres's own row-level
locking on the `code_counter` UPSERT (not a fake/serialized simulation)."""
import asyncio

from sqlalchemy import select
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
from app.numbering.models import CodeRule

CONCURRENT_REQUESTS = 20


async def _setup():
    async with SessionLocal() as session:
        co = Company(code="NCTEST", name="Numbering Concurrency Co")
        cat = AssetCategory(code="NCTEST", name="NC Category")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="SUB", name="NC Sub")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="NC-HO", name="HO")
        dept = Department(name="NC-IT")
        vendor = Vendor(code="VND-NCTEST", name="NC Vendor")
        session.add_all([sub, cc, loc, dept, vendor])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="NCSTK", name="NC Stock", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code="NCADM", name="NC Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        # Every concurrent request resolves to the IDENTICAL prefix (no
        # per-request-varying token), which is exactly the scenario that
        # would surface a race: every request contends for the same
        # code_counter row.
        rule = CodeRule(company_id=co.id, prefix_template="NC/{cost_center.code}/",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, admin, rule])
        await session.commit()
        return {"co": co, "cat": cat, "sub": sub, "cc": cc, "stock": stock, "admin": admin, "vendor": vendor}


async def test_concurrent_asset_creation_never_produces_a_duplicate_code(client):
    ids = await _setup()
    resp = await client.post("/api/auth/login", json={
        "company_id": ids["co"].id, "login_id": "NCADM", "password": "Passw0rd!",
    })
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    payload = {
        "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
        "subcategory_id": ids["sub"].id, "description": "Concurrency Test Laptop",
        "invoice_date": "2025-01-01", "initial_holder_id": ids["stock"].id,
        "vendor_id": ids["vendor"].id, "po_number": "PO-1", "po_date": "2024-12-20",
        "invoice_number": "INV-1", "pi_number": "PI-1", "pi_date": "2024-12-25",
    }

    responses = await asyncio.gather(*[
        client.post("/api/assets", json=payload, headers=headers) for _ in range(CONCURRENT_REQUESTS)
    ])

    statuses = [r.status_code for r in responses]
    assert all(s == 201 for s in statuses), f"not every concurrent request succeeded: {statuses}"

    codes = [r.json()[0]["asset_code"] for r in responses]
    assert len(codes) == CONCURRENT_REQUESTS
    assert len(set(codes)) == CONCURRENT_REQUESTS, f"duplicate Asset Code(s) allocated under concurrency: {codes}"

    # The counter itself must have advanced by exactly one per successful
    # request -- not skipped (a lost update) and not double-counted.
    numbers = sorted(int(code.rsplit("/", 1)[1]) for code in codes)
    assert numbers == list(range(1, CONCURRENT_REQUESTS + 1)), (
        f"code_counter sequence has gaps or duplicates: {numbers}"
    )

    async with SessionLocal() as session:
        result = await session.execute(select(Asset.asset_code).where(Asset.company_id == ids["co"].id))
        db_codes = [row[0] for row in result.all()]
        assert len(db_codes) == CONCURRENT_REQUESTS
        assert len(set(db_codes)) == CONCURRENT_REQUESTS, "duplicate Asset Code(s) actually persisted in the database"
