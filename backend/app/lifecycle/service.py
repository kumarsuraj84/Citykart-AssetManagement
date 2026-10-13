from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.lifecycle.models import AssetEvent
from app.lifecycle.schemas import AssetEventOut
from app.lifecycle.state_machine import NO_DESTINATION_EVENTS, LifecycleError, label_for_event, transition

UNKNOWN_ASSET_USER_NAME = "unknown asset user"


async def with_labels(session: AsyncSession, events: list[AssetEvent]) -> list[AssetEventOut]:
    """Attaches the human-readable custody label (spec §5: "Allotted to {name}",
    "Returned to {name}", "Transferred from {a} to {b}", ...) to each event.
    label_for_event picks the wording from the from/to asset_users' *types*; the names
    are then substituted in here, so the timeline reads like a custody story instead
    of raw event_type/status codes. One query loads every referenced asset_user.

    AM-12: moved here from app.lifecycle.router (its original, single caller) so
    the Dashboard's Recent Activity feed (app.reports.dashboard_service) can reuse
    the exact same snapshot-correct labeling instead of duplicating it."""
    asset_user_ids = {hid for e in events for hid in (e.from_asset_user_id, e.to_asset_user_id) if hid is not None}
    asset_users: dict[int, AssetUser] = {}
    if asset_user_ids:
        rows = (await session.execute(select(AssetUser).where(AssetUser.id.in_(asset_user_ids)))).scalars().all()
        asset_users = {h.id: h for h in rows}

    out: list[AssetEventOut] = []
    for e in events:
        from_h = asset_users.get(e.from_asset_user_id) if e.from_asset_user_id is not None else None
        to_h = asset_users.get(e.to_asset_user_id) if e.to_asset_user_id is not None else None
        # Prefer the point-in-time snapshot taken when the event was recorded (AM-01) so a
        # later asset_user rename doesn't retroactively rewrite this label; only rows written
        # before the snapshot column existed fall back to today's live asset_user name.
        from_name = e.from_asset_user_name_snapshot or (from_h.name if from_h else None) or UNKNOWN_ASSET_USER_NAME
        to_name = e.to_asset_user_name_snapshot or (to_h.name if to_h else None) or UNKNOWN_ASSET_USER_NAME
        try:
            template = label_for_event(
                e.event_type, from_h.asset_user_type if from_h else None, to_h.asset_user_type if to_h else None,
            )
            label = template.format(**{"from": from_name, "to": to_name})
        except LifecycleError:
            label = e.event_type.replace("_", " ").capitalize()
        out.append(AssetEventOut.model_validate(e).model_copy(update={"label": label}))
    return out


async def apply_event(
    session: AsyncSession,
    asset: Asset,
    event_type: str,
    to_asset_user_id: int | None,
    actor: AssetUser,
    event_date: datetime | None = None,
    remarks: str | None = None,
    reference_no: str | None = None,
) -> AssetEvent:
    """The only function allowed to write asset.status/current_asset_user_id/status_since and
    insert into asset_event (see backend/app/lifecycle/service.py module docstring in the
    task brief / spec §5). Every lifecycle transition — including the initial PROCURED/
    IMPORTED event created by app.assets.service.procure_assets — must go through here so
    the ledger (asset_event) and the asset's denormalized current-state columns never
    drift apart.

    S4: this is `apply_events` for one asset -- the same code, so the single and the batch
    path can never apply different rules.
    """
    [event] = await apply_events(
        session, [(asset, to_asset_user_id)], event_type, actor,
        event_date=event_date, remarks=remarks, reference_no=reference_no,
    )
    return event


