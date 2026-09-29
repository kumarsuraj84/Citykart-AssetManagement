from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.models import AppSetting

# Business rules the rebuild spec leaves conditional rather than absolute.
# Each ships with its spec-recommended safe default and can be changed by an
# ADMIN/Primary Owner without a migration or redeploy -- see
# docs/ai/ASSET_USER_RBAC_REBUILD_PREFLIGHT.md §16 for why these two, and
# only these two, became settings instead of hardcoded rules.
DEFAULTS = {
    # Spec §35: "ONLY enforce if current real/UAT data confirms this model."
    # No STOCK_POINT/INSTALLED rows exist yet to confirm it either way.
    "enforce_stock_install_point_uniqueness": "false",
    # Spec §48: "no security/master administration unless an existing
    # requirement proves otherwise."
    "operator_can_manage_masters": "false",
}


async def get_bool_setting(session: AsyncSession, key: str) -> bool:
    if key not in DEFAULTS:
        raise KeyError(f"unknown app setting: {key}")
    row = await session.get(AppSetting, key)
    raw = row.value if row is not None else DEFAULTS[key]
    return raw.strip().lower() in ("true", "1", "yes", "on")


async def set_bool_setting(session: AsyncSession, key: str, value: bool, actor_id: int) -> None:
    if key not in DEFAULTS:
        raise KeyError(f"unknown app setting: {key}")
    row = await session.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=str(value).lower(), updated_by=actor_id)
        session.add(row)
    else:
        row.value = str(value).lower()
        row.updated_by = actor_id
