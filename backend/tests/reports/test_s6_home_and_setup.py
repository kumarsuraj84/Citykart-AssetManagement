"""S6: GET /api/setup/status (the seven set-up steps from one query) and GET /api/home/attention (Home's
"Needs attention" numbers in one call, scoped like the dashboard)."""
import pytest
from sqlalchemy import update

from app.core.db import SessionLocal
from app.erp.source import ErpReceipt
from app.items.models import Item
from app.numbering.models import CodeRule
from tests.core.s0_world import make_asset
from tests.erp.s3a2_world import build_s3a2_world, create_body
from tests.erp.test_erp_api import _headers, desktop_po, erp, line  # noqa: F401  (erp is a fixture)
from tests.purchase_orders.s4_world import Statements, build_s4_world, login, make_po

STEP_KEYS = ["company", "stock-room", "cost-centre", "catalogue", "vendors", "people", "code-format"]


# ------------------------------------------------------------------ setup status

async def test_setup_status_counts_what_exists_and_marks_each_step(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    resp = await client.get("/api/setup/status", headers=h)
    assert resp.status_code == 200, resp.text
    s = resp.json()
    assert {k: s[k] for k in ("company_count", "place_count", "stock_room_count", "cost_centre_count", "category_count",
                              "subcategory_count", "item_count", "vendor_count", "people_count", "store_count")} == {
        "company_count": 2, "place_count": 2, "stock_room_count": 3, "cost_centre_count": 2, "category_count": 2,
        "subcategory_count": 2, "item_count": 4, "vendor_count": 1, "people_count": 8, "store_count": 0}
    assert s["code_rule_configured"] is True
    assert [st["key"] for st in s["steps"]] == STEP_KEYS
    assert [st["label"] for st in s["steps"]] == ["Company", "Stock Room / Places", "Cost Centre", "Asset Groups and first Items",
                                                 "Vendors", "People / Stores", "Asset Code Format"]
    assert all(st["done"] for st in s["steps"]) and (s["done_count"], s["total_steps"]) == (7, 7)


async def test_steps_follow_the_data(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        await s.execute(update(Item).values(is_active=False))
        await s.execute(update(CodeRule).values(is_active=False))
        await s.commit()
    status = (await client.get("/api/setup/status", headers=await login(client, w, "admin"))).json()
    done = {st["key"]: st["done"] for st in status["steps"]}
    assert done == {"company": True, "stock-room": True, "cost-centre": True, "catalogue": False, "vendors": True,
                    "people": True, "code-format": False}
    assert status["item_count"] == 0 and status["code_rule_configured"] is False and status["done_count"] == 5


async def test_setup_status_is_for_admins_and_one_query(client):
    w = await build_s4_world()
    for who, code in (("owner", 200), ("admin", 200), ("admin_it", 200), ("op_it", 403), ("viewer_it", 403)):
        assert (await client.get("/api/setup/status", headers=await login(client, w, who))).status_code == code, who
    h = await login(client, w, "owner")
    with Statements() as st:
        assert (await client.get("/api/setup/status", headers=h)).status_code == 200
    assert st.count <= 2                       # the caller's account + ONE query for every count


# ------------------------------------------------------------------ home attention

async def _home_world(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    await make_po(client, h, w, [("gangbox", 3), ("chair", 2)], number="PO-WAIT")
    later = await client.post("/api/assets/batch", headers=h, json={
        "item_id": w["item_ap"], "quantity": 2, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]})
    assert later.status_code == 201 and later.json()["serial_pending"] == 2
    repair = await make_asset(client, h, w, "it")                       # made without an Item: unlinked
    lost = await make_asset(client, h, w, "nonit")
    assert (await client.post(f"/api/assets/{repair['id']}/events", headers=h, json={"event_type": "SENT_FOR_REPAIR"})).status_code == 201
    assert (await client.post(f"/api/assets/{lost['id']}/events", headers=h, json={"event_type": "LOST"})).status_code == 201
    return w, h


async def test_home_numbers_for_the_head_office_admin(client, monkeypatch):
    monkeypatch.setattr("app.home.service.is_configured", lambda: False)          # a server without the ERP link
    w, h = await _home_world(client)
    resp = await client.get("/api/home/attention", headers=h)
    assert resp.status_code == 200, resp.text
    a = resp.json()
    assert {k: a[k] for k in ("serial_pending", "under_repair", "lost", "unlinked_assets", "waiting_pos", "waiting_units")} == {
        "serial_pending": 2, "under_repair": 1, "lost": 1, "unlinked_assets": 2, "waiting_pos": 1, "waiting_units": 5}
    assert a["erp_available"] is False and a["erp_changed_pos"] is None and a["inbox"] is None    # no ERP link set up here


async def test_home_numbers_equal_the_older_endpoints(client):
    w, _ = await _home_world(client)
    for who in ("owner", "op_it", "op_nonit"):
        h = await login(client, w, who)
        home = (await client.get("/api/home/attention", headers=h)).json()
        dash = (await client.get("/api/reports/dashboard", headers=h)).json()
        assert home["serial_pending"] == dash["serial_pending_count"], who
        assert home["under_repair"] == dash["exception_counts"]["UNDER_REPAIR"], who
        assert home["lost"] == dash["exception_counts"]["LOST"], who
        assert home["waiting_units"] == dash["pending_po_summary"]["count"], who
        waiting = await client.get("/api/purchase-orders", headers=h, params={"waiting": "true", "limit": 1})
        assert home["waiting_pos"] == int(waiting.headers["X-Total-Count"]), who


async def test_home_numbers_follow_the_callers_work_area_and_role(client):
    w, _ = await _home_world(client)
    it = (await client.get("/api/home/attention", headers=await login(client, w, "op_it"))).json()
    assert (it["waiting_units"], it["under_repair"], it["lost"], it["serial_pending"], it["unlinked_assets"]) == (3, 1, 0, 2, None)
    nonit = (await client.get("/api/home/attention", headers=await login(client, w, "op_nonit"))).json()
    assert (nonit["waiting_units"], nonit["under_repair"], nonit["lost"], nonit["serial_pending"]) == (2, 0, 1, 0)
    viewer = (await client.get("/api/home/attention", headers=await login(client, w, "viewer_it"))).json()
    assert viewer["under_repair"] == 1 and viewer["waiting_pos"] is None and viewer["waiting_units"] is None
    assert viewer["unlinked_assets"] is None and viewer["erp_available"] is False
    one_area_admin = (await client.get("/api/home/attention", headers=await login(client, w, "admin_it"))).json()
    assert one_area_admin["unlinked_assets"] == 1                        # the IT asset only


async def test_the_work_area_choice_narrows_but_never_widens(client):
    w, h = await _home_world(client)
    narrowed = (await client.get("/api/home/attention", headers=h, params={"work_area": "Non-IT"})).json()
    assert (narrowed["work_area"], narrowed["waiting_units"], narrowed["lost"], narrowed["under_repair"]) == ("NON_IT", 2, 1, 0)
    ignored = (await client.get("/api/home/attention", headers=await login(client, w, "op_it"), params={"work_area": "NON_IT"})).json()
    assert (ignored["work_area"], ignored["waiting_units"], ignored["lost"]) == (None, 3, 0)
    bad = await client.get("/api/home/attention", headers=h, params={"work_area": "MARS"})
    assert bad.status_code == 422 and bad.json()["detail"] == "Choose a work area: IT or Non-IT."


async def test_another_companys_figures_are_never_counted(client):
    w, _ = await _home_world(client)
    owner = await login(client, w, "owner")
    await make_asset(client, owner, w, "it", company_id=w["co_b"], cost_center_id=w["cc_b"], initial_asset_user_id=w["stock_b"])
    op = (await client.get("/api/home/attention", headers=await login(client, w, "op_both"))).json()
    assert op["under_repair"] == 1 and op["serial_pending"] == 2
    everyone = (await client.get("/api/home/attention", headers=owner)).json()
    assert everyone["unlinked_assets"] == 3


async def test_the_unlinked_count_equals_the_link_tools_total(client):
    w, _ = await _home_world(client)
    for who in ("owner", "admin_it"):
        headers = await login(client, w, who)
        home = (await client.get("/api/home/attention", headers=headers, params={"include_erp": "false"})).json()
        tool = await client.get("/api/assets/unlinked-items", headers=headers, params={"limit": 1})
        assert home["unlinked_assets"] == int(tool.headers["X-Total-Count"]), who


async def test_self_service_has_no_home_counters(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        from app.asset_users.models import AssetUser
        from app.core.security import hash_password
        me = AssetUser(company_id=w["co"], code="SELF6", name="Me", asset_user_type="EMPLOYEE", location_id=w["loc"],
                       role="SELF_SERVICE", login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        s.add(me)
        await s.commit()
    token = (await client.post("/api/auth/login", json={"login_id": "SELF6", "password": "Passw0rd!"})).json()["access_token"]
    assert (await client.get("/api/home/attention", headers={"Authorization": f"Bearer {token}"})).status_code == 403


async def test_the_ckam_counters_are_two_aggregate_queries_whatever_the_data(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")

    async def statements() -> int:
        with Statements() as st:
            assert (await client.get("/api/home/attention", headers=h, params={"include_erp": "false"})).status_code == 200
        return st.count

    empty = await statements()
    await make_po(client, h, w, [("gangbox", 30), ("chair", 20)], number="PO-BIG")
    await make_po(client, h, w, [("camera", 5)], number="PO-BIG2")
    await client.post("/api/assets/batch", headers=h, json={
        "item_id": w["item_ap"], "quantity": 40, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]})
    assert await statements() == empty
    assert empty <= 3                          # the caller's account + one asset aggregate + one PO aggregate


# ------------------------------------------------------------------ ERP figures

@pytest.fixture
def erp_on(monkeypatch):
    monkeypatch.setattr("app.home.service.is_configured", lambda: True)
    monkeypatch.setattr("app.erp.router.is_configured", lambda: True)


async def test_erp_figures_equal_the_erp_screens(client, erp, erp_on):
    ids = await build_s3a2_world(erp)
    h = await _headers(client)                                              # the head-office admin
    draft = (await client.get("/api/erp/pos/1133610106/draft", headers=h)).json()
    made = await client.post("/api/erp/pos/create", headers=h, json=create_body(draft, ids))
    assert made.status_code == 201, made.text
    erp.pos[1133610106] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 5, 20000)])            # the ERP changed it
    erp.receipt_list = [ErpReceipt(po_code=1133610106, item_code="CT324973", received_qty=2, grc_no="G1", grc_date=None)]
    erp.pos[9002] = desktop_po(po_code=9002, po_number="SPO/9002", supplier_code="2264", supplier_name="JAGANNATH ENTERPRISES")

    home = (await client.get("/api/home/attention", headers=h)).json()
    changed = (await client.get("/api/erp/changes/summary", headers=h)).json()["items"]
    arrived = (await client.get("/api/erp/reminders", headers=h)).json()
    needing = (await client.get("/api/erp/pos", headers=h, params={"envelope": "true"})).json()["counts"]["needs_input"]
    inbox = (await client.get("/api/erp/inbox/counts", headers=h)).json()
    assert home["erp_available"] is True
    assert (home["erp_changed_pos"], home["erp_arrived_pos"], home["erp_pos_needing_input"]) == (len(changed), len(arrived), needing)
    assert home["erp_changed_pos"] == 1 and home["erp_arrived_pos"] == 1 and home["erp_pos_needing_input"] >= 1
    assert home["inbox"] == inbox

    op = (await client.get("/api/home/attention", headers=await _headers(client, "OPR"))).json()
    assert op["erp_available"] is True and op["inbox"] is None                       # the inbox is head-office only
    skipped = (await client.get("/api/home/attention", headers=h, params={"include_erp": "false"})).json()
    assert skipped["erp_available"] is False and skipped["erp_changed_pos"] is None


async def test_an_unreadable_erp_only_hides_the_erp_figures(client, erp, erp_on):
    await build_s3a2_world(erp)
    erp.down = "The ERP copy cannot be read."
    h = await _headers(client)
    resp = await client.get("/api/home/attention", headers=h)
    assert resp.status_code == 200
    a = resp.json()
    assert a["erp_available"] is False and a["erp_pos_needing_input"] is None and a["inbox"] is None
    assert a["serial_pending"] == 0 and a["waiting_pos"] == 0
