"""holder email uniqueness per company

Revision ID: 83d063397a4a
Revises: cf5fc76a3fb2
Create Date: 2026-09-23 19:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '83d063397a4a'
down_revision: Union[str, Sequence[str], None] = 'cf5fc76a3fb2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # POST /api/auth/login now accepts EITHER emp_code OR email as the login
    # identifier (case-insensitively), so a duplicate email within one company
    # would make that lookup non-deterministic -- close it at the DB level,
    # the same way (company_id, emp_code) is already enforced unique.
    #
    # Plain sa.UniqueConstraint can't express "case-insensitive" or "only when
    # NOT NULL" (most holders -- stores, stock locations, installed-equipment
    # locations -- have no email at all and must not collide with each other
    # on that NULL), so this is a hand-written partial, functional unique
    # index instead, following this codebase's existing precedent for
    # hand-written DB-level enforcement (see 0003_assets_and_events.py's
    # ledger-protection triggers).
    op.execute("""
        CREATE UNIQUE INDEX ux_holder_company_email_ci
        ON holder (company_id, lower(email))
        WHERE email IS NOT NULL;
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS ux_holder_company_email_ci;")
