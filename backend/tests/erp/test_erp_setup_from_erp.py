"""Guided "Add from the ERP" in Setup: companies (code and name from the ERP, nobody types the ERP company code),
and head offices / warehouses (a Place, an Install Point and, by default, a Stock Point each).

External and virtual sites are never offered; a site named for the other company is offered but not ticked."""
import pytest
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.erp.sync import run_sync
from app.erp.warehouse import WhCompany, get_warehouse_reader
from app.main import app
from app.masters.models import Company, CostCenter, Location
from tests.erp.fake_warehouse import FakeWarehouse, wh_site
from tests.erp.test_erp_api import _headers, _setup


@pytest.fixture
def wh():
    reader = FakeWarehouse()
    reader.company_list = [
        WhCompany("CKSPL", "CITYKART STORES PVT. LTD.", "CKSPL-HO"),
        WhCompany("CKVPL", "CITYKART RETAIL PVT. LTD.", "CKVPL-HO"),
        WhCompany("NEWCO", "NEW COMPANY PVT. LTD.", "NEWCO-HO"),
    ]
    app.dependency_overrides[get_warehouse_reader] = lambda: reader
    yield reader
    app.dependency_overrides.pop(get_warehouse_reader, None)


async def _sites(reader):
    reader.site_list = [
        wh_site("CKSPL", 2, "LAM"),                                                                   # a store: not a place here
        wh_site("CKSPL", 68, "CKSPL-HO", site_kind="HEAD_OFFICE", store_status=None, site_name="CKSPL-HO", store_name=None),
        wh_site("CKSPL", 250, "CKSPL-WH-TAJNAGAR", site_kind="WAREHOUSE", store_status="-", site_name="CKSPL-WH-TAJNAGAR", store_name=None),
        wh_site("CKSPL", 251, "CKSPL-WH-FARUKHNAGAR", site_kind="WAREHOUSE", store_status="-", site_name="CKSPL-WH-FARUKHNAGAR", store_name=None),
        wh_site("CKSPL", 300, "CKPL-DEL-WH", site_kind="WAREHOUSE_OTHER", store_status="-", site_name="CKPL-DEL-WH", store_name=None),
        wh_site("CKSPL", 301, "CKSPL-WH-KHETWS-PYP", site_kind="WAREHOUSE_LEGACY", store_status="-", site_name="CKSPL-WH-KHETWS-PYP", store_name=None),
        wh_site("CKSPL", 69, "CKVPL-HO", site_kind="HEAD_OFFICE", store_status=None, site_name="CKVPL-HO", store_name=None),      # the other company's name
        wh_site("CKSPL", 70, "A-VERY-LONG-WAREHOUSE-NAME", site_kind="WAREHOUSE", store_status=None, site_name="long", store_name=None),
        wh_site("CKSPL", 400, "ACME TRADERS", site_kind="EXTERNAL", store_status=None, site_name="ACME TRADERS", store_name=None),    # a supplier
        wh_site("CKSPL", 401, "VIRT1", site_kind="VIRTUAL", store_status="-", site_name="VIRT1", store_name=None),
        wh_site("CKSPL", 402, "GONE-HO", site_kind="HEAD_OFFICE", store_status=None, site_name="GONE-HO", store_name=None, is_active_site=False),
        wh_site("CKVPL", 5, "CKVPL-WH-TAJNAGAR", site_kind="WAREHOUSE", store_status=None, site_name="CITYKART VENTURES (TAJNAGAR)", store_name=None),
    ]
    await run_sync(SessionLocal, reader, "manual")


# ---- companies ---------------------------------------------------------------------------------------------------

async def test_the_erp_companies_are_listed_with_their_names_and_what_ckam_already_has(client, wh):
    await _setup()
    h = await _headers(client)
    body = (await client.get("/api/erp/companies", headers=h)).json()
    assert body["names_known"] is True and body["note"] is None
    rows = {r["code"]: r for r in body["companies"]}
    assert set(rows) == {"CKSPL", "CKVPL", "NEWCO"}
    assert (rows["NEWCO"]["exists"], rows["NEWCO"]["selectable"], rows["NEWCO"]["suggested_name"], rows["NEWCO"]["erp_name"]) == (
        False, True, "New Company Pvt. Ltd.", "NEW COMPANY PVT. LTD.")
    assert (rows["CKSPL"]["exists"], rows["CKSPL"]["selectable"], rows["CKSPL"]["is_active"]) == (True, False, True)
    assert rows["CKSPL"]["reason"] == "This company is already here."
    # CKVPL: the ERP calls it Retail, CKAM says Ventures -- shown side by side, nothing overwritten
    assert (rows["CKVPL"]["ckam_name"], rows["CKVPL"]["suggested_name"], rows["CKVPL"]["name_differs"]) == (
        "Citykart Ventures Pvt Ltd", "Citykart Retail Pvt. Ltd.", True)


