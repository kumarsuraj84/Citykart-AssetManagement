"""S6: Move with one date and one reference for the whole batch (bulk-move / bulk-action), and
GET /api/assets?ids= for up to 1,000 assets (labels / "Open assets" after a large receipt)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.db import SessionLocal
from app.lifecycle.models import AssetEvent
from tests.core.s0_world import build_world, login, make_asset
from tests.purchase_orders.s4_world import build_s4_world


async def _events(asset_id: int) -> list[AssetEvent]:
    async with SessionLocal() as s:
        return list((await s.execute(
            select(AssetEvent).where(AssetEvent.asset_id == asset_id).order_by(AssetEvent.id))).scalars().all())


# ------------------------------------------------------------------ dates and references

async def test_bulk_move_records_the_chosen_date_and_reference_on_every_asset(client):
    w = await build_world()
    h = await login(client, w, "owner")
    a = await make_asset(client, h, w)                      # bought 01-02-2026
    b = await make_asset(client, h, w)
    resp = await client.post("/api/assets/bulk-move", headers=h, json={
        "asset_ids": [a["id"], b["id"]], "to_asset_user_id": w["stock2"],
        "event_date": "2026-03-01T00:00:00Z", "reference_no": "GP-77"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"moved": 2, "failed": []}
    for asset in (a, b):
        last = (await _events(asset["id"]))[-1]
        assert last.event_type == "MOVED" and last.reference_no == "GP-77"
        assert last.event_date == datetime(2026, 3, 1, tzinfo=timezone.utc)


async def test_an_asset_whose_last_movement_is_later_fails_alone_with_a_sentence(client):
    w = await build_world()
    h = await login(client, w, "owner")
    early = await make_asset(client, h, w)                                     # last event 01-02-2026
    late = await make_asset(client, h, w, invoice_date="2026-04-01")           # last event 01-04-2026
    resp = await client.post("/api/assets/bulk-action", headers=h, json={
        "asset_ids": [early["id"], late["id"]], "event_type": "MOVED", "to_asset_user_id": w["stock2"],
        "event_date": "2026-03-01T00:00:00Z", "reference_no": "GP-1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["done"] == 1
    assert body["failed"] == [{"asset_id": late["id"],
                               "reason": "The date cannot be before the asset's last recorded movement (01-04-2026)."}]
    assert [e.event_type for e in await _events(late["id"])] == ["PROCURED"]          # nothing written for it


async def test_a_future_date_is_refused_per_asset_and_nothing_moves(client):
    w = await build_world()
    h = await login(client, w, "owner")
    a = await make_asset(client, h, w)
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    resp = await client.post("/api/assets/bulk-move", headers=h, json={
        "asset_ids": [a["id"]], "to_asset_user_id": w["stock2"], "event_date": future})
    assert resp.json() == {"moved": 0, "failed": [{"asset_id": a["id"], "reason": "The date cannot be in the future."}]}
    assert len(await _events(a["id"])) == 1


async def test_without_a_date_or_reference_the_batch_behaves_as_before(client):
    w = await build_world()
    h = await login(client, w, "owner")
    a = await make_asset(client, h, w)
    before = datetime.now(timezone.utc) - timedelta(seconds=5)
    resp = await client.post("/api/assets/bulk-move", headers=h, json={"asset_ids": [a["id"]], "to_asset_user_id": w["stock2"]})
    assert resp.json() == {"moved": 1, "failed": []}
    last = (await _events(a["id"]))[-1]
    assert last.reference_no is None and last.event_date >= before


async def test_bulk_action_with_a_date_matches_the_single_asset_event(client):
    w = await build_world()
    h = await login(client, w, "owner")
    single, batch = await make_asset(client, h, w), await make_asset(client, h, w)
    one = await client.post(f"/api/assets/{single['id']}/events", headers=h, json={
        "event_type": "SENT_FOR_REPAIR", "event_date": "2026-05-05T00:00:00Z", "reference_no": "RMA-9", "remarks": "screen"})
    assert one.status_code == 201, one.text
    many = await client.post("/api/assets/bulk-action", headers=h, json={
        "asset_ids": [batch["id"]], "event_type": "SENT_FOR_REPAIR", "event_date": "2026-05-05T00:00:00Z",
        "reference_no": "RMA-9", "remarks": "screen"})
    assert many.json() == {"done": 1, "failed": []}
    e1, e2 = (await _events(single["id"]))[-1], (await _events(batch["id"]))[-1]
    for field in ("event_type", "event_date", "reference_no", "remarks", "status_after", "from_asset_user_id", "to_asset_user_id"):
        assert getattr(e1, field) == getattr(e2, field), field


async def test_a_date_without_a_time_today_is_recorded_after_the_last_event(client):
    """Same rule as the single event: today's date picked without a time (midnight) on an asset moved
    earlier today is recorded at that last movement's time, not refused."""
    w = await build_world()
    h = await login(client, w, "owner")
    a = await make_asset(client, h, w)
    first = await client.post("/api/assets/bulk-move", headers=h, json={"asset_ids": [a["id"]], "to_asset_user_id": w["stock2"]})
    assert first.json()["moved"] == 1
    today = datetime.now(timezone.utc).date().isoformat()
    again = await client.post("/api/assets/bulk-move", headers=h, json={
        "asset_ids": [a["id"]], "to_asset_user_id": w["stock"], "event_date": f"{today}T00:00:00Z", "reference_no": "R2"})
    assert again.json() == {"moved": 1, "failed": []}
    events = await _events(a["id"])
    assert events[-1].event_date == events[-2].event_date and events[-1].reference_no == "R2"


