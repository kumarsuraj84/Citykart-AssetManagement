from pydantic import BaseModel, ConfigDict


class BrandIn(BaseModel):
    code: str
    name: str


class BrandEditIn(BaseModel):
    name: str


class BrandOut(BrandIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class VendorIn(BaseModel):
    code: str
    name: str
    gstin: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None


class VendorEditIn(BaseModel):
    """AM-05 safe-edit schema: `code` (the immutable identifier -- already
    referenced by every asset that names this vendor) is deliberately not
    declared here, so sending it in a PUT body is simply ignored, the same
    convention AssetUpdateIn already established for asset_code."""
    name: str
    gstin: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None


class VendorOut(VendorIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    # Read-only here; set only through the ERP link endpoints (/api/erp/vendors).
    erp_vendor_code: str | None = None


class CompanyIn(BaseModel):
    code: str
    name: str


class CompanyEditIn(BaseModel):
    """`code` omitted deliberately -- immutable after creation (AM-05)."""
    name: str


class CompanyOut(CompanyIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class LocationIn(BaseModel):
    company_id: int
    code: str
    name: str
    address: str | None = None


class LocationEditIn(BaseModel):
    """`company_id`/`code` omitted deliberately -- both immutable after
    creation (AM-05), same rule as CostCenter's own edit schema."""
    name: str
    address: str | None = None


class LocationOut(LocationIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class DepartmentIn(BaseModel):
    name: str


class DepartmentEditIn(BaseModel):
    """Department has no separate business code -- `name` itself is the
    unique identifier, but nothing else in the system keys off its exact
    string value (AssetUser.department_id is a stable FK), so renaming it is a
    safe descriptive edit, not an identity change."""
    name: str


class DepartmentOut(DepartmentIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class CostCenterIn(BaseModel):
    company_id: int
    code: str
    name: str


class CostCenterEditIn(BaseModel):
    """`company_id`/`code` omitted deliberately -- both immutable after
    creation (AM-05): the company relationship is a controlled boundary
    (see `DEVELOPMENT_GUARDRAILS.md`/`DECISIONS.md`) and the code is the
    identifier every referencing asset relies on."""
    name: str


class CostCenterOut(CostCenterIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class AssetCategoryIn(BaseModel):
    code: str
    name: str
    # IT / NON_IT (app.masters.models.ASSET_DOMAINS) -- the FUTURE default
    # domain for assets created under this category (spec §17/§41). Required:
    # every category must be explicitly classified, never guessed.
    asset_domain: str
    # Do items of this category carry a serial number? A default only (see
    # app.masters.serial_rule); every existing category is "yes".
    serial_required: bool = True


class AssetCategoryEditIn(BaseModel):
    name: str
    # Spec §43: changing this affects FUTURE assets only -- an existing
    # Asset's own asset_domain snapshot is never rewritten by this edit.
    asset_domain: str
    # Like every field of an edit body, leaving it out resets it (to yes).
    serial_required: bool = True


class AssetCategoryOut(AssetCategoryIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class AssetSubcategoryIn(BaseModel):
    category_id: int
    code: str
    name: str
    # null = same as the category; true/false overrides it.
    serial_required: bool | None = None


class AssetSubcategoryEditIn(BaseModel):
    """`category_id`/`code` omitted deliberately -- both immutable after
    creation (AM-05): re-parenting a subcategory to a different category
    wasn't proven safe against existing asset code_rule tokens/history."""
    name: str
    serial_required: bool | None = None


class AssetSubcategoryOut(AssetSubcategoryIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class CustomFieldIn(BaseModel):
    field_key: str
    label: str
    field_type: str
    options: dict | None = None
    is_required: bool = False
    sort_order: int = 0
    # AM-05: None = GLOBAL (applies to every company); a real id = applies
    # only to that company's assets. See app/assets/custom_field_values.py.
    company_id: int | None = None


class CustomFieldEditIn(BaseModel):
    """`field_key`/`field_type` omitted deliberately -- both immutable after
    creation (AM-05 §22): asset values are stored keyed by field_key, and
    changing field_type could invalidate values already stored under the
    old type. `company_id` (scope) is accepted here but the router only
    honors a change to it when no asset currently holds a value for this
    field_key -- see `masters/router.py`."""
    label: str
    options: dict | None = None
    is_required: bool = False
    sort_order: int = 0
    company_id: int | None = None


class CustomFieldOut(CustomFieldIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
