"""custom field company scope

Revision ID: 370399c6380e
Revises: a409768dc2cf
Create Date: 2026-09-24 08:54:00.632875

AM-05: CustomField may now be GLOBAL (company_id IS NULL, unchanged meaning
for every pre-existing row -- this migration never rewrites an existing
value) or scoped to one company. Additive, nullable, reversible.

Note: alembic's autogenerate also proposed dropping and recreating several
pre-existing partial/expression indexes on asset/asset_event/
asset_field_change/holder -- the same known autogenerate false-positive
already documented in migrations 0007 and a409768dc2cf (it can't diff
partial/functional indexes cleanly against their WHERE-clause/expression
form). Removed from this migration by hand; nothing about those indexes
actually changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '370399c6380e'
down_revision: Union[str, Sequence[str], None] = 'a409768dc2cf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('custom_field', sa.Column('company_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        'fk_custom_field_company_id', 'custom_field', 'company', ['company_id'], ['id'],
    )
    op.create_index(
        'ix_custom_field_company_id', 'custom_field', ['company_id'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_custom_field_company_id', table_name='custom_field')
    op.drop_constraint('fk_custom_field_company_id', 'custom_field', type_='foreignkey')
    op.drop_column('custom_field', 'company_id')
