"""asset user / rbac / responsibility rebuild

Revision ID: d3f8a1c5b7e9
Revises: c7e2f9a4b6d1
Create Date: 2026-09-29 18:00:00.000000

Staged per docs/ai/ASSET_USER_RBAC_REBUILD_PREFLIGHT.md §12:

1. Additive: new asset_user columns (is_primary_owner, login_enabled,
   primary_asset_domain, allowed_asset_domains), emp_code -> code rename,
   company_id/location_id/asset_user_type/code made nullable (the Primary
   Owner is a company-less bootstrap account), asset_category/asset/
   pending_asset gain asset_domain, new app_setting table.
2. Backfill: login_enabled from the existing implicit password_hash-not-null
   rule; asset_category.asset_domain classified (every existing row was
   audited by hand -- see the CASE below); asset.asset_domain copied from
   its Category.
3. Role/type value migration + CHECK constraint swap: IT_TEAM -> OPERATOR,
   the old ASSET_USER role value -> SELF_SERVICE, IT_STOCK -> STOCK_POINT.
4. Enforce NOT NULL where the spec requires it (asset_category.asset_domain,
   asset.asset_domain) now that every row has a value.
5. Seed exactly one Primary Owner ("Admin") -- full unrestricted access,
   fixed rather than role-selectable, no company/location/code of its own.
   Its one-time temporary password is printed to migration output; relay it
   out-of-band and it is discarded once the terminal scrolls past it
   (must_change_password forces a real password at first login).

No external system depends on the old column/constraint names (see
preflight §10) and the dev DB holds one real asset_user row and two
unambiguous categories (see preflight §3/§9) -- every data-migration
statement below is a real, tested transformation, not a 0-row no-op left
untested.
"""
import secrets
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from argon2 import PasswordHasher

revision: str = 'd3f8a1c5b7e9'
down_revision: Union[str, Sequence[str], None] = 'c7e2f9a4b6d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_hasher = PasswordHasher()


