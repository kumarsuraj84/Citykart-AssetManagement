from pydantic import BaseModel


class LoginRequest(BaseModel):
    company_id: int
    emp_code: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    must_change_password: bool
    role: str
    company_id: int


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str
