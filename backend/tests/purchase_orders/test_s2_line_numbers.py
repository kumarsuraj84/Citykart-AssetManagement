"""S2.4: every unit of a purchase order carries the number of the line it was
ordered on (pending_asset.line_no, 1..n per PO). Every creation path assigns
one (manual line, bundle, ERP create, ERP "add units", Excel PO import); an
edit keeps it; the migration numbered existing rows by a deterministic rule."""
import importlib.util
import io
from pathlib import Path

import openpyxl
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import select, text

from app.bundles.models import Bundle, BundlePart
from app.core.db import SessionLocal, engine
from app.items.models import Item
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.core.s0_world import add_line, build_world, login, make_po
from tests.erp.test_erp_api import _headers as erp_headers, _setup as erp_setup, desktop_po, erp, line  # noqa: F401
from tests.erp.test_erp_followup import PO_CODE, _create_desktop_po

APP_DIR = Path(__file__).resolve().parents[2]


async def _units(po_id: int) -> list[PendingAsset]:
    async with SessionLocal() as s:
        return list((await s.execute(
            select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id)
        )).scalars().all())


def _by_line(units) -> dict[int, int]:
    out: dict[int, int] = {}
    for u in units:
        out[u.line_no] = out.get(u.line_no, 0) + 1
    return out


async def test_a_manual_line_gives_all_its_units_one_number_and_the_next_line_the_next(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    first = await add_line(client, h, w, po["id"], quantity=3)
    assert first.status_code == 201
    assert {u["line_no"] for u in first.json()} == {1}                 # line_no is in PendingAssetOut
    second = await add_line(client, h, w, po["id"], "nonit", quantity=2)
    assert {u["line_no"] for u in second.json()} == {2}
    assert _by_line(await _units(po["id"])) == {1: 3, 2: 2}
    listed = (await client.get(f"/api/purchase-orders/{po['id']}/lines", headers=h)).json()
    assert [u["line_no"] for u in listed] == [1, 1, 1, 2, 2]


async def test_two_lines_that_look_identical_stay_two_lines(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    await add_line(client, h, w, po["id"], quantity=2)
    await add_line(client, h, w, po["id"], quantity=2)              # same description, cost, everything
    assert _by_line(await _units(po["id"])) == {1: 2, 2: 2}
    groups = (await client.get(f"/api/purchase-orders/{po['id']}/line-groups", headers=h)).json()
    assert [(g["line_no"], g["ordered"]) for g in groups] == [(1, 2), (2, 2)]


async def test_line_numbers_are_per_purchase_order(client):
    w = await build_world()
    h = await login(client, w, "admin")
    a = await make_po(client, h, w, number="A")
    b = await make_po(client, h, w, number="B")
    await add_line(client, h, w, a["id"])
    await add_line(client, h, w, a["id"])
    resp = await add_line(client, h, w, b["id"])
    assert resp.json()[0]["line_no"] == 1


async def _desktop_bundle(w) -> int:
    async with SessionLocal() as s:
        parts = []
        for name, cat, sub in (("CPU", w["it"], w["lap"]), ("TFT", w["it"], w["lap"]), ("Chair", w["nonit"], w["chair"])):
            item = Item(name=f"S2 {name}", category_id=cat, subcategory_id=sub)
            s.add(item)
            await s.flush()
            parts.append((name, item, cat, sub))
        bundle = Bundle(name="S2 Desktop")
        s.add(bundle)
        await s.flush()
        for order, (name, item, cat, sub) in enumerate(parts):
            s.add(BundlePart(bundle_id=bundle.id, name=name, item_id=item.id, category_id=cat, subcategory_id=sub,
                             share_percent=[50, 30, 20][order], sort_order=order))
        await s.commit()
        return bundle.id


async def test_a_bundle_gives_each_part_its_own_line_shared_by_that_parts_units(client):
    w = await build_world()
    bundle_id = await _desktop_bundle(w)
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    await add_line(client, h, w, po["id"])                                    # line 1
    resp = await client.post(f"/api/purchase-orders/{po['id']}/bundle-lines", headers=h, json={
        "bundle_id": bundle_id, "description": "Office desktop", "barcode": "BND-1", "quantity": 2,
        "price": 1000, "tax_percent": 18, "warranty_years": 1})
    assert resp.status_code == 201, resp.text
    by_part = {}
    for u in resp.json():
        by_part.setdefault(u["description"].rsplit(" - ", 1)[-1], set()).add(u["line_no"])
    assert by_part == {"CPU": {2}, "TFT": {3}, "Chair": {4}}
    again = await client.post(f"/api/purchase-orders/{po['id']}/bundle-lines", headers=h, json={
        "bundle_id": bundle_id, "description": "Office desktop", "barcode": "BND-1", "quantity": 1,
        "price": 1000, "tax_percent": 18, "warranty_years": 1})
    assert {u["line_no"] for u in again.json()} == {5, 6, 7}
    assert _by_line(await _units(po["id"])) == {1: 1, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1, 7: 1}


async def test_erp_create_numbers_each_part_and_erp_add_units_keeps_the_numbers(client, erp):
    ids = await erp_setup()
    h = await erp_headers(client, "OPR")
    po_id = await _create_desktop_po(client, ids, h)                           # 7 desktops x 4 parts
    assert _by_line(await _units(po_id)) == {1: 7, 2: 7, 3: 7, 4: 7}
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 9, 20000)])     # ERP raised 7 -> 9
    done = await client.post(f"/api/erp/purchase-orders/{po_id}/changes/apply", headers=h,
                             json={"items": [{"id": "ADD_UNITS:CT324973", "mode": "apply"}]})
    assert done.status_code == 200, done.text
    units = await _units(po_id)
    assert _by_line(units) == {1: 9, 2: 9, 3: 9, 4: 9}                         # the new units joined their lines
    for no in (1, 2, 3, 4):
        assert len({u.description for u in units if u.line_no == no}) == 1


