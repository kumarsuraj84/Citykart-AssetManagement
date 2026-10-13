"""CKAM's own copy of the ERP data it needs (read-only mirror of the warehouse).

The ERP is loaded into the warehouse daily and CKAM only ever reads it. Instead of asking the
warehouse on every screen, a sync (app.erp.sync) copies the fixed-asset purchase orders, the
vendors and the items they use into these tables. Rows are never deleted: one the ERP stopped
returning is marked `is_present = false`, and `first_seen_at` / `last_seen_at` / `row_hash` say
when it appeared, was last seen, and whether it changed. Every ERP code is the pair
(company_code, code): vendor codes repeat across the two companies and mean different vendors."""
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Index, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ErpSyncRun(Base):
    __tablename__ = "erp_sync_run"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20))            # running | success | failed | skipped
    trigger: Mapped[str] = mapped_column(String(20))           # schedule | manual | startup
    # When the warehouse said it last loaded the data this run copied (meta.v_freshness).
    source_stamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    message: Mapped[str | None] = mapped_column(Text)
    po_lines_new: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    po_lines_changed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    po_lines_gone: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    vendors: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    items: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class _Seen:
    """Bookkeeping every copied row carries."""
    row_hash: Mapped[str] = mapped_column(String(64))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_present: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class ErpPoLineCopy(Base, _Seen):
    __tablename__ = "erp_po_line"
    __table_args__ = (
        Index("ix_erp_po_line_po", "po_code"),
        Index("ix_erp_po_line_supplier", "company_code", "supplier_code"),
    )

    company_code: Mapped[str] = mapped_column(String(20), primary_key=True)
    po_line_key: Mapped[str] = mapped_column(String(60), primary_key=True)
    po_code: Mapped[int] = mapped_column(BigInteger)
    po_number: Mapped[str] = mapped_column(String(100))
    po_date: Mapped[date] = mapped_column(Date)
    line_status: Mapped[str] = mapped_column(String(20))       # OPEN | CLOSED | CANCELLED (a PO's status is derived from its lines)
    delivery_location: Mapped[str | None] = mapped_column(String(200))
    delivery_site_kind: Mapped[str | None] = mapped_column(String(30))
    supplier_code: Mapped[str] = mapped_column(String(50))
    supplier_name: Mapped[str | None] = mapped_column(String(300))
    icode: Mapped[str | None] = mapped_column(String(50))
    item_description: Mapped[str | None] = mapped_column(String(600))
    group_code: Mapped[str | None] = mapped_column(String(200))
    hsn: Mapped[str | None] = mapped_column(String(30))
    unit: Mapped[str | None] = mapped_column(String(30))
    ordqty: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    rate: Mapped[float] = mapped_column(Numeric(14, 4), default=0)
    tax_percent: Mapped[float | None] = mapped_column(Numeric(6, 2))
    line_netamt: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    rcqty: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    cnlqty: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    hdr_netamt: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    hdr_chgamt: Mapped[float] = mapped_column(Numeric(16, 2), default=0)
    erp_loaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ErpVendorCopy(Base, _Seen):
    __tablename__ = "erp_vendor"

    company_code: Mapped[str] = mapped_column(String(20), primary_key=True)
    vendor_code: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    gstin: Mapped[str | None] = mapped_column(String(30))
    city: Mapped[str | None] = mapped_column(String(100))
    is_extinct: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class ErpSiteCopy(Base, _Seen):
    """A site (store, warehouse, head office...) of one company's ERP. Site codes repeat across the two
    companies, so the key is (company_code, site_code). `short_name` is the location code people use (LAM, SPR2)."""
    __tablename__ = "erp_site"

    company_code: Mapped[str] = mapped_column(String(20), primary_key=True)
    site_code: Mapped[int] = mapped_column(Integer, primary_key=True)
    short_name: Mapped[str | None] = mapped_column(String(100))
    site_name: Mapped[str | None] = mapped_column(String(300))
    store_name: Mapped[str | None] = mapped_column(String(300))
    site_kind: Mapped[str | None] = mapped_column(String(30))
    store_type: Mapped[str | None] = mapped_column(String(50))
    store_status: Mapped[str | None] = mapped_column(String(30))
    is_active_site: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    state: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(100))


class ErpItemCopy(Base, _Seen):
    """An ERP item code (item codes never repeat across the companies, so the code is the key)."""
    __tablename__ = "erp_item"

    icode: Mapped[str] = mapped_column(String(50), primary_key=True)
    company_code: Mapped[str] = mapped_column(String(20))
    article_name: Mapped[str | None] = mapped_column(String(300))
    section: Mapped[str | None] = mapped_column(String(200))
    department: Mapped[str | None] = mapped_column(String(200))
    division: Mapped[str | None] = mapped_column(String(100))
    cat1: Mapped[str | None] = mapped_column(String(300))
    cat2: Mapped[str | None] = mapped_column(String(300))
    cat3: Mapped[str | None] = mapped_column(String(300))
    cat4: Mapped[str | None] = mapped_column(String(300))
    cat5: Mapped[str | None] = mapped_column(String(300))
    cat6: Mapped[str | None] = mapped_column(String(300))
    hsn: Mapped[str | None] = mapped_column(String(30))
    unit: Mapped[str | None] = mapped_column(String(30))
