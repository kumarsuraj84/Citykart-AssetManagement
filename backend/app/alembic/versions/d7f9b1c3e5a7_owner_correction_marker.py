"""Release 2: an asset's owner company and cost centre may change ONLY through the audited owner correction

Revision ID: d7f9b1c3e5a7
Revises: c6e8a0b2d4f6
Create Date: 2026-11-11 12:00:00.000000

Until now the trigger `trg_asset_no_identity_change` refused every change of `asset.asset_code`, `asset.company_id` and
`asset.cost_center_id`. The owner decided (2026-11-11) that an asset keeps the company and cost centre it was bought
under until it is sold, scrapped or disposed, EXCEPT that the platform owner or a Full Admin may correct a wrong one
(wrong cost centre or company chosen while inwarding), with a mandatory reason and a history entry.

The function is replaced so that:
  * `asset_code` is still never allowed to change (the code can never change, even for a correction);
  * `company_id` and `cost_center_id` may change only in a transaction that carries the transaction-local marker
    `ckam.owner_correction = on`, which `app.assets.correction_service.correct_owner` switches on right before it writes
    and off right after (set_config(..., true): it also ends with the transaction, so it never leaks to the next
    transaction on a pooled connection). Every other path is refused exactly as before.

Honest limit (same as `ckam.lifecycle_writer`, revision c6e8a0b2d4f6): anyone who can run SQL as the application role
can also set the marker. This is defence in depth against application bugs and stray writes; the barrier against a
malicious database user is the owner/runtime role split (ops/db/role_split.sql).

No row is updated by this migration. Downgrade restores the strict function.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd7f9b1c3e5a7'
down_revision: Union[str, Sequence[str], None] = 'c6e8a0b2d4f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_asset_identity_change() RETURNS trigger AS $$
        BEGIN
            IF NEW.asset_code IS DISTINCT FROM OLD.asset_code THEN
                RAISE EXCEPTION 'asset_code is immutable once set';
            END IF;
            -- Release 2: only app.assets.correction_service.correct_owner (audited, with a reason) sets this marker.
            IF coalesce(current_setting('ckam.owner_correction', true), '') <> 'on' THEN
                IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
                    RAISE EXCEPTION 'company_id can only change through the owner correction';
                END IF;
                IF NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id THEN
                    RAISE EXCEPTION 'cost_center_id can only change through the owner correction';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_asset_identity_change() RETURNS trigger AS $$
        BEGIN
            IF NEW.asset_code IS DISTINCT FROM OLD.asset_code THEN
                RAISE EXCEPTION 'asset_code is immutable once set';
            END IF;
            IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
                RAISE EXCEPTION 'company_id is immutable once set';
            END IF;
            IF NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id THEN
                RAISE EXCEPTION 'cost_center_id is immutable once set';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
