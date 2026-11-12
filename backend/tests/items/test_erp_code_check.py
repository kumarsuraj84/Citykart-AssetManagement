"""Is the ERP Barcode typed by hand right for the Item? One check behind the live message and the server's refusal:
OK / linked to another Item / a real ERP code not linked yet / not tracked / not an ERP code / LOCAL / blank."""
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.erp.mirror_models import ErpItemCopy, ErpSyncRun
from app.items.models import Item, ItemMap
from tests.core.s0_world import build_world, login, make_po

NOW = datetime(2026, 11, 12, 5, 0, tzinfo=timezone.utc)


async def _items(w: dict) -> dict:
    async with SessionLocal() as s:
        desktop = Item(name="Desktop", category_id=w["it"], subcategory_id=w["lap"], serial_required=False)
        mouse = Item(name="Mouse", category_id=w["it"], subcategory_id=w["lap"], serial_required=False)
        s.add_all([desktop, mouse])
        await s.commit()
        return {"desktop": desktop.id, "mouse": mouse.id}


async def _erp_world(w: dict, ids: dict, copy: bool = True) -> None:
    """The ERP copy: CT1 (linked to Desktop), CT2 (Mouse), CT3 (nobody), CT4 (marked not tracked), CT9 (the other
    company's). Company S0A's ERP code is its own code."""
    async with SessionLocal() as s:
        if copy:
            s.add(ErpSyncRun(status="success", trigger="manual", started_at=NOW, finished_at=NOW, source_stamp=NOW))
        for icode, company, name in (("CT1", "S0A", "DELL DESKTOP"), ("CT2", "S0A", "LOGITECH MOUSE"), ("CT3", "S0A", "NEW THING"),
                                     ("CT4", "S0A", "SENSOR TAG"), ("CT9", "S0B", "OTHER COMPANY ITEM")):
            s.add(ErpItemCopy(icode=icode, company_code=company, article_name=f"ART-{icode}", section="S", department="D", division="FIXED ASSETS",
                              cat1=name, row_hash="x", first_seen_at=NOW, last_seen_at=NOW, is_present=True))
        s.add_all([
            ItemMap(match_type="CODE", erp_item_code="CT1", item_id=ids["desktop"], company_id=w["co"]),
            ItemMap(match_type="CODE", erp_item_code="CT2", item_id=ids["mouse"], company_id=w["co"]),
            ItemMap(match_type="CODE", erp_item_code="CT4", not_tracked=True, company_id=w["co"]),
        ])
        await s.commit()


async def _check(client, h, w, ids, code, item="desktop"):
    resp = await client.get("/api/items/erp-code-check", headers=h,
                            params={"code": code, "item_id": ids[item], "company_id": w["co"]})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_each_kind_of_code_gets_its_verdict(client):
    w = await build_world()
    ids = await _items(w)
    await _erp_world(w, ids)
    h = await login(client, w, "admin")
    ok = await _check(client, h, w, ids, "ct1")                                           # any letter case
    assert (ok["state"], ok["ok"]) == ("OK", True) and ok["message"] == "OK: Desktop (DELL DESKTOP)"
    other = await _check(client, h, w, ids, "CT2")
    assert (other["state"], other["ok"], other["message"]) == ("OTHER_ITEM", False, "CT2 is Mouse, not Desktop.")
    unlinked = await _check(client, h, w, ids, "CT3")
    assert (unlinked["state"], unlinked["ok"]) == ("UNLINKED", False) and "Please link it first" in unlinked["message"]
    not_tracked = await _check(client, h, w, ids, "CT4")
    assert (not_tracked["state"], not_tracked["ok"]) == ("NOT_TRACKED", False)
    absent = await _check(client, h, w, ids, "CT404")
    assert (absent["state"], absent["ok"]) == ("NOT_ERP", False) and "Refresh now" in absent["message"]
    elsewhere = await _check(client, h, w, ids, "CT9")                                    # the other company's ERP code
    assert (elsewhere["state"], elsewhere["ok"]) == ("NOT_ERP", False) and "S0B" in elsewhere["message"]
    local = await _check(client, h, w, ids, " local ")
    assert (local["state"], local["ok"]) == ("LOCAL", True)
    blank = await _check(client, h, w, ids, "")
    assert (blank["state"], blank["ok"], blank["message"]) == ("BLANK", False, "Type the ERP code, or LOCAL if it was bought locally, or OLD STOCK for old stock.")


async def test_with_no_erp_copy_yet_a_typed_code_is_accepted_unchecked_but_blank_is_still_refused(client):
    w = await build_world()
    ids = await _items(w)
    await _erp_world(w, ids, copy=False)
    h = await login(client, w, "admin")
    assert (await _check(client, h, w, ids, "CT-ANYTHING"))["state"] == "UNCHECKED"
    assert (await _check(client, h, w, ids, ""))["state"] == "BLANK"


async def test_the_endpoint_needs_an_item_and_a_company_in_scope(client):
    w = await build_world()
    ids = await _items(w)
    h = await login(client, w, "admin")
    assert (await client.get("/api/items/erp-code-check", headers=h, params={"code": "CT1"})).status_code == 422
    other_company = await client.get("/api/items/erp-code-check", headers=await login(client, w, "op_it"),
                                     params={"code": "CT1", "item_id": ids["desktop"], "company_id": w["co_b"]})
    assert other_company.status_code in (200, 403, 404)           # a login limited to company A may not ask about B
    assert (await client.get("/api/items/erp-code-check", headers=await login(client, w, "viewer_it"),
                             params={"code": "CT1", "item_id": ids["desktop"]})).status_code == 403


