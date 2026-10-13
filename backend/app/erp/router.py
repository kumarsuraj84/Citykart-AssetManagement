from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal, get_session
from app.core.errors import integrity_message
from app.core.deps import WRITE_ROLES, allowed_asset_domains, require_primary_owner, require_role, scoped_company_ids
from app.erp import mirror_models  # noqa: F401  (registers the local ERP copy tables on the metadata)
from app.erp import stores as erp_stores
from app.erp import vendors as erp_vendors
from app.erp.changes import OutsideWorkArea, apply_changes, changes_summary, po_changes, snapshot_baseline
from app.erp.invoices import apply_pi, pi_preview
from app.erp.reminders import delivery_reminders
from app.erp.schemas import ChangesApplyIn, DraftCreateIn, ErpVendorLinkIn, PiApplyIn, StoresCreateIn, SyncRunOut, SyncStatusOut
from app.erp.service import build_draft, create_from_draft, list_available_pos, untracked_codes
from app.erp.source import ErpSource, ErpUnavailable, get_erp_source, is_configured
from app.erp.sync import last_runs, run_sync
from app.erp.warehouse import WarehouseReader, get_warehouse_reader
from app.masters.schemas import VendorOut
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import po_is_visible

router = APIRouter(prefix="/api/erp", tags=["erp"])


def _unavailable(exc: ErpUnavailable) -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))


@router.get("/status")
async def erp_status(_actor=Depends(require_role(*WRITE_ROLES))):
    """Whether this server has an ERP connection set up at all."""
    return {"configured": is_configured()}


# ---- the copy of the ERP data -------------------------------------------

@router.get("/sync", response_model=SyncStatusOut)
async def sync_status(session: AsyncSession = Depends(get_session), _actor=Depends(require_role(*WRITE_ROLES))):
    """When CKAM last copied the ERP data (what every ERP screen shows is as of that time)."""
    last, ok = await last_runs(session)
    return SyncStatusOut(configured=is_configured(), last=last, last_success=ok)


@router.post("/sync", response_model=SyncRunOut)
async def sync_now(reader: WarehouseReader = Depends(get_warehouse_reader), _actor=Depends(require_primary_owner())):
    """Copies the ERP data now (the nightly check does the same by itself). A problem comes back as a
    run with status "failed" and a message, not as an error."""
    if not is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The ERP connection is not set up on this server.")
    return await run_sync(SessionLocal, reader, "manual")


# ---- stores (users made from the ERP's site list) ------------------------

@router.get("/stores")
async def list_stores(
    company_id: int, session: AsyncSession = Depends(get_session), _actor=Depends(require_primary_owner()),
):
    """The stores of one company's ERP, and which of them can be made into users here."""
    try:
        return await erp_stores.list_erp_stores(session, company_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))


@router.post("/stores/create")
async def create_stores(
    body: StoresCreateIn, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner()),
):
    """Makes a Location and a STORE user (login email from the store's code) for each store asked for."""
    try:
        result = await erp_stores.create_erp_stores(session, actor, body.company_id, body.codes)
        await session.commit()
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return result


# ---- vendors -----------------------------------------------------------

@router.get("/vendors")
async def list_vendors(
    company_id: int, session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    _actor=Depends(require_primary_owner()),
):
    """The ERP suppliers of ONE company (the same code means a different supplier in the other company)."""
    try:
        return await erp_vendors.list_erp_vendors(session, source, company_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ErpUnavailable as exc:
        raise _unavailable(exc)


@router.post("/vendors/import", response_model=VendorOut, status_code=201)
async def import_vendor(
    body: ErpVendorLinkIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_primary_owner()),
):
    try:
        vendor = await erp_vendors.import_vendor(session, actor, source, body.company_id, body.erp_vendor_code)
        await session.commit()
    except ErpUnavailable as exc:
        raise _unavailable(exc)
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
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
    vendor_id: int, body: ErpVendorLinkIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_primary_owner()),
):
    try:
        vendor = await erp_vendors.link_vendor(session, actor, source, vendor_id, body.company_id, body.erp_vendor_code)
        await session.commit()
    except ErpUnavailable as exc:
        raise _unavailable(exc)
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "that ERP supplier is already linked")
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.refresh(vendor)
    return vendor


