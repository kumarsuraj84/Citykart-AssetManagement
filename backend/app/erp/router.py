from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import WRITE_ROLES, require_primary_owner, require_role
from app.erp import vendors as erp_vendors
from app.erp.schemas import DraftCreateIn, ErpVendorCodeIn
from app.erp.service import build_draft, create_from_draft, list_available_pos
from app.erp.source import ErpSource, ErpUnavailable, get_erp_source, is_configured
from app.masters.schemas import VendorOut

router = APIRouter(prefix="/api/erp", tags=["erp"])


def _unavailable(exc: ErpUnavailable) -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))


@router.get("/status")
async def erp_status(_actor=Depends(require_role(*WRITE_ROLES))):
    """Whether this server has an ERP connection set up at all."""
    return {"configured": is_configured()}


# ---- vendors -----------------------------------------------------------

@router.get("/vendors")
async def list_vendors(
    session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    _actor=Depends(require_primary_owner()),
):
    try:
        return await erp_vendors.list_erp_vendors(session, source)
    except ErpUnavailable as exc:
        raise _unavailable(exc)


@router.post("/vendors/import", response_model=VendorOut, status_code=201)
async def import_vendor(
    body: ErpVendorCodeIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_primary_owner()),
):
    try:
        vendor = await erp_vendors.import_vendor(session, actor, source, body.erp_vendor_code)
        await session.commit()
    except ErpUnavailable as exc:
        raise _unavailable(exc)
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "a vendor with this code already exists")
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.refresh(vendor)
    return vendor


@router.post("/vendors/{vendor_id}/link", response_model=VendorOut)
async def link_vendor(
    vendor_id: int, body: ErpVendorCodeIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_primary_owner()),
):
    try:
        vendor = await erp_vendors.link_vendor(session, actor, source, vendor_id, body.erp_vendor_code)
        await session.commit()
    except ErpUnavailable as exc:
        raise _unavailable(exc)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.refresh(vendor)
    return vendor


@router.delete("/vendors/{vendor_id}/link", response_model=VendorOut)
async def unlink_vendor(
    vendor_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner()),
):
    try:
        vendor = await erp_vendors.unlink_vendor(session, actor, vendor_id)
        await session.commit()
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    await session.refresh(vendor)
    return vendor


# ---- purchase orders ---------------------------------------------------

@router.get("/pos")
async def list_pos(
    session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """OPEN ERP purchase orders of vendors linked to CKAM, not yet created here."""
    try:
        return await list_available_pos(session, actor, source)
    except ErpUnavailable as exc:
        raise _unavailable(exc)


@router.get("/pos/{po_code}/draft")
async def po_draft(
    po_code: int, session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """The ERP PO as an editable draft. Creates nothing."""
    try:
        po = await source.po(po_code)
    except ErpUnavailable as exc:
        raise _unavailable(exc)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This purchase order was not found in the ERP.")
    return await build_draft(session, actor, po)


@router.post("/pos/create", status_code=201)
async def create_po(
    body: DraftCreateIn, session: AsyncSession = Depends(get_session), actor=Depends(require_role(*WRITE_ROLES)),
):
    try:
        result = await create_from_draft(session, actor, body.model_dump())
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "this purchase order was already created here")
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return result
