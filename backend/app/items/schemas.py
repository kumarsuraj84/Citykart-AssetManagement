from pydantic import BaseModel, ConfigDict, Field


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
    default_warranty_years: int | None = Field(default=None, ge=0)


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


class ItemMapIn(BaseModel):
    item_id: int
    # Whose ERP master this rule is for; null = every company.
    company_id: int | None = None
    match_type: str
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
    item_id: int
    company_id: int | None = None
    match_type: str
    article_key: str | None
    name_key: str | None
    erp_item_code: str | None
    section: str | None
    department: str | None
    article_name: str | None
    note: str | None
