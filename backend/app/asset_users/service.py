from __future__ import annotations

import asyncio
import secrets
from sqlalchemy import delete, func, select
from app.assets.models import Asset
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import end_all_sessions, hash_password
from app.asset_users.models import AssetUser, AssetUserCompanyAccess

# argon2 hashes of temporary passwords issued in bulk: at most this many at the same time (each uses ~64 MB).
HASH_WORKERS = 4


class AssetUserService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(
        self,
        asset_user_type: str | None = None,
        allowed_company_ids: list[int] | None = None,
        requested_company_id: int | None = None,
    ):
        """`allowed_company_ids` is the caller's server-side scope from
        `scoped_company_ids()`: None means unrestricted (ADMIN), a list means
        the caller may only ever see those companies. When restricted, the
        scope is enforced unconditionally and `requested_company_id` is only
        honored if it falls inside that scope -- a foreign company_id passed
        by a non-ADMIN caller is silently ignored rather than followed, so a
        non-ADMIN can never enumerate another company's asset_users regardless of
        query params. An unrestricted (ADMIN) caller's `requested_company_id`
        is applied as-is.
        """
        stmt = select(AssetUser).where(AssetUser.is_active.is_(True))
        if allowed_company_ids is not None:
            if requested_company_id is not None and requested_company_id in allowed_company_ids:
                stmt = stmt.where(AssetUser.company_id == requested_company_id)
            else:
                stmt = stmt.where(AssetUser.company_id.in_(allowed_company_ids))
        elif requested_company_id is not None:
            stmt = stmt.where(AssetUser.company_id == requested_company_id)
        if asset_user_type is not None:
            stmt = stmt.where(AssetUser.asset_user_type == asset_user_type)
        return (await self.session.execute(stmt)).scalars().all()

    async def get(self, asset_user_id: int) -> AssetUser | None:
        return await self.session.get(AssetUser, asset_user_id)

    async def create(self, data: dict, actor_id: int, commit: bool = True) -> AssetUser:
        """`commit=False` (S7): only flushes, so the caller can add more in the same transaction (a store's
        rooms) and commit once."""
        asset_user = AssetUser(**data, created_by=actor_id, updated_by=actor_id)
        self.session.add(asset_user)
        if not commit:
            await self.session.flush()
            return asset_user
        await self.session.commit()
        await self.session.refresh(asset_user)
        return asset_user

    async def update(self, asset_user_id: int, data: dict, actor_id: int, commit: bool = True) -> AssetUser | None:
        asset_user = await self.get(asset_user_id)
        if asset_user is None:
            return None
        for key, value in data.items():
            setattr(asset_user, key, value)
        asset_user.updated_by = actor_id
        if not commit:
            await self.session.flush()
            return asset_user
        await self.session.commit()
        await self.session.refresh(asset_user)
        return asset_user

    async def deactivate(self, asset_user_id: int, actor_id: int) -> bool:
        asset_user = await self.get(asset_user_id)
        if asset_user is None:
            return False
        if asset_user.is_primary_owner and await self.count_active_primary_owners() <= 1:
            raise ValueError("The last remaining head-office admin cannot be deactivated.")
        # S0.6: someone (or some place) still holding assets cannot be
        # deactivated -- those assets would be left with an inactive holder that
        # no screen can move them away from cleanly. Assets that are gone
        # (disposed, sold, scrapped) or reported lost do not count.
        held = (await self.session.execute(
            select(func.count()).select_from(Asset).where(
                Asset.current_asset_user_id == asset_user.id,
                Asset.deleted_at.is_(None),
                Asset.status.notin_(("DISPOSED", "SOLD", "SCRAPPED", "LOST")),
            )
        )).scalar_one()
        if held:
            raise ValueError(
                f"{asset_user.name} still holds {held} asset{'s' if held != 1 else ''}. "
                "Move them to someone else or back to a stock room first, then deactivate."
            )
        asset_user.is_active = False
        # security AU-05: a deactivated account's tokens die with it (OBS-TV: atomic)
        await end_all_sessions(self.session, asset_user, reason="deactivated")
        asset_user.updated_by = actor_id
        await self.session.commit()
        return True

    async def reset_password(self, asset_user_id: int, actor_id: int) -> str | None:
        asset_user = await self.session.get(AssetUser, asset_user_id)
        if asset_user is None:
            return None
        temp_password = secrets.token_urlsafe(9)
        asset_user.password_hash = hash_password(temp_password)
        asset_user.must_change_password = True
        asset_user.failed_login_count = 0
        asset_user.locked_until = None
        # security AU-05: whoever was signed in with the old password is out (OBS-TV: atomic)
        await end_all_sessions(self.session, asset_user, reason="password reset")
        asset_user.updated_by = actor_id
        await self.session.commit()
        return temp_password

    async def issue_passwords(self, users: list[AssetUser], actor_id: int) -> list[tuple[AssetUser, str]]:
        """S5: a fresh temporary password for each account (must be changed at the next sign-in), exactly as
        Reset Password does for one. The passwords exist only in the returned list -- never logged, stored
        (only their hash) or put in any message. Hashing is slow on purpose (argon2), so it runs on a few
        worker threads instead of the event loop. Commits once for all of them."""
        limiter = asyncio.Semaphore(HASH_WORKERS)

        async def hashed(raw: str) -> str:
            async with limiter:
                return await asyncio.to_thread(hash_password, raw)

        temps = [secrets.token_urlsafe(9) for _ in users]
        hashes = await asyncio.gather(*(hashed(t) for t in temps))
        for user, password_hash in zip(users, hashes):
            user.password_hash = password_hash
            user.must_change_password = True
            user.failed_login_count = 0
            user.locked_until = None
            # security AU-05 (OBS-TV: atomic)
            await end_all_sessions(self.session, user, reason="password reset")
            user.updated_by = actor_id
        await self.session.commit()
        return list(zip(users, temps))

    async def count_active_primary_owners(self) -> int:
        stmt = select(AssetUser).where(AssetUser.is_active.is_(True), AssetUser.is_primary_owner.is_(True))
        return len((await self.session.execute(stmt)).scalars().all())

    async def set_primary_owner(self, asset_user_id: int, value: bool, actor_id: int) -> AssetUser | None:
        """Only reachable via require_primary_owner (an existing Primary Owner
        granting/revoking another). Revoking the last remaining Primary Owner
        is refused -- the system must always have at least one account with
        unconditional access, independent of ordinary role management."""
        asset_user = await self.session.get(AssetUser, asset_user_id)
        if asset_user is None:
            return None
        if not value and asset_user.is_primary_owner and await self.count_active_primary_owners() <= 1:
            raise ValueError("The last remaining head-office admin cannot be removed.")
        if asset_user.is_primary_owner and not value:
            # security AU-05: no live session keeps head-office rights (OBS-TV: atomic)
            await end_all_sessions(self.session, asset_user, reason="head-office rights removed")
        asset_user.is_primary_owner = value
        asset_user.updated_by = actor_id
        await self.session.commit()
        await self.session.refresh(asset_user)
        return asset_user

    async def set_company_access(self, asset_user_id: int, company_ids: list[int]) -> bool:
        asset_user = await self.session.get(AssetUser, asset_user_id)
        if asset_user is None:
            return False
        before = set((await self.session.execute(
            select(AssetUserCompanyAccess.company_id).where(AssetUserCompanyAccess.asset_user_id == asset_user_id)
        )).scalars().all())
        await self.session.execute(delete(AssetUserCompanyAccess).where(AssetUserCompanyAccess.asset_user_id == asset_user_id))
        for cid in company_ids:
            self.session.add(AssetUserCompanyAccess(asset_user_id=asset_user_id, company_id=cid))
        if before != set(company_ids):
            # security AU-05: company access changed -> sign in again (OBS-TV: atomic)
            await end_all_sessions(self.session, asset_user, reason="company access changed")
        await self.session.commit()
        return True

    async def get_company_access(self, asset_user_id: int) -> list[int] | None:
        """None means the asset_user itself doesn't exist (404); an empty list is
        a real, valid answer (no extra grants beyond their own home company)."""
        asset_user = await self.session.get(AssetUser, asset_user_id)
        if asset_user is None:
            return None
        rows = (await self.session.execute(
            select(AssetUserCompanyAccess.company_id).where(AssetUserCompanyAccess.asset_user_id == asset_user_id)
        )).scalars().all()
        return list(rows)