async def test_excel_po_import_gives_one_number_per_row(client):
    w = await build_world()
    h = await login(client, w, "owner")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Company Code", "PO Number", "PO Date", "Cost Centre Code", "Description", "Barcode", "Category Code",
               "Subcategory Code", "Quantity", "Purchase Cost", "Tax %"])
    ws.append(["S0A", "IMP-1", "2026-01-05", "HO", "Laptop", "BC1", "S0IT", "LAP", 2, 1000, 18])
    ws.append(["S0A", "IMP-1", "2026-01-05", "HO", "Laptop", "BC1", "S0IT", "LAP", 3, 1000, 18])
    ws.append(["S0A", "IMP-1", "2026-01-05", "HO", "Chair", "BC2", "S0NI", "CHR", 1, 50, 18])
    buf = io.BytesIO()
    wb.save(buf)
    resp = await client.post("/api/imports/purchase-orders/commit", headers=h, files={
        "file": ("po.xlsx", io.BytesIO(buf.getvalue()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert resp.status_code == 200, resp.text
    async with SessionLocal() as s:
        po_id = (await s.execute(select(PurchaseOrder.id).where(PurchaseOrder.po_number == "IMP-1"))).scalar_one()
    assert _by_line(await _units(po_id)) == {1: 2, 2: 3, 3: 1}


async def test_editing_or_cancelling_one_unit_keeps_its_line_number(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    units = (await add_line(client, h, w, po["id"], quantity=2)).json()
    edit = await client.put(f"/api/purchase-orders/lines/{units[0]['id']}", headers=h, json={
        "description": "Laptop (renamed)", "category_id": w["it"], "subcategory_id": w["lap"], "purchase_cost": 900})
    assert edit.status_code == 200 and edit.json()["line_no"] == 1
    cancel = await client.post(f"/api/purchase-orders/lines/{units[1]['id']}/cancel", headers=h)
    assert cancel.json()["line_no"] == 1
    nxt = await add_line(client, h, w, po["id"])
    assert nxt.json()[0]["line_no"] == 2


def _migration_module():
    path = APP_DIR / "app" / "alembic" / "versions" / "b8d0f2a4c6e8_pending_asset_line_no.py"
    spec = importlib.util.spec_from_file_location("s2_line_no_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _raw_units(w, po_id, rows):
    """Inserts units the way they existed before S2.4 (no line number)."""
    async with SessionLocal() as s:
        for description, cost, model, status in rows:
            s.add(PendingAsset(
                purchase_order_id=po_id, company_id=w["co"], description=description, category_id=w["it"],
                cost_center_id=w["cc"], purchase_cost=cost, model=model, status=status, line_no=None,
            ))
        await s.commit()


async def test_the_migration_backfill_numbers_existing_units_by_what_their_line_was_entered_with(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, number="OLD-1")
    other = await make_po(client, h, w, number="OLD-2")
    await _raw_units(w, po["id"], [
        ("Laptop", 100, None, "PENDING"), ("Laptop", 100, None, "DELIVERED"), ("Mouse", 10, "M1", "PENDING"),
        ("Mouse", 10, "M1", "CANCELLED"), ("Laptop", 100, None, "PENDING"), ("Laptop", 120, None, "PENDING"),
    ])
    await _raw_units(w, other["id"], [("Chair", 50, None, "PENDING"), ("Chair", 50, None, "PENDING")])
    async with engine.begin() as conn:
        await conn.execute(text(_migration_module().BACKFILL_SQL))
    assert [(u.description, float(u.purchase_cost), u.status, u.line_no) for u in await _units(po["id"])] == [
        ("Laptop", 100.0, "PENDING", 1), ("Laptop", 100.0, "DELIVERED", 1), ("Mouse", 10.0, "PENDING", 2),
        ("Mouse", 10.0, "CANCELLED", 2), ("Laptop", 100.0, "PENDING", 1), ("Laptop", 120.0, "PENDING", 3),
    ]
    assert {u.line_no for u in await _units(other["id"])} == {1}
    # running it again changes nothing (deterministic)
    async with engine.begin() as conn:
        await conn.execute(text(_migration_module().BACKFILL_SQL))
    assert [u.line_no for u in await _units(po["id"])] == [1, 1, 2, 2, 1, 3]


async def test_units_without_a_number_get_one_after_the_highest_when_the_lines_are_read(client):
    w = await build_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w)
    await add_line(client, h, w, po["id"], quantity=2)                         # line 1
    await _raw_units(w, po["id"], [("Old row", 5, None, "PENDING"), ("Old row", 5, None, "PENDING")])
    groups = (await client.get(f"/api/purchase-orders/{po['id']}/line-groups", headers=h)).json()
    assert [(g["line_no"], g["description"], g["ordered"]) for g in groups] == [(1, "Laptop", 2), (2, "Old row", 2)]
    assert None not in {u.line_no for u in await _units(po["id"])}


def test_there_is_exactly_one_migration_head_and_it_is_the_line_number_migration():
    config = Config(str(APP_DIR / "alembic.ini"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert heads == ["b8d0f2a4c6e8"]
