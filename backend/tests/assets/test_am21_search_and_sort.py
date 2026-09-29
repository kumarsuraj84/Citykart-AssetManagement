"""AM-21: GET /api/assets gains sort_by/sort_dir (a whitelisted set of real
Asset columns, never a raw client-supplied identifier used directly), and
the free-text search box now also covers Barcode/Brand/Model."""
from datetime import date
from app.assets.service import procure_assets
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"AM21-{suffix}", name=f"AM21 Co {suffix}")
        cat = AssetCategory(code=f"AM21-{suffix}", name="IT")
        session.add_all([co, cat])
        await session.flush()
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code=f"AM21-{suffix}", name="HO")
        dept = Department(name=f"AM21-{suffix}")
        session.add_all([cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"STK-{suffix}", name="IT Stock", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"ADM-{suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template=f"AM21/{suffix}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([stock, admin, rule])
        await session.commit()
        return {"co": co, "cc": cc, "cat": cat, "stock": stock, "admin": admin, "admin_emp": f"ADM-{suffix}"}


async def _login(client, login_id):
    resp = await client.post("/api/auth/login", json={"login_id": login_id, "password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _make_asset(ids, description, serial, model=None, barcode=None):
    async with SessionLocal() as session:
        admin = await session.get(Holder, ids["admin"].id)
        [asset] = await procure_assets(session, {
            "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
            "description": description, "purchase_date": date(2026, 1, 1),
            "serial_number": serial, "initial_holder_id": ids["stock"].id,
            "model": model, "barcode": barcode,
        }, quantity=1, actor=admin)
        await session.commit()
        return asset.id


async def test_sort_by_description_ascending_and_descending(client):
    ids = await _setup("SRT1")
    headers = await _login(client, ids["admin_emp"])
    await _make_asset(ids, "Zebra Printer", "SN-SRT1-A")
    await _make_asset(ids, "Acme Laptop", "SN-SRT1-B")

    asc = (await client.get("/api/assets?sort_by=description&sort_dir=asc", headers=headers)).json()["items"]
    descriptions = [a["description"] for a in asc if a["description"] in ("Zebra Printer", "Acme Laptop")]
    assert descriptions == ["Acme Laptop", "Zebra Printer"]

    desc = (await client.get("/api/assets?sort_by=description&sort_dir=desc", headers=headers)).json()["items"]
    descriptions = [a["description"] for a in desc if a["description"] in ("Zebra Printer", "Acme Laptop")]
    assert descriptions == ["Zebra Printer", "Acme Laptop"]


async def test_sort_by_purchase_cost_numeric_not_lexicographic(client):
    """A string sort would put "9" before "10" -- confirm this is a real
    numeric ORDER BY, not a stringified comparison."""
    ids = await _setup("SRT2")
    headers = await _login(client, ids["admin_emp"])
    async with SessionLocal() as session:
        admin = await session.get(Holder, ids["admin"].id)
        for cost, serial in ((9, "SN-SRT2-LOW"), (10, "SN-SRT2-HIGH")):
            await procure_assets(session, {
                "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
                "description": "Cost Sort Item", "purchase_date": date(2026, 1, 1),
                "serial_number": serial, "initial_holder_id": ids["stock"].id, "purchase_cost": cost,
            }, quantity=1, actor=admin)
            await session.commit()

    resp = await client.get(f"/api/assets?q=Cost Sort Item&sort_by=purchase_cost&sort_dir=asc", headers=headers)
    items = resp.json()["items"]
    assert [float(a["purchase_cost"]) for a in items] == [9.0, 10.0]


async def test_unrecognized_sort_by_is_ignored_not_a_422(client):
    ids = await _setup("SRT3")
    headers = await _login(client, ids["admin_emp"])
    await _make_asset(ids, "Ignored Sort Item", "SN-SRT3")

    resp = await client.get("/api/assets?sort_by=deleted_at&sort_dir=asc", headers=headers)
    assert resp.status_code == 200


async def test_search_now_also_covers_barcode_model(client):
    """AM-21 originally covered Brand too, but Brand became a master FK
    (brand_id) once it moved out of free text -- it's no longer part of
    this free-text search, matching category_id/vendor_id, which were
    never in it either (see search_service.py's own SORTABLE_COLUMNS
    comment)."""
    ids = await _setup("SRT4")
    headers = await _login(client, ids["admin_emp"])
    await _make_asset(ids, "Searchable Item", "SN-SRT4-1", model="Latitude", barcode="BC-UNIQUE-999")

    for q in ("Latitude", "BC-UNIQUE-999"):
        resp = await client.get(f"/api/assets?q={q}", headers=headers)
        assert resp.json()["total"] == 1, f"expected exactly 1 match searching {q!r}"
