"""Vendors and purchase orders from the ERP (/api/erp/...). The ERP itself is
replaced by an in-memory stand-in; the real one is only ever read."""
from datetime import date
import pytest
from sqlalchemy import func, select
from app.asset_users.models import AssetUser
from app.bundles.models import Bundle, BundlePart
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.erp.models import ItemCatalog
from app.erp.service import derive_tax, split_location
from app.erp.source import ErpPo, ErpPoLine, ErpUnavailable, ErpVendor, get_erp_source
from app.main import app
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Department, Location, Vendor
from app.purchase_orders.models import PendingAsset, PurchaseOrder


def line(key, code, desc, qty, rate, tax=18.0, unit="PCS", group="FA_CE_DESKTOP", received=0, cancelled=0):
    return ErpPoLine(po_line_key=key, item_code=code, description=desc, group_code=group, hsn="84732900", unit=unit,
                     qty=qty, rate=rate, tax_percent=tax, line_net=qty * rate, received_qty=received, cancelled_qty=cancelled)


def desktop_po(**over):
    base = dict(po_code=1133610106, po_number="SPO/012994/26-27", po_date=date(2026, 9, 18), status="OPEN",
                company_code="CKSPL", company_name="CITYKART STORES PVT. LTD.", delivery_location="CKSPL-WH-TAJNAGAR",
                supplier_code="11338", supplier_name="VANSH ENTERPRISES", header_net=165200, header_charges=25200, line_count=1,
                lines=[line(1, "CT324973", "DELL DESKTOP REFURB/i3/7th Gen/8GB/256SSD/Dell K,M/1Y warranty/20'' DELL TFT", 7, 20000)])
    base.update(over)
    return ErpPo(**base)


class FakeErp:
    def __init__(self):
        self.vendor_list = [
            ErpVendor("11338", "VANSH ENTERPRISES", gstin="07AAAAA0000A1Z5", contact_name="Mr Vansh", phone="9999999999"),
            ErpVendor("2264", "JAGANNATH ENTERPRISES"),
            ErpVendor("555", "Harshit Infosolution"),
        ]
        self.pos = {1133610106: desktop_po()}
        self.down: str | None = None

    async def vendors(self):
        if self.down:
            raise ErpUnavailable(self.down)
        return self.vendor_list

    async def open_pos(self, supplier_codes):
        if self.down:
            raise ErpUnavailable(self.down)
        return [p for p in self.pos.values() if p.supplier_code in supplier_codes and p.status == "OPEN"]

    async def po(self, po_code):
        if self.down:
            raise ErpUnavailable(self.down)
        return self.pos.get(po_code)


@pytest.fixture
def erp():
    fake = FakeErp()
    app.dependency_overrides[get_erp_source] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_erp_source, None)


