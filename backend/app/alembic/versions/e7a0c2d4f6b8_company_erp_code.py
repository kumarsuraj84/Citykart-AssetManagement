"""Company: the code the ERP uses for it

Revision ID: e7a0c2d4f6b8
Revises: d6f8b0c2e4a6
Create Date: 2026-10-10 23:30:00.000000

CKAM's company code is part of every asset code and cannot change, but the ERP
may call the same company something else (production: CKAM "CKS" is the ERP's
"CKSPL"). company.erp_company_code says which ERP company code this company is;
empty means the ordinary company code is the ERP code. Unique when set.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e7a0c2d4f6b8'
down_revision: Union[str, Sequence[str], None] = 'd6f8b0c2e4a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('company', sa.Column('erp_company_code', sa.String(length=50), nullable=True))
    op.execute("CREATE UNIQUE INDEX ux_company_erp_code ON company (upper(erp_company_code)) WHERE erp_company_code IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_company_erp_code")
    op.drop_column('company', 'erp_company_code')
