"""CKAM's company code (part of every asset code, never changes) can differ from
what the ERP calls the company. Production: CKAM "CKS" is the ERP's "CKSPL"."""
from sqlalchemy import select
from app.core.db import SessionLocal
from app.masters.models import Company
from tests.erp.test_erp_api import _headers, _setup, erp, desktop_po  # noqa: F401  (erp is a fixture)

PO_CODE = 1133610106


async def _rename_company_in_ckam(code="CKS"):
    async with SessionLocal() as session:
        spl = (await session.execute(select(Company).where(Company.code == "CKSPL"))).scalar_one()
        spl.code = code
        await session.commit()
        return spl.id


async def test_without_an_erp_code_a_company_the_erp_calls_something_else_is_not_recognised(client, erp):
    await _setup()
    await _rename_company_in_ckam("CKS")
    draft = (await client.get(f"/api/erp/pos/{PO_CODE}/draft", headers=await _headers(client, "OWN"))).json()
    assert draft["company_id"] is None
    assert any("No company is set up for the ERP company CKSPL" in w and "ERP company code" in w for w in draft["warnings"])


async def test_setting_the_erp_company_code_makes_the_po_and_its_cost_centre_match(client, erp):
    ids = await _setup()
    cid = await _rename_company_in_ckam("CKS")
    h = await _headers(client, "OWN")
    resp = await client.put(f"/api/masters/companies/{cid}", headers=h, json={"name": "Citykart Stores Pvt Ltd", "erp_company_code": "ckspl"})
    assert resp.status_code == 200 and resp.json()["erp_company_code"] == "ckspl"
    draft = (await client.get(f"/api/erp/pos/{PO_CODE}/draft", headers=h)).json()
    assert draft["company_id"] == cid and draft["cost_center_id"] == ids["cost_spl"]       # case does not matter; the cost centre is still named CKSPL
    assert not any("company" in w.lower() for w in draft["warnings"])


async def test_the_article_screen_asks_the_erp_by_the_erp_company_code(client, erp):
    await _setup()
    cid = await _rename_company_in_ckam("CKS")
    h = await _headers(client, "OWN")
    asked: list = []
    original = erp.bought_articles

    async def spy(company_code=None):
        asked.append(company_code)
        return await original(company_code)

    erp.bought_articles = spy
    await client.get(f"/api/items/articles?company_id={cid}", headers=h)
    await client.put(f"/api/masters/companies/{cid}", headers=h, json={"name": "Citykart Stores Pvt Ltd", "erp_company_code": "CKSPL"})
    await client.get(f"/api/items/articles?company_id={cid}", headers=h)
    assert asked == ["CKS", "CKSPL"]                  # the plain code until the ERP code is set, then the ERP one


async def test_blank_erp_codes_are_stored_as_empty_and_two_companies_cannot_share_one(client, erp):
    ids = await _setup()
    h = await _headers(client, "OWN")
    one = (await client.post("/api/masters/companies", headers=h, json={"code": "AAA", "name": "A Co", "erp_company_code": "   "})).json()
    assert one["erp_company_code"] is None
    two = await client.post("/api/masters/companies", headers=h, json={"code": "BBB", "name": "B Co", "erp_company_code": "XYZ"})
    assert two.status_code == 201 and two.json()["erp_company_code"] == "XYZ"
    clash = await client.post("/api/masters/companies", headers=h, json={"code": "CCC", "name": "C Co", "erp_company_code": "xyz"})
    assert clash.status_code == 422
    listed = {c["code"]: c["erp_company_code"] for c in (await client.get("/api/masters/companies", headers=h)).json()}
    assert listed["AAA"] is None and listed["BBB"] == "XYZ"
