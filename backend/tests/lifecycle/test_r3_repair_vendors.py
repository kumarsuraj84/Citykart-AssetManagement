"""Release 3 (movement redesign, 2026-11-11): a repair vendor is a PLACE that holds the assets sent to it.

Send for Repair names the vendor; the asset shows as "With <vendor> (repair)"; CKAM counts what each vendor holds and for
how long; Receive from Repair puts each asset back where it came from, or one place for all of them."""
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.lifecycle.models import AssetEvent
from app.masters.models import Vendor
from tests.assets.test_s5_register import batch
from tests.purchase_orders.s4_world import build_s4_world, login, serials


async def bulk(client, h, ids, event, **extra):
    resp = await client.post("/api/assets/bulk-action", headers=h, json={"asset_ids": ids, "event_type": event, **extra})
    return resp


async def _row(asset_id: int) -> Asset:
    async with SessionLocal() as s:
        return await s.get(Asset, asset_id)


async def _place(place_id: int) -> AssetUser:
    async with SessionLocal() as s:
        return await s.get(AssetUser, place_id)


async def _events(asset_id: int) -> list[AssetEvent]:
    async with SessionLocal() as s:
        return list((await s.execute(select(AssetEvent).where(AssetEvent.asset_id == asset_id).order_by(AssetEvent.id))).scalars())


async def _second_vendor() -> int:
    async with SessionLocal() as s:
        v = Vendor(code="S0V2", name="Second Repairs")
        s.add(v)
        await s.commit()
        return v.id


async def _three_assets(client, h, w):
    """One in stock, one with Ravi (employee), one with Sita (employee2)."""
    made = await batch(client, h, w, "camera", 3, serial_numbers=serials("RP", 3))
    ids = [m["asset_id"] for m in made]
    for asset_id, to in ((ids[1], w["employee"]), (ids[2], w["employee2"])):
        r = await client.post(f"/api/assets/{asset_id}/events", headers=h, json={"event_type": "MOVED", "to_asset_user_id": to})
        assert r.status_code in (200, 201), r.text
    return ids


# ---- sending ---------------------------------------------------------------------------------------------------------

