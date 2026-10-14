"""S3a-1: the master_audit migration is the single head, and the table it makes
is append-only at the database level (the same triggers as asset_event and
asset_field_change)."""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from app.core.db import SessionLocal

APP_DIR = Path(__file__).resolve().parents[2]


def test_the_master_audit_migration_is_the_only_head():
    script = ScriptDirectory.from_config(Config(str(APP_DIR / "alembic.ini")))
    # S7 (intended change): d2e4f6a8b0c2 (idempotency_key + PO number index) now sits on top of it.
    # S8 (intended change): e6f8a0b2c4d6 (audit_log / error_log / system_event / client_report) on top of that.
    assert script.get_heads() == ["e6f8a0b2c4d6"]
    assert script.get_revision("e6f8a0b2c4d6").down_revision == "d2e4f6a8b0c2"
    assert script.get_revision("d2e4f6a8b0c2").down_revision == "c1d3e5f7a9b0"
    assert script.get_revision("c1d3e5f7a9b0").down_revision == "b8d0f2a4c6e8"


async def test_master_audit_has_its_append_only_triggers():
    async with SessionLocal() as s:
        triggers = set((await s.execute(text(
            "SELECT tgname FROM pg_trigger WHERE tgrelid = 'master_audit'::regclass AND NOT tgisinternal"
        ))).scalars().all())
    assert triggers == {"trg_master_audit_no_update", "trg_master_audit_no_delete"}
