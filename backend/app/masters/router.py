from typing import Callable
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import ensure_company_in_scope, get_current_holder, require_role
from app.masters.service import MasterCRUDService
from app.masters import models, schemas
from app.masters.models import FIELD_TYPES

router = APIRouter(prefix="/api/masters", tags=["masters"])

# How a master's rows map to a company, for write-scope checks (a non-ADMIN
# actor may only write company-owned rows inside their own company scope):
#   None         -- global master (categories, vendors, ...), no company check
#   "company_id" -- row owned by the company in its `company_id` column
#   "self"       -- the row IS a company (the companies master itself)
SCOPE_NONE = None
SCOPE_COMPANY_ID = "company_id"
SCOPE_SELF = "self"


def build_master_router(
    prefix: str, model, schema_in, schema_out, company_scope: str | None = SCOPE_NONE,
    validate_incoming: Callable[[dict], None] | None = None,
):
    """`validate_incoming`, when given, is called with the request body's `model_dump()`
    on both create and update, before the row is written -- for closed-value fields a
    Pydantic `str` can't validate on its own (e.g. CustomField.field_type; see the
    /custom-fields registration below). Raise ValueError to reject; the caller turns
    that into a clean 422, same convention as app.assets.service's ValueError usage."""
    sub = APIRouter(prefix=prefix)

    def check_existing(holder, obj) -> None:
        if company_scope == SCOPE_COMPANY_ID:
            ensure_company_in_scope(holder, obj.company_id)
        elif company_scope == SCOPE_SELF:
            ensure_company_in_scope(holder, obj.id)

    def check_incoming(holder, data: dict) -> None:
        if company_scope == SCOPE_COMPANY_ID:
            ensure_company_in_scope(holder, data.get("company_id"))

    @sub.get("", response_model=list[schema_out])
    async def list_items(
        session: AsyncSession = Depends(get_session),
        _holder=Depends(get_current_holder),
    ):
        return await MasterCRUDService(model, session).list_active()

    @sub.post("", response_model=schema_out, status_code=201)
    async def create_item(
        body: schema_in,
        session: AsyncSession = Depends(get_session),
        holder=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        data = body.model_dump()
        if company_scope == SCOPE_SELF:
            # A brand-new company is by definition outside any non-ADMIN's scope.
            ensure_company_in_scope(holder, None)
        check_incoming(holder, data)
        if validate_incoming is not None:
            try:
                validate_incoming(data)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        return await MasterCRUDService(model, session).create(data, holder.id)

    @sub.put("/{item_id}", response_model=schema_out)
    async def update_item(
        item_id: int,
        body: schema_in,
        session: AsyncSession = Depends(get_session),
        holder=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        service = MasterCRUDService(model, session)
        existing = await service.get(item_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        data = body.model_dump()
        check_existing(holder, existing)  # may not edit another company's row...
        check_incoming(holder, data)      # ...nor move an own row into another company
        if validate_incoming is not None:
            try:
                validate_incoming(data)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        return await service.update(item_id, data, holder.id)

    @sub.delete("/{item_id}", status_code=204)
    async def deactivate_item(
        item_id: int,
        session: AsyncSession = Depends(get_session),
        holder=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        service = MasterCRUDService(model, session)
        existing = await service.get(item_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        check_existing(holder, existing)
        await service.deactivate(item_id, holder.id)

    return sub


router.include_router(build_master_router("/companies", models.Company, schemas.CompanyIn, schemas.CompanyOut, SCOPE_SELF))
router.include_router(build_master_router("/locations", models.Location, schemas.LocationIn, schemas.LocationOut))
router.include_router(build_master_router("/departments", models.Department, schemas.DepartmentIn, schemas.DepartmentOut))
router.include_router(build_master_router("/cost-centers", models.CostCenter, schemas.CostCenterIn, schemas.CostCenterOut, SCOPE_COMPANY_ID))
router.include_router(build_master_router("/categories", models.AssetCategory, schemas.AssetCategoryIn, schemas.AssetCategoryOut))
router.include_router(build_master_router("/subcategories", models.AssetSubcategory, schemas.AssetSubcategoryIn, schemas.AssetSubcategoryOut))
router.include_router(build_master_router("/vendors", models.Vendor, schemas.VendorIn, schemas.VendorOut))


def _validate_custom_field(data: dict) -> None:
    # AM-01 confirmed field_type accepted any string with no validation at all -- AM-02
    # closes that gap. FIELD_TYPES is the same list already documented (previously only
    # in a comment) next to the column; kept intentionally small per the AM-02
    # authorization ("this is UDF functionality, not a low-code platform").
    if data.get("field_type") not in FIELD_TYPES:
        raise ValueError(f"field_type must be one of {FIELD_TYPES}")


router.include_router(build_master_router(
    "/custom-fields", models.CustomField, schemas.CustomFieldIn, schemas.CustomFieldOut,
    validate_incoming=_validate_custom_field,
))
