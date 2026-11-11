"""AM-07: a controlled, explicit correction of an asset's Category,
Subcategory, and/or Purchase Date -- the three fields deliberately kept out
of `AssetUpdateIn`/`PUT /api/assets/{id}` since AM-02 (see the Asset Field
Policy Matrix). This is NOT a normal edit: it requires a mandatory reason,
never regenerates `asset_code` (the numbering service is never called
here), never touches lifecycle state (`status`/`current_asset_user_id`/
`status_since` -- `apply_event` is never called here either), and every
change it makes is written to `asset_field_change` with `reason` populated
(see `app.assets.audit_service.record_correction_changes`).

Invariants this enforces, each backed by an actual code path elsewhere in
this codebase (see `docs/ai/AM-07_ASSET_CORRECTION_WORKFLOW_REPORT.md` §6
for the full audit):

- Asset Code, Company, Cost Centre, Status, current AssetUser are never
  touched -- this module has no write path to any of them.
- A new Category/Subcategory must exist and be active.
- A Subcategory must belong to the *resulting* Category (new if provided,
  otherwise the asset's current one) -- never left as an invalid pair.
- A corrected Purchase Date can never land in the future (mirrors
  `app.lifecycle.service.apply_event`'s own "event date cannot be in the
  future" rule) and can never land after the asset's earliest recorded
  `asset_event` (mirrors that same function's "event date cannot be before
  the asset's last recorded event" rule, applied in the historical
  direction: a corrected purchase can't retroactively happen *after*
  activity the ledger already recorded against it). No existing
  `asset_event` row is ever modified -- that ledger stays append-only and
  untouched.
"""
from datetime import date, datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import uuid4

from sqlalchemy import text

from app.assets.audit_service import record_correction_changes
from app.core.validation import EARLIEST_PURCHASE_DATE
from app.assets.models import Asset, AssetFieldChange
from app.asset_users.models import AssetUser
from app.lifecycle.models import AssetEvent
from app.lifecycle.state_machine import STATUS_WORDS
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter

# Sentinel distinguishing "this field was not part of the request at all"
# from a real value (including `None`, which for subcategory_id means
# "clear it" -- a legitimate, different instruction).
UNSET = object()

REASON_MAX_LENGTH = 500


async def correct_asset(
    session: AsyncSession,
    asset: Asset,
    actor: AssetUser,
    *,
    category_id=UNSET,
    subcategory_id=UNSET,
    purchase_date_value=UNSET,
    asset_domain=UNSET,
    reason: str,
) -> int:
    """Raises ValueError (the same convention every other asset-mutation
    service in this codebase uses -- the router turns it into a 422) for
    any validation failure. Returns the number of `asset_field_change` rows
    written; the caller should treat 0 as impossible by this point (the
    no-op check below already rejects that case), but the audit function
    itself is the actual source of truth for what changed.
    """
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("a reason is required for this correction")
    if len(reason) > REASON_MAX_LENGTH:
        raise ValueError(f"reason must be at most {REASON_MAX_LENGTH} characters")

    if category_id is UNSET and subcategory_id is UNSET and purchase_date_value is UNSET and asset_domain is UNSET:
        raise ValueError("at least one of category_id, subcategory_id, purchase_date, or asset_domain must be provided")

    # ---- Category ----
    effective_category_id = asset.category_id
    if category_id is not UNSET:
        if category_id is None:
            raise ValueError("category_id cannot be cleared")
        category = await session.get(AssetCategory, category_id)
        if category is None or not category.is_active:
            raise ValueError("The category you chose does not exist or is no longer active.")
        effective_category_id = category_id

    # ---- Subcategory ----
    effective_subcategory_id = asset.subcategory_id
    if subcategory_id is not UNSET:
        effective_subcategory_id = subcategory_id
    if effective_subcategory_id is not None:
        subcategory = await session.get(AssetSubcategory, effective_subcategory_id)
        if subcategory is None or (not subcategory.is_active and effective_subcategory_id != asset.subcategory_id):
            raise ValueError("The sub-category you chose does not exist or is no longer active.")
        if subcategory.category_id != effective_category_id:
            if subcategory_id is UNSET:
                # The asset's *existing* subcategory no longer belongs to the
                # newly-requested category -- the caller must explicitly
                # supply a valid replacement or clear it (AM-07 §8), never
                # silently left as an invalid pair.
                raise ValueError(
                    "the asset's current subcategory does not belong to the new category; "
                    "supply a valid subcategory_id for the new category, or set subcategory_id to null"
                )
            raise ValueError("subcategory does not belong to the selected category")

    # ---- Purchase Date ----
    effective_purchase_date = asset.purchase_date
    if purchase_date_value is not UNSET:
        if purchase_date_value is None:
            raise ValueError("purchase_date cannot be cleared")
        if not isinstance(purchase_date_value, date):
            raise ValueError("purchase_date must be a valid date")
        now = datetime.now(timezone.utc)
        if datetime.combine(purchase_date_value, datetime.min.time()).replace(tzinfo=timezone.utc) > now:
            raise ValueError("The purchase date cannot be in the future.")
        # S0.5: a corrected purchase date before 1990 is a typo, not history.
        if purchase_date_value < EARLIEST_PURCHASE_DATE:
            raise ValueError(f"The purchase date cannot be before {EARLIEST_PURCHASE_DATE.strftime('%d-%m-%Y')}.")

        earliest_event_stmt = (
            select(AssetEvent)
            .where(AssetEvent.asset_id == asset.id)
            .order_by(AssetEvent.event_date.asc(), AssetEvent.id.asc())
        )
        earliest_event = (await session.execute(earliest_event_stmt)).scalars().first()
        if earliest_event is not None and purchase_date_value > earliest_event.event_date.date():
            raise ValueError(
                f"purchase date cannot be after the asset's earliest recorded event "
                f"({earliest_event.event_date.date().isoformat()})"
            )
        effective_purchase_date = purchase_date_value

    # ---- Asset Domain (Responsibility) ----
    # Spec §44: Normal Asset Edit must NOT modify asset_domain -- only this
    # Controlled Correction path can, ADMIN-only (enforced by the router),
    # with a mandatory reason like every other correction here. Never
    # rewrites the Category's own asset_domain (that's a separate, future-
    # only default, spec §43) -- this only re-snapshots THIS asset's own value.
    effective_asset_domain = asset.asset_domain
    if asset_domain is not UNSET:
        if asset_domain not in ("IT", "NON_IT"):
            raise ValueError("Choose a work area: IT or Non-IT.")
        effective_asset_domain = asset_domain

    if (
        effective_category_id == asset.category_id
        and effective_subcategory_id == asset.subcategory_id
        and effective_purchase_date == asset.purchase_date
        and effective_asset_domain == asset.asset_domain
    ):
        raise ValueError("no changes requested -- every provided value already matches the asset's current data")

    before = {
        "category_id": asset.category_id, "subcategory_id": asset.subcategory_id,
        "purchase_date": asset.purchase_date, "asset_domain": asset.asset_domain,
    }

    # Never asset_code/company_id/cost_center_id (trg_asset_no_identity_change
    # would reject those anyway), never status/current_asset_user_id/status_since
    # (apply_event's exclusive domain), never the numbering service.
    asset.category_id = effective_category_id
    asset.subcategory_id = effective_subcategory_id
    asset.purchase_date = effective_purchase_date
    asset.asset_domain = effective_asset_domain

    after = {
        "category_id": asset.category_id, "subcategory_id": asset.subcategory_id,
        "purchase_date": asset.purchase_date, "asset_domain": asset.asset_domain,
    }

    return await record_correction_changes(
        session, asset_id=asset.id, actor_id=actor.id, reason=reason, before=before, after=after,
    )