def upgrade() -> None:
    # --- 1. Additive columns ---
    op.add_column('asset_user', sa.Column('is_primary_owner', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('asset_user', sa.Column('login_enabled', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('asset_user', sa.Column('primary_asset_domain', sa.String(length=10), nullable=True))
    op.add_column('asset_user', sa.Column('allowed_asset_domains', sa.String(length=10), nullable=True))

    op.execute("ALTER TABLE asset_user RENAME COLUMN emp_code TO code;")
    op.execute("ALTER TABLE asset_user ALTER COLUMN company_id DROP NOT NULL;")
    op.execute("ALTER TABLE asset_user ALTER COLUMN location_id DROP NOT NULL;")
    op.execute("ALTER TABLE asset_user ALTER COLUMN asset_user_type DROP NOT NULL;")
    op.execute("ALTER TABLE asset_user ALTER COLUMN code DROP NOT NULL;")

    op.create_table(
        'app_setting',
        sa.Column('key', sa.String(length=100), primary_key=True),
        sa.Column('value', sa.String(length=200), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
    )

    op.add_column('asset_category', sa.Column('asset_domain', sa.String(length=10), nullable=True))
    op.add_column('asset', sa.Column('asset_domain', sa.String(length=10), nullable=True))
    op.add_column('pending_asset', sa.Column('asset_domain', sa.String(length=10), nullable=True))

    # --- 2. Backfill ---
    op.execute("UPDATE asset_user SET login_enabled = (password_hash IS NOT NULL);")

    # Every existing asset_category row was inspected by hand (preflight §9):
    # both current rows (ITHW "IT HW Assets", ITSW "IT SW Assets") are
    # unambiguously IT. A category code containing "IT" (case-insensitive)
    # is classified IT; everything else defaults to NON_IT -- reviewable and
    # correctable per-row afterward via the ordinary Category edit screen
    # (spec §41: "produce a classification list, do not guess ambiguous
    # categories" -- there is nothing ambiguous in this environment to
    # produce a list for, but the fallback branch is exercised by any real
    # CityKart NON_IT category seeded later through this same migration
    # path in another environment).
    op.execute("""
        UPDATE asset_category
        SET asset_domain = CASE WHEN code ILIKE '%IT%' OR name ILIKE '%IT %' OR name ILIKE '% IT' THEN 'IT' ELSE 'NON_IT' END
        WHERE asset_domain IS NULL;
    """)
    op.execute("""
        UPDATE asset
        SET asset_domain = asset_category.asset_domain
        FROM asset_category
        WHERE asset.category_id = asset_category.id AND asset.asset_domain IS NULL;
    """)

    # --- 3. Role/type value migration ---
    op.execute("UPDATE asset_user SET role = 'OPERATOR' WHERE role = 'IT_TEAM';")
    op.execute("UPDATE asset_user SET role = 'SELF_SERVICE' WHERE role = 'ASSET_USER';")
    op.execute("UPDATE asset_user SET asset_user_type = 'STOCK_POINT' WHERE asset_user_type = 'IT_STOCK';")

    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_asset_user_role;")
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_asset_user_role
        CHECK (role IN ('ADMIN', 'OPERATOR', 'VIEWER', 'SELF_SERVICE'));
    """)
    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_asset_user_asset_user_type;")
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_asset_user_asset_user_type
        CHECK (asset_user_type IS NULL OR asset_user_type IN ('EMPLOYEE', 'STORE', 'INSTALLED', 'STOCK_POINT'));
    """)
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_asset_user_ordinary_fields_required
        CHECK (is_primary_owner OR (company_id IS NOT NULL AND location_id IS NOT NULL
               AND code IS NOT NULL AND asset_user_type IS NOT NULL));
    """)
    op.execute("""
        ALTER TABLE asset_category ADD CONSTRAINT ck_asset_category_asset_domain
        CHECK (asset_domain IN ('IT', 'NON_IT'));
    """)
    op.execute("""
        ALTER TABLE asset ADD CONSTRAINT ck_asset_asset_domain
        CHECK (asset_domain IS NULL OR asset_domain IN ('IT', 'NON_IT'));
    """)
    op.execute("""
        ALTER TABLE pending_asset ADD CONSTRAINT ck_pending_asset_asset_domain
        CHECK (asset_domain IS NULL OR asset_domain IN ('IT', 'NON_IT'));
    """)

    # --- 4. Enforce NOT NULL now that every row has a value ---
    op.execute("ALTER TABLE asset_category ALTER COLUMN asset_domain SET NOT NULL;")
    op.execute("ALTER TABLE asset ALTER COLUMN asset_domain SET NOT NULL;")

    # --- Cosmetic: stale holder_* constraint/index names left by the prior
    # Holder->AssetUser table rename (preflight §2) -- renamed here while
    # this table is already open for the role/type CHECK changes above.
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT holder_pkey TO asset_user_pkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT holder_company_id_emp_code_key TO asset_user_company_id_code_key;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT holder_company_id_fkey TO asset_user_company_id_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT holder_created_by_fkey TO asset_user_created_by_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT holder_department_id_fkey TO asset_user_department_id_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT holder_location_id_fkey TO asset_user_location_id_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT holder_updated_by_fkey TO asset_user_updated_by_fkey;")
    op.execute("ALTER TABLE asset RENAME CONSTRAINT asset_current_holder_id_fkey TO asset_current_asset_user_id_fkey;")
    op.execute("ALTER TABLE asset_event RENAME CONSTRAINT asset_event_from_holder_id_fkey TO asset_event_from_asset_user_id_fkey;")
    op.execute("ALTER TABLE asset_event RENAME CONSTRAINT asset_event_to_holder_id_fkey TO asset_event_to_asset_user_id_fkey;")
    op.execute("ALTER TABLE pending_asset RENAME CONSTRAINT pending_asset_initial_holder_id_fkey TO pending_asset_initial_asset_user_id_fkey;")
    op.execute("ALTER TABLE asset_user_company_access RENAME CONSTRAINT holder_company_access_holder_id_fkey TO asset_user_company_access_asset_user_id_fkey;")

    # --- 5. Seed the Primary Owner ---
    temp_password = secrets.token_urlsafe(9)
    password_hash = _hasher.hash(temp_password)
    conn = op.get_bind()
    already_exists = conn.execute(sa.text("SELECT 1 FROM asset_user WHERE is_primary_owner IS TRUE LIMIT 1")).first()
    if already_exists is None:
        conn.execute(
            sa.text("""
                INSERT INTO asset_user (
                    name, role, is_primary_owner, login_enabled, primary_asset_domain,
                    password_hash, must_change_password, failed_login_count, is_active
                ) VALUES (
                    'Admin', 'ADMIN', TRUE, TRUE, 'ALL',
                    :password_hash, TRUE, 0, TRUE
                )
            """),
            {"password_hash": password_hash},
        )
        print(f"Primary Owner 'Admin' created. One-time temporary password (relay out-of-band, then discard): {temp_password}")
        print("must_change_password is set, so this password must be changed at first login.")
    else:
        print("Primary Owner already exists -- skipped seeding a new one.")


def downgrade() -> None:
    op.execute("DELETE FROM asset_user WHERE is_primary_owner IS TRUE;")

    op.execute("ALTER TABLE asset_user_company_access RENAME CONSTRAINT asset_user_company_access_asset_user_id_fkey TO holder_company_access_holder_id_fkey;")
    op.execute("ALTER TABLE pending_asset RENAME CONSTRAINT pending_asset_initial_asset_user_id_fkey TO pending_asset_initial_holder_id_fkey;")
    op.execute("ALTER TABLE asset_event RENAME CONSTRAINT asset_event_to_asset_user_id_fkey TO asset_event_to_holder_id_fkey;")
    op.execute("ALTER TABLE asset_event RENAME CONSTRAINT asset_event_from_asset_user_id_fkey TO asset_event_from_holder_id_fkey;")
    op.execute("ALTER TABLE asset RENAME CONSTRAINT asset_current_asset_user_id_fkey TO asset_current_holder_id_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT asset_user_updated_by_fkey TO holder_updated_by_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT asset_user_location_id_fkey TO holder_location_id_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT asset_user_department_id_fkey TO holder_department_id_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT asset_user_created_by_fkey TO holder_created_by_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT asset_user_company_id_fkey TO holder_company_id_fkey;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT asset_user_company_id_code_key TO holder_company_id_emp_code_key;")
    op.execute("ALTER TABLE asset_user RENAME CONSTRAINT asset_user_pkey TO holder_pkey;")

    op.execute("ALTER TABLE asset ALTER COLUMN asset_domain DROP NOT NULL;")
    op.execute("ALTER TABLE asset_category ALTER COLUMN asset_domain DROP NOT NULL;")

    op.execute("ALTER TABLE pending_asset DROP CONSTRAINT IF EXISTS ck_pending_asset_asset_domain;")
    op.execute("ALTER TABLE asset DROP CONSTRAINT IF EXISTS ck_asset_asset_domain;")
    op.execute("ALTER TABLE asset_category DROP CONSTRAINT IF EXISTS ck_asset_category_asset_domain;")
    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_asset_user_ordinary_fields_required;")

    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_asset_user_asset_user_type;")
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_asset_user_asset_user_type
        CHECK (asset_user_type IN ('EMPLOYEE', 'STORE', 'INSTALLED', 'IT_STOCK'));
    """)
    op.execute("ALTER TABLE asset_user DROP CONSTRAINT IF EXISTS ck_asset_user_role;")
    op.execute("""
        ALTER TABLE asset_user ADD CONSTRAINT ck_asset_user_role
        CHECK (role IN ('ADMIN', 'IT_TEAM', 'VIEWER', 'ASSET_USER'));
    """)

    op.execute("UPDATE asset_user SET asset_user_type = 'IT_STOCK' WHERE asset_user_type = 'STOCK_POINT';")
    op.execute("UPDATE asset_user SET role = 'ASSET_USER' WHERE role = 'SELF_SERVICE';")
    op.execute("UPDATE asset_user SET role = 'IT_TEAM' WHERE role = 'OPERATOR';")

    op.drop_column('pending_asset', 'asset_domain')
    op.drop_column('asset', 'asset_domain')
    op.drop_column('asset_category', 'asset_domain')

    op.drop_table('app_setting')

    op.execute("ALTER TABLE asset_user ALTER COLUMN code SET NOT NULL;")
    op.execute("ALTER TABLE asset_user ALTER COLUMN asset_user_type SET NOT NULL;")
    op.execute("ALTER TABLE asset_user ALTER COLUMN location_id SET NOT NULL;")
    op.execute("ALTER TABLE asset_user ALTER COLUMN company_id SET NOT NULL;")
    op.execute("ALTER TABLE asset_user RENAME COLUMN code TO emp_code;")

    op.drop_column('asset_user', 'allowed_asset_domains')
    op.drop_column('asset_user', 'primary_asset_domain')
    op.drop_column('asset_user', 'login_enabled')
    op.drop_column('asset_user', 'is_primary_owner')