async def _setup():
    async with SessionLocal() as session:
        spl = Company(code="CKSPL", name="Citykart Stores Pvt Ltd")
        vpl = Company(code="CKVPL", name="Citykart Ventures Pvt Ltd")
        comp = AssetCategory(code="COMP", name="Computers", asset_domain="IT")
        mon = AssetCategory(code="MON", name="Monitors", asset_domain="IT")
        acc = AssetCategory(code="ACC", name="Accessories", asset_domain="IT")
        session.add_all([spl, vpl, comp, mon, acc, Brand(code="DELL", name="Dell"), Department(name="IT")])
        await session.flush()
        cpu, tft, kb, ms = (AssetSubcategory(category_id=c.id, code=code, name=name, serial_required=serial)
                            for c, code, name, serial in (
            (comp, "CPU", "CPU", None), (mon, "TFT", "TFT", None), (acc, "KB", "Keyboard", False), (acc, "MS", "Mouse", False)))
        cables = AssetSubcategory(category_id=acc.id, code="CBL", name="Cable")
        session.add_all([cpu, tft, kb, ms, cables])
        await session.flush()
        spl_loc = Location(company_id=spl.id, code="SPL-HO", name="HO")
        vpl_loc = Location(company_id=vpl.id, code="VPL-HO", name="HO")
        dept = (await session.execute(select(Department))).scalars().first()
        session.add_all([
            spl_loc, vpl_loc,
            CostCenter(company_id=spl.id, code="CKSPL", name="CKSPL"),
            CostCenter(company_id=vpl.id, code="CKVPL", name="CKVPL"),
            Vendor(code="VANSH", name="Vansh Enterprises", erp_vendor_code="11338"),     # linked
            Vendor(code="HARSHIT_INF", name="Harshit Infosolution"),                       # same name as ERP 555, not linked
            Vendor(code="OLDCO", name="Old Company"),
        ])
        await session.flush()

        def user(co, loc, code, name, role, type_="EMPLOYEE", owner=False):
            return AssetUser(company_id=co.id, code=code, name=name, asset_user_type=type_, location_id=loc.id,
                             department_id=dept.id, role=role, is_primary_owner=owner,
                             login_enabled=role != "SELF_SERVICE", password_hash=hash_password("Passw0rd!"),
                             must_change_password=False)
        taj = user(spl, spl_loc, "WH-TAJ", "WH Tajnagar Stores", "SELF_SERVICE", "STOCK_POINT")
        faru = user(spl, spl_loc, "WH-FAR", "WH Farukhnagar Stores", "SELF_SERVICE", "STOCK_POINT")
        vtaj = user(vpl, vpl_loc, "VWH-TAJ", "WH Tajnagar Stores", "SELF_SERVICE", "STOCK_POINT")
        owner = user(spl, spl_loc, "OWN", "Owner", "ADMIN", owner=True)
        op = user(spl, spl_loc, "OPR", "Operator", "OPERATOR")
        viewer = user(spl, spl_loc, "VWR", "Viewer", "VIEWER")
        session.add_all([taj, faru, vtaj, owner, op, viewer])
        await session.flush()

        desktop = Bundle(name="Desktop", created_by=owner.id, updated_by=owner.id)
        session.add(desktop)
        await session.flush()
        for order, (name, cat, sub, share) in enumerate((
            ("CPU", comp, cpu, 70), ("TFT", mon, tft, 26), ("Keyboard", acc, kb, 2), ("Mouse", acc, ms, 2),
        )):
            session.add(BundlePart(bundle_id=desktop.id, name=name, category_id=cat.id, subcategory_id=sub.id,
                                   share_percent=share, sort_order=order))
        await session.commit()
        return {"spl": spl.id, "vpl": vpl.id, "taj": taj.id, "faru": faru.id, "vtaj": vtaj.id,
                "desktop": desktop.id, "acc": acc.id, "cables": cables.id,
                "cost_spl": (await session.execute(select(CostCenter.id).where(CostCenter.company_id == spl.id))).scalar_one(),
                "vansh": (await session.execute(select(Vendor.id).where(Vendor.code == "VANSH"))).scalar_one(),
                "harshit": (await session.execute(select(Vendor.id).where(Vendor.code == "HARSHIT_INF"))).scalar_one(),
                "oldco": (await session.execute(select(Vendor.id).where(Vendor.code == "OLDCO"))).scalar_one()}


async def _headers(client, code="OWN"):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ---------- helpers ----------

def test_the_company_prefix_is_split_off_the_delivery_location():
    assert split_location(desktop_po()) == ("CKSPL-WH-TAJNAGAR", "WH-TAJNAGAR")
    assert split_location(desktop_po(delivery_location="SVP")) == ("SVP", "SVP")


def test_blank_tax_is_worked_out_from_the_po_tax_total_and_snapped_to_a_slab():
    po = desktop_po()                       # net 165,200 on 140,000 of lines = 18%
    assert derive_tax(po)[0] == 18.0
    odd = desktop_po(header_net=159000)     # 13.57% is no slab: kept as is
    assert derive_tax(odd)[0] == 13.57
    assert derive_tax(desktop_po(header_net=140000))[0] is None       # no tax on top of the lines
    assert derive_tax(desktop_po(header_net=0))[0] is None
    # Real POs exist whose net is more than the lines by far more than any GST
    # slab (a bad figure, not tax): never offered as a tax %.
    assert derive_tax(desktop_po(header_net=400000))[0] is None


# ---------- vendors ----------

async def test_the_erp_vendor_list_shows_links_and_suggestions(client, erp):
    ids = await _setup()
    resp = await client.get("/api/erp/vendors", headers=await _headers(client))
    assert resp.status_code == 200, resp.text
    by = {v["erp_code"]: v for v in resp.json()}
    assert by["11338"]["linked_vendor_id"] == ids["vansh"] and by["11338"]["suggested_vendor_id"] is None
    assert by["555"]["linked_vendor_id"] is None and by["555"]["suggested_vendor_id"] == ids["harshit"]   # same name
    assert by["2264"]["linked_vendor_id"] is None and by["2264"]["suggested_vendor_id"] is None


