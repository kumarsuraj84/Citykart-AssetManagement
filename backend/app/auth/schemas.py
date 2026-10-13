from pydantic import BaseModel, Field, model_validator

MIN_PASSWORD_LENGTH = 8
# S0 (audit B-15): a 100,000-character password used to be accepted and hashed.
MAX_PASSWORD_LENGTH = 128


class LoginRequest(BaseModel):
    # Either the asset_user's Employee Code OR their email address. Many asset_users
    # (stores, stock locations, installed-equipment locations) have no email
    # at all, so email can only be an *additional* way in, never a
    # replacement for emp_code -- see the lookup in router.py::login.
    #
    # No company_id here on purpose: the login screen doesn't ask for a
    # company, so login_id alone must resolve to exactly one asset_user across
    # every active company -- see router.py::login for how an ambiguous
    # match (the same emp_code or email reused in more than one company) is
    # handled.
    login_id: str = Field(max_length=200)
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)


class LoginResponse(BaseModel):
    access_token: str
    must_change_password: bool
    role: str
    # None for the Primary Owner -- a company-less bootstrap account (see
    # app.asset_users.models.AssetUser.is_primary_owner).
    company_id: int | None
    # The frontend needs this directly (not just `role`): master-data
    # management is Primary-Owner-only, stricter than the ADMIN role itself.
    is_primary_owner: bool


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)

    @model_validator(mode="after")
    def _must_differ(self):
        # The whole point of a forced first-login change is that the temporary
        # (admin-relayed) password stops working -- "changing" it to itself would
        # clear must_change_password without that ever happening.
        if self.new_password == self.old_password:
            raise ValueError("new password must be different from the old password")
        return self


class CompanyOption(BaseModel):
    id: int
    name: str
