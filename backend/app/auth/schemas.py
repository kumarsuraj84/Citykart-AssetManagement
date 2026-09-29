from pydantic import BaseModel, Field, model_validator


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
    login_id: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    must_change_password: bool
    role: str
    company_id: int


MIN_PASSWORD_LENGTH = 8


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)

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
