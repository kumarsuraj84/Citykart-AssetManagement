"""Release 2 (movement redesign, 2026-11-11): an asset may be moved to a place of ANOTHER company by someone who works
in both companies. It stays owned by its purchase company (company and cost centre never change on a move)."""
from sqlalchemy import select

from app.asset_users.models import AssetUser, AssetUserCompanyAccess
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.lifecycle.models import AssetEvent
from tests.assets.test_s5_register import batch
from tests.purchase_orders.s4_world import build_s4_world, login, serials


async def _row(asset_id: int) -> Asset:
    async with SessionLocal() as s:
        return await s.get(Asset, asset_id)


async def _event(asset_id: int, event_type: str) -> AssetEvent:
    async with SessionLocal() as s:
        return (await s.execute(
            select(AssetEvent).where(AssetEvent.asset_id == asset_id, AssetEvent.event_type == event_type)
            .order_by(AssetEvent.id.desc()).limit(1)
        )).scalar_one()


async def _grant_b(w: dict, who: str) -> None:
    async with SessionLocal() as s:
        s.add(AssetUserCompanyAccess(asset_user_id=w[who], company_id=w["co_b"]))
        await s.commit()


async def test_an_admin_moves_an_asset_to_another_companys_place_and_it_stays_owned_by_its_company(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = await batch(client, h, w, "camera", 1, serial_numbers=serials("XC", 1))
    asset_id = made[0]["asset_id"]
    resp = await client.post(f"/api/assets/{asset_id}/events", headers=h, json={"event_type": "MOVED", "to_asset_user_id": w["stock_b"]})
    assert resp.status_code in (200, 201), resp.text
    a = await _row(asset_id)
    assert (a.company_id, a.cost_center_id) == (w["co"], w["cc"])                  # owned by company A, cost centre unchanged
    assert (a.current_asset_user_id, a.status) == (w["stock_b"], "IN_STOCK")        # held by a place of company B
    e = await _event(asset_id, "MOVED")
    assert (e.from_asset_user_id, e.to_asset_user_id) == (w["stock"], w["stock_b"])


async def test_an_employee_of_the_other_company_can_be_given_the_asset(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = await batch(client, h, w, "camera", 1, serial_numbers=serials("XD", 1))
    async with SessionLocal() as s:
        ravi_b = AssetUser(company_id=w["co_b"], code="S0EMPB", name="Meena B", asset_user_type="EMPLOYEE",
                           location_id=(await s.get(AssetUser, w["stock_b"])).location_id, department_id=w["dept"], role="SELF_SERVICE")
        s.add(ravi_b)
        await s.commit()
        ravi_b_id = ravi_b.id
    resp = await client.post("/api/assets/bulk-action", headers=h,
                             json={"asset_ids": [made[0]["asset_id"]], "event_type": "MOVED", "to_asset_user_id": ravi_b_id})
    assert resp.status_code == 200 and resp.json()["done"] == 1 and resp.json()["failed"] == [], resp.text
    a = await _row(made[0]["asset_id"])
    assert (a.company_id, a.status, a.current_asset_user_id) == (w["co"], "ALLOTTED", ravi_b_id)


async def test_a_person_who_works_only_in_company_a_cannot_send_it_to_company_b(client):
    w = await build_s4_world()
    h = await login(client, w, "op_both")
    made = await batch(client, h, w, "camera", 1, serial_numbers=serials("XE", 1))
    resp = await client.post("/api/assets/bulk-action", headers=h,
                             json={"asset_ids": [made[0]["asset_id"]], "event_type": "MOVED", "to_asset_user_id": w["stock_b"]})
    assert resp.status_code == 200 and resp.json()["done"] == 0
    assert resp.json()["failed"][0]["reason"] == "B Stock belongs to a company you do not work in, so assets cannot be sent there."
    assert (await _row(made[0]["asset_id"])).current_asset_user_id == w["stock"]                    # nothing moved


async def test_a_person_given_access_to_both_companies_can(client):
    w = await build_s4_world()
    await _grant_b(w, "op_both")
    h = await login(client, w, "op_both")
    made = await batch(client, h, w, "camera", 1, serial_numbers=serials("XF", 1))
    resp = await client.post("/api/assets/bulk-action", headers=h,
                             json={"asset_ids": [made[0]["asset_id"]], "event_type": "MOVED", "to_asset_user_id": w["stock_b"]})
    assert resp.status_code == 200 and resp.json()["done"] == 1, resp.text
    assert (await _row(made[0]["asset_id"])).current_asset_user_id == w["stock_b"]


async def test_a_moved_asset_can_travel_back_and_on_and_the_owner_never_changes(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = await batch(client, h, w, "camera", 1, serial_numbers=serials("XG", 1))
    asset_id = made[0]["asset_id"]
    for to in (w["stock_b"], w["employee"], w["stock_b"], w["stock"]):
        resp = await client.post(f"/api/assets/{asset_id}/events", headers=h, json={"event_type": "MOVED", "to_asset_user_id": to})
        assert resp.status_code in (200, 201), resp.text
    a = await _row(asset_id)
    assert (a.company_id, a.cost_center_id, a.current_asset_user_id) == (w["co"], w["cc"], w["stock"])


async def test_receiving_into_a_place_of_the_other_company_is_allowed_for_someone_who_works_in_both(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    resp = await client.post("/api/assets/batch", headers=h, json={
        "item_id": w["item_camera"], "quantity": 1, "received_into_asset_user_id": w["stock_b"], "cost_center_id": w["cc"],
        "serial_numbers": serials("XH", 1)})
    assert resp.status_code == 201, resp.text
    a = await _row(resp.json()["assets"][0]["asset_id"])
    assert (a.company_id, a.cost_center_id, a.current_asset_user_id) == (w["co"], w["cc"], w["stock_b"])


async def test_receiving_into_the_other_companys_place_is_refused_for_someone_who_does_not_work_there(client):
    w = await build_s4_world()
    h = await login(client, w, "op_both")
    resp = await client.post("/api/assets/batch", headers=h, json={
        "item_id": w["item_camera"], "quantity": 1, "received_into_asset_user_id": w["stock_b"], "cost_center_id": w["cc"],
        "serial_numbers": serials("XI", 1)})
    assert resp.status_code in (403, 422), resp.text
    assert "company you do not work in" in resp.text


async def test_the_asset_shows_who_owns_it_and_which_company_holds_it_now(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = await batch(client, h, w, "camera", 1, serial_numbers=serials("XJ", 1))
    asset_id = made[0]["asset_id"]
    before = (await client.get(f"/api/assets/{asset_id}", headers=h)).json()
    assert (before["company_code"], before["holder_company_code"]) == ("S0A", "S0A")          # bought in A, held in A
    await client.post(f"/api/assets/{asset_id}/events", headers=h, json={"event_type": "MOVED", "to_asset_user_id": w["stock_b"]})
    after = (await client.get(f"/api/assets/{asset_id}", headers=h)).json()
    assert (after["company_id"], after["company_code"]) == (w["co"], "S0A")                   # Owned by: unchanged
    assert (after["holder_company_id"], after["holder_company_code"], after["holder_company_name"]) == (w["co_b"], "S0B", "S0 Company B")


async def test_the_register_filters_by_owner_company_and_by_the_company_it_is_in_now(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    made = await batch(client, h, w, "camera", 2, serial_numbers=serials("XK", 2))
    stays, goes = made[0], made[1]
    await client.post(f"/api/assets/{goes['asset_id']}/events", headers=h, json={"event_type": "MOVED", "to_asset_user_id": w["stock_b"]})

    async def codes(**params):
        resp = await client.get("/api/assets", headers=h, params=params)
        assert resp.status_code == 200, resp.text
        return sorted(a["asset_code"] for a in resp.json()["items"])
    both = sorted([stays["asset_code"], goes["asset_code"]])
    assert await codes(company_id=w["co"]) == both                                            # owned by A: both
    assert await codes(company_id=w["co_b"]) == []
    assert await codes(holder_company_id=w["co_b"]) == [goes["asset_code"]]                    # currently at B: the moved one
    assert await codes(holder_company_id=w["co"]) == [stays["asset_code"]]
    assert await codes(company_id=w["co"], holder_company_id=w["co_b"]) == [goes["asset_code"]]
