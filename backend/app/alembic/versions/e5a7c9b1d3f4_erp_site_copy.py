"""The ERP's sites in CKAM's copy of the ERP data (stores, warehouses, head offices of both companies)

Revision ID: e5a7c9b1d3f4
Revises: d4f6b8c0e2a3
Create Date: 2026-10-13 15:00:00.000000

erp_site is keyed by (company_code, site_code): site codes 1..24 exist in both companies and mean different
places. short_name is the location code people use (LAM, SPR2). Used to create store users from the ERP.
Additive.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e5a7c9b1d3f4'
down_revision: Union[str, Sequence[str], None] = 'd4f6b8c0e2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'erp_site',
        sa.Column('company_code', sa.String(length=20), primary_key=True),
        sa.Column('site_code', sa.Integer(), primary_key=True),
        sa.Column('short_name', sa.String(length=100), nullable=True),
        sa.Column('site_name', sa.String(length=300), nullable=True),
        sa.Column('store_name', sa.String(length=300), nullable=True),
        sa.Column('site_kind', sa.String(length=30), nullable=True),
        sa.Column('store_type', sa.String(length=50), nullable=True),
        sa.Column('store_status', sa.String(length=30), nullable=True),
        sa.Column('is_active_site', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('state', sa.String(length=100), nullable=True),
        sa.Column('city', sa.String(length=100), nullable=True),
        sa.Column('row_hash', sa.String(length=64), nullable=False),
        sa.Column('first_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_present', sa.Boolean(), nullable=False, server_default='true'),
    )


def downgrade() -> None:
    op.drop_table('erp_site')
