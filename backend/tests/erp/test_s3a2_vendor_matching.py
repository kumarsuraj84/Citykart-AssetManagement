"""S3a-2: matching ERP suppliers to CKAM vendors by GSTIN, then PAN, then name stem -- suggestions only --
and linking / creating for several registrations of one supplier at once (all or nothing)."""
import pytest
from sqlalchemy import func, select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.erp.source import ErpVendor
from app.erp.vendors import group_key, name_stem, pan_of, suggest_vendors
from app.masters.models import Vendor, VendorErpLink
from tests.erp.s3a2_world import BLUE_STAR_SPL, BS_MP, BS_NOGST, BS_UP, BS_WB, PAN, add_vendor, build_s3a2_world
from tests.erp.test_erp_api import _headers, erp  # noqa: F401  (erp is a fixture)


# ---------- the matching rules themselves ----------

@pytest.mark.parametrize("gstin, pan", [
    (f"09{PAN}1Z0", PAN), (f" 23{PAN.lower()}1z0 ", PAN), ("07AAAAA0000A1Z5", "AAAAA0000A"),
    ("", None), (None, None), ("09AAACB4487D1Z", None),          # 14 characters
    ("XXAAACB4487D1Z0", None),                                    # no state digits
    ("091234567890AZ0", None),                                    # characters 3-12 are not a PAN
])
def test_the_pan_is_read_from_a_valid_gstin_only(gstin, pan):
    assert pan_of(gstin) == pan


@pytest.mark.parametrize("name", [
    "BLUE STAR LIMITED", "BLUE STAR LTD (MP)", "Blue Star Limited-KOLKATA", "BLUE STAR LIMITED : UP", "Blue Star Ltd.",
    "M/S BLUE STAR PVT. LTD.", "Blue Star Private Limited", "BLUE STAR LTD MP", "The Blue Star Co.",
])
def test_name_spellings_of_one_supplier_share_one_stem(name):
    assert name_stem(name) == "BLUESTAR"


def test_a_stem_does_not_cut_real_words_and_refuses_tiny_names():
    assert name_stem("HARSHIT INFO-SOLUTION") == "HARSHITINFOSOLUTION"       # "-SOLUTION" is not a place
    assert name_stem("VANSH ENTERPRISES_DEL") == name_stem("Vansh Enterprises") == "VANSHENTERPRISES"
    assert name_stem("M/S BLUE STAR LTD/MUMBAI") == "BLUESTAR"
    assert name_stem("XY LTD") is None and name_stem("") is None and name_stem(None) is None


def test_suggestions_come_strongest_first_gstin_then_pan_then_name():
    by_gstin = Vendor(id=1, code="BSUP", name="Something Else", gstin=f"09{PAN}1Z0")
    by_pan = Vendor(id=2, code="BSMH", name="Other Name", gstin=f"27{PAN}1Z5")
    by_name = Vendor(id=3, code="BLUE", name="Blue Star")
    unrelated = Vendor(id=4, code="X", name="Godrej", gstin="07AAAAA0000A1Z5")
    vendors = [unrelated, by_name, by_pan, by_gstin]
    found = suggest_vendors(ErpVendor(BS_UP, "BLUE STAR LIMITED", gstin=f"09{PAN}1Z0"), vendors)
    assert [(v.id, r) for v, r in found] == [(1, "GSTIN"), (2, "PAN"), (3, "NAME")]
    # without a GSTIN only the name can match
    assert [(v.id, r) for v, r in suggest_vendors(ErpVendor(BS_NOGST, "BLUE STAR LIMITED : UP"), vendors)] == [(3, "NAME")]
    assert group_key("CKSPL", "BS1", f"09{PAN}1Z0") == f"CKSPL:{PAN}" and group_key("CKSPL", "BS4", None) == "CKSPL:#BS4"


# ---------- GET /api/erp/vendors (head-office admin) ----------

async def test_the_supplier_list_shows_the_pan_group_and_suggests_the_vendor_the_siblings_are_linked_to(client, erp):
    ids = await build_s3a2_world(erp)
    h = await _headers(client)
    blue = await add_vendor("Blue Star Limited")                      # no GSTIN of its own
    async with SessionLocal() as s:
        s.add(VendorErpLink(vendor_id=blue, company_id=ids["spl"], erp_vendor_code=BS_UP))
        await s.commit()
    rows = {r["erp_code"]: r for r in (await client.get("/api/erp/vendors", params={"company_id": ids["spl"]}, headers=h)).json()}
    up, mp, wb, nogst = rows[BS_UP], rows[BS_MP], rows[BS_WB], rows[BS_NOGST]
    assert (up["pan"], up["group_key"], up["group_size"]) == (PAN, f"CKSPL:{PAN}", 3)
    assert up["linked_vendor_id"] == blue and up["group_linked_to_vendor_id"] is None
    assert (mp["group_linked_to_vendor_id"], mp["suggested_vendor_id"], mp["suggestion_reason"]) == (blue, blue, "pan")
    assert wb["suggested_vendor_id"] == blue
    # the registration without a GSTIN has no PAN group, but its name still points at the vendor
    assert (nogst["pan"], nogst["group_size"], nogst["suggested_vendor_id"], nogst["suggestion_reason"]) == (None, 1, blue, "name")
    assert rows["2264"]["group_key"] == "CKSPL:#2264"


