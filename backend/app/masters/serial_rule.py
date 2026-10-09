from app.masters.models import AssetCategory, AssetSubcategory


def effective_serial_required(category: AssetCategory, subcategory: AssetSubcategory | None) -> bool:
    """Whether items of this category/sub-category carry a serial number: the
    sub-category's own setting when it has one, else its category's. Only a
    default -- never a reason to refuse a serial or to refuse N/A."""
    if subcategory is not None and subcategory.serial_required is not None:
        return subcategory.serial_required
    return category.serial_required
