"""Vendors and purchase orders from the ERP (/api/erp/...). The ERP itself is
replaced by an in-memory stand-in; the real one is only ever read."""
from datetime import date
import pytest
from sqlalchemy import func, select
from app.asset_users.models import AssetUser
from app.bundles.models import Bundle, BundlePart
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.erp.service import derive_tax, split_location
from app.erp.source import (
    ErpArticle, ErpArticleCode, ErpInvoice, ErpItem, ErpPo, ErpPoLine, ErpReceipt, ErpUnavailable, ErpVendor, get_erp_source,
)
from app.items.models import Item, ItemMap
from app.main import app
from app.numbering.models import CodeRule
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
        self.receipt_list: list[ErpReceipt] = []
        self.invoice_list: list[ErpInvoice] = []
        # The ERP item master: the Dell desktop sits in Article "02-I3 CORE[IT-01]".
        self.erp_items = {
            "CT324973": ErpItem("CT324973", "02-I3 CORE[IT-01]", "02-I3 CORE[IT-01]", "IT EQUIPMENTS", "FA_CE_DESKTOP",
                                cats=["DELL DESKTOP REFURB/i3", "HARSHIT INFOSOLUTION"]),
            # a second vendor code for the same Article -> lands on the same Item by itself
            "CT999001": ErpItem("CT999001", "02-I3 CORE[IT-01]", "02-I3 CORE[IT-01]", "IT EQUIPMENTS", "FA_CE_DESKTOP",
                                cats=["LENOVO DESKTOP I3", "OTHER VENDOR"]),
            # a catch-all Article: products told apart by their name
            "CT500001": ErpItem("CT500001", "FA_IT_OTHERS", "FA_IT_OTHERS", "IT EQUIPMENTS", "FA_IT_OTHERS", cats=["48 PORT SWITCH"]),
            "CT500002": ErpItem("CT500002", "FA_IT_OTHERS", "FA_IT_OTHERS", "IT EQUIPMENTS", "FA_IT_OTHERS", cats=["6U RACK"]),
        }
        self.articles = [
            ErpArticle("02-I3 CORE[IT-01]", "02-I3 CORE[IT-01]", "IT EQUIPMENTS", "FA_CE_DESKTOP", codes=2, units=657, lines=60, samples=["DELL DESKTOP REFURB/I3"]),
            ErpArticle("FA_IT_OTHERS", "FA_IT_OTHERS", "IT EQUIPMENTS", "FA_IT_OTHERS", codes=2, units=40, lines=9, samples=["48 PORT SWITCH", "6U RACK"]),
            ErpArticle("FA_CE_UPS", "FA_CE_UPS", "COMPUTER EQUIPMENT", "FA_CE_UPS", codes=2, units=900, lines=114, samples=["APC UPS"]),
        ]
        self.down: str | None = None

    async def items(self, codes):
        if self.down:
            raise ErpUnavailable(self.down)
        return [self.erp_items[c] for c in codes if c in self.erp_items]

    async def bought_articles(self):
        if self.down:
            raise ErpUnavailable(self.down)
        return self.articles

    async def article_codes(self, article_key):
        if self.down:
            raise ErpUnavailable(self.down)
        return [ErpArticleCode(e.icode, e.name, e.description, 10.0, 2) for e in self.erp_items.values() if e.article_key == article_key]

    async def receipts(self, po_codes):
        if self.down:
            raise ErpUnavailable(self.down)
        return [r for r in self.receipt_list if r.po_code in po_codes]

    async def invoices(self, po_codes):
        if self.down:
            raise ErpUnavailable(self.down)
        return [i for i in self.invoice_list if i.po_code in po_codes]

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
            CodeRule(company_id=None, prefix_template="FA/{company.code}/", suffix_template="", start_number=1, pad_width=4),
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
        # Items: "Desktop" is a bundle and owns the Dell Desktop's whole Article; "Cable" is a plain item.
        item_desktop = Item(name="Desktop", category_id=comp.id, subcategory_id=cpu.id, bundle_id=desktop.id,
                            default_warranty_years=1, created_by=owner.id, updated_by=owner.id)
        item_cable = Item(name="Cable", category_id=acc.id, subcategory_id=cables.id, created_by=owner.id, updated_by=owner.id)
        session.add_all([item_desktop, item_cable])
        await session.flush()
        session.add(ItemMap(item_id=item_desktop.id, match_type="ARTICLE", article_key="02-I3 CORE[IT-01]",
                            article_name="02-I3 CORE[IT-01]", created_by=owner.id, updated_by=owner.id))
        await session.commit()
        return {"spl": spl.id, "vpl": vpl.id, "taj": taj.id, "faru": faru.id, "vtaj": vtaj.id,
                "desktop": desktop.id, "acc": acc.id, "cables": cables.id,
                "item_desktop": item_desktop.id, "item_cable": item_cable.id,
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
    # The Item comes from the ERP Article; bundle, category, warranty come from the Item.
    assert (ln["item_id"], ln["item_name"], ln["matched_by"]) == (ids["item_desktop"], "Desktop", "ARTICLE")
    assert ln["bundle_id"] == ids["desktop"] and ln["bundle_name"] == "Desktop" and ln["warranty_years"] == 1
    assert ln["brand_id"] is not None and ln["warnings"] == []
    # What the ERP says is shown beside the code, with where it sits in the hierarchy.
    assert ln["erp_description"] == "DELL DESKTOP REFURB/i3 · HARSHIT INFOSOLUTION"
    assert (ln["section"], ln["department"], ln["article_key"]) == ("IT EQUIPMENTS", "FA_CE_DESKTOP", "02-I3 CORE[IT-01]")


async def test_a_new_vendor_code_in_a_known_article_lands_on_the_same_item_by_itself(client, erp):
    ids = await _setup()
    erp.pos[1133610106] = desktop_po(lines=[line(1, "CT999001", "LENOVO DESKTOP I3", 3, 18000)])
    [ln] = (await client.get("/api/erp/pos/1133610106/draft", headers=await _headers(client, "OPR"))).json()["lines"]
    assert (ln["item_id"], ln["matched_by"]) == (ids["item_desktop"], "ARTICLE")


async def test_a_code_with_no_item_is_flagged_and_nothing_is_guessed(client, erp):
    await _setup()
    erp.pos[1133610106] = desktop_po(lines=[line(1, "CT500001", "48 PORT SWITCH", 2, 9000), line(2, "CT777", "Unknown to the ERP master", 1, 100)])
    a, b = (await client.get("/api/erp/pos/1133610106/draft", headers=await _headers(client, "OPR"))).json()["lines"]
    assert a["item_id"] is None and a["category_id"] is None and a["article_key"] == "FA_IT_OTHERS"
    assert any("No Item is linked to this ERP code yet (Article FA_IT_OTHERS)" in w for w in a["warnings"])
    assert b["item_id"] is None and any("no record of this code" in w for w in b["warnings"])


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
    body["lines"] = [{k: ln[k] for k in ("item_code", "description", "barcode", "quantity", "rate", "tax_percent",
                                         "warranty_years", "item_id")}]
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
        pending = (await session.execute(select(PendingAsset))).scalars().all()
        assert len(pending) == 28
        # Every part keeps the ERP code it was ordered under, as a link back to the PO / receipt / PI.
        assert {p.erp_item_code for p in pending} == {"CT324973"} and {p.bundle_label for p in pending} == {"Desktop"}


async def test_a_plain_line_gets_its_category_and_item_from_the_item_and_the_whole_po_is_all_or_nothing(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    good = {"item_code": "CT1", "description": "Good", "barcode": "CT1", "quantity": 2, "rate": 100, "tax_percent": 18,
            "item_id": ids["item_cable"]}
    body = {
        "erp_po_code": 1133610106, "company_id": ids["spl"], "po_number": "SPO/9", "po_date": "2026-09-18",
        "vendor_id": ids["vansh"], "cost_center_id": ids["cost_spl"],
        "lines": [good, {"item_code": "CT2", "description": "Item missing", "barcode": "CT2", "quantity": 1, "rate": 100, "tax_percent": 18,
                         "item_id": 999999}],
    }
    resp = await client.post("/api/erp/pos/create", headers=h, json=body)
    assert resp.status_code == 422 and "choose the Item" in resp.json()["detail"]
    async with SessionLocal() as session:
        assert (await session.execute(select(func.count()).select_from(PurchaseOrder))).scalar_one() == 0

    ok = await client.post("/api/erp/pos/create", headers=h, json=body | {"lines": [good]})
    assert ok.status_code == 201, ok.text
    async with SessionLocal() as session:
        lines = (await session.execute(select(PendingAsset))).scalars().all()
        assert len(lines) == 2
        assert {(l.item_id, l.category_id, l.subcategory_id, l.erp_item_code) for l in lines} == {
            (ids["item_cable"], ids["acc"], ids["cables"], "CT1")}


async def test_choosing_an_item_can_be_remembered_for_the_code_the_product_name_or_the_whole_article(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")

    async def create(po_no, scope, code):
        e = erp.erp_items[code]
        body = {"company_id": ids["spl"], "po_number": po_no, "po_date": "2026-09-18", "vendor_id": ids["vansh"],
                "cost_center_id": ids["cost_spl"], "lines": [{
                    "item_code": code, "description": e.name, "barcode": code, "quantity": 1, "rate": 100, "tax_percent": 18,
                    "item_id": ids["item_cable"], "map_scope": scope, "article_key": e.article_key, "article_name": e.article_name,
                    "section": e.section, "department": e.department, "name_key": e.name}]}
        resp = await client.post("/api/erp/pos/create", headers=h, json=body)
        assert resp.status_code == 201, resp.text

    async def draft_line(code):
        erp.pos[1133610106] = desktop_po(lines=[line(1, code, erp.erp_items[code].name, 1, 100)])
        return (await client.get("/api/erp/pos/1133610106/draft", headers=h)).json()["lines"][0]

    await create("P-NAME", "NAME", "CT500001")            # the switch, by its product name
    assert (await draft_line("CT500001"))["matched_by"] == "NAME"
    assert (await draft_line("CT500002"))["item_id"] is None   # the rack in the same catch-all Article is NOT swept in
    await create("P-CODE", "CODE", "CT500002")            # the rack, by its own code only
    assert (await draft_line("CT500002"))["matched_by"] == "CODE"
    async with SessionLocal() as session:
        rules = {(m.match_type, m.erp_item_code or m.name_key or m.article_key) for m in (await session.execute(select(ItemMap).where(ItemMap.item_id == ids["item_cable"]))).scalars().all()}
    assert rules == {("NAME", "48 port switch"), ("CODE", "CT500002")}


async def test_an_operator_cannot_create_a_po_for_another_company_and_a_viewer_cannot_use_it_at_all(client, erp):
    ids = await _setup()
    body = {"company_id": ids["vpl"], "po_number": "X", "po_date": "2026-09-18", "cost_center_id": ids["cost_spl"],
            "lines": [{"description": "d", "barcode": "b", "quantity": 1, "rate": 1, "item_id": ids["item_cable"]}]}
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
