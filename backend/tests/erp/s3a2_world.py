"""Shared set-up for the S3a-2 tests (ERP exceptions, vendor matching, in-flow resolution, ERP inbox).

The ERP world of tests/erp/test_erp_api.py (CKSPL + CKVPL, owner OWN, operator OPR, viewer VWR, the Dell
desktop PO 1133610106 of the linked supplier VANSH) plus: IT-only and Non-IT-only operators, a CKVPL
operator, an ordinary ADMIN, a "Network Switch" Item (IT) and an "Office Chair" Item (Non-IT), and Blue Star
-- one business with several GST registrations in CKSPL (same PAN AAACB4487D, different states, different
name spellings) and one in CKVPL."""
from datetime import date

from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.erp.source import ErpVendor
from app.items.models import Item
from app.masters.models import AssetCategory, AssetSubcategory, Department, Location, Vendor
from tests.erp.test_erp_api import _headers, _setup, desktop_po, line  # noqa: F401  (re-exported)

PAN = "AAACB4487D"
BS_UP, BS_MP, BS_WB, BS_NOGST = "BS1", "BS2", "BS3", "BS4"

BLUE_STAR_SPL = [
    ErpVendor(BS_UP, "BLUE STAR LIMITED", gstin=f"09{PAN}1Z0", company_code="CKSPL"),
    ErpVendor(BS_MP, "BLUE STAR LTD (MP)", gstin=f"23{PAN}1Z0", company_code="CKSPL"),
    ErpVendor(BS_WB, "Blue Star Limited-KOLKATA", gstin=f"19{PAN}1ZX", company_code="CKSPL"),
    ErpVendor(BS_NOGST, "BLUE STAR LIMITED : UP", gstin=None, company_code="CKSPL"),
]
BLUE_STAR_VPL = ErpVendor("77", "BLUE STAR LTD", gstin=f"07{PAN}1Z1", company_code="CKVPL")


def bs_po(po_code=5001, supplier=BS_MP, name="BLUE STAR LTD (MP)", company="CKSPL", lines=None, **over):
    """An open ERP PO of a Blue Star registration: one cassette AC line (a code nobody decided yet)."""
    return desktop_po(po_code=po_code, po_number=f"SPO/BS/{po_code}", supplier_code=supplier, supplier_name=name,
                      company_code=company, delivery_location=f"{company}-WH-TAJNAGAR",
                      lines=lines or [line(1, "CT500001", "48 PORT SWITCH", 2, 9000)], **over)


async def build_s3a2_world(erp) -> dict:
    ids = await _setup()
    erp.vendor_list = [ErpVendor("11338", "VANSH ENTERPRISES", gstin="07AAAAA0000A1Z5", company_code="CKSPL"),
                       ErpVendor("2264", "JAGANNATH ENTERPRISES", company_code="CKSPL"),
                       *BLUE_STAR_SPL, BLUE_STAR_VPL]
    async with SessionLocal() as s:
        spl_loc = (await s.execute(select(Location).where(Location.code == "SPL-HO"))).scalar_one()
        vpl_loc = (await s.execute(select(Location).where(Location.code == "VPL-HO"))).scalar_one()
        dept = (await s.execute(select(Department))).scalars().first()

        def user(code, role, company, loc, domains=None):
            return AssetUser(company_id=company, code=code, name=code, asset_user_type="EMPLOYEE", location_id=loc.id,
                             department_id=dept.id, role=role, allowed_asset_domains=domains, login_enabled=True,
                             password_hash=hash_password("Passw0rd!"), must_change_password=False)
        s.add_all([user("OPIT", "OPERATOR", ids["spl"], spl_loc, "IT"), user("OPNI", "OPERATOR", ids["spl"], spl_loc, "NON_IT"),
                   user("OPV", "OPERATOR", ids["vpl"], vpl_loc), user("ADM", "ADMIN", ids["spl"], spl_loc)])
        comp = (await s.execute(select(AssetCategory).where(AssetCategory.code == "COMP"))).scalar_one()
        cpu = (await s.execute(select(AssetSubcategory).where(AssetSubcategory.code == "CPU"))).scalar_one()
        switch = Item(name="Network Switch", category_id=comp.id, subcategory_id=cpu.id)
        furniture = AssetCategory(code="FURN", name="Furniture", asset_domain="NON_IT")
        s.add_all([switch, furniture])
        await s.flush()
        chair_sub = AssetSubcategory(category_id=furniture.id, code="CHR", name="Chair")
        s.add(chair_sub)
        await s.flush()
        chair = Item(name="Office Chair", category_id=furniture.id, subcategory_id=chair_sub.id)
        s.add(chair)
        await s.commit()
        ids.update({"item_switch": switch.id, "item_chair": chair.id, "cpu_sub": cpu.id, "chair_sub": chair_sub.id})
    return ids


async def add_vendor(name, gstin=None, code=None) -> int:
    async with SessionLocal() as s:
        v = Vendor(code=code or name.upper().replace(" ", "")[:30], name=name, gstin=gstin)
        s.add(v)
        await s.commit()
        return v.id


def create_body(draft: dict, ids: dict, **over) -> dict:
    """A create request built from a draft, as the review screen sends it (each line with the given Item)."""
    body = {k: draft[k] for k in ("erp_po_code", "po_number", "po_date", "company_id", "vendor_id", "cost_center_id",
                                  "delivery_asset_user_id", "warehouse_code")}
    body["lines"] = [{**{k: ln[k] for k in ("item_code", "description", "barcode", "quantity", "rate", "tax_percent", "warranty_years")},
                      "item_id": ln["item_id"] or ids["item_switch"]} for ln in draft["lines"]]
    body.update(over)
    return body


TODAY = date.today().isoformat()
