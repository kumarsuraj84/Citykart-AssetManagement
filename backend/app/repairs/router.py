"""Release 3: what is away for repair. Read-only (sending and receiving are Move's bulk action).

  GET /api/repairs                           -> {vendors: [{vendor_id, vendor_name, assets, oldest_days}],
                                                  without_vendor: {assets, oldest_days}}
  GET /api/repairs/vendors/{vendor_id}/assets -> the assets that vendor holds, each with where it was sent from

Staff who may move assets (WRITE_ROLES), within their companies and work area."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.deps import WRITE_ROLES, allowed_asset_domains, require_role, scoped_company_ids
from app.masters.models import Vendor
from app.repairs.service import repair_summary, vendor_assets

router = APIRouter(prefix="/api/repairs", tags=["repairs"])


@router.get("")
async def repairs_by_vendor(session: AsyncSession = Depends(get_session), actor=Depends(require_role(*WRITE_ROLES))):
    return await repair_summary(session, await scoped_company_ids(session, actor), await allowed_asset_domains(session, actor))


@router.get("/vendors/{vendor_id}/assets")
async def assets_with_vendor(
    vendor_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_role(*WRITE_ROLES)),
):
    if await session.get(Vendor, vendor_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This vendor was not found.")
    return await vendor_assets(session, vendor_id, await scoped_company_ids(session, actor), await allowed_asset_domains(session, actor))
