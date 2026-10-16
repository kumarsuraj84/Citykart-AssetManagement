"""Security AU-06: server-side session records and refresh-token reuse detection.

Every sign-in opens one `auth_session` row (a phone and a PC are two rows). Its refresh token carries the row id
(`sid`) and a random token id (`jti`); the row keeps only sha256(jti) of the ONE token that may be used next.

A renewal (`renew`) is accepted exactly once per token: one atomic `UPDATE ... WHERE current_jti_hash = :h`
swaps in the new token's hash, so of two renewals racing with the same token exactly one wins (the database row
lock decides). The replaced hash stays as `previous_jti_hash` for `REFRESH_REUSE_GRACE_SECONDS`:

- the replaced token arriving again inside that window is a DUPLICATE -- several tabs of one browser share one
  cookie and each renews by itself. It gets a new access token only, never a new cookie (it must not overwrite
  the winner's newer cookie);
- any other old, unknown or revoked token is REUSE -- someone holds a copy of a token that was already used.
  Every session of that person ends (token_version goes up atomically) and a SECURITY row says so.

No token or token id is stored, logged or put in an audit row: only hashes, and only here."""
from __future__ import annotations

import enum
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.auth.models import AuthSession
from app.core.config import settings
from app.core.security import create_refresh_token, end_all_sessions, new_token_id, token_version_of

# Session rows this long past their expiry are deleted by the daily retention job.
EXPIRED_SESSION_KEEP_DAYS = 30


def hash_token_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _legacy_key(payload: dict, raw_token: str) -> str:
    """A pre-AU-06 token has no session id. Its jti (or, older still, the whole signed token) identifies it --
    stored only as a hash."""
    jti = payload.get("jti")
    return hash_token_id("legacy:" + (jti if isinstance(jti, str) and jti else raw_token))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _grace() -> timedelta:
    return timedelta(seconds=max(0, int(settings.refresh_reuse_grace_seconds or 0)))


def _lifetime() -> timedelta:
    return timedelta(hours=settings.jwt_refresh_hours)


async def open_session(session, asset_user) -> str:
    """A new session record for a sign-in (or a password change on this device); returns its refresh token.
    The caller commits."""
    now, jti = _now(), new_token_id()
    sid = (await session.execute(
        insert(AuthSession).values(asset_user_id=asset_user.id, created_at=now, last_used_at=now,
                                   expires_at=now + _lifetime(), current_jti_hash=hash_token_id(jti))
        .returning(AuthSession.id)
    )).scalar_one()
    return create_refresh_token(asset_user.id, asset_user.token_version or 0, sid=sid, jti=jti)


async def revoke_open_sessions(session, asset_user_id: int, reason: str) -> int:
    """Marks every open session record of the person revoked (the caller commits). token_version is what really
    ends the tokens; this keeps the records truthful."""
    result = await session.execute(
        update(AuthSession)
        .where(AuthSession.asset_user_id == asset_user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=_now(), revoked_reason=(reason or "ended")[:40])
        .execution_options(synchronize_session=False)
    )
    return result.rowcount or 0


class Outcome(enum.Enum):
    ROTATED = "rotated"        # the current token: a new refresh token was issued
    DUPLICATE = "duplicate"    # the just-replaced token inside the grace window: access token only
    REUSE = "reuse"            # an old / unknown / revoked token: every session of the person was ended
    ENDED = "ended"            # the sessions were already ended (sign-out, password or access change)
    EXPIRED = "expired"        # the session ran out


@dataclass
class Renewal:
    outcome: Outcome
    session_id: int | None = None
    refresh_token: str | None = None
    legacy: bool = False


async def _current_version(session, asset_user_id: int) -> int | None:
    from app.asset_users.models import AssetUser
    return (await session.execute(
        select(AssetUser.token_version).where(AssetUser.id == asset_user_id)
    )).scalar_one_or_none()


async def _judge(session, asset_user, payload: dict, row: AuthSession | None, presented: str, now) -> Outcome:
    """The presented token was not the current one of its session: duplicate, reuse, ended or expired."""
    # A sign-out / password / access change that committed while this request was running is not theft.
    if (await _current_version(session, asset_user.id)) != token_version_of(payload):
        return Outcome.ENDED
    if row is None or row.asset_user_id != asset_user.id or row.revoked_at is not None:
        return Outcome.REUSE
    if row.expires_at <= now:
        return Outcome.EXPIRED
    if (_grace() > timedelta(0) and row.previous_jti_hash == presented
            and row.previous_valid_until is not None and row.previous_valid_until > now):
        return Outcome.DUPLICATE
    return Outcome.REUSE


