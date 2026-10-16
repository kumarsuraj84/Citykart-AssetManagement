"""Security OBS-STATUS: the database refuses a change of an asset's lifecycle fields outside the ledger writer

Revision ID: c6e8a0b2d4f6
Revises: b5d7f9a1c3e5
Create Date: 2026-10-16 14:00:00.000000

`asset.status`, `asset.current_asset_user_id` and `asset.status_since` are the asset's current state, derived from
the movement ledger (`asset_event`). `app.lifecycle.service.apply_events` is the only code allowed to change them,
and until now only that application rule kept them in step with the ledger: any other UPDATE (a stray ORM write in
new code, an ad-hoc SQL fix, a client with the app's credentials) could move an asset without a movement record.

A BEFORE UPDATE row trigger now refuses a change of any of the three columns (IS DISTINCT FROM) unless the
transaction carries the transaction-local marker `ckam.lifecycle_writer = on`. `apply_events` switches the marker on
right before it writes and off again right after (set_config(..., true): the value also ends with the
transaction, so it never leaks to the next transaction on a pooled connection). INSERT of a new asset (its initial
status) is not affected; updates of every other asset column are not affected.

Honest limit: anyone who can run SQL as the application role can also set the marker. This is defence in depth
against application bugs and stray writes, not a barrier against a malicious database user; that barrier is the
owner/runtime role split (ops/db/role_split.sql, EXT-07), under which the runtime role cannot drop or disable
this trigger.

Existing data is not touched (no row is updated by this migration). Older data migrations that updated these
columns run before this revision, so a fresh `alembic upgrade head` is unaffected. Downgrade drops the trigger and
its function.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c6e8a0b2d4f6'
down_revision: Union[str, Sequence[str], None] = 'b5d7f9a1c3e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_asset_lifecycle_write() RETURNS trigger AS $$
        BEGIN
            -- OBS-STATUS: only app.lifecycle.service.apply_events (which records an asset_event) sets this marker.
            IF coalesce(current_setting('ckam.lifecycle_writer', true), '') <> 'on' THEN
                RAISE EXCEPTION 'asset status, holder and status date can only change through a recorded asset movement (asset_event)';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    # UPDATE OF ... fires only when one of the three columns is in the SET list; WHEN skips the function call
    # entirely unless one of them really changes, so ordinary edits cost nothing extra.
    op.execute("""
        CREATE TRIGGER trg_asset_lifecycle_fields_guard
        BEFORE UPDATE OF status, current_asset_user_id, status_since ON asset
        FOR EACH ROW
        WHEN (NEW.status IS DISTINCT FROM OLD.status
              OR NEW.current_asset_user_id IS DISTINCT FROM OLD.current_asset_user_id
              OR NEW.status_since IS DISTINCT FROM OLD.status_since)
        EXECUTE FUNCTION forbid_asset_lifecycle_write();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_asset_lifecycle_fields_guard ON asset;")
    op.execute("DROP FUNCTION IF EXISTS forbid_asset_lifecycle_write();")
