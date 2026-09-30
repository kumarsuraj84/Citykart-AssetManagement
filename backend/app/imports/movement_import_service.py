"""Imports a batch of asset movements from Excel -- one row per asset, each
with its own Action and (when that action needs one) Destination Asset
User, so a whole day's worth of movements can be recorded from a prepared
spreadsheet instead of one at a time through Asset Movement's scan box.
Each row runs through the exact same lifecycle engine as a manual move
(app.lifecycle.service.apply_event) -- same eligibility rule
(app.lifecycle.state_machine.transition), same ledger entry -- so what
commits here is indistinguishable from what an operator would have
produced doing it by hand, one row at a time.

Primary-Owner-only (see app.imports.router) -- kept consistent with every
other bulk-import capability, not because this one is any more
destructive than the manual screen it mirrors."""
from io import BytesIO
import openpyxl
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.imports.asset_import_service import ImportScopeError, ImportTemplateError, _is_blank, _read_header
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError, transition

MOVEMENT_TEMPLATE_COLUMNS = ["Serial Number or Asset Code", "Action", "Destination AssetUser Code", "Remarks"]
MOVEMENT_REQUIRED_COLUMNS = ["Serial Number or Asset Code", "Action"]

# Kept in sync by hand with Asset Movement's own BULK_ACTIONS
# (frontend/src/features/assets/AssetMovement.tsx), which is itself the
# full set app.lifecycle.state_machine.transition recognizes for
# PROCURED/IMPORTED/MOVED/RECEIVED_FROM_REPAIR/FOUND-style transitions plus
# the terminal ones -- CORRECTION is deliberately excluded (a note, not a
# movement) and PROCURED/IMPORTED never apply to an asset that already
# exists.
VALID_ACTIONS = {
    "MOVED", "SENT_FOR_REPAIR", "RECEIVED_FROM_REPAIR", "LOST", "FOUND", "DISPOSED", "SOLD", "SCRAPPED",
}
ACTIONS_NEEDING_ASSET_USER = {"MOVED", "RECEIVED_FROM_REPAIR", "FOUND"}


def build_template() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(MOVEMENT_TEMPLATE_COLUMNS)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _validate_rows(
    session: AsyncSession, content: bytes, allowed_company_ids: list[int] | None, actor_role: str,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Returns (valid_rows, errors, scope_violations). Each valid row's
    action is dry-run against the real state machine (transition() is a
    pure function -- it never touches the database) so the preview's own
    "ready to apply" list is never optimistic about something commit would
    actually reject."""
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb.active
    header = _read_header(ws)

    missing = [c for c in MOVEMENT_REQUIRED_COLUMNS if c not in header]
    if missing:
        raise ImportTemplateError(f"missing required column(s): {', '.join(missing)} -- re-download the template")

    valid_rows: list[dict] = []
    errors: list[dict] = []
    scope_violations: list[dict] = []

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if row is None or all(v is None for v in row):
            continue

        def cell(name: str):
            idx = header.get(name)
            return row[idx] if idx is not None and idx < len(row) else None

        identifier_raw = cell("Serial Number or Asset Code")
        if _is_blank(identifier_raw):
            errors.append({"row": row_idx, "field": "Serial Number or Asset Code", "message": "Serial Number or Asset Code is required"})
            continue
        identifier = str(identifier_raw).strip()

        asset = (await session.execute(
            select(Asset).where(
                Asset.deleted_at.is_(None),
                or_(Asset.serial_number == identifier, Asset.asset_code == identifier),
            )
        )).scalars().first()
        if asset is None:
            errors.append({"row": row_idx, "field": "Serial Number or Asset Code", "message": f"no asset found matching '{identifier}'"})
            continue
        if allowed_company_ids is not None and asset.company_id not in allowed_company_ids:
            violation = {"row": row_idx, "field": "Serial Number or Asset Code", "message": f"'{identifier}' is outside your company scope"}
            errors.append(violation)
            scope_violations.append(violation)
            continue

        action_raw = cell("Action")
        action = str(action_raw).strip().upper() if not _is_blank(action_raw) else ""
        if action not in VALID_ACTIONS:
            errors.append({
                "row": row_idx, "field": "Action",
                "message": f"'{action_raw}' is not a recognized action -- must be one of {', '.join(sorted(VALID_ACTIONS))}",
            })
            continue

        dest_code = cell("Destination AssetUser Code")
        to_asset_user = None
        if action in ACTIONS_NEEDING_ASSET_USER:
            if _is_blank(dest_code):
                errors.append({
                    "row": row_idx, "field": "Destination AssetUser Code",
                    "message": f"Destination AssetUser Code is required for action '{action}'",
                })
                continue
            to_asset_user = (await session.execute(
                select(AssetUser).where(AssetUser.company_id == asset.company_id, AssetUser.code == str(dest_code).strip())
            )).scalars().first()
            if to_asset_user is None:
                errors.append({
                    "row": row_idx, "field": "Destination AssetUser Code",
                    "message": f"unknown Destination AssetUser Code '{dest_code}' for this asset's company",
                })
                continue

        try:
            transition(asset.status, action, to_asset_user.asset_user_type if to_asset_user else None, actor_role)
        except LifecycleError as exc:
            errors.append({"row": row_idx, "field": "Action", "message": str(exc)})
            continue

        remarks = cell("Remarks")
        valid_rows.append({
            "row": row_idx, "asset": asset, "action": action,
            "to_asset_user_id": to_asset_user.id if to_asset_user else None,
            "to_asset_user_name": to_asset_user.name if to_asset_user else None,
            "remarks": None if _is_blank(remarks) else str(remarks).strip(),
        })

    return valid_rows, errors, scope_violations


async def preview_import(
    session: AsyncSession, content: bytes, allowed_company_ids: list[int] | None, actor_role: str,
) -> dict:
    valid_rows, errors, _scope_violations = await _validate_rows(session, content, allowed_company_ids, actor_role)
    preview_rows = [
        {
            "row": r["row"], "asset_code": r["asset"].asset_code, "description": r["asset"].description,
            "action": r["action"], "destination": r["to_asset_user_name"] or "—",
        }
        for r in valid_rows
    ]
    return {"valid_rows": preview_rows, "errors": errors}


async def commit_import(
    session: AsyncSession, content: bytes, actor: AssetUser, allowed_company_ids: list[int] | None = None,
) -> dict:
    valid_rows, errors, scope_violations = await _validate_rows(session, content, allowed_company_ids, actor.role)
    if scope_violations:
        raise ImportScopeError(f"{len(scope_violations)} row(s) target a company outside your scope -- nothing was imported")

    moved = 0
    for r in valid_rows:
        try:
            await apply_event(
                session, r["asset"], r["action"], to_asset_user_id=r["to_asset_user_id"], actor=actor, remarks=r["remarks"],
            )
            moved += 1
        except LifecycleError as exc:
            # Already dry-run in _validate_rows above, so this should be rare
            # (e.g. two rows in the same file both acting on the same asset)
            # -- one row's failure never aborts the rest, same discipline
            # app.assets.router._bulk_apply_event already follows.
            errors.append({"row": r["row"], "field": "Action", "message": str(exc)})

    await session.flush()
    return {"moved": moved, "errors": errors}
