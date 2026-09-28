from typing import Callable
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import ensure_company_in_scope, get_current_holder, require_role, scoped_company_ids
from app.masters.custom_fields_router import router as custom_fields_router
from app.masters.service import MasterCRUDService
from app.masters import models, schemas

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
    schema_edit=None,
):
    """`validate_incoming`, when given, is called with the request body's `model_dump()`
    on both create and update, before the row is written -- for closed-value fields a
    Pydantic `str` can't validate on its own. Raise ValueError to reject; the caller
    turns that into a clean 422, same convention as app.assets.service's ValueError
    usage.

    `schema_edit` (AM-05): the body schema for PUT, if narrower than `schema_in` --
    every master's immutable identifier (`code`) and controlled parent relationship
    (e.g. `company_id`) should never be freely editable after creation (see the
    Master Field Policy Matrix in docs/ai/AM-05_MASTERS_HOLDERS_REPORT.md). Falls
    back to `schema_in` when not given, so a master not yet given a narrower schema
    keeps its prior (full-`schema_in`) PUT behavior rather than breaking."""
    sub = APIRouter(prefix=prefix)
    edit_schema = schema_edit or schema_in

    def check_existing(holder, obj) -> None:
        if company_scope == SCOPE_COMPANY_ID:
            ensure_company_in_scope(holder, obj.company_id)
        elif company_scope == SCOPE_SELF:
            ensure_company_in_scope(holder, obj.id)

    def check_incoming(holder, data: dict) -> None:
        # AM-05: "company_id" in data -- when the PUT body uses a narrower
        # edit_schema that doesn't declare company_id at all (the normal
        # case now that it's immutable after creation), this check simply
        # doesn't apply: there's no incoming company_id to validate, because
        # the field can't be changed via this path regardless of role.
        if company_scope == SCOPE_COMPANY_ID and "company_id" in data:
            ensure_company_in_scope(holder, data.get("company_id"))

    @sub.get("", response_model=list[schema_out])
    async def list_items(
        company_id: int | None = Query(None),
        session: AsyncSession = Depends(get_session),
        holder=Depends(get_current_holder),
    ):
        # AM-08: an optional, opt-in filter for a company-owned master (Cost
        # Centres) -- a data-entry screen like Add Asset passes its own
        # company_id to see only its own rows. Omitted entirely (the Setup
        # screens' own usage, unchanged), every active row is still returned,
        # exactly as before -- this is a read-side narrowing, not a new
        # authorization boundary (writes were already, and remain, the actual
        # enforcement point). A company_id passed against a master that isn't
        # company-owned (company_scope is None) is harmless and ignored, since
        # that master has no such column to filter on.
        #
        # AM-17 DEF-03: a non-ADMIN staff member (IT_TEAM/VIEWER/HOLDER) could
        # previously omit company_id, or pass a different company's id, and
        # still see every company's Cost Centres -- the only enforcement was
        # on writes. Reads of a company-owned master are now always pinned to
        # the caller's own scope for a non-ADMIN, the same scope
        # ensure_company_in_scope already enforces for writes; any
        # client-supplied company_id outside that scope is silently narrowed,
        # not honored. ADMIN (scoped_company_ids() is None) is unaffected.
        filters = {}
        if company_scope == SCOPE_COMPANY_ID:
            allowed = scoped_company_ids(holder)
            if allowed is None:
                if company_id is not None:
                    filters["company_id"] = company_id
            else:
                filters["company_id"] = company_id if company_id in allowed else allowed[0]
        return await MasterCRUDService(model, session).list_active(**filters)

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
        try:
            return await MasterCRUDService(model, session).create(data, holder.id)
        except IntegrityError:
            # AM-09: every master has a unique `code` (some scoped, e.g. CostCenter's
            # (company_id, code)) -- a caller reusing an existing code is a completely
            # ordinary mistake (not malformed/adversarial input), and previously hit an
            # unhandled 500 (a raw asyncpg UniqueViolationError) instead of a normal
            # validation error. Rollback is required before the session can be used
            # again in this request (a failed INSERT leaves the transaction aborted).
            await session.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "a record with this code already exists")

    @sub.put("/{item_id}", response_model=schema_out)
    async def update_item(
        item_id: int,
        body: edit_schema,
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
        try:
            return await service.update(item_id, data, holder.id)
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "a record with this code already exists")

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


router.include_router(build_master_router(
    "/companies", models.Company, schemas.CompanyIn, schemas.CompanyOut, SCOPE_SELF,
    schema_edit=schemas.CompanyEditIn,
))
router.include_router(build_master_router(
    "/locations", models.Location, schemas.LocationIn, schemas.LocationOut,
    schema_edit=schemas.LocationEditIn,
))
router.include_router(build_master_router(
    "/departments", models.Department, schemas.DepartmentIn, schemas.DepartmentOut,
    schema_edit=schemas.DepartmentEditIn,
))
router.include_router(build_master_router(
    "/cost-centers", models.CostCenter, schemas.CostCenterIn, schemas.CostCenterOut, SCOPE_COMPANY_ID,
    schema_edit=schemas.CostCenterEditIn,
))
router.include_router(build_master_router(
    "/categories", models.AssetCategory, schemas.AssetCategoryIn, schemas.AssetCategoryOut,
    schema_edit=schemas.AssetCategoryEditIn,
))
router.include_router(build_master_router(
    "/subcategories", models.AssetSubcategory, schemas.AssetSubcategoryIn, schemas.AssetSubcategoryOut,
    schema_edit=schemas.AssetSubcategoryEditIn,
))
router.include_router(build_master_router(
    "/vendors", models.Vendor, schemas.VendorIn, schemas.VendorOut,
    schema_edit=schemas.VendorEditIn,
))

# AM-05: Custom Fields has its own bespoke router (scope authorization +
# field_key/field_type/scope immutability rules no other master needs) --
# see app/masters/custom_fields_router.py.
router.include_router(custom_fields_router)
