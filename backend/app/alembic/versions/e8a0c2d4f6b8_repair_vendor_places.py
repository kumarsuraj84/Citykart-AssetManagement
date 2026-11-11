"""Release 3: a repair vendor is a PLACE (asset_user of type REPAIR_VENDOR) that holds the assets sent to it

Revision ID: e8a0c2d4f6b8
Revises: d7f9b1c3e5a7
Create Date: 2026-11-12 10:00:00.000000

The owner decided (2026-11-11) that "Send for Repair" names the repair vendor, that the asset then shows as "With
<vendor>, under repair", that CKAM can say how many assets each vendor has and for how long, and that "Receive from
Repair" asks where each asset goes (back where it came from, or anywhere). Making the vendor a place reuses the
holder machinery (holder, history, "currently with" lists, counts) instead of a second parallel one.

Changes (no row is updated, no existing asset is touched):
  * `asset_user.vendor_id` (nullable FK to `vendor`): set only on a repair-vendor place;
  * a unique index on (company_id, vendor_id) where vendor_id is set: one repair place per vendor per company
    (created on first use by `app.repairs.service.ensure_repair_place`, never by a screen of its own);
  * the check `ck_asset_user_ordinary_fields_required` is replaced so that a REPAIR_VENDOR place needs no location
    (an outside workshop has no CityKart place); every other kind still needs company, location, code and type;
  * the check `ck_asset_user_asset_user_type` also accepts REPAIR_VENDOR.

Downgrade removes the index and the column and restores the two stricter checks; it fails if a repair-vendor place
exists (move its assets away and delete such rows first).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e8a0c2d4f6b8'
down_revision: Union[str, Sequence[str], None] = 'd7f9b1c3e5a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset_user', sa.Column('vendor_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key('fk_asset_user_vendor', 'asset_user', 'vendor', ['vendor_id'], ['id'])
    op.create_index(
        'uq_asset_user_repair_vendor', 'asset_user', ['company_id', 'vendor_id'], unique=True,
        postgresql_where=sa.text('vendor_id IS NOT NULL'),
    )
    op.drop_constraint('ck_asset_user_ordinary_fields_required', 'asset_user', type_='check')
    op.create_check_constraint(
        'ck_asset_user_ordinary_fields_required', 'asset_user',
        "is_primary_owner OR (company_id IS NOT NULL AND code IS NOT NULL AND asset_user_type IS NOT NULL "
        "AND (location_id IS NOT NULL OR asset_user_type = 'REPAIR_VENDOR'))",
    )
    op.drop_constraint('ck_asset_user_asset_user_type', 'asset_user', type_='check')
    op.create_check_constraint(
        'ck_asset_user_asset_user_type', 'asset_user',
        "asset_user_type IS NULL OR asset_user_type IN ('EMPLOYEE', 'STORE', 'INSTALLED', 'STOCK_POINT', 'REPAIR_VENDOR')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_asset_user_asset_user_type', 'asset_user', type_='check')
    op.create_check_constraint(
        'ck_asset_user_asset_user_type', 'asset_user',
        "asset_user_type IS NULL OR asset_user_type IN ('EMPLOYEE', 'STORE', 'INSTALLED', 'STOCK_POINT')",
    )
    op.drop_constraint('ck_asset_user_ordinary_fields_required', 'asset_user', type_='check')
    op.create_check_constraint(
        'ck_asset_user_ordinary_fields_required', 'asset_user',
        "is_primary_owner OR (company_id IS NOT NULL AND location_id IS NOT NULL "
        "AND code IS NOT NULL AND asset_user_type IS NOT NULL)",
    )
    op.drop_index('uq_asset_user_repair_vendor', table_name='asset_user')
    op.drop_constraint('fk_asset_user_vendor', 'asset_user', type_='foreignkey')
    op.drop_column('asset_user', 'vendor_id')
