"""S6: GET /api/setup/status (head-office admin and ADMIN) and GET /api/home/attention (staff)."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.deps import READ_ROLES, require_role
from app.core.validation import parse_work_area
from app.erp.source import ErpSource, get_erp_source
from app.home.service import SetupCompanyNotFound, home_attention, setup_status

router = APIRouter(tags=["home"])


class SetupStepOut(BaseModel):
    key: str
    label: str
    done: bool


class SetupStatusOut(BaseModel):
    company_count: int
    place_count: int
    stock_room_count: int
    cost_centre_count: int
    category_count: int
    subcategory_count: int
    item_count: int
    vendor_count: int
    people_count: int
    store_count: int
    code_rule_configured: bool
    steps: list[SetupStepOut]
    done_count: int
    total_steps: int
    # S7 (additive): which company the steps are for (null = every company together, the old answer).
    company_id: int | None = None
    company_name: str | None = None
    company_code: str | None = None


class InboxCountsOut(BaseModel):
    items: int
    vendors: int
    stores: int


class HomeAttentionOut(BaseModel):
    work_area: str | None = None
    serial_pending: int
    under_repair: int
    lost: int
    unlinked_assets: int | None = None
    waiting_pos: int | None = None
    waiting_units: int | None = None
    erp_available: bool = False
    erp_changed_pos: int | None = None
    erp_arrived_pos: int | None = None
    erp_pos_needing_input: int | None = None
    # S7 (additive): the ERP figures that could not be read this time (each is then null); the others are
    # still given -- e.g. ["erp_arrived_pos"] while the ERP has no goods-receipt view.
    erp_unavailable: list[str] = []
    inbox: InboxCountsOut | None = None


@router.get("/api/setup/status", response_model=SetupStatusOut)
async def get_setup_status(
    company_id: int | None = Query(None), session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN")),
):
    """The seven set-up steps of "Set up CKAM" (Company, Stock Room / Places, Cost Centre, Asset Groups and
    first Items, Vendors, People / Stores, Asset Code Format), each done or not, with the counts behind
    them -- all from one query. Head-office admin and ADMIN (whose row role is ADMIN).
    S7 (additive): `company_id` gives the steps of that one company (see app.home.service.setup_status)."""
    try:
        return await setup_status(session, actor, company_id)
    except SetupCompanyNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))


@router.get("/api/home/attention", response_model=HomeAttentionOut)
async def get_home_attention(
    work_area: str | None = Query(None, max_length=10),
    include_erp: bool = Query(True),
    session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_role(*READ_ROLES)),
):
    """Home's "Needs attention" numbers in one call, scoped by the caller's companies and work area:
    serial pending, under repair, lost (everyone); unlinked-to-Item assets (ADMIN); POs / units waiting for
    goods (ADMIN, OPERATOR); ERP changed POs, goods arrived not yet received, ERP POs needing input (ADMIN,
    OPERATOR, when the ERP link is set up); the ERP inbox counts (head-office admin). A number the caller
    is not meant to see is null. `work_area` (IT / Non-IT) narrows the CKAM figures inside the caller's own
    area; `include_erp=false` skips the ERP figures."""
    try:
        wanted = parse_work_area(work_area)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return await home_attention(session, actor, source, work_area=wanted, include_erp=include_erp)
