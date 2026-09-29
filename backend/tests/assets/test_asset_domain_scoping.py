"""Asset User / RBAC / Responsibility rebuild: spec §14/§15 -- ADMIN always
works across both IT and NON_IT regardless of its own configured
primary_asset_domain, while OPERATOR/VIEWER are restricted to their
configured allowed_asset_domains. This is the server-side enforcement of
that rule on the actual asset read paths (list + detail), not just the
deps.py helper in isolation."""
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.models import Asset
from app.masters.models import AssetCategory, Company, CostCenter, Location, Department
from app.asset_users.models import AssetUser


async def _setup(suffix):
    async with SessionLocal() as session:
        co = Company(code=f"DOM-{suffix}", name="Domain Test Co")
        it_cat = AssetCategory(code=f"ITCAT-{suffix}", name="IT Category", asset_domain="IT")
        non_it_cat = AssetCategory(code=f"NITCAT-{suffix}", name="Non-IT Category", asset_domain="NON_IT")
        session.add_all([co, it_cat, non_it_cat])
        await session.flush()
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(company_id=co.id, code=f"HO-{suffix}", name="HO")
        dept = Department(name=f"IT-{suffix}")
        session.add_all([cc, loc, dept])
        await session.flush()
        stock = AssetUser(
            company_id=co.id, code=f"STK-{suffix}", name="Stock",
            asset_user_type="STOCK_POINT", location_id=loc.id, department_id=dept.id, role="SELF_SERVICE",
        )
        it_operator = AssetUser(
            company_id=co.id, code=f"ITOP-{suffix}", name="IT Operator", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="OPERATOR", allowed_asset_domains="IT",
            login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        admin = AssetUser(
            company_id=co.id, code=f"ADM-{suffix}", name="Admin", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="ADMIN", primary_asset_domain="IT",
            login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add_all([stock, it_operator, admin])
        await session.flush()

        it_asset = Asset(
            asset_code=f"FA/HO01/IT/CAT/CK_IT_{suffix}", company_id=co.id, cost_center_id=cc.id,
            category_id=it_cat.id, description="IT Laptop", purchase_date=date(2025, 12, 10),
            status="IN_STOCK", current_asset_user_id=stock.id, status_since=date(2025, 12, 10),
            asset_domain="IT",
        )
        non_it_asset = Asset(
            asset_code=f"FA/HO01/NIT/CAT/CK_NIT_{suffix}", company_id=co.id, cost_center_id=cc.id,
            category_id=non_it_cat.id, description="Store Chair", purchase_date=date(2025, 12, 10),
            status="IN_STOCK", current_asset_user_id=stock.id, status_since=date(2025, 12, 10),
            asset_domain="NON_IT",
        )
        session.add_all([it_asset, non_it_asset])
        await session.commit()
        return co.id, it_asset.id, non_it_asset.id


async def _login(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_operator_restricted_to_it_never_sees_a_non_it_asset_in_the_list(client):
    suffix = "S1"
    _co_id, it_asset_id, non_it_asset_id = await _setup(suffix)
    headers = await _login(client, f"ITOP-{suffix}")

    resp = await client.get("/api/assets", headers=headers)
    assert resp.status_code == 200
    ids = {item["id"] for item in resp.json()["items"]}
    assert it_asset_id in ids
    assert non_it_asset_id not in ids


async def test_operator_restricted_to_it_gets_404_reading_a_non_it_asset_directly(client):
    suffix = "S2"
    _co_id, _it_asset_id, non_it_asset_id = await _setup(suffix)
    headers = await _login(client, f"ITOP-{suffix}")

    resp = await client.get(f"/api/assets/{non_it_asset_id}", headers=headers)
    assert resp.status_code == 404


async def test_admin_sees_both_domains_regardless_of_its_own_primary_domain(client):
    """spec §14: ADMIN cross-domain rule -- primary_asset_domain is a
    convenience default (dashboard/reports), never an authorization
    restriction, even though this ADMIN's own primary_asset_domain is "IT"."""
    suffix = "S3"
    _co_id, it_asset_id, non_it_asset_id = await _setup(suffix)
    headers = await _login(client, f"ADM-{suffix}")

    resp = await client.get("/api/assets", headers=headers)
    assert resp.status_code == 200
    ids = {item["id"] for item in resp.json()["items"]}
    assert it_asset_id in ids
    assert non_it_asset_id in ids

    detail = await client.get(f"/api/assets/{non_it_asset_id}", headers=headers)
    assert detail.status_code == 200


async def test_domain_filter_query_param_is_clamped_to_the_callers_own_scope(client):
    """An OPERATOR restricted to IT passing ?domain=NON_IT must not be able
    to widen past their own allowed_asset_domains -- the filter is only ever
    a further narrowing, never an escalation."""
    suffix = "S4"
    _co_id, it_asset_id, non_it_asset_id = await _setup(suffix)
    headers = await _login(client, f"ITOP-{suffix}")

    resp = await client.get("/api/assets?domain=NON_IT", headers=headers)
    assert resp.status_code == 200
    ids = {item["id"] for item in resp.json()["items"]}
    assert non_it_asset_id not in ids
    assert it_asset_id in ids
