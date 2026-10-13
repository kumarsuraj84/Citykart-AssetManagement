from datetime import datetime
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class AuditMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_user.id"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_user.id"))


class SoftDeleteMixin:
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AppSetting(Base):
    """UNUSED since S6 -- kept only because the `app_setting` table exists (migration d3f8a1c5b7e9) and
    tables are never dropped. Nothing reads or writes it: its two keys were never wired to any rule
    ("operator_can_manage_masters" was superseded by the S3a-1 capabilities in app.core.capabilities;
    "enforce_stock_install_point_uniqueness" was never enforced), and their reader module
    app/core/app_settings.py was removed in S6 because nothing imported it. Do not build on this table;
    a new setting needs its own deliberate design.

    Originally: a small ADMIN-editable key/value config store for business rules the Asset User/RBAC/
    Responsibility rebuild spec left conditional."""
    __tablename__ = "app_setting"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_user.id"))
