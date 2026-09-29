from pydantic import BaseModel, ConfigDict


class AssetUserIn(BaseModel):
    # Ordinary Add/Edit Asset User -- company/location/code stay mandatory
    # here (enforced again server-side by _validate_asset_user_references),
    # since this schema is never used to create/edit the Primary Owner (that
    # goes through a separate, protected flow -- see require_primary_owner
    # in app.core.deps and the dedicated grant endpoint below).
    company_id: int
    code: str
    name: str
    asset_user_type: str
    location_id: int
    department_id: int | None = None
    email: str | None = None
    phone: str | None = None
    role: str = "SELF_SERVICE"
    login_enabled: bool = False
    primary_asset_domain: str | None = None
    allowed_asset_domains: str | None = None


class AssetUserOut(AssetUserIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    is_primary_owner: bool
    must_change_password: bool
    # Overridden Optional here (unlike AssetUserIn, where they stay
    # mandatory for the ordinary create/edit form): the Primary Owner is a
    # real row this same response_model serializes (e.g. GET /asset-users,
    # the grant/revoke endpoints), and it has none of these four.
    company_id: int | None
    code: str | None
    asset_user_type: str | None
    location_id: int | None


class ResetPasswordOut(BaseModel):
    temp_password: str


class CompanyAccessIn(BaseModel):
    company_ids: list[int]


class CompanyAccessOut(BaseModel):
    company_ids: list[int]
