import io
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from app.core.config import settings
from app.documents.models import AssetDocument

MAX_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".docx"}

# Security IN-03: the media type a file is served with comes from its (allowed) extension, never from what the
# uploading browser claimed -- a stored "invoice.pdf" can never be served as text/html.
MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
# The part every real Office file of that kind has inside its zip container.
_OFFICE_PARTS = {".xlsx": "xl/workbook.xml", ".docx": "word/document.xml"}


def media_type_for(name: str | None) -> str:
    """Server-derived media type of a stored document (by extension); unknown -> a plain download."""
    return MEDIA_TYPES.get(Path(name or "").suffix.lower(), "application/octet-stream")


def _is_office(content: bytes, part: str) -> bool:
    if not content.startswith(b"PK\x03\x04"):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = set(archive.namelist())
    except (zipfile.BadZipFile, ValueError, OSError):
        return False
    return "[Content_Types].xml" in names and part in names


def content_matches_extension(ext: str, content: bytes) -> bool:
    """Security IN-03: the file really is what its extension says (its signature bytes), so a script or an HTML
    page cannot be stored as "photo.png" and handed out again."""
    if ext == ".pdf":
        return b"%PDF-" in content[:1024]
    if ext in (".jpg", ".jpeg"):
        return content.startswith(b"\xff\xd8\xff")
    if ext == ".png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in _OFFICE_PARTS:
        return _is_office(content, _OFFICE_PARTS[ext])
    return False


async def save_document(asset_id: int, doc_type: str, filename: str, content: bytes, mime_type: str, uploaded_by: int) -> AssetDocument:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"file type '{ext}' is not allowed")
    if len(content) > MAX_SIZE_BYTES:
        raise ValueError("file exceeds the 10 MB limit")
    if not content_matches_extension(ext, content):
        raise ValueError(f"This file is not a real {ext.lstrip('.').upper()} file. Upload the original document.")

    asset_dir = Path(settings.upload_dir) / str(asset_id)
    asset_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4()}{ext}"
    stored_path = asset_dir / stored_name
    stored_path.write_bytes(content)

    # `mime_type` (what the browser claimed) is no longer stored: the server's own type for the extension is.
    return AssetDocument(
        asset_id=asset_id, doc_type=doc_type, file_name=filename, stored_path=str(stored_path),
        mime_type=MEDIA_TYPES[ext], size_bytes=len(content), uploaded_by=uploaded_by,
        uploaded_at=datetime.now(timezone.utc),
    )
