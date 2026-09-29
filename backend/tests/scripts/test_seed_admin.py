from sqlalchemy import select
from app.core.db import SessionLocal
from app.asset_users.models import AssetUser
from scripts.seed_admin import ensure_seed_admin


async def test_seed_admin_is_idempotent():
    async with SessionLocal() as session:
        first = await ensure_seed_admin(session, company_code="SEEDTEST", password="Passw0rd!")
        await session.commit()
        second = await ensure_seed_admin(session, company_code="SEEDTEST", password="Passw0rd!")
        await session.commit()

    assert first["asset_user_id"] == second["asset_user_id"]

    async with SessionLocal() as session:
        stmt = select(AssetUser).where(AssetUser.code == "SEEDADMIN")
        rows = (await session.execute(stmt)).scalars().all()
        assert len(rows) == 1
        assert rows[0].role == "ADMIN"
        # Masters/Import are Primary-Owner-only now -- E2E fixtures (frontend/e2e/
        # fixtures.ts) provision test-company masters through this account's
        # token, so it must carry is_primary_owner (dev/E2E-only bootstrap, see
        # this script's own comment; never run against production).
        assert rows[0].is_primary_owner is True
