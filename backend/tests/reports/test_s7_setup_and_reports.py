"""S7 fix round: "Set up CKAM" per company (P2-3) and no asset report for a self-service login (P3-9)."""
from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, Location
from app.numbering.models import CodeRule
from tests.core.s0_world import make_asset
from tests.purchase_orders.s4_world import Statements, build_s4_world, login

SELF_SERVICE_REPORTS = "Reports are for staff. The assets you hold are listed under My Assets."


async def _new_company(code="NEWCO") -> int:
    async with SessionLocal() as s:
        co = Company(code=code, name=f"{code} Pvt Ltd")
        s.add(co)
        await s.commit()
        return co.id


def done_of(status: dict) -> dict:
    return {st["key"]: st["done"] for st in status["steps"]}


async def test_a_brand_new_company_shows_its_own_steps_not_done(client):
    w = await build_s4_world()
    new = await _new_company()
    h = await login(client, w, "owner")
    resp = await client.get("/api/setup/status", headers=h, params={"company_id": new})
    assert resp.status_code == 200, resp.text
    s = resp.json()
    assert (s["company_id"], s["company_name"], s["company_code"]) == (new, "NEWCO Pvt Ltd", "NEWCO")
    assert done_of(s) == {"company": True, "stock-room": False, "cost-centre": False, "catalogue": True, "vendors": True,
                          "people": False, "code-format": True}           # groups / Items / vendors are shared; the code rule is global
    assert (s["place_count"], s["stock_room_count"], s["cost_centre_count"], s["people_count"], s["store_count"]) == (0, 0, 0, 0, 0)
    assert s["done_count"] == 4 and s["total_steps"] == 7


async def test_without_a_company_the_answer_is_the_old_global_one(client):
    w = await build_s4_world()
    await _new_company()
    s = (await client.get("/api/setup/status", headers=await login(client, w, "owner"))).json()
    assert s["company_id"] is None and s["company_name"] is None
    assert all(done_of(s).values()) and s["company_count"] == 3


async def test_the_steps_fill_in_as_the_company_gets_set_up(client):
    w = await build_s4_world()
    new = await _new_company()
    h = await login(client, w, "owner")
    async with SessionLocal() as s:
        place = Location(company_id=new, code="NEW-HO", name="New HO")
        s.add_all([place, CostCenter(company_id=new, code="NHO", name="New HO")])
        await s.flush()
        s.add_all([
            AssetUser(company_id=new, code="NSTK", name="New Stock", asset_user_type="STOCK_POINT", location_id=place.id, role="SELF_SERVICE"),
            AssetUser(company_id=new, code="NEMP", name="New Person", asset_user_type="EMPLOYEE", location_id=place.id, role="SELF_SERVICE"),
        ])
        await s.commit()
    s = (await client.get("/api/setup/status", headers=h, params={"company_id": new})).json()
    assert all(done_of(s).values()) and s["done_count"] == 7


async def test_the_code_format_step_counts_the_companys_own_rule_or_a_global_one(client):
    w = await build_s4_world()
    new = await _new_company()
    other = await _new_company("OTHERCO")
    h = await login(client, w, "owner")
    async with SessionLocal() as s:
        global_rule = await s.get(CodeRule, w["rule"])
        global_rule.is_active = False
        s.add(CodeRule(company_id=other, prefix_template="OT/", suffix_template="", start_number=1, pad_width=0))
        await s.commit()
    assert done_of((await client.get("/api/setup/status", headers=h, params={"company_id": new})).json())["code-format"] is False
    assert done_of((await client.get("/api/setup/status", headers=h, params={"company_id": other})).json())["code-format"] is True
    # the old global answer still says "some rule exists"
    assert done_of((await client.get("/api/setup/status", headers=h)).json())["code-format"] is True


async def test_another_companys_records_never_count(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    s = (await client.get("/api/setup/status", headers=h, params={"company_id": w["co_b"]})).json()
    assert s["cost_centre_count"] == 1 and s["stock_room_count"] == 1 and s["people_count"] == 0     # only company B's
    a = (await client.get("/api/setup/status", headers=h, params={"company_id": w["co"]})).json()
    assert a["stock_room_count"] == 2 and a["people_count"] == 8


async def test_an_unknown_company_is_a_404_and_the_check_stays_admin_only(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    missing = await client.get("/api/setup/status", headers=h, params={"company_id": 999999})
    assert missing.status_code == 404 and missing.json()["detail"] == "This company was not found."
    assert (await client.get("/api/setup/status", headers=await login(client, w, "op_it"),
                             params={"company_id": w["co"]})).status_code == 403
    assert (await client.get("/api/setup/status", headers=await login(client, w, "admin"),
                             params={"company_id": w["co_b"]})).status_code == 200


async def test_the_per_company_answer_is_still_a_couple_of_queries(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    with Statements() as st:
        assert (await client.get("/api/setup/status", headers=h, params={"company_id": w["co"]})).status_code == 200
    assert st.count <= 3                       # the caller, the company, ONE query for every count


# ------------------------------------------------------------------ reports for a self-service login

async def _self_service(client, w) -> dict:
    async with SessionLocal() as s:
        me = AssetUser(company_id=w["co"], code="SELF7", name="Me", asset_user_type="EMPLOYEE", location_id=w["loc"],
                       role="SELF_SERVICE", login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        s.add(me)
        await s.commit()
        w["self7"] = me.id
    token = (await client.post("/api/auth/login", json={"login_id": "SELF7", "password": "Passw0rd!"})).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_a_self_service_login_gets_no_asset_report_preview_or_file(client):
    w = await build_s4_world()
    me = await _self_service(client, w)
    owner = await login(client, w, "owner")
    mine = await make_asset(client, owner, w, "it")
    assert (await client.post("/api/assets/bulk-move", headers=owner, json={
        "asset_ids": [mine["id"]], "to_asset_user_id": w["self7"]})).json()["moved"] == 1
    for path in ("/api/reports/assets/preview", "/api/reports/export/assets"):
        resp = await client.get(path, headers=me)
        assert resp.status_code == 403 and resp.json()["detail"] == SELF_SERVICE_REPORTS, path
    own = (await client.get("/api/assets", headers=me)).json()
    assert [a["id"] for a in own["items"]] == [mine["id"]]                         # My Assets still shows it


async def test_staff_keep_their_asset_reports(client):
    w = await build_s4_world()
    await make_asset(client, await login(client, w, "owner"), w, "it")
    for who in ("owner", "op_it", "viewer_it"):
        h = await login(client, w, who)
        assert (await client.get("/api/reports/assets/preview", headers=h)).status_code == 200, who
        assert (await client.get("/api/reports/export/assets", headers=h)).status_code == 200, who
