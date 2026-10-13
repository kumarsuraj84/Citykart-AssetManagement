"""S0.3 (audit B-3, B-4): the IT / Non-IT work area is enforced on the server
for purchase orders, delivery, Add Asset, PI, check-serials, the two log
exports and cross-area corrections -- and an ordinary ADMIN set to one work
area is now limited by it (NULL / BOTH stays unrestricted)."""
from io import BytesIO

import openpyxl
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.deps import allowed_asset_domains
from app.asset_users.models import AssetUser
from tests.core.s0_world import add_line, build_world, login, make_asset, make_po


async def test_admin_work_area_semantics():
    w = await build_world()
    async with SessionLocal() as s:
        users = {u.id: u for u in (await s.execute(select(AssetUser))).scalars().all()}
        assert await allowed_asset_domains(s, users[w["owner"]]) is None          # head office: unrestricted
        assert await allowed_asset_domains(s, users[w["admin"]]) is None          # ADMIN with no setting: unchanged
        assert await allowed_asset_domains(s, users[w["admin_it"]]) == ("IT",)    # ADMIN set to IT: limited now
        assert await allowed_asset_domains(s, users[w["op_both"]]) == ("IT", "NON_IT")
        users[w["admin"]].allowed_asset_domains = "BOTH"
        assert await allowed_asset_domains(s, users[w["admin"]]) is None


async def _mixed_po(client, w):
    """A PO with one IT line and one Non-IT line, made by the head office."""
    h = await login(client, w, "owner")
    po = await make_po(client, h, w, number="MIX-1")
    it_line = (await add_line(client, h, w, po["id"], "it")).json()[0]
    nonit_line = (await add_line(client, h, w, po["id"], "nonit")).json()[0]
    it_only = await make_po(client, h, w, number="IT-ONLY")
    await add_line(client, h, w, it_only["id"], "it")
    nonit_only = await make_po(client, h, w, number="NONIT-ONLY")
    await add_line(client, h, w, nonit_only["id"], "nonit")
    empty = await make_po(client, h, w, number="EMPTY")
    return po, it_line, nonit_line, it_only, nonit_only, empty


async def test_po_reads_follow_the_work_area(client):
    w = await build_world()
    po, it_line, nonit_line, it_only, nonit_only, empty = await _mixed_po(client, w)
    it = await login(client, w, "op_it")
    listed = {p["po_number"] for p in (await client.get("/api/purchase-orders", headers=it)).json()}
    assert listed == {"MIX-1", "IT-ONLY", "EMPTY"}                      # never the Non-IT-only PO
    assert (await client.get(f"/api/purchase-orders/{nonit_only['id']}", headers=it)).status_code == 404
    lines = (await client.get(f"/api/purchase-orders/{po['id']}/lines", headers=it)).json()
    assert [l["id"] for l in lines] == [it_line["id"]]                  # only the IT line of the mixed PO
    admin_it = await login(client, w, "admin_it")
    assert (await client.get(f"/api/purchase-orders/{nonit_only['id']}", headers=admin_it)).status_code == 404
    both = await login(client, w, "op_both")
    assert len((await client.get(f"/api/purchase-orders/{po['id']}/lines", headers=both)).json()) == 2


async def test_po_line_writes_follow_the_work_area(client):
    w = await build_world()
    po, it_line, nonit_line, *_ = await _mixed_po(client, w)
    it = await login(client, w, "op_it")
    add = await add_line(client, it, w, po["id"], "nonit")
    assert add.status_code == 403 and "outside your work area" in add.json()["detail"]
    edit = await client.put(f"/api/purchase-orders/lines/{nonit_line['id']}", headers=it, json={
        "description": "Chair 2", "category_id": w["nonit"], "subcategory_id": w["chair"]})
    assert edit.status_code == 403
    to_other_area = await client.put(f"/api/purchase-orders/lines/{it_line['id']}", headers=it, json={
        "description": "Now a chair", "category_id": w["nonit"], "subcategory_id": w["chair"]})
    assert to_other_area.status_code == 403
    cancel = await client.post(f"/api/purchase-orders/lines/{nonit_line['id']}/cancel", headers=it)
    assert cancel.status_code == 403
    deliver = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=it, json={
        "invoice_number": "INV-1", "invoice_date": "2026-02-01", "invoice_amount": 100,
        "lines": [{"pending_asset_id": nonit_line["id"], "serial_number": "N/A", "initial_asset_user_id": w["stock"]}]})
    assert deliver.status_code == 403
    delete = await client.delete(f"/api/purchase-orders/{po['id']}", headers=it)
    assert delete.status_code == 403                                     # deleting would cancel the Non-IT line too
    # their own line is fine
    ok = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=it, json={
        "invoice_number": "INV-1", "invoice_date": "2026-02-01", "invoice_amount": 100,
        "lines": [{"pending_asset_id": it_line["id"], "serial_number": "SN-IT-1", "initial_asset_user_id": w["stock"]}]})
    assert ok.status_code == 200, ok.text


