from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.capabilities import ensure_company_for_create, require_small_create
from app.core.db import SessionLocal, get_session
from app.core.errors import integrity_message
from app.core.deps import WRITE_ROLES, allowed_asset_domains, require_primary_owner, require_role, scoped_company_ids
from app.erp import mirror_models  # noqa: F401  (registers the local ERP copy tables on the metadata)
from app.erp import stores as erp_stores
from app.erp import vendors as erp_vendors
from app.erp.changes import OutsideWorkArea, apply_changes, changes_summary, po_changes, snapshot_baseline
from app.erp.invoices import apply_pi, pi_preview
from app.erp.reminders import delivery_reminders
from app.erp.inbox import build_inbox, inbox_counts, resolve_items_batch, resolve_vendors_batch
from app.erp.readiness import freshness
from app.erp.schemas import (
    ChangesApplyIn, DraftCreateIn, ErpVendorLinkIn, InboxItemDecisionIn, InboxVendorDecisionIn, NotTrackedIn, PiApplyIn,
    StoresCreateIn, SyncRunOut, SyncStatusOut, VendorCodesIn,
)
from app.erp.service import NotAllowed, build_draft, create_from_draft, erp_po_rows, mark_not_tracked, untracked_codes
from app.erp.source import ErpSource, ErpUnavailable, ErpViewMissing, get_erp_source, is_configured
from app.erp.sync import last_runs, run_sync
from app.erp.warehouse import WarehouseReader, get_warehouse_reader
from app.masters.schemas import VendorOut
from app.observability import audit as obs_audit
from app.observability import events as obs_events
from app.observability import writer as obs_writer
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
    run = await run_sync(SessionLocal, reader, "manual")
    # S8: who asked for it (the copy itself is in system_event under this request id).
    await obs_writer.audit_now("ERP", "ERP_SYNC", f"{obs_events.who()} copied the ERP data now: {run.status}.",
                               outcome="OK" if run.status in ("success", "skipped") else "FAILED",
                               changes={"status": run.status, "message": run.message})
    return run


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
    obs_audit.suppress(session, "asset_user", "location")      # S8: one row for the whole run
    try:
        result = await erp_stores.create_erp_stores(session, actor, body.company_id, body.codes)
        created = result.get("created") or []
        obs_audit.record(
            session, "ERP", "STORES_CREATE",
            f"{obs_events.who()} made {obs_events.plural(len(created), 'store')} from the ERP "
            f"({len(result.get('skipped') or [])} skipped; {result.get('stock_rooms_created', 0)} stock rooms, "
            f"{result.get('install_points_created', 0)} install points).",
            entity="company", entity_id=body.company_id, company_id=body.company_id,
            changes={"asked": body.codes[:200], "created": [c.get("code") if isinstance(c, dict) else c for c in created][:200],
                     "skipped": (result.get("skipped") or [])[:200],
                     "stock_rooms_created": result.get("stock_rooms_created"),
                     "install_points_created": result.get("install_points_created")})
        await session.commit()
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return result


# ---- vendors -----------------------------------------------------------

VENDOR_PAGE_DEFAULT = 200


@router.get("/vendors")
async def list_vendors(
    response: Response,
    company_id: int,
    q: str | None = Query(None, max_length=200),
    limit: int | None = Query(None, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    _actor=Depends(require_primary_owner()),
):
    """The ERP suppliers of ONE company (the same code means a different supplier in the other company).
    S5 (additive): `q` (supplier name, ERP code, GSTIN or the linked / suggested vendor's name; plain text),
    `limit` (1-1000) and `offset`; `X-Total-Count` = all matching suppliers. A call with none of the three
    still gets the whole list (as before); with `q` or `offset` but no `limit`, a page of 200."""
    try:
        rows = await erp_vendors.list_erp_vendors(session, source, company_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ErpUnavailable as exc:
        raise _unavailable(exc)
    needle = (q or "").strip().casefold()
    if needle:
        rows = [r for r in rows if any(needle in (r.get(k) or "").casefold() for k in (
            "name", "erp_code", "gstin", "linked_vendor_name", "suggested_vendor_name"))]
    response.headers["X-Total-Count"] = str(len(rows))
    if limit is not None or offset or needle:
        rows = rows[offset: offset + (limit or VENDOR_PAGE_DEFAULT)]
    return rows


@router.post("/vendors/import", response_model=VendorOut, status_code=201)
async def import_vendor(
    body: ErpVendorLinkIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_small_create("a vendor")),
):
    """S3a-1: ADMIN / OPERATOR may add a vendor from an ERP supplier of a company
    they work in (e.g. while reviewing an ERP PO whose supplier is not linked)."""
    await ensure_company_for_create(session, actor, body.company_id, "a vendor link")
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
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_small_create("a vendor link")),
):
    """S3a-1: ADMIN / OPERATOR may link an ERP supplier of a company they work
    in to an existing vendor. Unlinking stays with the head-office admin."""
    await ensure_company_for_create(session, actor, body.company_id, "a vendor link")
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


