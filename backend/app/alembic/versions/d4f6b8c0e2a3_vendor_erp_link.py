"""One vendor, one ERP supplier code per company

Revision ID: d4f6b8c0e2a3
Revises: c3e5a7b9d1f2
Create Date: 2026-10-13 12:00:00.000000

The two companies have separate ERP supplier numbering: code 61 is a different supplier in each (690
codes clash, always for different suppliers), while the same real supplier (same GSTIN) has a different
code in each. vendor_erp_link(vendor_id, company_id, erp_vendor_code) replaces vendor.erp_vendor_code:
unique per (company, code); a vendor may have several links (one per company, or several inside one
company when the ERP has duplicate codes for it).

Existing vendor.erp_vendor_code values are copied as links to the company whose ERP company code is
CKSPL (the only company that had ERP data until now); then the column and its index are dropped.
Downgrade puts the CKSPL (else the oldest) link back into the column.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd4f6b8c0e2a3'
down_revision: Union[str, Sequence[str], None] = 'c3e5a7b9d1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'vendor_erp_link',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('vendor_id', sa.BigInteger(), sa.ForeignKey('vendor.id'), nullable=False),
        sa.Column('company_id', sa.BigInteger(), sa.ForeignKey('company.id'), nullable=False),
        sa.Column('erp_vendor_code', sa.String(length=50), nullable=False),
        sa.Column('created_by', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('company_id', 'erp_vendor_code', name='uq_vendor_erp_link_company_code'),
    )
    op.create_index('ix_vendor_erp_link_vendor_id', 'vendor_erp_link', ['vendor_id'])
    op.execute("""
        INSERT INTO vendor_erp_link (vendor_id, company_id, erp_vendor_code)
        SELECT v.id, c.id, v.erp_vendor_code
        FROM vendor v
        JOIN company c ON upper(coalesce(nullif(trim(c.erp_company_code), ''), c.code)) = 'CKSPL'
        WHERE v.erp_vendor_code IS NOT NULL
    """)
    op.drop_index('ux_vendor_erp_code', table_name='vendor')
    op.drop_column('vendor', 'erp_vendor_code')


def downgrade() -> None:
    op.add_column('vendor', sa.Column('erp_vendor_code', sa.String(length=50), nullable=True))
    op.execute("""
        UPDATE vendor v SET erp_vendor_code = pick.erp_vendor_code
        FROM (
            SELECT DISTINCT ON (l.erp_vendor_code) l.vendor_id, l.erp_vendor_code
            FROM vendor_erp_link l
            JOIN company c ON c.id = l.company_id
            ORDER BY l.erp_vendor_code,
                     (upper(coalesce(nullif(trim(c.erp_company_code), ''), c.code)) = 'CKSPL') DESC, l.id
        ) pick
        WHERE pick.vendor_id = v.id
          AND v.erp_vendor_code IS NULL
          AND NOT EXISTS (SELECT 1 FROM vendor w WHERE w.erp_vendor_code = pick.erp_vendor_code)
    """)
    op.create_index('ux_vendor_erp_code', 'vendor', ['erp_vendor_code'], unique=True,
                    postgresql_where=sa.text('erp_vendor_code IS NOT NULL'))
    op.drop_index('ix_vendor_erp_link_vendor_id', table_name='vendor_erp_link')
    op.drop_table('vendor_erp_link')
