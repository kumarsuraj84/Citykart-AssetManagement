from datetime import datetime
from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin, SoftDeleteMixin

ASSET_USER_TYPES = ("EMPLOYEE", "STORE", "INSTALLED", "STOCK_POINT")
ROLES = ("ADMIN", "OPERATOR", "VIEWER", "SELF_SERVICE")
ASSET_DOMAINS = ("IT", "NON_IT")
# primary_asset_domain: a login-enabled asset_user's own default reporting scope.
PRIMARY_ASSET_DOMAINS = ("IT", "NON_IT", "ALL")
# allowed_asset_domains: which domains an OPERATOR/VIEWER may actually work in
# (ADMIN and the Primary Owner are always unrestricted regardless of this value).
ALLOWED_ASSET_DOMAINS = ("IT", "NON_IT", "BOTH")


class AssetUser(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "asset_user"
    __table_args__ = (
        UniqueConstraint("company_id", "code"),
        # The Primary Owner ("Admin") is a standalone bootstrap account, not a
        # company-scoped custody entity -- it has no Company/Location/Code/Type
        # of its own. Every ordinary asset_user (EMPLOYEE/STORE/INSTALLED/
        # STOCK_POINT) still requires all four, enforced here rather than only
        # in application code so the exemption can never silently drift.
        CheckConstraint(
            "is_primary_owner OR (company_id IS NOT NULL AND location_id IS NOT NULL "
            "AND code IS NOT NULL AND asset_user_type IS NOT NULL)",
            name="ck_asset_user_ordinary_fields_required",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("company.id"))
    code: Mapped[str | None] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    asset_user_type: Mapped[str | None] = mapped_column(String(20))
    location_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("location.id"))
    department_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("department.id"))
    email: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(30))

    password_hash: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="SELF_SERVICE")
    # Fixed, not a role value: a Primary Owner has unconditional full access
    # regardless of role/company/domain scoping. Never settable through the
    # ordinary Add/Edit Asset User form -- only by an existing Primary Owner,
    # through a dedicated protected action. Exactly one is seeded by migration
    # c9a1b3d7e5f2 (name "Admin"); the system refuses to remove the last one.
    is_primary_owner: Mapped[bool] = mapped_column(default=False)
    # Formalizes what was already true implicitly (password_hash IS NOT NULL):
    # STORE/INSTALLED/STOCK_POINT records normally stay False forever and are
    # never asked for a password.
    login_enabled: Mapped[bool] = mapped_column(default=False)
    primary_asset_domain: Mapped[str | None] = mapped_column(String(10))
    allowed_asset_domains: Mapped[str | None] = mapped_column(String(10))
    must_change_password: Mapped[bool] = mapped_column(default=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AssetUserCompanyAccess(Base):
    __tablename__ = "asset_user_company_access"
    asset_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_user.id"), primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"), primary_key=True)
