"""masters and holders

Revision ID: 62108649b9c8
Revises:
Create Date: 2026-09-23 07:17:32.875095

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '62108649b9c8'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# NOTE: AuditMixin's created_by/updated_by columns are FKs to holder.id, while
# holder itself FKs to company.id/location.id/department.id. That is a circular
# dependency between "holder" and each master table. Autogenerate cannot linearly
# order CREATE TABLE statements for a cycle (it even warns "unresolvable cycles
# between tables company, department, holder, location"), and naively emitting
# each table's created_by/updated_by FK inline would make company/department/
# location/asset_category/cost_center/custom_field/vendor/asset_subcategory
# reference a "holder" table that doesn't exist yet when they're created.
# Fix: create every table WITHOUT its created_by/updated_by -> holder.id FK,
# then create holder (which only needs already-existing company/location/
# department), then add the deferred created_by/updated_by FKs via ALTER TABLE.


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('company',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('department',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('location',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('address', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('asset_category',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('cost_center',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('company_id', sa.BigInteger(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'code')
    )
    op.create_table('custom_field',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('field_key', sa.String(length=100), nullable=False),
    sa.Column('label', sa.String(length=200), nullable=False),
    sa.Column('field_type', sa.String(length=20), nullable=False),
    sa.Column('options', sa.JSON(), nullable=True),
    sa.Column('is_required', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('field_key')
    )
    op.create_table('vendor',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('gstin', sa.String(length=20), nullable=True),
    sa.Column('contact_name', sa.String(length=200), nullable=True),
    sa.Column('contact_phone', sa.String(length=30), nullable=True),
    sa.Column('contact_email', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('asset_subcategory',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('category_id', sa.BigInteger(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['category_id'], ['asset_category.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('category_id', 'code')
    )
    op.create_table('holder',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('company_id', sa.BigInteger(), nullable=False),
    sa.Column('emp_code', sa.String(length=50), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('holder_type', sa.String(length=20), nullable=False),
    sa.Column('location_id', sa.BigInteger(), nullable=False),
    sa.Column('department_id', sa.BigInteger(), nullable=True),
    sa.Column('email', sa.String(length=200), nullable=True),
    sa.Column('phone', sa.String(length=30), nullable=True),
    sa.Column('password_hash', sa.String(length=200), nullable=True),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('must_change_password', sa.Boolean(), nullable=False),
    sa.Column('failed_login_count', sa.Integer(), nullable=False),
    sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], ),
    sa.ForeignKeyConstraint(['created_by'], ['holder.id'], ),
    sa.ForeignKeyConstraint(['department_id'], ['department.id'], ),
    sa.ForeignKeyConstraint(['location_id'], ['location.id'], ),
    sa.ForeignKeyConstraint(['updated_by'], ['holder.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'emp_code')
    )
    op.create_table('holder_company_access',
    sa.Column('holder_id', sa.BigInteger(), nullable=False),
    sa.Column('company_id', sa.BigInteger(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], ),
    sa.ForeignKeyConstraint(['holder_id'], ['holder.id'], ),
    sa.PrimaryKeyConstraint('holder_id', 'company_id')
    )

    # Deferred created_by/updated_by -> holder.id FKs for the tables created
    # above without them, now that "holder" exists (breaks the circular
    # dependency described above).
    for table in (
        'company', 'department', 'location', 'asset_category',
        'cost_center', 'custom_field', 'vendor', 'asset_subcategory',
    ):
        op.create_foreign_key(
            f'{table}_created_by_fkey', table, 'holder', ['created_by'], ['id'],
        )
        op.create_foreign_key(
            f'{table}_updated_by_fkey', table, 'holder', ['updated_by'], ['id'],
        )


def downgrade() -> None:
    """Downgrade schema."""
    for table in (
        'company', 'department', 'location', 'asset_category',
        'cost_center', 'custom_field', 'vendor', 'asset_subcategory',
    ):
        op.drop_constraint(f'{table}_updated_by_fkey', table, type_='foreignkey')
        op.drop_constraint(f'{table}_created_by_fkey', table, type_='foreignkey')

    op.drop_table('holder_company_access')
    op.drop_table('holder')
    op.drop_table('asset_subcategory')
    op.drop_table('vendor')
    op.drop_table('custom_field')
    op.drop_table('cost_center')
    op.drop_table('asset_category')
    op.drop_table('location')
    op.drop_table('department')
    op.drop_table('company')
