"""Old stock has no ERP code: the asset import (add mode) has an optional "ERP Barcode" column. An empty cell is stored as
OLD STOCK; a filled one must be an ERP code right for the row's Item, LOCAL or OLD STOCK (the same check as Add Assets)."""
from datetime import datetime, timezone

from app.core.db import SessionLocal
from app.erp.mirror_models import ErpItemCopy, ErpSyncRun
from app.items.models import ItemMap
from tests.imports.test_s7_import_items import NEW, assets, post, row, xlsx
from tests.purchase_orders.s4_world import build_s4_world, login

NOW = datetime(2026, 11, 12, 5, 0, tzinfo=timezone.utc)
HEADER = NEW + ["ERP Barcode"]


async def _erp(w: dict) -> None:
    """CT1 is the Office Chair's ERP code, CT2 the Gang Box's (company S0A)."""
    async with SessionLocal() as s:
        s.add(ErpSyncRun(status="success", trigger="manual", started_at=NOW, finished_at=NOW, source_stamp=NOW))
        for icode in ("CT1", "CT2"):
            s.add(ErpItemCopy(icode=icode, company_code="S0A", article_name=f"ART-{icode}", section="S", department="D", division="FIXED ASSETS",
                              cat1=icode, row_hash="x", first_seen_at=NOW, last_seen_at=NOW, is_present=True))
        s.add_all([ItemMap(match_type="CODE", erp_item_code="CT1", item_id=w["item_chair"], company_id=w["co"]),
                   ItemMap(match_type="CODE", erp_item_code="CT2", item_id=w["item_gangbox"], company_id=w["co"])])
        await s.commit()


async def test_the_template_has_the_erp_barcode_column(client):
    import io
    import openpyxl
    w = await build_s4_world()
    resp = await client.get("/api/imports/assets/template", headers=await login(client, w, "owner"))
    header = [c.value for c in next(openpyxl.load_workbook(io.BytesIO(resp.content)).active.iter_rows(max_row=1))]
    assert "ERP Barcode" in header


async def test_an_empty_erp_barcode_cell_or_no_column_is_stored_as_old_stock(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    resp = await post(client, h, xlsx([row(Item="Office Chair", Quantity=2)], NEW))                      # the sheet has no such column
    assert resp.status_code == 200 and resp.json()["imported"] == 2, resp.text
    resp = await post(client, h, xlsx([row(Item="Office Chair")], HEADER))                               # the column is there, the cell empty
    assert resp.status_code == 200 and resp.json()["imported"] == 1, resp.text
    assert {a.barcode for a in await assets()} == {"OLD STOCK"}


async def test_the_preview_shows_the_barcode_each_row_will_get(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    body = (await post(client, h, xlsx([row(Item="Office Chair"), row(Item="Office Chair", **{"ERP Barcode": "local"})], HEADER), "preview")).json()
    assert [r["barcode"] for r in body["valid_rows"]] == ["OLD STOCK", "LOCAL"]
    assert await assets() == []


async def test_a_filled_cell_must_be_an_erp_code_right_for_the_item_or_local_or_old_stock(client):
    w = await build_s4_world()
    await _erp(w)
    h = await login(client, w, "owner")
    sheet = xlsx([
        row(Item="Office Chair", **{"ERP Barcode": "ct1"}),                       # right for the Item (any letter case)
        row(Item="Office Chair", **{"ERP Barcode": "Local"}),
        row(Item="Office Chair", **{"ERP Barcode": " old-stock "}),
        row(Item="Office Chair", **{"ERP Barcode": "CT2"}),                       # another Item's code
        row(Item="Office Chair", **{"ERP Barcode": "CT404"}),                     # not an ERP code
    ], HEADER)
    preview = (await post(client, h, sheet, "preview")).json()
    assert [r["barcode"] for r in preview["valid_rows"]] == ["ct1", "LOCAL", "OLD STOCK"]            # a code is kept as typed; the two words are written one way
    said = {e["row"]: e for e in preview["errors"]}
    assert len(said) == 2 and all(e["field"] == "ERP Barcode" for e in said.values())
    assert "CT2 is Gang Box, not Office Chair" in " ".join(e["message"] for e in said.values())
    assert "CT404 is not an ERP code" in " ".join(e["message"] for e in said.values())
    committed = (await post(client, h, sheet)).json()
    assert committed["imported"] == 3
    assert sorted(a.barcode for a in await assets()) == ["LOCAL", "OLD STOCK", "ct1"]


async def test_a_row_that_names_no_item_can_only_say_local_or_old_stock(client):
    w = await build_s4_world()
    await _erp(w)
    h = await login(client, w, "owner")
    cat = {"Category Code": "S0IT", "Subcategory Code": "LAP", "Description": "Laptop"}
    preview = (await post(client, h, xlsx([row(**cat, **{"ERP Barcode": "CT1"}), row(**cat, **{"ERP Barcode": "Old Stock"}), row(**cat)], HEADER), "preview")).json()
    assert [r["barcode"] for r in preview["valid_rows"]] == ["OLD STOCK", "OLD STOCK"]
    assert len(preview["errors"]) == 1 and "Name the Item" in preview["errors"][0]["message"]
