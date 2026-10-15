"""Security AU-05/AU-07: asset_user.token_version (the session version)

Revision ID: f9a1c3e5b7d2
Revises: e6f8a0b2c4d6
Create Date: 2026-10-15 10:00:00.000000

Every access and refresh token now carries the version of its account's sessions (`tv`). Raising the version
(sign-out, password change / reset, deactivation, sign-in switched off, a new role / work area / company /
company access) makes every token issued before stop working at once.

Additive only: one NOT NULL integer column with server default 0, so every existing row gets 0 -- and a token
issued before this release (no `tv` claim) counts as version 0, so nobody signed in at the upgrade is thrown
out. Downgrade drops the column.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f9a1c3e5b7d2'
down_revision: Union[str, Sequence[str], None] = 'e6f8a0b2c4d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset_user', sa.Column('token_version', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    op.drop_column('asset_user', 'token_version')
