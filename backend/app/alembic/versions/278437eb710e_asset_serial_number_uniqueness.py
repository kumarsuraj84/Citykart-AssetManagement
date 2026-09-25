"""asset serial number global uniqueness

Revision ID: 278437eb710e
Revises: 6c882ef3b225
Create Date: 2026-09-25 00:00:00.000000

Serial Number must be unique across the ENTIRE system (every company, every
category, every creation path -- Add Asset, Purchase Order delivery, Import),
per docs/ai/DECISIONS.md. The one reserved exemption is the literal
placeholder "N/A" (case-insensitive), used for units that genuinely have no
serial (an accessory category that never had one, or old stock whose serial
is physically lost) -- "N/A" may repeat freely. A plain sa.UniqueConstraint
can't express "case-insensitive", "only when not the N/A placeholder", or
"only when not soft-deleted", so this is a hand-written partial, functional
unique index, following this codebase's existing precedent
(0005_holder_email_unique.py's ux_holder_company_email_ci).
"""
from typing import Sequence, Union

from alembic import op


revision: str = '278437eb710e'
down_revision: Union[str, Sequence[str], None] = '6c882ef3b225'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE UNIQUE INDEX ux_asset_serial_number_ci
        ON asset (lower(trim(serial_number)))
        WHERE serial_number IS NOT NULL
          AND trim(serial_number) <> ''
          AND lower(trim(serial_number)) <> 'n/a'
          AND deleted_at IS NULL;
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_asset_serial_number_ci;")