async def apply_events(
    session: AsyncSession,
    moves: list[tuple[Asset, int | None]],
    event_type: str,
    actor: AssetUser,
    event_date: datetime | None = None,
    remarks: str | None = None,
    reference_no: str | None = None,
) -> list[AssetEvent]:
    """S4: the batch entry point of the ledger -- `apply_event`'s rules, validations and name
    snapshots applied to many assets at once, for the receipt of a whole delivery (each new asset
    still gets its own PROCURED event). Together with `apply_event` (which IS this function for one
    asset) it is the only writer of asset.status / current_asset_user_id / status_since and of
    asset_event.

    `moves` = (asset, destination id) pairs; one event type, actor, date, remarks and reference for
    all of them. Constant work per batch instead of per asset: one query for the assets' last
    events, one for every holder involved, one INSERT for the events. All-or-nothing: every asset is
    checked first and the first refusal raises LifecycleError before anything is written."""
    event_date = event_date or datetime.now(timezone.utc)
    # AM-09: a caller-supplied event_date with no offset (Pydantic parses a
    # bare "2025-06-01" or "2025-06-01T00:00:00" into a naive datetime,
    # confirmed directly) used to crash the `event_date > now` comparison
    # below with an unhandled TypeError -- a raw 500 for input that isn't
    # actually malformed, just missing a timezone. The real frontend always
    # sends `.toISOString()` (always UTC, always offset-aware), so this only
    # affected a direct API caller, but "no offset" is a legitimate ISO-8601
    # datetime, not adversarial input, and deserves a controlled response
    # (or, here, just correct handling) rather than a crash. A naive value is
    # treated as UTC, matching the frontend's own convention.
    if event_date.tzinfo is None:
        event_date = event_date.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if event_date > now:
        raise LifecycleError("The date cannot be in the future.")

    # S0.4: an event that by definition has no destination (repair, lost,
    # disposed, sold, scrapped, a correction note) must never change who holds
    # the asset -- refused rather than silently ignored, so a caller that sent
    # one learns that it had no effect.
    if event_type in NO_DESTINATION_EVENTS and any(to_id is not None for _, to_id in moves):
        raise LifecycleError("This action does not send the asset anywhere, so do not choose a destination.")
    # (A destination event without a destination is refused by `transition`
    # with "Choose where the asset is going." after the status checks.)
    if not moves:
        return []
    # S7 (P1-2): everything pending is written first, so the locking read below can never overwrite it.
    await session.flush()
    asset_ids = [asset.id for asset, _ in moves]
    if len(set(asset_ids)) != len(asset_ids):
        raise LifecycleError("The same asset was chosen twice.")

    # S7 (P1-2): lock the assets' rows for this transaction (SELECT ... FOR UPDATE, in id order so two batches
    # over the same assets can never deadlock) and re-read their CURRENT status and holder under the lock.
    # Two requests that both read "in stock" a moment ago can then no longer both record "sent for repair":
    # the second waits for the first to finish and is checked against what the first wrote.
    locked = {a.id: a for a in (await session.execute(
        select(Asset).where(Asset.id.in_(sorted(asset_ids))).order_by(Asset.id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalars().all()}
    moves = [(locked.get(asset.id, asset), to_id) for asset, to_id in moves]

    # Each asset's last recorded event -- one query for the whole batch.
    last_events: dict[int, AssetEvent] = {
        e.asset_id: e for e in (await session.execute(
            select(AssetEvent)
            .where(AssetEvent.asset_id.in_(asset_ids))
            .distinct(AssetEvent.asset_id)
            .order_by(AssetEvent.asset_id, AssetEvent.event_date.desc(), AssetEvent.id.desc())
        )).scalars().all()
    }
    # Every destination, and every current holder (loaded purely for the display-snapshot below --
    # see AssetEvent.from_asset_user_name_snapshot's docstring: asset.current_asset_user_id itself is
    # what gets written as from_asset_user_id; this only resolves its *name at this point in time*),
    # in one query.
    holder_ids = {to_id for _, to_id in moves if to_id is not None}
    holder_ids |= {asset.current_asset_user_id for asset, _ in moves if asset.current_asset_user_id is not None}
    holders: dict[int, AssetUser] = {}
    if holder_ids:
        holders = {u.id: u for u in (await session.execute(
            select(AssetUser).where(AssetUser.id.in_(holder_ids))
        )).scalars().all()}

    planned: list[tuple[Asset, int | None, AssetEvent, str, datetime]] = []
    for asset, to_asset_user_id in moves:
        when = event_date
        last_event = last_events.get(asset.id)
        if last_event and when < last_event.event_date:
            if when.date() < last_event.event_date.date():
                raise LifecycleError(
                    "The date cannot be before the asset's last recorded movement "
                    f"({last_event.event_date.date().strftime('%d-%m-%Y')})."
                )
            # Same day, earlier clock time (a date picked without a time is
            # midnight): record it at the last event's own time so the ledger
            # order stays right, instead of refusing today's date.
            when = last_event.event_date

        to_asset_user_type = None
        to_asset_user = None
        if to_asset_user_id is not None:
            to_asset_user = holders.get(to_asset_user_id)
            if to_asset_user is None:
                raise LifecycleError("The destination you chose does not exist.")
            if not to_asset_user.is_active:
                raise LifecycleError(f"{to_asset_user.name} is no longer active, so assets cannot be sent there.")
            if to_asset_user.company_id != asset.company_id:
                raise LifecycleError("Assets can only move within their own company.")
            to_asset_user_type = to_asset_user.asset_user_type

        from_asset_user = holders.get(asset.current_asset_user_id) if asset.current_asset_user_id is not None else None

        new_status = transition(asset.status, event_type, to_asset_user_type, actor.role)

        event = AssetEvent(
            asset_id=asset.id,
            event_type=event_type,
            event_date=when,
            from_asset_user_id=asset.current_asset_user_id,
            to_asset_user_id=to_asset_user_id,
            from_asset_user_name_snapshot=from_asset_user.name if from_asset_user else None,
            to_asset_user_name_snapshot=to_asset_user.name if to_asset_user else None,
            status_after=new_status,
            remarks=remarks,
            reference_no=reference_no,
            recorded_by=actor.id,
            recorded_at=now,
        )
        planned.append((asset, to_asset_user_id, event, new_status, when))

    # Every asset passed: write the events and the assets' current state.
    session.add_all([event for _, _, event, _, _ in planned])
    for asset, to_asset_user_id, _event, new_status, when in planned:
        # S0.4: status_since only moves on a real change -- a new status or a new
        # holder. A correction note (and any event that changes neither) leaves it
        # exactly as it was.
        really_changed = new_status != asset.status or (
            to_asset_user_id is not None and to_asset_user_id != asset.current_asset_user_id
        )
        asset.status = new_status
        if to_asset_user_id is not None and event_type != "CORRECTION":
            asset.current_asset_user_id = to_asset_user_id
        # asset.status_since is a Date column (the custody/status change is dated, not
        # timestamped) while event_date is a timezone-aware datetime; store just the date
        # part so the assigned value's type actually matches the column.
        if really_changed and event_type != "CORRECTION":
            asset.status_since = when.date()

    await session.flush()
    return [event for _, _, event, _, _ in planned]
