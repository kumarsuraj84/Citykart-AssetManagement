"""Old-data import: the sheet's PO number and the vendor's bill number are looked up in CKAM's copy of the ERP; the
preview says what the ERP knows, and the commit (only when asked) fills the cells the sheet left BLANK."""
import io
from datetime import date, datetime, timezone

import openpyxl
from sqlalchemy import select

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.erp.mirror_models import ErpPoLineCopy
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor, VendorErpLink
from app.numbering.models import CodeRule
from tests.erp.pi_helpers import copy_pi

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
HEADER = ["Legacy Asset Code", "Company Code", "Cost Centre Code", "Category Code", "Subcategory Code", "Description", "Invoice Date",
          "Initial AssetUser Code", "Vendor Code", "Serial Number", "PO Number", "PO Date", "Invoice Number", "Invoice Amount",
          "PI Number", "PI Date"]


def sheet(rows: list[dict]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(HEADER)
    for r in rows:
        base = {"Company Code": "CKSPL", "Cost Centre Code": "HO01", "Category Code": "IT", "Subcategory Code": "LAP",
                "Description": "Old laptop", "Initial AssetUser Code": "ITSTOCK", "Serial Number": "N/A"}
        base.update(r)
        ws.append([base.get(h) for h in HEADER])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def world(client) -> dict:
    async with SessionLocal() as session:
        co = Company(code="CKSPL", name="Citykart Stores")
        cat = AssetCategory(code="IT", name="IT", asset_domain="IT")
        vansh = Vendor(code="VANSH", name="Vansh Enterprises")
        other = Vendor(code="HARSHIT", name="Harshit Infosolution")
        session.add_all([co, cat, vansh, other])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        loc = Location(company_id=co.id, code="HO", name="HO")
        dept = Department(name="IT")
        session.add_all([sub, loc, dept, CostCenter(company_id=co.id, code="HO01", name="HO"),
                         CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/", suffix_template="", start_number=1, pad_width=0),
                         VendorErpLink(vendor_id=vansh.id, company_id=co.id, erp_vendor_code="11338"),
                         VendorErpLink(vendor_id=other.id, company_id=co.id, erp_vendor_code="555")])
        await session.flush()
        session.add_all([
            AssetUser(company_id=co.id, code="ITSTOCK", name="IT Stock", asset_user_type="STOCK_POINT", location_id=loc.id, department_id=dept.id, role="SELF_SERVICE"),
            AssetUser(company_id=co.id, code="OWN", name="Owner", asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                      is_primary_owner=True, login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False),
        ])
        await session.commit()
        ids = {"company": co.id, "vansh": vansh.id}
    login = await client.post("/api/auth/login", json={"company_id": ids["company"], "login_id": "OWN", "password": "Passw0rd!"})
    ids["h"] = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return ids


async def copy_po(po_number="SPO/013000/26-27", po_code=1001, po_date=date(2023, 4, 10), supplier="11338", supplier_name="VANSH ENTERPRISES", lines=2):
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        for n in range(lines):
            session.add(ErpPoLineCopy(
                company_code="CKSPL", po_line_key=f"CKSPL-{po_code}-{n}", po_code=po_code, po_number=po_number, po_date=po_date,
                line_status="CLOSED", supplier_code=supplier, supplier_name=supplier_name, icode="CT1", row_hash="x",
                first_seen_at=now, last_seen_at=now, is_present=True))
        await session.commit()


def files(content: bytes):
    return {"file": ("old.xlsx", io.BytesIO(content), XLSX)}


async def asset_of(legacy: str) -> Asset:
    async with SessionLocal() as session:
        return (await session.execute(select(Asset).where(Asset.legacy_asset_code == legacy))).scalar_one()


async def test_the_preview_says_what_the_erp_knows_and_what_would_be_filled(client):
    ids = await world(client)
    await copy_po()
    await copy_po("SPO/777/22-23", po_code=1002, po_date=date(2022, 6, 1), supplier="555", supplier_name="HARSHIT INFOSOLUTION")
    await copy_pi(pi_code=1, pi_number="SPI/000100/23-24", bill="VE/23-24/034", pi_day=28, vendor_code="11338")
    await copy_pi(pi_code=2, pi_number="SPI/000200/23-24", bill="DUP-1", vendor_code="11338")
    await copy_pi(pi_code=3, pi_number="SPI/000201/23-24", bill="DUP-1", vendor_code="11338")
    xlsx = sheet([
        {"Legacy Asset Code": "A1", "PO Number": "SPO/013000/26-27", "Invoice Number": "ve/23-24/034"},                      # all blanks: fill from the ERP
        {"Legacy Asset Code": "A2", "PO Number": "spo/777/22-23", "PO Date": "2022-06-05", "Vendor Code": "VANSH",               # sheet differs: notes only
         "Invoice Number": "VE/23-24/034", "Invoice Date": "2023-09-21", "PI Number": "OTHER-PI", "PI Date": "2023-10-01"},
        {"Legacy Asset Code": "A3", "PO Number": "SPO/NOT/THERE", "Invoice Number": "NO-SUCH-BILL"},                           # nothing in the ERP
        {"Legacy Asset Code": "A4", "Invoice Number": "DUP-1"},                                                                 # two PIs for one bill
        {"Legacy Asset Code": "A5"},                                                                                            # nothing to look up
    ])
    resp = await client.post("/api/imports/assets/preview", params={"check_erp": "true"}, files=files(xlsx), headers=ids["h"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    rows = {r["legacy_asset_code"]: r["erp"] for r in body["valid_rows"]}

    a1 = rows["A1"]
    assert a1["status"] == "fill" and a1["po"]["found"] and a1["po"]["supplier_name"] == "VANSH ENTERPRISES"
    assert a1["fill"] == {"po_date": "2023-04-10", "vendor_id": ids["vansh"], "vendor_name": "Vansh Enterprises", "pi_number": "SPI/000100/23-24",
                          "pi_date": "2026-09-28", "invoice_date": "2026-09-20"}

    a2 = rows["A2"]
    assert a2["status"] == "check" and a2["fill"].get("po_date") is None and "pi_number" not in a2["fill"]
    assert any("PO date differs" in n for n in a2["notes"]) and any("Vendor differs" in n for n in a2["notes"]) and any("PI differs" in n for n in a2["notes"])

    a3 = rows["A3"]
    assert a3["status"] == "check" and a3["po"] == {"found": False} and a3["fill"] == {}
    assert any("not in the ERP" in n for n in a3["notes"]) and any("No PI in the ERP" in n for n in a3["notes"])

    a4 = rows["A4"]
    assert a4["fill"] == {} and any("More than one PI" in n for n in a4["notes"])
    assert rows["A5"]["status"] == "none"

    s = body["erp_summary"]
    assert (s["rows"], s["po_found"], s["po_missing"], s["will_fill"], s["po_copied"], s["pi_copied"]) == (5, 2, 1, 1, True, True)


async def test_the_commit_fills_only_blank_cells_and_only_when_asked(client):
    ids = await world(client)
    await copy_po()
    await copy_pi(pi_code=1, pi_number="SPI/000100/23-24", bill="VE/23-24/034", pi_day=28, vendor_code="11338")
    xlsx = sheet([
        {"Legacy Asset Code": "B1", "PO Number": "SPO/013000/26-27", "Invoice Number": "VE/23-24/034"},
        {"Legacy Asset Code": "B2", "PO Number": "SPO/013000/26-27", "PO Date": "2020-01-01", "Vendor Code": "VANSH", "Invoice Number": "VE/23-24/034",
         "Invoice Date": "2023-09-21", "PI Number": "MY-PI", "PI Date": "2023-10-01"},
    ])
    plain = await client.post("/api/imports/assets/commit", files=files(xlsx), headers=ids["h"])
    assert plain.status_code == 200 and plain.json()["imported"] == 2 and plain.json().get("filled_from_erp") is None
    b1 = await asset_of("B1")
    assert (b1.po_date, b1.pi_number, b1.vendor_id, b1.invoice_date) == (None, None, None, None)     # nothing filled unless asked

    async with SessionLocal() as session:                                                              # start again, this time asking
        for a in (await session.execute(select(Asset))).scalars().all():
            a.legacy_asset_code = f"OLD-{a.legacy_asset_code}"
        await session.commit()
    filled = await client.post("/api/imports/assets/commit", params={"fill_from_erp": "true"}, files=files(xlsx), headers=ids["h"])
    assert filled.status_code == 200, filled.text
    assert filled.json()["imported"] == 2 and filled.json()["filled_from_erp"] == 1
    b1 = await asset_of("B1")
    assert (b1.po_date, b1.pi_number, b1.pi_date, b1.vendor_id, b1.invoice_date) == (
        date(2023, 4, 10), "SPI/000100/23-24", date(2026, 9, 28), ids["vansh"], date(2026, 9, 20))
    assert b1.purchase_date == date(2026, 9, 20)                                                         # the bill date is the purchase date
    b2 = await asset_of("B2")                                                                          # everything the sheet said is kept
    assert (b2.po_date, b2.pi_number, b2.pi_date, b2.vendor_id, b2.invoice_date) == (
        date(2020, 1, 1), "MY-PI", date(2023, 10, 1), ids["vansh"], date(2023, 9, 21))


async def test_a_pi_that_is_not_posted_or_belongs_to_another_vendor_is_never_filled(client):
    ids = await world(client)
    await copy_po()
    await copy_pi(pi_code=1, pi_number="SPI/DRAFT", bill="BILL-U", vendor_code="11338", status="U")
    await copy_pi(pi_code=2, pi_number="SPI/OTHERS", bill="BILL-X", vendor_code="555", vendor_name="HARSHIT INFOSOLUTION")        # another linked vendor
    xlsx = sheet([
        {"Legacy Asset Code": "C1", "Vendor Code": "VANSH", "Invoice Number": "BILL-U"},
        {"Legacy Asset Code": "C2", "Vendor Code": "VANSH", "Invoice Number": "BILL-X"},
    ])
    resp = await client.post("/api/imports/assets/commit", params={"fill_from_erp": "true"}, files=files(xlsx), headers=ids["h"])
    assert resp.status_code == 200 and resp.json()["imported"] == 2 and resp.json()["filled_from_erp"] == 0
    assert (await asset_of("C1")).pi_number is None and (await asset_of("C2")).pi_number is None
    preview = (await client.post("/api/imports/assets/preview", params={"check_erp": "true"}, files=files(xlsx), headers=ids["h"])).json()
    by = {r["legacy_asset_code"]: r["erp"] for r in preview["valid_rows"]}
    assert any("not posted yet" in n for n in by["C1"]["notes"]) and any("No PI in the ERP" in n for n in by["C2"]["notes"])


async def test_without_the_erp_copy_the_preview_says_so_and_nothing_is_claimed(client):
    ids = await world(client)
    xlsx = sheet([{"Legacy Asset Code": "D1", "PO Number": "SPO/013000/26-27", "Invoice Number": "VE/1"}])
    body = (await client.post("/api/imports/assets/preview", params={"check_erp": "true"}, files=files(xlsx), headers=ids["h"])).json()
    assert body["erp_summary"]["po_copied"] is False and body["erp_summary"]["pi_copied"] is False and body["erp_summary"]["will_fill"] == 0
    plain = (await client.post("/api/imports/assets/preview", files=files(xlsx), headers=ids["h"])).json()
    assert "erp_summary" not in plain or plain["erp_summary"] is None
    assert "erp" not in plain["valid_rows"][0]
