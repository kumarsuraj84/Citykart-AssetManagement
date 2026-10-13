"""Store users made from the ERP's site list: one STORE user per store, code = the ERP short name,
login email sm.<code>@citykartstores.com. Only normal store codes are offered; dummies and test sites are not."""
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.config import settings
from app.core.db import SessionLocal
from app.erp.sync import run_sync
from app.masters.models import Location
from tests.erp.fake_warehouse import FakeWarehouse, wh_site
from tests.erp.test_erp_api import _headers, _setup


async def seed_sites():
    wh = FakeWarehouse()
    wh.site_list = [
        wh_site("CKSPL", 2, "LAM"), wh_site("CKSPL", 3, "LAD"), wh_site("CKSPL", 144, "SPR2", store_type="OLD STORE"),
        wh_site("CKSPL", 231, "NSO1", store_status="IN-ACTIVE"),                       # a normal code, but not open
        wh_site("CKSPL", 6, "ALS", store_status="CLOSED"),
        wh_site("CKSPL", 400, "UPC", store_status="UPCOMING_STORE"),
        wh_site("CKSPL", 64, "UP-DUMMY", store_status="-"),                            # not a store code
        wh_site("CKSPL", 192, "BRBxx", store_status="IN-ACTIVE"),                      # not a store code
        wh_site("CKSPL", 500, "LAS", is_active_site=False),                            # the ERP site itself is switched off
        wh_site("CKSPL", 68, "CKSPL-HO", site_kind="HEAD_OFFICE", store_status=None),  # not a store
        wh_site("CKSPL", 250, "CKSPL-WH-TAJNAGAR", site_kind="WAREHOUSE", store_status=None),
        wh_site("CKVPL", 2, "ZZZ", site_kind="STORE"),                                 # the other company's site 2
    ]
    await run_sync(SessionLocal, wh, "manual")


async def stores(client, h, company_id):
    resp = await client.get("/api/erp/stores", params={"company_id": company_id}, headers=h)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def users_by_code(company_id):
    async with SessionLocal() as s:
        return {u.code: u for u in (await s.execute(select(AssetUser).where(AssetUser.company_id == company_id))).scalars().all()}


async def test_the_list_offers_real_stores_grouped_by_their_state_with_the_login_email(client):
    ids = await _setup()
    await seed_sites()
    body = await stores(client, await _headers(client), ids["spl"])
    rows = {r["code"]: r for r in body["stores"]}
    assert set(rows) == {"LAM", "LAD", "SPR2", "NSO1", "ALS", "UPC", "UP-DUMMY", "BRBxx"}      # no HO, warehouse, switched-off site, other company
    assert (rows["LAM"]["group"], rows["LAM"]["selectable"], rows["LAM"]["selected_by_default"], rows["LAM"]["email"]) == (
        "READY", True, True, "sm.lam@citykartstores.com")
    assert rows["SPR2"]["email"] == "sm.spr2@citykartstores.com" and rows["SPR2"]["selected_by_default"] is True       # the 4-character code
    assert (rows["UPC"]["group"], rows["UPC"]["selectable"], rows["UPC"]["selected_by_default"]) == ("UPCOMING", True, False)
    assert (rows["NSO1"]["group"], rows["ALS"]["group"]) == ("INACTIVE", "INACTIVE") and rows["ALS"]["selectable"] is True
    for code in ("UP-DUMMY", "BRBxx"):
        assert rows[code]["group"] == "NOT_A_STORE_CODE" and rows[code]["selectable"] is False and rows[code]["email"] is None
        assert "usual store code" in rows[code]["reason"]
    assert body["summary"] == {"READY": 3, "UPCOMING": 1, "INACTIVE": 2, "NOT_A_STORE_CODE": 2, "ALREADY_CREATED": 0}
    assert rows["LAM"]["name"] == "LAM" and rows["LAM"]["state"] == "UP" and rows["LAM"]["city"] == "LUCKNOW"


async def test_the_other_companys_sites_are_listed_for_that_company_only(client):
    ids = await _setup()
    await seed_sites()
    body = await stores(client, await _headers(client), ids["vpl"])
    assert [r["code"] for r in body["stores"]] == ["ZZZ"]


async def test_creating_makes_the_location_and_the_store_user_without_a_password(client):
    ids = await _setup()
    await seed_sites()
    h = await _headers(client)
    resp = await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["LAM", "SPR2"]})
    assert resp.status_code == 200, resp.text
    assert sorted(resp.json()["created"]) == ["LAM", "SPR2"] and resp.json()["skipped"] == []
    users = await users_by_code(ids["spl"])
    lam = users["LAM"]
    assert (lam.asset_user_type, lam.role, lam.email, lam.login_enabled, lam.must_change_password) == (
        "STORE", "SELF_SERVICE", "sm.lam@citykartstores.com", True, True)
    assert lam.password_hash is None and lam.name == "LAM" and lam.is_active
    async with SessionLocal() as s:
        loc = await s.get(Location, lam.location_id)
    assert (loc.company_id, loc.code, loc.name) == (ids["spl"], "LAM", "LAM")
    assert users["SPR2"].email == "sm.spr2@citykartstores.com"


