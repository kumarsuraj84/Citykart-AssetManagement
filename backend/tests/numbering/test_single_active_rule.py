"""Only ONE active code rule may exist per company scope (global = company_id NULL,
or one specific company), and the active-rule lookup must be deterministic even
if duplicates somehow exist. Previously every Save on the Code Rule screen POSTed
a brand-new active rule, and get_active_rule picked among the duplicates in
whatever order Postgres happened to return them."""
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import Company, Department, Location
from app.numbering.models import CodeRule
from app.numbering.service import get_active_rule


async def _admin(client, code):
    async with SessionLocal() as session:
        co = Company(code=code, name=f"{code} Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code=f"{code}-HO", name="HO")
        dept = Department(name=f"IT-{code}")
        session.add_all([loc, dept])
        await session.flush()
        session.add(AssetUser(company_id=co.id, code="RADMIN", name="Rule Admin", asset_user_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False))
        await session.commit()
        co_id = co.id
    resp = await client.post("/api/auth/login", json={"company_id": co_id, "login_id": "RADMIN", "password": "Passw0rd!"})
    return co_id, {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _body(prefix, company_id=None):
    return {"company_id": company_id, "prefix_template": prefix, "suffix_template": "", "start_number": 1, "pad_width": 0}


async def _active_rules(company_id=None):
    async with SessionLocal() as session:
        scope = CodeRule.company_id.is_(None) if company_id is None else CodeRule.company_id == company_id
        stmt = select(CodeRule).where(CodeRule.is_active.is_(True), scope)
        return (await session.execute(stmt)).scalars().all()


async def test_creating_second_rule_in_same_scope_deactivates_the_first(client):
    _, headers = await _admin(client, "CR1")
    first = (await client.post("/api/code-rules", json=_body("A/{category.code}/"), headers=headers)).json()
    second = (await client.post("/api/code-rules", json=_body("B/{category.code}/"), headers=headers)).json()

    active = await _active_rules()
    assert [r.id for r in active] == [second["id"]]
    listed = (await client.get("/api/code-rules", headers=headers)).json()
    assert [r["id"] for r in listed] == [second["id"]]
    assert first["id"] != second["id"]


async def test_updating_existing_rule_edits_in_place_without_duplicating(client):
    _, headers = await _admin(client, "CR2")
    created = (await client.post("/api/code-rules", json=_body("A/{category.code}/"), headers=headers)).json()

    resp = await client.put(f"/api/code-rules/{created['id']}", json=_body("EDITED/{category.code}/"), headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]
    assert resp.json()["prefix_template"] == "EDITED/{category.code}/"

    async with SessionLocal() as session:
        total = (await session.execute(select(func.count()).select_from(CodeRule))).scalar_one()
    assert total == 1
    assert len(await _active_rules()) == 1


async def test_updating_an_older_rule_makes_it_the_single_active_one(client):
    _, headers = await _admin(client, "CR3")
    older = (await client.post("/api/code-rules", json=_body("OLD/"), headers=headers)).json()
    newer = (await client.post("/api/code-rules", json=_body("NEW/"), headers=headers)).json()

    await client.put(f"/api/code-rules/{older['id']}", json=_body("OLD2/"), headers=headers)
    active = await _active_rules()
    assert [r.id for r in active] == [older["id"]]
    assert newer["id"] not in [r.id for r in active]


async def test_global_and_company_scopes_each_keep_their_own_active_rule(client):
    co_id, headers = await _admin(client, "CR4")
    g = (await client.post("/api/code-rules", json=_body("G/"), headers=headers)).json()
    c1 = (await client.post("/api/code-rules", json=_body("C1/", co_id), headers=headers)).json()
    c2 = (await client.post("/api/code-rules", json=_body("C2/", co_id), headers=headers)).json()

    assert [r.id for r in await _active_rules()] == [g["id"]]
    assert [r.id for r in await _active_rules(co_id)] == [c2["id"]]
    assert c1["id"] not in [r.id for r in await _active_rules(co_id)]


async def test_get_active_rule_tie_break_is_deterministic_newest_wins():
    """Defense in depth: even with duplicate active rules in one scope (e.g. data
    predating this fix), the lookup always returns the most recently created one."""
    async with SessionLocal() as session:
        co = Company(code="CR5", name="CR5 Co")
        session.add(co)
        await session.flush()
        older = CodeRule(company_id=None, prefix_template="OLDER/", suffix_template="", start_number=1, pad_width=0)
        session.add(older)
        await session.flush()
        newer = CodeRule(company_id=None, prefix_template="NEWER/", suffix_template="", start_number=1, pad_width=0)
        session.add(newer)
        await session.commit()

        for _ in range(5):
            assert (await get_active_rule(session, co.id)).id == newer.id

        # A company-specific rule still beats any global rule, regardless of id.
        specific = CodeRule(company_id=co.id, prefix_template="SPECIFIC/", suffix_template="", start_number=1, pad_width=0)
        session.add(specific)
        await session.flush()
        newest_global = CodeRule(company_id=None, prefix_template="NEWEST-GLOBAL/", suffix_template="", start_number=1, pad_width=0)
        session.add(newest_global)
        await session.commit()
        assert (await get_active_rule(session, co.id)).id == specific.id
