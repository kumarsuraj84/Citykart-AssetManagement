from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.core.validation import InModel, MAX_BULK_IDS, require_text


class AssetUserIn(InModel):
    # Ordinary Add/Edit Asset User -- company/location/code stay mandatory
    # here (enforced again server-side by _validate_asset_user_references),
    # since this schema is never used to create/edit the Primary Owner (that
    # goes through a separate, protected flow -- see require_primary_owner
    # in app.core.deps and the dedicated grant endpoint below).
    company_id: int
    code: str = Field(max_length=50)
    name: str = Field(max_length=200)
    asset_user_type: str
    location_id: int
    department_id: int | None = None
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    role: str = "SELF_SERVICE"
    login_enabled: bool = False
    primary_asset_domain: str | None = None
    allowed_asset_domains: str | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        return require_text(value, "Code")

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return require_text(value, "Name")

    @field_validator("email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        # Format is checked in the router, and only when the email is new or
        # changed, so an existing record is never blocked by its stored value.
        return (value or "").strip() or None


class AssetUserUpdateIn(InModel):
    """S1: PUT /asset-users/{id}. Every field is optional: a field LEFT OUT
    keeps its stored value (so an edit form that does not show the work area
    can no longer reset it); a field sent as null / blank clears it where that
    is allowed (company, code, name, type and location can never be cleared)."""
    company_id: int | None = None
    code: str | None = Field(default=None, max_length=50)
    name: str | None = Field(default=None, max_length=200)
    asset_user_type: str | None = None
    location_id: int | None = None
    department_id: int | None = None
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    role: str | None = None
    login_enabled: bool | None = None
    primary_asset_domain: str | None = None
    allowed_asset_domains: str | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, value: str | None) -> str:
        return require_text(value, "Code")

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str:
        return require_text(value, "Name")

    @field_validator("email", "phone")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return (value or "").strip() or None

    @field_validator("primary_asset_domain", "allowed_asset_domains")
    @classmethod
    def _blank_domain_is_none(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class AssetUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    is_primary_owner: bool
    must_change_password: bool
    # Optional here (unlike AssetUserIn, where they stay mandatory for the
    # ordinary create/edit form): the Primary Owner is a real row this same
    # response_model serializes (e.g. GET /asset-users, the grant/revoke
    # endpoints), and it has none of these four.
    company_id: int | None
    code: str | None
    name: str
    asset_user_type: str | None
    location_id: int | None
    department_id: int | None = None
    email: str | None = None
    phone: str | None = None
    role: str = "SELF_SERVICE"
    login_enabled: bool = False
    primary_asset_domain: str | None = None
    allowed_asset_domains: str | None = None
    # S1 (additive, filled by GET /asset-users): names instead of ids.
    location_name: str | None = None
    company_code: str | None = None
    # S7 (additive, POST / PUT /asset-users): the rooms made for a new store ("stock_room", "install_point").
    rooms_created: list[str] = []


class ResetPasswordOut(BaseModel):
    temp_password: str


MAX_ISSUE_PASSWORDS = 500


class IssuePasswordsIn(InModel):
    """S5: POST /asset-users/issue-passwords -- a temporary password for many accounts at once (e.g. every new
    store). Choose the accounts by id, or by kind and/or company."""
    asset_user_ids: list[int] | None = Field(default=None, max_length=MAX_ISSUE_PASSWORDS)
    kind: str | None = Field(default=None, max_length=20)          # "stores" | "employees"
    only_without_password: bool = True
    company_id: int | None = None


class IssuedPasswordOut(BaseModel):
    asset_user_id: int
    code: str | None
    name: str
    email: str | None
    temp_password: str


class CompanyAccessIn(InModel):
    company_ids: list[int] = Field(max_length=MAX_BULK_IDS)


class CompanyAccessOut(BaseModel):
    company_ids: list[int]
