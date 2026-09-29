from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin, SoftDeleteMixin

ASSET_USER_TYPES = ("EMPLOYEE", "STORE", "INSTALLED", "IT_STOCK")
ROLES = ("ADMIN", "IT_TEAM", "VIEWER", "ASSET_USER")


class AssetUser(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "asset_user"
    __table_args__ = (UniqueConstraint("company_id", "emp_code"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    emp_code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    asset_user_type: Mapped[str] = mapped_column(String(20))
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("location.id"))
    department_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("department.id"))
    email: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(30))

    password_hash: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="ASSET_USER")
    must_change_password: Mapped[bool] = mapped_column(default=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AssetUserCompanyAccess(Base):
    __tablename__ = "asset_user_company_access"
    asset_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_user.id"), primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"), primary_key=True)
