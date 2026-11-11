"""A company that was switched off can be switched on again (head-office admin only), and only the company changes.

Before this, switching a company off hid it from the Companies list for good, and the only way back was to create a new
company (production lost its only company that way on 2026-10-10)."""
import pytest

from tests.core.s0_world import build_world, login
from tests.observability.helpers import audit
from app.observability.models import AuditLog


async def _switch_off(client, h, company_id: int) -> None:
    resp = await client.delete(f"/api/masters/companies/{company_id}", headers=h)
    assert resp.status_code == 204, resp.text


async def test_a_switched_off_company_is_listed_and_can_be_switched_on_again_and_the_change_is_audited(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    await _switch_off(client, owner, w["co_b"])
    assert w["co_b"] not in [c["id"] for c in (await client.get("/api/masters/companies", headers=owner)).json()]
    off = (await client.get("/api/masters/companies/inactive", headers=owner)).json()
    assert [(c["id"], c["code"], c["is_active"]) for c in off] == [(w["co_b"], "S0B", False)]

    resp = await client.post(f"/api/masters/companies/{w['co_b']}/reactivate", headers=owner)
    assert resp.status_code == 200 and resp.json()["is_active"] is True and resp.json()["name"] == "S0 Company B", resp.text
    assert w["co_b"] in [c["id"] for c in (await client.get("/api/masters/companies", headers=owner)).json()]
    assert (await client.get("/api/masters/companies/inactive", headers=owner)).json() == []
    rows = await audit(AuditLog.request_id == resp.headers["x-request-id"])
    assert [(r.category, r.action, r.entity) for r in rows if r.action != "WRITE"] == [("DATA", "REACTIVATE", "company")]
    assert "made active again" in rows[0].summary


async def test_only_the_company_changes_its_places_and_cost_centres_are_left_as_they_were(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    before = (await client.get("/api/masters/cost-centers", headers=owner, params={"company_id": w["co_b"]})).json()
    await _switch_off(client, owner, w["co_b"])
    # while it is off, nothing can be added under it
    refused = await client.post("/api/masters/cost-centers", headers=owner, json={"company_id": w["co_b"], "code": "NEWCC", "name": "New"})
    assert refused.status_code == 422 and "no longer active" in refused.json()["detail"]
    await client.post(f"/api/masters/companies/{w['co_b']}/reactivate", headers=owner)
    after = (await client.get("/api/masters/cost-centers", headers=owner, params={"company_id": w["co_b"]})).json()
    assert after == before and before                                    # same cost centres, none added, none removed
    ok = await client.post("/api/masters/cost-centers", headers=owner, json={"company_id": w["co_b"], "code": "NEWCC", "name": "New"})
    assert ok.status_code == 201, ok.text                                # and it is a company people can add to again


@pytest.mark.parametrize("who", ["admin", "admin_it", "op_it", "op_both", "viewer_it"])
async def test_only_the_head_office_admin_may_list_or_switch_on(client, who):
    w = await build_world()
    owner = await login(client, w, "owner")
    await _switch_off(client, owner, w["co_b"])
    other = await login(client, w, who)
    assert (await client.get("/api/masters/companies/inactive", headers=other)).status_code == 403
    assert (await client.post(f"/api/masters/companies/{w['co_b']}/reactivate", headers=other)).status_code == 403
    assert (await client.get("/api/masters/companies/inactive", headers=owner)).json()[0]["id"] == w["co_b"]       # still off


async def test_it_needs_a_sign_in(client):
    assert (await client.get("/api/masters/companies/inactive")).status_code == 401
    assert (await client.post("/api/masters/companies/1/reactivate")).status_code == 401


async def test_unknown_and_already_on_are_refused_with_a_sentence(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    assert (await client.post("/api/masters/companies/999999/reactivate", headers=owner)).status_code == 404
    again = await client.post(f"/api/masters/companies/{w['co']}/reactivate", headers=owner)
    assert again.status_code == 422 and again.json()["detail"] == "S0 Company A is already switched on."
    assert (await client.get("/api/masters/companies/inactive", headers=owner)).json() == []


async def test_it_is_refused_when_another_company_that_is_on_has_the_same_name(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    await _switch_off(client, owner, w["co_b"])
    made = await client.post("/api/masters/companies", headers=owner, json={"code": "NEWB", "name": " s0 company b "})
    assert made.status_code == 201, made.text
    resp = await client.post(f"/api/masters/companies/{w['co_b']}/reactivate", headers=owner)
    assert resp.status_code == 422 and "is already called" in resp.json()["detail"]
    assert [c["id"] for c in (await client.get("/api/masters/companies/inactive", headers=owner)).json()] == [w["co_b"]]


async def test_it_is_refused_when_another_company_that_is_on_uses_the_same_erp_code(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    await _switch_off(client, owner, w["co_b"])                         # its ERP code is its own code, S0B
    made = await client.post("/api/masters/companies", headers=owner,
                             json={"code": "NEWB", "name": "A different name", "erp_company_code": "s0b"})
    assert made.status_code == 201, made.text
    resp = await client.post(f"/api/masters/companies/{w['co_b']}/reactivate", headers=owner)
    assert resp.status_code == 422 and "already uses the ERP company code S0B" in resp.json()["detail"]