async def test_a_vendor_with_another_state_registration_is_suggested_by_pan(client, erp):
    ids = await build_s3a2_world(erp)
    mh = await add_vendor("BS Maharashtra Branch", gstin=f"27{PAN}1Z5")
    rows = {r["erp_code"]: r for r in (await client.get("/api/erp/vendors", params={"company_id": ids["spl"]},
                                                         headers=await _headers(client))).json()}
    assert (rows[BS_MP]["suggested_vendor_id"], rows[BS_MP]["suggestion_reason"]) == (mh, "pan")


# ---------- link-many ----------

async def _links(company_id):
    async with SessionLocal() as s:
        return dict((await s.execute(select(VendorErpLink.erp_vendor_code, VendorErpLink.vendor_id)
                                     .where(VendorErpLink.company_id == company_id))).all())


async def test_an_operator_links_every_registration_to_one_vendor_in_one_go(client, erp):
    ids = await build_s3a2_world(erp)
    blue = await add_vendor("Blue Star Limited")
    resp = await client.post(f"/api/erp/vendors/{blue}/link-many", headers=await _headers(client, "OPR"),
                             json={"company_id": ids["spl"], "erp_vendor_codes": [BS_UP, BS_MP, BS_WB, BS_MP]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["linked"] == [BS_UP, BS_MP, BS_WB] and body["already_linked"] == []
    assert body["vendor"]["gstin"] == f"09{PAN}1Z0"                     # an empty GSTIN is filled from the first registration
    links = await _links(ids["spl"])
    assert all(links[c] == blue for c in (BS_UP, BS_MP, BS_WB))
    async with SessionLocal() as s:
        creators = set((await s.execute(select(VendorErpLink.created_by).where(VendorErpLink.vendor_id == blue))).scalars().all())
        opr = (await s.execute(select(AssetUser.id).where(AssetUser.code == "OPR"))).scalar_one()
    assert creators == {opr}                                               # the actor is recorded
    again = await client.post(f"/api/erp/vendors/{blue}/link-many", headers=await _headers(client, "OPR"),
                              json={"company_id": ids["spl"], "erp_vendor_codes": [BS_UP, BS_NOGST]})
    assert again.status_code == 200 and again.json()["linked"] == [BS_NOGST] and again.json()["already_linked"] == [BS_UP]


async def test_link_many_is_all_or_nothing(client, erp):
    ids = await build_s3a2_world(erp)
    blue = await add_vendor("Blue Star Limited")
    h = await _headers(client, "OPR")
    # one unknown code: nothing is linked
    bad = await client.post(f"/api/erp/vendors/{blue}/link-many", headers=h,
                            json={"company_id": ids["spl"], "erp_vendor_codes": [BS_UP, "NOPE"]})
    assert bad.status_code == 422 and "NOPE was not found in the ERP" in bad.json()["detail"]
    # one code already linked to another vendor: nothing is linked
    taken = await client.post(f"/api/erp/vendors/{blue}/link-many", headers=h,
                              json={"company_id": ids["spl"], "erp_vendor_codes": [BS_UP, "11338"]})
    assert taken.status_code == 422 and "already linked to the vendor Vansh Enterprises" in taken.json()["detail"]
    assert BS_UP not in await _links(ids["spl"])


async def test_link_many_refuses_a_gstin_that_is_another_vendors(client, erp):
    ids = await build_s3a2_world(erp)
    other = await add_vendor("Blue Star UP Office", gstin=f"09{PAN}1Z0")
    blue = await add_vendor("Blue Star Limited")
    resp = await client.post(f"/api/erp/vendors/{blue}/link-many", headers=await _headers(client, "OPR"),
                             json={"company_id": ids["spl"], "erp_vendor_codes": [BS_MP, BS_UP]})
    assert resp.status_code == 422
    assert resp.json()["detail"] == ("BLUE STAR LIMITED has the same GSTIN as Blue Star UP Office, which is already a vendor here. "
                                     "Link it to Blue Star UP Office instead.")
    assert other and await _links(ids["spl"]) == {"11338": ids["vansh"]}


async def test_link_many_scope_roles_and_inactive_vendor(client, erp):
    ids = await build_s3a2_world(erp)
    blue = await add_vendor("Blue Star Limited")
    body = {"company_id": ids["spl"], "erp_vendor_codes": [BS_UP]}
    other_company = await client.post(f"/api/erp/vendors/{blue}/link-many", headers=await _headers(client, "OPV"), json=body)
    assert other_company.status_code == 403 and "your own company" in other_company.json()["detail"]
    assert (await client.post(f"/api/erp/vendors/{blue}/link-many", headers=await _headers(client, "VWR"), json=body)).status_code == 403
    assert (await client.post("/api/erp/vendors/999999/link-many", headers=await _headers(client, "OPR"), json=body)).status_code == 404
    async with SessionLocal() as s:
        (await s.get(Vendor, blue)).is_active = False
        await s.commit()
    gone = await client.post(f"/api/erp/vendors/{blue}/link-many", headers=await _headers(client, "OPR"), json=body)
    assert gone.status_code == 422 and "no longer active" in gone.json()["detail"]


# ---------- import-group ----------

async def test_import_group_creates_one_vendor_for_every_registration(client, erp):
    ids = await build_s3a2_world(erp)
    resp = await client.post("/api/erp/vendors/import-group", headers=await _headers(client, "OPR"),
                             json={"company_id": ids["spl"], "erp_vendor_codes": [BS_NOGST, BS_UP, BS_MP]})
    assert resp.status_code == 201, resp.text
    v = resp.json()
    # named after the first one, the first GSTIN found, a code made from the name
    assert (v["name"], v["gstin"], v["code"]) == ("BLUE STAR LIMITED : UP", f"09{PAN}1Z0", "BLUESTARLIMITEDUP")
    assert sorted(l["erp_vendor_code"] for l in v["erp_links"]) == sorted([BS_NOGST, BS_UP, BS_MP])
    named = await client.post("/api/erp/vendors/import-group", headers=await _headers(client),
                              json={"company_id": ids["vpl"], "erp_vendor_codes": ["77"], "name": "Blue Star (Ventures)"})
    # the CKVPL registration has the same PAN but its own GSTIN: a new vendor is allowed (a person chose it)
    assert named.status_code == 201 and named.json()["name"] == "Blue Star (Ventures)"


async def test_import_group_refuses_linked_codes_and_gstin_twins_and_creates_nothing(client, erp):
    ids = await build_s3a2_world(erp)
    h = await _headers(client, "OPR")
    linked = await client.post("/api/erp/vendors/import-group", headers=h,
                               json={"company_id": ids["spl"], "erp_vendor_codes": [BS_UP, "11338"]})
    assert linked.status_code == 422 and "VANSH ENTERPRISES is already a vendor here" in linked.json()["detail"]
    await add_vendor("BS Madhya Pradesh", gstin=f"23{PAN}1Z0")
    twin = await client.post("/api/erp/vendors/import-group", headers=h,
                             json={"company_id": ids["spl"], "erp_vendor_codes": [BS_UP, BS_MP]})
    assert twin.status_code == 422
    assert twin.json()["detail"] == "BLUE STAR LTD (MP) is already a vendor here (same GSTIN as BS Madhya Pradesh). Link it instead."
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count()).select_from(Vendor).where(Vendor.name.ilike("BLUE STAR LIMITED%")))).scalar_one() == 0
    assert BS_UP not in await _links(ids["spl"])
    other = await client.post("/api/erp/vendors/import-group", headers=await _headers(client, "OPV"),
                              json={"company_id": ids["spl"], "erp_vendor_codes": [BS_UP]})
    assert other.status_code == 403


async def test_the_single_import_link_and_unlink_still_work(client, erp):
    ids = await build_s3a2_world(erp)
    h = await _headers(client)
    made = await client.post("/api/erp/vendors/import", headers=h, json={"company_id": ids["spl"], "erp_vendor_code": "2264"})
    assert made.status_code == 201 and made.json()["code"] == "2264"
    linked = await client.post(f"/api/erp/vendors/{ids['harshit']}/link", headers=h, json={"company_id": ids["spl"], "erp_vendor_code": BS_UP})
    assert linked.status_code == 200
    gone = await client.delete(f"/api/erp/vendors/{ids['harshit']}/link", params={"company_id": ids["spl"], "erp_vendor_code": BS_UP}, headers=h)
    assert gone.status_code == 200 and gone.json()["erp_links"] == []


def test_nothing_is_ever_linked_by_a_suggestion_alone():
    # suggest_vendors only returns candidates; it has no session and writes nothing
    assert suggest_vendors(BLUE_STAR_SPL[0], []) == []
