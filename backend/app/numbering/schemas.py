from pydantic import BaseModel, ConfigDict, Field
from app.core.validation import InModel


class CodeRuleIn(InModel):
    company_id: int | None = None
    prefix_template: str = Field(max_length=300)
    suffix_template: str = Field(default="", max_length=100)
    start_number: int = 1
    pad_width: int = 0


class CodeRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    company_id: int | None = None
    prefix_template: str
    suffix_template: str = ""
    start_number: int = 1
    pad_width: int = 0
    # S0.9 (additive): what the first code of this rule looks like, with
    # sample values for the company/location/cost centre/category/sub-category.
    example: str | None = None


class CodeRulePreviewOut(BaseModel):
    example: str
