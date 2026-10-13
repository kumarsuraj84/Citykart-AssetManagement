"""Shared set-up for the S0 (security and data-integrity) regression tests: one
company with an IT and a Non-IT category, a second company, and one login for
every kind of user the S0 rules tell apart."""
from datetime import date

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Department, Location, Vendor
from app.numbering.models import CodeRule

PASSWORD = "Passw0rd!"


async def build_world() -> dict:
    async with SessionLocal() as s:
        co = Company(code="S0A", name="S0 Company A")
        co_b = Company(code="S0B", name="S0 Company B")
        it = AssetCategory(code="S0IT", name="Computers", asset_domain="IT")
        nonit = AssetCategory(code="S0NI", name="Furniture", asset_domain="NON_IT")
        dead_cat = AssetCategory(code="S0DEAD", name="Old category", asset_domain="IT", is_active=False)
        s.add_all([co, co_b, it, nonit, dead_cat])
        await s.flush()
        lap = AssetSubcategory(category_id=it.id, code="LAP", name="Laptop")
        chair = AssetSubcategory(category_id=nonit.id, code="CHR", name="Chair")
        dead_sub = AssetSubcategory(category_id=it.id, code="OLD", name="Old sub", is_active=False)
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        dead_cc = CostCenter(company_id=co.id, code="OLDCC", name="Closed office", is_active=False)
        cc_b = CostCenter(company_id=co_b.id, code="HO", name="Head Office B")
        loc = Location(company_id=co.id, code="S0-HO", name="HO")
        loc_b = Location(company_id=co_b.id, code="S0B-HO", name="HO B")
        dept = Department(name="S0 Dept")
        vendor = Vendor(code="S0V", name="Good Vendor")
        dead_vendor = Vendor(code="S0VX", name="Closed Vendor", is_active=False)
        brand = Brand(code="S0BR", name="Dell")
        dead_brand = Brand(code="S0BX", name="Gone Brand", is_active=False)
        rule = CodeRule(company_id=None, prefix_template="S0/{category.code}/", suffix_template="", start_number=1, pad_width=3)
        s.add_all([lap, chair, dead_sub, cc, dead_cc, cc_b, loc, loc_b, dept, vendor, dead_vendor, brand, dead_brand, rule])
        await s.flush()

        def user(code, role="SELF_SERVICE", type_="EMPLOYEE", login=True, owner=False, domains=None, company=co, location=loc,
                 active=True, name=None):
            return AssetUser(
                company_id=company.id, code=code, name=name or code, asset_user_type=type_, location_id=location.id,
                department_id=dept.id, role=role, is_primary_owner=owner, login_enabled=login,
                allowed_asset_domains=domains, is_active=active,
                password_hash=hash_password(PASSWORD) if login else None, must_change_password=False,
            )

        users = {
            "owner": user("S0OWN", "ADMIN", owner=True, name="Head Office Admin"),
            "owner2": user("S0OWN2", "ADMIN", owner=True, name="Second Head Office Admin"),
            "admin": user("S0ADM", "ADMIN", name="Ordinary Admin"),
            "admin_it": user("S0ADMIT", "ADMIN", domains="IT", name="IT Admin"),
            "op_it": user("S0OPIT", "OPERATOR", domains="IT", name="IT Operator"),
            "op_nonit": user("S0OPNI", "OPERATOR", domains="NON_IT", name="Non-IT Operator"),
            "op_both": user("S0OPBO", "OPERATOR", name="Both Operator"),
            "viewer_it": user("S0VWIT", "VIEWER", domains="IT", name="IT Viewer"),
            "stock": user("S0STK", type_="STOCK_POINT", login=False, name="Main Stock"),
            "stock2": user("S0STK2", type_="STOCK_POINT", login=False, name="Second Stock"),
            "dead_stock": user("S0STKX", type_="STOCK_POINT", login=False, active=False, name="Closed Stock"),
            "employee": user("S0EMP", login=False, name="Ravi Kumar"),
            "employee2": user("S0EMP2", login=False, name="Sita Devi"),
            "stock_b": user("S0STKB", type_="STOCK_POINT", login=False, company=co_b, location=loc_b, name="B Stock"),
        }
        s.add_all(users.values())
        await s.commit()
        world = {
            "co": co.id, "co_b": co_b.id, "it": it.id, "nonit": nonit.id, "dead_cat": dead_cat.id,
            "lap": lap.id, "chair": chair.id, "dead_sub": dead_sub.id, "cc": cc.id, "dead_cc": dead_cc.id, "cc_b": cc_b.id,
            "loc": loc.id, "dept": dept.id, "vendor": vendor.id, "dead_vendor": dead_vendor.id, "brand": brand.id,
            "dead_brand": dead_brand.id, "rule": rule.id,
        }
        world.update({key: u.id for key, u in users.items()})
        world["codes"] = {key: u.code for key, u in users.items()}
        return world


async def login(client, world: dict, who: str) -> dict:
    resp = await client.post("/api/auth/login", json={"login_id": world["codes"][who], "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def make_po(client, headers, world: dict, number: str = "PO-1", po_date: str = "2026-01-01", **over) -> dict:
    resp = await client.post("/api/purchase-orders", headers=headers, json={
        "company_id": world["co"], "po_number": number, "po_date": po_date, "cost_center_id": world["cc"], **over,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def add_line(client, headers, world: dict, po_id: int, area: str = "it", quantity: int = 1, **over):
    category = world["it"] if area == "it" else world["nonit"]
    subcategory = world["lap"] if area == "it" else world["chair"]
    return await client.post(f"/api/purchase-orders/{po_id}/lines", headers=headers, json={
        "description": "Laptop" if area == "it" else "Chair", "category_id": category, "subcategory_id": subcategory,
        "quantity": quantity, "purchase_cost": 1000, "tax_percent": 18, **over,
    })


def asset_body(world: dict, area: str = "it", **over) -> dict:
    body = {
        "company_id": world["co"], "cost_center_id": world["cc"],
        "category_id": world["it"] if area == "it" else world["nonit"],
        "subcategory_id": world["lap"] if area == "it" else world["chair"],
        "description": "Dell laptop" if area == "it" else "Office chair", "vendor_id": world["vendor"],
        "serial_number": "N/A", "initial_asset_user_id": world["stock"], "invoice_date": date(2026, 2, 1).isoformat(),
    }
    body.update(over)
    return body


async def make_asset(client, headers, world: dict, area: str = "it", **over) -> dict:
    resp = await client.post("/api/assets", headers=headers, json=asset_body(world, area, **over))
    assert resp.status_code == 201, resp.text
    return resp.json()[0]
