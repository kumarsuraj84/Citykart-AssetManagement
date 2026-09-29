from pydantic import BaseModel, ConfigDict


class AssetUserIn(BaseModel):
    company_id: int
    emp_code: str
    name: str
    asset_user_type: str
    location_id: int
    department_id: int | None = None
    email: str | None = None
    phone: str | None = None
    role: str = "ASSET_USER"


class AssetUserOut(AssetUserIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    must_change_password: bool


class ResetPasswordOut(BaseModel):
    temp_password: str


class CompanyAccessIn(BaseModel):
    company_ids: list[int]


class CompanyAccessOut(BaseModel):
    company_ids: list[int]
