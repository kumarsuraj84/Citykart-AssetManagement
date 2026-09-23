from pydantic import BaseModel


class LoginRequest(BaseModel):
    company_id: int
    # Either the holder's Employee Code OR their email address. Many holders
    # (stores, stock locations, installed-equipment locations) have no email
    # at all, so email can only be an *additional* way in, never a
    # replacement for emp_code -- see the lookup in router.py::login.
    login_id: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    must_change_password: bool
    role: str
    company_id: int


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class CompanyOption(BaseModel):
    id: int
    name: str
