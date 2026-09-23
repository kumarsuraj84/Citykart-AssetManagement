from pydantic import BaseModel, ConfigDict


class VendorIn(BaseModel):
    code: str
    name: str
    gstin: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None


class VendorOut(VendorIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class CompanyIn(BaseModel):
    code: str
    name: str


class CompanyOut(CompanyIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class LocationIn(BaseModel):
    code: str
    name: str
    address: str | None = None


class LocationOut(LocationIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class DepartmentIn(BaseModel):
    name: str


class DepartmentOut(DepartmentIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class CostCenterIn(BaseModel):
    company_id: int
    code: str
    name: str


class CostCenterOut(CostCenterIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class AssetCategoryIn(BaseModel):
    code: str
    name: str


class AssetCategoryOut(AssetCategoryIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool


class AssetSubcategoryIn(BaseModel):
    category_id: int
    code: str
    name: str


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


class CustomFieldOut(CustomFieldIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
