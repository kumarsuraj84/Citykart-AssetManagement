from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ApplyEventIn(BaseModel):
    event_type: str
    to_holder_id: int | None = None
    event_date: datetime | None = None
    remarks: str | None = None
    reference_no: str | None = None


class AssetEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    asset_id: int
    event_type: str
    event_date: datetime
    from_holder_id: int | None
    to_holder_id: int | None
    status_after: str
    remarks: str | None
    reference_no: str | None
    recorded_by: int