async def test_adding_a_vendor_from_the_erp_copies_its_details_and_links_it(client, erp):
    await _setup()
    h = await _headers(client)
    resp = await client.post("/api/erp/vendors/import", headers=h, json={"erp_vendor_code": "2264"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["code"], body["name"], body["erp_vendor_code"]) == ("2264", "JAGANNATH ENTERPRISES", "2264")
    again = await client.post("/api/erp/vendors/import", headers=h, json={"erp_vendor_code": "2264"})
    assert again.status_code == 422 and "already a vendor" in again.json()["detail"]
    unknown = await client.post("/api/erp/vendors/import", headers=h, json={"erp_vendor_code": "99999"})
    assert unknown.status_code == 422 and "not found in the ERP" in unknown.json()["detail"]


async def test_linking_an_existing_vendor_and_the_one_to_one_rule(client, erp):
    ids = await _setup()
    h = await _headers(client)
    ok = await client.post(f"/api/erp/vendors/{ids['harshit']}/link", headers=h, json={"erp_vendor_code": "555"})
    assert ok.status_code == 200 and ok.json()["erp_vendor_code"] == "555"
    taken = await client.post(f"/api/erp/vendors/{ids['oldco']}/link", headers=h, json={"erp_vendor_code": "555"})
    assert taken.status_code == 422 and "already linked" in taken.json()["detail"]
    gone = await client.delete(f"/api/erp/vendors/{ids['harshit']}/link", headers=h)
    assert gone.status_code == 200 and gone.json()["erp_vendor_code"] is None
    assert (await client.post("/api/erp/vendors/9999/link", headers=h, json={"erp_vendor_code": "555"})).status_code == 404


async def test_only_the_primary_owner_manages_vendor_links(client, erp):
    ids = await _setup()
    op = await _headers(client, "OPR")
    assert (await client.get("/api/erp/vendors", headers=op)).status_code == 403
    assert (await client.post("/api/erp/vendors/import", headers=op, json={"erp_vendor_code": "2264"})).status_code == 403
    assert (await client.post(f"/api/erp/vendors/{ids['oldco']}/link", headers=op, json={"erp_vendor_code": "2264"})).status_code == 403


async def test_a_down_erp_gives_a_clear_503_not_a_crash(client, erp):
    await _setup()
    erp.down = "The ERP database could not be reached (OSError)."
    h = await _headers(client)
    for path in ("/api/erp/vendors", "/api/erp/pos", "/api/erp/pos/1133610106/draft"):
        resp = await client.get(path, headers=h)
        assert resp.status_code == 503 and "could not be reached" in resp.json()["detail"]


# ---------- purchase orders ----------

async def test_only_open_pos_of_linked_vendors_are_offered(client, erp):
    await _setup()
    erp.pos[2] = desktop_po(po_code=2, po_number="SPO/2", supplier_code="2264", supplier_name="JAGANNATH ENTERPRISES")  # vendor not linked
    erp.pos[3] = desktop_po(po_code=3, po_number="SPO/3", status="CLOSED")
    resp = await client.get("/api/erp/pos", headers=await _headers(client, "OPR"))
    assert resp.status_code == 200
    assert [p["po_number"] for p in resp.json()] == ["SPO/012994/26-27"]


async def test_a_po_becomes_a_fully_matched_draft(client, erp):
    ids = await _setup()
    resp = await client.get("/api/erp/pos/1133610106/draft", headers=await _headers(client, "OPR"))
    assert resp.status_code == 200, resp.text
    d = resp.json()
    assert (d["po_number"], d["po_date"], d["erp_po_code"]) == ("SPO/012994/26-27", "2026-09-18", 1133610106)
    assert d["company_id"] == ids["spl"] and d["cost_center_id"] == ids["cost_spl"] and d["vendor_id"] == ids["vansh"]
    assert d["warehouse_code"] == "CKSPL-WH-TAJNAGAR" and d["delivery_asset_user_id"] == ids["taj"]
    assert d["warnings"] == [] and d["already_created_id"] is None
    [ln] = d["lines"]
    assert (ln["item_code"], ln["barcode"], ln["quantity"], ln["rate"], ln["tax_percent"]) == ("CT324973", "CT324973", 7, 20000.0, 18.0)
    assert ln["bundle_id"] == ids["desktop"] and ln["brand_id"] is not None and ln["warnings"] == []


async def test_unknown_company_vendor_and_location_are_left_empty_with_warnings(client, erp):
    await _setup()
    erp.pos[1133610106] = desktop_po(company_code="CKXYZ", supplier_code="777", delivery_location="CKXYZ-WH-MARS")
    d = (await client.get("/api/erp/pos/1133610106/draft", headers=await _headers(client, "OPR"))).json()
    assert d["company_id"] is None and d["cost_center_id"] is None and d["vendor_id"] is None
    assert any("No company with the code CKXYZ" in w for w in d["warnings"])
    assert any("not linked to a CKAM vendor" in w for w in d["warnings"])


async def test_blank_tax_odd_units_and_received_quantities_are_flagged_on_the_line(client, erp):
    await _setup()
    erp.pos[1133610106] = desktop_po(lines=[
        line(1, "CT1", "Thing A", 10, 1000, tax=None),
        line(2, "CT2", "Cable roll", 305, 30, unit="MTR", tax=18.0),
        line(3, "CT3", "Partly in", 4, 500, received=2),
        line(4, "CT4", "Cancelled out", 5, 500, cancelled=5),
    ], header_net=26170)     # 26,170 over 23,650 of lines = 10.66%: no GST slab, shown as worked out
    d = (await client.get("/api/erp/pos/1133610106/draft", headers=await _headers(client, "OPR"))).json()
    assert [l["item_code"] for l in d["lines"]] == ["CT1", "CT2", "CT3"]          # the fully cancelled line is dropped
    a, b, c = d["lines"]
    assert any("no tax %" in w for w in a["warnings"])
    assert any("MTR" in w for w in b["warnings"])
    assert any("already shows 2 received" in w for w in c["warnings"])


async def test_creating_from_the_draft_makes_ordinary_lines_and_remembers_the_erp_po(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    draft = (await client.get("/api/erp/pos/1133610106/draft", headers=h)).json()
    body = {k: draft[k] for k in ("erp_po_code", "po_number", "po_date", "company_id", "vendor_id", "cost_center_id",
                                  "delivery_asset_user_id", "warehouse_code")}
    ln = draft["lines"][0]
    body["lines"] = [{k: ln[k] for k in ("item_code", "group_code", "description", "barcode", "quantity", "rate",
                                         "tax_percent", "warranty_years", "bundle_id")} | {"remember": True}]
    resp = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert resp.status_code == 201, resp.text
    assert resp.json()["lines_created"] == 28
    po = (await client.get(f"/api/purchase-orders/{resp.json()['po_id']}", headers=h)).json()
    assert po["erp_po_code"] == 1133610106 and po["delivery_asset_user_id"] == ids["taj"]

    # It is no longer offered, a second create is refused, and the item is remembered.
    assert (await client.get("/api/erp/pos", headers=h)).json() == []
    again = await client.post("/api/erp/pos/create", headers=h, json=body | {"po_number": "OTHER"})
    assert again.status_code == 422 and "already created" in again.json()["detail"]
    redraft = (await client.get("/api/erp/pos/1133610106/draft", headers=h)).json()
    assert redraft["already_created_id"] is not None and any("already created" in w for w in redraft["warnings"])
    async with SessionLocal() as session:
        assert (await session.execute(select(func.count()).select_from(PendingAsset))).scalar_one() == 28
        mem = (await session.execute(select(ItemCatalog).where(ItemCatalog.item_code == "CT324973"))).scalar_one()
        assert mem.bundle_id == ids["desktop"]


async def test_a_plain_line_needs_its_category_and_the_whole_po_is_all_or_nothing(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    body = {
        "erp_po_code": 1133610106, "company_id": ids["spl"], "po_number": "SPO/9", "po_date": "2026-09-18",
        "vendor_id": ids["vansh"], "cost_center_id": ids["cost_spl"],
        "lines": [
            {"item_code": "CT1", "description": "Good", "barcode": "CT1", "quantity": 2, "rate": 100, "tax_percent": 18,
             "category_id": ids["acc"], "subcategory_id": ids["cables"]},
            {"item_code": "CT2", "description": "No category", "barcode": "CT2", "quantity": 1, "rate": 100, "tax_percent": 18},
        ],
    }
    resp = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert resp.status_code == 422 and "category and sub-category are required" in resp.json()["detail"]
    async with SessionLocal() as session:
        assert (await session.execute(select(func.count()).select_from(PurchaseOrder))).scalar_one() == 0


async def test_an_operator_cannot_create_a_po_for_another_company_and_a_viewer_cannot_use_it_at_all(client, erp):
    ids = await _setup()
    body = {"company_id": ids["vpl"], "po_number": "X", "po_date": "2026-09-18", "cost_center_id": ids["cost_spl"],
            "lines": [{"description": "d", "barcode": "b", "quantity": 1, "rate": 1}]}
    assert (await client.post("/api/erp/pos/create", headers=await _headers(client, "OPR"), json=body)).status_code in (403, 404)
    viewer = await _headers(client, "VWR")
    assert (await client.get("/api/erp/pos", headers=viewer)).status_code == 403
    assert (await client.get("/api/erp/pos/1133610106/draft", headers=viewer)).status_code == 403
    assert (await client.get("/api/erp/status", headers=viewer)).status_code == 403


async def test_the_status_says_whether_the_erp_is_set_up(client, monkeypatch):
    await _setup()
    from app.core.config import settings
    h = await _headers(client, "OPR")
    monkeypatch.setattr(settings, "po_source_host", None)
    assert (await client.get("/api/erp/status", headers=h)).json() == {"configured": False}
    for name, value in (("po_source_host", "h"), ("po_source_db", "d"), ("po_source_user", "u"), ("po_source_password", "p")):
        monkeypatch.setattr(settings, name, value)
    assert (await client.get("/api/erp/status", headers=h)).json() == {"configured": True}
