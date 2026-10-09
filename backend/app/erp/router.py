from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import WRITE_ROLES, require_primary_owner, require_role, scoped_company_ids
from app.erp import vendors as erp_vendors
from app.erp.invoices import apply_pi, pi_preview
from app.erp.reminders import delivery_reminders
from app.erp.schemas import DraftCreateIn, ErpVendorCodeIn, PiApplyIn
from app.erp.service import build_draft, create_from_draft, list_available_pos
from app.erp.source import ErpSource, ErpUnavailable, get_erp_source, is_configured
from app.masters.schemas import VendorOut
from app.purchase_orders.models import PurchaseOrder

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


# ---- delivery reminders and PI (for POs created from the ERP) ----------

async def _scoped_erp_po(session: AsyncSession, actor, po_id: int) -> PurchaseOrder:
    po = await session.get(PurchaseOrder, po_id)
    allowed = await scoped_company_ids(session, actor)
    if po is None or not po.is_active or (allowed is not None and po.company_id not in allowed):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    return po


@router.get("/reminders")
async def reminders(
    po_id: int | None = None, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_role(*WRITE_ROLES)),
):
    """POs created from the ERP where the ERP shows goods received that CKAM has
    not marked delivered yet. A reminder only: delivery needs serial numbers."""
    try:
        return await delivery_reminders(session, actor, source, po_id)
    except ErpUnavailable as exc:
        raise _unavailable(exc)


@router.get("/purchase-orders/{po_id}/pi")
async def pi_lookup(
    po_id: int, session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """The PIs the ERP holds for this PO, matched to the invoices delivered here.
    Preview only: nothing is recorded."""
    po = await _scoped_erp_po(session, actor, po_id)
    try:
        return await pi_preview(session, source, po)
    except ErpUnavailable as exc:
        raise _unavailable(exc)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/purchase-orders/{po_id}/pi/apply")
async def pi_apply(
    po_id: int, body: PiApplyIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_role(*WRITE_ROLES)),
):
    """Records the PIs the user confirmed, through the same function as Record PI."""
    po = await _scoped_erp_po(session, actor, po_id)
    try:
        results = await apply_pi(session, actor, source, po, [i.model_dump() for i in body.items])
        await session.commit()
    except ErpUnavailable as exc:
        raise _unavailable(exc)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return results


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
