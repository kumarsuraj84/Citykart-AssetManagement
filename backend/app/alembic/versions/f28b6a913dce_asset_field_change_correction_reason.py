"""asset field change correction reason

Revision ID: f28b6a913dce
Revises: 370399c6380e
Create Date: 2026-09-24 16:45:00.000000

AM-07: adds a nullable `reason` column to `asset_field_change` so a
controlled asset correction (category/subcategory/purchase_date -- see
app/assets/correction_service.py) can carry its mandatory justification
alongside the old/new values it already records. Reused, not a new audit
table: `reason IS NOT NULL` is what distinguishes a correction row from an
ordinary descriptive/procurement edit row written by the existing
PUT /api/assets/{id} path (app/assets/audit_service.py::record_field_changes),
which never populates it. Purely additive/reversible -- no existing row's
shape changes, and the append-only triggers on this table (migration
a409768dc2cf) already only guard UPDATE/DELETE, not INSERT, so adding a
column needs no trigger change.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f28b6a913dce'
down_revision: Union[str, Sequence[str], None] = '370399c6380e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('asset_field_change', sa.Column('reason', sa.String(length=500), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('asset_field_change', 'reason')
