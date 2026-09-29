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
    """A small ADMIN-editable key/value config store for the handful of
    business rules the Asset User/RBAC/Responsibility rebuild spec leaves
    conditional rather than absolute (e.g. "only enforce X once real data
    confirms the model"). Deliberately generic (string key -> string value,
    parsed by the reader) rather than a bespoke column per flag, so a new
    conditional rule never needs its own migration. See
    app/core/app_settings.py for the known keys and their safe defaults."""
    __tablename__ = "app_setting"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_user.id"))
