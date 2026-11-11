"""Release 2 (movement redesign, 2026-11-11): the OWNER company and cost centre of an asset never change on a move and
can be corrected only by the platform owner or a Full Admin, with a reason, until the asset is sold, scrapped or
disposed. The database trigger refuses every other change of them (and of the asset code, always)."""
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.assets.models import Asset, AssetFieldChange
from app.core.db import SessionLocal
from app.masters.models import CostCenter
from tests.assets.test_s5_register import batch
from tests.purchase_orders.s4_world import build_s4_world, login, serials

REASON = "Wrong company chosen while inwarding"


async def _asset(client, h, w, tag="OC", item="camera"):
    made = await batch(client, h, w, item, 1, **({"serial_numbers": serials(tag, 1)} if item == "camera" else {}))
    return made[0]


async def _correct(client, h, asset_id, w, **over):
    body = {"company_id": w["co_b"], "cost_center_id": w["cc_b"], "reason": REASON, **over}
    return await client.post(f"/api/assets/{asset_id}/owner-correction", headers=h, json=body)


async def test_a_full_admin_corrects_the_owner_company_and_cost_centre_and_it_is_in_the_history(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a = await _asset(client, h, w)
    resp = await _correct(client, h, a["asset_id"], w)
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert (out["company_id"], out["cost_center_id"]) == (w["co_b"], w["cc_b"])
    assert out["asset_code"] == a["asset_code"]                                    # the code never changes
    assert out["status"] == "IN_STOCK" and out["current_asset_user_id"] == w["stock"]      # holder and status untouched
    async with SessionLocal() as s:
        rows = (await s.execute(select(AssetFieldChange).where(AssetFieldChange.asset_id == a["asset_id"])
                                .order_by(AssetFieldChange.id))).scalars().all()
    fields = {r.field_name: r for r in rows if r.reason}
    assert set(fields) == {"company_id", "cost_center_id"}
    assert fields["company_id"].old_value == "S0A · S0 Company A" and fields["company_id"].new_value == "S0B · S0 Company B"
    assert fields["cost_center_id"].new_value == "HO · Head Office B"
    assert {r.reason for r in fields.values()} == {REASON} and len({r.request_id for r in fields.values()}) == 1
    assert all(r.actor_id == w["admin"] for r in fields.values())
    changes = (await client.get(f"/api/assets/{a['asset_id']}/changes", headers=h)).json()
    assert {c["field_name"] for c in changes if c.get("reason")} == {"company_id", "cost_center_id"}


async def test_the_platform_owner_may_too(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    a = await _asset(client, h, w, "OD")
    assert (await _correct(client, h, a["asset_id"], w)).status_code == 200


@pytest.mark.parametrize("who", ["op_both", "viewer_it"])
async def test_nobody_else_may(client, who):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    a = await _asset(client, admin, w, "OE")
    resp = await _correct(client, await login(client, w, who), a["asset_id"], w)
    assert resp.status_code == 403, resp.text
    async with SessionLocal() as s:
        assert (await s.get(Asset, a["asset_id"])).company_id == w["co"]


async def test_an_admin_limited_to_one_work_area_reaches_only_assets_of_that_area(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    chair = (await batch(client, admin, w, "chair", 1))[0]                         # a Non-IT asset
    resp = await _correct(client, await login(client, w, "admin_it"), chair["asset_id"], w)
    assert resp.status_code == 404                                                  # hidden, like every asset route


async def test_a_reason_is_required_and_the_values_must_make_sense(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a = await _asset(client, h, w, "OF")
    async def refused(**over):
        resp = await _correct(client, h, a["asset_id"], w, **over)
        assert resp.status_code == 422, resp.text
        return resp.json()["detail"]
    assert "reason is required" in await refused(reason="   ")
    assert await refused(cost_center_id=w["cc"]) == "The cost centre must belong to the company you chose."    # cc of company A
    assert "no changes requested" in await refused(company_id=w["co"], cost_center_id=w["cc"])               # already so
    assert await refused(company_id=999999) == "The company you chose does not exist or is no longer active."
    assert await refused(cost_center_id=w["dead_cc"], company_id=w["co"]) == "The cost centre you chose does not exist or is no longer active."
    async with SessionLocal() as s:
        row = await s.get(Asset, a["asset_id"])
        assert (row.company_id, row.cost_center_id) == (w["co"], w["cc"])         # nothing changed
        assert not (await s.execute(select(AssetFieldChange).where(AssetFieldChange.reason.is_not(None)))).scalars().all()


async def test_the_cost_centre_alone_can_be_corrected_inside_the_same_company(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a = await _asset(client, h, w, "OG")
    async with SessionLocal() as s:
        other = CostCenter(company_id=w["co"], code="WH", name="Warehouse")
        s.add(other)
        await s.commit()
        other_id = other.id
    resp = await _correct(client, h, a["asset_id"], w, company_id=w["co"], cost_center_id=other_id)
    assert resp.status_code == 200, resp.text
    assert (resp.json()["company_id"], resp.json()["cost_center_id"]) == (w["co"], other_id)
    async with SessionLocal() as s:
        rows = (await s.execute(select(AssetFieldChange.field_name).where(AssetFieldChange.reason == REASON))).scalars().all()
    assert rows == ["cost_center_id"]                                              # only what really changed


@pytest.mark.parametrize("event, word", [("SOLD", "sold"), ("SCRAPPED", "scrapped"), ("DISPOSED", "disposed of")])
async def test_it_cannot_be_corrected_once_the_asset_has_left_the_register(client, event, word):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a = await _asset(client, h, w, "OH" + event[:1])
    done = await client.post(f"/api/assets/{a['asset_id']}/events", headers=h, json={"event_type": event})
    assert done.status_code in (200, 201), done.text
    resp = await _correct(client, h, a["asset_id"], w)
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"This asset has been {word}, so its owner company and cost centre can no longer be corrected."


async def test_a_moved_asset_can_be_corrected_while_in_use(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a = await _asset(client, h, w, "OI")
    await client.post(f"/api/assets/{a['asset_id']}/events", headers=h, json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    resp = await _correct(client, h, a["asset_id"], w)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ALLOTTED" and resp.json()["current_asset_user_id"] == w["employee"]


# ---- the database trigger: the marker is the only door, and the asset code has none -----------------------------------

async def test_a_direct_write_of_the_owner_fields_is_refused_by_the_database(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a = await _asset(client, h, w, "OJ")
    async with SessionLocal() as s:
        row = await s.get(Asset, a["asset_id"])
        row.company_id = w["co_b"]
        with pytest.raises(DBAPIError, match="company_id can only change through the owner correction"):
            await s.commit()
    async with SessionLocal() as s:
        row = await s.get(Asset, a["asset_id"])
        row.cost_center_id = w["cc_b"]
        with pytest.raises(DBAPIError, match="cost_center_id can only change through the owner correction"):
            await s.commit()


async def test_the_asset_code_can_never_change_not_even_with_the_marker(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a = await _asset(client, h, w, "OK")
    async with SessionLocal() as s:
        await s.execute(text("SELECT set_config('ckam.owner_correction', 'on', true)"))
        row = await s.get(Asset, a["asset_id"])
        row.asset_code = "HACKED"
        with pytest.raises(DBAPIError, match="asset_code is immutable once set"):
            await s.commit()


async def test_the_marker_does_not_leak_to_the_next_transaction(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    a = await _asset(client, h, w, "OL")
    assert (await _correct(client, h, a["asset_id"], w)).status_code == 200
    async with SessionLocal() as s:                                               # a fresh transaction: marker is off again
        assert (await s.execute(text("SELECT coalesce(current_setting('ckam.owner_correction', true), '')"))).scalar_one() in ("", "off")
        row = await s.get(Asset, a["asset_id"])
        row.company_id = w["co"]
        with pytest.raises(DBAPIError, match="company_id can only change through the owner correction"):
            await s.commit()
