from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.problems import Refused
from app.core.deps import (
    WRITE_ROLES, allowed_asset_domains, check_work_area, ensure_company_in_scope, require_role, scoped_company_ids,
)
from app.masters.models import AssetCategory
from app.purchase_orders.models import PurchaseOrder, PendingAsset
from app.purchase_orders.schemas import (
    CancelWaitingIn, CancelWaitingOut, DeliveryDoneIn, InvoiceSummaryOut, LineGroupOut, LineGroupUpdateIn,
    PendingAssetLineIn, PendingAssetLineUpdateIn, PendingAssetOut,
    PurchaseOrderCreateIn, PurchaseOrderDeleteOut, PurchaseOrderOut, PurchaseOrderUpdateIn, PurchaseOrderWithLinesIn,
    PurchaseOrderWithLinesOut,
    ReceiveIn, ReceiveInfoOut, ReceiveOut, RecordPiIn, RecordPiOut, SerialCheckIn, SerialCheckOut, SerialConflictOut,
)
from app.purchase_orders.header import update_po_header
from app.purchase_orders.receive import ReceiveRefused, receive_goods, receive_info
from app.purchase_orders.with_lines import create_po_with_lines
from app.assets.models import Asset
from app.assets.service import find_serials_in_use
from app.bundles.schemas import BundleLinesIn
from app.bundles.service import add_bundle_lines
from app.lifecycle.state_machine import LifecycleError
from app.purchase_orders.service import (
    PO_STATUSES, UNIT_STATUS_FILTER,
    add_pending_asset_line, attach_asset_codes, cancel_pending_asset_line, cancel_waiting_units, compute_pi_status,
    create_purchase_order, delete_purchase_order, deliver_pending_assets, ensure_po_open, invoice_summaries, line_area,
    line_area_of, line_group_units, line_groups, list_purchase_orders, number_unnumbered_units, po_is_visible,
    record_pi_for_invoice, update_line_group, update_pending_asset_line,
)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])

PO_NOT_FOUND = "purchase order not found"
OUTSIDE_SCOPE = "an asset outside your companies or work area"


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


@router.post("/with-lines", response_model=PurchaseOrderWithLinesOut, status_code=201)
async def create_po_with_lines_route(
    body: PurchaseOrderWithLinesIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """S3a-2: the one-screen manual PO -- header, lines (Item, quantity, cost; the rest defaults from the
    Item) and sets in ONE transaction: if any line fails nothing is created, and the message names the
    line ("Line 2: ..."). Company scope and work area as for every PO write."""
    await ensure_company_in_scope(session, actor, body.company_id)
    domains = await allowed_asset_domains(session, actor)
    try:
        po, lines_created, units_created = await create_po_with_lines(session, body.model_dump(), actor, domains)
    except Refused as exc:
        # S5: every line / set problem at once: {detail, errors, problems: [{line_index | set_index, message}]}
        await session.rollback()
        return exc.response()
    except ValueError as exc:
        await session.rollback()
        return Refused([{"message": str(exc)}], "Nothing was created").response()
    except HTTPException:
        await session.rollback()
        raise
    await session.commit()
    await session.refresh(po)
    out = await _po_with_progress(session, po, actor)
    return PurchaseOrderWithLinesOut(**out.model_dump(), lines_created=lines_created, units_created=units_created)


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
        SerialConflictOut(serial=s, asset_code=c, masked=False) if c in visible
        else SerialConflictOut(serial=s, asset_code=OUTSIDE_SCOPE, masked=True)
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


@router.put("/{po_id}", response_model=PurchaseOrderOut)
async def edit_po_header(
    po_id: int, body: PurchaseOrderUpdateIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """S6: changes the PO's vendor, cost centre, delivery place, PO date and / or PO number (only the fields
    sent). Vendor, cost centre, number and date are locked once anything is received; an ERP-made PO keeps
    the ERP's number, date and supplier. Audited field by field. See app.purchase_orders.header."""
    po = await _get_scoped_po(po_id, session, actor)
    try:
        await update_po_header(session, po, body.model_dump(exclude_unset=True), actor,
                               await allowed_asset_domains(session, actor))
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except HTTPException:
        await session.rollback()
        raise
    await session.commit()
    await session.refresh(po)
    return await _po_with_progress(session, po, actor)


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
    units = await line_group_units(session, po_id, line_no, await allowed_asset_domains(session, asset_user), stored)
    return await attach_asset_codes(session, units)


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
    return await attach_asset_codes(session, list((await session.execute(stmt)).scalars().all()))


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
    # S4: the units are locked for this transaction (and read fresh), so two deliveries of the same
    # unit at the same moment can never make two assets of it -- the second one sees it delivered.
    stmt = (
        select(PendingAsset).where(PendingAsset.id.in_(line_ids), PendingAsset.purchase_order_id == po_id)
        .with_for_update().execution_options(populate_existing=True)
    )
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
    except Exception:
        await session.rollback()
        raise
    await session.commit()
    # One read of every delivered unit (was one refresh per unit).
    fresh = (await session.execute(
        select(PendingAsset).where(PendingAsset.id.in_([line.id for line in delivered]))
        .order_by(PendingAsset.id).execution_options(populate_existing=True)
    )).scalars().all()
    by_id = {line.id: line for line in fresh}
    return await attach_asset_codes(session, [by_id[line.id] for line in delivered])


@router.get("/{po_id}/receive-info", response_model=ReceiveInfoOut)
async def get_receive_info(
    po_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_role(*WRITE_ROLES)),
):
    """S4: everything the Receive screen needs in one call -- the PO header, its lines (the caller's
    work area) with ordered / received before / waiting and each line's serial rule, the default place
    goods are received into, the required extra fields of the PO's company, and `blockers` (why nothing
    can be received right now, in plain sentences; empty when it can)."""
    po = await _get_scoped_po(po_id, session, actor)
    await _numbered(session, po_id)
    return await receive_info(session, po, await allowed_asset_domains(session, actor))


@router.post("/{po_id}/receive", response_model=ReceiveOut)
async def receive(
    po_id: int, body: ReceiveIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """S4: receive goods against the PO by line: the common fields once, a quantity per line (the
    oldest waiting units of the line are taken), serials only where the line has them. The WHOLE
    receipt is checked first; any problem -> 422 `{detail, errors, problems: [{line_no, unit_index?,
    serial?, message}]}` and nothing is written. Otherwise it is written in one transaction (all of it
    or, on an unexpected failure, none of it). See app.purchase_orders.receive."""
    po = await _get_scoped_po(po_id, session, actor)
    await _numbered(session, po_id)
    domains = await allowed_asset_domains(session, actor)
    try:
        result = await receive_goods(
            session, po, body.model_dump(), actor, domains, await scoped_company_ids(session, actor),
        )
    except ReceiveRefused as refused:
        await session.rollback()
        return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content=refused.body())
    except (ValueError, LifecycleError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except Exception:
        # Anything unexpected after the checks: the whole receipt is rolled back (nothing half-written).
        await session.rollback()
        raise
    await session.commit()
    return result


@router.get("/{po_id}/invoices", response_model=list[InvoiceSummaryOut])
async def list_invoices(
    po_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_role(*WRITE_ROLES)),
):
    """S4: the invoices received under this PO (the caller's work area), each with its units, asset ids
    (at most 200, for labels) and PI state -- so the PO page need not load every unit."""
    await _get_scoped_po(po_id, session, actor)
    return await invoice_summaries(session, po_id, await allowed_asset_domains(session, actor))


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
