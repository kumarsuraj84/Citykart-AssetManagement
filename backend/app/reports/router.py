from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, scoped_company_ids
from app.reports.dashboard_service import dashboard_data
from app.reports.schemas import DashboardOut

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    """Scoped exactly like the asset register (Task 19): `scoped_company_ids` returns
    None for ADMIN (unrestricted, sees every company combined) and the caller's own
    company id otherwise, so a non-ADMIN never sees another company's KPI numbers."""
    allowed = scoped_company_ids(holder)
    return await dashboard_data(session, allowed)
