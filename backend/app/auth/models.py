from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AuthSession(Base):
    """Security AU-06: one row per sign-in (a person signed in on a phone and on a PC has two rows), so the server
    knows which refresh token of that sign-in is the current one and can recognise an old one coming back.

    Only SHA-256 hashes of token ids are stored -- never a token or a token id. A technical table (not a business
    record): rows long past their expiry are removed by the daily retention job (app.observability.retention)."""
    __tablename__ = "auth_session"
    __table_args__ = (
        Index("ix_auth_session_asset_user_id", "asset_user_id"),
        Index("ix_auth_session_expires_at", "expires_at"),
        UniqueConstraint("legacy_token_hash", name="uq_auth_session_legacy_token_hash"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    asset_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Sliding, like the refresh cookie itself: every renewal moves it to now + JWT_REFRESH_HOURS.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(40))
    # sha256(jti) of the one refresh token of this sign-in that may be used next.
    current_jti_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # sha256 of the token it replaced, taken as a harmless duplicate until previous_valid_until (the grace window).
    previous_jti_hash: Mapped[str | None] = mapped_column(String(64))
    previous_valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # A refresh token from before this release has no session id: the hash of that token, so it upgrades once.
    legacy_token_hash: Mapped[str | None] = mapped_column(String(64))
