"""S0.8 (audit B-9): creating a PO from an ERP draft re-reads the ERP
purchase order instead of trusting the browser: the PO number, date and vendor
are the ERP's, every line's code must be on that ERP PO, no code may ask for
more units than the ERP has open, and the cost must stay near the ERP rate.
S0.3: an Item of the other work area is refused."""
from sqlalchemy import func, select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.masters.models import AssetCategory
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.erp.test_erp_api import _headers, _setup, desktop_po, erp, line  # noqa: F401  (erp is a fixture)

PO_CODE = 1133610106


def _body(ids, **over):
    body = {"erp_po_code": PO_CODE, "company_id": ids["spl"], "po_number": "SPO/012994/26-27", "po_date": "2026-09-18",
            "vendor_id": ids["vansh"], "cost_center_id": ids["cost_spl"], "lines": [
                {"item_code": "CT1", "description": "Cable", "barcode": "CT1", "quantity": 5, "rate": 100,
                 "tax_percent": 18, "item_id": ids["item_cable"]}]}
    body.update(over)
    return body


async def _po_count():
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(PurchaseOrder))).scalar_one()


async def test_the_po_number_and_date_come_from_the_erp(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT1", "Cable", 5, 100)])
    h = await _headers(client, "OPR")
    resp = await client.post("/api/erp/pos/create", headers=h, json=_body(ids, po_number="WRONG-NUMBER", po_date="2026-01-01"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["po_number"] == "SPO/012994/26-27"
    po = (await client.get(f"/api/purchase-orders/{resp.json()['po_id']}", headers=h)).json()
    assert (po["po_number"], po["po_date"], po["vendor_id"]) == ("SPO/012994/26-27", "2026-09-18", ids["vansh"])


async def test_an_erp_code_that_does_not_exist_or_no_code_is_refused(client, erp):
    ids = await _setup()
    h = await _headers(client, "OPR")
    missing = await client.post("/api/erp/pos/create", headers=h, json=_body(ids, erp_po_code=424242))
    assert missing.status_code == 422 and missing.json()["detail"] == "This purchase order was not found in the ERP."
    none = await client.post("/api/erp/pos/create", headers=h, json=_body(ids, erp_po_code=None))
    assert none.status_code == 422 and "Choose the ERP purchase order" in none.json()["detail"]
    assert await _po_count() == 0


async def test_lines_must_be_on_the_erp_po_and_within_its_open_quantity_and_rate(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT1", "Cable", 5, 100, cancelled=1)])    # 4 open
    h = await _headers(client, "OPR")

    def with_line(**over):
        ln = {"item_code": "CT1", "description": "Cable", "barcode": "CT1", "quantity": 4, "rate": 100,
              "tax_percent": 18, "item_id": ids["item_cable"]} | over
        return _body(ids, lines=[ln])

    other = await client.post("/api/erp/pos/create", headers=h, json=with_line(item_code="CT999"))
    assert other.status_code == 422 and "is not on the ERP purchase order" in other.json()["detail"]
    too_many = await client.post("/api/erp/pos/create", headers=h, json=with_line(quantity=5))
    assert too_many.status_code == 422 and "only 4 open" in too_many.json()["detail"]
    split = await client.post("/api/erp/pos/create", headers=h, json=_body(ids, lines=[
        with_line(quantity=3)["lines"][0], with_line(quantity=2)["lines"][0]]))
    assert split.status_code == 422 and "only 4 open" in split.json()["detail"]
    cheap = await client.post("/api/erp/pos/create", headers=h, json=with_line(rate=0.0001))
    assert cheap.status_code == 422 and "too far from the ERP rate" in cheap.json()["detail"]
    dear = await client.post("/api/erp/pos/create", headers=h, json=with_line(rate=1000))
    assert dear.status_code == 422 and "too far from the ERP rate" in dear.json()["detail"]
    assert await _po_count() == 0
    # fewer units and a small rate correction are legitimate edits
    ok = await client.post("/api/erp/pos/create", headers=h, json=with_line(quantity=3, rate=110, description="Patch cable"))
    assert ok.status_code == 201, ok.text
    assert (ok.json()["lines_created"], ok.json()["units_created"]) == (1, 3)


async def test_the_vendor_must_be_the_one_linked_to_the_erp_supplier(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT1", "Cable", 5, 100)])
    h = await _headers(client, "OPR")
    other = await client.post("/api/erp/pos/create", headers=h, json=_body(ids, vendor_id=ids["oldco"]))
    assert other.status_code == 422 and "cannot be changed here" in other.json()["detail"]
    ghost = await client.post("/api/erp/pos/create", headers=h, json=_body(ids, vendor_id=999999))
    assert ghost.status_code == 422 and "already created" not in ghost.json()["detail"]
    erp.pos[PO_CODE] = desktop_po(supplier_code="2264", supplier_name="JAGANNATH ENTERPRISES", lines=[line(1, "CT1", "Cable", 5, 100)])
    unlinked = await client.post("/api/erp/pos/create", headers=h, json=_body(ids, vendor_id=None))
    assert unlinked.status_code == 422 and "is not linked to a CKAM vendor" in unlinked.json()["detail"]
    assert await _po_count() == 0


async def test_the_erp_po_must_belong_to_the_chosen_company(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = desktop_po(company_code="CKVPL", lines=[line(1, "CT1", "Cable", 5, 100)])
    h = await _headers(client)
    resp = await client.post("/api/erp/pos/create", headers=h, json=_body(ids))
    assert resp.status_code == 422 and "belongs to the ERP company CKVPL" in resp.json()["detail"]


async def test_an_item_of_the_other_work_area_is_refused(client, erp):
    ids = await _setup()
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT1", "Cable", 5, 100)])
    async with SessionLocal() as s:
        op = (await s.execute(select(AssetUser).where(AssetUser.code == "OPR"))).scalar_one()
        op.allowed_asset_domains = "NON_IT"                      # the Cable Item is IT work
        await s.commit()
    h = await _headers(client, "OPR")
    resp = await client.post("/api/erp/pos/create", headers=h, json=_body(ids))
    assert resp.status_code == 403 and "outside your work area" in resp.json()["detail"]
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count()).select_from(PendingAsset))).scalar_one() == 0
        assert (await s.execute(select(AssetCategory).where(AssetCategory.id == ids["acc"]))).scalar_one().asset_domain == "IT"
