"""AM-08 Bug 1: GET /api/masters/cost-centers gained an optional, opt-in
`company_id` filter (Add Asset's own consumption of it) without changing the
unfiltered default the Setup screens rely on. Category (a genuinely global
master, no `company_id` column) must silently ignore the same query param
rather than error."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, Company, CostCenter, Department, Location




async def _setup():
    async with SessionLocal() as session:
        a = Company(code="CCA", name="CC Co A")
        b = Company(code="CCB", name="CC Co B")
        session.add_all([a, b])
        await session.flush()
        loc = Location(company_id=a.id, code="CC-HO", name="HO")
        dept = Department(name="IT-CC")
        session.add_all([loc, dept])
        await session.flush()
        cc_a = CostCenter(company_id=a.id, code="A01", name="A cc")
        cc_b = CostCenter(company_id=b.id, code="B01", name="B cc")
        cat = AssetCategory(code="CCCAT", name="CC Category")
        session.add(AssetUser(
            company_id=a.id, emp_code="CCADM", name="CC Admin", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="ADMIN",
            password_hash=hash_password("Passw0rd!"), must_change_password=False,
        ))
        session.add_all([cc_a, cc_b, cat])
        await session.commit()
        return a.id, b.id, cc_a.id, cc_b.id


async def _headers(client, company_id, emp_code="CCADM"):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _add_it_team(company_id, emp_code):
    """A fresh Location/Department (both genuinely global masters, no
    company_id column) so this helper doesn't depend on _setup()'s own
    loc/dept rows, which it doesn't return."""
    async with SessionLocal() as session:
        loc = Location(company_id=company_id, code=f"L-{emp_code}", name="HO")
        dept = Department(name=f"D-{emp_code}")
        session.add_all([loc, dept])
        await session.flush()
        session.add(AssetUser(
            company_id=company_id, emp_code=emp_code, name="CC IT Team", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="IT_TEAM",
            password_hash=hash_password("Passw0rd!"), must_change_password=False,
        ))
        await session.commit()


async def test_cost_centers_filtered_by_requested_company_id(client):
    a, b, cc_a, cc_b = await _setup()
    h = await _headers(client, a)

    resp = await client.get(f"/api/masters/cost-centers?company_id={a}", headers=h)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert cc_a in ids
    assert cc_b not in ids


async def test_cost_centers_unfiltered_when_no_company_id_given(client):
    """The Setup screen's own usage (no query param) must keep seeing every
    company's rows, unchanged -- this is a read-side narrowing an opted-in
    caller requests, not a new default restriction."""
    a, b, cc_a, cc_b = await _setup()
    h = await _headers(client, a)

    resp = await client.get("/api/masters/cost-centers", headers=h)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert cc_a in ids
    assert cc_b in ids


async def test_categories_endpoint_ignores_company_id_query_param(client):
    """Confirms the generic filter is opt-in per company-scoped master only --
    passing company_id against a master with no company_id column (Category
    is genuinely global) must not error and must not filter out every row."""
    a, b, cc_a, cc_b = await _setup()
    h = await _headers(client, a)

    resp = await client.get(f"/api/masters/categories?company_id={a}", headers=h)
    assert resp.status_code == 200
    names = {row["name"] for row in resp.json()}
    assert "CC Category" in names


async def test_non_admin_cost_centers_list_is_pinned_to_own_company_when_omitted(client):
    """AM-17 DEF-03: a non-ADMIN staff member omitting company_id previously
    still saw every company's Cost Centres (only writes were scoped). Reads
    of a company-owned master must be pinned to the caller's own company for
    a non-ADMIN, same as ensure_company_in_scope already enforces on writes."""
    a, b, cc_a, cc_b = await _setup()
    await _add_it_team(a, "CCITT-A")
    h = await _headers(client, a, emp_code="CCITT-A")

    resp = await client.get("/api/masters/cost-centers", headers=h)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert cc_a in ids
    assert cc_b not in ids


async def test_non_admin_cost_centers_list_ignores_other_companys_id_param(client):
    """A non-ADMIN explicitly requesting another company's id must not be
    honored either -- read-scoping can't be an opt-out the client controls."""
    a, b, cc_a, cc_b = await _setup()
    await _add_it_team(a, "CCITT-B")
    h = await _headers(client, a, emp_code="CCITT-B")

    resp = await client.get(f"/api/masters/cost-centers?company_id={b}", headers=h)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert cc_b not in ids
    assert cc_a in ids


async def test_admin_cost_centers_list_still_unrestricted_with_explicit_company_id(client):
    """ADMIN remains cross-company unrestricted (scoped_company_ids() is None
    for ADMIN) -- an explicit company_id still filters, exactly as before."""
    a, b, cc_a, cc_b = await _setup()
    h = await _headers(client, a)

    resp = await client.get(f"/api/masters/cost-centers?company_id={b}", headers=h)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert cc_b in ids
    assert cc_a not in ids
