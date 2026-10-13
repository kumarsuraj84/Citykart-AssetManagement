from pydantic import BaseModel, ConfigDict, Field
from app.core.validation import InModel


class ItemSetPartIn(InModel):
    """S6: one part of the set an Item is made of ("CPU", the Item CPU, 70%)."""
    name: str = Field(max_length=100)
    item_id: int
    share_percent: float


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category_id: int
    subcategory_id: int
    # Does this kind of thing carry a serial number? Only a default.
    serial_required: bool = True
    # Only for an Item that has a serial: it is read later, once the box is opened.
    serial_later: bool = False
    bundle_id: int | None = None
    default_brand_id: int | None = None
    default_warranty_years: int | None = Field(default=None, ge=0, le=100)
    # S3a-1, edit only: moving an Item to a category of the other work area
    # (IT <-> Non-IT) must be confirmed explicitly. Ignored on create.
    confirm_domain_change: bool = False
    # S6 (optional): the Item IS a set made of these parts (shares add up to 100). Saved together with the
    # Item in one transaction through the bundles service: a new set named after the Item, or the Item's own
    # set updated. Left out: `bundle_id` decides, exactly as before.
    set_parts: list[ItemSetPartIn] | None = Field(default=None, max_length=50)


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category_id: int
    subcategory_id: int | None
    serial_required: bool = True
    serial_later: bool = False
    bundle_id: int | None
    default_brand_id: int | None
    default_warranty_years: int | None
    is_active: bool
    map_count: int = 0
    # S3a-1 (additive): the Item's work area (its Category's: "IT" / "NON_IT")
    # and the names of its Category and Sub-category.
    work_area: str | None = None
    category_name: str | None = None
    subcategory_name: str | None = None
    # S6 (additive): whether the Item is a set, and its set's name.
    is_set: bool = False
    bundle_name: str | None = None


class ItemMapIn(BaseModel):
    # The Item the ERP code(s) are. Left out when `not_tracked` is true.
    item_id: int | None = None
    # This is not something CKAM tracks (cables, hangers, sensor tags): such PO lines are left out.
    not_tracked: bool = False
    # Whose ERP master this rule is for; null = every company.
    company_id: int | None = None
    # CODE, NAME, ARTICLE, or (not tracked only) DEPARTMENT, SECTION, DIVISION.
    match_type: str
    # For DEPARTMENT / SECTION / DIVISION: that level's name in the ERP.
    level_key: str | None = None
    article_key: str | None = None
    name_key: str | None = None
    erp_item_code: str | None = None
    section: str | None = None
    department: str | None = None
    article_name: str | None = None
    note: str | None = Field(default=None, max_length=300)


class ItemMapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_id: int | None = None
    not_tracked: bool = False
    level_key: str | None = None
    company_id: int | None = None
    match_type: str
    article_key: str | None
    name_key: str | None
    erp_item_code: str | None
    section: str | None
    department: str | None
    article_name: str | None
    note: str | None
