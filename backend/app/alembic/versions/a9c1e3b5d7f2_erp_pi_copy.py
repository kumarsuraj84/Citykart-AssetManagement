"""The ERP's purchase invoices (PI) in CKAM's copy of the ERP data

Revision ID: a9c1e3b5d7f2
Revises: e8a0c2d4f6b8
Create Date: 2026-11-12 12:00:00.000000

erp_pi holds one row per PI document of the ERP's Fixed Assets purchases (both companies), keyed by the ERP's own
document id because the printed PI number repeats in CKSPL. CKAM finds the PI of an invoice received here by the
vendor's bill number, so the table is indexed by (company_code, bill_no_norm). Read-only mirror, filled by the ERP
copy (app.erp.sync); nothing else writes to it. Additive: no existing table or row changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a9c1e3b5d7f2'
down_revision: Union[str, Sequence[str], None] = 'e8a0c2d4f6b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'erp_pi',
        sa.Column('company_code', sa.String(length=20), primary_key=True),
        sa.Column('pi_code', sa.BigInteger(), primary_key=True),
        sa.Column('pi_number', sa.String(length=60), nullable=False),
        sa.Column('pi_date', sa.Date(), nullable=True),
        sa.Column('vendor_code', sa.String(length=50), nullable=False),
        sa.Column('vendor_name', sa.String(length=300), nullable=True),
        sa.Column('bill_no', sa.String(length=100), nullable=True),
        sa.Column('bill_no_norm', sa.String(length=100), nullable=True),
        sa.Column('bill_date', sa.Date(), nullable=True),
        sa.Column('amount', sa.Numeric(16, 2), nullable=True),
        sa.Column('lines_amount', sa.Numeric(16, 2), nullable=True),
        sa.Column('release_status', sa.String(length=5), nullable=True),
        sa.Column('lines', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('row_hash', sa.String(length=64), nullable=False),
        sa.Column('first_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_present', sa.Boolean(), nullable=False, server_default='true'),
    )
    op.create_index('ix_erp_pi_bill', 'erp_pi', ['company_code', 'bill_no_norm'])


def downgrade() -> None:
    op.drop_index('ix_erp_pi_bill', table_name='erp_pi')
    op.drop_table('erp_pi')
