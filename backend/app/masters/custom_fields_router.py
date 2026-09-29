"""AM-05: Custom Fields outgrew the generic `build_master_router` factory --
scope (Global vs. company-specific) needs its own authorization rule
(§20 of the AM-05 authorization) and its own immutability rule (§22:
`field_key`/`field_type` never editable; `company_id` only editable while no
asset yet has a value for that key), neither of which any other master
needs. Kept as its own router rather than bolting special cases onto the
shared factory every other master still uses unmodified.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_asset_user, require_role
from app.assets.custom_field_values import any_asset_has_value_for
from app.masters.models import FIELD_TYPES, CustomField
from app.masters.schemas import CustomFieldEditIn, CustomFieldIn, CustomFieldOut
from app.masters.service import MasterCRUDService

router = APIRouter(prefix="/custom-fields")


def _validate_field_type(field_type: str) -> None:
    # AM-01 confirmed field_type accepted any string with no validation at all --
    # AM-02 closed that gap; unchanged here.
    if field_type not in FIELD_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"field_type must be one of {FIELD_TYPES}")


def _check_scope_authorization(asset_user, company_id: int | None) -> None:
    """ADMIN may create/manage a field at any scope, Global included.
    IT_TEAM may only create/manage a field scoped to its own company --
    never Global, since a Global field affects every company IT_TEAM isn't
    authorized to touch (AM-05 §20's explicit V1 safety rule). VIEWER/ASSET_USER
    never reach this -- every route below is gated by
    require_role("ADMIN", "IT_TEAM") first."""
    if asset_user.role == "ADMIN":
        return
    if company_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN may create or manage a Global custom field")
    if company_id != asset_user.company_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted to manage custom fields for this company")


@router.get("", response_model=list[CustomFieldOut])
async def list_custom_fields(
    session: AsyncSession = Depends(get_session),
    _asset_user=Depends(get_current_asset_user),
):
    """Unrestricted read, same as every other master (Vendors/Categories/...
    are globally visible to any authenticated staff member) -- AM-05 only
    scopes *mutation* authorization (§20), not visibility of the
    administration list itself. Add Asset/Asset 360 narrow this down to the
    applicable subset client-side (see AM-05_MASTERS_ASSET_USERS_REPORT.md)."""
    return await MasterCRUDService(CustomField, session).list_active()


@router.post("", response_model=CustomFieldOut, status_code=201)
async def create_custom_field(
    body: CustomFieldIn,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
):
    data = body.model_dump()
    _validate_field_type(data["field_type"])
    _check_scope_authorization(asset_user, data.get("company_id"))

    existing = (await session.execute(
        select(CustomField).where(CustomField.field_key == data["field_key"])
    )).scalars().first()
    if existing is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"field_key '{data['field_key']}' already exists")

    return await MasterCRUDService(CustomField, session).create(data, asset_user.id)


@router.put("/{item_id}", response_model=CustomFieldOut)
async def update_custom_field(
    item_id: int,
    body: CustomFieldEditIn,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
):
    service = MasterCRUDService(CustomField, session)
    existing = await service.get(item_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    # Must be authorized for the field's current scope...
    _check_scope_authorization(asset_user, existing.company_id)

    data = body.model_dump()
    new_company_id = data.get("company_id")
    if new_company_id != existing.company_id:
        # ...and, if actually changing scope, for the new scope too, and
        # only while no asset has a stored value under this key yet (AM-05
        # §22 -- otherwise the scope change could make a value invisible to
        # the company that entered it, or expose it to a company it was
        # never meant for).
        _check_scope_authorization(asset_user, new_company_id)
        if await any_asset_has_value_for(session, existing.field_key):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"cannot change scope: at least one asset already has a value for '{existing.field_key}'",
            )

    return await service.update(item_id, data, asset_user.id)


@router.delete("/{item_id}", status_code=204)
async def deactivate_custom_field(
    item_id: int,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
):
    service = MasterCRUDService(CustomField, session)
    existing = await service.get(item_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _check_scope_authorization(asset_user, existing.company_id)
    await service.deactivate(item_id, asset_user.id)
