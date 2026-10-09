"""bundles: purchase-time kits (Desktop = CPU + TFT + Keyboard + Mouse)

Revision ID: e5b2c8a4d1f6
Revises: d3f8a1c5b7e9
Create Date: 2026-10-09 18:00:00.000000

Two new master tables (bundle, bundle_part) and two new pending_asset columns:
serial_required (a part such as a mouse never carries a serial, so the delivery
dialog starts with "No serial number" ticked for it) and bundle_label (which
bundle a line came from, shown as a tag; null for ordinary lines). Purely
additive: existing lines get serial_required = true, bundle_label = null.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e5b2c8a4d1f6'
down_revision: Union[str, Sequence[str], None] = 'd3f8a1c5b7e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _audit_columns() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_by', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        'bundle',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        *_audit_columns(),
    )
    op.execute("CREATE UNIQUE INDEX ux_bundle_name_ci ON bundle (lower(name)) WHERE is_active")

    op.create_table(
        'bundle_part',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('bundle_id', sa.BigInteger(), sa.ForeignKey('bundle.id'), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('category_id', sa.BigInteger(), sa.ForeignKey('asset_category.id'), nullable=False),
        sa.Column('subcategory_id', sa.BigInteger(), sa.ForeignKey('asset_subcategory.id'), nullable=True),
        sa.Column('serial_required', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('share_percent', sa.Numeric(5, 2), nullable=False),
        sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
        *_audit_columns(),
        sa.CheckConstraint('share_percent > 0 AND share_percent <= 100', name='ck_bundle_part_share'),
    )
    op.create_index('ix_bundle_part_bundle_id', 'bundle_part', ['bundle_id'])

    op.add_column('pending_asset', sa.Column('serial_required', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('pending_asset', sa.Column('bundle_label', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('pending_asset', 'bundle_label')
    op.drop_column('pending_asset', 'serial_required')
    op.drop_index('ix_bundle_part_bundle_id', table_name='bundle_part')
    op.drop_table('bundle_part')
    op.execute("DROP INDEX IF EXISTS ux_bundle_name_ci")
    op.drop_table('bundle')
