from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import (
    WRITE_ROLES, allowed_asset_domains, check_work_area, ensure_company_in_scope, get_current_asset_user,
    has_both_work_areas, is_self_service, require_role, scoped_company_ids,
)
from app.core.validation import (
    InModel, MAX_AMOUNT, MAX_BULK_IDS, MAX_WARRANTY_YEARS, not_in_future, parse_work_area,
)
from app.asset_users.kinds import parse_holder_type
from app.assets.audit_service import AUDITED_SCALAR_FIELDS, record_field_changes
from app.assets.correction_service import correct_asset, UNSET as CORRECTION_UNSET
from app.assets.custom_field_values import validate_custom_field_values
from app.assets.labels import asset_label_rows
from app.assets.models import Asset, AssetFieldChange
from app.assets.schemas import (
    SerialFillIn, AssetCorrectionIn, AssetCreateIn, AssetDetailOut, AssetFieldChangeOut, AssetOut, AssetUpdateIn,
    SerialBulkIn, SerialBulkOut, SerialFilledOut, with_labels,
)
from app.assets.search_service import search_assets
from app.assets.service import (
    check_serial_number_unique, compute_tax, compute_warranty_upto, find_serials_in_use, procure_assets, serial_key,
)
from app.items.lookup import fill_from_item
from app.asset_users.models import AssetUser
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError
from app.masters.models import AssetCategory, Brand, Vendor
from app.reports.export_service import asset_label_png, asset_qr_png
from app.observability import audit as obs_audit
from app.observability import events as obs_events
from app.observability.events import asset_snapshot, lifecycle_summary

router = APIRouter(prefix="/api/assets", tags=["assets"])


MAX_PAGE = 200
MAX_IDS_PAGE = 1000     # S6: `ids` (and then `limit`) up to the bulk limit, for a whole receipt's labels


class AssetListOut(BaseModel):
    items: list[AssetOut]
    total: int


class BulkMoveIn(InModel):
    # S0.2: at most 1,000 assets per request.
    asset_ids: list[int] = Field(max_length=MAX_BULK_IDS)
    to_asset_user_id: int
    # S6: optional, the same for every asset (as on the single-asset event): the day it happened (not in
    # the future, not before an asset's last recorded movement -> that asset fails with the sentence) and
    # a reference such as a gate pass number. Left out: now / none, exactly as before.
    event_date: datetime | None = None
    reference_no: str | None = Field(default=None, max_length=100)


class BulkMoveOut(BaseModel):
    moved: int
    failed: list[dict]


class BulkActionIn(InModel):
    """AM-20: the Asset Movement console -- scan a batch of assets by Serial
    Number/Asset Code, pick ONE action and (for the actions that need one) ONE
    destination AssetUser for the whole batch, apply to all of them at once.
    `event_type` is any of actionRules.ts's own set (MOVED/SENT_FOR_REPAIR/
    LOST/DISPOSED/SOLD/SCRAPPED/RECEIVED_FROM_REPAIR/FOUND) -- the backend
    state machine (app.lifecycle.state_machine.transition) remains the real
    authority on which is actually legal from each asset's current status,
    exactly as it already is for the single-asset action buttons."""
    asset_ids: list[int] = Field(max_length=MAX_BULK_IDS)
    event_type: str = Field(max_length=30)
    to_asset_user_id: int | None = None
    remarks: str | None = Field(default=None, max_length=1000)
    # S6: see BulkMoveIn -- one date and one reference for the whole batch, checked per asset.
    event_date: datetime | None = None
    reference_no: str | None = Field(default=None, max_length=100)


class BulkActionOut(BaseModel):
    done: int
    failed: list[dict]


