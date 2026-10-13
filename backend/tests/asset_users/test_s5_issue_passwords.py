"""S5: POST /api/asset-users/issue-passwords -- a temporary password for many accounts at once (new stores,
new employees), shown only in the answer, never in logs; head-office admins and the caller never included;
at most 500 per call."""
import logging

from sqlalchemy import insert, select

from app.asset_users.models import AssetUser
from app.assets.models import AssetFieldChange
from app.core.db import SessionLocal
from app.masters.models import MasterAudit
from tests.core.s0_world import build_world, login


async def make_stores(w, codes, password=None):
    async with SessionLocal() as s:
        for code in codes:
            s.add(AssetUser(company_id=w["co"], code=code, name=f"Store {code}", asset_user_type="STORE", location_id=w["loc"],
                            role="SELF_SERVICE", login_enabled=True, email=f"sm.{code.lower()}@citykartstores.com",
                            password_hash=password))
        await s.commit()


async def issue(client, h, **payload):
    return await client.post("/api/asset-users/issue-passwords", headers=h, json=payload)


async def test_every_new_store_gets_a_temporary_password_it_must_change(client):
    w = await build_world()
    await make_stores(w, ["LAM", "LAD"])
    resp = await issue(client, await login(client, w, "admin"), kind="stores")
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert [(r["code"], r["email"]) for r in rows] == [("LAD", "sm.lad@citykartstores.com"), ("LAM", "sm.lam@citykartstores.com")]
    assert set(rows[0]) == {"asset_user_id", "code", "name", "email", "temp_password"}
    assert len({r["temp_password"] for r in rows}) == 2 and all(len(r["temp_password"]) >= 10 for r in rows)
    for r in rows:
        signed_in = await client.post("/api/auth/login", json={"login_id": r["email"], "password": r["temp_password"]})
        assert signed_in.status_code == 200 and signed_in.json()["must_change_password"] is True
    again = await issue(client, await login(client, w, "admin"), kind="stores")
    assert again.json() == []                                        # only those without a password, by default


async def test_only_without_password_false_reissues_and_ids_and_company_narrow_it(client):
    w = await build_world()
    await make_stores(w, ["LAM", "LAD"], password="x")
    h = await login(client, w, "admin")
    assert (await issue(client, h, kind="stores")).json() == []
    redo = await issue(client, h, kind="stores", only_without_password=False, company_id=w["co_b"])
    assert redo.json() == []
    async with SessionLocal() as s:
        lam = (await s.execute(select(AssetUser).where(AssetUser.code == "LAM"))).scalar_one()
    one = await issue(client, h, asset_user_ids=[lam.id], only_without_password=False)
    assert [r["code"] for r in one.json()] == ["LAM"]
    employees = await issue(client, h, kind="employees", only_without_password=False, company_id=w["co"])
    codes = {r["code"] for r in employees.json()}
    assert "S0ADM" not in codes                                       # never the caller
    assert not codes & {"S0OWN", "S0OWN2"}                            # never a head-office admin
    assert "S0EMP" not in codes                                       # cannot sign in
    assert {"S0ADMIT", "S0OPIT", "S0OPNI", "S0OPBO", "S0VWIT"} <= codes


async def test_head_office_admins_inactive_and_non_login_accounts_are_left_out_even_by_id(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await issue(client, h, asset_user_ids=[w["owner"], w["owner2"], w["employee"], w["dead_stock"], w["admin"]],
                       only_without_password=False)
    assert resp.status_code == 200 and resp.json() == []


async def test_choices_roles_and_the_500_cap(client):
    w = await build_world()
    admin = await login(client, w, "admin")
    nothing = await issue(client, admin)
    assert nothing.status_code == 422 and nothing.json()["detail"].startswith("Choose whose passwords to issue")
    bad = await issue(client, admin, kind="vendors")
    assert bad.status_code == 422 and bad.json()["detail"] == "Choose stores or employees."
    assert (await issue(client, await login(client, w, "op_both"), kind="stores")).status_code == 403
    too_many_ids = await issue(client, admin, asset_user_ids=list(range(1, 502)))
    assert too_many_ids.status_code == 422
    async with SessionLocal() as s:
        await s.execute(insert(AssetUser), [
            {"company_id": w["co"], "code": f"ST{i:04d}", "name": f"Store {i}", "asset_user_type": "STORE", "location_id": w["loc"],
             "role": "SELF_SERVICE", "login_enabled": True, "is_primary_owner": False, "must_change_password": True,
             "failed_login_count": 0, "is_active": True}
            for i in range(501)])
        await s.commit()
    capped = await issue(client, admin, kind="stores")
    assert capped.status_code == 422
    assert capped.json()["detail"] == "That is 501 accounts; at most 500 can be given a password at a time. Choose a company, or pick the accounts."
    async with SessionLocal() as s:
        assert (await s.execute(select(AssetUser.id).where(AssetUser.code.like("ST%"), AssetUser.password_hash.is_not(None)))).first() is None


async def test_the_passwords_never_reach_a_log_an_audit_row_or_the_console(client, caplog, capsys):
    w = await build_world()
    await make_stores(w, ["LAM", "LAD", "LAS"])
    caplog.set_level(logging.DEBUG)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.INFO)       # even with every statement logged
    try:
        resp = await issue(client, await login(client, w, "admin"), kind="stores")
    finally:
        logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    temps = [r["temp_password"] for r in resp.json()]
    assert len(temps) == 3
    captured = capsys.readouterr()
    everything = caplog.text + captured.out + captured.err + " ".join(str(r.args) for r in caplog.records)
    assert caplog.records, "the statements were logged, so the check below means something"
    for temp in temps:
        assert temp not in everything
    async with SessionLocal() as s:
        texts = [f"{c.old_value} {c.new_value}" for c in (await s.execute(select(AssetFieldChange))).scalars().all()]
        texts += [f"{a.old_value} {a.new_value}" for a in (await s.execute(select(MasterAudit))).scalars().all()]
        hashes = (await s.execute(select(AssetUser.password_hash).where(AssetUser.code.in_(["LAM", "LAD", "LAS"])))).scalars().all()
    for temp in temps:
        assert not any(temp in t for t in texts) and not any(temp in (h or "") for h in hashes)
