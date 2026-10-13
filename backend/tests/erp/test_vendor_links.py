"""One vendor, one ERP supplier code per company: the same code is a different supplier in each company,
the same real supplier has a different code in each."""
from sqlalchemy import select

from app.core.db import SessionLocal
from app.erp.service import linked_vendors
from app.erp.source import ErpVendor
from app.masters.models import Vendor, VendorErpLink
from tests.erp.test_erp_api import _headers, _setup, desktop_po, erp  # noqa: F401  (erp is a fixture)

GSTIN = "07AAAAA0000A1Z5"


def link(company_id, code):
    return {"company_id": company_id, "erp_vendor_code": code}


async def vendor_id(code):
    async with SessionLocal() as s:
        return (await s.execute(select(Vendor.id).where(Vendor.code == code))).scalar_one()


async def test_the_same_erp_code_is_a_different_supplier_in_each_company(client, erp):
    ids = await _setup()
    h = await _headers(client)
    erp.vendor_list = [ErpVendor("11338", "VANSH ENTERPRISES", company_code="CKSPL"), ErpVendor("11338", "SOMEONE ELSE", company_code="CKVPL")]
    # OLDCO is the CKVPL supplier 11338 (a different supplier from CKSPL's 11338, which is VANSH)
    ok = await client.post(f"/api/erp/vendors/{ids['oldco']}/link", headers=h, json=link(ids["vpl"], "11338"))
    assert ok.status_code == 200, ok.text
    async with SessionLocal() as s:
        spl, vpl = await linked_vendors(s, ids["spl"]), await linked_vendors(s, ids["vpl"])
    assert spl["11338"].code == "VANSH" and vpl["11338"].code == "OLDCO"


async def test_one_vendor_can_be_linked_in_both_companies(client, erp):
    ids = await _setup()
    h = await _headers(client)
    erp.vendor_list = [ErpVendor("61", "VANSH ENTERPRISES", gstin=GSTIN, company_code="CKVPL")]
    resp = await client.post(f"/api/erp/vendors/{ids['vansh']}/link", headers=h, json=link(ids["vpl"], "61"))
    assert resp.status_code == 200, resp.text
    assert sorted((l["company_code"], l["erp_vendor_code"]) for l in resp.json()["erp_links"]) == [("CKSPL", "11338"), ("CKVPL", "61")]
    listed = (await client.get("/api/masters/vendors", headers=h)).json()
    vansh = next(v for v in listed if v["id"] == ids["vansh"])
    assert len(vansh["erp_links"]) == 2


async def test_a_vendor_can_have_two_codes_inside_one_company(client, erp):
    ids = await _setup()
    h = await _headers(client)
    erp.vendor_list = [ErpVendor("11338", "VANSH ENTERPRISES", company_code="CKSPL"), ErpVendor("1000003940", "VANSH ENTERPRISES_DEL", company_code="CKSPL")]
    resp = await client.post(f"/api/erp/vendors/{ids['vansh']}/link", headers=h, json=link(ids["spl"], "1000003940"))
    assert resp.status_code == 200
    assert sorted(l["erp_vendor_code"] for l in resp.json()["erp_links"]) == ["1000003940", "11338"]


async def test_linking_the_same_code_to_the_same_vendor_again_changes_nothing(client, erp):
    ids = await _setup()
    erp.vendor_list = [ErpVendor("11338", "VANSH ENTERPRISES", company_code="CKSPL")]
    resp = await client.post(f"/api/erp/vendors/{ids['vansh']}/link", headers=await _headers(client), json=link(ids["spl"], "11338"))
    assert resp.status_code == 200 and len(resp.json()["erp_links"]) == 1


async def test_a_code_taken_in_that_company_cannot_go_to_another_vendor(client, erp):
    ids = await _setup()
    erp.vendor_list = [ErpVendor("11338", "VANSH ENTERPRISES", company_code="CKSPL")]
    resp = await client.post(f"/api/erp/vendors/{ids['oldco']}/link", headers=await _headers(client), json=link(ids["spl"], "11338"))
    assert resp.status_code == 422 and "already linked to the vendor Vansh Enterprises" in resp.json()["detail"]


async def test_a_supplier_is_looked_up_in_its_own_companys_erp(client, erp):
    ids = await _setup()
    erp.vendor_list = [ErpVendor("11338", "VANSH ENTERPRISES", company_code="CKSPL")]
    resp = await client.post(f"/api/erp/vendors/{ids['oldco']}/link", headers=await _headers(client), json=link(ids["vpl"], "11338"))
    assert resp.status_code == 422 and "not found in the ERP of" in resp.json()["detail"]


