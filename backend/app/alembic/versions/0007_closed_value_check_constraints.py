"""AM-02: CHECK constraints for holder_type, role, and custom_field.field_type

Revision ID: 3a44505b6b10
Revises: d2bcc801fcc1
Create Date: 2026-09-24 00:00:00.000000

Additive, reversible. Only these three columns get a CHECK constraint in this
stage -- verified 100% conformant against both ckam_test and the live ckam
database before writing this migration (see docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md
for the exact query and result). asset.status, asset_event.event_type and
asset_event.status_after deliberately do NOT get one here: they're the
surface most likely to gain a new legal value if a future stage adds e.g. an
approval workflow, and the AM-02 authorization is explicit that a CHECK
constraint should not be added where it "conflicts with lifecycle
evolution" -- so those three stay documented-but-unenforced-at-the-DB-level,
same as before this migration, with application/API-level validation
(app/lifecycle/state_machine.py::transition) doing the real work.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '3a44505b6b10'
down_revision: Union[str, Sequence[str], None] = 'd2bcc801fcc1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
        ALTER TABLE holder ADD CONSTRAINT ck_holder_holder_type
        CHECK (holder_type IN ('EMPLOYEE', 'STORE', 'INSTALLED', 'IT_STOCK'));
    """)
    op.execute("""
        ALTER TABLE holder ADD CONSTRAINT ck_holder_role
        CHECK (role IN ('ADMIN', 'IT_TEAM', 'VIEWER', 'HOLDER'));
    """)
    op.execute("""
        ALTER TABLE custom_field ADD CONSTRAINT ck_custom_field_field_type
        CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'checkbox'));
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE custom_field DROP CONSTRAINT IF EXISTS ck_custom_field_field_type;")
    op.execute("ALTER TABLE holder DROP CONSTRAINT IF EXISTS ck_holder_role;")
    op.execute("ALTER TABLE holder DROP CONSTRAINT IF EXISTS ck_holder_holder_type;")