@router.delete("/vendors/{vendor_id}/link", response_model=VendorOut)
async def unlink_vendor(
    vendor_id: int, company_id: int, erp_vendor_code: str, session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    try:
        vendor = await erp_vendors.unlink_vendor(session, actor, vendor_id, company_id, erp_vendor_code)
        await session.commit()
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    await session.refresh(vendor)
    return vendor


# ---- delivery reminders and PI (for POs created from the ERP) ----------

async def _scoped_erp_po(session: AsyncSession, actor, po_id: int) -> PurchaseOrder:
    po = await session.get(PurchaseOrder, po_id)
    allowed = await scoped_company_ids(session, actor)
    if po is None or not po.is_active or (allowed is not None and po.company_id not in allowed):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    # S0.3: same work-area visibility as the purchase-order screens.
    if not await po_is_visible(session, po.id, await allowed_asset_domains(session, actor)):
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


@router.get("/changes/summary")
async def erp_changes_summary(
    session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """POs made from the ERP that the ERP has changed since (cancelled, quantity or rate edited...), for the
    PO list and the dashboard. If the ERP cannot be read this is just "not available", never an error."""
    if not is_configured():
        return {"available": False, "items": []}
    try:
        return {"available": True, "items": await changes_summary(session, actor, source)}
    except ErpUnavailable:
        return {"available": False, "items": []}


@router.get("/purchase-orders/{po_id}/changes")
async def erp_po_changes(
    po_id: int, session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """What the ERP says is different about this PO now, compared with when it was made (or last looked at).
    Reads only."""
    po = await _scoped_erp_po(session, actor, po_id)
    if po.erp_po_code is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "this purchase order was not made from the ERP")
    try:
        return await po_changes(session, source, po, await allowed_asset_domains(session, actor))
    except ErpUnavailable as exc:
        raise _unavailable(exc)


@router.post("/purchase-orders/{po_id}/changes/apply")
async def erp_po_changes_apply(
    po_id: int, body: ChangesApplyIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_role(*WRITE_ROLES)),
):
    """Applies the chosen differences to the PO (cancel pending units, add units, update the cost of pending
    units), or keeps the PO as it is. Delivered units are never touched."""
    po = await _scoped_erp_po(session, actor, po_id)
    if po.erp_po_code is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "this purchase order was not made from the ERP")
    try:
        report = await apply_changes(session, actor, source, po, [i.model_dump() for i in body.items],
                                     await allowed_asset_domains(session, actor))
        await session.commit()
    except ErpUnavailable as exc:
        await session.rollback()
        raise _unavailable(exc)
    except OutsideWorkArea as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return report


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
        results = await apply_pi(
            session, actor, source, po, [i.model_dump() for i in body.items],
            allowed_domains=await allowed_asset_domains(session, actor),
        )
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
    try:
        return await build_draft(session, actor, po, source)
    except ErpUnavailable as exc:
        raise _unavailable(exc)


@router.post("/pos/create", status_code=201)
async def create_po(
    body: DraftCreateIn, session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    try:
        # S0.8: the ERP purchase order is read again from CKAM's ERP copy and the
        # reviewed draft is checked against it (number, vendor, codes, units, rate).
        result = await create_from_draft(session, actor, body.model_dump(), source)
        # Remember what the ERP says now, so a later change (cancelled, edited) can be recognised.
        # If the ERP cannot be read this moment the PO is still made; it can be watched later.
        try:
            erp_po = await source.po(body.erp_po_code) if body.erp_po_code is not None else None
            if erp_po is not None:
                untracked = await untracked_codes(session, source, body.company_id, [erp_po])
                await snapshot_baseline(session, await session.get(PurchaseOrder, result["po_id"]), erp_po, untracked)
        except ErpUnavailable:
            pass
        await session.commit()
    except ErpUnavailable as exc:
        await session.rollback()
        raise _unavailable(exc)
    except IntegrityError as exc:
        await session.rollback()
        code, message = integrity_message(exc)
        if code == status.HTTP_409_CONFLICT:
            # the one unique key a create can still race on: the same ERP PO twice
            message = "This purchase order was already created here."
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, message)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return result