async def test_unlinking_removes_only_that_companys_link(client, erp):
    ids = await _setup()
    h = await _headers(client)
    erp.vendor_list = [ErpVendor("61", "VANSH ENTERPRISES", company_code="CKVPL")]
    await client.post(f"/api/erp/vendors/{ids['vansh']}/link", headers=h, json=link(ids["vpl"], "61"))
    gone = await client.delete(f"/api/erp/vendors/{ids['vansh']}/link", params=link(ids["vpl"], "61"), headers=h)
    assert gone.status_code == 200 and [l["company_code"] for l in gone.json()["erp_links"]] == ["CKSPL"]
    missing = await client.delete(f"/api/erp/vendors/{ids['vansh']}/link", params=link(ids["vpl"], "61"), headers=h)
    assert missing.status_code == 404


async def test_the_same_gstin_is_suggested_before_the_same_name(client, erp):
    ids = await _setup()
    h = await _headers(client)
    async with SessionLocal() as s:
        vansh = await s.get(Vendor, ids["vansh"])
        vansh.gstin = GSTIN
        s.add(Vendor(code="JSTECH", name="JS Technology"))                  # same NAME as the ERP supplier, no GSTIN
        await s.commit()
    erp.vendor_list = [ErpVendor("61", "JS TECHNOLOGY", gstin=GSTIN, company_code="CKVPL")]
    [row] = (await client.get("/api/erp/vendors", params={"company_id": ids["vpl"]}, headers=h)).json()
    assert row["suggested_vendor_id"] == ids["vansh"] and row["suggestion_reason"] == "gstin"
    # without a GSTIN match the name decides
    erp.vendor_list = [ErpVendor("62", "JS TECHNOLOGY", company_code="CKVPL")]
    [row] = (await client.get("/api/erp/vendors", params={"company_id": ids["vpl"]}, headers=h)).json()
    assert row["suggested_vendor_id"] == await vendor_id("JSTECH") and row["suggestion_reason"] == "name"


async def test_a_vendor_without_its_own_gstin_is_found_through_the_gstin_the_erp_holds_for_its_linked_supplier(client, erp):
    from tests.erp.fake_warehouse import FakeWarehouse, wh_item, wh_line, wh_vendor
    from app.erp.sync import run_sync
    ids = await _setup()
    # VANSH has no GSTIN of its own but is linked to CKSPL's supplier 11338, whose GSTIN is in CKAM's copy of the ERP data
    wh = FakeWarehouse()
    wh.lines = [wh_line("CKSPL", "A1", supplier_code="11338")]
    wh.vendor_list = [wh_vendor("CKSPL", "11338", "VANSH ENTERPRISES", gstin=GSTIN)]
    wh.item_list = [wh_item("CT371487")]
    await run_sync(SessionLocal, wh, "manual")
    erp.vendor_list = [ErpVendor("61", "A DIFFERENT NAME ALTOGETHER", gstin=GSTIN, company_code="CKVPL")]
    [row] = (await client.get("/api/erp/vendors", params={"company_id": ids["vpl"]}, headers=await _headers(client))).json()
    assert row["suggested_vendor_id"] == ids["vansh"] and row["suggestion_reason"] == "gstin"
    # and adding it as a new vendor is refused for the same reason
    resp = await client.post("/api/erp/vendors/import", headers=await _headers(client), json=link(ids["vpl"], "61"))
    assert resp.status_code == 422 and "same GSTIN as Vansh Enterprises" in resp.json()["detail"]


async def test_linking_fills_in_the_vendors_gstin_when_it_has_none_and_never_overwrites_one(client, erp):
    ids = await _ids_for_gstin()
    h = await _headers(client)
    erp.vendor_list = [ErpVendor("555", "Harshit Infosolution", gstin=" 07afzpc6360h1z3 ", company_code="CKSPL"),
                       ErpVendor("405", "HARSHIT INFOSOLUTION", gstin="07AFZPC6360H1Z3", company_code="CKVPL")]
    ok = await client.post(f"/api/erp/vendors/{ids['harshit']}/link", headers=h, json=link(ids["spl"], "555"))
    assert ok.status_code == 200, ok.text
    assert ok.json()["gstin"] == "07afzpc6360h1z3"
    # a GSTIN already on the vendor is kept, even when the other company's supplier shows another
    async with SessionLocal() as s:
        (await s.get(Vendor, ids["harshit"])).gstin = "09BBBBB1111B1Z1"
        await s.commit()
    again = await client.post(f"/api/erp/vendors/{ids['harshit']}/link", headers=h, json=link(ids["vpl"], "405"))
    assert again.status_code == 200 and again.json()["gstin"] == "09BBBBB1111B1Z1"


async def _ids_for_gstin():
    return await _setup()


async def test_a_supplier_linked_in_this_company_shows_its_vendor_not_a_suggestion(client, erp):
    ids = await _setup()
    erp.vendor_list = [ErpVendor("11338", "VANSH ENTERPRISES", gstin=GSTIN, company_code="CKSPL")]
    [row] = (await client.get("/api/erp/vendors", params={"company_id": ids["spl"]}, headers=await _headers(client))).json()
    assert row["linked_vendor_id"] == ids["vansh"] and row["suggested_vendor_id"] is None and row["company_id"] == ids["spl"]


