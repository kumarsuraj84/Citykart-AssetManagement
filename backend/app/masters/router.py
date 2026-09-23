from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role
from app.masters.service import MasterCRUDService
from app.masters import models, schemas

router = APIRouter(prefix="/api/masters", tags=["masters"])


def build_master_router(prefix: str, model, schema_in, schema_out):
    sub = APIRouter(prefix=prefix)

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
        return await MasterCRUDService(model, session).create(body.model_dump(), holder.id)

    @sub.put("/{item_id}", response_model=schema_out)
    async def update_item(
        item_id: int,
        body: schema_in,
        session: AsyncSession = Depends(get_session),
        holder=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        obj = await MasterCRUDService(model, session).update(item_id, body.model_dump(), holder.id)
        if obj is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        return obj

    @sub.delete("/{item_id}", status_code=204)
    async def deactivate_item(
        item_id: int,
        session: AsyncSession = Depends(get_session),
        holder=Depends(require_role("ADMIN", "IT_TEAM")),
    ):
        ok = await MasterCRUDService(model, session).deactivate(item_id, holder.id)
        if not ok:
            raise HTTPException(status.HTTP_404_NOT_FOUND)

    return sub


router.include_router(build_master_router("/companies", models.Company, schemas.CompanyIn, schemas.CompanyOut))
router.include_router(build_master_router("/locations", models.Location, schemas.LocationIn, schemas.LocationOut))
router.include_router(build_master_router("/departments", models.Department, schemas.DepartmentIn, schemas.DepartmentOut))
router.include_router(build_master_router("/cost-centers", models.CostCenter, schemas.CostCenterIn, schemas.CostCenterOut))
router.include_router(build_master_router("/categories", models.AssetCategory, schemas.AssetCategoryIn, schemas.AssetCategoryOut))
router.include_router(build_master_router("/subcategories", models.AssetSubcategory, schemas.AssetSubcategoryIn, schemas.AssetSubcategoryOut))
router.include_router(build_master_router("/vendors", models.Vendor, schemas.VendorIn, schemas.VendorOut))
router.include_router(build_master_router("/custom-fields", models.CustomField, schemas.CustomFieldIn, schemas.CustomFieldOut))