async def test_reference_and_date_limits_and_scope_still_apply(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    chair = await make_asset(client, owner, w, "nonit")
    too_long = await client.post("/api/assets/bulk-move", headers=owner, json={
        "asset_ids": [chair["id"]], "to_asset_user_id": w["stock2"], "reference_no": "R" * 101})
    assert too_long.status_code == 422 and "too long" in too_long.json()["detail"]
    it_op = await login(client, w, "op_it")                       # a Non-IT chair is not theirs
    resp = await client.post("/api/assets/bulk-move", headers=it_op, json={
        "asset_ids": [chair["id"]], "to_asset_user_id": w["stock2"], "event_date": "2026-03-01T00:00:00Z", "reference_no": "X"})
    assert resp.json() == {"moved": 0, "failed": [{"asset_id": chair["id"], "reason": "not found"}]}
    viewer = await login(client, w, "viewer_it")
    assert (await client.post("/api/assets/bulk-move", headers=viewer, json={
        "asset_ids": [chair["id"]], "to_asset_user_id": w["stock2"], "event_date": "2026-03-01T00:00:00Z"})).status_code == 403


# ------------------------------------------------------------------ ids up to 1,000

async def _batch(client, h, w, quantity: int) -> list[int]:
    resp = await client.post("/api/assets/batch", headers=h, json={
        "item_id": w["item_gangbox"], "quantity": quantity, "received_into_asset_user_id": w["stock"], "cost_center_id": w["cc"]})
    assert resp.status_code == 201, resp.text
    return resp.json()["label_asset_ids"]


async def test_a_whole_large_receipt_opens_in_one_request(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    ids = await _batch(client, h, w, 1000)
    resp = await client.get("/api/assets", headers=h, params={"ids": ",".join(map(str, ids)), "limit": 1000})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1000 and {a["id"] for a in body["items"]} == set(ids)
    assert all(a["item_name"] == "Gang Box" for a in body["items"])


async def test_ordinary_paging_keeps_its_200_cap_and_ids_keep_the_default_page(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    ids = await _batch(client, h, w, 250)
    refused = await client.get("/api/assets", headers=h, params={"limit": 500})
    assert refused.status_code == 422 and refused.json()["detail"] == "At most 200 assets can be listed per page."
    assert (await client.get("/api/assets", headers=h, params={"limit": 200})).status_code == 200
    default = (await client.get("/api/assets", headers=h, params={"ids": ",".join(map(str, ids))})).json()
    assert default["total"] == 250 and len(default["items"]) == 50                   # unchanged default page
    too_many = await client.get("/api/assets", headers=h, params={"ids": ",".join(str(i) for i in range(1, 1002)), "limit": 1000})
    assert too_many.status_code == 422 and too_many.json()["detail"] == "You can open at most 1,000 assets at a time."
    over = await client.get("/api/assets", headers=h, params={"ids": "1,2", "limit": 1001})
    assert over.status_code == 422


async def test_ids_never_widen_the_callers_work_area(client):
    w = await build_s4_world()
    owner = await login(client, w, "owner")
    chair = await make_asset(client, owner, w, "nonit")
    laptop = await make_asset(client, owner, w, "it")
    it_op = await login(client, w, "op_it")
    seen = (await client.get("/api/assets", headers=it_op, params={"ids": f"{chair['id']},{laptop['id']}", "limit": 1000})).json()
    assert [a["id"] for a in seen["items"]] == [laptop["id"]] and seen["total"] == 1


async def test_the_same_asset_twice_in_a_dated_batch_moves_once(client):
    w = await build_world()
    h = await login(client, w, "owner")
    a = await make_asset(client, h, w)
    resp = await client.post("/api/assets/bulk-move", headers=h, json={
        "asset_ids": [a["id"], a["id"]], "to_asset_user_id": w["stock2"], "event_date": "2026-03-01T00:00:00Z", "reference_no": "D"})
    assert resp.json() == {"moved": 1, "failed": []}
    assert [e.event_type for e in await _events(a["id"])] == ["PROCURED", "MOVED"]


async def test_a_date_without_a_time_zone_is_read_as_utc_like_the_single_event(client):
    w = await build_world()
    h = await login(client, w, "owner")
    a = await make_asset(client, h, w)
    resp = await client.post("/api/assets/bulk-move", headers=h, json={
        "asset_ids": [a["id"]], "to_asset_user_id": w["stock2"], "event_date": "2026-03-02"})
    assert resp.json() == {"moved": 1, "failed": []}
    assert (await _events(a["id"]))[-1].event_date == datetime(2026, 3, 2, tzinfo=timezone.utc)
