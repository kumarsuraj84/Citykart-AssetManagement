"""S0.4 (audit B-5): events without a destination never change the holder;
a correction note never changes the holder or status_since; status_since only
moves on a real change; a missing destination gets a plain sentence."""
from datetime import date

from sqlalchemy import func, select

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.lifecycle.models import AssetEvent
from tests.core.s0_world import build_world, login, make_asset


async def _asset_row(asset_id):
    async with SessionLocal() as s:
        return await s.get(Asset, asset_id)


async def _event_count(asset_id):
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(AssetEvent).where(AssetEvent.asset_id == asset_id))).scalar_one()


async def test_events_without_a_destination_refuse_one(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    for event_type in ("SENT_FOR_REPAIR", "LOST", "DISPOSED", "SOLD", "SCRAPPED", "CORRECTION"):
        resp = await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                                 json={"event_type": event_type, "to_asset_user_id": w["employee"]})
        assert resp.status_code == 422, (event_type, resp.text)
        assert resp.json()["detail"] == "This action does not send the asset anywhere, so do not choose a destination."
    row = await _asset_row(asset["id"])
    assert row.current_asset_user_id == w["stock"] and row.status == "IN_STOCK"
    assert await _event_count(asset["id"]) == 1
    # the bulk path refuses it per asset as well
    bulk = await client.post("/api/assets/bulk-action", headers=h, json={
        "asset_ids": [asset["id"]], "event_type": "LOST", "to_asset_user_id": w["employee"]})
    assert bulk.json()["done"] == 0 and "do not choose a destination" in bulk.json()["failed"][0]["reason"]


async def test_a_correction_note_keeps_holder_status_and_status_since(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    disposed = await client.post(f"/api/assets/{asset['id']}/events", headers=h, json={"event_type": "DISPOSED"})
    assert disposed.status_code == 201
    before = await _asset_row(asset["id"])
    note = await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                             json={"event_type": "CORRECTION", "remarks": "disposal paperwork found"})
    assert note.status_code == 201, note.text
    after = await _asset_row(asset["id"])
    assert (after.status, after.current_asset_user_id, after.status_since) == (
        before.status, before.current_asset_user_id, before.status_since)


async def test_status_since_moves_only_on_a_real_change(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)                       # purchase date 2026-02-01, in stock
    assert (await _asset_row(asset["id"])).status_since == date(2026, 2, 1)
    note = await client.post(f"/api/assets/{asset['id']}/events", headers=h, json={"event_type": "CORRECTION", "remarks": "x"})
    assert note.status_code == 201
    assert (await _asset_row(asset["id"])).status_since == date(2026, 2, 1)
    moved = await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                              json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    assert moved.status_code == 201
    assert (await _asset_row(asset["id"])).status_since == date.today()


async def test_a_missing_destination_gets_a_plain_sentence(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    resp = await client.post(f"/api/assets/{asset['id']}/events", headers=h, json={"event_type": "MOVED"})
    assert resp.status_code == 422 and resp.json()["detail"] == "Choose where the asset is going."
    repair = await client.post(f"/api/assets/{asset['id']}/events", headers=h, json={"event_type": "SENT_FOR_REPAIR"})
    assert repair.status_code == 201
    back = await client.post(f"/api/assets/{asset['id']}/events", headers=h, json={"event_type": "RECEIVED_FROM_REPAIR"})
    assert back.status_code == 422 and back.json()["detail"] == "Choose where the asset is going."
    lost_asset = await make_asset(client, h, w, serial_number="LOST-1")
    assert (await client.post(f"/api/assets/{lost_asset['id']}/events", headers=h, json={"event_type": "LOST"})).status_code == 201
    found = await client.post(f"/api/assets/{lost_asset['id']}/events", headers=h, json={"event_type": "FOUND"})
    assert found.status_code == 422 and found.json()["detail"] == "Choose where the asset is going."


async def test_illegal_moves_are_explained_in_plain_words(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    await client.post(f"/api/assets/{asset['id']}/events", headers=h, json={"event_type": "LOST"})
    resp = await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                             json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    assert resp.status_code == 422 and resp.json()["detail"] == "This asset is reported lost, so it cannot be moved."
    inactive = await make_asset(client, h, w, serial_number="X-2")
    gone = await client.post(f"/api/assets/{inactive['id']}/events", headers=h,
                             json={"event_type": "MOVED", "to_asset_user_id": w["dead_stock"]})
    assert gone.status_code == 422 and gone.json()["detail"] == "Closed Stock is no longer active, so assets cannot be sent there."


async def test_todays_date_is_not_refused_as_before_the_last_event(client):
    """B-13: a date picked without a time (midnight today) used to be refused
    when the asset already had an event earlier today."""
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    assert (await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                              json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})).status_code == 201
    again = await client.post(f"/api/assets/{asset['id']}/events", headers=h, json={
        "event_type": "MOVED", "to_asset_user_id": w["stock"], "event_date": f"{date.today().isoformat()}T00:00:00Z"})
    assert again.status_code == 201, again.text
    events = (await client.get(f"/api/assets/{asset['id']}/events", headers=h)).json()
    assert [e["event_type"] for e in events][-2:] == ["MOVED", "MOVED"] and events[-1]["status_after"] == "IN_STOCK"