async def test_assets_sent_for_repair_are_held_by_the_vendors_place_and_remember_where_they_came_from(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, ravi_id, sita_id = await _three_assets(client, h, w)
    resp = await bulk(client, h, [stock_id, ravi_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"], reference_no="JOB-7")
    assert resp.status_code == 200 and resp.json() == {"done": 2, "failed": []}, resp.text
    a, b = await _row(stock_id), await _row(ravi_id)
    assert (a.status, b.status) == ("UNDER_REPAIR", "UNDER_REPAIR")
    assert a.current_asset_user_id == b.current_asset_user_id                       # one place for the vendor
    place = await _place(a.current_asset_user_id)
    assert (place.asset_user_type, place.vendor_id, place.company_id, place.location_id) == ("REPAIR_VENDOR", w["vendor"], w["co"], None)
    assert place.name == "Good Vendor (repair)" and place.code.startswith("RPR-") and place.login_enabled is False
    e_stock, e_ravi = (await _events(stock_id))[-1], (await _events(ravi_id))[-1]
    assert (e_stock.event_type, e_stock.from_asset_user_id, e_stock.to_asset_user_id) == ("SENT_FOR_REPAIR", w["stock"], place.id)
    assert (e_ravi.from_asset_user_id, e_ravi.to_asset_user_id, e_ravi.reference_no) == (w["employee"], place.id, "JOB-7")
    assert e_ravi.to_asset_user_name_snapshot == "Good Vendor (repair)" and e_ravi.status_after == "UNDER_REPAIR"
    # a second vendor gets its own place; a third asset to the first vendor reuses the first place
    other = await _second_vendor()
    r2 = await bulk(client, h, [sita_id], "SENT_FOR_REPAIR", repair_vendor_id=other)
    assert r2.json()["done"] == 1
    assert (await _row(sita_id)).current_asset_user_id != place.id
    async with SessionLocal() as s:
        places = (await s.execute(select(AssetUser).where(AssetUser.asset_user_type == "REPAIR_VENDOR"))).scalars().all()
    assert sorted(p.name for p in places) == ["Good Vendor (repair)", "Second Repairs (repair)"]


async def test_the_history_and_asset_360_say_who_has_it(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, _, _ = await _three_assets(client, h, w)
    await bulk(client, h, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    detail = (await client.get(f"/api/assets/{stock_id}", headers=h)).json()
    assert (detail["status"], detail["holder_type"], detail["holder_kind_label"], detail["holder_name"]) == (
        "UNDER_REPAIR", "REPAIR_VENDOR", "Repair vendor", "Good Vendor (repair)")
    labels = [e["label"] for e in (await client.get(f"/api/assets/{stock_id}/events", headers=h)).json()]
    assert labels[-1] == "Sent for repair to Good Vendor (repair)"


async def test_a_repair_place_is_never_listed_as_a_person_or_place_to_pick(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, _, _ = await _three_assets(client, h, w)
    await bulk(client, h, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    names = [u["name"] for u in (await client.get("/api/asset-users", headers=h)).json()]
    assert "Good Vendor (repair)" not in names and "Main Stock" in names
    for kind in ("employees", "stores", "stock-rooms", "install-points"):
        listed = (await client.get("/api/people", headers=h, params={"kind": kind})).json()
        assert all("(repair)" not in p["name"] for p in listed)


async def test_sending_without_a_vendor_still_works_as_before_and_is_counted_as_no_vendor_recorded(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, ravi_id, _ = await _three_assets(client, h, w)
    resp = await bulk(client, h, [ravi_id], "SENT_FOR_REPAIR")
    assert resp.json()["done"] == 1
    a = await _row(ravi_id)
    assert (a.status, a.current_asset_user_id) == ("UNDER_REPAIR", w["employee"])            # the old behaviour: still Ravi's record
    summary = (await client.get("/api/repairs", headers=h)).json()
    assert summary["vendors"] == [] and summary["without_vendor"]["assets"] == 1


@pytest.mark.parametrize("extra, event, message", [
    ({"repair_vendor_id": 1}, "MOVED", "A repair vendor is only chosen when sending an asset for repair."),
    ({"repair_vendor_id": 999999}, "SENT_FOR_REPAIR", "The repair vendor you chose does not exist."),
    ({"back_to_origin": True}, "MOVED", "Putting an asset back where it came from is only for receiving it back from repair."),
])
async def test_the_repair_options_are_checked_up_front(client, extra, event, message):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, _, _ = await _three_assets(client, h, w)
    resp = await bulk(client, h, [stock_id], event, **extra)
    assert resp.status_code == 422 and resp.json()["detail"] == message
    assert (await _row(stock_id)).status == "IN_STOCK"


async def test_both_a_vendor_and_a_destination_is_refused_and_so_is_both_a_place_and_back_to_origin(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, ravi_id, _ = await _three_assets(client, h, w)
    bad = await bulk(client, h, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"], to_asset_user_id=w["employee"])
    assert bad.status_code == 422 and bad.json()["detail"] == "Choose the repair vendor, not another destination."
    await bulk(client, h, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    both = await bulk(client, h, [stock_id], "RECEIVED_FROM_REPAIR", back_to_origin=True, to_asset_user_id=w["stock"])
    assert both.status_code == 422 and "not both" in both.json()["detail"]


async def test_an_inactive_vendor_is_refused_for_that_asset_with_a_sentence(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, _, _ = await _three_assets(client, h, w)
    resp = await bulk(client, h, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["dead_vendor"])
    assert resp.status_code == 200 and resp.json()["done"] == 0
    assert resp.json()["failed"][0]["reason"] == "The vendor Closed Vendor is no longer active; choose another."
    assert (await _row(stock_id)).status == "IN_STOCK"


async def test_only_send_for_repair_goes_to_a_repair_place_and_it_goes_nowhere_else(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, ravi_id, _ = await _three_assets(client, h, w)
    await bulk(client, h, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    place_id = (await _row(stock_id)).current_asset_user_id
    # a move to the repair place is refused
    r = await bulk(client, h, [ravi_id], "MOVED", to_asset_user_id=place_id)
    assert r.json()["done"] == 0 and r.json()["failed"][0]["reason"] == "A repair vendor is only chosen when sending an asset for repair."
    # a repair sent to an ordinary place is refused
    r = await bulk(client, h, [ravi_id], "SENT_FOR_REPAIR", to_asset_user_id=w["stock2"])
    assert r.json()["done"] == 0 and r.json()["failed"][0]["reason"] == "Choose the repair vendor the asset is sent to."
    assert (await _row(ravi_id)).status == "ALLOTTED"


# ---- the repairs summary ---------------------------------------------------------------------------------------------

async def test_what_each_vendor_holds_and_for_how_long(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, ravi_id, sita_id = await _three_assets(client, h, w)
    other = await _second_vendor()
    await bulk(client, h, [stock_id, ravi_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    await bulk(client, h, [sita_id], "SENT_FOR_REPAIR", repair_vendor_id=other)
    summary = (await client.get("/api/repairs", headers=h)).json()
    by_name = {v["vendor_name"]: v for v in summary["vendors"]}
    assert by_name["Good Vendor"]["assets"] == 2 and by_name["Second Repairs"]["assets"] == 1
    assert by_name["Good Vendor"]["vendor_id"] == w["vendor"] and by_name["Good Vendor"]["oldest_days"] == 0
    assert summary["without_vendor"] == {"assets": 0, "oldest_days": None}
    rows = (await client.get(f"/api/repairs/vendors/{w['vendor']}/assets", headers=h)).json()
    assert sorted(r["asset_id"] for r in rows) == sorted([stock_id, ravi_id])
    by_asset = {r["asset_id"]: r for r in rows}
    assert by_asset[stock_id]["origin_name"] == "Main Stock" and by_asset[stock_id]["origin_active"] is True
    assert by_asset[ravi_id]["origin_name"] == "Ravi Kumar" and by_asset[ravi_id]["origin_asset_user_id"] == w["employee"]
    assert by_asset[ravi_id]["days"] == 0 and by_asset[ravi_id]["asset_code"]


async def test_the_repairs_screens_data_is_scoped_and_for_staff_only(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    stock_id, _, _ = await _three_assets(client, admin, w)
    await bulk(client, admin, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    nonit = await login(client, w, "op_nonit")                                         # the camera is IT
    assert (await client.get("/api/repairs", headers=nonit)).json()["vendors"] == []
    assert (await client.get(f"/api/repairs/vendors/{w['vendor']}/assets", headers=nonit)).json() == []
    assert (await client.get("/api/repairs", headers=await login(client, w, "viewer_it"))).status_code == 403
    assert (await client.get("/api/repairs/vendors/999999/assets", headers=admin)).status_code == 404


# ---- receiving back ---------------------------------------------------------------------------------------------------

async def test_received_back_into_one_place_for_all(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, ravi_id, _ = await _three_assets(client, h, w)
    await bulk(client, h, [stock_id, ravi_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    place_id = (await _row(stock_id)).current_asset_user_id
    resp = await bulk(client, h, [stock_id, ravi_id], "RECEIVED_FROM_REPAIR", to_asset_user_id=w["stock2"])
    assert resp.json() == {"done": 2, "failed": []}, resp.text
    for asset_id in (stock_id, ravi_id):
        a = await _row(asset_id)
        assert (a.status, a.current_asset_user_id) == ("IN_STOCK", w["stock2"])
    last = (await _events(stock_id))[-1]
    assert (last.from_asset_user_id, last.to_asset_user_id) == (place_id, w["stock2"])
    labels = [e["label"] for e in (await client.get(f"/api/assets/{stock_id}/events", headers=h)).json()]
    assert labels[-1] == "Received back from Good Vendor (repair) into Second Stock"
    assert (await client.get("/api/repairs", headers=h)).json()["vendors"] == []                  # nothing is away any more


async def test_received_back_where_each_came_from(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, ravi_id, sita_id = await _three_assets(client, h, w)
    await bulk(client, h, [stock_id, ravi_id, sita_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    resp = await bulk(client, h, [stock_id, ravi_id, sita_id], "RECEIVED_FROM_REPAIR", back_to_origin=True)
    assert resp.json() == {"done": 3, "failed": []}, resp.text
    got = {asset_id: await _row(asset_id) for asset_id in (stock_id, ravi_id, sita_id)}
    assert (got[stock_id].status, got[stock_id].current_asset_user_id) == ("IN_STOCK", w["stock"])
    assert (got[ravi_id].status, got[ravi_id].current_asset_user_id) == ("ALLOTTED", w["employee"])
    assert (got[sita_id].status, got[sita_id].current_asset_user_id) == ("ALLOTTED", w["employee2"])


async def test_back_where_it_came_from_when_that_place_is_gone_fails_for_that_asset_and_says_why(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, ravi_id, _ = await _three_assets(client, h, w)
    await bulk(client, h, [stock_id, ravi_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    async with SessionLocal() as s:                                                    # Ravi left: his record is closed
        (await s.get(AssetUser, w["employee"])).is_active = False
        await s.commit()
    resp = await bulk(client, h, [stock_id, ravi_id], "RECEIVED_FROM_REPAIR", back_to_origin=True)
    assert resp.json()["done"] == 1
    assert resp.json()["failed"] == [{"asset_id": ravi_id, "reason": "Ravi Kumar is no longer active, so assets cannot be sent there."}]
    assert (await _row(stock_id)).status == "IN_STOCK" and (await _row(ravi_id)).status == "UNDER_REPAIR"
    # ...and the same asset can then be received into another place
    again = await bulk(client, h, [ravi_id], "RECEIVED_FROM_REPAIR", to_asset_user_id=w["stock"])
    assert again.json()["done"] == 1 and (await _row(ravi_id)).current_asset_user_id == w["stock"]


async def test_an_old_repair_with_no_vendor_comes_back_to_the_holder_it_had(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    _, ravi_id, _ = await _three_assets(client, h, w)
    await bulk(client, h, [ravi_id], "SENT_FOR_REPAIR")                                 # no vendor recorded (the old way)
    resp = await bulk(client, h, [ravi_id], "RECEIVED_FROM_REPAIR", back_to_origin=True)
    assert resp.json()["done"] == 1
    a = await _row(ravi_id)
    assert (a.status, a.current_asset_user_id) == ("ALLOTTED", w["employee"])


async def test_receiving_back_across_companies_needs_access_to_the_other_company(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    stock_id, _, _ = await _three_assets(client, admin, w)
    await bulk(client, admin, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    op = await login(client, w, "op_both")                                             # works in company A only
    refused = await bulk(client, op, [stock_id], "RECEIVED_FROM_REPAIR", to_asset_user_id=w["stock_b"])
    assert refused.json()["done"] == 0 and "company you do not work in" in refused.json()["failed"][0]["reason"]
    ok = await bulk(client, admin, [stock_id], "RECEIVED_FROM_REPAIR", to_asset_user_id=w["stock_b"])
    assert ok.json()["done"] == 1
    a = await _row(stock_id)
    assert (a.company_id, a.current_asset_user_id) == (w["co"], w["stock_b"])           # still owned by A, now held in B


async def test_an_asset_under_repair_can_still_be_scrapped_from_the_vendor(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    stock_id, _, _ = await _three_assets(client, h, w)
    await bulk(client, h, [stock_id], "SENT_FOR_REPAIR", repair_vendor_id=w["vendor"])
    resp = await bulk(client, h, [stock_id], "SCRAPPED")
    assert resp.json()["done"] == 1 and (await _row(stock_id)).status == "SCRAPPED"
    assert (await client.get("/api/repairs", headers=h)).json()["vendors"] == []


async def test_a_repair_place_cannot_be_made_by_hand_through_the_people_and_places_api(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    resp = await client.post("/api/asset-users", headers=h, json={
        "company_id": w["co"], "code": "RPR-HAND", "name": "Made by hand (repair)", "asset_user_type": "REPAIR_VENDOR",
        "role": "SELF_SERVICE", "location_id": w["loc"],
    })
    assert resp.status_code == 422 and resp.json()["detail"].startswith("Choose a type")


# ---- the database -----------------------------------------------------------------------------------------------------

async def test_a_repair_place_needs_no_location_but_every_other_place_still_does(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        s.add(AssetUser(company_id=w["co"], code="RPR-A", name="A (repair)", asset_user_type="REPAIR_VENDOR",
                        vendor_id=w["vendor"], role="SELF_SERVICE"))
        await s.commit()                                                                # no location: allowed
    async with SessionLocal() as s:
        s.add(AssetUser(company_id=w["co"], code="NOLOC", name="No place", asset_user_type="STOCK_POINT", role="SELF_SERVICE"))
        with pytest.raises(IntegrityError):
            await s.commit()
    async with SessionLocal() as s:                                                     # one repair place per vendor per company
        s.add(AssetUser(company_id=w["co"], code="RPR-B", name="A again", asset_user_type="REPAIR_VENDOR",
                        vendor_id=w["vendor"], role="SELF_SERVICE"))
        with pytest.raises(IntegrityError):
            await s.commit()
