"""vendor code length

Revision ID: a1c7e5f3d9b2
Revises: d4e9a2f8b1c3
Create Date: 2026-09-29 13:00:00.000000

Vendor.code widens from varchar(20) to varchar(100) -- unlike every other
master's short internal code, a vendor's code is often just its full
registered company name ("VASPS INFOTECH PRIVATE LIMITED"), which the
20-char limit shared with Category/Location/etc routinely couldn't hold.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c7e5f3d9b2'
down_revision: Union[str, Sequence[str], None] = 'd4e9a2f8b1c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('vendor', 'code', type_=sa.String(length=100), existing_type=sa.String(length=20))


def downgrade() -> None:
    op.alter_column('vendor', 'code', type_=sa.String(length=20), existing_type=sa.String(length=100))
