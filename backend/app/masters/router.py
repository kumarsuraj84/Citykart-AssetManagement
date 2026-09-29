from typing import Callable
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import ensure_company_in_scope, get_current_asset_user, require_role, scoped_company_ids
from app.masters.bulk_import_export import (
    FieldSpec, ImportScopeError, ImportTemplateError,
    build_template as build_import_template, commit_import, export_rows, preview_import,
)
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
    import_fields: list[FieldSpec] | None = None,
):
    """`validate_incoming`, when given, is called with the request body's `model_dump()`
    on both create and update, before the row is written -- for closed-value fields a
    Pydantic `str` can't validate on its own. Raise ValueError to reject; the caller
    turns that into a clean 422, same convention as app.assets.service's ValueError
    usage.

    `schema_edit` (AM-05): the body schema for PUT, if narrower than `schema_in` --
    every master's immutable identifier (`code`) and controlled parent relationship
    (e.g. `company_id`) should never be freely editable after creation (see the
    Master Field Policy Matrix in docs/ai/AM-05_MASTERS_ASSET_USERS_REPORT.md). Falls
    back to `schema_in` when not given, so a master not yet given a narrower schema
    keeps its prior (full-`schema_in`) PUT behavior rather than breaking."""
    sub = APIRouter(prefix=prefix)
    edit_schema = schema_edit or schema_in

    async def check_existing(session: AsyncSession, asset_user, obj) -> None:
        if company_scope == SCOPE_COMPANY_ID:
            await ensure_company_in_scope(session, asset_user, obj.company_id)
        elif company_scope == SCOPE_SELF:
            await ensure_company_in_scope(session, asset_user, obj.id)

    async def check_incoming(session: AsyncSession, asset_user, data: dict) -> None:
        # AM-05: "company_id" in data -- when the PUT body uses a narrower
        # edit_schema that doesn't declare company_id at all (the normal
        # case now that it's immutable after creation), this check simply
        # doesn't apply: there's no incoming company_id to validate, because
        # the field can't be changed via this path regardless of role.
        if company_scope == SCOPE_COMPANY_ID and "company_id" in data:
            await ensure_company_in_scope(session, asset_user, data.get("company_id"))

    @sub.get("", response_model=list[schema_out])
    async def list_items(
        company_id: int | None = Query(None),
        session: AsyncSession = Depends(get_session),
        asset_user=Depends(get_current_asset_user),
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
        # AM-17 DEF-03: a non-ADMIN staff member (IT_TEAM/VIEWER/ASSET_USER) could
        # previously omit company_id, or pass a different company's id, and
        # still see every company's Cost Centres -- the only enforcement was
        # on writes. Reads of a company-owned master are now always pinned to
        # the caller's own scope for a non-ADMIN, the same scope
        # ensure_company_in_scope already enforces for writes; any
        # client-supplied company_id outside that scope is silently narrowed,
        # not honored. ADMIN (scoped_company_ids() is None) is unaffected.
        filters = {}
        if company_scope == SCOPE_COMPANY_ID:
            allowed = await scoped_company_ids(session, asset_user)
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
        asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        data = body.model_dump()
        if company_scope == SCOPE_SELF:
            # A brand-new company is by definition outside any non-ADMIN's scope.
            await ensure_company_in_scope(session, asset_user, None)
        await check_incoming(session, asset_user, data)
        if validate_incoming is not None:
            try:
                validate_incoming(data)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        try:
            return await MasterCRUDService(model, session).create(data, asset_user.id)
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
        asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        service = MasterCRUDService(model, session)
        existing = await service.get(item_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        data = body.model_dump()
        await check_existing(session, asset_user, existing)  # may not edit another company's row...
        await check_incoming(session, asset_user, data)      # ...nor move an own row into another company
        if validate_incoming is not None:
            try:
                validate_incoming(data)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        try:
            return await service.update(item_id, data, asset_user.id)
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "a record with this code already exists")

    @sub.delete("/{item_id}", status_code=204)
    async def deactivate_item(
        item_id: int,
        session: AsyncSession = Depends(get_session),
        asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        service = MasterCRUDService(model, session)
        existing = await service.get(item_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        await check_existing(session, asset_user, existing)
        await service.deactivate(item_id, asset_user.id)

    # AM-25: bulk Import/Export -- only mounted when this master opted in
    # with `import_fields`. company_field mirrors this router's own
    # company_scope (SCOPE_COMPANY_ID -> the row's own "company_id" column,
    # SCOPE_SELF -> the Companies master's own "id", SCOPE_NONE -> no
    # company scoping at all), so the same authorization rule create_item
    # already enforces applies to every imported row too.
    if import_fields is not None:
        company_field = {SCOPE_COMPANY_ID: "company_id", SCOPE_SELF: "id", SCOPE_NONE: None}[company_scope]

        @sub.get("/export")
        async def export_items(
            session: AsyncSession = Depends(get_session),
            asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
        ):
            allowed = await scoped_company_ids(session, asset_user)
            content = await export_rows(session, model, import_fields, allowed, company_field)
            return Response(
                content=content,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename={prefix.strip('/')}_export.xlsx"},
            )

        @sub.get("/import/template")
        async def import_template(_h=Depends(require_role("ADMIN", "IT_TEAM"))):
            return Response(
                content=build_import_template(import_fields),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename={prefix.strip('/')}_import_template.xlsx"},
            )

        @sub.post("/import/preview")
        async def import_preview(
            file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
            asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
        ):
            content = await file.read()
            allowed = await scoped_company_ids(session, asset_user)
            try:
                return await preview_import(session, import_fields, content, allowed, company_field)
            except ImportTemplateError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

        @sub.post("/import/commit")
        async def import_commit(
            file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
            asset_user=Depends(require_role("ADMIN", "IT_TEAM")),
        ):
            content = await file.read()
            allowed = await scoped_company_ids(session, asset_user)
            try:
                result = await commit_import(session, model, import_fields, content, asset_user, allowed, company_field)
            except ImportScopeError as exc:
                raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
            except ImportTemplateError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
            except ValueError as exc:
                await session.rollback()
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
            await session.commit()
            return result

    return sub


router.include_router(build_master_router(
    "/companies", models.Company, schemas.CompanyIn, schemas.CompanyOut, SCOPE_SELF,
    schema_edit=schemas.CompanyEditIn,
    import_fields=[
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/locations", models.Location, schemas.LocationIn, schemas.LocationOut, SCOPE_COMPANY_ID,
    schema_edit=schemas.LocationEditIn,
    import_fields=[
        FieldSpec("Company Code", "company_id", required=True, lookup=(models.Company, "code")),
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
        FieldSpec("Address", "address", max_length=500),
    ],
))
router.include_router(build_master_router(
    "/departments", models.Department, schemas.DepartmentIn, schemas.DepartmentOut,
    schema_edit=schemas.DepartmentEditIn,
    import_fields=[
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/cost-centers", models.CostCenter, schemas.CostCenterIn, schemas.CostCenterOut, SCOPE_COMPANY_ID,
    schema_edit=schemas.CostCenterEditIn,
    import_fields=[
        FieldSpec("Company Code", "company_id", required=True, lookup=(models.Company, "code")),
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/categories", models.AssetCategory, schemas.AssetCategoryIn, schemas.AssetCategoryOut,
    schema_edit=schemas.AssetCategoryEditIn,
    import_fields=[
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/subcategories", models.AssetSubcategory, schemas.AssetSubcategoryIn, schemas.AssetSubcategoryOut,
    schema_edit=schemas.AssetSubcategoryEditIn,
    import_fields=[
        FieldSpec("Category Code", "category_id", required=True, lookup=(models.AssetCategory, "code")),
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/brands", models.Brand, schemas.BrandIn, schemas.BrandOut,
    schema_edit=schemas.BrandEditIn,
    import_fields=[
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/vendors", models.Vendor, schemas.VendorIn, schemas.VendorOut,
    schema_edit=schemas.VendorEditIn,
    import_fields=[
        FieldSpec("Code", "code", required=True, max_length=100),
        FieldSpec("Name", "name", required=True, max_length=200),
        FieldSpec("GSTIN", "gstin", max_length=20),
        FieldSpec("Contact Name", "contact_name", max_length=200),
        FieldSpec("Contact Phone", "contact_phone", max_length=30),
        FieldSpec("Contact Email", "contact_email", max_length=200),
    ],
))

# AM-05: Custom Fields has its own bespoke router (scope authorization +
# field_key/field_type/scope immutability rules no other master needs) --
# see app/masters/custom_fields_router.py.
router.include_router(custom_fields_router)
