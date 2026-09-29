"""holder to asset_user rename

Revision ID: c7e2f9a4b6d1
Revises: f3b6c8a1d7e4
Create Date: 2026-09-29 15:00:00.000000

Renames the Holder entity to AssetUser everywhere -- a pure rename, no
behavioural change. "Holder" undersold what this table actually is: not
just employees/stores physically "holding" assets, but also IT stock
points and install points, which aren't holders in any ordinary sense.

- Table `holder` -> `asset_user`, `holder_company_access` ->
  `asset_user_company_access` (column `holder_id` -> `asset_user_id`).
- Column renames: `holder.holder_type` -> `asset_user_type`,
  `asset.current_holder_id` -> `current_asset_user_id`,
  `asset_event.from_holder_id`/`to_holder_id` ->
  `from_asset_user_id`/`to_asset_user_id`,
  `asset_event.from_holder_name_snapshot`/`to_holder_name_snapshot` ->
  `from_asset_user_name_snapshot`/`to_asset_user_name_snapshot`,
  `pending_asset.initial_holder_id` -> `initial_asset_user_id`.
  Every other FK column pointing at this table (created_by/updated_by/
  actor_id/recorded_by/delivered_by/uploaded_by) keeps its own name --
  only the table it points at is renamed, which Postgres carries
  through automatically on a table rename.
- The `role` value `HOLDER` (the lowest-privilege access level) becomes
  `ASSET_USER`, for the same reason the entity itself is renamed --
  existing rows are updated, not just the column's allowed-values list.
- Named constraints/indexes are renamed to match
  (ck_holder_role -> ck_asset_user_role, etc); Postgres-auto-named FK
  constraints are left as-is (cosmetic only, still fully functional).
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c7e2f9a4b6d1'
down_revision: Union[str, Sequence[str], None] = 'f3b6c8a1d7e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Tables ---
    op.execute("ALTER TABLE holder RENAME TO asset_user;")
    op.execute("ALTER TABLE holder_company_access RENAME TO asset_user_company_access;")
    op.execute("ALTER TABLE asset_user_company_access RENAME COLUMN holder_id TO asset_user_id;")

    # --- Columns ---
    op.execute("ALTER TABLE asset_user RENAME COLUMN holder_type TO asset_user_type;")
    op.execute("ALTER TABLE asset RENAME COLUMN current_holder_id TO current_asset_user_id;")
    op.execute("ALTER TABLE asset_event RENAME COLUMN from_holder_id TO from_asset_user_id;")
    op.execute("ALTER TABLE asset_event RENAME COLUMN to_holder_id TO to_asset_user_id;")
    op.execute("ALTER TABLE asset_event RENAME COLUMN from_holder_name_snapshot TO from_asset_user_name_snapshot;")
    op.execute("ALTER TABLE asset_event RENAME COLUMN to_holder_name_snapshot TO to_asset_user_name_snapshot;")
    op.execute("ALTER TABLE pending_asset RENAME COLUMN initial_holder_id TO initial_asset_user_id;")

    # --- Data: the role value itself ---
    op.execute("UPDATE asset_user SET role = 'ASSET_USER' WHERE role = 'HOLDER';")

    # --- Named constraints/indexes -- drop the old (value-list unchanged
    # for asset_user_type; only the role value list and every name change) ---
    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_holder_holder_type;")
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_asset_user_asset_user_type
        CHECK (asset_user_type IN ('EMPLOYEE', 'STORE', 'INSTALLED', 'IT_STOCK'));
    """)
    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_holder_role;")
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_asset_user_role
        CHECK (role IN ('ADMIN', 'IT_TEAM', 'VIEWER', 'ASSET_USER'));
    """)
    op.execute("ALTER INDEX IF EXISTS ux_holder_company_email_ci RENAME TO ux_asset_user_company_email_ci;")
    op.execute("ALTER INDEX IF EXISTS ix_asset_current_holder_id_active RENAME TO ix_asset_current_asset_user_id_active;")


def downgrade() -> None:
    op.execute("ALTER INDEX IF EXISTS ix_asset_current_asset_user_id_active RENAME TO ix_asset_current_holder_id_active;")
    op.execute("ALTER INDEX IF EXISTS ux_asset_user_company_email_ci RENAME TO ux_holder_company_email_ci;")
    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_asset_user_role;")
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_holder_role
        CHECK (role IN ('ADMIN', 'IT_TEAM', 'VIEWER', 'HOLDER'));
    """)
    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_asset_user_asset_user_type;")
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_holder_holder_type
        CHECK (asset_user_type IN ('EMPLOYEE', 'STORE', 'INSTALLED', 'IT_STOCK'));
    """)

    op.execute("UPDATE asset_user SET role = 'HOLDER' WHERE role = 'ASSET_USER';")

    op.execute("ALTER TABLE pending_asset RENAME COLUMN initial_asset_user_id TO initial_holder_id;")
    op.execute("ALTER TABLE asset_event RENAME COLUMN to_asset_user_name_snapshot TO to_holder_name_snapshot;")
    op.execute("ALTER TABLE asset_event RENAME COLUMN from_asset_user_name_snapshot TO from_holder_name_snapshot;")
    op.execute("ALTER TABLE asset_event RENAME COLUMN to_asset_user_id TO to_holder_id;")
    op.execute("ALTER TABLE asset_event RENAME COLUMN from_asset_user_id TO from_holder_id;")
    op.execute("ALTER TABLE asset RENAME COLUMN current_asset_user_id TO current_holder_id;")
    op.execute("ALTER TABLE asset_user RENAME COLUMN asset_user_type TO holder_type;")

    op.execute("ALTER TABLE asset_user_company_access RENAME COLUMN asset_user_id TO holder_id;")
    op.execute("ALTER TABLE asset_user_company_access RENAME TO holder_company_access;")
    op.execute("ALTER TABLE asset_user RENAME TO holder;")
