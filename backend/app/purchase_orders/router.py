from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import (
    WRITE_ROLES, allowed_asset_domains, check_work_area, ensure_company_in_scope, require_role, scoped_company_ids,
)
from app.masters.models import AssetCategory
from app.purchase_orders.models import PurchaseOrder, PendingAsset
from app.purchase_orders.schemas import (
    CancelWaitingIn, CancelWaitingOut, DeliveryDoneIn, LineGroupOut, LineGroupUpdateIn,
    PendingAssetLineIn, PendingAssetLineUpdateIn, PendingAssetOut,
    PurchaseOrderCreateIn, PurchaseOrderDeleteOut, PurchaseOrderOut, RecordPiIn, RecordPiOut,
    SerialCheckIn, SerialCheckOut, SerialConflictOut,
)
from app.assets.models import Asset
from app.assets.service import find_serials_in_use
from app.bundles.schemas import BundleLinesIn
from app.bundles.service import add_bundle_lines
from app.lifecycle.state_machine import LifecycleError
from app.purchase_orders.service import (
    PO_STATUSES, UNIT_STATUS_FILTER,
    add_pending_asset_line, cancel_pending_asset_line, cancel_waiting_units, compute_pi_status, create_purchase_order,
    delete_purchase_order, deliver_pending_assets, ensure_po_open, line_area, line_area_of, line_group_units,
    line_groups, list_purchase_orders, number_unnumbered_units, po_is_visible, record_pi_for_invoice,
    update_line_group, update_pending_asset_line,
)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])

PO_NOT_FOUND = "purchase order not found"


async def _get_scoped_po(po_id: int, session: AsyncSession, asset_user) -> PurchaseOrder:
    """Company scope, plus (S0.3) work area: a user limited to IT or Non-IT
    only reaches a PO that has a line in their area, or no lines yet."""
    po = await session.get(PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, PO_NOT_FOUND)
    allowed = await scoped_company_ids(session, asset_user)
    if allowed is not None and po.company_id not in allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, PO_NOT_FOUND)
    if not await po_is_visible(session, po.id, await allowed_asset_domains(session, asset_user)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, PO_NOT_FOUND)
    return po


def _open_or_422(po: PurchaseOrder) -> None:
    try:
        ensure_po_open(po)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