@router.post("/vendors/{vendor_id}/link-many")
async def link_many(
    vendor_id: int, body: VendorCodesIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_small_create("a vendor link")),
):
    """S3a-2: links several ERP suppliers (e.g. every state registration of one business) of ONE company to
    one existing vendor, all or nothing. ADMIN / OPERATOR for their own companies."""
    await ensure_company_for_create(session, actor, body.company_id, "a vendor link")
    try:
        done = await erp_vendors.link_codes(session, actor, source, vendor_id, body.company_id, body.erp_vendor_codes)
        await session.commit()
    except ErpUnavailable as exc:
        await session.rollback()
        raise _unavailable(exc)
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That ERP supplier is already linked.")
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    vendor = done["vendor"]
    await session.refresh(vendor)
    return {"vendor": VendorOut.model_validate(vendor), "linked": done["linked"], "already_linked": done["already_linked"]}


@router.post("/vendors/import-group", response_model=VendorOut, status_code=201)
async def import_group(
    body: VendorCodesIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_small_create("a vendor")),
):
    """S3a-2: ONE new vendor for several registrations of a supplier in one company (named after the first
    one, or `name`; the first GSTIN; a code made from the name), linked to every code -- all or nothing.
    ADMIN / OPERATOR for their own companies."""
    await ensure_company_for_create(session, actor, body.company_id, "a vendor")
    try:
        vendor = await erp_vendors.create_vendor_for_codes(session, actor, source, body.company_id, body.erp_vendor_codes, body.name)
        await session.commit()
    except ErpUnavailable as exc:
        await session.rollback()
        raise _unavailable(exc)
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That ERP supplier is already linked.")
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


# ---- S3a-2: the head-office admin's ERP inbox ----------------------------

@router.get("/inbox")
async def inbox(
    company_id: int | None = None, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), _actor=Depends(require_primary_owner()),
):
    """What is waiting for a decision: ERP item codes on open POs with no decision (by Article), unlinked
    suppliers with open POs (by PAN), ERP stores ready to be created. Head-office admin only."""
    try:
        return await build_inbox(session, source, company_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ErpUnavailable as exc:
        raise _unavailable(exc)


@router.get("/inbox/counts")
async def inbox_counts_route(
    company_id: int | None = None, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), _actor=Depends(require_primary_owner()),
):
    """S5: only the three numbers of the ERP inbox, for Home: {items, vendors, stores} (Article groups of ERP
    items waiting for a decision, supplier groups waiting for a vendor match, ERP stores ready to create).
    Same rules as GET /inbox, without its lists and suggestions. Head-office admin only."""
    try:
        return await inbox_counts(session, source, company_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ErpUnavailable as exc:
        raise _unavailable(exc)


@router.post("/inbox/items/resolve")
async def inbox_resolve_items(
    body: list[InboxItemDecisionIn] = Body(..., min_length=1, max_length=200), session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_primary_owner()),
):
    """Decides several inbox items; each entry is its own transaction. Answers `[{ok, message, ...}]` in order."""
    try:
        return await resolve_items_batch(session, actor, source, [e.model_dump() for e in body])
    except ErpUnavailable as exc:
        await session.rollback()
        raise _unavailable(exc)