@router.post("", response_model=list[AssetOut], status_code=201)
async def create_asset(
    body: AssetCreateIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    # Write-scope check: an IT_TEAM actor can only *read* their own company's data,
    # so they must not be able to create assets in any other company either.
    await ensure_company_in_scope(session, actor, body.company_id)
    data = body.model_dump()
    # Purchase Date is Invoice Date when Invoice Date is known
    # (docs/ai/DECISIONS.md) -- never accepted from the client (AssetCreateIn
    # has no purchase_date field at all), derived here the same way
    # deliver_pending_assets derives it for the PO path. AM-19: Invoice Date
    # is now optional (ground reality -- it often isn't in hand yet when the
    # physical asset is logged); when it's missing, Purchase Date falls back
    # to today, the day the asset is actually being logged.
    data["purchase_date"] = data["invoice_date"] or date.today()
    try:
        # The Item (when given) decides Category and Sub-Category, whatever the client sent.
        await fill_from_item(session, data)
        # S0.3: the asset's work area (its Category's) must be the caller's.
        category = await session.get(AssetCategory, data["category_id"]) if data.get("category_id") else None
        if category is not None:
            check_work_area(await allowed_asset_domains(session, actor), category.asset_domain)
        # AM-19: quantity is gone -- every call creates exactly one asset.
        # S0.6: every master chosen here is a new choice -> must be active.
        assets = await procure_assets(session, data, quantity=1, actor=actor, require_active=True)
    except (ValueError, LifecycleError) as exc:
        # e.g. no active code rule, an unresolvable code-rule token, initial asset_user /
        # cost center from another company, a future purchase date -- all problems
        # with the request, not server faults, so a clean 422 instead of a raw 500.
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    # S8: assets are written with one bulk INSERT (not seen by the automatic audit): the CREATE row here.
    for a in assets:
        obs_audit.record(session, "DATA", "CREATE", f"Asset '{a.asset_code}' created ({a.description}).",
                         entity="asset", entity_id=a.id, company_id=a.company_id, changes=asset_snapshot(a))
    await session.commit()
    for a in assets:
        await session.refresh(a)
    return assets


@router.get("", response_model=AssetListOut)
async def list_assets(
    status: str | None = Query(None),
    category_id: int | None = Query(None),
    asset_user_id: int | None = Query(None),
    company_id: int | None = Query(None),
    domain: str | None = Query(None),
    q: str | None = Query(None, max_length=200),
    exact: bool = Query(False),
    serial_pending: bool = Query(False),
    item_id: int | None = Query(None),
    ids: str | None = Query(None, description="comma-separated asset ids (at most 1,000), for printing labels of a known set"),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    holder_type: str | None = Query(None, max_length=30),
    holder_id: int | None = Query(None),
    vendor_id: int | None = Query(None),
    po_number: str | None = Query(None, max_length=100),
    work_area: str | None = Query(None, max_length=10),
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    """`exact=true` makes `q` match whole identifiers (code or its last segment,
    serial, barcode, ERP item code, PO/invoice/PI no) instead of any text containing it.
    S5: without it `q` also finds the Item's, vendor's, brand's and holder's names (and the
    holder's code), and -- when no sort column is chosen -- lists exact identifier matches
    first, then values starting with the text, then the rest. New filters: `holder_type`
    (employee / store / stock room / install point), `holder_id` (= `asset_user_id`),
    `vendor_id`, `po_number` (whole PO number, any case), `work_area` (= `domain`).
    Scoped exactly like `_get_scoped_asset`: a SELF_SERVICE asset_user only ever sees
    assets they currently hold (so `asset_user_id` is pinned to their own id, ignoring
    any value the caller passed, and the company filter is left unrestricted since
    asset_user_id already narrows it); everyone else is scoped to `scoped_company_ids`
    (None = ADMIN, unrestricted) AND `allowed_asset_domains` (None = ADMIN/SELF_SERVICE
    unrestricted, spec §14/§15 -- an OPERATOR/VIEWER can never widen past their own
    configured domain by passing a `domain` outside it, see search_assets). AM-21:
    `sort_by` must be one of search_assets.SORTABLE_COLUMNS -- an unrecognized value is
    silently ignored (falls back to the existing newest-first order) rather than a 422,
    so an old cached frontend bundle or a stale saved link never breaks."""
    if holder_id is not None and asset_user_id is None:
        asset_user_id = holder_id
    if is_self_service(asset_user):
        asset_user_id = asset_user.id
        allowed = None
    else:
        allowed = await scoped_company_ids(session, asset_user)
    domains = await allowed_asset_domains(session, asset_user)
    try:
        wanted_holder_type = parse_holder_type(holder_type)
        wanted_domain = parse_work_area(work_area) or domain
    except ValueError as exc:
        raise HTTPException(422, str(exc))   # `status` is the query parameter here, not the http module
    id_list: list[int] | None = None
    if ids is not None:
        try:
            id_list = [int(part) for part in ids.split(",") if part.strip()]
        except ValueError:
            raise HTTPException(422, "ids must be comma-separated numbers")
        if len(id_list) > MAX_IDS_PAGE:
            raise HTTPException(422, f"You can open at most {MAX_IDS_PAGE:,} assets at a time.")
    # S6: an ordinary page is at most 200 rows; up to 1,000 only for a known set of ids (labels / "Open
    # assets" after a large receipt).
    if limit > MAX_PAGE and id_list is None:
        raise HTTPException(422, f"At most {MAX_PAGE} assets can be listed per page.")
    items, total = await search_assets(
        session, allowed, status, category_id, asset_user_id, company_id, q, sort_by, sort_dir, limit, offset,
        allowed_domains=domains, domain=wanted_domain, exact=exact, serial_pending=serial_pending or None,
        item_id=item_id, ids=id_list, vendor_id=vendor_id, po_number=po_number, holder_type=wanted_holder_type,
    )
    # S5: every name on the page from ONE query (app.assets.labels), however many rows.
    labels = await asset_label_rows(session, [a.id for a in items])
    return AssetListOut(items=[with_labels(a, labels.get(a.id)) for a in items], total=total)


async def _bulk_apply_event(
    asset_ids: list[int], event_type: str, to_asset_user_id: int | None, remarks: str | None,
    session: AsyncSession, actor, event_date: datetime | None = None, reference_no: str | None = None,
) -> tuple[int, list[dict]]:
    """Shared by /bulk-move (MOVED only, kept for backward compatibility with
    the Asset Register's existing bulk-move) and /bulk-action (AM-20, any
    event type). One asset's failure never aborts the rest of the batch --
    each is its own try/except, matching the original bulk_move's own
    reasoning: a scan/checkbox session naturally mixes a few ineligible or
    out-of-scope assets in with many valid ones, and losing the whole batch
    over one bad item would be far worse than reporting it and moving on."""
    done = 0
    failed: list[dict] = []
    wanted = list(dict.fromkeys(asset_ids))
    # S7 (P1-2): lock every chosen asset row up front, in id order (two overlapping bulk moves can then never
    # deadlock, and a second identical request waits and is checked against what the first one wrote).
    # apply_event re-reads each asset under the lock before checking the move.
    if wanted:
        await session.execute(
            select(Asset.id).where(Asset.id.in_(sorted(wanted))).order_by(Asset.id).with_for_update()
        )
    for asset_id in wanted:
        try:
            asset = await _get_scoped_asset(asset_id, session, actor)
        except HTTPException:
            # Out of scope or already soft-deleted -- same fail-closed-to-404 behaviour
            # as every other asset endpoint (spec: scoping fails closed), reported here as
            # a per-item failure so one out-of-scope id doesn't abort the rest of the batch.
            failed.append({"asset_id": asset_id, "reason": "not found"})
            continue
        try:
            # Each asset in its own savepoint: one refusal never leaves a
            # half-written event behind for the others' commit.
            async with session.begin_nested():
                await apply_event(session, asset, event_type, to_asset_user_id=to_asset_user_id, actor=actor,
                                  remarks=remarks, event_date=event_date, reference_no=reference_no)
            done += 1
        except LifecycleError as exc:
            failed.append({"asset_id": asset_id, "reason": str(exc)})
    return done, failed


@router.post("/bulk-move", response_model=BulkMoveOut)
async def bulk_move(
    body: BulkMoveIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    moved, failed = await _bulk_apply_event(body.asset_ids, "MOVED", body.to_asset_user_id, None, session, actor,
                                            event_date=body.event_date, reference_no=body.reference_no)
    await lifecycle_summary(session, "MOVE", "MOVED", body.asset_ids, failed, body.to_asset_user_id, body.reference_no)
    await session.commit()
    return BulkMoveOut(moved=moved, failed=failed)


@router.post("/bulk-action", response_model=BulkActionOut)
async def bulk_action(
    body: BulkActionIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    done, failed = await _bulk_apply_event(
        body.asset_ids, body.event_type, body.to_asset_user_id, body.remarks, session, actor,
        event_date=body.event_date, reference_no=body.reference_no,
    )
    await lifecycle_summary(session, "MOVE" if body.event_type == "MOVED" else body.event_type, body.event_type,
                            body.asset_ids, failed, body.to_asset_user_id, body.reference_no)
    await session.commit()
    return BulkActionOut(done=done, failed=failed)


async def _get_scoped_asset(asset_id: int, session: AsyncSession, asset_user) -> Asset:
    asset = await session.get(Asset, asset_id)
    if asset is None or asset.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    if is_self_service(asset_user):
        if asset.current_asset_user_id != asset_user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        return asset

    allowed_companies = await scoped_company_ids(session, asset_user)
    if allowed_companies is not None and asset.company_id not in allowed_companies:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    domains = await allowed_asset_domains(session, asset_user)
    if domains is not None and asset.asset_domain not in domains:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return asset


async def _to_detail_out(session: AsyncSession, asset: Asset) -> AssetDetailOut:
    """AM-04 §25: Asset 360 needs human-readable labels, not bare IDs. S5: every
    name from the same single label query the register uses (app.assets.labels)."""
    labels = (await asset_label_rows(session, [asset.id])).get(asset.id, {})
    return with_labels(
        asset, labels, AssetDetailOut,
        location_name=labels.get("holder_location_name"), department_name=labels.get("holder_department_name"),
    )


@router.get("/{asset_id}", response_model=AssetDetailOut)
async def get_asset(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    asset = await _get_scoped_asset(asset_id, session, asset_user)
    return await _to_detail_out(session, asset)


@router.get("/{asset_id}/changes", response_model=list[AssetFieldChangeOut])
async def list_asset_changes(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    """AM-04 §23: read surface for the field-change audit -- scoped exactly
    like viewing the asset itself (same _get_scoped_asset), so a ASSET_USER sees
    only their own asset's history and no cross-company leakage is possible.
    Chronological, oldest first, matching the lifecycle Timeline's ordering."""
    asset = await _get_scoped_asset(asset_id, session, asset_user)
    stmt = (
        select(AssetFieldChange)
        .where(AssetFieldChange.asset_id == asset.id)
        .order_by(AssetFieldChange.created_at, AssetFieldChange.id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    actor_ids = {r.actor_id for r in rows}
    actors: dict[int, str] = {}
    if actor_ids:
        actor_rows = (await session.execute(select(AssetUser).where(AssetUser.id.in_(actor_ids)))).scalars().all()
        actors = {h.id: h.name for h in actor_rows}
    return [
        AssetFieldChangeOut.model_validate(r).model_copy(update={"actor_name": actors.get(r.actor_id)})
        for r in rows
    ]


async def _check_edit_values(session: AsyncSession, asset: Asset, data: dict) -> None:
    """S0.5/S0.6 for PUT /assets/{id}: only values this edit actually CHANGES are
    checked, so an asset that already holds an odd stored value (from before
    these rules) can still be edited. Raises a 422 with a plain sentence."""
    def changed(field: str) -> bool:
        old = getattr(asset, field)
        new = data.get(field)
        if old is None or new is None:
            return old is not new
        try:
            return float(old) != float(new)
        except (TypeError, ValueError):
            return old != new

    def refuse(message: str):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, message)

    # A serial can be corrected but never removed (use N/A for "has none").
    serial = (data.get("serial_number") or "").strip()
    data["serial_number"] = serial or None
    if not serial and (asset.serial_number or "").strip() and not asset.serial_pending:
        refuse("The serial number cannot be removed. Type N/A if the asset has none.")
    if not serial and not asset.serial_number and not asset.serial_pending:
        data["serial_number"] = asset.serial_number
    description = (data.get("description") or "").strip()
    if description != (asset.description or "").strip() and not description:
        refuse("Description cannot be blank.")
    if description:
        data["description"] = description
    for field, label in (("purchase_cost", "Purchase cost"), ("invoice_amount", "Invoice amount")):
        value = data.get(field)
        if changed(field) and value is not None and not (0 <= value <= MAX_AMOUNT):
            refuse(f"{label} must be between 0 and {MAX_AMOUNT:,}.")
    tax = data.get("tax_percent")
    if changed("tax_percent") and tax is not None and not (0 <= tax <= 100):
        refuse("Tax % must be between 0 and 100.")
    years = data.get("warranty_years")
    if years is not None and changed("warranty_years") and not (0 <= years <= MAX_WARRANTY_YEARS):
        refuse(f"Warranty years must be between 0 and {MAX_WARRANTY_YEARS}.")
    try:
        if changed("po_date"):
            not_in_future(data.get("po_date"), "PO date")
        if changed("invoice_date"):
            not_in_future(data.get("invoice_date"), "Invoice date")
    except ValueError as exc:
        refuse(str(exc))
    for field, model, what in (("vendor_id", Vendor, "vendor"), ("brand_id", Brand, "brand")):
        if data.get(field) is not None and changed(field):
            obj = await session.get(model, data[field])
            if obj is None:
                refuse(f"The {what} you chose does not exist.")
            if not obj.is_active:
                refuse(f"The {what} {obj.name} is no longer active; choose another.")


@router.put("/serials", response_model=SerialBulkOut)
async def fill_pending_serials(
    body: SerialBulkIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """S4: settles the pending serials of many assets at once (the Serial Pending screen after a
    receipt of 50 amplifiers): each entry a real serial, or `no_serial` (saved as N/A). Same rules as
    PUT /{id}/serial -- company and work-area scope, the asset's serial must be pending, global
    uniqueness (also among the entries themselves, any letter case; N/A never clashes), the same
    field-change audit. Everything is checked first: any problem -> 422 `{detail, errors, problems:
    [{entry_index, asset_id, serial?, message}]}` and nothing is saved; otherwise all are saved."""
    entries = body.entries
    assets = {a.id: a for a in (await session.execute(
        select(Asset).where(Asset.id.in_({e.asset_id for e in entries}))
    )).scalars().all()}
    allowed = await scoped_company_ids(session, actor)
    domains = await allowed_asset_domains(session, actor)

    def reachable(asset: Asset | None) -> bool:
        return (asset is not None and asset.deleted_at is None
                and (allowed is None or asset.company_id in allowed)
                and (domains is None or asset.asset_domain in domains))

    problems: list[dict] = []
    seen_ids: set[int] = set()
    seen_serials: dict[str, int] = {}
    planned: list[tuple[int, Asset, str]] = []
    for index, entry in enumerate(entries, start=1):
        def refuse(message: str, serial: str | None = None):
            row = {"entry_index": index, "asset_id": entry.asset_id, "message": message}
            if serial is not None:
                row["serial"] = serial
            problems.append(row)
        if entry.asset_id in seen_ids:
            refuse("This asset appears more than once; enter it once.")
            continue
        seen_ids.add(entry.asset_id)
        asset = assets.get(entry.asset_id)
        if not reachable(asset):
            refuse("This asset was not found.")
            continue
        if not asset.serial_pending:
            refuse(f"The serial number of {asset.asset_code} is not waiting to be entered.")
            continue
        serial = "N/A" if entry.no_serial else (entry.serial_number or "").strip()
        if not serial:
            refuse(f"Enter the serial number of {asset.asset_code}, or choose no serial number.")
            continue
        key = serial_key(serial)
        if key is not None:
            if key in seen_serials:
                refuse(f"Serial number {serial} is typed more than once (entries {seen_serials[key]} and {index}).", serial)
                continue
            seen_serials[key] = index
        planned.append((index, asset, serial))

    in_use = {serial_key(s): code for s, code in await find_serials_in_use(session, [s for _, _, s in planned])}
    if in_use:
        rows = (await session.execute(
            select(Asset.asset_code, Asset.company_id, Asset.asset_domain).where(Asset.asset_code.in_(set(in_use.values())))
        )).all()
        visible = {code for code, company_id, domain in rows
                   if (allowed is None or company_id in allowed) and (domains is None or domain in domains)}
        for index, asset, serial in planned:
            code = in_use.get(serial_key(serial))
            if code is not None:
                holder = f"asset {code}" if code in visible else "an asset outside your companies or work area"
                problems.append({"entry_index": index, "asset_id": asset.id, "serial": serial,
                                 "message": f"Serial number {serial} is already used by {holder}."})
    if problems:
        problems.sort(key=lambda p: p["entry_index"])
        sentences = [f"Entry {p['entry_index']}: {p['message']}" for p in problems]
        detail = sentences[0] if len(sentences) == 1 else (
            f"Nothing was saved: {len(sentences)} problems need fixing. {sentences[0]}"
        )
        return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            content={"detail": detail, "errors": sentences, "problems": problems})

    results: list[SerialFilledOut] = []
    # S8: one summary row (the field-change audit keeps the per-asset detail).
    obs_audit.suppress(session, "asset")
    obs_audit.record(session, "DATA", "SERIALS_FILLED",
                     f"{obs_events.who()} filled in the pending serial numbers of "
                     f"{obs_events.plural(len(planned), 'asset')}.", entity="asset",
                     entity_id=planned[0][1].id if len(planned) == 1 else None,
                     changes={**obs_events.ids_preview([a.id for _, a, _ in planned]),
                              "no_serial": sum(1 for _, _, s in planned if s == "N/A")})
    for _index, asset, serial in planned:
        before = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
        before["custom_fields"] = dict(asset.custom_fields)
        asset.serial_number = serial
        asset.serial_pending = False
        asset.updated_by = actor.id
        after = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
        after["custom_fields"] = dict(asset.custom_fields)
        await record_field_changes(session, asset_id=asset.id, actor_id=actor.id, before=before, after=after)
        results.append(SerialFilledOut(asset_id=asset.id, asset_code=asset.asset_code, serial_number=serial))
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return SerialBulkOut(updated=len(results), results=results)


@router.put("/{asset_id}", response_model=AssetDetailOut)
async def update_asset(
    asset_id: int,
    body: AssetUpdateIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """AM-02: the first general edit surface for an asset's EDITABLE DESCRIPTIVE
    DATA (see the Asset Field Policy Matrix in docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md)
    -- previously there was no way to correct e.g. a mistyped serial number or
    add a PI Number after the fact without going through a lifecycle event,
    which this deliberately is not: no asset_event row is written, no status/
    asset_user change happens, nothing here touches the ledger. Identity fields
    (asset_code/company_id/cost_center_id) aren't in AssetUpdateIn at all --
    trg_asset_no_identity_change would reject them at the database level even
    if they were.

    AM-04: required-active-custom-field completeness is only enforced when
    this edit itself includes `custom_fields` -- an asset that predates a
    newly-added required UDF must not be blocked from an unrelated edit (e.g.
    fixing a serial number) solely because it has no value for that field
    yet (docs/ai/DECISIONS.md). Also writes one AssetFieldChange row per
    genuinely changed field, in the same transaction as the edit (committed
    together below, never separately)."""
    asset = await _get_scoped_asset(asset_id, session, actor)
    data = body.model_dump()
    # S0.5: an edit that does not mention the serial keeps it (it used to
    # clear it); an edit that sends it blank is refused in _check_edit_values.
    if "serial_number" not in body.model_fields_set:
        data["serial_number"] = asset.serial_number
    await _check_edit_values(session, asset, data)
    replacing_custom_fields = data.get("custom_fields") is not None
    try:
        await validate_custom_field_values(
            session, data.get("custom_fields"), company_id=asset.company_id,
            enforce_required=replacing_custom_fields,
        )
        # Only re-checked when the edit actually changes the value -- an
        # untouched serial_number (already this asset's own) must never
        # conflict with itself (exclude_asset_id).
        if data.get("serial_number") != asset.serial_number:
            await check_serial_number_unique(session, data.get("serial_number"), exclude_asset_id=asset.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    before = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
    before["custom_fields"] = dict(asset.custom_fields)

    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))

    for field in (
        "legacy_asset_code", "brand_id", "model", "serial_number", "barcode", "description",
        "vendor_id", "po_number", "po_date", "invoice_number", "invoice_date", "invoice_amount",
        "pi_number", "pi_date", "purchase_cost", "tax_percent",
    ):
        setattr(asset, field, data[field])
    # Typing a serial (or N/A) on an asset whose serial was pending settles it.
    if asset.serial_pending and (asset.serial_number or "").strip():
        asset.serial_pending = False
    asset.tax_amount = tax_amount
    asset.total_cost = total_cost
    # AM-18: None means "leave exactly as-is" -- a legacy NULL-warranty_years
    # asset's existing warranty_upto (manually entered or NULL, from before
    # this feature existed) is never touched by an edit that doesn't mention
    # warranty at all. An explicit int (0 or more) recomputes both.
    if data["warranty_years"] is not None:
        asset.warranty_years = data["warranty_years"]
        asset.warranty_upto = compute_warranty_upto(asset.purchase_date, data["warranty_years"])
    if replacing_custom_fields:
        asset.custom_fields = data["custom_fields"]
    asset.updated_by = actor.id

    after = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
    after["custom_fields"] = dict(asset.custom_fields)
    await record_field_changes(session, asset_id=asset.id, actor_id=actor.id, before=before, after=after)

    await session.commit()
    await session.refresh(asset)
    return await _to_detail_out(session, asset)


@router.put("/{asset_id}/serial", response_model=AssetDetailOut)
async def fill_pending_serial(
    asset_id: int,
    body: SerialFillIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Settles an asset whose serial was pending: the serial read from the opened
    box, or "no serial" when it turns out to have none (saved as N/A). Same scope as
    any other asset edit (company and Responsibility), same global-uniqueness rule,
    and the change is written to the field-change audit like an ordinary edit."""
    asset = await _get_scoped_asset(asset_id, session, actor)
    if not asset.serial_pending:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "this asset's serial is not pending")
    serial = "N/A" if body.no_serial else (body.serial_number or "").strip()
    if not serial:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "enter the serial number, or choose no serial number")
    try:
        await check_serial_number_unique(session, serial, exclude_asset_id=asset.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    before = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
    before["custom_fields"] = dict(asset.custom_fields)
    asset.serial_number = serial
    asset.serial_pending = False
    asset.updated_by = actor.id
    after = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
    after["custom_fields"] = dict(asset.custom_fields)
    await record_field_changes(session, asset_id=asset.id, actor_id=actor.id, before=before, after=after)
    await session.commit()
    await session.refresh(asset)
    return await _to_detail_out(session, asset)


@router.post("/{asset_id}/corrections", response_model=AssetDetailOut)
async def correct_asset_classification(
    asset_id: int,
    body: AssetCorrectionIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """AM-07: a deliberately separate, narrower operation from
    `PUT /api/assets/{id}` for correcting Category, Subcategory, and/or
    Purchase Date -- the three fields `AssetUpdateIn` has excluded since
    AM-02 precisely because they're controlled master/date references, not
    ordinary descriptive data. Same scoping as every other asset-mutation
    endpoint (`_get_scoped_asset`): a ASSET_USER never reaches this route at all
    (`require_role` gate), and IT_TEAM can only correct an asset already
    inside their own company scope. `body.model_fields_set` is what tells
    "this field wasn't part of the request" apart from "explicitly set to
    null" -- see `AssetCorrectionIn`'s own docstring."""
    asset = await _get_scoped_asset(asset_id, session, actor)
    fields_set = body.model_fields_set
    # Spec §44: correcting asset_domain (Responsibility) is ADMIN only --
    # stricter than the ADMIN+OPERATOR gate the rest of this endpoint uses
    # for Category/Subcategory/Purchase Date, which predates the domain
    # rebuild and is left unchanged.
    if "asset_domain" in fields_set and actor.role != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin can correct an asset's work area (IT / Non-IT).")
    # S0.3: moving an asset between IT and Non-IT -- directly, or by giving it
    # a Category of the other work area -- needs someone who handles both: the
    # head-office admin or an admin not limited to one work area.
    crosses_area = "asset_domain" in fields_set and body.asset_domain != asset.asset_domain
    if "category_id" in fields_set and body.category_id is not None:
        new_category = await session.get(AssetCategory, body.category_id)
        if new_category is not None and new_category.asset_domain != asset.asset_domain:
            crosses_area = True
    if crosses_area and not await has_both_work_areas(session, actor):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Moving an asset between IT and Non-IT needs the head-office admin or an admin who handles both.",
        )
    try:
        await correct_asset(
            session, asset, actor,
            category_id=body.category_id if "category_id" in fields_set else CORRECTION_UNSET,
            subcategory_id=body.subcategory_id if "subcategory_id" in fields_set else CORRECTION_UNSET,
            purchase_date_value=body.purchase_date if "purchase_date" in fields_set else CORRECTION_UNSET,
            asset_domain=body.asset_domain if "asset_domain" in fields_set else CORRECTION_UNSET,
            reason=body.reason,
        )
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    asset.updated_by = actor.id
    await session.commit()
    await session.refresh(asset)
    return await _to_detail_out(session, asset)


@router.delete("/{asset_id}", status_code=204)
async def delete_asset_entry_mistake(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN")),
):
    """Soft-deletes an asset created by data-entry mistake. Only allowed while the asset
    still has just its original PROCURED/IMPORTED event — once it has moved, been repaired
    or been disposed, that history is real and must stay visible; use the DISPOSED/SCRAPPED/
    LOST lifecycle events instead (spec §7 "nothing is hard-deleted")."""
    from app.lifecycle.models import AssetEvent

    asset = await session.get(Asset, asset_id)
    if asset is None or asset.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    event_count = (await session.execute(
        select(func.count()).select_from(AssetEvent).where(AssetEvent.asset_id == asset_id)
    )).scalar_one()
    if event_count > 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "This asset already has movement history; it cannot be deleted, only disposed/scrapped/lost")

    asset.deleted_at = datetime.now(timezone.utc)
    asset.updated_by = actor.id
    await session.commit()


@router.get("/{asset_id}/qr.png")
async def asset_qr(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    """Goes through the same `_get_scoped_asset` every other `/api/assets/{id}/...`
    route uses (Task 16), so a ASSET_USER who doesn't currently hold this asset gets 404
    here exactly like they would from GET /api/assets/{id} -- a QR code is not a
    backdoor around asset scoping."""
    await _get_scoped_asset(asset_id, session, asset_user)
    return Response(content=asset_qr_png(asset_id), media_type="image/png")


@router.get("/{asset_id}/label.png")
async def asset_label(
    asset_id: int,
    symbol: str = Query("barcode", pattern="^(barcode|qr)$"),
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    """Print Labels (bulk physical tagging): a linear Code128 barcode
    (default) or a QR code, either way encoding this asset's bare
    `asset_code` -- deliberately NOT `/qr.png` above, which encodes a deep
    link for a different purpose (open the asset's page) and is left
    untouched. Same `_get_scoped_asset` scoping as every other
    `/api/assets/{id}/...` route -- a label image is not a backdoor around
    asset scoping either."""
    asset = await _get_scoped_asset(asset_id, session, asset_user)
    return Response(content=asset_label_png(asset.asset_code, symbol), media_type="image/png")
