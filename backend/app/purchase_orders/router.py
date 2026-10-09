from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import WRITE_ROLES, ensure_company_in_scope, require_role, scoped_company_ids
from app.purchase_orders.models import PurchaseOrder, PendingAsset
from app.purchase_orders.schemas import (
    DeliveryDoneIn, PendingAssetLineIn, PendingAssetLineUpdateIn, PendingAssetOut,
    PurchaseOrderCreateIn, PurchaseOrderDeleteOut, PurchaseOrderOut, RecordPiIn, RecordPiOut,
    SerialCheckIn, SerialCheckOut, SerialConflictOut,
)
from app.assets.service import find_serials_in_use
from app.bundles.schemas import BundleLinesIn
from app.bundles.service import add_bundle_lines
from app.purchase_orders.service import (
    add_pending_asset_line, cancel_pending_asset_line, compute_pi_status, create_purchase_order,
    delete_purchase_order, deliver_pending_assets, record_pi_for_invoice, update_pending_asset_line,
)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])


async def _get_scoped_po(po_id: int, session: AsyncSession, asset_user) -> PurchaseOrder:
    po = await session.get(PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    allowed = await scoped_company_ids(session, asset_user)
    if allowed is not None and po.company_id not in allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    return po


@router.post("", response_model=PurchaseOrderOut, status_code=201)
async def create_po(
    body: PurchaseOrderCreateIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    await ensure_company_in_scope(session, actor, body.company_id)
    try:
        po = await create_purchase_order(session, body.model_dump(), actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    await session.refresh(po)
    return po


@router.post("/check-serials", response_model=SerialCheckOut)
async def check_serials(
    body: SerialCheckIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Advisory pre-check for the Mark Delivery dialog: which of these serials
    are already used by an asset anywhere in CKAM. Only roles that can deliver
    may ask, and only the serial and the holding asset's code come back (the
    same thing the real delivery error already reveals). The delivery still
    re-checks everything server-side."""
    found = await find_serials_in_use(session, body.serials)
    return SerialCheckOut(conflicts=[SerialConflictOut(serial=s, asset_code=c) for s, c in found])


@router.get("", response_model=list[PurchaseOrderOut])
async def list_pos(session: AsyncSession = Depends(get_session), asset_user=Depends(require_role(*WRITE_ROLES))):
    allowed = await scoped_company_ids(session, asset_user)
    stmt = select(PurchaseOrder).where(PurchaseOrder.is_active.is_(True))
    if allowed is not None:
        stmt = stmt.where(PurchaseOrder.company_id.in_(allowed))
    pos = (await session.execute(stmt.order_by(PurchaseOrder.id.desc()))).scalars().all()
    pi_by_po = await compute_pi_status(session, [po.id for po in pos])
    return [
        PurchaseOrderOut.model_validate(po).model_copy(update=pi_by_po.get(po.id, {}))
        for po in pos
    ]


@router.get("/{po_id}", response_model=PurchaseOrderOut)
async def get_po(po_id: int, session: AsyncSession = Depends(get_session), asset_user=Depends(require_role(*WRITE_ROLES))):
    po = await _get_scoped_po(po_id, session, asset_user)
    pi_by_po = await compute_pi_status(session, [po.id])
    return PurchaseOrderOut.model_validate(po).model_copy(update=pi_by_po.get(po.id, {}))


@router.get("/{po_id}/lines", response_model=list[PendingAssetOut])
async def list_lines(po_id: int, session: AsyncSession = Depends(get_session), asset_user=Depends(require_role(*WRITE_ROLES))):
    await _get_scoped_po(po_id, session, asset_user)
    stmt = select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id)
    return (await session.execute(stmt)).scalars().all()


@router.post("/{po_id}/lines", response_model=list[PendingAssetOut], status_code=201)
async def add_line(
    po_id: int, body: PendingAssetLineIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    po = await _get_scoped_po(po_id, session, actor)
    try:
        lines = await add_pending_asset_line(session, po, body.model_dump(), actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    for line in lines:
        await session.refresh(line)
    return lines


@router.post("/{po_id}/bundle-lines", response_model=list[PendingAssetOut], status_code=201)
async def add_bundle(
    po_id: int, body: BundleLinesIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Adds `quantity` bundles (for example 4 Desktops) as ordinary lines, one
    per part, all or nothing -- see app.bundles.service.add_bundle_lines."""
    po = await _get_scoped_po(po_id, session, actor)
    try:
        lines = await add_bundle_lines(session, po, body.model_dump(), actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    for line in lines:
        await session.refresh(line)
    return lines


@router.put("/lines/{line_id}", response_model=PendingAssetOut)
async def edit_line(
    line_id: int, body: PendingAssetLineUpdateIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    line = await session.get(PendingAsset, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending asset line not found")
    await _get_scoped_po(line.purchase_order_id, session, actor)
    try:
        line = await update_pending_asset_line(session, line, body.model_dump(), actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    await session.refresh(line)
    return line


@router.post("/lines/{line_id}/cancel", response_model=PendingAssetOut)
async def cancel_line(
    line_id: int, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    line = await session.get(PendingAsset, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending asset line not found")
    await _get_scoped_po(line.purchase_order_id, session, actor)
    try:
        line = await cancel_pending_asset_line(session, line, actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    await session.refresh(line)
    return line


@router.post("/{po_id}/deliver", response_model=list[PendingAssetOut])
async def deliver(
    po_id: int, body: DeliveryDoneIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    po = await _get_scoped_po(po_id, session, actor)
    line_ids = [d.pending_asset_id for d in body.lines]
    stmt = select(PendingAsset).where(PendingAsset.id.in_(line_ids), PendingAsset.purchase_order_id == po_id)
    lines = (await session.execute(stmt)).scalars().all()
    if len(lines) != len(line_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "one or more selected lines do not belong to this purchase order")
    deliveries = {d.pending_asset_id: {"serial_number": d.serial_number, "initial_asset_user_id": d.initial_asset_user_id} for d in body.lines}
    try:
        delivered = await deliver_pending_assets(
            session, lines, deliveries, po.po_number, po.po_date, po.vendor_id,
            body.invoice_number, body.invoice_date, body.invoice_amount, actor,
        )
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    for line in delivered:
        await session.refresh(line)
    return delivered


@router.post("/{po_id}/record-pi", response_model=RecordPiOut)
async def record_pi(
    po_id: int, body: RecordPiIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    po = await _get_scoped_po(po_id, session, actor)
    result = await record_pi_for_invoice(
        session, po, body.invoice_number, body.pi_number, body.pi_date, body.overwrite, actor,
    )
    if not result["updated"] and not result["skipped"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"no delivered assets found for invoice {body.invoice_number!r} on this purchase order")
    await session.commit()
    return result


@router.delete("/{po_id}", response_model=PurchaseOrderDeleteOut)
async def delete_po(
    po_id: int, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Deletes a wrongly-created PO -- an ordinary WRITE_ROLES actor may do
    this only while every line is still PENDING/CANCELLED; the moment even
    one line has been delivered (a real Asset now exists in the Fixed
    Asset Register), only the Primary Owner may delete it, since doing so
    also removes those delivered assets (see delete_purchase_order)."""
    po = await _get_scoped_po(po_id, session, actor)
    if not po.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    lines = (await session.execute(
        select(PendingAsset).where(PendingAsset.purchase_order_id == po_id)
    )).scalars().all()
    if any(line.status == "DELIVERED" for line in lines) and not actor.is_primary_owner:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the Primary Owner may delete a purchase order that already has delivered items",
        )
    try:
        result = await delete_purchase_order(session, po, lines, actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    await session.commit()
    return result