async def test_creating_again_adds_only_what_is_new(client):
    ids = await _setup()
    await seed_sites()
    h = await _headers(client)
    await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["LAM"]})
    again = await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["LAM", "LAD"]})
    assert again.json()["created"] == ["LAD"]
    assert again.json()["skipped"] == [{"code": "LAM", "reason": "A user with this code already exists."}]
    body = await stores(client, h, ids["spl"])
    assert body["summary"]["ALREADY_CREATED"] == 2
    lam = next(r for r in body["stores"] if r["code"] == "LAM")
    assert lam["exists"] is True and lam["selectable"] is False and lam["asset_user_id"] is not None


async def test_codes_that_are_not_stores_are_refused_while_the_rest_is_created(client):
    ids = await _setup()
    await seed_sites()
    resp = await client.post("/api/erp/stores/create", headers=await _headers(client),
                             json={"company_id": ids["spl"], "codes": ["LAM", "UP-DUMMY", "NOPE", "ZZZ"]})
    assert resp.status_code == 200
    assert resp.json()["created"] == ["LAM"]
    reasons = {s["code"]: s["reason"] for s in resp.json()["skipped"]}
    assert "usual store code" in reasons["UP-DUMMY"]
    assert "not a store of this company" in reasons["NOPE"] and "not a store of this company" in reasons["ZZZ"]      # ZZZ belongs to CKVPL


async def test_an_existing_location_with_the_same_code_is_reused(client):
    ids = await _setup()
    await seed_sites()
    async with SessionLocal() as s:
        s.add(Location(company_id=ids["spl"], code="LAM", name="Lucknow Aminabad"))
        await s.commit()
    await client.post("/api/erp/stores/create", headers=await _headers(client), json={"company_id": ids["spl"], "codes": ["LAM"]})
    async with SessionLocal() as s:
        locs = (await s.execute(select(Location).where(Location.company_id == ids["spl"], Location.code == "LAM"))).scalars().all()
    assert len(locs) == 1 and locs[0].name == "Lucknow Aminabad"
    assert (await users_by_code(ids["spl"]))["LAM"].location_id == locs[0].id


async def test_an_email_already_used_by_someone_else_is_not_offered(client):
    ids = await _setup()
    await seed_sites()
    async with SessionLocal() as s:
        opr = (await s.execute(select(AssetUser).where(AssetUser.code == "OPR"))).scalar_one()
        opr.email = "SM.LAM@CITYKARTSTORES.COM"
        await s.commit()
    h = await _headers(client)
    row = next(r for r in (await stores(client, h, ids["spl"]))["stores"] if r["code"] == "LAM")
    assert row["selectable"] is False and "email is already used" in row["reason"]
    resp = await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["LAM"]})
    assert resp.json()["created"] == [] and "email is already used" in resp.json()["skipped"][0]["reason"]


async def test_the_email_rule_can_be_changed_in_settings(client, monkeypatch):
    ids = await _setup()
    await seed_sites()
    monkeypatch.setattr(settings, "store_email_pattern", "{code}.store@example.test")
    h = await _headers(client)
    assert next(r for r in (await stores(client, h, ids["spl"]))["stores"] if r["code"] == "SPR2")["email"] == "spr2.store@example.test"
    await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["SPR2"]})
    assert (await users_by_code(ids["spl"]))["SPR2"].email == "spr2.store@example.test"


async def test_only_the_primary_owner_manages_store_users_and_the_company_must_exist(client):
    ids = await _setup()
    await seed_sites()
    op = await _headers(client, "OPR")
    assert (await client.get("/api/erp/stores", params={"company_id": ids["spl"]}, headers=op)).status_code == 403
    assert (await client.post("/api/erp/stores/create", headers=op, json={"company_id": ids["spl"], "codes": ["LAM"]})).status_code == 403
    h = await _headers(client)
    assert (await client.get("/api/erp/stores", params={"company_id": 99999}, headers=h)).status_code == 404
    assert (await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": []})).status_code == 422


async def test_a_new_store_cannot_sign_in_until_a_password_is_issued_and_then_signs_in_with_its_email(client):
    ids = await _setup()
    await seed_sites()
    h = await _headers(client)
    await client.post("/api/erp/stores/create", headers=h, json={"company_id": ids["spl"], "codes": ["LAM"]})
    assert (await client.post("/api/auth/login", json={"login_id": "sm.lam@citykartstores.com", "password": "anything"})).status_code == 401
    lam = (await users_by_code(ids["spl"]))["LAM"]
    reset = await client.post(f"/api/asset-users/{lam.id}/reset-password", headers=h)
    assert reset.status_code == 200, reset.text
    login = await client.post("/api/auth/login", json={"login_id": "SM.LAM@CitykartStores.com", "password": reset.json()["temp_password"]})
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "SELF_SERVICE" and login.json()["must_change_password"] is True


async def test_no_sites_copied_yet_gives_an_empty_list(client):
    ids = await _setup()
    body = await stores(client, await _headers(client), ids["spl"])
    assert body["stores"] == [] and body["copied"] is False
    await seed_sites()
    assert (await stores(client, await _headers(client), ids["spl"]))["copied"] is True
