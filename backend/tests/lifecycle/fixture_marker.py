"""OBS-STATUS: TEST FIXTURE SETUP ONLY.

The database refuses a change of asset.status / current_asset_user_id / status_since unless the transaction carries
the lifecycle-writer marker that only app.lifecycle.service.apply_events sets. A few fixtures need an asset in a
state the ledger cannot produce directly (for example "allotted 200 days ago": apply_event refuses a backdated
event before the PROCURED one). They call this helper BEFORE assigning that one fixture value (the statement
autoflushes pending changes), in the same transaction. Application code must never use it -- it goes through
apply_events."""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.lifecycle.service import LIFECYCLE_WRITER_SETTING


async def allow_lifecycle_fixture_write(session: AsyncSession) -> None:
    """Switch the marker on for the rest of the current transaction (transaction-local, ends at commit)."""
    await session.execute(text("SELECT set_config(:name, 'on', true)"), {"name": LIFECYCLE_WRITER_SETTING})