async def test_a_company_that_was_switched_off_is_not_made_again_it_is_pointed_to_switch_on(client, wh):
    ids = await _setup()
    h = await _headers(client)
    await client.delete(f"/api/masters/companies/{ids['vpl']}", headers=h)
    row = next(r for r in (await client.get("/api/erp/companies", headers=h)).json()["companies"] if r["code"] == "CKVPL")
    assert (row["exists"], row["is_active"], row["selectable"]) == (True, False, False)
    assert "switch it on again" in row["reason"]


async def test_creating_a_company_takes_the_code_from_the_erp_and_makes_its_cost_centre(client, wh):
    await _setup()
    h = await _headers(client)
    resp = await client.post("/api/erp/companies/create", headers=h, json={"companies": [{"code": "NEWCO"}]})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"created": ["NEWCO"], "skipped": [], "cost_centres_created": 1}
    async with SessionLocal() as s:
        company = (await s.execute(select(Company).where(Company.code == "NEWCO"))).scalar_one()
        assert (company.name, company.is_active, company.erp_company_code) == ("New Company Pvt. Ltd.", True, None)     # code IS the ERP code
        cc = (await s.execute(select(CostCenter).where(CostCenter.company_id == company.id))).scalar_one()
        assert (cc.code, cc.name) == ("NEWCO", "New Company Pvt. Ltd.")


async def test_the_owner_may_rename_and_skip_the_cost_centre_and_what_exists_is_never_changed(client, wh):
    ids = await _setup()
    h = await _headers(client)
    resp = await client.post("/api/erp/companies/create", headers=h, json={"companies": [
        {"code": "NEWCO", "name": "NewCo Retail", "with_cost_centre": False},
        {"code": "CKSPL", "name": "Hacked name"},                      # already here
        {"code": "NOPE"},                                              # not an ERP company
        {"code": "newco"},                                             # the same one again
    ]})
    body = resp.json()
    assert body["created"] == ["NEWCO"] and body["cost_centres_created"] == 0
    assert {s["code"]: s["reason"] for s in body["skipped"]} == {
        "CKSPL": "This company is already here.", "NOPE": "This is not a company of the ERP."}
    async with SessionLocal() as s:
        assert (await s.get(Company, ids["spl"])).name == "Citykart Stores Pvt Ltd"
        new = (await s.execute(select(Company).where(Company.code == "NEWCO"))).scalar_one()
        assert new.name == "NewCo Retail"
        assert (await s.execute(select(CostCenter).where(CostCenter.company_id == new.id))).first() is None


async def test_a_name_already_used_by_a_company_that_is_on_is_refused(client, wh):
    await _setup()
    h = await _headers(client)
    resp = await client.post("/api/erp/companies/create", headers=h, json={"companies": [{"code": "NEWCO", "name": " citykart stores pvt ltd "}]})
    assert resp.json()["created"] == [] and "already switched on" in resp.json()["skipped"][0]["reason"]


async def test_when_the_erp_names_cannot_be_read_the_list_falls_back_to_the_codes_the_copy_holds(client, wh):
    await _setup()
    await _sites(wh)
    wh.companies_down = "CKAM is not allowed to read the ERP view (a database grant is missing)."
    h = await _headers(client)
    body = (await client.get("/api/erp/companies", headers=h)).json()
    assert body["names_known"] is False and "not allowed to read" in body["note"] and "type the name yourself" in body["note"]
    assert {r["code"] for r in body["companies"]} == {"CKSPL", "CKVPL"}                      # from the copied sites; no names
    assert all(r["erp_name"] is None for r in body["companies"])


async def test_only_the_head_office_admin_may_use_these_routes(client, wh):
    ids = await _setup()
    for code in ("OPR", "VWR"):
        h = await _headers(client, code)
        assert (await client.get("/api/erp/companies", headers=h)).status_code == 403
        assert (await client.post("/api/erp/companies/create", headers=h, json={"companies": [{"code": "NEWCO"}]})).status_code == 403
        assert (await client.get("/api/erp/places", params={"company_id": ids["spl"]}, headers=h)).status_code == 403
        assert (await client.post("/api/erp/places/create", headers=h, json={"company_id": ids["spl"], "codes": ["X"]})).status_code == 403
    assert (await client.get("/api/erp/companies")).status_code == 401


