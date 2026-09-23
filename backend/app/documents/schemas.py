from datetime import datetime
from pydantic import BaseModel, ConfigDict


class AssetDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    asset_id: int
    doc_type: str
    file_name: str
    mime_type: str
    size_bytes: int
    uploaded_at: datetime
