"""S4: app.lifecycle.service.apply_events -- the ledger's batch entry point -- applies exactly the rules,
validations and name snapshots of apply_event (which is now the same code for one asset), refuses the
whole batch on the first problem (nothing written), and needs a constant number of queries."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.lifecycle.models import AssetEvent
from app.lifecycle.service import apply_event, apply_events
from app.lifecycle.state_machine import LifecycleError
from app.masters.models import AssetCategory, Company, CostCenter, Department, Location
from tests.purchase_orders.s4_world import Statements

EVENT_FIELDS = ("event_type", "from_asset_user_id", "to_asset_user_id", "from_asset_user_name_snapshot",
                "to_asset_user_name_snapshot", "status_after", "remarks", "reference_no", "recorded_by")
ASSET_STATE = ("status", "current_asset_user_id", "status_since")


async def _world(session, n_assets: int = 4) -> dict:
    co = Company(code="S4L", name="Ledger Co")
    co2 = Company(code="S4L2", name="Other Co")
    cat = AssetCategory(code="S4LIT", name="IT", asset_domain="IT")
    session.add_all([co, co2, cat])
    await session.flush()
    cc = CostCenter(company_id=co.id, code="HO", name="HO")
    loc = Location(company_id=co.id, code="S4L-HO", name="HO")
    loc2 = Location(company_id=co2.id, code="S4L2-HO", name="HO2")
    dept = Department(name="S4L")
    session.add_all([cc, loc, loc2, dept])
    await session.flush()

    def user(code, type_, name, company=co, location=loc, active=True, role="SELF_SERVICE"):
        return AssetUser(company_id=company.id, code=code, name=name, asset_user_type=type_, location_id=location.id,
                         department_id=dept.id, role=role, is_active=active)
    people = {
        "stock": user("STK", "STOCK_POINT", "Main Stock"), "ravi": user("RAVI", "EMPLOYEE", "Ravi Kumar"),
        "store": user("LAM", "STORE", "Lamhi Store"), "install": user("INS", "INSTALLED", "Lamhi Install Point"),
        "closed": user("OLD", "STOCK_POINT", "Closed Stock", active=False),
        "other": user("OTH", "STOCK_POINT", "Other Co Stock", company=co2, location=loc2),
        "actor": user("ACT", "EMPLOYEE", "Operator", role="OPERATOR"),
        "admin": user("ADM", "EMPLOYEE", "Admin", role="ADMIN"),
    }
    session.add_all(people.values())
    await session.flush()
    assets = []
    for n in range(n_assets):
        assets.append(Asset(asset_code=f"S4L/{n}", company_id=co.id, cost_center_id=cc.id, category_id=cat.id,
                            description="Laptop", purchase_date=date(2026, 1, 1), status="IN_STOCK",
                            current_asset_user_id=people["stock"].id, status_since=date(2026, 1, 1), asset_domain="IT"))
    session.add_all(assets)
    await session.flush()
    return {"assets": assets, **people}


def _event(e: AssetEvent) -> tuple:
    return tuple(getattr(e, f) for f in EVENT_FIELDS)


def _state(a: Asset) -> tuple:
    return tuple(getattr(a, f) for f in ASSET_STATE)


async def test_the_batch_entry_point_writes_exactly_what_the_single_one_writes():
    when = datetime(2026, 2, 3, 10, 0, tzinfo=timezone.utc)
    async with SessionLocal() as s:
        w = await _world(s, 6)
        a = w["assets"]
        destinations = [w["ravi"], w["store"], w["install"]]
        singles = [await apply_event(s, a[i], "MOVED", to_asset_user_id=d.id, actor=w["actor"], event_date=when,
                                     remarks="handed over", reference_no="GP-1")
                   for i, d in enumerate(destinations)]
        batch = await apply_events(s, [(a[3 + i], d.id) for i, d in enumerate(destinations)], "MOVED", w["actor"],
                                   event_date=when, remarks="handed over", reference_no="GP-1")
        await s.commit()
        assert [_event(e) for e in singles] == [_event(e) for e in batch]
        assert [_state(x) for x in a[:3]] == [_state(x) for x in a[3:]]
        assert [x.status for x in a[3:]] == ["ALLOTTED", "ALLOTTED", "INSTALLED"]
        assert [e.event_date for e in batch] == [when] * 3
        assert batch[0].from_asset_user_name_snapshot == "Main Stock" and batch[2].to_asset_user_name_snapshot == "Lamhi Install Point"


async def test_a_batch_takes_a_constant_number_of_queries():
    async with SessionLocal() as s:
        w = await _world(s, 60)
        await s.commit()
        with Statements() as few:
            await apply_events(s, [(w["assets"][0], w["ravi"].id)], "MOVED", w["actor"])
        with Statements() as many:
            await apply_events(s, [(x, w["ravi"].id) for x in w["assets"][1:]], "MOVED", w["actor"])
        await s.commit()
    assert many.count <= few.count + 1          # 59 assets: still one read of last events, holders, one insert
    assert many.count <= 6


@pytest.mark.parametrize("case, message", [
    ("future", "The date cannot be in the future."),
    ("closed", "Closed Stock is no longer active, so assets cannot be sent there."),
    ("other_company", "Assets can only move within their own company."),
    ("twice", "The same asset was chosen twice."),
    ("destination_on_lost", "This action does not send the asset anywhere, so do not choose a destination."),
    ("no_destination", "Choose where the asset is going."),
    ("missing", "The destination you chose does not exist."),
])
async def test_the_batch_refuses_like_the_single_path_and_writes_nothing(case, message):
    async with SessionLocal() as s:
        w = await _world(s, 3)
        await s.commit()
        a = w["assets"]
        event_type, when = "MOVED", None
        moves = [(a[0], w["ravi"].id), (a[1], w["ravi"].id), (a[2], w["ravi"].id)]
        if case == "future":
            when = datetime.now(timezone.utc) + timedelta(days=1)
        elif case == "closed":
            moves[2] = (a[2], w["closed"].id)
        elif case == "other_company":
            moves[1] = (a[1], w["other"].id)
        elif case == "twice":
            moves[2] = (a[0], w["store"].id)
        elif case == "destination_on_lost":
            event_type = "LOST"
        elif case == "no_destination":
            moves[2] = (a[2], None)
        elif case == "missing":
            moves[2] = (a[2], 99999999)
        with pytest.raises(LifecycleError, match=message):
            await apply_events(s, moves, event_type, w["actor"], event_date=when)
        await s.rollback()
        assert (await s.execute(select(func.count()).select_from(AssetEvent))).scalar_one() == 0
        assert set((await s.execute(select(Asset.status))).scalars().all()) == {"IN_STOCK"}


async def test_one_illegal_move_refuses_the_whole_batch():
    async with SessionLocal() as s:
        w = await _world(s, 3)
        a = w["assets"]
        stock_id = w["stock"].id
        await apply_event(s, a[2], "DISPOSED", to_asset_user_id=None, actor=w["actor"])
        await s.commit()
        with pytest.raises(LifecycleError, match="This asset has been disposed of"):
            await apply_events(s, [(x, w["ravi"].id) for x in a], "MOVED", w["actor"])
        await s.rollback()
        assert (await s.execute(select(func.count()).select_from(AssetEvent))).scalar_one() == 1
        holders = (await s.execute(select(Asset.current_asset_user_id).order_by(Asset.id))).scalars().all()
        assert holders == [stock_id] * 3


async def test_the_last_event_date_rules_apply_to_each_asset_of_the_batch():
    async with SessionLocal() as s:
        w = await _world(s, 2)
        a = w["assets"]
        late = datetime(2026, 3, 10, 15, 30, tzinfo=timezone.utc)
        await apply_event(s, a[0], "MOVED", to_asset_user_id=w["ravi"].id, actor=w["actor"], event_date=late)
        await s.commit()
        # same day, earlier clock time: recorded at the last event's time for that asset only
        same_day = datetime(2026, 3, 10, 0, 0, tzinfo=timezone.utc)
        events = await apply_events(s, [(a[0], w["stock"].id), (a[1], w["ravi"].id)], "MOVED", w["actor"], event_date=same_day)
        assert [e.event_date for e in events] == [late, same_day]
        await s.commit()
        with pytest.raises(LifecycleError, match=r"before the asset's last recorded movement \(10-03-2026\)"):
            await apply_events(s, [(a[1], w["stock"].id), (a[0], w["ravi"].id)], "MOVED", w["actor"],
                               event_date=datetime(2026, 3, 9, tzinfo=timezone.utc))


async def test_role_rules_apply_in_the_batch_too():
    async with SessionLocal() as s:
        w = await _world(s, 2)
        await s.commit()
        with pytest.raises(LifecycleError, match="Only an admin can add a correction note."):
            await apply_events(s, [(x, None) for x in w["assets"]], "CORRECTION", w["actor"])
        notes = await apply_events(s, [(x, None) for x in w["assets"]], "CORRECTION", w["admin"], remarks="typo")
        await s.commit()
        assert [(e.status_after, e.remarks) for e in notes] == [("IN_STOCK", "typo")] * 2
        assert {x.status_since for x in w["assets"]} == {date(2026, 1, 1)}      # a note never moves "since"


async def test_an_empty_batch_writes_nothing():
    async with SessionLocal() as s:
        w = await _world(s, 1)
        assert await apply_events(s, [], "MOVED", w["actor"]) == []
