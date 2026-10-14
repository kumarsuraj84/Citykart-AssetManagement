"""S7 fix round 2 (N4): the asset code example follows the company it is shown for.

The re-test saw the Set up CKAM wizard's step 7 show "FA/CC01/IT/LAP/CKAM1" for every company: the example
used generic sample values for the location and cost centre whatever company was chosen. `POST
/api/code-rules/preview` and `GET /api/code-rules` now take an optional `?company_id=` and use that company's
own code, first active location and first active cost centre (the generic sample for what it does not have)."""
from app.core.db import SessionLocal
from app.masters.models import Company
from tests.core.s0_world import build_world, login

TEMPLATE = {"company_id": None, "prefix_template": "FA/{company.code}/{location.code}/{cost_center.code}/{category.code}/",
            "suffix_template": "", "start_number": 1, "pad_width": 0}


async def _preview(client, h, company_id=None, rule_company=None):
    path = "/api/code-rules/preview" + (f"?company_id={company_id}" if company_id is not None else "")
    return await client.post(path, headers=h, json={**TEMPLATE, "company_id": rule_company})


async def test_the_preview_uses_the_chosen_companys_own_values(client):
    w = await build_world()
    h = await login(client, w, "owner")
    a = await _preview(client, h, w["co"])
    b = await _preview(client, h, w["co_b"])
    assert a.status_code == 200, a.text
    assert a.json() == {"example": "FA/S0A/S0-HO/HO/IT/1"}               # the inactive cost centre OLDCC is skipped
    assert b.json() == {"example": "FA/S0B/S0B-HO/HO/IT/1"}
    # no company: the generic sample, unchanged
    assert (await _preview(client, h)).json() == {"example": "FA/CKSPL/HO/CC01/IT/1"}
    # a rule of one company shows that company's values without the query too
    assert (await _preview(client, h, rule_company=w["co_b"])).json() == {"example": "FA/S0B/S0B-HO/HO/IT/1"}
    # the query wins over the rule's own company (the wizard: a rule for every company, shown for one)
    assert (await _preview(client, h, w["co"], rule_company=w["co_b"])).json() == {"example": "FA/S0A/S0-HO/HO/IT/1"}


async def test_a_company_with_nothing_yet_gets_its_code_and_the_sample_for_the_rest(client):
    w = await build_world()
    async with SessionLocal() as s:
        new = Company(code="NEWCO", name="New Company")
        s.add(new)
        await s.commit()
        new_id = new.id
    h = await login(client, w, "owner")
    assert (await _preview(client, h, new_id)).json() == {"example": "FA/NEWCO/HO/CC01/IT/1"}


async def test_an_unknown_company_is_a_404_and_the_list_follows_the_company(client):
    w = await build_world()
    h = await login(client, w, "owner")
    missing = await _preview(client, h, 999999)
    assert missing.status_code == 404 and missing.json()["detail"] == "This company was not found."
    saved = await client.post("/api/code-rules", headers=h, json=TEMPLATE)
    assert saved.status_code == 201 and saved.json()["example"] == "FA/CKSPL/HO/CC01/IT/1"
    listed = await client.get(f"/api/code-rules?company_id={w['co_b']}", headers=h)
    assert listed.status_code == 200
    assert next(r for r in listed.json() if r["id"] == saved.json()["id"])["example"] == "FA/S0B/S0B-HO/HO/IT/1"
    assert (await client.get("/api/code-rules?company_id=999999", headers=h)).status_code == 404
    # any signed-in person may see an example (as before)
    viewer = await login(client, w, "viewer_it")
    assert (await _preview(client, viewer, w["co"])).json() == {"example": "FA/S0A/S0-HO/HO/IT/1"}