# ---- head offices and warehouses ----------------------------------------------------------------------------------

async def test_only_head_offices_and_warehouses_are_offered_each_with_what_ticks_by_default(client, wh):
    ids = await _setup()
    await _sites(wh)
    body = (await client.get("/api/erp/places", params={"company_id": ids["spl"]}, headers=await _headers(client))).json()
    rows = {r["code"]: r for r in body["places"]}
    assert set(rows) == {"CKSPL-HO", "CKSPL-WH-TAJNAGAR", "CKSPL-WH-FARUKHNAGAR", "CKPL-DEL-WH", "CKSPL-WH-KHETWS-PYP", "CKVPL-HO",
                         "A-VERY-LONG-WAREHOUSE-NAME", "GONE-HO"}          # no store, supplier, virtual site or other-company site
    assert rows["CKSPL-HO"]["group"] == "HEAD_OFFICE" and rows["CKSPL-HO"]["selected_by_default"] is True
    assert rows["CKSPL-WH-TAJNAGAR"]["group"] == "WAREHOUSE" and rows["CKSPL-WH-TAJNAGAR"]["selected_by_default"] is True
    assert (rows["CKPL-DEL-WH"]["group"], rows["CKPL-DEL-WH"]["selectable"], rows["CKPL-DEL-WH"]["selected_by_default"]) == ("OTHER_WAREHOUSE", True, False)
    assert (rows["CKSPL-WH-KHETWS-PYP"]["group"], rows["CKSPL-WH-KHETWS-PYP"]["selected_by_default"]) == ("OLD_WAREHOUSE", False)
    # named for the other company: offered, not ticked, with a warning
    assert (rows["CKVPL-HO"]["selectable"], rows["CKVPL-HO"]["selected_by_default"]) == (True, False)
    assert "Named for CKVPL but listed under CKSPL" in rows["CKVPL-HO"]["note"]
    # a code too long to be a place code cannot be made; a site switched off in the ERP is not ticked
    assert rows["A-VERY-LONG-WAREHOUSE-NAME"]["selectable"] is False and "longer than 20" in rows["A-VERY-LONG-WAREHOUSE-NAME"]["reason"]
    assert (rows["GONE-HO"]["selectable"], rows["GONE-HO"]["selected_by_default"], rows["GONE-HO"]["active"]) == (True, False, False)
    assert body["summary"]["HEAD_OFFICE"] == 3 and body["summary"]["WAREHOUSE"] == 3 and body["summary"]["ALREADY_CREATED"] == 0


async def test_the_other_companys_places_are_listed_for_that_company_only(client, wh):
    ids = await _setup()
    await _sites(wh)
    body = (await client.get("/api/erp/places", params={"company_id": ids["vpl"]}, headers=await _headers(client))).json()
    assert [r["code"] for r in body["places"]] == ["CKVPL-WH-TAJNAGAR"]


