from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import ensure_company_in_scope, require_role, scoped_company_ids
from app.purchase_orders.models import PurchaseOrder, PendingAsset
from app.purchase_orders.schemas import (
    DeliveryDoneIn, PendingAssetLineIn, PendingAssetLineUpdateIn, PendingAssetOut,
    PurchaseOrderCreateIn, PurchaseOrderOut,
)
from app.purchase_orders.service import (
    add_pending_asset_line, cancel_pending_asset_line, create_purchase_order,
    deliver_pending_assets, update_pending_asset_line,
)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])


async def _get_scoped_po(po_id: int, session: AsyncSession, holder) -> PurchaseOrder:
    po = await session.get(PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    allowed = scoped_company_ids(holder)
    if allowed is not None and po.company_id not in allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    return po


@router.post("", response_model=PurchaseOrderOut, status_code=201)
async def create_po(
    body: PurchaseOrderCreateIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    ensure_company_in_scope(actor, body.company_id)
    try:
        po = await create_purchase_order(session, body.model_dump(), actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    await session.refresh(po)
    return po


@router.get("", response_model=list[PurchaseOrderOut])
async def list_pos(session: AsyncSession = Depends(get_session), holder=Depends(require_role("ADMIN", "IT_TEAM"))):
    allowed = scoped_company_ids(holder)
    stmt = select(PurchaseOrder).where(PurchaseOrder.is_active.is_(True))
    if allowed is not None:
        stmt = stmt.where(PurchaseOrder.company_id.in_(allowed))
    return (await session.execute(stmt.order_by(PurchaseOrder.id.desc()))).scalars().all()


@router.get("/{po_id}", response_model=PurchaseOrderOut)
async def get_po(po_id: int, session: AsyncSession = Depends(get_session), holder=Depends(require_role("ADMIN", "IT_TEAM"))):
    return await _get_scoped_po(po_id, session, holder)


@router.get("/{po_id}/lines", response_model=list[PendingAssetOut])
async def list_lines(po_id: int, session: AsyncSession = Depends(get_session), holder=Depends(require_role("ADMIN", "IT_TEAM"))):
    await _get_scoped_po(po_id, session, holder)
    stmt = select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id)
    return (await session.execute(stmt)).scalars().all()


@router.post("/{po_id}/lines", response_model=list[PendingAssetOut], status_code=201)
async def add_line(
    po_id: int, body: PendingAssetLineIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
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


@router.put("/lines/{line_id}", response_model=PendingAssetOut)
async def edit_line(
    line_id: int, body: PendingAssetLineUpdateIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
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
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
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
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    po = await _get_scoped_po(po_id, session, actor)
    line_ids = [d.pending_asset_id for d in body.lines]
    stmt = select(PendingAsset).where(PendingAsset.id.in_(line_ids), PendingAsset.purchase_order_id == po_id)
    lines = (await session.execute(stmt)).scalars().all()
    if len(lines) != len(line_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "one or more selected lines do not belong to this purchase order")
    deliveries = {d.pending_asset_id: {"serial_number": d.serial_number, "initial_holder_id": d.initial_holder_id} for d in body.lines}
    try:
        delivered = await deliver_pending_assets(
            session, lines, deliveries, po.po_number, po.po_date,
            body.invoice_number, body.invoice_date, body.invoice_amount, actor,
        )
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    for line in delivered:
        await session.refresh(line)
    return delivered
