"""S3a-1: inside a PO review an ADMIN or OPERATOR may add a vendor from an ERP
supplier, or link the supplier to an existing vendor -- only for a company they
work in. Unlinking (and the full supplier list) stay with the head-office
admin. Every link records who made it."""
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.erp.source import ErpVendor
from app.masters.models import Location, Vendor, VendorErpLink
from tests.erp.test_erp_api import _headers, _setup, erp  # noqa: F401  (erp is a fixture)

GSTIN = "07AAAAA0000A1Z5"


async def _add_admin(ids: dict) -> int:
    async with SessionLocal() as s:
        loc = (await s.execute(select(Location.id).where(Location.company_id == ids["spl"]))).scalars().first()
        admin = AssetUser(company_id=ids["spl"], code="ADM", name="Admin", asset_user_type="EMPLOYEE", location_id=loc,
                          role="ADMIN", login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        s.add(admin)
        await s.commit()
        return admin.id


async def _user_id(code: str) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(AssetUser.id).where(AssetUser.code == code))).scalar_one()


async def _link(company_id: int, code: str) -> VendorErpLink:
    async with SessionLocal() as s:
        return (await s.execute(select(VendorErpLink).where(
            VendorErpLink.company_id == company_id, VendorErpLink.erp_vendor_code == code))).scalar_one()


async def test_an_operator_adds_a_vendor_from_an_erp_supplier_of_their_company(client, erp):
    ids = await _setup()
    op = await _headers(client, "OPR")
    resp = await client.post("/api/erp/vendors/import", headers=op, json={"company_id": ids["spl"], "erp_vendor_code": "2264"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "JAGANNATH ENTERPRISES"
    assert [(l["company_code"], l["erp_vendor_code"]) for l in resp.json()["erp_links"]] == [("CKSPL", "2264")]
    assert (await _link(ids["spl"], "2264")).created_by == await _user_id("OPR")


async def test_an_operator_links_a_supplier_to_an_existing_vendor(client, erp):
    ids = await _setup()
    op = await _headers(client, "OPR")
    resp = await client.post(f"/api/erp/vendors/{ids['harshit']}/link", headers=op, json={"company_id": ids["spl"], "erp_vendor_code": "555"})
    assert resp.status_code == 200, resp.text
    link = await _link(ids["spl"], "555")
    assert link.vendor_id == ids["harshit"] and link.created_by == await _user_id("OPR")


async def test_an_operator_cannot_add_or_link_for_another_company(client, erp):
    ids = await _setup()
    erp.vendor_list.append(ErpVendor("77", "VPL SUPPLIER", company_code="CKVPL"))
    op = await _headers(client, "OPR")
    imported = await client.post("/api/erp/vendors/import", headers=op, json={"company_id": ids["vpl"], "erp_vendor_code": "77"})
    assert imported.status_code == 403
    assert imported.json()["detail"].startswith("You can only add a vendor link for your own company.")
    linked = await client.post(f"/api/erp/vendors/{ids['oldco']}/link", headers=op, json={"company_id": ids["vpl"], "erp_vendor_code": "77"})
    assert linked.status_code == 403
    async with SessionLocal() as s:
        assert (await s.execute(select(VendorErpLink).where(VendorErpLink.company_id == ids["vpl"]))).first() is None


async def test_an_admin_works_for_every_company(client, erp):
    ids = await _setup()
    await _add_admin(ids)
    erp.vendor_list.append(ErpVendor("77", "VPL SUPPLIER", company_code="CKVPL"))
    admin = await _headers(client, "ADM")
    resp = await client.post("/api/erp/vendors/import", headers=admin, json={"company_id": ids["vpl"], "erp_vendor_code": "77"})
    assert resp.status_code == 201, resp.text
    unlink = await client.delete(f"/api/erp/vendors/{resp.json()['id']}/link", headers=admin,
                                 params={"company_id": ids["vpl"], "erp_vendor_code": "77"})
    assert unlink.status_code == 403
    assert unlink.json()["detail"] == "Only the head-office admin can do this."


async def test_a_viewer_can_do_none_of_it_and_the_owner_still_can(client, erp):
    ids = await _setup()
    viewer = await _headers(client, "VWR")
    body = {"company_id": ids["spl"], "erp_vendor_code": "2264"}
    assert (await client.post("/api/erp/vendors/import", headers=viewer, json=body)).status_code == 403
    assert (await client.post(f"/api/erp/vendors/{ids['oldco']}/link", headers=viewer, json=body)).status_code == 403
    owner = await _headers(client)
    assert (await client.post("/api/erp/vendors/import", headers=owner, json=body)).status_code == 201
    gone = await client.delete(f"/api/erp/vendors/{ids['vansh']}/link", headers=owner,
                               params={"company_id": ids["spl"], "erp_vendor_code": "11338"})
    assert gone.status_code == 200 and gone.json()["erp_links"] == []


async def test_the_existing_safeguards_still_apply_to_operators(client, erp):
    ids = await _setup()
    async with SessionLocal() as s:
        (await s.get(Vendor, ids["oldco"])).gstin = GSTIN
        await s.commit()
    op = await _headers(client, "OPR")
    erp.vendor_list.append(ErpVendor("999", "OLD COMPANY AGAIN", gstin=GSTIN))     # same GSTIN as an existing vendor
    twin = await client.post("/api/erp/vendors/import", headers=op, json={"company_id": ids["spl"], "erp_vendor_code": "999"})
    assert twin.status_code == 422 and "Link it instead" in twin.json()["detail"]
    taken = await client.post(f"/api/erp/vendors/{ids['oldco']}/link", headers=op, json={"company_id": ids["spl"], "erp_vendor_code": "11338"})
    assert taken.status_code == 422 and "already linked" in taken.json()["detail"]