# ---- Release 2 (2026-11-11): owner company and cost centre -----------------------------------------------------------

OWNER_CORRECTION_SETTING = "ckam.owner_correction"
FINAL_STATUSES = ("SOLD", "SCRAPPED", "DISPOSED")


async def _set_owner_correction_marker(session: AsyncSession, on: bool) -> None:
    """Switches the owner-correction marker for the current transaction only (`set_config(..., true)` = SET LOCAL).
    The database trigger `forbid_asset_identity_change` (migration d7f9b1c3e5a7) refuses a change of company_id /
    cost_center_id unless it is on. Only `correct_owner` below switches it on."""
    await session.execute(
        text("SELECT set_config(:name, :value, true)"),
        {"name": OWNER_CORRECTION_SETTING, "value": "on" if on else "off"},
    )


async def correct_owner(
    session: AsyncSession, asset: Asset, actor: AssetUser, *, company_id: int, cost_center_id: int, reason: str,
) -> int:
    """Corrects the OWNER company and cost centre of an asset (the ones it was bought under): a platform-owner / Full
    Admin action, ALLOWED ONLY until the asset is sold, scrapped or disposed, with a mandatory reason; one
    `asset_field_change` row per changed field carries the reason, the old and the new value. The asset code never
    changes. Status, holder and every movement are untouched (`apply_events` is not called). Raises ValueError (the
    router turns it into a 422). Returns the number of history rows written. The caller checks the role."""
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("a reason is required for this correction")
    if len(reason) > REASON_MAX_LENGTH:
        raise ValueError(f"reason must be at most {REASON_MAX_LENGTH} characters")
    if asset.status in FINAL_STATUSES:
        raise ValueError(
            f"This asset has been {STATUS_WORDS.get(asset.status, asset.status.lower())}, "
            "so its owner company and cost centre can no longer be corrected."
        )
    company = await session.get(Company, company_id)
    if company is None or not company.is_active:
        raise ValueError("The company you chose does not exist or is no longer active.")
    cost_center = await session.get(CostCenter, cost_center_id)
    if cost_center is None or not cost_center.is_active:
        raise ValueError("The cost centre you chose does not exist or is no longer active.")
    if cost_center.company_id != company.id:
        raise ValueError("The cost centre must belong to the company you chose.")
    if company.id == asset.company_id and cost_center.id == asset.cost_center_id:
        raise ValueError("no changes requested -- the asset already belongs to this company and cost centre")

    old_company = await session.get(Company, asset.company_id)
    old_cost_center = await session.get(CostCenter, asset.cost_center_id)

    def describe(obj) -> str | None:
        return f"{obj.code} · {obj.name}" if obj is not None else None

    changes = []
    if company.id != asset.company_id:
        changes.append(("company_id", describe(old_company), describe(company)))
    if cost_center.id != asset.cost_center_id:
        changes.append(("cost_center_id", describe(old_cost_center), describe(cost_center)))

    await session.flush()
    await _set_owner_correction_marker(session, True)
    asset.company_id = company.id
    asset.cost_center_id = cost_center.id
    await session.flush()
    await _set_owner_correction_marker(session, False)

    request_id = str(uuid4())
    for field, old, new in changes:
        session.add(AssetFieldChange(
            asset_id=asset.id, field_name=field, old_value=old, new_value=new,
            actor_id=actor.id, request_id=request_id, reason=reason,
        ))
    return len(changes)