@router.post("/inbox/vendors/resolve")
async def inbox_resolve_vendors(
    body: list[InboxVendorDecisionIn] = Body(..., min_length=1, max_length=200), session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_primary_owner()),
):
    """Links (LINK, to `vendor_id`) or creates (CREATE) a vendor for each group of ERP suppliers; each entry
    is its own transaction. Answers `[{ok, message, vendor_id?}]` in order."""
    try:
        return await resolve_vendors_batch(session, actor, source, [e.model_dump() for e in body])
    except ErpUnavailable as exc:
        await session.rollback()
        raise _unavailable(exc)


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


RECEIPTS_NOT_PROVIDED = "The ERP does not provide goods receipts yet, so goods-arrived reminders are not available."
INVOICES_NOT_PROVIDED = "The ERP does not provide purchase invoices yet."


def _erp_reason(exc: ErpUnavailable, not_provided: str) -> str:
    """A plain sentence for an ERP read that could not be made: the view is missing in the ERP (it does not
    provide this yet) or the ERP could not be read right now."""
    return not_provided if isinstance(exc, ErpViewMissing) else str(exc)


@router.get("/reminders")
async def reminders(
    response: Response, po_id: int | None = None, envelope: bool = False, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_role(*WRITE_ROLES)),
):
    """POs created from the ERP where the ERP shows goods received that CKAM has
    not marked delivered yet. A reminder only: delivery needs serial numbers.

    S7 (P1-1): when the ERP cannot give goods receipts (the view is not created in the ERP, or the ERP is
    down) this is NOT an error any more: 200 with an empty list and the headers `X-ERP-Available: false` and
    `X-ERP-Message` (a plain sentence). `envelope=true` (additive) answers `{available, message, items}`
    instead of the bare list."""
    try:
        items = await delivery_reminders(session, actor, source, po_id)
        available, message = True, None
    except ErpUnavailable as exc:
        items, available, message = [], False, _erp_reason(exc, RECEIPTS_NOT_PROVIDED)
    response.headers["X-ERP-Available"] = "true" if available else "false"
    if message:
        response.headers["X-ERP-Message"] = message
    if envelope:
        return {"available": available, "message": message, "items": items}
    return items


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
        items = [i.model_dump() for i in body.items]
        report = await apply_changes(session, actor, source, po, items, await allowed_asset_domains(session, actor))
        obs_audit.record(session, "ERP", "ERP_CHANGES_APPLIED",
                         f"Purchase order {po.po_number}: {obs_events.who()} decided "
                         f"{obs_events.plural(len(items), 'ERP change')}.", entity="purchase_order", entity_id=po.id,
                         company_id=po.company_id, changes={"decisions": items[:100]})
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
    Preview only: nothing is recorded.

    S7 (P1-1, additive `available` / `message`): when the ERP cannot give purchase invoices (the view is not
    created in the ERP: "The ERP does not provide purchase invoices yet."; or the ERP cannot be read) the
    answer is 200 with `available: false`, the plain sentence in `message` and no rows -- never a 503."""
    po = await _scoped_erp_po(session, actor, po_id)
    try:
        return {**await pi_preview(session, source, po), "available": True, "message": None}
    except ErpUnavailable as exc:
        return {"po_id": po.id, "po_number": po.po_number, "rows": [], "not_booked": 0, "ckam_invoices": [],
                "delivered_assets": 0, "available": False, "message": _erp_reason(exc, INVOICES_NOT_PROVIDED)}
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/purchase-orders/{po_id}/pi/apply")
async def pi_apply(
    po_id: int, body: PiApplyIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_role(*WRITE_ROLES)),
):
    """Records the PIs the user confirmed, through the same function as Record PI."""
    po = await _scoped_erp_po(session, actor, po_id)
    obs_audit.suppress(session, "asset")      # S8: one PI_RECORDED row, not one per asset
    try:
        items = [i.model_dump() for i in body.items]
        results = await apply_pi(
            session, actor, source, po, items,
            allowed_domains=await allowed_asset_domains(session, actor),
        )
        obs_audit.record(session, "ERP", "PI_RECORDED",
                         f"Purchase order {po.po_number}: {obs_events.who()} recorded "
                         f"{obs_events.plural(len(items), 'PI')} from the ERP.", entity="purchase_order",
                         entity_id=po.id, company_id=po.company_id, changes={"items": items[:100]})
        await session.commit()
    except ErpUnavailable as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, _erp_reason(exc, INVOICES_NOT_PROVIDED))
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return results


# ---- purchase orders ---------------------------------------------------

READINESS = ("READY", "NEEDS_INPUT")


@router.get("/pos")
async def list_pos(
    readiness: str | None = Query(None), q: str | None = Query(None, max_length=200), company_id: int | None = None,
    envelope: bool = False, only_linked: bool = False,
    session: AsyncSession = Depends(get_session), source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """OPEN ERP purchase orders not yet created here, of EVERY supplier of the caller's companies (S3a-2: a
    PO of a supplier not matched yet is listed as needing input, never left out), each with `readiness`
    (READY / NEEDS_INPUT) and its `problems` in plain words. Filters: `readiness`, `q` (PO number or vendor
    name), `company_id`. `envelope=true` answers `{pos, counts, freshness}` instead of the bare list: the
    counts per readiness (before the readiness filter) and how current the ERP data is ("ERP data as of ...",
    `refresh_failed` + message); with `envelope=true` an unreadable ERP gives an empty list and a message
    instead of a 503, so the screen never blocks.
    `only_linked=true` (the screen's default) keeps only the POs whose ERP supplier is already linked to a
    vendor; the envelope's `counts.other_suppliers` says how many POs of not-yet-linked suppliers that left out,
    so the screen can offer them with one click. Without it nothing is left out, as before."""
    wanted = readiness.strip().upper() if readiness else None
    if wanted is not None and wanted not in READINESS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose ready or needs input.")
    try:
        every = await erp_po_rows(session, actor, source, q=q, company_id=company_id)
        error = None
    except ErpUnavailable as exc:
        if not envelope:
            raise _unavailable(exc)
        every, error = [], str(exc)
    other_suppliers = sum(not r["vendor_linked"] for r in every)
    rows = [r for r in every if r["vendor_linked"]] if only_linked else every
    shown = [r for r in rows if wanted is None or r["readiness"] == wanted]
    if not envelope:
        return shown
    counts = {"all": len(rows), "ready": sum(r["readiness"] == "READY" for r in rows),
              "needs_input": sum(r["readiness"] == "NEEDS_INPUT" for r in rows), "other_suppliers": other_suppliers}
    fresh = await freshness(session)
    if error is not None:
        fresh = {**fresh, "available": False, "message": f"ERP data could not be read. {error}"}
    else:
        fresh = {**fresh, "available": True}
    return {"pos": shown, "counts": counts, "freshness": fresh}


@router.post("/pos/{po_code}/not-tracked")
async def po_line_not_tracked(
    po_code: int, body: NotTrackedIn, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), actor=Depends(require_role(*WRITE_ROLES)),
):
    """S3a-2: "Not an asset" for one line of an ERP PO under review: remembered as a "not tracked" rule for
    this code, its product name or its Article in the PO's company (the actor is recorded). Whole
    Department / Section / Division: head-office admin only. Answers every line's decision now."""
    try:
        result = await mark_not_tracked(session, actor, source, po_code, body.icode, body.scope)
        await session.commit()
    except ErpUnavailable as exc:
        await session.rollback()
        raise _unavailable(exc)
    except NotAllowed as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except LookupError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return result


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
    except NotAllowed:
        # Same answer as a PO that does not exist: another company's PO is not even confirmed to exist.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This purchase order was not found in the ERP.")


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
        # S8: the PO header has its own DATA row; this one says it came from the ERP, with its units.
        obs_audit.record(session, "ERP", "CREATE_FROM_ERP",
                         f"Purchase order {result['po_number']} created from the ERP with "
                         f"{obs_events.plural(result['lines_created'], 'line')} "
                         f"({obs_events.plural(result['units_created'], 'unit')}).",
                         entity="purchase_order", entity_id=result["po_id"], company_id=body.company_id,
                         changes={"erp_po_code": body.erp_po_code, "lines_created": result["lines_created"],
                                  "units_created": result["units_created"]})
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