async def test_pi_on_a_mixed_invoice_touches_only_the_callers_area(client):
    w = await build_world()
    po, it_line, nonit_line, *_ = await _mixed_po(client, w)
    owner = await login(client, w, "owner")
    delivered = await client.post(f"/api/purchase-orders/{po['id']}/deliver", headers=owner, json={
        "invoice_number": "INV-M", "invoice_date": "2026-02-01", "invoice_amount": 200, "lines": [
            {"pending_asset_id": it_line["id"], "serial_number": "SN-M-1", "initial_asset_user_id": w["stock"]},
            {"pending_asset_id": nonit_line["id"], "serial_number": "N/A", "initial_asset_user_id": w["stock"]}]})
    assert delivered.status_code == 200, delivered.text
    it = await login(client, w, "op_it")
    resp = await client.post(f"/api/purchase-orders/{po['id']}/record-pi", headers=it, json={
        "invoice_number": "INV-M", "pi_number": "PI-IT", "pi_date": "2026-02-05"})
    assert resp.status_code == 200 and len(resp.json()["updated"]) == 1
    assets = (await client.get("/api/assets", headers=owner)).json()["items"]
    by_area = {a["asset_domain"]: a["pi_number"] for a in assets}
    assert by_area == {"IT": "PI-IT", "NON_IT": None}


async def test_add_asset_follows_the_work_area(client):
    w = await build_world()
    it = await login(client, w, "op_it")
    from tests.core.s0_world import asset_body
    refused = await client.post("/api/assets", headers=it, json=asset_body(w, "nonit"))
    assert refused.status_code == 403 and "Non-IT work" in refused.json()["detail"]
    assert (await client.post("/api/assets", headers=it, json=asset_body(w, "it"))).status_code == 201
    admin_it = await login(client, w, "admin_it")
    assert (await client.post("/api/assets", headers=admin_it, json=asset_body(w, "nonit"))).status_code == 403


async def test_check_serials_does_not_reveal_another_areas_asset_code(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    chair = await make_asset(client, owner, w, "nonit", serial_number="CHAIR-SN-1")
    it = await login(client, w, "op_it")
    resp = await client.post("/api/purchase-orders/check-serials", headers=it, json={"serials": ["chair-sn-1"]})
    [conflict] = resp.json()["conflicts"]
    assert conflict["serial"] == "chair-sn-1" and conflict["asset_code"] != chair["asset_code"]
    own = await client.post("/api/purchase-orders/check-serials", headers=owner, json={"serials": ["chair-sn-1"]})
    assert own.json()["conflicts"][0]["asset_code"] == chair["asset_code"]


def _rows(content: bytes) -> list[tuple]:
    ws = openpyxl.load_workbook(BytesIO(content)).active
    return list(ws.iter_rows(min_row=2, values_only=True))


async def test_the_movement_and_field_change_exports_follow_the_work_area_and_skip_deleted_assets(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    laptop = await make_asset(client, owner, w, "it", serial_number="LAP-1")
    chair = await make_asset(client, owner, w, "nonit", serial_number="CHR-1")
    mistake = await make_asset(client, owner, w, "it", serial_number="LAP-OOPS")
    for a in (laptop, chair, mistake):
        edit = await client.put(f"/api/assets/{a['id']}", headers=owner, json={"description": "renamed", "serial_number": a["serial_number"]})
        assert edit.status_code == 200, edit.text
    assert (await client.delete(f"/api/assets/{mistake['id']}", headers=owner)).status_code == 204

    viewer = await login(client, w, "viewer_it")
    moves = await client.get("/api/reports/export/movements?from_date=2020-01-01&to_date=2030-01-01", headers=viewer)
    assert {r[0] for r in _rows(moves.content)} == {laptop["asset_code"]}
    changes = await client.get("/api/reports/export/field-changes", headers=viewer)
    assert {r[0] for r in _rows(changes.content)} == {laptop["asset_code"]}
    everything = await client.get("/api/reports/export/movements?from_date=2020-01-01&to_date=2030-01-01", headers=owner)
    assert {r[0] for r in _rows(everything.content)} == {laptop["asset_code"], chair["asset_code"]}


async def test_moving_an_asset_between_it_and_non_it_needs_someone_who_handles_both(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    laptop = await make_asset(client, owner, w, "it")
    admin_it = await login(client, w, "admin_it")
    domain = await client.post(f"/api/assets/{laptop['id']}/corrections", headers=admin_it,
                               json={"asset_domain": "NON_IT", "reason": "wrong team"})
    assert domain.status_code == 403
    op_both = await login(client, w, "op_both")
    category = await client.post(f"/api/assets/{laptop['id']}/corrections", headers=op_both,
                                 json={"category_id": w["nonit"], "subcategory_id": w["chair"], "reason": "is a chair"})
    assert category.status_code == 403 and "handles both" in category.json()["detail"]
    admin = await login(client, w, "admin")
    ok = await client.post(f"/api/assets/{laptop['id']}/corrections", headers=admin,
                           json={"asset_domain": "NON_IT", "reason": "wrong team"})
    assert ok.status_code == 200 and ok.json()["asset_domain"] == "NON_IT"
