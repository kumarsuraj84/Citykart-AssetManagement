from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base

EVENT_TYPES = ("PROCURED", "IMPORTED", "MOVED", "SENT_FOR_REPAIR", "RECEIVED_FROM_REPAIR",
               "DISPOSED", "SOLD", "SCRAPPED", "LOST", "FOUND", "CORRECTION")


class AssetEvent(Base):
    __tablename__ = "asset_event"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    asset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset.id"))
    event_type: Mapped[str] = mapped_column(String(30))
    event_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    from_holder_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("holder.id"))
    to_holder_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("holder.id"))
    status_after: Mapped[str] = mapped_column(String(20))
    remarks: Mapped[str | None] = mapped_column(String(1000))
    reference_no: Mapped[str | None] = mapped_column(String(100))
    recorded_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("holder.id"))
    # server_default rather than a bare NOT NULL column: callers record events with
    # event_date (when the custody change happened) but don't always know/set
    # recorded_at (when it was entered into the ledger) up front — e.g. the brief's
    # own test_asset_event_cannot_be_updated_or_deleted constructs an AssetEvent
    # without passing recorded_at at all. Defaulting to insert time here mirrors
    # AuditMixin.created_at's server_default=func.now() pattern used elsewhere.
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