async def _get_scoped_line(line_id: int, session: AsyncSession, actor) -> tuple[PendingAsset, PurchaseOrder]:
    line = await session.get(PendingAsset, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This PO line was not found.")
    po = await _get_scoped_po(line.purchase_order_id, session, actor)
    check_work_area(await allowed_asset_domains(session, actor), await line_area(session, line))
    return line, po


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
    return await _po_with_progress(session, po, actor)


@router.post("/check-serials", response_model=SerialCheckOut)
async def check_serials(
    body: SerialCheckIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Advisory pre-check for the Mark Delivery dialog: which of these serials
    are already used by an asset anywhere in CKAM. Only roles that can deliver
    may ask. S0.3: a conflicting asset outside the caller's companies or work
    area is still reported (serials are unique everywhere, so the delivery
    would fail), but its asset code is not revealed. The delivery still
    re-checks everything server-side."""
    found = await find_serials_in_use(session, body.serials)
    if not found:
        return SerialCheckOut(conflicts=[])
    allowed = await scoped_company_ids(session, actor)
    domains = await allowed_asset_domains(session, actor)
    codes = [c for _, c in found]
    rows = (await session.execute(
        select(Asset.asset_code, Asset.company_id, Asset.asset_domain).where(Asset.asset_code.in_(codes))
    )).all()
    visible = {
        code for code, company_id, domain in rows
        if (allowed is None or company_id in allowed) and (domains is None or domain in domains)
    }
    return SerialCheckOut(conflicts=[
        SerialConflictOut(serial=s, asset_code=c if c in visible else "an asset outside your companies or work area")
        for s, c in found
    ])


def _po_out(row: dict, pi: dict) -> PurchaseOrderOut:
    extra = {key: value for key, value in row.items() if key != "po"}
    return PurchaseOrderOut.model_validate(row["po"]).model_copy(update={**pi, **extra})


@router.get("", response_model=list[PurchaseOrderOut])
async def list_pos(
    response: Response,
    status_filter: str | None = Query(None, alias="status"),
    waiting: bool | None = Query(None),
    q: str | None = Query(None, max_length=200),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session), asset_user=Depends(require_role(*WRITE_ROLES)),
):
    """S2.3: every PO the caller may see, newest first, with company / vendor
    names and ordered / received / waiting / cancelled unit counts and a
    status -- all from one aggregated query. Optional filters: `status`
    (WAITING, PARTLY_RECEIVED, RECEIVED, CANCELLED), `waiting=true` (only POs
    with waiting units: the Receive queue), `q` (PO number or vendor name).
    Paged by `limit` (default 200, max 500) / `offset`; the total before
    paging is in the X-Total-Count header."""
    if status_filter is not None and status_filter.upper() not in PO_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Choose a status: waiting, partly received, received or cancelled.")
    allowed = await scoped_company_ids(session, asset_user)
    domains = await allowed_asset_domains(session, asset_user)
    rows, total = await list_purchase_orders(
        session, allowed, domains, status=status_filter.upper() if status_filter else None,
        waiting=waiting, q=q, limit=limit, offset=offset,
    )
    pi_by_po = await compute_pi_status(session, [row["po"].id for row in rows])
    response.headers["X-Total-Count"] = str(total)
    return [_po_out(row, pi_by_po.get(row["po"].id, {})) for row in rows]


async def _po_with_progress(session: AsyncSession, po: PurchaseOrder, asset_user) -> PurchaseOrderOut:
    rows, _ = await list_purchase_orders(
        session, None, await allowed_asset_domains(session, asset_user), po_id=po.id,
    )
    pi_by_po = await compute_pi_status(session, [po.id])
    if not rows:            # cannot happen for a PO that passed _get_scoped_po
        return PurchaseOrderOut.model_validate(po).model_copy(update=pi_by_po.get(po.id, {}))
    return _po_out(rows[0], pi_by_po.get(po.id, {}))


@router.get("/{po_id}", response_model=PurchaseOrderOut)
async def get_po(po_id: int, session: AsyncSession = Depends(get_session), asset_user=Depends(require_role(*WRITE_ROLES))):
    po = await _get_scoped_po(po_id, session, asset_user)
    return await _po_with_progress(session, po, asset_user)


# ---- S2.1: lines (groups of units sharing a line number) -------------------

async def _numbered(session: AsyncSession, po_id: int) -> None:
    """Gives any unit without a line number one (normally nothing to do)."""
    if await number_unnumbered_units(session, po_id):
        await session.commit()


@router.get("/{po_id}/line-groups", response_model=list[LineGroupOut])
async def list_line_groups(
    po_id: int, session: AsyncSession = Depends(get_session), asset_user=Depends(require_role(*WRITE_ROLES)),
):
    """The PO's lines in order, each with ordered / received / waiting /
    cancelled counts, value and status (only the caller's work area)."""
    await _get_scoped_po(po_id, session, asset_user)
    await _numbered(session, po_id)
    return await line_groups(session, po_id, await allowed_asset_domains(session, asset_user))


async def _get_scoped_group(session: AsyncSession, po_id: int, line_no: int, asset_user) -> tuple[PurchaseOrder, dict]:
    po = await _get_scoped_po(po_id, session, asset_user)
    await _numbered(session, po_id)
    groups = await line_groups(session, po_id, await allowed_asset_domains(session, asset_user), line_no)
    if not groups:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This PO line was not found.")
    return po, groups[0]


@router.get("/{po_id}/line-groups/{line_no}/units", response_model=list[PendingAssetOut])
async def list_line_group_units(
    po_id: int, line_no: int, status_filter: str | None = Query(None, alias="status"),
    session: AsyncSession = Depends(get_session), asset_user=Depends(require_role(*WRITE_ROLES)),
):
    """The units of one line (optionally only WAITING / RECEIVED / CANCELLED)."""
    stored = None
    if status_filter is not None:
        stored = UNIT_STATUS_FILTER.get(status_filter.upper())
        if stored is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a status: waiting, received or cancelled.")
    await _get_scoped_group(session, po_id, line_no, asset_user)
    return await line_group_units(session, po_id, line_no, await allowed_asset_domains(session, asset_user), stored)


@router.put("/{po_id}/line-groups/{line_no}", response_model=LineGroupOut)
async def edit_line_group(
    po_id: int, line_no: int, body: LineGroupUpdateIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Edits a whole line: the fields sent apply to every still-waiting unit;
    `quantity` (the new ordered total) adds units or cancels waiting ones.
    Received and cancelled units never change."""
    po, _ = await _get_scoped_group(session, po_id, line_no, actor)
    _open_or_422(po)
    domains = await allowed_asset_domains(session, actor)
    try:
        await update_line_group(session, po, line_no, body.model_dump(exclude_unset=True), actor, domains)
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    [group] = await line_groups(session, po_id, domains, line_no)
    return group


@router.post("/{po_id}/line-groups/{line_no}/cancel-waiting", response_model=LineGroupOut)
async def cancel_line_group_waiting(
    po_id: int, line_no: int, body: CancelWaitingIn | None = None, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Cancels `quantity` (default: all) waiting units of one line, the most
    recently added first. Received units are never touched."""
    po, group = await _get_scoped_group(session, po_id, line_no, actor)
    _open_or_422(po)
    quantity = body.quantity if body is not None else None
    if group["waiting"] == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nothing on this line is still waiting.")
    if quantity is not None and quantity > group["waiting"]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Only {group['waiting']} of this line {'is' if group['waiting'] == 1 else 'are'} still waiting.",
        )
    domains = await allowed_asset_domains(session, actor)
    await cancel_waiting_units(session, po, actor, domains, line_no, quantity)
    await session.commit()
    [group] = await line_groups(session, po_id, domains, line_no)
    return group


@router.post("/{po_id}/cancel-waiting", response_model=CancelWaitingOut)
async def cancel_po_waiting(
    po_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_role(*WRITE_ROLES)),
):
    """Cancels every waiting unit of the PO that the caller may see. The PO
    stays (with its received items); its status becomes RECEIVED (something
    was received) or CANCELLED (nothing was). This is what to do instead of
    deleting a PO that already has received items."""
    po = await _get_scoped_po(po_id, session, actor)
    _open_or_422(po)
    domains = await allowed_asset_domains(session, actor)
    cancelled = await cancel_waiting_units(session, po, actor, domains)
    if cancelled == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nothing on this purchase order is still waiting.")
    await session.commit()
    summary = await _po_with_progress(session, po, actor)
    return CancelWaitingOut(cancelled_units=cancelled, status=summary.status)


@router.get("/{po_id}/lines", response_model=list[PendingAssetOut])
async def list_lines(po_id: int, session: AsyncSession = Depends(get_session), asset_user=Depends(require_role(*WRITE_ROLES))):
    """S0.3: a user limited to one work area sees only that area's lines."""
    await _get_scoped_po(po_id, session, asset_user)
    domains = await allowed_asset_domains(session, asset_user)
    stmt = select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id)
    if domains is not None:
        stmt = (stmt.join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
                .where(line_area_of().in_(domains)))
    return (await session.execute(stmt)).scalars().all()


@router.post("/{po_id}/lines", response_model=list[PendingAssetOut], status_code=201)
async def add_line(
    po_id: int, body: PendingAssetLineIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    po = await _get_scoped_po(po_id, session, actor)
    _open_or_422(po)
    try:
        lines = await add_pending_asset_line(
            session, po, body.model_dump(), actor, allowed_domains=await allowed_asset_domains(session, actor),
        )
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
    _open_or_422(po)
    try:
        lines = await add_bundle_lines(
            session, po, body.model_dump(), actor, allowed_domains=await allowed_asset_domains(session, actor),
        )
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
    line, po = await _get_scoped_line(line_id, session, actor)
    _open_or_422(po)
    try:
        line = await update_pending_asset_line(
            session, line, body.model_dump(), actor, allowed_domains=await allowed_asset_domains(session, actor),
        )
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
    line, po = await _get_scoped_line(line_id, session, actor)
    _open_or_422(po)
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
    _open_or_422(po)
    line_ids = [d.pending_asset_id for d in body.lines]
    if len(set(line_ids)) != len(line_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The same unit was chosen twice.")
    # S0.5: an invoice cannot be dated before its purchase order.
    if po.po_date is not None and body.invoice_date < po.po_date:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"The invoice date cannot be before the PO date ({po.po_date.strftime('%d-%m-%Y')}).",
        )
    stmt = select(PendingAsset).where(PendingAsset.id.in_(line_ids), PendingAsset.purchase_order_id == po_id)
    lines = (await session.execute(stmt)).scalars().all()
    if len(lines) != len(line_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "One or more selected lines do not belong to this purchase order.")
    domains = await allowed_asset_domains(session, actor)
    for line in lines:
        check_work_area(domains, await line_area(session, line))
    deliveries = {
        d.pending_asset_id: {
            "serial_number": d.serial_number, "serial_pending": d.serial_pending,
            "initial_asset_user_id": d.initial_asset_user_id,
        } for d in body.lines
    }
    try:
        delivered = await deliver_pending_assets(
            session, lines, deliveries, po.po_number, po.po_date, po.vendor_id,
            body.invoice_number, body.invoice_date, body.invoice_amount, actor,
        )
    except (ValueError, LifecycleError) as exc:
        # S0.7: LifecycleError (e.g. a date the ledger refuses) used to escape
        # as a bare 500 here; it is a problem with the request like any other.
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
    _open_or_422(po)
    result = await record_pi_for_invoice(
        session, po, body.invoice_number, body.pi_number, body.pi_date, body.overwrite, actor,
        allowed_domains=await allowed_asset_domains(session, actor),
    )
    if not result["updated"] and not result["skipped"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"No delivered assets were found for invoice {body.invoice_number} on this purchase order.")
    await session.commit()
    return result


@router.delete("/{po_id}", response_model=PurchaseOrderDeleteOut)
async def delete_po(
    po_id: int, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Deletes a wrongly-created PO: its waiting units are cancelled and the
    PO is deactivated. S2 (owner requirement): refused for EVERYONE --
    including the head-office admin -- once any unit has been received,
    because received items are real assets that must never be lost with the
    PO (409, "Cancel the waiting items instead": POST /{id}/cancel-waiting).
    S0.3: someone limited to one work area may only delete a PO whose lines
    are all in their own area (deleting cancels every line)."""
    po = await _get_scoped_po(po_id, session, actor)
    if not po.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, PO_NOT_FOUND)
    lines = (await session.execute(
        select(PendingAsset).where(PendingAsset.purchase_order_id == po_id)
    )).scalars().all()
    domains = await allowed_asset_domains(session, actor)
    for line in lines:
        check_work_area(domains, await line_area(session, line))
    try:
        result = await delete_purchase_order(session, po, lines, actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    await session.commit()
    return result
