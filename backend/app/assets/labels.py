"""S5: every name an asset row shows (company, cost centre, category, sub-category, vendor, brand, Item, who
holds it, where that is, their department) for a page of assets in ONE query -- the register list, Asset 360
and the link tool all use it, so a page of 200 assets costs one statement for its labels, not one per row
and not one per master."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.asset_users.kinds import kind_label
from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.capabilities import AREA_WORDS
from app.items.models import Item
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Department, Location, Vendor

_HOLDER = aliased(AssetUser, name="label_holder")
_HOLDER_LOCATION = aliased(Location, name="label_holder_location")
_HOLDER_DEPARTMENT = aliased(Department, name="label_holder_department")


async def asset_label_rows(session: AsyncSession, asset_ids) -> dict[int, dict]:
    """asset id -> the names to show with it. Missing master rows give None (never an error)."""
    ids = sorted({i for i in asset_ids if i is not None})
    if not ids:
        return {}
    stmt = (
        select(
            Asset.id, Asset.asset_domain,
            Company.code, Company.name, CostCenter.name, AssetCategory.name, AssetSubcategory.name,
            Vendor.name, Brand.name, Item.name,
            _HOLDER.name, _HOLDER.code, _HOLDER.asset_user_type, _HOLDER_LOCATION.name, _HOLDER_DEPARTMENT.name,
        )
        .select_from(Asset)
        .outerjoin(Company, Company.id == Asset.company_id)
        .outerjoin(CostCenter, CostCenter.id == Asset.cost_center_id)
        .outerjoin(AssetCategory, AssetCategory.id == Asset.category_id)
        .outerjoin(AssetSubcategory, AssetSubcategory.id == Asset.subcategory_id)
        .outerjoin(Vendor, Vendor.id == Asset.vendor_id)
        .outerjoin(Brand, Brand.id == Asset.brand_id)
        .outerjoin(Item, Item.id == Asset.item_id)
        .outerjoin(_HOLDER, _HOLDER.id == Asset.current_asset_user_id)
        .outerjoin(_HOLDER_LOCATION, _HOLDER_LOCATION.id == _HOLDER.location_id)
        .outerjoin(_HOLDER_DEPARTMENT, _HOLDER_DEPARTMENT.id == _HOLDER.department_id)
        .where(Asset.id.in_(ids))
    )
    out: dict[int, dict] = {}
    for (asset_id, domain, company_code, company_name, cost_center_name, category_name, subcategory_name, vendor_name,
         brand_name, item_name, holder_name, holder_code, holder_type, holder_location, holder_department) in (
            await session.execute(stmt)).all():
        out[asset_id] = {
            "company_code": company_code, "company_name": company_name, "cost_center_name": cost_center_name,
            "category_name": category_name, "subcategory_name": subcategory_name, "vendor_name": vendor_name,
            "brand_name": brand_name, "item_name": item_name,
            "holder_type": holder_type, "holder_kind_label": kind_label(holder_type), "holder_name": holder_name,
            "holder_code": holder_code, "holder_location_name": holder_location,
            "holder_department_name": holder_department,
            "work_area": domain, "work_area_label": AREA_WORDS.get(domain or ""),
            # the older names of the same facts (kept: the register screen already reads them)
            "current_asset_user_name": holder_name, "current_asset_user_type": holder_type,
            "current_asset_user_location_name": holder_location,
        }
    return out
