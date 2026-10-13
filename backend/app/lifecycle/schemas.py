from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from app.core.validation import InModel


class ApplyEventIn(InModel):
    event_type: str = Field(max_length=30)
    to_asset_user_id: int | None = None
    event_date: datetime | None = None
    remarks: str | None = Field(default=None, max_length=1000)
    reference_no: str | None = Field(default=None, max_length=100)


class AssetEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    asset_id: int
    event_type: str
    event_date: datetime
    from_asset_user_id: int | None
    to_asset_user_id: int | None
    status_after: str
    remarks: str | None
    reference_no: str | None
    recorded_by: int
    # Human-readable custody wording with real asset_user names substituted in, e.g.
    # "Allotted to Ankur Pahwa" (built server-side from label_for_event; see
    # app.lifecycle.router._with_labels). Defaults to "" only so the model can be
    # validated from an ORM row before the router fills it in.
    label: str = ""
