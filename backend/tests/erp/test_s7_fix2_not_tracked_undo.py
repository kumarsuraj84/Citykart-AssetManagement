"""S7 fix round 2 (N1b): "Not tracked" in the PO review answers the id of the rule it saved (additive `map_id`)
and whether this person may undo it (`can_undo`: the head-office admin only, like DELETE /api/items/maps/{id}),
so the review can offer Undo right where the decision was made."""
from sqlalchemy import select

from app.core.db import SessionLocal
from app.items.models import ItemMap
from tests.erp.s3a2_world import build_s3a2_world
from tests.erp.test_erp_api import _headers, erp  # noqa: F401  (erp is a fixture)
from tests.erp.test_s3a2_not_tracked import BS, mark, mixed


async def _rule(map_id):
    async with SessionLocal() as s:
        return (await s.execute(select(ItemMap).where(ItemMap.id == map_id))).scalar_one()


async def test_the_head_office_admin_gets_the_rule_id_and_can_undo_it_at_once(client, erp):
    await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    resp = await mark(client, "OWN", "CT500002", "CODE")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["map_id"], int) and body["can_undo"] is True
    rule = await _rule(body["map_id"])
    assert (rule.match_type, rule.erp_item_code, rule.not_tracked, rule.is_active) == ("CODE", "CT500002", True, True)
    # the lines are still answered as before
    assert {ln["item_code"]: ln["resolution"]["state"] for ln in body["lines"]}["CT500002"] == "NOT_TRACKED"
    undo = await client.delete(f"/api/items/maps/{body['map_id']}", headers=await _headers(client, "OWN"))
    assert undo.status_code == 204
    draft = (await client.get(f"/api/erp/pos/{BS}/draft", headers=await _headers(client, "OWN"))).json()
    assert "CT500002" in [ln["item_code"] for ln in draft["lines"]] and draft["untracked_lines"] == []


async def test_an_operator_gets_the_rule_id_but_cannot_undo(client, erp):
    await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    body = (await mark(client, "OPR", "CT500001", "NAME")).json()
    assert isinstance(body["map_id"], int) and body["can_undo"] is False
    assert (await client.delete(f"/api/items/maps/{body['map_id']}", headers=await _headers(client, "OPR"))).status_code == 403
    assert (await _rule(body["map_id"])).is_active is True


async def test_marking_what_is_already_not_tracked_saves_nothing_and_offers_no_undo(client, erp):
    await build_s3a2_world(erp)
    erp.pos[BS] = mixed()
    first = (await mark(client, "OWN", "CT500001", "CODE")).json()
    again = (await mark(client, "OWN", "CT500001", "ARTICLE")).json()
    assert isinstance(first["map_id"], int)
    assert (again["map_id"], again["can_undo"]) == (None, False)