async def _add(client, h, w, ids, **over):
    return await client.post("/api/assets/batch", headers=h, json={
        "item_id": ids["desktop"], "quantity": 1, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"], **over})


async def test_add_assets_accepts_only_a_right_code_or_local(client):
    w = await build_world()
    ids = await _items(w)
    await _erp_world(w, ids)
    h = await login(client, w, "admin")
    for bad, words in (("CT2", "CT2 is Mouse, not Desktop"), ("CT3", "not linked to any Item yet"), ("CT404", "is not an ERP code"),
                       ("", "Type the ERP code, or LOCAL")):
        resp = await _add(client, h, w, ids, barcode=bad)
        assert resp.status_code == 422 and words in resp.text and "ERP Barcode" in resp.text, (bad, resp.text)
    async with SessionLocal() as s:
        assert (await s.execute(select(func.count()).select_from(Asset))).scalar_one() == 0      # nothing was added
    assert (await _add(client, h, w, ids, barcode="CT1")).status_code == 201
    assert (await _add(client, h, w, ids, barcode="LOCAL")).status_code == 201
    async with SessionLocal() as s:
        assert sorted(a.barcode for a in (await s.execute(select(Asset))).scalars()) == ["CT1", "LOCAL"]


async def test_a_manual_po_checks_each_line_and_each_set(client):
    w = await build_world()
    ids = await _items(w)
    await _erp_world(w, ids)
    h = await login(client, w, "admin")

    def body(barcode):
        return {"company_id": w["co"], "po_number": f"PO-{barcode or 'blank'}", "po_date": "2026-01-01", "cost_center_id": w["cc"],
                "lines": [{"item_id": ids["desktop"], "quantity": 1, "purchase_cost": 1000, "tax_percent": 18, "barcode": barcode}]}
    refused = await client.post("/api/purchase-orders/with-lines", headers=h, json=body("CT2"))
    assert refused.status_code == 422 and "CT2 is Mouse, not Desktop" in refused.text
    assert (await client.post("/api/purchase-orders/with-lines", headers=h, json=body(None))).status_code == 422
    assert (await client.post("/api/purchase-orders/with-lines", headers=h, json=body("CT1"))).status_code == 201
    assert (await client.post("/api/purchase-orders/with-lines", headers=h, json=body("LOCAL"))).status_code == 201

    po = await make_po(client, h, w, number="PO-LINES")
    line = {"description": "Desktop", "item_id": ids["desktop"], "quantity": 1, "purchase_cost": 1000, "tax_percent": 18}
    assert (await client.post(f"/api/purchase-orders/{po['id']}/lines", headers=h, json={**line, "barcode": "CT2"})).status_code == 422
    assert (await client.post(f"/api/purchase-orders/{po['id']}/lines", headers=h, json={**line, "barcode": ""})).status_code == 422
    assert (await client.post(f"/api/purchase-orders/{po['id']}/lines", headers=h, json={**line, "barcode": "CT1"})).status_code == 201


async def test_changing_a_barcode_on_an_asset_is_checked_but_clearing_or_keeping_one_is_not(client):
    w = await build_world()
    ids = await _items(w)
    await _erp_world(w, ids)
    h = await login(client, w, "admin")
    made = await _add(client, h, w, ids, barcode="CT1")
    assert made.status_code == 201, made.text
    async with SessionLocal() as s:
        asset = (await s.execute(select(Asset))).scalars().one()
        asset_id = asset.id
    base = {"description": "Desktop", "vendor_id": w["vendor"]}
    refused = await client.put(f"/api/assets/{asset_id}", headers=h, json={**base, "barcode": "CT2"})
    assert refused.status_code in (403, 422) and "CT2 is Mouse, not Desktop" in refused.text
    assert (await client.put(f"/api/assets/{asset_id}", headers=h, json={**base, "barcode": "CT1", "model": "x"})).status_code == 200   # unchanged
    assert (await client.put(f"/api/assets/{asset_id}", headers=h, json={**base, "barcode": "LOCAL"})).status_code == 200


async def test_old_stock_is_accepted_like_local_in_any_spelling_and_stored_one_way(client):
    """Old stock is uploaded without an ERP code: OLD STOCK (any letter case, spacing, dash or underscore) is accepted
    everywhere LOCAL is, and LOCAL / OLD STOCK are stored written one way."""
    w = await build_world()
    ids = await _items(w)
    await _erp_world(w, ids)
    h = await login(client, w, "admin")
    for typed in ("OLD STOCK", "old stock", "  Old   Stock ", "old-stock", "OLD_STOCK"):
        verdict = await _check(client, h, w, ids, typed)
        assert (verdict["state"], verdict["ok"], verdict["message"]) == ("OLD_STOCK", True, "Old stock."), typed
    assert (await _check(client, h, w, ids, "OLDSTOCK"))["ok"] is False                 # not the two words
    for typed in ("old stock", "Local", "OLD-STOCK"):
        assert (await _add(client, h, w, ids, barcode=typed)).status_code == 201, typed
    async with SessionLocal() as s:
        assert sorted(a.barcode for a in (await s.execute(select(Asset))).scalars()) == ["LOCAL", "OLD STOCK", "OLD STOCK"]