async def test_creating_makes_the_place_its_install_point_and_its_stock_point(client, wh):
    ids = await _setup()
    await _sites(wh)
    h = await _headers(client)
    resp = await client.post("/api/erp/places/create", headers=h, json={"company_id": ids["spl"], "codes": ["CKSPL-HO", "CKSPL-WH-TAJNAGAR"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert sorted(body["created"]) == ["CKSPL-HO", "CKSPL-WH-TAJNAGAR"] and body["skipped"] == []
    assert (body["install_points_created"], body["stock_points_created"]) == (2, 2)
    async with SessionLocal() as s:
        loc = (await s.execute(select(Location).where(Location.company_id == ids["spl"], Location.code == "CKSPL-WH-TAJNAGAR"))).scalar_one()
        assert loc.name == "CKSPL-WH-TAJNAGAR"
        users = {u.code: u for u in (await s.execute(select(AssetUser).where(AssetUser.location_id == loc.id))).scalars().all()}
    assert set(users) == {"INS-CKSPL-WH-TAJNAGAR", "STK-CKSPL-WH-TAJNAGAR"}
    ins, stk = users["INS-CKSPL-WH-TAJNAGAR"], users["STK-CKSPL-WH-TAJNAGAR"]
    assert (ins.asset_user_type, ins.name, ins.login_enabled, ins.is_active) == ("INSTALLED", "CKSPL-WH-TAJNAGAR Site", False, True)
    assert (stk.asset_user_type, stk.name, stk.login_enabled) == ("STOCK_POINT", "CKSPL-WH-TAJNAGAR Stock", False)
    # what exists now shows as already created
    again = (await client.get("/api/erp/places", params={"company_id": ids["spl"]}, headers=h)).json()
    assert again["summary"]["ALREADY_CREATED"] == 2 and {r["code"] for r in again["places"] if r["exists"]} == {"CKSPL-HO", "CKSPL-WH-TAJNAGAR"}


async def test_the_stock_point_can_be_left_out(client, wh):
    ids = await _setup()
    await _sites(wh)
    resp = await client.post("/api/erp/places/create", headers=await _headers(client),
                             json={"company_id": ids["spl"], "codes": ["CKSPL-HO"], "with_stock_point": False})
    assert (resp.json()["install_points_created"], resp.json()["stock_points_created"]) == (1, 0)
    async with SessionLocal() as s:
        codes = {u.code for u in (await s.execute(select(AssetUser).where(AssetUser.company_id == ids["spl"], AssetUser.code.like("%CKSPL-HO")))).scalars().all()}
    assert codes == {"INS-CKSPL-HO"}


async def test_what_cannot_be_made_is_reported_and_the_rest_are_still_made_and_nothing_is_made_twice(client, wh):
    ids = await _setup()
    await _sites(wh)
    h = await _headers(client)
    first = await client.post("/api/erp/places/create", headers=h, json={"company_id": ids["spl"], "codes": ["CKSPL-HO"]})
    assert first.json()["created"] == ["CKSPL-HO"]
    resp = await client.post("/api/erp/places/create", headers=h, json={"company_id": ids["spl"], "codes": [
        "CKSPL-HO", "A-VERY-LONG-WAREHOUSE-NAME", "LAM", "NOPE", "CKSPL-WH-FARUKHNAGAR", "ckspl-wh-farukhnagar"]})
    body = resp.json()
    assert body["created"] == ["CKSPL-WH-FARUKHNAGAR"]
    reasons = {s["code"]: s["reason"] for s in body["skipped"]}
    assert reasons["CKSPL-HO"] == "A place with this code already exists."
    assert "longer than 20" in reasons["A-VERY-LONG-WAREHOUSE-NAME"]
    assert "not a head office or warehouse" in reasons["LAM"] and "not a head office or warehouse" in reasons["NOPE"]
    async with SessionLocal() as s:
        count = (await s.execute(select(Location).where(Location.company_id == ids["spl"], Location.code == "CKSPL-HO"))).scalars().all()
    assert len(count) == 1


async def test_an_existing_place_with_the_same_code_is_reused_not_duplicated(client, wh):
    ids = await _setup()
    await _sites(wh)
    # a place CKAM already has under another spelling of the code is "already created", never made again
    async with SessionLocal() as s:
        s.add(Location(company_id=ids["spl"], code="ckspl-wh-tajnagar", name="Tajnagar WH"))
        await s.commit()
    body = (await client.get("/api/erp/places", params={"company_id": ids["spl"]}, headers=await _headers(client))).json()
    row = next(r for r in body["places"] if r["code"] == "CKSPL-WH-TAJNAGAR")
    assert (row["exists"], row["selectable"], row["selected_by_default"]) == (True, False, False)


async def test_each_run_leaves_one_audit_row(client, wh):
    from app.observability.models import AuditLog
    from tests.observability.helpers import audit
    ids = await _setup()
    await _sites(wh)
    h = await _headers(client)
    resp = await client.post("/api/erp/places/create", headers=h, json={"company_id": ids["spl"], "codes": ["CKSPL-HO"]})
    rows = [r for r in await audit(AuditLog.request_id == resp.headers["x-request-id"]) if r.action != "WRITE"]
    assert [(r.category, r.action) for r in rows] == [("ERP", "PLACES_CREATE")] and "made 1 place from the ERP" in rows[0].summary
    resp = await client.post("/api/erp/companies/create", headers=h, json={"companies": [{"code": "NEWCO"}]})
    rows = [r for r in await audit(AuditLog.request_id == resp.headers["x-request-id"]) if r.action != "WRITE"]
    assert [(r.category, r.action) for r in rows] == [("ERP", "COMPANIES_CREATE")] and "made 1 company from the ERP" in rows[0].summary
