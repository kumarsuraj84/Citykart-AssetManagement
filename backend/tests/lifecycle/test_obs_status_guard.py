"""Security OBS-STATUS (closure WP-B): the database itself refuses a change of asset.status / current_asset_user_id /
status_since that does not come from the ledger writer (app.lifecycle.service.apply_events). Trigger
trg_asset_lifecycle_fields_guard, migration c6e8a0b2d4f6."""
import uuid
from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.db import SessionLocal, engine
from app.lifecycle.service import LIFECYCLE_WRITER_SETTING, apply_event
from tests.core.s0_world import build_world, login, make_asset

REFUSED = "can only change through a recorded asset movement"
CHANGES = {
    "status": "LOST",
    "current_asset_user_id": "employee",           # resolved to the world's employee id
    "status_since": date(2020, 1, 1),
}


async def _world_with_asset(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    return w, h, asset["id"]


async def _row(asset_id: int) -> Asset:
    async with SessionLocal() as s:
        return await s.get(Asset, asset_id)


def _value(w: dict, field: str):
    value = CHANGES[field]
    return w[value] if field == "current_asset_user_id" else value


@pytest.mark.parametrize("field", list(CHANGES))
async def test_an_orm_write_of_a_lifecycle_field_is_refused(client, field):
    w, _, asset_id = await _world_with_asset(client)
    before = await _row(asset_id)
    async with SessionLocal() as s:
        asset = await s.get(Asset, asset_id)
        setattr(asset, field, _value(w, field))
        with pytest.raises(DBAPIError, match=REFUSED):
            await s.commit()
    after = await _row(asset_id)
    assert (after.status, after.current_asset_user_id, after.status_since) == (
        before.status, before.current_asset_user_id, before.status_since)


@pytest.mark.parametrize("sql", [
    "UPDATE asset SET status = 'LOST' WHERE id = :id",
    "UPDATE asset SET current_asset_user_id = :other WHERE id = :id",
    "UPDATE asset SET status_since = DATE '2020-01-01' WHERE id = :id",
    "UPDATE asset SET status = 'ALLOTTED', current_asset_user_id = :other, status_since = current_date WHERE id = :id",
])
async def test_a_raw_sql_update_of_a_lifecycle_field_is_refused(client, sql):
    w, _, asset_id = await _world_with_asset(client)
    async with SessionLocal() as s:
        with pytest.raises(DBAPIError, match=REFUSED):
            await s.execute(text(sql), {"id": asset_id, "other": w["employee"]})
    assert (await _row(asset_id)).status == "IN_STOCK"


async def test_a_role_that_is_not_a_superuser_is_refused_too(client):
    """The production app role is not a superuser; the trigger applies to it the same way. (The role exists only
    inside this rolled-back transaction.)"""
    _, _, asset_id = await _world_with_asset(client)
    role = f"ckam_obs_{uuid.uuid4().hex[:8]}"
    async with engine.connect() as conn:
        outer = await conn.begin()
        try:
            await conn.execute(text(f"CREATE ROLE {role} NOLOGIN NOSUPERUSER"))
            await conn.execute(text(f"GRANT SELECT, UPDATE ON asset TO {role}"))
            await conn.execute(text(f"SET LOCAL ROLE {role}"))
            savepoint = await conn.begin_nested()
            with pytest.raises(DBAPIError, match=REFUSED):
                await conn.execute(text("UPDATE asset SET status = 'LOST' WHERE id = :id"), {"id": asset_id})
            await savepoint.rollback()
            # ... while an ordinary column still changes
            await conn.execute(text("UPDATE asset SET description = 'Edited by the app role' WHERE id = :id"), {"id": asset_id})
        finally:
            await outer.rollback()


async def test_the_ledger_writer_still_moves_the_asset(client):
    w, h, asset_id = await _world_with_asset(client)
    resp = await client.post(f"/api/assets/{asset_id}/events", headers=h,
                             json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    assert resp.status_code in (200, 201), resp.text
    row = await _row(asset_id)
    assert row.status == "ALLOTTED" and row.current_asset_user_id == w["employee"] and row.status_since == date.today()


async def test_other_asset_columns_change_freely(client):
    w, _, asset_id = await _world_with_asset(client)
    async with SessionLocal() as s:
        asset = await s.get(Asset, asset_id)
        asset.description = "Renamed laptop"
        asset.purchase_cost = 4321
        asset.vendor_id = None
        await s.commit()
    async with SessionLocal() as s:
        # writing a lifecycle column with its CURRENT value is not a change, so it is allowed
        await s.execute(text("UPDATE asset SET status = status, status_since = status_since, "
                             "current_asset_user_id = current_asset_user_id WHERE id = :id"), {"id": asset_id})
        await s.commit()
    row = await _row(asset_id)
    assert (row.description, float(row.purchase_cost), row.vendor_id, row.status) == ("Renamed laptop", 4321.0, None, "IN_STOCK")


async def test_the_marker_is_off_again_after_apply_event_and_never_reaches_the_next_transaction(client):
    """Transaction-local, and switched off by apply_events right after its own write: a stray write later in the
    same transaction is refused, and so is a write in the next transaction on the same (pooled) connection."""
    w, _, asset_id = await _world_with_asset(client)
    async with engine.connect() as conn:
        async with AsyncSession(bind=conn, expire_on_commit=False) as s:
            actor = await s.get(AssetUser, w["admin"])
            asset = (await s.execute(select(Asset).where(Asset.id == asset_id))).scalar_one()
            await apply_event(s, asset, "MOVED", to_asset_user_id=w["employee"], actor=actor)
            marker = (await s.execute(text("SELECT current_setting(:n, true)"), {"n": LIFECYCLE_WRITER_SETTING})).scalar_one()
            assert marker == "off"
            with pytest.raises(DBAPIError, match=REFUSED):
                await s.execute(text("UPDATE asset SET status = 'LOST' WHERE id = :id"), {"id": asset_id})
            await s.rollback()
        # the same connection, a transaction that switched the marker on and committed ...
        async with conn.begin():
            await conn.execute(text("SELECT set_config(:n, 'on', true)"), {"n": LIFECYCLE_WRITER_SETTING})
        # ... the next transaction on it does not see the marker any more
        async with conn.begin():
            marker = (await conn.execute(text("SELECT current_setting(:n, true)"), {"n": LIFECYCLE_WRITER_SETTING})).scalar_one()
            assert marker in (None, "", "off")
            savepoint = await conn.begin_nested()
            with pytest.raises(DBAPIError, match=REFUSED):
                await conn.execute(text("UPDATE asset SET status = 'LOST' WHERE id = :id"), {"id": asset_id})
            await savepoint.rollback()
    # the rolled-back move above left the asset where it was
    assert (await _row(asset_id)).status == "IN_STOCK"


async def test_a_marker_set_inside_a_rolled_back_savepoint_is_gone(client):
    _, _, asset_id = await _world_with_asset(client)
    async with SessionLocal() as s:
        nested = await s.begin_nested()
        await s.execute(text("SELECT set_config(:n, 'on', true)"), {"n": LIFECYCLE_WRITER_SETTING})
        await nested.rollback()
        with pytest.raises(DBAPIError, match=REFUSED):
            await s.execute(text("UPDATE asset SET status = 'LOST' WHERE id = :id"), {"id": asset_id})


async def test_the_edit_screen_cannot_mass_assign_the_lifecycle_fields(client):
    w, h, asset_id = await _world_with_asset(client)
    before = await _row(asset_id)
    resp = await client.put(f"/api/assets/{asset_id}", headers=h, json={
        "description": "Edited laptop", "vendor_id": w["vendor"], "serial_number": "N/A", "purchase_cost": 999,
        "status": "LOST", "current_asset_user_id": w["employee"], "status_since": "2020-01-01",
    })
    assert resp.status_code == 200, resp.text
    after = await _row(asset_id)
    assert (after.status, after.current_asset_user_id, after.status_since) == (
        before.status, before.current_asset_user_id, before.status_since)
    assert after.description == "Edited laptop" and float(after.purchase_cost) == 999.0