async def renew(session, asset_user, payload: dict, raw_token: str) -> Renewal:
    """Decides one renewal of an already verified, current-version refresh token. Commits (the request's own
    transaction is finished when this returns, so the caller's audit write needs no second connection)."""
    now, new_jti = _now(), new_token_id()
    new_hash = hash_token_id(new_jti)
    sid = payload.get("sid")
    legacy = sid is None
    if legacy:
        presented = _legacy_key(payload, raw_token)
        # First use of a pre-AU-06 token: it becomes a session record. The unique key makes a second, parallel
        # first use wait for this one and then do nothing (it is judged below like any replaced token).
        sid = (await session.execute(
            pg_insert(AuthSession).values(
                asset_user_id=asset_user.id, created_at=now, last_used_at=now, expires_at=now + _lifetime(),
                current_jti_hash=new_hash, previous_jti_hash=presented, previous_valid_until=now + _grace(),
                legacy_token_hash=presented)
            .on_conflict_do_nothing(index_elements=[AuthSession.legacy_token_hash])
            .returning(AuthSession.id)
        )).scalar_one_or_none()
        if sid is None:
            row = (await session.execute(
                select(AuthSession).where(AuthSession.legacy_token_hash == presented)
                .execution_options(populate_existing=True)
            )).scalar_one_or_none()
            return await _finish(session, asset_user, payload, row, presented, now, legacy=True)
    else:
        if isinstance(sid, bool) or not isinstance(sid, int) or not isinstance(payload.get("jti"), str):
            return await _finish(session, asset_user, payload, None, "", now, legacy=False)
        presented = hash_token_id(payload["jti"])
        # The atomic accept-once: only the request whose token is still the current one changes the row. A
        # parallel request with the same token waits for this row lock, then finds the hash already replaced.
        rotated = (await session.execute(
            update(AuthSession)
            .where(AuthSession.id == sid, AuthSession.asset_user_id == asset_user.id,
                   AuthSession.current_jti_hash == presented, AuthSession.revoked_at.is_(None),
                   AuthSession.expires_at > now)
            .values(previous_jti_hash=AuthSession.current_jti_hash, previous_valid_until=now + _grace(),
                    current_jti_hash=new_hash, last_used_at=now, expires_at=now + _lifetime())
            .returning(AuthSession.id)
            .execution_options(synchronize_session=False)
        )).scalar_one_or_none()
        if rotated is None:
            row = (await session.execute(
                select(AuthSession).where(AuthSession.id == sid).execution_options(populate_existing=True)
            )).scalar_one_or_none()
            return await _finish(session, asset_user, payload, row, presented, now, legacy=False)
    await session.commit()
    token = create_refresh_token(asset_user.id, asset_user.token_version or 0, sid=sid, jti=new_jti)
    return Renewal(Outcome.ROTATED, session_id=sid, refresh_token=token, legacy=legacy)


async def _finish(session, asset_user, payload, row, presented, now, *, legacy: bool) -> Renewal:
    outcome = await _judge(session, asset_user, payload, row, presented, now)
    sid = row.id if row is not None else None
    # End this transaction first. A renewal that waited for a parallel winner keeps a lock on the session row until
    # its transaction ends (PostgreSQL locks the newest row version before re-checking the WHERE). Everything that
    # ends sessions locks asset_user first and the session rows second; taking asset_user while still holding a
    # session row would be the opposite order (a deadlock with a parallel sign-out). Nothing was changed here, so
    # this commit only releases. (Commit, not rollback: a rollback would expire the loaded objects.)
    await session.commit()
    if outcome is Outcome.REUSE:
        # Only if nobody ended the sessions in the meantime (then it is simply ENDED, and not counted twice).
        ended = await end_all_sessions(session, asset_user, reason="refresh token reuse",
                                       only_if_version=token_version_of(payload))
        if ended is None:
            outcome = Outcome.ENDED
    await session.commit()
    return Renewal(outcome, session_id=sid, legacy=legacy)


async def purge_expired_sessions(session, now: datetime | None = None, days: int = EXPIRED_SESSION_KEEP_DAYS) -> int:
    """Deletes session records that ran out more than `days` ago (not business records). The caller commits."""
    cutoff = (now or _now()) - timedelta(days=days)
    return (await session.execute(delete(AuthSession).where(AuthSession.expires_at < cutoff))).rowcount or 0
