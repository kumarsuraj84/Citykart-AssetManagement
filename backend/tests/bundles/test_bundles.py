"""Bundles (Desktop = CPU + TFT + Keyboard + Mouse): the master, and adding one to
a Purchase Order as ordinary lines. A bundle is a purchase-time shortcut only --
it never becomes an asset category."""
from datetime import date
from decimal import Decimal
from sqlalchemy import func, select
from app.bundles.service import split_amounts
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.purchase_orders.models import PendingAsset, PurchaseOrder


def D(x):
    return Decimal(str(x))


def test_split_follows_the_shares_and_adds_up_exactly():
    shares = [D(70), D(26), D(2), D(2)]
    assert split_amounts(D(20000), shares) == [D("14000.00"), D("5200.00"), D("400.00"), D("400.00")]
    assert split_amounts(D(16000), shares) == [D("11200.00"), D("4160.00"), D("320.00"), D("320.00")]


def test_leftover_paise_go_to_the_biggest_share_so_the_total_is_exact():
    shares = [D(70), D(26), D(2), D(2)]
    for price in (D("10001"), D("12345.67"), D("999.99"), D("0.05")):
        amounts = split_amounts(price, shares)
        assert sum(amounts) == price.quantize(D("0.01"))
        assert all(a >= 0 for a in amounts)
    # 10001 x 2% = 200.02 each; CPU (largest) absorbs the rounding difference
    assert split_amounts(D("10001"), shares)[0] == D("10001") - sum(split_amounts(D("10001"), shares)[1:])


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"BND{suffix}", name=f"Bundle Co {suffix}")
        comp = AssetCategory(code=f"COMP{suffix}", name="Computers", asset_domain="IT")
        mon = AssetCategory(code=f"MON{suffix}", name="Monitors", asset_domain="IT")
        acc = AssetCategory(code=f"ACC{suffix}", name="Accessories", asset_domain="IT")
        session.add_all([co, comp, mon, acc])
        await session.flush()
        cpu_sub = AssetSubcategory(category_id=comp.id, code="CPU", name="CPU")
        tft_sub = AssetSubcategory(category_id=mon.id, code="TFT", name="TFT")
        # Accessories need a serial in general; keyboards and mice do not.
        kb_sub = AssetSubcategory(category_id=acc.id, code="KB", name="Keyboard", serial_required=False)
        ms_sub = AssetSubcategory(category_id=acc.id, code="MS", name="Mouse", serial_required=False)
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code=f"BND{suffix}", name="HO")
        dept = Department(name=f"BND{suffix}")
        session.add_all([cpu_sub, tft_sub, kb_sub, ms_sub, cc, loc, dept])
        await session.flush()

        def user(code, name, role, owner=False):
            return AssetUser(company_id=co.id, code=f"{code}{suffix}", name=name, asset_user_type="EMPLOYEE",
                             location_id=loc.id, department_id=dept.id, role=role, is_primary_owner=owner,
                             login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        owner, operator, viewer = user("OWN", "Owner", "ADMIN", True), user("OPR", "Operator", "OPERATOR"), user("VWR", "Viewer", "VIEWER")
        session.add_all([owner, operator, viewer])
        await session.commit()
        po = PurchaseOrder(company_id=co.id, po_number=f"PO-BND-{suffix}", po_date=date(2026, 1, 1),
                           cost_center_id=cc.id, created_by=operator.id, updated_by=operator.id)
        session.add(po)
        await session.commit()
        return {
            "po": po.id, "owner": f"OWN{suffix}", "operator": f"OPR{suffix}", "viewer": f"VWR{suffix}",
            "comp": comp.id, "mon": mon.id, "acc": acc.id,
            "cpu_sub": cpu_sub.id, "tft_sub": tft_sub.id, "kb_sub": kb_sub.id, "ms_sub": ms_sub.id,
        }


async def _headers(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _desktop_body(ctx, **over):
    body = {"name": "Desktop", "parts": [
        {"name": "CPU", "category_id": ctx["comp"], "subcategory_id": ctx["cpu_sub"], "share_percent": 70},
        {"name": "TFT", "category_id": ctx["mon"], "subcategory_id": ctx["tft_sub"], "share_percent": 26},
        {"name": "Keyboard", "category_id": ctx["acc"], "subcategory_id": ctx["kb_sub"], "share_percent": 2},
        {"name": "Mouse", "category_id": ctx["acc"], "subcategory_id": ctx["ms_sub"], "share_percent": 2},
    ]}
    body.update(over)
    return body


async def _make_desktop(client, ctx):
    resp = await client.post("/api/bundles", headers=await _headers(client, ctx["owner"]), json=_desktop_body(ctx))
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------- the bundle master ----------

async def test_primary_owner_creates_a_bundle_and_everyone_can_list_it(client):
    ctx = await _setup("A1")
    bundle = await _make_desktop(client, ctx)
    assert bundle["name"] == "Desktop"
    assert [p["name"] for p in bundle["parts"]] == ["CPU", "TFT", "Keyboard", "Mouse"]
    assert [p["share_percent"] for p in bundle["parts"]] == [70, 26, 2, 2]
    assert [p["serial_required"] for p in bundle["parts"]] == [True, True, False, False]

    listed = (await client.get("/api/bundles", headers=await _headers(client, ctx["viewer"]))).json()
    assert [b["name"] for b in listed] == ["Desktop"]


async def test_only_the_primary_owner_may_change_bundles(client):
    ctx = await _setup("A2")
    op = await _headers(client, ctx["operator"])
    assert (await client.post("/api/bundles", headers=op, json=_desktop_body(ctx))).status_code == 403
    bundle = await _make_desktop(client, ctx)
    assert (await client.put(f"/api/bundles/{bundle['id']}", headers=op, json=_desktop_body(ctx))).status_code == 403
    assert (await client.delete(f"/api/bundles/{bundle['id']}", headers=op)).status_code == 403


async def test_bundle_rules_are_enforced(client):
    ctx = await _setup("A3")
    h = await _headers(client, ctx["owner"])

    bad_total = _desktop_body(ctx)
    bad_total["parts"][0]["share_percent"] = 60
    r = await client.post("/api/bundles", headers=h, json=bad_total)
    assert r.status_code == 422 and "100%" in r.json()["detail"]

    dup_part = _desktop_body(ctx)
    dup_part["parts"][3]["name"] = "keyboard"
    assert (await client.post("/api/bundles", headers=h, json=dup_part)).status_code == 422

    wrong_sub = _desktop_body(ctx)
    wrong_sub["parts"][0]["subcategory_id"] = ctx["tft_sub"]  # a Monitors sub-category under Computers
    assert (await client.post("/api/bundles", headers=h, json=wrong_sub)).status_code == 422

    assert (await client.post("/api/bundles", headers=h, json=_desktop_body(ctx, parts=[]))).status_code == 422

    await _make_desktop(client, ctx)
    again = await client.post("/api/bundles", headers=h, json=_desktop_body(ctx, name="  DESKTOP "))
    assert again.status_code == 422 and "already exists" in again.json()["detail"]


async def test_editing_keeps_parts_by_id_and_deactivates_removed_ones(client):
    ctx = await _setup("A4")
    h = await _headers(client, ctx["owner"])
    bundle = await _make_desktop(client, ctx)
    cpu, tft, kb, mouse = bundle["parts"]

    body = {"name": "Desktop Set", "parts": [
        {**cpu, "share_percent": 75},
        {**tft, "share_percent": 21},
        {**mouse, "share_percent": 4},          # keyboard left out -> deactivated
        {"name": "Speaker", "category_id": ctx["acc"], "subcategory_id": None, "share_percent": 0.5},
    ]}
    body["parts"][2]["share_percent"] = 3.5
    resp = await client.put(f"/api/bundles/{bundle['id']}", headers=h, json=body)
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["name"] == "Desktop Set"
    assert [p["name"] for p in out["parts"]] == ["CPU", "TFT", "Mouse", "Speaker"]
    assert out["parts"][0]["id"] == cpu["id"] and out["parts"][2]["id"] == mouse["id"]

    async with SessionLocal() as session:
        from app.bundles.models import BundlePart
        old_kb = await session.get(BundlePart, kb["id"])
        assert old_kb.is_active is False  # never deleted


async def test_a_deactivated_bundle_disappears_and_cannot_be_used(client):
    ctx = await _setup("A5")
    h = await _headers(client, ctx["owner"])
    bundle = await _make_desktop(client, ctx)
    assert (await client.delete(f"/api/bundles/{bundle['id']}", headers=h)).status_code == 204
    assert (await client.get("/api/bundles", headers=h)).json() == []
    r = await client.post(f"/api/purchase-orders/{ctx['po']}/bundle-lines", headers=await _headers(client, ctx["operator"]), json={
        "bundle_id": bundle["id"], "description": "Dell Desktop", "barcode": "CT1", "quantity": 1, "price": 1000})
    assert r.status_code == 422
    # ... and the name is free to use again
    assert (await client.post("/api/bundles", headers=h, json=_desktop_body(ctx))).status_code == 201


# ---------- adding a bundle to a PO ----------

async def _lines(po_id):
    async with SessionLocal() as session:
        return (await session.execute(
            select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id)
        )).scalars().all()


async def test_four_desktops_become_sixteen_ordinary_lines(client):
    ctx = await _setup("B1")
    bundle = await _make_desktop(client, ctx)
    op = await _headers(client, ctx["operator"])
    resp = await client.post(f"/api/purchase-orders/{ctx['po']}/bundle-lines", headers=op, json={
        "bundle_id": bundle["id"], "description": "Dell Desktop i3", "barcode": "CT324973",
        "quantity": 4, "price": 20000, "tax_percent": 18, "warranty_years": 1})
    assert resp.status_code == 201, resp.text
    assert len(resp.json()) == 16

    lines = await _lines(ctx["po"])
    assert len(lines) == 16
    by_desc: dict[str, list[PendingAsset]] = {}
    for l in lines:
        by_desc.setdefault(l.description, []).append(l)
    assert {d: len(v) for d, v in by_desc.items()} == {
        "Dell Desktop i3 - CPU": 4, "Dell Desktop i3 - TFT": 4, "Dell Desktop i3 - Keyboard": 4, "Dell Desktop i3 - Mouse": 4}

    cpu = by_desc["Dell Desktop i3 - CPU"][0]
    assert (float(cpu.purchase_cost), float(cpu.tax_amount), float(cpu.total_cost)) == (14000.0, 2520.0, 16520.0)
    assert cpu.category_id == ctx["comp"] and cpu.subcategory_id == ctx["cpu_sub"]
    assert all(l.barcode == "CT324973" for l in lines)               # same barcode on every part
    assert all(l.tax_percent == 18 and l.warranty_years == 1 and l.status == "PENDING" for l in lines)
    assert all(l.bundle_label == "Desktop" for l in lines)
    assert {d: v[0].serial_required for d, v in by_desc.items()} == {
        "Dell Desktop i3 - CPU": True, "Dell Desktop i3 - TFT": True,
        "Dell Desktop i3 - Keyboard": False, "Dell Desktop i3 - Mouse": False}
    # One desktop before tax = 20000, after 18% tax = 23600
    one_of_each = [v[0] for v in by_desc.values()]
    assert sum(float(l.purchase_cost) for l in one_of_each) == 20000
    assert sum(float(l.total_cost) for l in one_of_each) == 23600


async def test_edited_part_amounts_are_used_when_they_add_up_to_the_price(client):
    ctx = await _setup("B2")
    bundle = await _make_desktop(client, ctx)
    cpu, tft, kb, mouse = bundle["parts"]
    op = await _headers(client, ctx["operator"])
    resp = await client.post(f"/api/purchase-orders/{ctx['po']}/bundle-lines", headers=op, json={
        "bundle_id": bundle["id"], "description": "HP Desktop", "barcode": "CT9", "quantity": 1, "price": 16000,
        "parts": [{"part_id": cpu["id"], "amount": 11000}, {"part_id": tft["id"], "amount": 4500},
                  {"part_id": kb["id"], "amount": 250}, {"part_id": mouse["id"], "amount": 250}]})
    assert resp.status_code == 201, resp.text
    assert sorted(float(l["purchase_cost"]) for l in resp.json()) == [250, 250, 4500, 11000]


async def test_amounts_that_do_not_match_the_price_create_nothing(client):
    ctx = await _setup("B3")
    bundle = await _make_desktop(client, ctx)
    cpu, tft, kb, mouse = bundle["parts"]
    op = await _headers(client, ctx["operator"])
    r = await client.post(f"/api/purchase-orders/{ctx['po']}/bundle-lines", headers=op, json={
        "bundle_id": bundle["id"], "description": "HP Desktop", "barcode": "CT9", "quantity": 2, "price": 16000,
        "parts": [{"part_id": cpu["id"], "amount": 11000}, {"part_id": tft["id"], "amount": 4500},
                  {"part_id": kb["id"], "amount": 250}, {"part_id": mouse["id"], "amount": 300}]})
    assert r.status_code == 422 and "16050" in r.json()["detail"]

    missing = await client.post(f"/api/purchase-orders/{ctx['po']}/bundle-lines", headers=op, json={
        "bundle_id": bundle["id"], "description": "HP Desktop", "barcode": "CT9", "quantity": 1, "price": 16000,
        "parts": [{"part_id": cpu["id"], "amount": 16000}]})
    assert missing.status_code == 422
    assert await _lines(ctx["po"]) == []  # all or nothing


async def test_who_may_add_a_bundle_and_which_inputs_are_refused(client):
    ctx = await _setup("B4")
    bundle = await _make_desktop(client, ctx)
    base = {"bundle_id": bundle["id"], "description": "Dell Desktop", "barcode": "CT1", "quantity": 1, "price": 1000}
    url = f"/api/purchase-orders/{ctx['po']}/bundle-lines"
    assert (await client.post(url, headers=await _headers(client, ctx["viewer"]), json=base)).status_code == 403
    op = await _headers(client, ctx["operator"])
    assert (await client.post(url, headers=op, json={**base, "barcode": "  "})).status_code == 422
    assert (await client.post(url, headers=op, json={**base, "quantity": 0})).status_code == 422
    assert (await client.post(url, headers=op, json={**base, "price": 0})).status_code == 422
    assert (await client.post(url, headers=op, json={**base, "bundle_id": 999999})).status_code == 422
    assert (await client.post(f"/api/purchase-orders/999999/bundle-lines", headers=op, json=base)).status_code == 404
    assert await _lines(ctx["po"]) == []


async def test_bundle_lines_report_their_tag_and_serial_default_in_the_lines_list(client):
    ctx = await _setup("B5")
    bundle = await _make_desktop(client, ctx)
    op = await _headers(client, ctx["operator"])
    await client.post(f"/api/purchase-orders/{ctx['po']}/bundle-lines", headers=op, json={
        "bundle_id": bundle["id"], "description": "Dell Desktop", "barcode": "CT1", "quantity": 1, "price": 1000})
    lines = (await client.get(f"/api/purchase-orders/{ctx['po']}/lines", headers=op)).json()
    mouse = next(l for l in lines if l["description"].endswith("Mouse"))
    assert mouse["serial_required"] is False and mouse["bundle_label"] == "Desktop"
    cpu = next(l for l in lines if l["description"].endswith("CPU"))
    assert cpu["serial_required"] is True
