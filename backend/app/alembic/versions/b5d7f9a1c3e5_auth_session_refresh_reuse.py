"""Security AU-06: auth_session (server-side sign-in session records, refresh-token reuse detection)

Revision ID: b5d7f9a1c3e5
Revises: a3c5e7f9b1d4
Create Date: 2026-10-16 10:00:00.000000

One row per sign-in (a phone and a PC are two rows). The refresh token carries the row id (`sid`); the row keeps
only the SHA-256 hash of the id (`jti`) of the one refresh token that may be used next, and of the token it just
replaced (accepted as a harmless duplicate for a few seconds -- several browser tabs). Any other old token coming
back ends every session of that person (app.auth.sessions).

Additive only: a new table, no change to existing rows. Refresh tokens issued before this release (no `sid`) keep
working once -- their first renewal creates their row (`legacy_token_hash`, unique, so a parallel first use is
recognised) -- so nobody is signed out by the deploy. A technical table, not a business record: rows 30 days past
their expiry are deleted by the daily retention job. Downgrade drops the table (sessions then work as before,
without reuse detection).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b5d7f9a1c3e5'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b1d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'auth_session',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('asset_user_id', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_reason', sa.String(40), nullable=True),
        sa.Column('current_jti_hash', sa.String(64), nullable=False),
        sa.Column('previous_jti_hash', sa.String(64), nullable=True),
        sa.Column('previous_valid_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('legacy_token_hash', sa.String(64), nullable=True),
        sa.UniqueConstraint('legacy_token_hash', name='uq_auth_session_legacy_token_hash'),
    )
    op.create_index('ix_auth_session_asset_user_id', 'auth_session', ['asset_user_id'])
    op.create_index('ix_auth_session_expires_at', 'auth_session', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_auth_session_expires_at', table_name='auth_session')
    op.drop_index('ix_auth_session_asset_user_id', table_name='auth_session')
    op.drop_table('auth_session')