async def test_adding_a_supplier_whose_gstin_is_already_a_vendor_is_refused_with_a_hint(client, erp):
    ids = await _setup()
    async with SessionLocal() as s:
        (await s.get(Vendor, ids["vansh"])).gstin = GSTIN
        await s.commit()
    erp.vendor_list = [ErpVendor("61", "VANSH ENTERPRISES PVT LTD", gstin=GSTIN.lower(), company_code="CKVPL")]
    resp = await client.post("/api/erp/vendors/import", headers=await _headers(client), json=link(ids["vpl"], "61"))
    assert resp.status_code == 422 and "same GSTIN as Vansh Enterprises" in resp.json()["detail"] and "Link it" in resp.json()["detail"]


async def test_a_code_already_used_by_the_other_company_gets_the_company_in_front(client, erp):
    ids = await _setup()
    h = await _headers(client)
    erp.vendor_list = [ErpVendor("2264", "JAGANNATH ENTERPRISES", gstin="09BBBBB1111B1Z1", company_code="CKSPL"),
                       ErpVendor("2264", "A TOTALLY DIFFERENT SUPPLIER", gstin="27CCCCC2222C1Z2", company_code="CKVPL")]
    first = await client.post("/api/erp/vendors/import", headers=h, json=link(ids["spl"], "2264"))
    second = await client.post("/api/erp/vendors/import", headers=h, json=link(ids["vpl"], "2264"))
    assert first.status_code == 201 and second.status_code == 201, second.text
    assert first.json()["code"] == "2264" and second.json()["code"] == "CKVPL-2264"
    assert second.json()["name"] == "A TOTALLY DIFFERENT SUPPLIER"


async def test_an_unknown_company_is_a_404(client, erp):
    await _setup()
    resp = await client.get("/api/erp/vendors", params={"company_id": 99999}, headers=await _headers(client))
    assert resp.status_code == 404


async def test_the_picker_offers_the_pos_of_both_companies_matched_by_company_and_code(client, erp):
    ids = await _setup()
    h = await _headers(client)
    erp.vendor_list = [ErpVendor("61", "VANSH ENTERPRISES", company_code="CKVPL")]
    await client.post(f"/api/erp/vendors/{ids['vansh']}/link", headers=h, json=link(ids["vpl"], "61"))
    erp.pos[2001] = desktop_po(po_code=2001, po_number="PO/00000060/26-27", company_code="CKVPL", supplier_code="61", delivery_location="CKVPL-WH-TAJNAGAR")
    # CKSPL's own supplier "61" is not linked in CKSPL, so this PO is not offered; and 11338 exists only in CKSPL
    erp.pos[2002] = desktop_po(po_code=2002, po_number="SPO/2", company_code="CKSPL", supplier_code="61")
    erp.pos[2003] = desktop_po(po_code=2003, po_number="PO/3", company_code="CKVPL", supplier_code="11338")
    resp = await client.get("/api/erp/pos", headers=h)
    assert resp.status_code == 200, resp.text
    got = {(p["po_number"], p["company_code"], p["company_id"], p["vendor_id"]) for p in resp.json()}
    assert got == {("SPO/012994/26-27", "CKSPL", ids["spl"], ids["vansh"]), ("PO/00000060/26-27", "CKVPL", ids["vpl"], ids["vansh"])}


async def test_a_po_whose_supplier_is_linked_only_in_the_other_company_has_no_vendor_in_its_draft(client, erp):
    ids = await _setup()
    erp.pos[2003] = desktop_po(po_code=2003, po_number="PO/3", company_code="CKVPL", supplier_code="11338", delivery_location="CKVPL-WH-TAJNAGAR")
    resp = await client.get("/api/erp/pos/2003/draft", headers=await _headers(client))
    assert resp.status_code == 200, resp.text
    draft = resp.json()
    assert draft["company_id"] == ids["vpl"] and draft["vendor_id"] is None
    assert any("not linked to a CKAM vendor for Citykart Ventures Pvt Ltd" in w for w in draft["warnings"])
    assert draft["company_name"] == "Citykart Ventures Pvt Ltd"


async def test_the_link_table_keeps_each_company_apart_in_the_database():
    ids = await _setup()
    async with SessionLocal() as s:
        s.add_all([VendorErpLink(vendor_id=ids["oldco"], company_id=ids["vpl"], erp_vendor_code="11338")])
        await s.commit()
        rows = (await s.execute(select(VendorErpLink.company_id, VendorErpLink.erp_vendor_code, VendorErpLink.vendor_id)
                                .where(VendorErpLink.erp_vendor_code == "11338"))).all()
        assert sorted(rows) == sorted([(ids["spl"], "11338", ids["vansh"]), (ids["vpl"], "11338", ids["oldco"])])
