from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.core.validation import InModel, require_text

# S0.5/S0.10: request bodies carry the database column sizes, refuse blank
# codes/names and NUL characters (InModel). Email / GSTIN formats are checked by
# the router, only for a value that is new or changed, so a stored legacy value
# never blocks an unrelated edit.


def _required_code(value: str) -> str:
    return require_text(value, "Code")


def _required_name(value: str) -> str:
    return require_text(value, "Name")


class BrandIn(InModel):
    code: str = Field(max_length=20)
    name: str = Field(max_length=200)

    _code = field_validator("code")(_required_code)
    _name = field_validator("name")(_required_name)


class BrandEditIn(InModel):
    name: str = Field(max_length=200)

    _name = field_validator("name")(_required_name)


class BrandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    code: str
    name: str


class VendorIn(InModel):
    code: str = Field(max_length=100)
    name: str = Field(max_length=200)
    gstin: str | None = Field(default=None, max_length=20)
    contact_name: str | None = Field(default=None, max_length=200)
    contact_phone: str | None = Field(default=None, max_length=30)
    contact_email: str | None = Field(default=None, max_length=200)

    _code = field_validator("code")(_required_code)
    _name = field_validator("name")(_required_name)


class VendorEditIn(InModel):
    """AM-05 safe-edit schema: `code` (the immutable identifier -- already
    referenced by every asset that names this vendor) is deliberately not
    declared here, so sending it in a PUT body is simply ignored, the same
    convention AssetUpdateIn already established for asset_code."""
    name: str = Field(max_length=200)
    gstin: str | None = Field(default=None, max_length=20)
    contact_name: str | None = Field(default=None, max_length=200)
    contact_phone: str | None = Field(default=None, max_length=30)
    contact_email: str | None = Field(default=None, max_length=200)

    _name = field_validator("name")(_required_name)


class VendorErpLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    company_id: int
    company_code: str
    erp_vendor_code: str


class VendorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    code: str
    name: str
    gstin: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    # Read-only here; set only through the ERP link endpoints (/api/erp/vendors). One per company
    # (a vendor can have several codes inside one company too).
    erp_links: list[VendorErpLinkOut] = []


def _blank_to_none(value: str | None) -> str | None:
    return (value or "").strip() or None


class CompanyIn(InModel):
    code: str = Field(max_length=20)
    name: str = Field(max_length=200)
    # The code the ERP uses for this company, when it differs from `code`.
    erp_company_code: str | None = Field(default=None, max_length=50)

    _code = field_validator("code")(_required_code)
    _name = field_validator("name")(_required_name)
    _clean_erp_code = field_validator("erp_company_code")(_blank_to_none)


class CompanyEditIn(InModel):
    """`code` omitted deliberately -- immutable after creation (AM-05)."""
    name: str = Field(max_length=200)
    erp_company_code: str | None = Field(default=None, max_length=50)

    _name = field_validator("name")(_required_name)
    _clean_erp_code = field_validator("erp_company_code")(_blank_to_none)


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    code: str
    name: str
    erp_company_code: str | None = None


class LocationIn(InModel):
    company_id: int
    code: str = Field(max_length=20)
    name: str = Field(max_length=200)
    address: str | None = Field(default=None, max_length=500)

    _code = field_validator("code")(_required_code)
    _name = field_validator("name")(_required_name)


class LocationEditIn(InModel):
    """`company_id`/`code` omitted deliberately -- both immutable after
    creation (AM-05), same rule as CostCenter's own edit schema."""
    name: str = Field(max_length=200)
    address: str | None = Field(default=None, max_length=500)

    _name = field_validator("name")(_required_name)


class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    company_id: int
    code: str
    name: str
    address: str | None = None


class DepartmentIn(InModel):
    name: str = Field(max_length=200)

    _name = field_validator("name")(_required_name)


class DepartmentEditIn(InModel):
    """Department has no separate business code -- `name` itself is the
    unique identifier, but nothing else in the system keys off its exact
    string value (AssetUser.department_id is a stable FK), so renaming it is a
    safe descriptive edit, not an identity change."""
    name: str = Field(max_length=200)

    _name = field_validator("name")(_required_name)


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    name: str


class CostCenterIn(InModel):
    company_id: int
    code: str = Field(max_length=20)
    name: str = Field(max_length=200)

    _code = field_validator("code")(_required_code)
    _name = field_validator("name")(_required_name)


class CostCenterEditIn(InModel):
    """`company_id`/`code` omitted deliberately -- both immutable after
    creation (AM-05): the company relationship is a controlled boundary
    (see `DEVELOPMENT_GUARDRAILS.md`/`DECISIONS.md`) and the code is the
    identifier every referencing asset relies on."""
    name: str = Field(max_length=200)

    _name = field_validator("name")(_required_name)


class CostCenterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    company_id: int
    code: str
    name: str


class AssetCategoryIn(InModel):
    code: str = Field(max_length=20)
    name: str = Field(max_length=200)
    # IT / NON_IT (app.masters.models.ASSET_DOMAINS) -- the FUTURE default
    # domain for assets created under this category (spec §17/§41). Required:
    # every category must be explicitly classified, never guessed.
    asset_domain: str

    _code = field_validator("code")(_required_code)
    _name = field_validator("name")(_required_name)


class AssetCategoryEditIn(InModel):
    name: str = Field(max_length=200)
    # Spec §43: changing this affects FUTURE assets only -- an existing
    # Asset's own asset_domain snapshot is never rewritten by this edit.
    asset_domain: str

    _name = field_validator("name")(_required_name)


class AssetCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    code: str
    name: str
    asset_domain: str


class AssetSubcategoryIn(InModel):
    category_id: int
    code: str = Field(max_length=20)
    name: str = Field(max_length=200)

    _code = field_validator("code")(_required_code)
    _name = field_validator("name")(_required_name)


class AssetSubcategoryEditIn(InModel):
    """`category_id`/`code` omitted deliberately -- both immutable after
    creation (AM-05): re-parenting a subcategory to a different category
    wasn't proven safe against existing asset code_rule tokens/history."""
    name: str = Field(max_length=200)

    _name = field_validator("name")(_required_name)


class AssetSubcategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    category_id: int
    code: str
    name: str


class CustomFieldIn(InModel):
    field_key: str = Field(max_length=100)
    label: str = Field(max_length=200)
    field_type: str
    options: dict | None = None
    is_required: bool = False
    sort_order: int = 0
    # AM-05: None = GLOBAL (applies to every company); a real id = applies
    # only to that company's assets. See app/assets/custom_field_values.py.
    company_id: int | None = None


class CustomFieldEditIn(InModel):
    """`field_key`/`field_type` omitted deliberately -- both immutable after
    creation (AM-05 §22): asset values are stored keyed by field_key, and
    changing field_type could invalidate values already stored under the
    old type. `company_id` (scope) is accepted here but the router only
    honors a change to it when no asset currently holds a value for this
    field_key -- see `masters/router.py`."""
    label: str = Field(max_length=200)
    options: dict | None = None
    is_required: bool = False
    sort_order: int = 0
    company_id: int | None = None


class CustomFieldOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    field_key: str
    label: str
    field_type: str
    options: dict | None = None
    is_required: bool = False
    sort_order: int = 0
    company_id: int | None = None
