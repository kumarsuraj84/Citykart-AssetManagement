from app.masters.models import AssetCategory, AssetSubcategory


def effective_serial_required(category: AssetCategory, subcategory: AssetSubcategory | None, item=None) -> bool:
    """Whether items of this kind carry a serial number: the Item's own setting
    when it has one, else the sub-category's, else the category's. Only a
    default -- never a reason to refuse a serial or to refuse N/A."""
    if item is not None and item.serial_required is not None:
        return item.serial_required
    if subcategory is not None and subcategory.serial_required is not None:
        return subcategory.serial_required
    return category.serial_required
