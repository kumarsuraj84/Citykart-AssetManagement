import uuid
from datetime import datetime, timezone
from pathlib import Path
from app.core.config import settings
from app.documents.models import AssetDocument

MAX_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".docx"}


async def save_document(asset_id: int, doc_type: str, filename: str, content: bytes, mime_type: str, uploaded_by: int) -> AssetDocument:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"file type '{ext}' is not allowed")
    if len(content) > MAX_SIZE_BYTES:
        raise ValueError("file exceeds the 10 MB limit")

    asset_dir = Path(settings.upload_dir) / str(asset_id)
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4()}{ext}"
    stored_path = asset_dir / stored_name
    stored_path.write_bytes(content)

    return AssetDocument(
        asset_id=asset_id, doc_type=doc_type, file_name=filename, stored_path=str(stored_path),
        mime_type=mime_type, size_bytes=len(content), uploaded_by=uploaded_by,
        uploaded_at=datetime.now(timezone.utc),
    )
