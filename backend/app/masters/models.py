from sqlalchemy import BigInteger, ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin, SoftDeleteMixin


class Company(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "company"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))


class Location(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "location"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(500))


class Department(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "department"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)


class CostCenter(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "cost_center"
    __table_args__ = (UniqueConstraint("company_id", "code"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))


class AssetCategory(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "asset_category"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))


class AssetSubcategory(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "asset_subcategory"
    __table_args__ = (UniqueConstraint("category_id", "code"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))


class Brand(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "brand"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))


class Vendor(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "vendor"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    gstin: Mapped[str | None] = mapped_column(String(20))
    contact_name: Mapped[str | None] = mapped_column(String(200))
    contact_phone: Mapped[str | None] = mapped_column(String(30))
    contact_email: Mapped[str | None] = mapped_column(String(200))


FIELD_TYPES = ("text", "number", "date", "dropdown", "checkbox")


class CustomField(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "custom_field"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    field_key: Mapped[str] = mapped_column(String(100), unique=True)
    label: Mapped[str] = mapped_column(String(200))
    field_type: Mapped[str] = mapped_column(String(20))  # one of FIELD_TYPES above
    options: Mapped[dict | None] = mapped_column(JSON)
    is_required: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(default=0)
    # AM-05: NULL = GLOBAL (applies to every company's assets, the only meaning
    # every pre-AM-05 row has and keeps unchanged); a real company id = applies
    # only to that company's assets. See app/assets/custom_field_values.py for
    # how "applicable" is computed, and app/masters/router.py for why this can
    # only be changed while no asset yet holds a value for this field_key.
    company_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("company.id"))
