from pydantic import BaseModel, ConfigDict


class CodeRuleIn(BaseModel):
    company_id: int | None = None
    prefix_template: str
    suffix_template: str = ""
    start_number: int = 1
    pad_width: int = 0


class CodeRuleOut(CodeRuleIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
