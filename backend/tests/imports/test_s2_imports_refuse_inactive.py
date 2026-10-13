"""S0 leftover (fixed in S2): every Excel import (assets add/edit, purchase
orders, movements, masters, asset users) refuses a deactivated master, like
the screens already do; and (S1 request) the movement template's column is
now "Destination Code" while files with the old "Destination AssetUser Code"
header are still read."""
import io

import openpyxl

from app.core.db import SessionLocal
from app.masters.models import Location
from tests.core.s0_world import build_world, login, make_asset

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ASSET_COLUMNS = ["Company Code", "Cost Centre Code", "Category Code", "Subcategory Code", "Description",
                 "Vendor Code", "Serial Number", "Initial AssetUser Code", "Brand Code"]


def _file(columns, rows) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(columns)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _post(client, path, h, content, **params):
    resp = await client.post(path, headers=h, params=params, files={"file": ("f.xlsx", io.BytesIO(content), XLSX)})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _asset_row(**over):
    row = {"Company Code": "S0A", "Cost Centre Code": "HO", "Category Code": "S0IT", "Subcategory Code": "LAP",
           "Description": "Laptop", "Vendor Code": "S0V", "Serial Number": "N/A", "Initial AssetUser Code": "S0STK",
           "Brand Code": None}
    row.update(over)
    return [row[c] for c in ASSET_COLUMNS]


async def test_asset_import_refuses_every_deactivated_master(client):
    w = await build_world()
    h = await login(client, w, "owner")
    rows = [
        _asset_row(**{"Cost Centre Code": "OLDCC"}), _asset_row(**{"Vendor Code": "S0VX"}),
        _asset_row(**{"Brand Code": "S0BX"}), _asset_row(**{"Category Code": "S0DEAD", "Subcategory Code": "LAP"}),
        _asset_row(**{"Subcategory Code": "OLD"}), _asset_row(**{"Initial AssetUser Code": "S0STKX"}),
        _asset_row(),
    ]
    result = await _post(client, "/api/imports/assets/preview", h, _file(ASSET_COLUMNS, rows))
    messages = {e["row"]: e["message"] for e in result["errors"]}
    assert messages == {
        2: "Cost Centre Code 'OLDCC' (Closed office) is no longer active; use another.",
        3: "Vendor Code 'S0VX' (Closed Vendor) is no longer active; use another.",
        4: "Brand Code 'S0BX' (Gone Brand) is no longer active; use another.",
        5: "Category Code 'S0DEAD' (Old category) is no longer active; use another.",
        6: "Subcategory Code 'OLD' (Old sub) is no longer active; use another.",
        7: "Initial AssetUser Code 'S0STKX' (Closed Stock) is no longer active; use another.",
    }
    assert [r["row"] for r in result["valid_rows"]] == [8]


async def test_asset_edit_import_refuses_a_newly_chosen_deactivated_vendor_but_keeps_the_current_one(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    asset = await make_asset(client, owner, w)
    columns = ["Asset Code", "Vendor Code", "Model"]
    result = await _post(client, "/api/imports/assets/preview", owner,
                         _file(columns, [[asset["asset_code"], "S0VX", None], [asset["asset_code"], "S0V", "M2"]]), mode="edit")
    assert [e["row"] for e in result["errors"]] == [2] and "no longer active" in result["errors"][0]["message"]
    assert [r["row"] for r in result["valid_rows"]] == [3]


async def test_po_import_refuses_deactivated_masters(client):
    w = await build_world()
    h = await login(client, w, "owner")
    columns = ["Company Code", "PO Number", "PO Date", "Vendor Code", "Cost Centre Code", "Description", "Barcode",
               "Category Code", "Subcategory Code", "Brand Code"]
    base = ["S0A", "IMP-9", "2026-01-05", "S0V", "HO", "Laptop", "BC", "S0IT", "LAP", None]

    def row(index, value):
        r = list(base)
        r[index] = value
        return r

    rows = [row(3, "S0VX"), row(4, "OLDCC"), row(7, "S0DEAD"), row(8, "OLD"), row(9, "S0BX"), base]
    result = await _post(client, "/api/imports/purchase-orders/preview", h, _file(columns, rows))
    assert [(e["row"], e["field"]) for e in result["errors"]] == [
        (2, "Vendor Code"), (3, "Cost Centre Code"), (4, "Category Code"), (5, "Subcategory Code"), (6, "Brand Code")]
    assert all("no longer active" in e["message"] for e in result["errors"])
    assert [r["row"] for r in result["valid_rows"]] == [7]


async def test_movement_import_uses_destination_code_reads_the_old_header_and_refuses_inactive_places(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    asset = await make_asset(client, owner, w, serial_number="MOVE-1")
    template = await client.get("/api/imports/movements/template", headers=owner)
    header = [c.value for c in openpyxl.load_workbook(io.BytesIO(template.content)).active[1]]
    assert header == ["Serial Number or Asset Code", "Action", "Destination Code", "Remarks"]

    new = await _post(client, "/api/imports/movements/preview", owner,
                      _file(header, [["MOVE-1", "MOVED", "S0STK2", None], ["MOVE-1", "MOVED", "S0STKX", None]]))
    assert [r["row"] for r in new["valid_rows"]] == [2]
    [dead] = new["errors"]
    assert (dead["row"], dead["field"]) == (3, "Destination Code")
    assert dead["message"] == "Destination Code 'S0STKX' (Closed Stock) is no longer active; use another."
    missing = await _post(client, "/api/imports/movements/preview", owner, _file(header, [["MOVE-1", "MOVED", None, None]]))
    assert missing["errors"][0]["message"] == "Destination Code is required for action 'MOVED'"

    old_header = ["Serial Number or Asset Code", "Action", "Destination AssetUser Code", "Remarks"]
    old = await _post(client, "/api/imports/movements/commit", owner, _file(old_header, [[asset["asset_code"], "MOVED", "S0STK2", "ok"]]))
    assert old["moved"] == 1 and old["errors"] == []


async def test_master_imports_refuse_a_deactivated_parent(client):
    w = await build_world()
    h = await login(client, w, "owner")
    subs = await _post(client, "/api/masters/subcategories/import/preview", h,
                       _file(["Category Code", "Code", "Name"], [["S0DEAD", "NEW1", "New 1"], ["S0IT", "NEW2", "New 2"]]))
    assert [e["row"] for e in subs["errors"]] == [2]
    assert subs["errors"][0]["message"] == "Category Code 'S0DEAD' (Old category) is no longer active; use another."
    assert [r["row"] for r in subs["valid_rows"]] == [3]


async def test_asset_user_import_refuses_a_deactivated_location(client):
    w = await build_world()
    async with SessionLocal() as s:
        s.add(Location(company_id=w["co"], code="S0-OLD", name="Old office", is_active=False))
        await s.commit()
    h = await login(client, w, "owner")
    columns = ["Company Code", "Code", "Name", "Type", "Location Code", "Role"]
    result = await _post(client, "/api/asset-users/import/preview", h, _file(columns, [
        ["S0A", "U1", "User One", "EMPLOYEE", "S0-OLD", "SELF_SERVICE"],
        ["S0A", "U2", "User Two", "EMPLOYEE", "S0-HO", "SELF_SERVICE"]]))
    assert [e["row"] for e in result["errors"]] == [2] and "Old office" in result["errors"][0]["message"]
    assert [r["row"] for r in result["valid_rows"]] == [3]
