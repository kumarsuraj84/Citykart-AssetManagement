"""Old-data import: "Add all" brings every ERP supplier of a company in as a CKAM vendor in one go, linking what is surely the
same business, creating the rest, and leaving name-only look-alikes for a person."""
from sqlalchemy import select

from app.core.db import SessionLocal
from app.erp.source import ErpVendor
from app.masters.models import Vendor, VendorErpLink
from tests.erp.test_erp_api import _headers, _setup, erp  # noqa: F401  (erp is a fixture)

VANSH_GSTIN = "07AAAAA0000A1Z5"


async def _world(client, erp):
    ids = await _setup()
    async with SessionLocal() as s:
        vansh = (await s.execute(select(Vendor).where(Vendor.code == "VANSH"))).scalar_one()
        vansh.gstin = VANSH_GSTIN
        await s.commit()
    erp.vendor_list = [
        ErpVendor("11338", "VANSH ENTERPRISES", gstin=VANSH_GSTIN, company_code="CKSPL"),                       # already linked: untouched
        ErpVendor("3003", "VANSH ENTERPRISES DELHI", gstin=VANSH_GSTIN, company_code="CKSPL"),                  # same GSTIN: LINK to Vansh
        ErpVendor("3001", "BRAND NEW SUPPLIES", gstin="09BBBBB1111B1Z5", company_code="CKSPL"),                 # nothing like it: CREATE
        ErpVendor("4001", "ZED CORP (UP)", gstin="09CCCCC2222C1Z5", company_code="CKSPL"),                      # two registrations, one PAN:
        ErpVendor("4002", "ZED CORP (DEL)", gstin="07CCCCC2222C1Z9", company_code="CKSPL"),                     # ONE new vendor with two links
        ErpVendor("3002", "HARSHIT INFOSOLUTION", company_code="CKSPL"),                                         # only the NAME matches a vendor: left alone
        ErpVendor("9", "OTHER COMPANY SUPPLIER", company_code="CKVPL"),                                          # the other company: not asked
    ]
    return ids, await _headers(client)


async def _links():
    async with SessionLocal() as s:
        rows = (await s.execute(select(Vendor.name, VendorErpLink.company_id, VendorErpLink.erp_vendor_code)
                                .join(VendorErpLink, VendorErpLink.vendor_id == Vendor.id))).all()
    return sorted((name, code) for name, _company, code in rows)


async def test_the_plan_counts_what_add_all_would_do_and_writes_nothing(client, erp):
    ids, h = await _world(client, erp)
    before = await _links()
    plan = (await client.get("/api/erp/vendors/add-all/plan", headers=h, params={"company_id": ids["spl"]})).json()
    assert plan == {"link": 1, "create": 2, "skipped": 1, "suppliers": 4}
    assert await _links() == before


async def test_add_all_links_the_same_business_creates_the_rest_and_leaves_look_alikes_alone(client, erp):
    ids, h = await _world(client, erp)
    resp = await client.post("/api/erp/vendors/add-all", headers=h, json={"company_id": ids["spl"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["created"], body["linked"], body["failed_count"], body["remaining"], body["skipped_count"]) == (2, 1, 0, 0, 1)
    assert body["skipped"][0]["name"] == "HARSHIT INFOSOLUTION" and body["skipped"][0]["similar_to"] == "Harshit Infosolution"
    links = await _links()
    assert ("Vansh Enterprises", "3003") in links and ("Vansh Enterprises", "11338") in links       # the same GSTIN joined the existing vendor
    assert ("BRAND NEW SUPPLIES", "3001") in links
    assert [c for n, c in links if n == "ZED CORP (UP)"] == ["4001", "4002"]                            # one vendor, both registrations
    assert not any(code == "3002" for _n, code in links) and not any(code == "9" for _n, code in links)

    again = (await client.post("/api/erp/vendors/add-all", headers=h, json={"company_id": ids["spl"]})).json()
    assert (again["created"], again["linked"], again["remaining"], again["skipped_count"]) == (0, 0, 0, 1)      # nothing new the second time


async def test_add_all_is_for_the_head_office_admin_and_a_known_company(client, erp):
    ids, h = await _world(client, erp)
    assert (await client.post("/api/erp/vendors/add-all", headers=await _headers(client, "OPR"), json={"company_id": ids["spl"]})).status_code == 403
    assert (await client.get("/api/erp/vendors/add-all/plan", headers=await _headers(client, "OPR"), params={"company_id": ids["spl"]})).status_code == 403
    assert (await client.post("/api/erp/vendors/add-all", headers=h, json={"company_id": 99999})).status_code == 404
